import pathlib, hashlib, json, subprocess
root=pathlib.Path.cwd();out=pathlib.Path(__file__).resolve().parent
before=json.loads((out/'source-before.json').read_text(encoding='utf8'))
entries=[]
for rel,old in before.items():
    p=root/rel
    current={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'size':p.stat().st_size,'mtime_ns':p.stat().st_mtime_ns}
    entries.append({'path':rel,'unchanged':old==current,'before':old,'after':current})
source=[e for e in entries if pathlib.Path(e['path']).parts[0] in ('src','scripts')]
result={'source_total':len(source),'source_unchanged':sum(e['unchanged'] for e in source),'entries':entries}
(out/'source-integrity.json').write_text(json.dumps(result,indent=2),encoding='utf8')
(out/'git-status-final.txt').write_bytes(subprocess.check_output(['git','status','--short']))
assert all(e['unchanged'] for e in source),'Source or product test changed during audit'
print(json.dumps({'source_total':len(source),'source_unchanged':sum(e['unchanged'] for e in source),'changed_documents':[e['path'] for e in entries if not e['unchanged']]}))
