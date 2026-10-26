// Start only a temporary local production server. Never call auth/sync/AI/LMS writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
const dir = 'docs/audits/round-15';
const reservation = net.createServer();
await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const fd = fs.openSync(`${dir}/smoke-server.log`, 'wx');
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)],
  { stdio: ['ignore', fd, fd], windowsHide: true });
const summary = { startedAt: new Date().toISOString(), bind: '127.0.0.1', port, checks: [] };
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null) throw Error('Server exited before ready');
    try { const r = await fetch(base + '/api/queue/control', { signal: AbortSignal.timeout(1000) }); if (r.status === 200) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  assert(ready, 'Local server must be ready');
  for (const [route, marker] of [['/session-comments', 'Nhận xét Buổi học'], ['/homework-grader', 'Bảng điểm Báo cáo']]) {
    const res = await fetch(base + route, { signal: AbortSignal.timeout(3000) });
    const html = await res.text(); assert.equal(res.status, 200); assert(html.includes(marker));
    summary.checks.push({ route, status: res.status, expectedPageTextPresent: true });
  }
  for (const route of ['/api/auth/status', '/api/session-comments/list?classId=A', '/api/homework-grader/scores?classId=A']) {
    const res = await fetch(base + route, { headers: { origin: 'https://audit.invalid', 'sec-fetch-site': 'cross-site' }, signal: AbortSignal.timeout(3000) });
    assert.equal(res.status, 403); summary.checks.push({ route, hostileOriginStatus: res.status });
  }
  const post = await fetch(base + '/api/session-comments/save-draft', { method: 'POST',
    headers: { origin: 'https://audit.invalid', 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(3000) });
  assert.equal(post.status, 403); summary.checks.push({ route: '/api/session-comments/save-draft', hostilePostStatus: post.status });
  summary.passed = true;
} catch (error) { summary.passed = false; summary.error = error.stack; process.exitCode = 1; }
finally {
  child.kill(); await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('close', resolve); });
  fs.closeSync(fd); summary.finishedAt = new Date().toISOString(); summary.temporaryServerStopped = true;
  fs.writeFileSync(`${dir}/smoke-results.json`, JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
}
