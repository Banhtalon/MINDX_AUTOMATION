"""Reconcile fresh evidence and prove preservation. Does not modify product/history."""
import copy
import datetime
import hashlib
import json
import os
from pathlib import Path

out = Path(__file__).resolve().parent
root = out.parents[2]
state = json.loads((out / "source-state.json").read_text(encoding="utf-8"))
snap = Path(state["snapshot"])
def read(p): return json.loads(p.read_text(encoding="utf-8"))
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def write(name,data): (out/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
def describe(p): return {"sha256":sha(p),"bytes":p.stat().st_size}

original = read(out/"protected-hashes.json")["files"]
paths = [root/"next-env.d.ts"]
for n in range(12,24): paths.extend(p for p in (root/f"docs/audits/round-{n}").rglob("*") if p.is_file())
current = {p.relative_to(root).as_posix():describe(p) for p in sorted(paths)}
protected_diff = [p for p in sorted(set(original)|set(current)) if original.get(p)!=current.get(p)]
source_diff = [p for p,v in state["files"].items() if not (root/p).exists() or describe(root/p)!=v]
snapshot_diff = [p for p,v in state["files"].items() if not (snap/p).exists() or describe(snap/p)!=v]
before_product = {p for p in state["files"] if p.startswith(("src/","scripts/"))}
after_product = {p.relative_to(root).as_posix() for d in ["src","scripts"] for p in (root/d).rglob("*") if p.is_file()}
preservation = {"checkedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"protectedCount":len(original),
    "protectedUnchanged":not protected_diff,"protectedDifferences":protected_diff,
    "rootNextEnvSha256":sha(root/"next-env.d.ts").upper(),"sourceFileCount":len(state["files"]),
    "sourceDifferences":source_diff,"authorizedSourceManifestChanges":["MINDX_AUTOMATION_PLAN.md"],
    "noUnauthorizedSourceChanges":not(set(source_diff)-{"MINDX_AUTOMATION_PLAN.md"}),
    "productInventoryUnchanged":before_product==after_product,"productFiles":len(before_product),
    "snapshotDifferencesAfterGates":snapshot_diff}
write("preservation-check.json",preservation)
assert preservation["protectedUnchanged"] and preservation["noUnauthorizedSourceChanges"] and preservation["productInventoryUnchanged"]
assert preservation["rootNextEnvSha256"]=="B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000"

previous = read(out.parent/"round-23/source-state.json")["files"]
write("changes-since-r23.json",{"files":[{"path":p,"r23":previous.get(p),"r24":v} for p,v in state["files"].items() if previous.get(p)!=v]})
fresh = {f"R{n}":read(out/f"round{n}-results.json") for n in [12,13,16,17,20,21,22,23]}
r24 = read(out/"independent-results.json")
all_r24 = {r["id"]:r for r in r24["results"]}
old_ids = {r["id"] for r in fresh["R23"]["results"]}
assert len(old_ids)==116 and old_ids.issubset(all_r24)
assert all(all_r24[k]["pass"] for k in old_ids)

compat = {r["observation"]["originalId"]:r["id"] for r in r24["results"] if r["id"].startswith("R24-COMPAT-R20-")}
expected_drift = {"API-approval-control","R20-03-legacy-reapproval","R20-05-override-control","R20-06-latest-control"}
assert {r["id"] for r in fresh["R20"]["results"] if not r["pass"]}==expected_drift
assert set(compat)==expected_drift and all(all_r24[k]["pass"] for k in compat.values())
assessments = {
 "R19-01":"Adam7 bảy lượt và cây Kids cơ bản đạt; WebP hỏng có header hợp lệ vẫn PARSED; PDF bỏ qua trailer Root và generation tham chiếu.",
 "R19-02":"Mã tiêu chí, giới hạn barem, bằng chứng và tổng điểm tính bằng mã nguồn tiếp tục đạt hồi quy mới.",
 "R19-03":"Hash tổng hợp bảo vệ điểm/nội dung; duyệt lại hash cũ đạt với snapshot đầy đủ trong ca tương thích R24.",
 "R19-04":"Đổi/xóa file trước hoặc trong AI và parsedContent có sẵn đều được kiểm tra lại trên đĩa.",
 "R19-05":"Ba handler gửi barem đang chọn; tiêu chí sai/bài chưa đọc bị chặn; điểm ghi đè hợp lệ đạt hợp đồng duyệt mới.",
 "R19-06":"Duyệt đơn và hàng loạt bắt buộc đủ năm trường và đối chiếu giá trị; thiếu, sai kiểu hoặc khác phiên bản đều bị chặn; hash giữ qua mở lại SQLite.",
 "R19-07":"Khóa chính xác học viên/bài nộp và từ chối tên trùng, ID một phần hoặc modal thiếu ID tiếp tục đạt.",
 "R19-08":"Đối chiếu lesson/session và chặn thiếu ánh xạ tiếp tục đạt.",
 "R19-09":"Đã chặn data sai hình dạng và mẫu sai R23; còn chấp nhận sai alias/giá trị phản hồi, dùng biến không được truyền làm bằng chứng, bỏ sót dữ liệu lồng; hai đối chứng literal/biến đổi tên bị từ chối.",
 "R19-10":"Đọc lại điểm, quyết định và nhận xét cho GRADE/REDO đạt với DOM mô phỏng.",
 "R19-11":"Đối chiếu hash có điều kiện trước VERIFIED vẫn chặn dữ liệu bị sửa trong lúc lưu/đọc lại.",
 "R19-12":"Phản hồi cũ từ lớp/buổi trước không ghi đè phạm vi mới trong kiểm chứng handler giao diện.",
 "R19-13":"Hai câu ghi trong cùng db.transaction; SQLITE_FULL, lỗi ghi bài và lỗi ghi metadata đều hoàn tác, không tăng sequence dở dang; không có bản ghi mồ côi.",
 "R19-14":"Tải thất bại hoặc một phần vẫn dừng AI; lượt thành công chỉ chấm đúng tập bài đã tải."
}
issues = copy.deepcopy(read(out.parent/"round-23/issue-status.json")["issues"])
for issue in issues:
    key = issue["issueId"]
    num = key[-2:]
    checks = [r for r in r24["results"] if r["id"].startswith(f"R24-{num}-")]
    issue.update({"status":"PARTIALLY_FIXED" if key in ["R19-01","R19-09"] else "CLOSED_SOURCE",
       "severity":{"R19-01":"P2","R19-09":"P1"}.get(key),"assessment":assessments[key],
       "r24Checks":[r["id"] for r in checks],"failingChecks":[r["id"] for r in checks if not r["pass"]]})
    evidence={}
    for round_name,ids in issue.get("freshHistoricalChecks",{}).items():
        lookup={r["id"]:r for r in fresh[round_name]["results"]}
        assert all(i in lookup for i in ids),(key,round_name)
        evidence[round_name]={"passed":[i for i in ids if lookup[i]["pass"]],"failed":[i for i in ids if not lookup[i]["pass"]]}
    issue["freshHistoricalOutcomes"]=evidence
    issue["compatibilityChecks"]=[v for k,v in compat.items() if (key=="R19-03" and k in ["API-approval-control","R20-03-legacy-reapproval"]) or (key=="R19-05" and k=="R20-05-override-control") or (key=="R19-06" and k=="R20-06-latest-control")]
write("issue-status.json",{"round":24,"verdict":"NO-GO","closedSource":12,"partiallyFixed":2,"issues":issues,
    "schemaCompatibility":{"originalR16":"15/16; PHASE1-SCHEMA expects 7 tables instead of 8","r24InheritedCompatibilityCheck":"R23-COMPAT-R16-schema PASS; original result unchanged"},
    "r20Compatibility":{"original":"141/145; four failures remain recorded","r24CorrectedContract":compat}})

receipts = read(out/"commands.json")
for command in receipts:
    assert sha(out/command["log"])==command["logSha256"]
    if "results" in command and command.get("resultsAvailable", True):
        assert sha(out/command["results"])==command["resultsSha256"]
source_hash_match=all(sha(root/p)==h and sha(snap/p)==h for p,h in r24["sourceHashes"].items())
artifact = {"harnessRootMatchesSnapshot":sha(out/"verify-independent.mjs")==sha(snap/"docs/audits/round-24/verify-independent.mjs"),
    "harnessMatchesResult":sha(out/"verify-independent.mjs")==r24["harnessSha256"],
    "sourceHashesMatchRootAndSnapshot":source_hash_match,"inheritedR23CasesUnchangedAndAllPass":len(old_ids),
    "commandLogsAndAvailableResultsMatchReceipts":True,
    "supersededResultsNotRetained":[{"name":r["name"],"attempt":r["attempt"],"observedSha256":r["resultsSha256"]} for r in receipts if r.get("resultsAvailable") is False],
    "r24HarnessSha256":sha(out/"verify-independent.mjs")}
write("artifact-check.json",artifact)
assert all(artifact[k] for k in ["harnessRootMatchesSnapshot","harnessMatchesResult","sourceHashesMatchRootAndSnapshot"])
write("evidence-manifest.json",{"files":{p.name:describe(p) for p in sorted(out.iterdir()) if p.is_file() and p.name!="evidence-manifest.json"}})
print(json.dumps({"preservation":preservation,"artifact":artifact,"r24":{"passed":r24["passed"],"failed":r24["failed"],"total":r24["total"]}},ensure_ascii=True))
