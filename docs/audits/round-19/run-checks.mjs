import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

const root = process.cwd(), out = path.join(root, 'docs/audits/round-19');
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const f = path.join(dir, e.name);
  return e.isDirectory() ? walk(f) : [path.relative(root, f).replaceAll('\\', '/')];
});
const json = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
const mode = process.argv[2] || 'capture';
if (mode === 'capture') {
  if (fs.existsSync(path.join(out, 'source-state.json'))) throw Error('Existing audit: refusing to overwrite baseline');
  const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'scripts')), ...walk(path.join(root, 'data/config')),
    ...fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isFile() && !e.name.startsWith('.env')).map(e => e.name)];
  const protectedFiles = ['next-env.d.ts', ...[12,13,14,15,16,17,18].flatMap(n => walk(path.join(root, 'docs/audits/round-' + n)))];
  const digest = list => Object.fromEntries([...new Set(list)].sort().map(f => [f, hash(path.join(root, f))]));
  const snapshot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindx-round19-'));
  const state = { capturedAt: new Date().toISOString(), head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    node: process.version, platform: process.platform, snapshot, files: digest(files), protectedFiles: digest(protectedFiles) };
  state.sourceManifestSha256 = crypto.createHash('sha256').update(JSON.stringify(state.files)).digest('hex');
  json('source-state.json', state);
  fs.writeFileSync(path.join(out, 'git-status.before.txt'), execFileSync('git', ['status', '--short']));
  fs.copyFileSync(path.join(root, 'MINDX_AUTOMATION_PLAN.md'), path.join(out, 'plan.before.md'));
  for (const f of new Set([...files, ...protectedFiles, ...walk(out)])) {
    const target = path.join(snapshot, f); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(root, f), target);
  }
  console.log('Copy installed dependencies to ' + snapshot);
  fs.cpSync(path.join(root, 'node_modules'), path.join(snapshot, 'node_modules'), { recursive: true });
  const mismatches = [...new Set([...files, ...protectedFiles])].filter(f => hash(path.join(root, f)) !== hash(path.join(snapshot, f)));
  const excluded = ['.env', '.env.local', '.env.production', 'data/mindx_bot.db', 'playwright-auth', '.playwright-profile', 'temp_submissions'];
  json('snapshot-check.json', { snapshot, mismatches, excludedAbsent: Object.fromEntries(excluded.map(f => [f, !fs.existsSync(path.join(snapshot, f))])) });
  if (mismatches.length || excluded.some(f => fs.existsSync(path.join(snapshot, f)))) throw Error('Unsafe snapshot');
  console.log('Snapshot ready; root application/DB not executed.');
} else {
  const state = JSON.parse(fs.readFileSync(path.join(out, 'source-state.json'), 'utf8'));
  if (mode === 'final') {
    const changed = Object.entries(state.protectedFiles).filter(([f,h]) => !fs.existsSync(path.join(root,f)) || hash(path.join(root,f)) !== h).map(([f]) => f);
    const sourceChanged = Object.entries(state.files).filter(([f,h]) => !fs.existsSync(path.join(root,f)) || hash(path.join(root,f)) !== h).map(([f]) => f);
    const addedProtected = ['next-env.d.ts', ...[12,13,14,15,16,17,18].flatMap(n => walk(path.join(root, 'docs/audits/round-' + n)))].filter(f => !(f in state.protectedFiles));
    json('preservation-check.json', { checkedAt: new Date().toISOString(), checkedFiles: Object.keys(state.protectedFiles).length, changed, addedProtected,
      byteIdentical: !changed.length && !addedProtected.length, sourceChanged, allowedSourceChanges: ['MINDX_AUTOMATION_PLAN.md'] });
    fs.writeFileSync(path.join(out, 'git-status.after.txt'), execFileSync('git', ['status', '--short']));
    if (changed.length || addedProtected.length || sourceChanged.some(f => f !== 'MINDX_AUTOMATION_PLAN.md')) process.exitCode = 1;
  } else {
    const env = {};
    for (const k of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','ProgramFiles','ProgramFiles(x86)','ProgramData','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE']) if (process.env[k]) env[k] = process.env[k];
    Object.assign(env, { NEXT_TELEMETRY_DISABLED: '1', npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', NODE_OPTIONS: '--require=' + JSON.stringify(path.join(state.snapshot, 'docs/audits/round-19/network-guard.cjs')) });
    json('isolation.json', { snapshot: state.snapshot, environmentKeys: Object.keys(env), credentialsExcluded: true, dependencyCopy: true, npmOffline: true, nodeSocketGuard: true,
      limitation: 'Process-level Node guard, not an OS firewall. No browser is launched; Playwright and Gemini are replaced by test doubles.' });
    const commands = fs.existsSync(path.join(out, 'commands.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'commands.json'), 'utf8')) : [];
    const run = async (command, log, result) => {
      if (fs.existsSync(path.join(out, log))) {
        const base = path.basename(log, '.log'); let attempt = 2;
        while (fs.existsSync(path.join(out, base + '.attempt-' + attempt + '.log'))) attempt++;
        log = base + '.attempt-' + attempt + '.log';
      }
      const entry = { command, cwd: state.snapshot, startedAt: new Date().toISOString(), log };
      const fd = fs.openSync(path.join(out, log), 'wx');
      try {
        const child = spawn('cmd.exe', ['/d','/s','/c',command], { cwd: state.snapshot, env, stdio: ['ignore',fd,fd], windowsHide: true });
        entry.exitCode = await new Promise((resolve,reject) => { child.once('error',reject); child.once('close',(code,signal) => { entry.signal = signal; resolve(code); }); });
        if (result && fs.existsSync(path.join(state.snapshot,result))) fs.copyFileSync(path.join(state.snapshot,result), path.join(out, path.basename(log,'.log') + '-results.json'));
      } catch (e) { entry.exitCode = null; entry.error = e.stack; }
      finally { fs.closeSync(fd); entry.finishedAt = new Date().toISOString(); entry.logSha256 = hash(path.join(out,log)); commands.push(entry); json('commands.json',commands); console.log(JSON.stringify(entry)); }
    };
    if (mode === 'baseline') {
      await run('npx tsx scripts/test-phase5.ts', 'phase5.log');
      await run('npx tsx scripts/test-phase4-codex-repros.ts', 'phase4.log');
      for (const n of [12,13,16,17]) await run('node docs/audits/round-' + n + '/verify-independent.mjs', 'round' + n + '-independent.log', 'docs/audits/round-' + n + '/independent-results.json');
      await run('npx tsc --noEmit --incremental false', 'typecheck.log');
      await run('npm run build', 'build.log');
    } else if (mode === 'independent') {
      const script = 'docs/audits/round-19/verify-independent.mjs';
      fs.copyFileSync(path.join(root,script), path.join(state.snapshot,script));
      await run('node ' + script, 'round19-independent.log', 'docs/audits/round-19/independent-results.json');
    } else throw Error('Unknown mode');
    if (commands.some(c => c.exitCode !== 0)) process.exitCode = 1;
  }
}
