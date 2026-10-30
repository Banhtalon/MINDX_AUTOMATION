import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT=Path(__file__).resolve().parents[4]
OUT=Path(__file__).resolve().parent
def load(name): return json.loads((OUT/name).read_text(encoding='utf-8-sig'))
def save(name,value): (OUT/name).write_text(json.dumps(value,indent=2,ensure_ascii=False),encoding='utf8')
before=load('protected-before.json')
changed=[p for p,h in before.items() if not (ROOT/p).is_file() or hashlib.sha256((ROOT/p).read_bytes()).hexdigest().upper()!=h]
prod_before=load('production-before.json');prod_after=load('production-after.json')
expected=['A911EB02CD6E2610340604DCF42D53AFB428C50C02727C4CE44F138DEC9C8F16','ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2']
assert not changed,changed
assert prod_before==prod_after
assert [x['Hash'] for x in prod_after]==expected
scan=[]
for p in (ROOT/'src').rglob('*'):
    if p.is_file():
        for n,line in enumerate(p.read_text(encoding='utf8').splitlines(),1):
            if re.search(r'(?:chromium|firefox|webkit)\s*\.\s*launch|launchPersistentContext|\.\s*newContext\s*\(|connectOverCDP',line):
                scan.append({'path':p.relative_to(ROOT).as_posix(),'line':n,'text':line.strip()})
assert len(scan)==1 and scan[0]['path']=='src/lib/playwright/browser-manager.ts'
save('static-inspection.json',{'browserConstructionMatches':scan,'standaloneLaunches':0,'newContexts':0,
    'persistentContextSites':1,'profileDir':'./playwright-auth','queueRoute':'src/app/api/spck/capture-screenshots/route.ts:221',
    'stopEntry':'src/lib/local-files/spck-app-screenshotter.ts:1524','stopIteration':'src/lib/local-files/spck-app-screenshotter.ts:1536',
    'rendererResourceBoundary':{'imgQuotedRegex':965,'plainQTextDocument':1017,'setHtml':1021,'aiReadsScreenshot':1187,'aiGenerate':1210}})
save('followup-gates.json',[
    {'name':'edge-probe-diagnostic','exitCode':1,'results':'edge-results-diagnostic.json','reason':'Audit-only allowlist narrowed away from the isolated TEMP database; no product change'},
    {'name':'edge-probe-final','command':'npx tsx edge-probe.cjs','exitCode':0,'results':'edge-results.json','passed':20,'failed':0,'change':'Audit-only configuration additionally allows the exact MINDX_DB_PATH file; denied fixture remains outside allowlist'},
    {'name':'renderer-resources','command':'npx tsx renderer-resource-probe.cjs','exitCode':1,'results':'renderer-resources.json','passed':2,'failed':3,'reason':'Three reproducible reads of a synthetic image outside Path Allowlist'}])
summary='**S8 Round 2 (30/10/2026): VERDICT: NO-GO.** **S8-01: CLOSED; S8-02: CLOSED (2/2 phát hiện cũ).** Phát hiện mới **S8-R2-01 — HIGH OPEN**: bộ dựng HTML PyQt6 đọc ảnh ngoài Path Allowlist qua `src` không có dấu nháy, `body background` hoặc CSS `background-image`; đã tái hiện 3/3 ca bằng ảnh giả trong TEMP. Bốn lệnh bắt buộc và hai probe gốc PASS; 20/20 ca bổ sung đạt cuối. **2.042/2.042 tệp bảo vệ và hai SHA-256 dữ liệu thật giữ nguyên.** Chỉ bốn tệp nguồn sửa trước audit khác Round 1; không chạy lại build/toàn bộ tám bộ cũ. **S8 chưa đóng**, chưa nghiệm thu dịch vụ/lớp thật. Báo cáo: [CODEX_V340_FINAL_ROUND2.md](docs/audits/v340/CODEX_V340_FINAL_ROUND2.md); bằng chứng: `docs/audits/v340/s8-round2/`.'
# Preserve every byte of the pre-audit documents below the new status block.
for name in ['PROJECT_STATE.md','MINDX_AUTOMATION_PLAN.md','CHANGELOG.md']:
    original=(OUT/'documents-before'/name).read_bytes()
    first,rest=original.split(b'\n',1)
    new=first+b'\n\n> '+summary.encode('utf8')+b'\n\n'+rest
    (ROOT/name).write_bytes(new)
original=(OUT/'documents-before/CODEX_V340_FINAL.md').read_bytes()
header='''> **Trạng thái hiện tại — S8 Round 2 (30/10/2026): VERDICT: NO-GO.** **S8-01: CLOSED; S8-02: CLOSED — 2/2 phát hiện cũ đã đóng.** Còn **S8-R2-01 (HIGH OPEN)** mới trong bộ dựng HTML thay thế: đọc ảnh ngoài Path Allowlist qua tài nguyên HTML/CSS chưa được chặn ở tầng PyQt6. Bốn lệnh bắt buộc và hai probe gốc đạt; 20/20 ca bổ sung đạt cuối; ba ca đọc ảnh giả ngoài phạm vi tái hiện được. Hai tệp dữ liệu thật giữ nguyên SHA-256; 2.042/2.042 tệp bảo vệ không đổi trong audit. Chi tiết, bằng chứng và hướng sửa: [CODEX_V340_FINAL_ROUND2.md](CODEX_V340_FINAL_ROUND2.md). **Chưa đóng S8/nghiệm thu toàn bộ v3.4.0.**

---

## Lịch sử S8 Round 1 — giữ nguyên báo cáo gốc bên dưới

'''
(ROOT/'docs/audits/v340/CODEX_V340_FINAL.md').write_bytes(header.encode('utf8')+original)
assert (ROOT/'docs/audits/v340/CODEX_V340_FINAL.md').read_bytes().endswith(original)
save('final-verification.json',{'protectedCount':len(before),'changed':changed,'productionMatchesExpected':True,
    'productionBefore':prod_before,'productionAfter':prod_after,'round1ReportPreservedByteForByte':True,
    'round1ChangedPaths':list(load('round1-comparison.json')['changed']),
    'verdict':'NO-GO','closed':['S8-01','S8-02'],'open':[{'id':'S8-R2-01','severity':'HIGH'}],
    'mandatoryGatesPass':all(x['exitCode']==0 for x in load('gates.json') if x['name'] in ['tsc','spck-v272','s5','s7']),
    'edgePassed':load('edge-results.json')['passed'],'edgeFailed':load('edge-results.json')['failed'],
    'rendererSecurityFailures':load('renderer-resources.json')['failed']})
(OUT/'git-status-final.txt').write_text(subprocess.check_output(['git','status','--short'],cwd=ROOT,text=True,encoding='utf8'),encoding='utf8')
print(json.dumps({'verdict':'NO-GO','closed':2,'newHighOpen':1,'protectedCount':len(before),'changed':changed,'productionMatchesExpected':True}))
