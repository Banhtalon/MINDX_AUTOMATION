import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const out = 'docs/audits/round-17';
const s = JSON.parse(fs.readFileSync(out + '/source-state.json', 'utf8'));
const prior = JSON.parse(fs.readFileSync('docs/audits/round-16/source-state.json', 'utf8'));
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const bundleFiles = walk(path.join(s.snapshot, '.next/static')).filter(f => f.endsWith('.js'));
const sensitiveNames = /TEACHING_PASSWORD|LMS_PASSWORD|MINDX_PASSWORD|GEMINI_API_KEY/;
const hitFiles = bundleFiles.filter(f => sensitiveNames.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(s.snapshot, f));
const packages = ['next','typescript','tsx','playwright','better-sqlite3','react','xlsx'];
const versions = Object.fromEntries(packages.map(p => {
  const local = JSON.parse(fs.readFileSync('node_modules/' + p + '/package.json', 'utf8'));
  const copied = JSON.parse(fs.readFileSync(path.join(s.snapshot, 'node_modules', p, 'package.json'), 'utf8'));
  return [p, { original: local.version, isolated: copied.version, manifestIdentical: hash('node_modules/' + p + '/package.json') === hash(path.join(s.snapshot, 'node_modules', p, 'package.json')) }];
}));
const value = { generatedAt: new Date().toISOString(), sourceFiles: Object.keys(s.files).length, protectedFiles: Object.keys(s.protectedFiles).length,
  changedSinceRound16: Object.keys(s.files).filter(f => prior.files[f] !== s.files[f]), versions,
  browserBundleScan: { checkedFiles: bundleFiles.length, variableNames: sensitiveNames.source, hitFiles, limitation: 'Only known sensitive variable names were checked; no real credentials copied or loaded.' },
  historicalReportsUsedAsIndexOnly: true, newCommandResultsRequiredForVerdict: true };
fs.writeFileSync(out + '/review-scope.json', JSON.stringify(value, null, 2) + '\n');
console.log(JSON.stringify(value, null, 2));
