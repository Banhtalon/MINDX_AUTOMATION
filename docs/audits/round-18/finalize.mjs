import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const out = 'docs/audits/round-18';
const state = JSON.parse(fs.readFileSync(out + '/source-state.json', 'utf8'));
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name).replaceAll('\\','/')]);
const json = (n, v) => fs.writeFileSync(out + '/' + n, JSON.stringify(v, null, 2) + '\n');
const currentProtected = ['next-env.d.ts', ...[12,13,14,15,16,17].flatMap(n => walk('docs/audits/round-' + n))].sort();
const originalProtected = Object.keys(state.protectedFiles).sort();
const changed = originalProtected.filter(f => !fs.existsSync(f) || hash(f) !== state.protectedFiles[f]);
const added = currentProtected.filter(f => !originalProtected.includes(f));
const removed = originalProtected.filter(f => !currentProtected.includes(f));
const currentProduct = ['src','scripts','data/config'].flatMap(walk).sort();
const initialProduct = Object.keys(state.files).filter(f => /^(src\/|scripts\/|data\/config\/)/.test(f)).sort();
const productAdded = currentProduct.filter(f => !initialProduct.includes(f));
const productRemoved = initialProduct.filter(f => !currentProduct.includes(f));
const sourceChanges = Object.keys(state.files).filter(f => !fs.existsSync(f) || hash(f) !== state.files[f]);
const unexpectedChanges = sourceChanges.filter(f => f !== 'MINDX_AUTOMATION_PLAN.md');
const preservation = { checkedAt: new Date().toISOString(), checkedFiles: originalProtected.length, changed, added, removed,
  byteIdentical: !changed.length && !added.length && !removed.length };
json('preservation-check.json', preservation);
let diff;
try { diff = execFileSync('git', ['diff','--no-index','--',out + '/plan.before.md','MINDX_AUTOMATION_PLAN.md'], { encoding: 'utf8' }); }
catch (e) { if (e.status !== 1) throw e; diff = e.stdout; }
fs.writeFileSync(out + '/plan.audit.diff', diff);
fs.writeFileSync(out + '/git-status.after.txt', execFileSync('git',['status','--short']));
const commands = JSON.parse(fs.readFileSync(out + '/commands.json', 'utf8'));
const logs = commands.map(c => ({ log: c.log, expected: c.logSha256, actual: hash(out + '/' + c.log) }));
const logsMatch = logs.every(x => x.expected === x.actual);
const smoke = JSON.parse(fs.readFileSync(out + '/smoke-results.json','utf8'));
const gatePassed = commands.slice(0,7).every(c => c.exitCode === 0) && commands.at(-1).exitCode === 0 && smoke.completed;
const finalState = { checkedAt: new Date().toISOString(), sourceManifestSha256: state.sourceManifestSha256,
  preservation, sourceChanges, unexpectedChanges, productFilesChecked: initialProduct.length, productAdded, productRemoved,
  onlyPlanChangedAmongCapturedSourceFiles: sourceChanges.length === 1 && sourceChanges[0] === 'MINDX_AUTOMATION_PLAN.md',
  planSha256: hash('MINDX_AUTOMATION_PLAN.md'), reportSha256: hash(out + '/REPORT.vi.md'),
  commandLogHashesMatch: logsMatch, gatePassed, smokeAttempts: commands.filter(c => c.command.endsWith('/smoke-local.mjs')).map(c => ({ log:c.log,exitCode:c.exitCode })),
  verdict: 'GO_SOURCE_ONLY_PHASE5' };
json('final-state.json', finalState);
const evidence = Object.fromEntries(walk(out).filter(f => !f.endsWith('/evidence-manifest.json')).sort().map(f => [path.relative(out,f).replaceAll('\\','/'),hash(f)]));
json('evidence-manifest.json', { generatedAt: new Date().toISOString(), files: evidence });
console.log(JSON.stringify(finalState, null, 2));
if (!preservation.byteIdentical || unexpectedChanges.length || productAdded.length || productRemoved.length || !logsMatch || !gatePassed) process.exitCode = 1;
