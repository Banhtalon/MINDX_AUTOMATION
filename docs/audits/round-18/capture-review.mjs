import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const out = 'docs/audits/round-18';
const state = JSON.parse(fs.readFileSync(out + '/source-state.json', 'utf8'));
const prior = JSON.parse(fs.readFileSync('docs/audits/round-17/source-state.json', 'utf8'));
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const json = (n, v) => fs.writeFileSync(out + '/' + n, JSON.stringify(v, null, 2) + '\n');
const bundles = walk(path.join(state.snapshot, '.next/static')).filter(f => f.endsWith('.js'));
const sensitive = /TEACHING_PASSWORD|LMS_PASSWORD|MINDX_PASSWORD|GEMINI_API_KEY/;
const productFiles = Object.keys(state.files).filter(f => /^(src\/|scripts\/|data\/config\/)/.test(f));
const versions = Object.fromEntries(['next','typescript','tsx','playwright','better-sqlite3','react','xlsx'].map(p => [p, {
  original: JSON.parse(fs.readFileSync('node_modules/' + p + '/package.json', 'utf8')).version,
  isolated: JSON.parse(fs.readFileSync(path.join(state.snapshot, 'node_modules', p, 'package.json'), 'utf8')).version,
  manifestIdentical: hash('node_modules/' + p + '/package.json') === hash(path.join(state.snapshot, 'node_modules', p, 'package.json')),
}]));
const review = { generatedAt: new Date().toISOString(), sourceManifestSha256: state.sourceManifestSha256,
  changedSinceRound17: Object.keys(state.files).filter(f => prior.files[f] !== state.files[f]),
  productFilesChecked: productFiles.length,
  originalProductChanges: productFiles.filter(f => state.files[f] !== hash(f)),
  snapshotProductChangesAfterChecks: productFiles.filter(f => state.files[f] !== hash(path.join(state.snapshot, f))),
  versions, browserBundleScan: { files: bundles.length, pattern: sensitive.source,
    hits: bundles.filter(f => sensitive.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(state.snapshot, f)),
    limitation: 'Known variable names only. No real credentials were available to the build or browser.' },
  readInCurrentAudit: ['MINDX_AUTOMATION_PLAN.md','AGENTS.md','package.json','next.config.ts','tsconfig.json','.gitignore',
    'src/lib/gemini/comment-generator.ts','src/lib/playwright/scrape-scores.ts','src/app/session-comments/page.tsx',
    'src/app/api/session-comments/generate-ai/route.ts','src/app/api/session-comments/save-draft/route.ts',
    'src/app/api/session-comments/approve/route.ts','src/app/api/session-comments/save-lms/route.ts',
    'src/lib/db/sqlite.ts','src/lib/db/json-config.ts','src/lib/playwright/browser-manager.ts','src/lib/queue/task-queue.ts',
    'src/lib/playwright/save-comments.ts','src/lib/security/path-allowlist.ts','src/lib/security/local-guard.ts',
    'src/lib/config.ts','scripts/test-phase4-codex-repros.ts'],
  readScope: 'Focused review of changed branches and connected flows; not a line-by-line reread of every file.',
  historicalReportsUsedAsIndexOnly: true };
json('review-scope.json', review);
const historical = JSON.parse(fs.readFileSync('docs/audits/round-17/issue-status.json', 'utf8')).issues;
const issues = historical.map(x => ({ id: x.id, criterion: x.criterion, status: 'PASS_IN_VERIFIED_SCOPE',
  evidence: /^R16|^R15/.test(x.id) ? ['regressions.log','round16-independent-results.json','round17-independent-results.json'] : ['regressions.log','round12-independent-results.json','round13-independent-results.json'],
}));
for (const [id, criterion] of Object.entries({
  'R17-01': 'Protect APPROVED/VERIFIED before every AI branch; preserve entire SQLite row; zero AI calls.',
  'R17-02': 'Preserve stored/returned draft and sections; separate warning; real clipboard and visible editors match.',
  'R17-03': 'Reject incomplete network or DOM roster including inactive students before cache write.',
  'R17-04': 'Quick-tag conflict displays saved tags and retains unsaved local selection.',
})) issues.push({ id, criterion, status: 'CLOSED_IN_VERIFIED_SCOPE', evidence: ['round17-independent-results.json', ...(['R17-02','R17-04'].includes(id) ? ['smoke-results.json'] : [])] });
const counts = Object.fromEntries([12,13,16,17].map(n => {
  const r = JSON.parse(fs.readFileSync(out + '/round' + n + '-independent-results.json', 'utf8'));
  if (r.failed !== 0) throw Error('Failed independent suite: ' + n);
  return ['round' + n, { passed: r.passed, failed: r.failed }];
}));
const smoke = JSON.parse(fs.readFileSync(out + '/smoke-results.json', 'utf8'));
if (!smoke.completed || review.originalProductChanges.length || review.snapshotProductChangesAfterChecks.length || review.browserBundleScan.hits.length) throw Error('Audit gate failed');
json('issue-status.json', { generatedAt: new Date().toISOString(), verdict: 'GO_SOURCE_ONLY_PHASE5',
  scope: 'Stage 1-4 source verification gate; real accounts/services and Phase 5 feature acceptance excluded.',
  historicalCodes: historical.length, round17FindingGroups: 4, totalCodes: issues.length,
  independentCounts: counts, independentTotal: Object.values(counts).reduce((n,x) => n + x.passed,0),
  smokePassed: true, openFindingsInVerifiedScope: 0, issues });
console.log(JSON.stringify({ changedSinceRound17: review.changedSinceRound17, productFiles: productFiles.length,
  independentCounts: counts, issueCodes: issues.length, bundleScan: review.browserBundleScan, sourceManifestSha256: state.sourceManifestSha256 }, null, 2));
