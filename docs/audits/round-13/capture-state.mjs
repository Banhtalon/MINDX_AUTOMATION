import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = 'docs/audits/round-13';
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const f = path.posix.join(dir, e.name);
    return e.isDirectory() ? walk(f) : [f];
  });
}
const files = [...walk('src'), ...walk('scripts'), ...walk('data/config'),
  'AGENTS.md', 'MINDX_AUTOMATION_PLAN.md', 'package.json', 'package-lock.json',
  'next-env.d.ts', 'tsconfig.json', 'docs/audits/round-12/verify-independent.mjs'];
const state = {
  capturedAt: new Date().toISOString(), node: process.version,
  head: process.argv[2],
  gitStatus: fs.readFileSync(`${dir}/git-status.before.txt`, 'utf8'),
  files: Object.fromEntries(files.filter(f => fs.existsSync(f)).sort().map(f => [f, digest(f)])),
};
fs.writeFileSync(`${dir}/source-state.json`, JSON.stringify(state, null, 2) + '\n');
for (const [from, to] of [
  ['next-env.d.ts', 'next-env.before.txt'],
  ['MINDX_AUTOMATION_PLAN.md', 'plan.before.md'],
  ['docs/audits/round-12/independent-results.json', 'round12-results.before.json'],
]) fs.copyFileSync(from, `${dir}/${to}`);
console.log(JSON.stringify({ head: state.head, files: Object.keys(state.files).length, node: state.node }));
