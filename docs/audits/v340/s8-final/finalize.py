import hashlib,json,pathlib,re,shutil,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[4]; OUT=pathlib.Path(__file__).resolve().parent
def read(name):return json.loads((OUT/name).read_text(encoding='utf8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest().upper()
before=read('protected-before.json')
changed=[p for p,h in before.items() if not (ROOT/p).is_file() or sha(ROOT/p)!=h]
after_paths=list((ROOT/'src').rglob('*'))+list((ROOT/'scripts').rglob('*'))
after_names={p.relative_to(ROOT).as_posix() for p in after_paths if p.is_file()}
added=sorted(after_names-{p for p in before if p.startswith(('src/','scripts/'))})
production={p:sha(ROOT/p) for p in read('production-before.json')}
save=lambda name,value:(OUT/name).write_text(json.dumps(value,indent=2,ensure_ascii=False),encoding='utf8')
save('production-after.json',production)
info=read('isolation.json'); build=read('build-native.json')
temp_env=[]
for dirname in [info['temp'],build['cwd']]:
    f=pathlib.Path(dirname)/'next-env.d.ts'
    record={'path':str(f),'beforeRestore':sha(f),'original':before['next-env.d.ts']}
    if sha(f)!=before['next-env.d.ts']:
        shutil.copy2(ROOT/'next-env.d.ts',f)
    record['afterRestore']=sha(f); temp_env.append(record)
shutil.copy2(pathlib.Path(info['temp'])/'docs/audits/v340/s5a-screenshots/parity-manifest.json',OUT/'s5a-parity-manifest.json')
source={p:h for p,h in before.items() if p.startswith(('src/','scripts/'))}
mirrors={}
for name,directory in [('tests',info['temp']),('build',build['cwd'])]:
    mirrors[name]={'sourceCount':len(source),'changed':[p for p,h in source.items() if not (pathlib.Path(directory)/p).is_file() or sha(pathlib.Path(directory)/p)!=h]}
# Build mirror intentionally contains src only; scripts are not needed by Next.
mirrors['build']={'sourceCount':sum(p.startswith('src/') for p in source),
    'changed':[p for p,h in source.items() if p.startswith('src/') and (not (pathlib.Path(build['cwd'])/p).is_file() or sha(pathlib.Path(build['cwd'])/p)!=h)]}
stage_changes=[]
for stage,entry in read('static-inspection.json')['stages'].items():
    if sha(ROOT/entry['path'])!=entry['sha256']:stage_changes.append(stage)
report=ROOT/'docs/audits/v340/CODEX_V340_FINAL.md'
links=re.findall(r'\]\(([^)]+)\)',report.read_text(encoding='utf8'))
missing=[p for p in links if not p.startswith(('https:','http:')) and not (report.parent/p).exists() and not p.endswith('final-verification.json')]
result={'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
    'protectedCount':len(before),'changed':changed,'addedSourceFiles':added,'stageReportsChanged':stage_changes,
    'productionAfter':production,'productionMatchesBefore':production==read('production-before.json'),
    'mirrors':mirrors,'nextEnvTempRestoration':temp_env,'missingReportLinks':missing,
    'buildExitCode':build['exitCode'],'verdict':'NO-GO','openFindings':['S8-01','S8-02']}
save('final-verification.json',result)
(OUT/'git-status-final.txt').write_text(subprocess.check_output(['git','status','--short'],cwd=ROOT,text=True),encoding='utf8')
print(json.dumps(result,ensure_ascii=False))
assert not changed and not added and not stage_changes and not missing
assert result['productionMatchesBefore'] and all(not x['changed'] for x in mirrors.values())
