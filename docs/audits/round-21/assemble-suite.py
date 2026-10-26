from pathlib import Path
out = Path(__file__).resolve().parent
old = (out.parent/'round-20/verify-independent.mjs').read_text(encoding='utf-8')
prefix = old[:old.index('try {\n  const formats=')]
prefix = prefix.replace('// Independent Round 20:', '// Round 21 harness adapted from Round 20:')
prefix = prefix.replace('// Run only in the isolated snapshot. The 94 R19 check IDs/assertions are retained; four INLINE fixtures use valid media.', '// Run only in the isolated snapshot. Reuses R20 helpers and valid media; 49 R21 checks follow. Run the original R20 suite separately for its 145 assertions.')
prefix = prefix.replace("'docs/audits/round-20'", "'docs/audits/round-21'")
prefix = prefix.replace("root.includes('mindx-round20-')", "root.includes('mindx-round21-')")
prefix = prefix.replace('mindx-r20-fixtures-', 'mindx-r21-fixtures-')
(out/'verify-independent.mjs').write_text(prefix+(out/'cases.mjs').read_text(encoding='utf-8'),encoding='utf-8')
