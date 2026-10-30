import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent

def read(name):
    return json.loads((OUT / name).read_text(encoding='utf-8-sig'))

before = read('protected-before.json')
session_logs = {
    'docs/audits/v340/CODEX_V340_FINAL_ROUND4.stdout.log',
    'docs/audits/v340/CODEX_V340_FINAL_ROUND4.stderr.log',
}
protected = {p: h for p, h in before.items() if p not in session_logs}
changed = [p for p, h in protected.items() if not (ROOT/p).is_file()
           or hashlib.sha256((ROOT/p).read_bytes()).hexdigest().upper() != h]
assert not changed, changed

expected = {
    'mindx_bot.db': 'A911EB02CD6E2610340604DCF42D53AFB428C50C02727C4CE44F138DEC9C8F16',
    'running_classes.json': 'ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2',
}
production = {}
for name in ['production-before.json', 'production-after.json']:
    production[name] = {Path(x['Path']).name: x['Hash'] for x in read(name)}
    assert production[name] == expected

gates = read('gates.json')
assert len(gates) == 10 and all(g['exitCode'] == 0 for g in gates)
compat = read('renderer-compatibility.json')
assert (compat['passed'], compat['failed']) == (14, 0)
for mode in ['allowed', 'junction']:
    cases = [r for r in compat['results'] if r['mode'] == mode]
    assert len(cases) == 7 and all(r['pass'] for r in cases)
    assert all(r['capturedCount'] > 0 and (r['width'], r['height']) == (960, 540) for r in cases)
    assert all(r['redPixels'] > 1000 if mode == 'allowed' else r['redPixels'] == 0 for r in cases)
resource = read('renderer-resources.json')
assert (resource['passed'], resource['failed']) == (5, 0)
assert all(r['capturedCount'] > 0 and r['redPixels'] == 0 for r in resource['results'])
payload = read('renderer-payload.json')['results']
assert len(payload) == 4 and all(r['capturedCount'] > 0 and r['redPixels'] > 1000 for r in payload)
assert len({r['resourceKeys'][0].rsplit('_', 1)[0] for r in payload}) == 4
assert all(re.fullmatch(r'mem://asset_[0-9a-f]{12}_\d+', key) for r in payload for key in r['resourceKeys'])
edge = read('edge-results.json')
assert (edge['passed'], edge['failed']) == (20, 0)
path = read('path-probe.json')
assert path['policyPass'] and path['routeStatus'] == 403 and path['directoryUnregistered']
browser = read('browser-policy-probe.json')
assert browser['standaloneLaunches'] == browser['newContexts'] == 0
assert browser['strictSinglePersistentContextPolicyPass']
assert all(x['original'] == x['copy'] for x in read('probe-copy-hashes.json').values())

documents = []
for name in ['PROJECT_STATE.md', 'CHANGELOG.md', 'MINDX_AUTOMATION_PLAN.md', 'docs/audits/v340/CODEX_V340_FINAL.md']:
    actual = (ROOT/name).read_bytes()
    assert actual == (OUT/'documents-after'/Path(name).name).read_bytes()
    text = actual.decode('utf8', errors='strict')
    current, history = text.split('> **Lịch sử S8 Round 3', 1)
    assert 'S8 Round 4' in current and 'VERDICT: GO' in current and '5/5' in current
    assert '?' not in current and '\ufffd' not in current
    assert '?' not in history.split('\n\n', 1)[0]
    documents.append({'path': name, 'utf8': True, 'matchesStagedBytes': True,
                      'currentRound4Go': True, 'round3AccentsRepaired': True})

report = ROOT/'docs/audits/v340/CODEX_V340_FINAL_ROUND4.md'
text = report.read_text(encoding='utf8', errors='strict')
assert '\ufffd' not in text
for finding in ['S8-01','S8-02','S8-R2-01','S8-R3-01','S8-R3-02']:
    assert finding + ': CLOSED' in text
# This verification artifact is written below; all other relative report links must already exist.
for link in re.findall(r'\]\(([^)]+)\)', text):
    if '://' not in link and link != 's8-round4/final-verification.json':
        assert (report.parent/link).exists(), link

isolation = read('isolation.json')
mirror = Path(isolation['mirror'])
source_matches = all((mirror/p).is_file() and hashlib.sha256((mirror/p).read_bytes()).hexdigest().upper() == h
                     for p, h in protected.items() if p.startswith('src/'))
assert source_matches
result = {
    'verdict': 'GO', 'findingsClosed': ['S8-01','S8-02','S8-R2-01','S8-R3-01','S8-R3-02'],
    'rawSnapshotCount': len(before), 'protectedImmutableCount': len(protected), 'changed': changed,
    'sessionOwnedLogsExcluded': sorted(p for p in session_logs if p in before),
    'rawSnapshotChanges': read('preservation.json')['changed'],
    'productionHashesMatchExpectedBeforeAndAfter': True, 'production': production,
    'gatesPassed': len(gates), 'compatibilityPassed': 14, 'resourcePassed': 5,
    'payloadPositiveControlsPassed': 4, 'edgePassed': 20,
    'sourceMatchesTestedMirror': source_matches, 'documents': documents,
    'reportUtf8AndLinksPass': True,
}
(OUT/'final-verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
(OUT/'git-status-after.txt').write_text(subprocess.check_output(['git','status','--short'], cwd=ROOT, text=True, encoding='utf8'), encoding='utf8')
print(json.dumps({'verdict': result['verdict'], 'protected': len(protected), 'changed': changed,
                  'productionPreserved': True, 'gatesPassed': len(gates), 'documentsVerified': len(documents)}))
