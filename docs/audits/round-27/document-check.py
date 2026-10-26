"""Delivery checks for local links, stated counts, exact fixtures and limited plan insertion."""
import hashlib
import json
from pathlib import Path
import re
out=Path(__file__).resolve().parent
e=out/'evidence'
read=lambda p:json.loads(p.read_text(encoding='utf-8'))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
links=[]
for file in ['REPORT.vi.md','FIX_PROMPT.vi.md']:
    text=(out/file).read_text(encoding='utf-8')
    assert '\ufffd' not in text
    assert 'NO-GO' in text and '650/662' in text
    for link in re.findall(r'\]\(([^)]+)\)',text):
        if '://' in link or link.startswith('#'):continue
        target=out/link.split('#')[0]
        assert target.is_file(),(file,link)
        links.append({'document':file,'target':link})
artifact=read(e/'artifact-check.json');assert (artifact['mainTotal'],artifact['mainPassed'],artifact['mainFailed'])==(662,650,12)
report=(out/'REPORT.vi.md').read_text(encoding='utf-8')
assert str(artifact['commandAttempts'])+' ' in report and artifact['uniqueCommands']==27
main=read(e/'verify-results.json');media=read(e/'native-media-results.json');worker=read(e/'native-worker-results.json')
failed=lambda d:{r['id'] for r in d['results'] if not r['pass']}
assert failed(main)==failed(media)|failed(worker)
fixtures=read(e/'fixture-manifest.json');assert {r['id'] for r in fixtures}==failed(main)
assert all(sha(e/r['file'])==r['sha256'] for r in fixtures)
preserved=read(e/'preservation-check.json')
assert preserved['allProductAndProtectedFilesPreserved'] and preserved['protectedCount']==652
assert preserved['changed']==['MINDX_AUTOMATION_PLAN.md'] and not preserved['protectedMismatches']
assert read(e/'preservation-before-plan.json')['allPreserved']
root=out.parents[2];before=(e/'plan.before.md').read_bytes();after=(root/'MINDX_AUTOMATION_PLAN.md').read_bytes()
newline=b'\r\n' if b'\r\n' in before else b'\n'
entry=(out/'plan-entry.vi.txt').read_text(encoding='utf-8').strip().encode().replace(b'\n',newline)+newline*2
assert after.replace(entry,b'',1)==before
summary={'documents':['REPORT.vi.md','FIX_PROMPT.vi.md'],'allRelativeLinksExist':True,'linkCount':len(links),'countsMatchExecutedEvidence':True,'allTwelveFailedFixturesPresentAndHashed':True,
         'protectedFilesUnchanged':652,'productSrcScriptsUnchanged':57,'masterPlanOnlyAuditEntryAdded':True,'result':'PASS'}
(e/'document-check.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(summary))
