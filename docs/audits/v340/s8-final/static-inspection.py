import hashlib,json,pathlib,re,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[4]; OUT=pathlib.Path(__file__).resolve().parent
files={p.relative_to(ROOT).as_posix():p.read_text(encoding='utf8') for p in (ROOT/'src').rglob('*') if p.suffix in ['.ts','.tsx']}
clients=[p for p,s in files.items() if re.match(r'''\s*["']use client["']''',s)]
secrets=re.compile(r'TEACHING_PASSWORD|LMS_PASSWORD|GEMINI_API_KEY')
def resolve(src,spec):
    if spec.startswith('@/'): base=ROOT/'src'/spec[2:]
    elif spec.startswith('.'): base=ROOT/pathlib.Path(src).parent/spec
    else:return None
    for p in [base, pathlib.Path(str(base)+'.ts'),pathlib.Path(str(base)+'.tsx'),base/'index.ts',base/'index.tsx']:
        if p.is_file():return p.resolve().relative_to(ROOT.resolve()).as_posix()
    return None
edges={}
for p,s in files.items():
    # Value imports/re-exports/dynamic imports; explicitly omit type-only imports.
    specs=re.findall(r'''(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']''',s)
    edges[p]=[q for match in specs for spec in match if spec for q in [resolve(p,spec)] if q in files]
reached=set(); violations=[]
for client in clients:
    queue=[(client,[client])]; visited=set()
    while queue:
        p,chain=queue.pop()
        if p in visited:continue
        visited.add(p);reached.add(p)
        if secrets.search(files[p]) or p=='src/lib/config.ts':violations.append({'client':client,'chain':chain})
        queue.extend((q,chain+[q]) for q in edges[p])
stages={}
for name in ['S0_ROUND2','S1_ROUND2','S2_ROUND3','S3_ROUND5','S4_ROUND3','S5A_ROUND2','S5B_ROUND3','S6_ROUND3','S7_ROUND2']:
    p=ROOT/'docs/audits/v340'/('CODEX_'+name+'.md'); s=p.read_text(encoding='utf8')
    stages[name]={'path':p.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest().upper(),'opening':s[:1800]}
protected=['next-env.d.ts']+[f'docs/audits/round-{n}' for n in range(12,42)]
diff=subprocess.check_output(['git','diff','--name-only','d7e3fe8','--',*protected],cwd=ROOT,text=True).splitlines()
contexts=[{'path':p,'line':s[:m.start()].count('\n')+1,'call':m.group(0)} for p,s in files.items() for m in re.finditer(r'chromium\.launch\(|browser\.newContext\(|chromium\.launchPersistentContext\(',s)]
result={'clientFiles':len(clients),'reachableLocalFiles':len(reached),'secretImportViolations':violations,
    'protectedChangedSinceS0':diff,'browserCreationSites':contexts,'stages':stages,
    'methodLimit':'Static local import graph; computed imports and package internals not exhaustively analyzed'}
(OUT/'static-inspection.json').write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf8')
print(json.dumps({k:v for k,v in result.items() if k not in ['stages']},ensure_ascii=False))
