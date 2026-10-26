"""Assemble the self-contained R24 verifier without altering historical files."""
import hashlib
import json
from pathlib import Path

out = Path(__file__).resolve().parent
previous = out.parent / "round-23/verify-independent.mjs"
source = previous.read_text(encoding="utf-8")
source = source.replace("// Round 23 harness adapted", "// Round 24 harness adapted")
source = source.replace("const out = path.join(root, 'docs/audits/round-23');", "const out = path.join(root, 'docs/audits/round-24');")
source = source.replace("root.includes('mindx-round23-')", "root.includes('mindx-round24-')")
source = source.replace("'mindx-r23-fixtures-'", "'mindx-r24-fixtures-'")
anchor = "} finally {\n  process.chdir(previousCwd);"
assert source.count(anchor) == 1
source = source.replace(anchor, (out / "r24-cases.inc.txt").read_text(encoding="utf-8") + "\n" + anchor)
source = source.replace("const summary={round:23,", "const summary={round:24,inheritedR23Checks:116,harnessSha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),")
target = out / "verify-independent.mjs"
target.write_text(source, encoding="utf-8", newline="\n")
record = {"inheritedFrom": "docs/audits/round-23/verify-independent.mjs", "inheritedChecksUnchanged": 116,
          "historicalHarnessSha256": hashlib.sha256(previous.read_bytes()).hexdigest(),
          "newHarnessSha256": hashlib.sha256(target.read_bytes()).hexdigest(),
          "adjustments": ["output directory", "TEMP guard label", "fixture directory prefix", "summary metadata", "append R24 cases before finally"],
          "productSourceTransform": "Only existing import/export and TypeScript removal from R23 helper; no product body modifications.",
          "r20Compatibility": "Four separately identified R24 cases supply the full reviewed snapshot. Original R20 file, assertions and results remain unchanged."}
(out / "harness-provenance.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
print(json.dumps(record))
