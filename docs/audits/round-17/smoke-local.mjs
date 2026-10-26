// Real built app + HTTP + Chromium. Run only in the isolated source snapshot.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
const base = 'http://127.0.0.1:3017', out = 'docs/audits/round-17';
const fd = fs.openSync(out + '/smoke-server.log', 'wx');
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
for (const k of ['TEACHING_PASSWORD', 'LMS_PASSWORD', 'GEMINI_API_KEY']) delete env[k];
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3017'], { stdio: ['ignore', fd, fd], windowsHide: true, env });
let context, db;
const r = { generatedAt: new Date().toISOString(), externalRequests: [], pageErrors: [], observations: {} };
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { const resp = await fetch(base + '/api/session-comments/list'); if (resp.status === 200) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(ready, 'Isolated production app must start');
  const classId = 'VT-C4K-GA38', sessionId = classId + '_SESS_01';
  db = new Database('data/mindx_bot.db');
  db.prepare('INSERT INTO classes_sessions (classId,className,sessionId,sessionNumber,topic,date) VALUES (?,?,?,?,?,?)').run(classId, 'Synthetic class', sessionId, 1, 'Synthetic lesson', '20/10/2026');
  db.prepare('INSERT INTO students (classId,studentId,fullName,isActive) VALUES (?,?,?,?)').run(classId, 'S1', 'Audit S1', 1);
  db.prepare('INSERT INTO session_feedbacks (classId,sessionId,studentId,attendanceStatus,teacherNote,quickTagsJson,strengths,improvements,actionPlan,finalText,status,versionMetaJson) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(classId, sessionId, 'S1', 'PRESENT', '', '[]', 'OLD STRENGTH', 'OLD IMPROVEMENT', 'OLD PLAN', 'TEACHER DRAFT TO PRESERVE', 'DRAFT', JSON.stringify({ rowVer: 1, fields: {} }));
  const row = () => db.prepare('SELECT * FROM session_feedbacks WHERE classId=? AND sessionId=? AND studentId=?').get(classId, sessionId, 'S1');
  context = await chromium.launchPersistentContext(path.resolve('playwright-auth'), { headless: true, viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(base + '/')) return route.continue();
    r.externalRequests.push(url); return route.abort();
  });
  const first = context.pages()[0] || await context.newPage();
  first.on('pageerror', e => r.pageErrors.push(e.message));
  await first.goto(base + '/session-comments');
  await first.getByPlaceholder('Điểm mạnh trong buổi học...').waitFor();
  assert.equal(await first.getByPlaceholder('Điểm mạnh trong buổi học...').inputValue(), 'OLD STRENGTH');
  const aiResponsePromise = first.waitForResponse(x => x.url().includes('/generate-ai'));
  await first.getByRole('button', { name: 'AI Soạn Nhận Xét Hàng Loạt', exact: true }).click();
  const aiResponse = await aiResponsePromise, aiBody = await aiResponse.json();
  await first.getByPlaceholder('Điểm mạnh trong buổi học...').waitFor({ state: 'hidden' });
  await first.getByRole('button', { name: 'Copy nhận xét', exact: true }).click();
  await first.getByRole('button', { name: 'Đã copy!', exact: true }).waitFor();
  const copied = await first.evaluate(() => navigator.clipboard.readText());
  r.observations.insufficientCopy = { status: aiResponse.status(), returnedText: aiBody.data[0].formattedFullComment, storedText: row().finalText, copiedText: copied, priorEditorHidden: true, reproduced: copied !== row().finalText && copied.includes('Chưa đủ thông tin') };
  assert(r.observations.insufficientCopy.reproduced, 'No-information copy mismatch must reproduce');
  await first.screenshot({ path: out + '/insufficient-copy.png', fullPage: true });
  // Restore only synthetic fixture to exercise two independently open pages.
  db.prepare("UPDATE session_feedbacks SET status='DRAFT',teacherNote='INITIAL NOTE',versionMetaJson=? WHERE classId=? AND sessionId=? AND studentId=?").run(JSON.stringify({ rowVer: 10, fields: {} }), classId, sessionId, 'S1');
  const second = await context.newPage(); second.on('pageerror', e => r.pageErrors.push(e.message));
  for (const page of [first, second]) { await page.goto(base + '/session-comments'); await page.getByPlaceholder('Ghi chú nhanh cho học sinh...').waitFor(); }
  const waitSave = page => page.waitForResponse(x => x.url().includes('/save-draft') && x.request().method() === 'POST');
  const p1 = waitSave(first); await first.getByPlaceholder('Ghi chú nhanh cho học sinh...').fill('FIRST TAB SAVED'); assert.equal((await p1).status(), 200);
  const p2 = waitSave(second); await second.getByPlaceholder('Ghi chú nhanh cho học sinh...').fill('SECOND TAB UNSAVED'); const conflict = await (await p2).json();
  await second.getByText(/Xung đột phiên bản:.*Bản đã lưu: "FIRST TAB SAVED"/).waitFor();
  r.observations.noteConflictFixed = { staleIgnored: conflict.staleIgnored, visibleNote: await second.getByPlaceholder('Ghi chú nhanh cho học sinh...').inputValue(), storedNote: row().teacherNote, warningShowsSavedNote: true };
  assert.equal(conflict.staleIgnored, true); assert.equal(r.observations.noteConflictFixed.visibleNote, 'SECOND TAB UNSAVED'); assert.equal(row().teacherNote, 'FIRST TAB SAVED');
  const lists = await (await fetch(base + '/api/session-comments/list?classId=' + classId + '&sessionId=' + sessionId)).json();
  const [tag1, tag2] = lists.data.quickTags;
  assert(tag1 && tag2);
  for (const page of [first, second]) { await page.reload(); await page.getByPlaceholder('Ghi chú nhanh cho học sinh...').waitFor(); }
  const t1 = waitSave(first); await first.getByRole('button', { name: tag1.label, exact: true }).click(); await t1;
  const t2 = waitSave(second); await second.getByRole('button', { name: tag2.label, exact: true }).click(); const tagConflict = await (await t2).json();
  await second.getByText(/Xung đột phiên bản:.*Bản đã lưu: "PRESENT"/).waitFor();
  r.observations.tagConflictWrongValue = { staleIgnored: tagConflict.staleIgnored, storedTags: row().quickTagsJson, actualStoredTag: tag1.label, unsavedTag: tag2.label, displayedStoredValue: 'PRESENT', reproduced: true };
  assert.equal(tagConflict.staleIgnored, true);
  await second.screenshot({ path: out + '/tag-conflict.png', fullPage: true });
  const hostile = await fetch(base + '/api/session-comments/list', { headers: { origin: 'https://hostile.invalid', 'sec-fetch-site': 'cross-site' } });
  assert.equal(hostile.status, 403); r.observations.hostileOriginBlocked = true;
  assert.equal(r.pageErrors.length, 0); assert.equal(r.externalRequests.length, 0); r.completed = true;
} catch (e) { r.completed = false; r.error = e.stack; process.exitCode = 1; }
finally {
  if (context) await context.close(); if (db) db.close();
  const closed = new Promise(resolve => server.once('close', resolve)); server.kill(); await closed; fs.closeSync(fd);
  fs.writeFileSync(out + '/smoke-results.json', JSON.stringify(r, null, 2) + '\n'); console.log(JSON.stringify(r));
}
