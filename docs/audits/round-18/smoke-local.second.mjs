// Real production app + HTTP + Chromium. Synthetic fixture in isolated snapshot only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
const base = 'http://127.0.0.1:3018', out = 'docs/audits/round-18';
assert(path.basename(process.cwd()).startsWith('mindx-round18-'), 'Snapshot only');
const fd = fs.openSync(out + '/smoke-server.log', 'w');
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3018'], {
  stdio: ['ignore', fd, fd], windowsHide: true, env: process.env,
});
let context, db;
const r = { generatedAt: new Date().toISOString(), externalRequests: [], pageErrors: [], observations: {} };
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { const resp = await fetch(base + '/api/session-comments/list'); if (resp.status === 200) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(ready, 'Isolated production app must start');
  const classId = 'VT-C4K-GA38', sessionId = classId + '_SESS_01';
  db = new Database('data/mindx_bot.db');
  // This class is owned by this synthetic harness. Allow a second audited attempt.
  db.prepare('DELETE FROM session_feedbacks WHERE classId=?').run(classId);
  db.prepare('DELETE FROM students WHERE classId=?').run(classId);
  db.prepare('DELETE FROM classes_sessions WHERE classId=?').run(classId);
  db.prepare('INSERT INTO classes_sessions (classId,className,sessionId,sessionNumber,topic,date) VALUES (?,?,?,?,?,?)').run(classId, 'Synthetic class', sessionId, 1, 'Synthetic lesson', '20/10/2026');
  db.prepare('INSERT INTO students (classId,studentId,fullName,isActive) VALUES (?,?,?,?)').run(classId, 'S1', 'Audit S1', 1);
  const preserved = { strengths: 'OLD STRENGTH', improvements: 'OLD IMPROVEMENT', actionPlan: 'OLD PLAN', finalText: 'TEACHER DRAFT TO PRESERVE' };
  db.prepare('INSERT INTO session_feedbacks (classId,sessionId,studentId,attendanceStatus,teacherNote,quickTagsJson,strengths,improvements,actionPlan,finalText,status,versionMetaJson) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(classId, sessionId, 'S1', 'PRESENT', '', '[]', preserved.strengths, preserved.improvements, preserved.actionPlan, preserved.finalText, 'DRAFT', JSON.stringify({ rowVer: 1, fields: {} }));
  const row = () => db.prepare('SELECT * FROM session_feedbacks WHERE classId=? AND sessionId=? AND studentId=?').get(classId, sessionId, 'S1');
  context = await chromium.launchPersistentContext(path.resolve('playwright-auth'), {
    headless: true, viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'],
    args: ['--disable-background-networking', '--disable-component-update', '--disable-sync'],
    serviceWorkers: 'block',
  });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (new URL(url).origin === base) return route.continue();
    r.externalRequests.push(url); return route.abort();
  });
  const first = context.pages()[0] || await context.newPage();
  context.on('page', page => page.on('pageerror', e => r.pageErrors.push(e.message)));
  first.on('pageerror', e => r.pageErrors.push(e.message));
  const editors = page => ({
    strengths: page.getByPlaceholder('Điểm mạnh trong buổi học...'),
    improvements: page.getByPlaceholder('Điểm cần cải thiện...'),
    actionPlan: page.getByPlaceholder('Bài tập dặn dò thêm...'),
  });
  const assertEditors = async (page, expected) => {
    const values = {};
    for (const [key, loc] of Object.entries(editors(page))) { await loc.waitFor(); values[key] = await loc.inputValue(); assert.equal(values[key], expected[key]); }
    return values;
  };
  const copy = async page => {
    await page.getByRole('button', { name: 'Copy nhận xét', exact: true }).click();
    await page.getByRole('button', { name: 'Đã copy!', exact: true }).waitFor();
    return page.evaluate(() => navigator.clipboard.readText());
  };
  const generate = async page => {
    const response = page.waitForResponse(x => x.url().endsWith('/generate-ai') && x.request().method() === 'POST');
    await page.getByRole('button', { name: 'AI Soạn Nhận Xét Hàng Loạt', exact: true }).click();
    const res = await response; assert.equal(res.status(), 200); return res.json();
  };
  const waitSave = page => page.waitForResponse(x => new URL(x.url()).pathname.endsWith('/save-draft') && x.request().method() === 'POST');
  await first.goto(base + '/session-comments');
  await assertEditors(first, preserved);
  const aiBody = await generate(first);
  const result = aiBody.data.find(x => x.studentId === 'S1');
  assert.equal(result.status, 'INSUFFICIENT_INFO');
  assert(result.errorMessage.includes('Chưa đủ thông tin'));
  const warning = first.getByText(result.errorMessage, { exact: true }); await warning.waitFor();
  const values = await assertEditors(first, preserved);
  const copied = await copy(first);
  for (const key of Object.keys(preserved)) assert.equal(row()[key], preserved[key]);
  assert.equal(result.formattedFullComment, preserved.finalText);
  for (const key of Object.keys(values)) assert.equal(result[key], preserved[key]);
  assert.equal(copied, row().finalText);
  r.observations.insufficientCopy = { pass: true, httpStatus: 200, returnedText: result.formattedFullComment,
    storedText: row().finalText, copiedText: copied, visibleEditors: values, separateWarning: result.errorMessage };
  await first.screenshot({ path: out + '/insufficient-copy.png', fullPage: true });
  await first.reload(); await assertEditors(first, preserved);
  await first.getByText(/Chưa đủ thông tin/, { exact: false }).first().waitFor();
  assert.equal(await copy(first), preserved.finalText);
  const editSave = waitSave(first);
  await editors(first).improvements.fill('TEACHER EDIT AFTER INSUFFICIENT');
  const editResponse = await editSave, editBody = await editResponse.json();
  assert.equal(editResponse.status(), 200); assert.equal(editBody.success, true); assert.notEqual(editBody.staleIgnored, true);
  assert.equal(row().improvements, 'TEACHER EDIT AFTER INSUFFICIENT'); assert.equal(row().status, 'DRAFT');
  await first.reload();
  await assertEditors(first, { ...preserved, improvements: 'TEACHER EDIT AFTER INSUFFICIENT' });
  assert.equal(await copy(first), row().finalText);
  r.observations.insufficientEditReload = { pass: true, improvements: row().improvements, finalText: row().finalText, status: row().status };

  // Reset only the fake fixture, before opening the two-tab conflict scenario.
  db.prepare("UPDATE session_feedbacks SET status='DRAFT',teacherNote='INITIAL NOTE',versionMetaJson=? WHERE classId=? AND sessionId=? AND studentId=?").run(JSON.stringify({ rowVer: 10, fields: {} }), classId, sessionId, 'S1');
  const second = await context.newPage();
  for (const page of [first, second]) { await page.goto(base + '/session-comments'); await page.getByPlaceholder('Ghi chú nhanh cho học sinh...').waitFor(); }
  const p1 = waitSave(first); await first.getByPlaceholder('Ghi chú nhanh cho học sinh...').fill('FIRST TAB SAVED'); assert.equal((await p1).status(), 200);
  const p2 = waitSave(second); await second.getByPlaceholder('Ghi chú nhanh cho học sinh...').fill('SECOND TAB UNSAVED'); const conflict = await (await p2).json();
  await second.getByText(/Xung đột phiên bản:.*Bản đã lưu: "FIRST TAB SAVED"/).waitFor();
  assert.equal(conflict.staleIgnored, true); assert.equal(await second.getByPlaceholder('Ghi chú nhanh cho học sinh...').inputValue(), 'SECOND TAB UNSAVED'); assert.equal(row().teacherNote, 'FIRST TAB SAVED');
  r.observations.noteConflict = { pass: true, staleIgnored: conflict.staleIgnored, storedNote: row().teacherNote, visibleNote: 'SECOND TAB UNSAVED' };
  const lists = await (await fetch(base + '/api/session-comments/list?classId=' + classId + '&sessionId=' + sessionId)).json();
  const [tag1, tag2] = lists.data.quickTags; assert(tag1 && tag2);
  for (const page of [first, second]) { await page.reload(); await page.getByPlaceholder('Ghi chú nhanh cho học sinh...').waitFor(); }
  const t1 = waitSave(first); await first.getByRole('button', { name: tag1.label, exact: true }).click(); const savedTag = await (await t1).json(); assert.equal(savedTag.success, true); assert.notEqual(savedTag.staleIgnored, true);
  const t2 = waitSave(second); await second.getByRole('button', { name: tag2.label, exact: true }).click(); const tagConflict = await (await t2).json();
  const tagWarning = second.getByText(/Xung đột phiên bản:/); await tagWarning.waitFor();
  await second.waitForFunction(label => Array.from(document.querySelectorAll('div')).some(e => e.textContent?.includes('Bản đã lưu: "' + label + '"')), tag1.label);
  const warningText = await tagWarning.innerText();
  assert.equal(tagConflict.staleIgnored, true); assert.deepEqual(JSON.parse(row().quickTagsJson), [tag1.label]);
  assert(warningText.includes('Bản đã lưu: "' + tag1.label + '"')); assert(!warningText.includes('Bản đã lưu: "PRESENT"'));
  assert((await second.getByRole('button', { name: tag2.label, exact: true }).getAttribute('class')).includes('bg-blue-600/30'));
  r.observations.tagConflict = { pass: true, staleIgnored: tagConflict.staleIgnored, storedTags: JSON.parse(row().quickTagsJson),
    visibleUnsavedTag: tag2.label, unsavedTagSelected: true, warningText };
  await second.screenshot({ path: out + '/tag-conflict.png', fullPage: true });
  await second.reload(); await second.getByPlaceholder('Ghi chú nhanh cho học sinh...').waitFor();
  assert((await second.getByRole('button', { name: tag1.label, exact: true }).getAttribute('class')).includes('bg-blue-600/30'));
  assert(!(await second.getByRole('button', { name: tag2.label, exact: true }).getAttribute('class')).includes('bg-blue-600/30'));
  r.observations.tagReload = { pass: true, selectedTag: tag1.label };
  const hostile = await fetch(base + '/api/session-comments/list', { headers: { origin: 'https://hostile.invalid', 'sec-fetch-site': 'cross-site' } });
  assert.equal(hostile.status, 403); r.observations.hostileOriginBlocked = { pass: true, status: hostile.status };
  assert.equal(r.pageErrors.length, 0); assert.equal(r.externalRequests.length, 0); r.completed = true;
} catch (e) { r.completed = false; r.error = e.stack; process.exitCode = 1; }
finally {
  if (context) await context.close(); if (db) db.close();
  if (server.exitCode === null) { const closed = new Promise(resolve => server.once('close', resolve)); server.kill(); await closed; }
  fs.closeSync(fd);
  fs.writeFileSync(out + '/smoke-results.json', JSON.stringify(r, null, 2) + '\n'); console.log(JSON.stringify(r));
}
