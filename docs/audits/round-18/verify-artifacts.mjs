import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const out = 'docs/audits/round-18';
const manifest = JSON.parse(fs.readFileSync(out + '/evidence-manifest.json', 'utf8'));
const bad = Object.entries(manifest.files).filter(([file, hash]) =>
  crypto.createHash('sha256').update(fs.readFileSync(path.join(out,file))).digest('hex') !== hash).map(([file]) => file);
const md = fs.readFileSync(out + '/REPORT.vi.md', 'utf8');
const missing = [...md.matchAll(/\]\(([^)]+)\)/g)].map(x => x[1]).filter(link => !fs.existsSync(path.join(out,link)));
console.log(JSON.stringify({ evidenceFiles: Object.keys(manifest.files).length, hashMismatches: bad, missingReportLinks: missing }));
process.exitCode = bad.length || missing.length ? 1 : 0;
