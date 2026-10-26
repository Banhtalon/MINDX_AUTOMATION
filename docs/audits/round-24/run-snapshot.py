"""AUDIT-R24: execute gates only in the separately copied TEMP snapshot."""
import datetime
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time

cfg = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
root, out, snap = (pathlib.Path(cfg[k]) for k in ("root", "out", "snapshot"))
assert snap.is_relative_to(pathlib.Path(os.environ["TEMP"])) and snap != root
assert "mindx-round24-" in str(snap)
allowed = {"SYSTEMROOT", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP",
           "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)",
           "PROGRAMDATA", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS"}
env = {k: v for k, v in os.environ.items() if k.upper() in allowed}
guard = snap / "docs/audits/round-19/network-guard.cjs"
env.update({"NODE_OPTIONS": '--require "' + guard.as_posix() + '"', "NEXT_TELEMETRY_DISABLED": "1",
            "npm_config_offline": "true", "npm_config_audit": "false", "npm_config_fund": "false",
            "CI": "1", "NO_COLOR": "1"})
node = shutil.which("node.exe")
shell = os.environ.get("COMSPEC", r"C:\Windows\System32\cmd.exe")
commands_file = out / "commands.json"
receipts = json.loads(commands_file.read_text(encoding="utf-8")) if commands_file.exists() else []
first_new_receipt = len(receipts)
(out / "isolation.json").write_text(json.dumps({"snapshot": str(snap), "environmentKeys": sorted(env),
    "secretsInherited": False, "credentialsCopied": False, "outboundNodeSocketGuard": str(guard),
    "limitations": "Node socket guard only; not an OS firewall. No real browser, LMS or Gemini calls."}, indent=2) + "\n", encoding="utf-8")

def run(name, display, argv, result=None):
    attempt = 1 + sum(r["name"] == name for r in receipts)
    logfile = out / f"{name}.attempt-{attempt}.log"
    resultpath = snap / result if result else None
    if resultpath:
        assert resultpath.is_relative_to(snap)
        resultpath.unlink(missing_ok=True)
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    t = time.monotonic()
    print("START " + display, flush=True)
    with logfile.open("wb") as f:
        proc = subprocess.run(argv, cwd=snap, env=env, stdout=f, stderr=subprocess.STDOUT)
    receipt = {"name": name, "attempt": attempt, "command": display, "argv": argv, "cwd": str(snap),
        "startedAt": started, "endedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "elapsedSeconds": round(time.monotonic()-t, 3), "exitCode": proc.returncode,
        "log": logfile.name, "logSha256": hashlib.sha256(logfile.read_bytes()).hexdigest()}
    if resultpath and resultpath.exists():
        canonical = out / ("independent-results.json" if name == "round24" else name + "-results.json")
        target = out / f"{name}.attempt-{attempt}-results.json"
        shutil.copy2(resultpath, target)
        shutil.copy2(target, canonical)
        data = json.loads(target.read_text(encoding="utf-8"))
        receipt.update({"results": target.name, "canonicalResults": canonical.name, "resultsSha256": hashlib.sha256(target.read_bytes()).hexdigest(),
                        "total": data.get("total"), "passed": data.get("passed"), "failed": data.get("failed")})
    receipts.append(receipt)
    commands_file.write_text(json.dumps(receipts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("DONE " + json.dumps({k:receipt.get(k) for k in ["name","attempt","exitCode","total","passed","failed","elapsedSeconds"]}), flush=True)

if len(sys.argv) > 2 and sys.argv[2] == "native-media":
    dest = snap / "docs/audits/round-24"
    dest.mkdir(exist_ok=True)
    shutil.copy2(out / "native-media-repro.mjs", dest / "native-media-repro.mjs")
    command = "npx tsx docs/audits/round-24/native-media-repro.mjs"
    run("native-media", command, [shell, "/d", "/s", "/c", command], "docs/audits/round-24/native-media-results.json")
elif len(sys.argv) > 2 and sys.argv[2] == "round24":
    dest = snap / "docs/audits/round-24"
    dest.mkdir(exist_ok=True)
    shutil.copy2(out / "verify-independent.mjs", dest / "verify-independent.mjs")
    run("round24", "node docs/audits/round-24/verify-independent.mjs",
        [node, "docs/audits/round-24/verify-independent.mjs"], "docs/audits/round-24/independent-results.json")
else:
    for n in [23,22,21,20,12,13,16,17]:
        rel = f"docs/audits/round-{n}/verify-independent.mjs"
        run(f"round{n}", "node " + rel, [node, rel], f"docs/audits/round-{n}/independent-results.json")
    for name, command in [("phase4", "npx tsx scripts/test-phase4-codex-repros.ts"),
                          ("phase5", "npx tsx scripts/test-phase5.ts"),
                          ("typecheck", "npx tsc --noEmit --incremental false"),
                          ("build", "npm run build")]:
        run(name, command, [shell, "/d", "/s", "/c", command])

raise SystemExit(1 if any(r["exitCode"] != 0 for r in receipts[first_new_receipt:]) else 0)
