import pathlib,hashlib,json,subprocess,shutil
root=pathlib.Path.cwd();out=pathlib.Path(__file__).resolve().parent
before=json.loads((out/'source-before.json').read_text(encoding='utf8'))
protected={k:v for k,v in before.items() if k.startswith(('src\\','scripts\\','src/','scripts/')) or k=='next-env.d.ts'}
after={k:hashlib.sha256((root/k).read_bytes()).hexdigest() for k in protected}
changed=[k for k,v in protected.items() if v['sha256']!=after[k]]
new=[str(p.relative_to(root)) for d in ('src','scripts') for p in (root/d).rglob('*') if p.is_file() and str(p.relative_to(root)) not in protected]
integrity={'checked_src_scripts':len(protected)-1,'next_env_checked':True,'changed':changed,'new_src_scripts':new,'all_unchanged':not changed and not new,'owner_runtime_data':'NOT opened, hashed, copied, connected or read; runtime tests executed in TEMP copies without owner .env or browser profile'}
(out/'source-integrity.json').write_text(json.dumps(integrity,indent=2),encoding='utf8')
gates=[json.loads(s) for s in (out/'gates.jsonl').read_text().splitlines()]
retries=[json.loads(s) for s in (out/'gate-retries.jsonl').read_text().splitlines()]
final={x['gate']:x for x in gates}
for x in retries:final[x['gate']]=x
ui=json.loads((out/'ui-observations.json').read_text())
repo=json.loads((out/'repository-observations.json').read_text())
summary={'head':(out/'head.txt').read_text().strip(),'gates':len(final),'gates_pass':sum(x['exit']==0 for x in final.values()),'initial_harness_failures':['test-phase7 missing copied launchers','test-streamline-v340-s5a missing Git history access'],'retry_results':retries,'ui_checks':len(ui),'ui_pass':sum(x['pass'] for x in ui),'repository_checks':len(repo),'repository_pass':sum(x['pass'] for x in repo),'diagnostic_production':json.loads((out/'production-observation.json').read_text()),'production_clean_build':json.loads((out/'production-build-result.json').read_text()),'integrity':integrity}
(out/'execution-summary.json').write_text(json.dumps(summary,indent=2),encoding='utf8')
backup=out/'documents-before';backup.mkdir(exist_ok=True)
for name in ('PROJECT_STATE.md','CHANGELOG.md','MINDX_AUTOMATION_PLAN.md'):
    if not (backup/name).exists():shutil.copy2(root/name,backup/name)
targets={'src/components/final-project/SubmitBar.tsx':[(30,168)],'src/components/final-project/useSpckWorkflow.ts':[(893,905),(3389,3417)],'src/app/final-project/page.tsx':[(1248,1264)],'src/lib/dashboard/today-tasks.ts':[(255,290),(330,387),(420,438)],'src/app/api/teaching-projects/route.ts':[(17,46)],'src/app/page.tsx':[(1,28),(63,76)]}
excerpt=[]
for name,ranges in targets.items():
    lines=(root/name).read_text(encoding='utf8').splitlines();excerpt.append('\nFILE '+name)
    for a,b in ranges:excerpt.extend(f'{i}: {lines[i-1]}' for i in range(a,min(b,len(lines))+1))
(out/'source-excerpts.txt').write_text('\n'.join(excerpt),encoding='utf8')
baseline={}
for name in ('src/app/api/homework-grader/export/route.ts','src/app/api/homework-grader/scores/route.ts','src/app/api/report-card/route.ts','src/app/api/spck/session14-eval/route.ts'):
    content=subprocess.check_output(['git','show','HEAD:'+name]);current=(root/name).read_bytes()
    normalize=lambda b:b.replace(b'\r\n',b'\n')
    baseline[name]={'identical_to_HEAD_ignoring_CRLF':normalize(content)==normalize(current)}
(out/'production-errors-baseline.json').write_text(json.dumps(baseline,indent=2),encoding='utf8')
print(json.dumps(summary,indent=2))
