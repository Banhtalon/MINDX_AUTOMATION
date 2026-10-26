// Built app, real HTTP + Chromium; synthetic DB in isolated snapshot only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
const base = 'http://127.0.0.1:3016';
const dir = 'docs/audits/round-16';
const serverLog = fs.openSync(dir + '/smoke-server.log', 'w');
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3016'], { stdio: ['ignore', serverLog, serverLog], windowsHide: true });
let context, db;
const results = { generatedAt: new Date().toISOString(), externalRequests: [], pageErrors: [], observations: {} };
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(base + '/api/session-comments/list'); if (r.status === 200) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  assert(ready, 'Local isolated build must start');
  const classId = 'VT-C4K-GA38', sessionId = classId + '_SESS_01';
  db = new Database('data/mindx_bot.db');
  db.prepare('INSERT INTO classes_sessions (classId,className,sessionId,sessionNumber,topic,date) VALUES (?,?,?,?,?,?)').run(classId, 'Synthetic class', sessionId, 1, 'Synthetic lesson', '20/10/2026');
  db.prepare('INSERT INTO students (classId,studentId,fullName,isActive) VALUES (?,?,?,?)').run(classId, 'S1', 'Audit S1', 1);
  db.prepare('INSERT INTO session_feedbacks (classId,sessionId,studentId,attendanceStatus,teacherNote,finalText,status,versionMetaJson) VALUES (?,?,?,?,?,?,?,?)').run(classId, sessionId, 'S1', 'PRESENT', 'INITIAL NOTE', 'INITIAL COMMENT', 'DRAFT', JSON.stringify({ rowVer: 1, fields: {} }));
  context = await chromium.launchPersistentContext(path.resolve('playwright-auth'), { headless: true, viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(base + '/')) return route.continue();
    results.externalRequests.push(url); return route.abort();
  });
  const first = context.pages()[0] || await context.newPage(), second = await context.newPage();
  for (const page of [first, second]) {
    page.on('pageerror', e => results.pageErrors.push(e.message));
    await page.goto(base + '/session-comments');
    await page.getByPlaceholder('Ghi chú nhanh cho học sinh...').waitFor();
    assert.equal(await page.getByPlaceholder('Ghi chú nhanh cho học sinh...').inputValue(), 'INITIAL NOTE');
  }
  const saved1 = first.waitForResponse(r => r.url().includes('/save-draft') && r.request().method() === 'POST');
  await first.getByPlaceholder('Ghi chú nhanh cho học sinh...').fill('FIRST PAGE SAVED'); assert.equal((await saved1).status(), 200);
  const saved2 = second.waitForResponse(r => r.url().includes('/save-draft') && r.request().method() === 'POST');
  await second.getByPlaceholder('Ghi chú nhanh cho học sinh...').fill('SECOND PAGE USER EDIT');
  const response = await saved2, body = await response.json();
  const visible = await second.getByPlaceholder('Ghi chú nhanh cho học sinh...').inputValue();
  const stored = db.prepare('SELECT teacherNote FROM session_feedbacks WHERE studentId=?').get('S1').teacherNote;
  await second.screenshot({ path: dir + '/silent-conflict.png', fullPage: true });
  await second.reload(); await second.getByPlaceholder('Ghi chú nhanh cho học sinh...').waitFor();
  const reloaded = await second.getByPlaceholder('Ghi chú nhanh cho học sinh...').inputValue();
  results.observations.silentConflict = { status: response.status(), body, visible, stored, reloaded, reproduced: visible !== stored && reloaded === stored };
  assert.equal(results.observations.silentConflict.reproduced, true);
  const post = async (route, data) => {
    const r = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    return { status: r.status, body: await r.json() };
  };
  const common = { classId, sessionId, studentId: 'S1' };
  let ver = JSON.parse(db.prepare('SELECT versionMetaJson FROM session_feedbacks WHERE studentId=?').get('S1').versionMetaJson).rowVer;
  const fresh = await post('/api/session-comments/approve', { ...common, approvedText: 'INITIAL COMMENT', expectedRowVer: ver }); assert.equal(fresh.status, 200);
  const ai = await post('/api/session-comments/generate-ai', { session: { classId, classCode: classId, sessionId, sessionNumber: 1, topic: 'Synthetic' }, students: [{ studentId: 'S1', fullName: 'Audit S1', attendanceStatus: 'PRESENT', teacherNote: '', quickTags: [], expectedRowVer: 1 }] });
  const afterAi = db.prepare('SELECT finalText,status FROM session_feedbacks WHERE studentId=?').get('S1');
  results.observations.staleInsufficient = { status: ai.status, afterAi, reproduced: afterAi.status === 'INSUFFICIENT_INFO' && afterAi.finalText !== 'INITIAL COMMENT' };
  assert.equal(results.observations.staleInsufficient.reproduced, true);
  const hostile = await fetch(base + '/api/session-comments/list', { headers: { origin: 'https://hostile.invalid', 'sec-fetch-site': 'cross-site' } });
  assert.equal(hostile.status, 403); results.observations.hostileOriginBlocked = true;
  results.completed = true;
} catch (e) { results.completed = false; results.error = e.stack; process.exitCode = 1; }
finally {
  if (context) await context.close(); if (db) db.close();
  server.kill(); await new Promise(r => server.once('close', r)); fs.closeSync(serverLog);
  fs.writeFileSync(dir + '/smoke-results.json', JSON.stringify(results, null, 2) + '\n'); console.log(JSON.stringify(results));
}
