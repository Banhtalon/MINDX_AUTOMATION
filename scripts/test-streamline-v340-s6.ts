import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { chromium } from "playwright";
import * as esbuild from "esbuild";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v340-s6-"));
const testDbPath = path.join(tmpRoot, "mindx_s6.sqlite");
const testRunningClassesPath = path.join(tmpRoot, "running-classes.json");

process.env.ALLOWED_LOCAL_DIRS = tmpRoot;
process.env.MINDX_DB_PATH = testDbPath;
process.env.MINDX_RUNNING_CLASSES_PATH = testRunningClassesPath;

import {
  getSpckVerifiedTeachingProgressSuggestion,
  mapSessionToTeachingProgressMilestone,
} from "../src/lib/teaching/session-progress-mapper";
import {
  buildClassTodayTodoCard,
  getDashboardTodayTodoCards,
} from "../src/lib/dashboard/today-tasks";
import { getDb, classSessionRepo, spckSessionRepo } from "../src/lib/db/sqlite";
import { buildEnrichedClassSpckRecords } from "../src/app/api/spck/list/route";
import { queryClassDirectory } from "../src/lib/classes/class-directory";
import { enrichClassSessionsWithScheduleDates } from "../src/lib/playwright/sync-class";
import {
  GET as getTeachingProjectRoute,
  POST as postTeachingProjectRoute,
} from "../src/app/api/teaching-projects/route";
import { TeachingProjectService } from "../src/lib/playwright/teaching-project-service";

async function runTests() {
  console.log("==========================================================");
  console.log("🚀 BẮT ĐẦU KIỂM THỬ GIAI ĐOẠN S6 (MÀN 5 + LIÊN THÔNG CÁC MÀN)");
  console.log("==========================================================\n");

  // =========================================================================
  // [S6-T1] S6.1 & S6.2: Session-to-Progress Milestone Mapping & Verified Guard
  // =========================================================================
  console.log(
    "[S6-T1] Kiểm tra ánh xạ Buổi học -> % Tiến độ Teaching (S6.1) & điều kiện VERIFIED (S6.2)..."
  );
  {
    for (const s of [0, 1, 4, 5, 8, 9, 10]) {
      const m = mapSessionToTeachingProgressMilestone(s);
      assert.equal(m.milestoneTaskCount, 0, `Session ${s} must map to 0 tasks`);
      assert.equal(m.targetPercent, 0, `Session ${s} must map to 0%`);
    }

    const m11 = mapSessionToTeachingProgressMilestone(11);
    assert.equal(m11.milestoneTaskCount, 1);
    assert.equal(m11.targetPercent, 20);
    assert.match(m11.buttonLabel, /Buổi 11 → 20%/);

    const m12 = mapSessionToTeachingProgressMilestone(12);
    assert.equal(m12.milestoneTaskCount, 3);
    assert.equal(m12.targetPercent, 60);
    assert.match(m12.buttonLabel, /Buổi 12 → 60%/);

    const m13 = mapSessionToTeachingProgressMilestone(13);
    assert.equal(m13.milestoneTaskCount, 4);
    assert.equal(m13.targetPercent, 80);
    assert.match(m13.buttonLabel, /Buổi 13 → 80%/);

    const m14 = mapSessionToTeachingProgressMilestone(14);
    assert.equal(m14.milestoneTaskCount, 5);
    assert.equal(m14.targetPercent, 100);
    assert.match(m14.buttonLabel, /Buổi 14 → 100%/);

    // Suggestion guard: must NOT show when verifiedCount === 0, pendingOrFailedCount > 0, or session < 12
    assert.equal(
      getSpckVerifiedTeachingProgressSuggestion({
        sessionNumber: 12,
        verifiedCount: 0,
      }).shouldShow,
      false,
      "Must not show suggestion when verifiedCount is 0"
    );
    assert.equal(
      getSpckVerifiedTeachingProgressSuggestion({
        sessionNumber: 11,
        verifiedCount: 5,
      }).shouldShow,
      false,
      "Must not show SPCK suggestion on Session 11"
    );
    assert.equal(
      getSpckVerifiedTeachingProgressSuggestion({
        sessionNumber: 12,
        verifiedCount: 2,
        pendingOrFailedCount: 1,
      }).shouldShow,
      false,
      "Must not show SPCK suggestion when batch still has pending/failed rows"
    );

    const sug12 = getSpckVerifiedTeachingProgressSuggestion({
      sessionNumber: 12,
      verifiedCount: 2,
      pendingOrFailedCount: 0,
    });
    assert.equal(sug12.shouldShow, true);
    assert.equal(sug12.targetPercent, 60);
    assert.equal(sug12.milestoneTaskCount, 3);

    const sug13 = getSpckVerifiedTeachingProgressSuggestion({
      sessionNumber: 13,
      verifiedCount: 3,
    });
    assert.equal(sug13.shouldShow, true);
    assert.equal(sug13.targetPercent, 80);
    assert.equal(sug13.milestoneTaskCount, 4);

    const sug14 = getSpckVerifiedTeachingProgressSuggestion({
      sessionNumber: 14,
      verifiedCount: 4,
    });
    assert.equal(sug14.shouldShow, true);
    assert.equal(sug14.targetPercent, 100);
    assert.equal(sug14.milestoneTaskCount, 5);

    // Point 1 regression: must NOT show whole-class suggestion if verifiedCount < totalRosterCount
    const sugPartialRoster = getSpckVerifiedTeachingProgressSuggestion({
      sessionNumber: 14,
      verifiedCount: 1,
      pendingOrFailedCount: 0,
      totalRosterCount: 2,
    });
    assert.equal(
      sugPartialRoster.shouldShow,
      false,
      "Point 1: Must not suggest whole-class 100% update when only 1/2 roster students verified SPCK"
    );

    console.log("  -> PASS [S6-T1]: Ánh xạ buổi học -> % và điều kiện VERIFIED chính xác.\n");
  }

  // =========================================================================
  // [S6-T2] S6.4: Dashboard Smart "Việc cần làm hôm nay" Cards & DB Hydration
  // =========================================================================
  console.log(
    "[S6-T2] Kiểm tra thẻ 'Việc cần làm hôm nay' trên Trang chủ cho Buổi 1, 5, 7, 11, 12, 14..."
  );
  {
    const cardS1 = buildClassTodayTodoCard({
      classId: "VT-C4K-JSB01",
      currentSessionNumber: 1,
      sessionCommentVerified: false,
    });
    assert.equal(cardS1.summaryText, "Nhận xét buổi 1 (chưa đẩy LMS)");
    assert.equal(cardS1.allDone, false);
    assert.equal(
      cardS1.primaryHref,
      "/session-comments?classId=VT-C4K-JSB01&sessionNumber=1"
    );

    const cardS7Done = buildClassTodayTodoCard({
      classId: "VT-C4K-JSB07",
      currentSessionNumber: 7,
      sessionCommentVerified: true,
    });
    assert.equal(cardS7Done.summaryText, "Nhận xét buổi 7 (đã đẩy LMS ✓)");
    assert.equal(cardS7Done.allDone, true);

    // Session 5 Coding Checkpoint
    const cardS5Cp = buildClassTodayTodoCard({
      classId: "VT-C4K-JSB05",
      currentSessionNumber: 5,
      sessionCommentVerified: true,
      reportCardVerified: false,
    });
    assert.equal(cardS5Cp.isCheckpoint, true);
    assert.equal(cardS5Cp.steps.length, 2);
    assert.equal(cardS5Cp.steps[0].isDone, true);
    assert.equal(cardS5Cp.steps[1].isDone, false);
    assert.equal(
      cardS5Cp.primaryHref,
      "/homework-grader?classId=VT-C4K-JSB05",
      "Once Checkpoint comment is done, primaryHref must point to Report Card"
    );

    // Session 11: Open project + 20%
    const cardS11 = buildClassTodayTodoCard({
      classId: "VT-C4K-JSB11",
      currentSessionNumber: 11,
      sessionCommentVerified: true,
      teachingProgressPercent: 20,
    });
    assert.equal(cardS11.steps.length, 2);
    assert.equal(cardS11.allDone, true);

    // Session 12: Comment + SPCK + 60%
    const cardS12 = buildClassTodayTodoCard({
      classId: "VT-C4K-JSB12",
      currentSessionNumber: 12,
      sessionCommentVerified: true,
      spckSessionVerified: { 12: false },
      teachingProgressPercent: 20,
    });
    assert.equal(cardS12.steps.length, 3);
    assert.equal(
      cardS12.primaryHref,
      "/final-project?classId=VT-C4K-JSB12&sessionNumber=12",
      "When Session 12 comment is done but SPCK is not, primaryHref must open FinalProject Session 12"
    );

    // Session 14: 4-step workflow
    const cardS14 = buildClassTodayTodoCard({
      classId: "VT-C4K-JSB14",
      currentSessionNumber: 14,
      spckSessionVerified: { 14: true },
      session14EvalVerified: true,
      reportCardVerified: false,
      teachingProgressPercent: 80,
    });
    assert.equal(
      cardS14.summaryText,
      "① Nộp SPCK ② Đánh giá ③ Phiếu điểm ④ Tiến độ 100%"
    );
    assert.equal(cardS14.steps.length, 4);
    assert.equal(cardS14.steps[0].isDone, true);
    assert.equal(cardS14.steps[1].isDone, true);
    assert.equal(cardS14.steps[2].isDone, false);
    assert.equal(cardS14.steps[3].isDone, false);
    assert.equal(
      cardS14.primaryHref,
      "/homework-grader?classId=VT-C4K-JSB14",
      "When Session 14 SPCK and Eval are done, primaryHref must advance to step 3 (Report Card)"
    );

    // Seed isolated DB & running-classes.json to verify getDashboardTodayTodoCards
    fs.writeFileSync(
      testRunningClassesPath,
      JSON.stringify(
        [
          {
            classCode: "VT-C4K-JSB01",
            className: "JSB 01",
            currentSessionNumber: 1,
            status: "Active",
          },
          {
            classCode: "VT-C4K-JSB05",
            className: "JSB 05",
            currentSessionNumber: 5,
            status: "Active",
          },
          {
            classCode: "VT-C4K-JSB12",
            className: "JSB 12",
            currentSessionNumber: 12,
            status: "Active",
          },
          {
            classCode: "VT-C4K-JSB14",
            className: "JSB 14",
            currentSessionNumber: 14,
            status: "Active",
          },
        ],
        null,
        2
      ),
      "utf8"
    );

    const db = getDb();

    // Seed classes_sessions for all 4 classes + partial feedback (1 VERIFIED + 1 DRAFT) on VT-C4K-JSB01
    const insertSessStmt = db.prepare(
      `INSERT INTO classes_sessions (classId, className, sessionId, sessionNumber, date)
       VALUES (?, ?, ?, ?, ?)`
    );
    insertSessStmt.run("VT-C4K-JSB01", "JSB 01", "VT-C4K-JSB01_SESS_1", 1, "2026-10-30");
    insertSessStmt.run("VT-C4K-JSB05", "JSB 05", "VT-C4K-JSB05_SESS_5", 5, "2026-10-30");
    insertSessStmt.run("VT-C4K-JSB12", "JSB 12", "VT-C4K-JSB12_SESS_12", 12, "2026-10-30");
    insertSessStmt.run("VT-C4K-JSB14", "JSB 14", "VT-C4K-JSB14_SESS_14", 14, "2026-10-30");
    db.prepare(
      `INSERT INTO session_feedbacks (classId, sessionId, studentId, status)
       VALUES (?, ?, ?, ?), (?, ?, ?, ?)`
    ).run(
      "VT-C4K-JSB01",
      "VT-C4K-JSB01_SESS_1",
      "STU_1",
      "VERIFIED",
      "VT-C4K-JSB01",
      "VT-C4K-JSB01_SESS_1",
      "STU_2",
      "DRAFT"
    );

    const dbCardsInitial = getDashboardTodayTodoCards({ limit: 10 });
    assert.equal(dbCardsInitial.length, 4);
    const dbCard01Partial = dbCardsInitial.find((c) => c.classId === "VT-C4K-JSB01")!;
    assert.equal(
      dbCard01Partial.allDone,
      false,
      "Partial feedback (1 VERIFIED + 1 DRAFT) must not mark session comment as done"
    );

    // Update second student to VERIFIED -> now VT-C4K-JSB01 is done
    db.prepare(
      `UPDATE session_feedbacks SET status = 'VERIFIED' WHERE classId = 'VT-C4K-JSB01'`
    ).run();
    const dbCardsAfter = getDashboardTodayTodoCards({ limit: 10 });
    const dbCard01Done = dbCardsAfter.find((c) => c.classId === "VT-C4K-JSB01")!;
    assert.equal(dbCard01Done.allDone, true);

    const dbCard05 = dbCardsAfter.find((c) => c.classId === "VT-C4K-JSB05")!;
    assert.equal(dbCard05.isCheckpoint, true);

    const dbCard12 = dbCardsAfter.find((c) => c.classId === "VT-C4K-JSB12")!;
    assert.equal(dbCard12.currentSessionNumber, 12);
    assert.equal(dbCard12.steps.length, 3);

    const dbCard14 = dbCardsAfter.find((c) => c.classId === "VT-C4K-JSB14")!;
    assert.equal(
      dbCard14.summaryText,
      "① Nộp SPCK ② Đánh giá ③ Phiếu điểm ④ Tiến độ 100%"
    );

    // S6-04 regressions: active students in `students` table must all be VERIFIED (excluding ABSENT for session comments)
    db.prepare(
      `INSERT INTO students (classId, studentId, fullName, isActive)
       VALUES ('VT-C4K-JSB01', 'STU_1', 'Học viên 1', 1),
              ('VT-C4K-JSB01', 'STU_2', 'Học viên 2', 1),
              ('VT-C4K-JSB01', 'STU_3', 'Học viên 3', 1)`
    ).run();
    const cardsMissingThird = getDashboardTodayTodoCards({ limit: 10 });
    assert.equal(
      cardsMissingThird.find((c) => c.classId === "VT-C4K-JSB01")!.allDone,
      false,
      "S6-04: Missing feedback row for active student STU_3 must keep allDone=false"
    );
    db.prepare(
      `INSERT INTO session_feedbacks (classId, sessionId, studentId, status, attendanceStatus)
       VALUES ('VT-C4K-JSB01', 'VT-C4K-JSB01_SESS_1', 'STU_3', 'DRAFT', 'ABSENT')`
    ).run();
    const cardsAbsentThird = getDashboardTodayTodoCards({ limit: 10 });
    assert.equal(
      cardsAbsentThird.find((c) => c.classId === "VT-C4K-JSB01")!.allDone,
      true,
      "S6-04: ABSENT student with DRAFT row must not block sessionCommentVerified"
    );

    // S6-04 Round 2 regression: inactive student (`isActive = 0`) with old PRESENT DRAFT/FAILED rows must not block active roster completion
    db.prepare(
      `INSERT INTO students (classId, studentId, fullName, isActive)
       VALUES ('VT-C4K-JSB01', 'STU_INACTIVE', 'Học viên nghỉ học', 0),
              ('VT-C4K-JSB12', 'STU_1', 'Học viên 1', 1),
              ('VT-C4K-JSB12', 'STU_INACTIVE', 'Học viên nghỉ học', 0),
              ('VT-C4K-JSB14', 'STU_1', 'Học viên 1', 1),
              ('VT-C4K-JSB14', 'STU_INACTIVE', 'Học viên nghỉ học', 0)`
    ).run();
    db.prepare(
      `INSERT INTO session_feedbacks (classId, sessionId, studentId, status, attendanceStatus)
       VALUES ('VT-C4K-JSB01', 'VT-C4K-JSB01_SESS_1', 'STU_INACTIVE', 'DRAFT', 'PRESENT')`
    ).run();
    db.prepare(
      `INSERT INTO spck_session_submissions (classId, studentId, sessionNumber, draftStatus)
       VALUES ('VT-C4K-JSB12', 'STU_1', 12, 'VERIFIED'),
              ('VT-C4K-JSB12', 'STU_INACTIVE', 12, 'FAILED')`
    ).run();
    db.prepare(
      `INSERT INTO spck_session14_evaluations (classId, studentId, status)
       VALUES ('VT-C4K-JSB14', 'STU_1', 'VERIFIED'),
              ('VT-C4K-JSB14', 'STU_INACTIVE', 'DRAFT')`
    ).run();
    const cardsWithInactive = getDashboardTodayTodoCards({ limit: 10 });
    assert.equal(
      cardsWithInactive.find((c) => c.classId === "VT-C4K-JSB01")!.allDone,
      true,
      "S6-04 (R2-DB12): Inactive student with PRESENT DRAFT feedback must not block active roster"
    );
    assert.equal(
      cardsWithInactive.find((c) => c.classId === "VT-C4K-JSB12")!.steps[1].isDone,
      true,
      "S6-04 (R2-DB13): Inactive student with FAILED SPCK submission must not block active roster"
    );
    assert.equal(
      cardsWithInactive.find((c) => c.classId === "VT-C4K-JSB14")!.steps[1].isDone,
      true,
      "S6-04 (R2-DB14): Inactive student with DRAFT Session 14 evaluation must not block active roster"
    );

    // S6-05 regression: 99.9% weighted average must floor to 99% (not round to 100%)
    const tasks99 = [1, 2, 3, 4, 5].map((n) => ({
      slotIndex: n,
      taskId: 100 + n,
      taskName: `Việc ${n}`,
      weightPercent: 20,
      assignedStudentIds: [1, 2],
    }));
    const prog99 = Object.fromEntries(
      tasks99.flatMap((t) => [1, 2].map((s) => [`${t.taskId}_${s}`, 100]))
    );
    prog99["105_2"] = 99;
    db.prepare(
      `INSERT INTO teaching_final_projects (classId, tasksJson, progressJson, status)
       VALUES ('VT-C4K-JSB14', ?, ?, 'VERIFIED')`
    ).run(JSON.stringify(tasks99), JSON.stringify(prog99));
    const cards99 = getDashboardTodayTodoCards({ limit: 10 });
    assert.equal(
      cards99.find((c) => c.classId === "VT-C4K-JSB14")!.steps[3].isDone,
      false,
      "S6-05: 99.9% weighted average must not mark 100% progress step as done"
    );

    // Point 3 regression: Report Card verified at T1 becomes stale when Session 14 evaluation is modified at T2 > T1
    db.prepare(
      `INSERT INTO class_report_cards (classId, classCode, status, teachingSyncStatus, lmsSnapshotJson, teachingSyncedAt, updatedAt)
       VALUES ('VT-C4K-JSB14', 'VT-C4K-JSB14', 'VERIFIED', 'VERIFIED', ?, '2026-10-30 10:00:00', '2026-10-30 10:00:00')`
    ).run(JSON.stringify({ scrapedAt: "2026-10-30T10:00:00.000Z" }));
    db.prepare(
      `UPDATE spck_session14_evaluations SET updatedAt = '2026-10-30T09:00:00.000Z' WHERE classId = 'VT-C4K-JSB14'`
    ).run();
    const cardsRcFresh = getDashboardTodayTodoCards({ limit: 10 });
    assert.equal(
      cardsRcFresh.find((c) => c.classId === "VT-C4K-JSB14")!.steps[2].isDone,
      true,
      "Point 3: Fresh VERIFIED report card must mark step 3 as done"
    );
    db.prepare(
      `UPDATE spck_session14_evaluations SET updatedAt = '2026-10-30T12:00:00.000Z' WHERE classId = 'VT-C4K-JSB14'`
    ).run();
    const cardsRcStale = getDashboardTodayTodoCards({ limit: 10 });
    const staleStep3 = cardsRcStale.find((c) => c.classId === "VT-C4K-JSB14")!.steps[2];
    assert.equal(
      staleStep3.isDone,
      false,
      "Point 3: Modifying Session 14 evaluation/Demo score after scrape must mark Report Card step as not done"
    );
    assert.equal(
      staleStep3.statusText,
      "Cần quét và đồng bộ lại",
      "Point 3: Stale Report Card step on Dashboard must show 'Cần quét và đồng bộ lại'"
    );

    // SPCK Dashboard rule (Cách 2): Once a session has been verified on LMS (`lastVerifiedAt` / `lastVerifiedHash`),
    // subsequent local draft edits (`WAITING_APPROVAL` / `DRAFT`) must still keep `Nộp SPCK Buổi 12` marked as Done on Dashboard.
    db.prepare(
      `UPDATE spck_session_submissions
       SET draftStatus = 'WAITING_APPROVAL',
           lastVerifiedAt = '2026-11-05 08:14:07',
           lastVerifiedHash = 'hash_verified_12'
       WHERE classId = 'VT-C4K-JSB12' AND studentId = 'STU_1' AND sessionNumber = 12`
    ).run();
    const cardsEditedAfterVerify = getDashboardTodayTodoCards({ limit: 10 });
    assert.equal(
      cardsEditedAfterVerify.find((c) => c.classId === "VT-C4K-JSB12")!.steps[1].isDone,
      true,
      "Once SPCK Session 12 has been verified on LMS (lastVerifiedAt present), local draft edits (WAITING_APPROVAL) must still count as Done on Dashboard"
    );

    // Conversely, if never verified on LMS (no lastVerifiedAt / lastVerifiedHash) and draftStatus is WAITING_APPROVAL, it must be pending
    db.prepare(
      `UPDATE spck_session_submissions
       SET draftStatus = 'WAITING_APPROVAL',
           lastVerifiedAt = NULL,
           lastVerifiedHash = ''
       WHERE classId = 'VT-C4K-JSB12' AND studentId = 'STU_1' AND sessionNumber = 12`
    ).run();
    const cardsNeverVerified = getDashboardTodayTodoCards({ limit: 10 });
    assert.equal(
      cardsNeverVerified.find((c) => c.classId === "VT-C4K-JSB12")!.steps[1].isDone,
      false,
      "Unverified SPCK Session 12 (no lastVerifiedAt/lastVerifiedHash) must remain not done on Dashboard"
    );
    // Restore STU_1 to VERIFIED
    db.prepare(
      `UPDATE spck_session_submissions
       SET draftStatus = 'VERIFIED',
           lastAttemptStatus = 'VERIFIED',
           lastVerifiedAt = '2026-11-06 20:50:42',
           lastVerifiedHash = 'hash_verified_12'
       WHERE classId = 'VT-C4K-JSB12' AND studentId = 'STU_1' AND sessionNumber = 12`
    ).run();

    // F02 regression: if a re-submission attempt fails (lastAttemptStatus = 'FAILED') and then the teacher edits the draft (draftStatus = 'WAITING_APPROVAL'),
    // Dashboard must NOT mark the SPCK step as Done even if old lastVerifiedAt/lastVerifiedHash exists.
    db.prepare(
      `UPDATE spck_session_submissions
       SET draftStatus = 'WAITING_APPROVAL',
           lastAttemptStatus = 'FAILED',
           lastVerifiedAt = '2026-11-06 20:50:42',
           lastVerifiedHash = 'hash_verified_12'
       WHERE classId = 'VT-C4K-JSB12' AND studentId = 'STU_1' AND sessionNumber = 12`
    ).run();
    const cardsFailedThenDraft = getDashboardTodayTodoCards({ limit: 10 });
    assert.equal(
      cardsFailedThenDraft.find((c) => c.classId === "VT-C4K-JSB12")!.steps[1].isDone,
      false,
      "F02: Re-submission failure (lastAttemptStatus = FAILED) followed by draft edit must keep SPCK step not done"
    );
    // Restore STU_1 to VERIFIED
    db.prepare(
      `UPDATE spck_session_submissions
       SET draftStatus = 'VERIFIED',
           lastAttemptStatus = 'VERIFIED',
           lastVerifiedAt = '2026-11-06 20:50:42',
           lastVerifiedHash = 'hash_verified_12'
       WHERE classId = 'VT-C4K-JSB12' AND studentId = 'STU_1' AND sessionNumber = 12`
    ).run();

    // F01 regression: when a class is on Session 13 and spck_uploads.sessionResultsJson only has Session 12 VERIFIED (no Session 13 entry),
    // legacy row.status === 'VERIFIED' must NOT falsely mark Session 13 as Done.
    db.prepare(
      `INSERT INTO students (classId, studentId, fullName, isActive)
       VALUES ('VT-C4K-JSB13', 'STU_1', 'Học viên 1', 1)`
    ).run();
    db.prepare(
      `INSERT INTO spck_uploads (classId, studentId, status, sessionResultsJson)
       VALUES ('VT-C4K-JSB13', 'STU_1', 'VERIFIED', ?)`
    ).run(
      JSON.stringify({
        "12": { status: "VERIFIED", lastVerifiedAt: "2026-11-05T10:00:00.000Z" },
      })
    );
    fs.writeFileSync(
      testRunningClassesPath,
      JSON.stringify(
        [
          { classCode: "VT-C4K-JSB13", className: "JSB 13", currentSessionNumber: 13, status: "Running" },
        ],
        null,
        2
      ),
      "utf8"
    );
    const cardsF01 = getDashboardTodayTodoCards({ limit: 10 });
    assert.equal(
      cardsF01.find((c) => c.classId === "VT-C4K-JSB13")!.steps[1].isDone,
      false,
      "F01: Session 12 verified in sessionResultsJson must not falsely mark Session 13 as done"
    );

    // Absent student SPCK exemption regression (VT-C4K-GA38 Session 13 scenario):
    // When STU_1 is PRESENT and VERIFIED in Session 13, and STU_2 is ABSENT in session_feedbacks for Session 13
    // (even if STU_2 previously got a stale FAILED attempt because LMS hides 'Sản phẩm của học sinh' on absent rows),
    // Dashboard must mark SPCK Session 13 as Done, and buildStudentSessionHistorySummary must auto-heal STU_2 to ABSENT_EXEMPT.
    db.prepare(
      `INSERT INTO students (classId, studentId, fullName, isActive)
       VALUES ('VT-C4K-JSB13', 'STU_2', 'Phạm Hà Thanh Nguyên', 1)`
    ).run();
    db.prepare(
      `INSERT INTO session_feedbacks (classId, sessionId, studentId, status, attendanceStatus)
       VALUES ('VT-C4K-JSB13', 'VT-C4K-JSB13_SESS_13', 'STU_1', 'VERIFIED', 'PRESENT'),
              ('VT-C4K-JSB13', 'VT-C4K-JSB13_SESS_13', 'STU_2', 'VERIFIED', 'ABSENT')`
    ).run();
    db.prepare(
      `INSERT INTO spck_session_submissions (
         classId, studentId, sessionNumber, draftStatus,
         lastAttemptStatus, lastVerifiedAt, lastVerifiedHash
       ) VALUES
         ('VT-C4K-JSB13', 'STU_1', 13, 'VERIFIED', 'VERIFIED', '2026-11-10 09:00:00', 'hash_stu1_13'),
         ('VT-C4K-JSB13', 'STU_2', 12, 'VERIFIED', 'VERIFIED', '2026-11-03 09:00:00', 'hash_stu2_12'),
         ('VT-C4K-JSB13', 'STU_2', 13, 'FAILED', 'FAILED', NULL, NULL)`
    ).run();
    db.prepare(
      `INSERT INTO spck_uploads (classId, studentId, status, errorMessage, sessionResultsJson)
       VALUES ('VT-C4K-JSB13', 'STU_2', 'FAILED', 'Tại Buổi 13 không có nút Sản phẩm của học sinh', ?)`
    ).run(
      JSON.stringify({
        "12": { status: "VERIFIED", lastVerifiedAt: "2026-11-03T09:00:00.000Z" },
        "13": { status: "FAILED", errorMessage: "Tại Buổi 13 không có nút Sản phẩm của học sinh" },
      })
    );
    const cardsAbsentExempt = getDashboardTodayTodoCards({ limit: 10 });
    const jsb13CardAbsentExempt = cardsAbsentExempt.find((c) => c.classId === "VT-C4K-JSB13")!;
    assert.equal(
      jsb13CardAbsentExempt.steps[0].isDone,
      true,
      "Absent student in Session 13: Step 1 (Nhận xét buổi 13) must be Done"
    );
    assert.equal(
      jsb13CardAbsentExempt.steps[1].isDone,
      true,
      "Absent student in Session 13: Step 2 (Nộp SPCK Buổi 13) must be Done when all present students are VERIFIED"
    );
    assert.match(jsb13CardAbsentExempt.summaryText, /② Nộp SPCK Buổi 13 \(đã nộp LMS ✓\)/);
    assert.equal(jsb13CardAbsentExempt.steps[1].statusText, "đã nộp LMS ✓");

    const stu2History = spckSessionRepo.buildStudentSessionHistorySummary("VT-C4K-JSB13", "STU_2");
    assert.equal(
      stu2History.sessions["13"].displayState,
      "ABSENT_EXEMPT",
      "buildStudentSessionHistorySummary must classify absent student in Session 13 as ABSENT_EXEMPT"
    );
    assert.equal(stu2History.sessions["13"].badgeLabel, "Vắng mặt (Miễn nộp)");
    assert.equal(stu2History.sessions["13"].attendanceStatus, "ABSENT");
    assert.equal(
      stu2History.sessions["13"].lastAttemptStatus,
      null,
      "Stale FAILED attempt on absent student session must be auto-healed to null"
    );
    const healedUploadRow = db
      .prepare(`SELECT status, errorMessage FROM spck_uploads WHERE classId = 'VT-C4K-JSB13' AND studentId = 'STU_2'`)
      .get() as { status: string; errorMessage: string | null };
    assert.equal(
      healedUploadRow.status,
      "VERIFIED",
      "spck_uploads.status must restore to VERIFIED (from Session 12) after clearing Session 13 absent failure"
    );
    assert.equal(healedUploadRow.errorMessage, null);

    // F02 regression: if sessionResultsJson is corrupted on an absent student, auto-heal must NOT overwrite the corrupted JSON with '{}'
    const corruptRaw = '{"12":{"status":"VERIFIED","lastVerifiedAt":"2026-11-03"},"13":';
    db.prepare(
      `INSERT INTO students (classId, studentId, fullName, isActive)
       VALUES ('VT-C4K-JSB13', 'STU_CORRUPT', 'Học viên Lỗi JSON', 1),
              ('VT-C4K-JSB13', 'STU_ABSENT_NO_REC', 'Học viên Vắng Chưa Có SPCK', 1)`
    ).run();
    db.prepare(
      `INSERT INTO session_feedbacks (classId, sessionId, studentId, status, attendanceStatus)
       VALUES ('VT-C4K-JSB13', 'VT-C4K-JSB13_SESS_13', 'STU_CORRUPT', 'VERIFIED', 'ABSENT'),
              ('VT-C4K-JSB13', 'VT-C4K-JSB13_SESS_13', 'STU_ABSENT_NO_REC', 'VERIFIED', 'ABSENT')`
    ).run();
    db.prepare(
      `INSERT INTO spck_session_submissions (classId, studentId, sessionNumber, draftStatus, lastAttemptStatus)
       VALUES ('VT-C4K-JSB13', 'STU_CORRUPT', 13, 'FAILED', 'FAILED')`
    ).run();
    db.prepare(
      `INSERT INTO spck_uploads (classId, studentId, status, errorMessage, sessionResultsJson)
       VALUES ('VT-C4K-JSB13', 'STU_CORRUPT', 'FAILED', 'Upload failed', ?)`
    ).run(corruptRaw);
    const directCleanRes = spckSessionRepo.clearAbsentStudentSessionFailure("VT-C4K-JSB13", "STU_CORRUPT", 13);
    assert.equal(directCleanRes, false, "Direct cleanup API must fail closed when history is corrupted");
    const corruptHist = spckSessionRepo.buildStudentSessionHistorySummary("VT-C4K-JSB13", "STU_CORRUPT");
    assert.equal(corruptHist.historyCorrupted, true, "Corrupted history flag must be preserved on absent student");
    const corruptRowAfter = db
      .prepare(`SELECT sessionResultsJson FROM spck_uploads WHERE classId = 'VT-C4K-JSB13' AND studentId = 'STU_CORRUPT'`)
      .get() as { sessionResultsJson: string };
    assert.equal(
      corruptRowAfter.sessionResultsJson,
      corruptRaw,
      "Corrupted sessionResultsJson bytes must be preserved without overwriting to {}"
    );
    // Clean up STU_CORRUPT so it doesn't affect subsequent VT-C4K-JSB13 checks
    db.prepare(`DELETE FROM spck_uploads WHERE classId = 'VT-C4K-JSB13' AND studentId = 'STU_CORRUPT'`).run();
    db.prepare(`DELETE FROM spck_session_submissions WHERE classId = 'VT-C4K-JSB13' AND studentId = 'STU_CORRUPT'`).run();
    db.prepare(`DELETE FROM session_feedbacks WHERE classId = 'VT-C4K-JSB13' AND studentId = 'STU_CORRUPT'`).run();
    db.prepare(`DELETE FROM students WHERE classId = 'VT-C4K-JSB13' AND studentId = 'STU_CORRUPT'`).run();

    // F04 regression: absent student without an spck_uploads row must still appear in buildEnrichedClassSpckRecords with ABSENT_EXEMPT without mutating spck_uploads
    const enrichedJsb13 = buildEnrichedClassSpckRecords("VT-C4K-JSB13", 13);
    const absentNoRecEntry = enrichedJsb13.find((r) => r.studentId === "STU_ABSENT_NO_REC");
    assert.ok(absentNoRecEntry, "Absent student without spck_uploads row must be represented in buildEnrichedClassSpckRecords");
    assert.equal(absentNoRecEntry!.sessionHistory.sessions["13"].displayState, "ABSENT_EXEMPT");
    const noRecDbRow = db
      .prepare(`SELECT studentId FROM spck_uploads WHERE classId = 'VT-C4K-JSB13' AND studentId = 'STU_ABSENT_NO_REC'`)
      .get();
    assert.equal(noRecDbRow, undefined, "Synthetic absent student representation must not insert into spck_uploads");

    // 1-week (7-day) Finished class expiration & next-tier successor transition (e.g. VT-JSB15 -> VT-JSA15, VT-C4K-PTA12 -> VT-C4K-PTI12)
    const fmtDmy = (d: Date) =>
      `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    const nowRef = new Date();
    const d3DaysAgo = fmtDmy(new Date(nowRef.getTime() - 3 * 24 * 60 * 60 * 1000));
    const d10DaysAgo = fmtDmy(new Date(nowRef.getTime() - 10 * 24 * 60 * 60 * 1000));
    fs.writeFileSync(
      testRunningClassesPath,
      JSON.stringify(
        [
          { classCode: "VT-C4K-JSB01", className: "JSB 01", currentSessionNumber: 1, status: "Running" },
          { classCode: "VT-C4K-JSB05", className: "JSB 05", currentSessionNumber: 5, status: "Running" },
          { classCode: "VT-C4K-JSB12", className: "JSB 12", currentSessionNumber: 12, status: "Running" },
          { classCode: "VT-C4K-JSB14", className: "JSB 14", currentSessionNumber: 14, status: "Running" },
          { classCode: "VT-JSA15", className: "JSA 15", currentSessionNumber: 1, status: "Running" },
          { classCode: "VT-C4K-PTI12", className: "PTI 12", currentSessionNumber: 1, status: "Running" },
          { classCode: "VT-JSB15", className: "JSB 15", status: "Finished", endDate: d3DaysAgo },
          { classCode: "VT-C4K-PTA12", className: "PTA 12", status: "Finished", endDate: d10DaysAgo },
          { classCode: "VT-C4K-GI99", className: "GI 99", status: "Finished", endDate: d10DaysAgo },
          { classCode: "VT-C4K-GI98", className: "GI 98", status: "Finished", endDate: d3DaysAgo },
          { classCode: "VT-JSB20", className: "JSB 20", status: "Finished", endDate: d3DaysAgo },
          { classCode: "VT-JSA20", className: "JSA 20", status: "FINISHED", endDate: d3DaysAgo },
        ],
        null,
        2
      ),
      "utf8"
    );
    const cardsWithFinishedFilter = getDashboardTodayTodoCards({ limit: 20 });
    const cardIds = cardsWithFinishedFilter.map((c) => c.classId);
    assert.equal(
      cardIds.includes("VT-JSB15"),
      false,
      "Finished class VT-JSB15 must be excluded once successor VT-JSA15 is Running"
    );
    assert.equal(
      cardIds.includes("VT-JSB20"),
      true,
      "F03: Finished class VT-JSB20 (<=7d) must NOT be excluded when successor VT-JSA20 has status 'FINISHED' (not Running/Active)"
    );
    assert.equal(
      cardIds.includes("VT-C4K-PTA12"),
      false,
      "Finished class VT-C4K-PTA12 (>7d and superseded by VT-C4K-PTI12) must be excluded"
    );
    assert.equal(
      cardIds.includes("VT-C4K-GI99"),
      false,
      "Finished class VT-C4K-GI99 (>7 days old) must be excluded on Dashboard"
    );
    assert.equal(
      cardIds.includes("VT-C4K-GI98"),
      true,
      "Finished class VT-C4K-GI98 (<=7 days old and no successor) must still be tracked during the 1-week grace period"
    );
    assert.deepEqual(
      queryClassDirectory({
        scope: "spck",
        minSessionNumber: 12,
        allowedClassCodes: new Set<string>(),
      }).classes,
      [],
      "F05: Passing an explicit empty allowedClassCodes set must return [] instead of falling back to cached classes"
    );

    // Same-day session advancement & date display regression (VT-C4K-GI34 Buổi 9 & VT-C4K-PTA13 Buổi 12):
    // When MindX LMS still keeps today's slot `.disabled` before the class's scheduled hour starts,
    // both `enrichClassSessionsWithScheduleDates` and `queryClassDirectory` / `getDashboardTodayTodoCards`
    // must advance from last week's session (`today - 7 days`) to today's session and expose `sessionDate` + `isTodaySession`.
    const dToday = fmtDmy(nowRef);
    const d7DaysAgo = fmtDmy(new Date(nowRef.getTime() - 7 * 24 * 60 * 60 * 1000));
    const d6DaysAgo = fmtDmy(new Date(nowRef.getTime() - 6 * 24 * 60 * 60 * 1000));
    const dTomorrow = fmtDmy(new Date(nowRef.getTime() + 1 * 24 * 60 * 60 * 1000));

    const gi34Sessions = Array.from({ length: 14 }, (_, i) => ({
      classId: "VT-C4K-GI34",
      className: "VT-C4K-GI34",
      sessionId: `VT-C4K-GI34_SESS_${String(i + 1).padStart(2, "0")}`,
      sessionNumber: i + 1,
      topic: `Buổi ${i + 1}`,
      date: i + 1 === 8 ? d7DaysAgo : "",
    }));
    const gi34Enriched = enrichClassSessionsWithScheduleDates({
      classCode: "VT-C4K-GI34",
      sessions: gi34Sessions,
      latestActiveSessionId: "VT-C4K-GI34_SESS_08",
      nowMs: nowRef.getTime(),
    });
    assert.equal(
      gi34Enriched.latestActiveSessionId,
      "VT-C4K-GI34_SESS_09",
      "Same-day sync: VT-C4K-GI34 must advance from SESS_08 (7 days ago) to SESS_09 (today) even when SESS_09 is still .disabled in DOM"
    );
    assert.equal(
      gi34Sessions[8].date,
      dToday,
      "Same-day sync: VT-C4K-GI34 SESS_09 must receive today's date"
    );
    assert.equal(
      gi34Sessions[9].date,
      "",
      "Same-day sync: Future session SESS_10 must keep empty date"
    );

    // Sunday class (last session 6 days ago, next session tomorrow) must NOT advance early
    const ga38Sessions = Array.from({ length: 14 }, (_, i) => ({
      classId: "VT-C4K-GA38",
      className: "VT-C4K-GA38",
      sessionId: `VT-C4K-GA38_SESS_${String(i + 1).padStart(2, "0")}`,
      sessionNumber: i + 1,
      topic: `Buổi ${i + 1}`,
      date: i + 1 === 12 ? d6DaysAgo : "",
    }));
    const ga38Enriched = enrichClassSessionsWithScheduleDates({
      classCode: "VT-C4K-GA38",
      sessions: ga38Sessions,
      latestActiveSessionId: "VT-C4K-GA38_SESS_12",
      nowMs: nowRef.getTime(),
    });
    assert.equal(
      ga38Enriched.latestActiveSessionId,
      "VT-C4K-GA38_SESS_12",
      "Sunday class (next session tomorrow) must remain on SESS_12 today"
    );
    assert.equal(
      ga38Sessions[12].date,
      "",
      "Sunday class SESS_13 (tomorrow) must not receive date early"
    );

    // Seed VT-C4K-PTA13 in SQLite with SESS_11 dated 7 days ago and SESS_12..14 empty (simulating pre-class-hour state)
    for (let sNum = 1; sNum <= 14; sNum++) {
      insertSessStmt.run(
        "VT-C4K-PTA13",
        "PTA 13",
        `VT-C4K-PTA13_SESS_${String(sNum).padStart(2, "0")}`,
        sNum,
        sNum === 11 ? d7DaysAgo : ""
      );
    }
    fs.writeFileSync(
      testRunningClassesPath,
      JSON.stringify(
        [
          { classCode: "VT-C4K-JSB12", className: "JSB 12", currentSessionNumber: 12, status: "Running" },
          { classCode: "VT-C4K-PTA13", className: "PTA 13", status: "Running" },
        ],
        null,
        2
      ),
      "utf8"
    );
    const ptaCards = getDashboardTodayTodoCards({ limit: 10 });
    const ptaCard = ptaCards.find((c) => c.classId === "VT-C4K-PTA13")!;
    assert.ok(ptaCard, "VT-C4K-PTA13 must be returned in Dashboard cards");
    assert.equal(
      ptaCard.currentSessionNumber,
      12,
      "VT-C4K-PTA13 with SESS_11 dated 7 days ago must resolve to Buổi 12 today"
    );
    assert.equal(
      ptaCard.sessionDate,
      dToday,
      "VT-C4K-PTA13 card must expose today's sessionDate (DD/MM/YYYY)"
    );
    assert.equal(
      ptaCard.isTodaySession,
      true,
      "VT-C4K-PTA13 card must set isTodaySession=true"
    );
    assert.equal(
      ptaCards[0].classId,
      "VT-C4K-PTA13",
      "Today's session card (isTodaySession=true) must be prioritized first on Dashboard"
    );
    assert.equal(dTomorrow.length, 10);

    // F01 regression: Explicit postponed next slot (from GetClassById.slots or SQLite future date) must NOT be overridden by +7 days
    const dNextWeek = fmtDmy(new Date(nowRef.getTime() + 7 * 24 * 60 * 60 * 1000));
    const dNextWeekIso = `${dNextWeek.slice(6, 10)}-${dNextWeek.slice(3, 5)}-${dNextWeek.slice(0, 2)}T19:00:00+07:00`;
    const postponedSessions = Array.from({ length: 14 }, (_, i) => ({
      classId: "VT-C4K-POST01",
      className: "VT-C4K-POST01",
      sessionId: `VT-C4K-POST01_SESS_${String(i + 1).padStart(2, "0")}`,
      sessionNumber: i + 1,
      topic: `Buổi ${i + 1}`,
      date: i + 1 === 8 ? d7DaysAgo : "",
    }));
    const postEnriched = enrichClassSessionsWithScheduleDates({
      classCode: "VT-C4K-POST01",
      sessions: postponedSessions,
      latestActiveSessionId: "VT-C4K-POST01_SESS_08",
      slots: [{ index: 8, startTime: dNextWeekIso }],
      nowMs: nowRef.getTime(),
    });
    assert.equal(postEnriched.latestActiveSessionId, "VT-C4K-POST01_SESS_08");
    assert.equal(postponedSessions[8].date, "");
    for (const s of postponedSessions) {
      classSessionRepo.upsert(s);
    }
    fs.writeFileSync(
      testRunningClassesPath,
      JSON.stringify(
        [
          { classCode: "VT-C4K-JSB12", className: "JSB 12", currentSessionNumber: 12, status: "Running" },
          { classCode: "VT-C4K-POST01", className: "POST 01", status: "Running" },
        ],
        null,
        2
      ),
      "utf8"
    );
    const postDir = queryClassDirectory({ scope: "all", nowMs: nowRef.getTime() }).classes.find(
      (x) => x.classCode === "VT-C4K-POST01"
    )!;
    assert.equal(
      postDir.currentSessionNumber,
      8,
      "F01: Postponed session from GetClassById.slots must remain on SESS_08 after SQLite upsert"
    );
    assert.equal(postDir.currentSessionDate, d7DaysAgo);

    // F04 regression: Finished class at Session 14 with only SESS_13 dated in SQLite must use session14Date / endDate (not SESS_13 date)
    const d1DayAgo = fmtDmy(new Date(nowRef.getTime() - 1 * 24 * 60 * 60 * 1000));
    const d8DaysAgo = fmtDmy(new Date(nowRef.getTime() - 8 * 24 * 60 * 60 * 1000));
    for (let sNum = 1; sNum <= 14; sNum++) {
      insertSessStmt.run(
        "VT-C4K-FIN14",
        "FIN 14",
        `VT-C4K-FIN14_SESS_${String(sNum).padStart(2, "0")}`,
        sNum,
        sNum === 13 ? d8DaysAgo : ""
      );
    }
    fs.writeFileSync(
      testRunningClassesPath,
      JSON.stringify(
        [
          { classCode: "VT-C4K-JSB12", className: "JSB 12", currentSessionNumber: 12, status: "Running" },
          { classCode: "VT-C4K-FIN14", className: "FIN 14", status: "Finished", endDate: d1DayAgo },
        ],
        null,
        2
      ),
      "utf8"
    );
    const finDir = queryClassDirectory({ scope: "all", nowMs: nowRef.getTime() }).classes.find(
      (x) => x.classCode === "VT-C4K-FIN14"
    )!;
    assert.equal(finDir.currentSessionNumber, 14);
    assert.equal(
      finDir.currentSessionDate,
      d1DayAgo,
      "F04: Finished S14 class must expose S14 endDate, never stale S13 date"
    );

    // F03 regression: Today's class at index 25 must be prioritized before applying limit=24
    const manyCodes = Array.from({ length: 25 }, (_, i) => `VT-C4K-LIM${100 + i}`);
    for (let idx = 0; idx < manyCodes.length; idx++) {
      const code = manyCodes[idx];
      for (let sNum = 1; sNum <= 14; sNum++) {
        insertSessStmt.run(
          code,
          code,
          `${code}_SESS_${String(sNum).padStart(2, "0")}`,
          sNum,
          sNum === 8 ? (idx === 24 ? d7DaysAgo : d1DayAgo) : ""
        );
      }
    }
    fs.writeFileSync(
      testRunningClassesPath,
      JSON.stringify(
        manyCodes.map((classCode) => ({ classCode, status: "Running" })),
        null,
        2
      ),
      "utf8"
    );
    const limCards = getDashboardTodayTodoCards({ limit: 24 });
    assert.equal(limCards.length, 24);
    assert.equal(
      limCards[0].classId,
      manyCodes[24],
      "F03: 25th class teaching today must be sorted to index 0 before slicing to limit=24"
    );

    // Restore VT-C4K-JSB12 in testRunningClassesPath for [S6-T3]
    fs.writeFileSync(
      testRunningClassesPath,
      JSON.stringify(
        [
          { classCode: "VT-C4K-JSB12", className: "JSB 12", currentSessionNumber: 12, status: "Running" },
        ],
        null,
        2
      ),
      "utf8"
    );

    console.log(
      "  -> PASS [S6-T2]: Thẻ 'Việc cần làm hôm nay' (Buổi 1, 5, 7, 11, 12, 14 + S6-04/S6-05 + Point 3) hoạt động chính xác.\n"
    );
  }

  // =========================================================================
  // [S6-T3] S6.5: Removed unused approve / approve_and_save & dead code checks
  // =========================================================================
  console.log(
    "[S6-T3] Kiểm tra S6.5 (xóa approve / approve_and_save dư thừa trên /api/teaching-projects & dọn khối {false && ...})..."
  );
  {
    const makePostReq = (payload: Record<string, unknown>) =>
      new NextRequest("http://127.0.0.1:3000/api/teaching-projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          host: "127.0.0.1:3000",
        },
        body: JSON.stringify(payload),
      });

    const resApprove = await postTeachingProjectRoute(
      makePostReq({
        classCode: "VT-C4K-JSB12",
        action: "approve",
        expectedVersion: 1,
      })
    );
    assert.equal(
      resApprove.status,
      400,
      "Removed action='approve' must return HTTP 400"
    );
    const approveJson = await resApprove.json();
    assert.match(String(approveJson.error || ""), /Hành động không hợp lệ: approve/);

    const resApproveAndSave = await postTeachingProjectRoute(
      makePostReq({
        classCode: "VT-C4K-JSB12",
        action: "approve_and_save",
        expectedVersion: 1,
      })
    );
    assert.equal(
      resApproveAndSave.status,
      400,
      "Removed action='approve_and_save' must return HTTP 400"
    );
    const approveSaveJson = await resApproveAndSave.json();
    assert.match(
      String(approveSaveJson.error || ""),
      /Hành động không hợp lệ: approve_and_save/
    );

    const resSaveDraft = await postTeachingProjectRoute(
      makePostReq({
        classCode: "VT-C4K-JSB12",
        action: "save_draft",
        projectName: "Dự án JSB12",
        expectedVersion: 1,
      })
    );
    assert.equal(resSaveDraft.status, 200);
    const saveJson = await resSaveDraft.json();
    assert.equal(saveJson.success, true);

    const origLoad = TeachingProjectService.loadClassProject;
    TeachingProjectService.loadClassProject = async (clsCode: string) =>
      ({
        success: true,
        classCode: clsCode,
        courseName: "JSB",
        hasRemoteProject: false,
        remoteTaskCount: 0,
        wasAutoCompletedToFive: false,
        extraRemoteTaskIds: [],
        dateSource: "local",
        record: saveJson.record,
        tasks: saveJson.tasks || [],
        students: [],
        progress: {},
      }) as any;
    try {
      const getReq = new NextRequest(
        "http://127.0.0.1:3000/api/teaching-projects?classCode=VT-C4K-JSB12",
        {
          method: "GET",
          headers: { host: "127.0.0.1:3000" },
        }
      );
      const getRes = await getTeachingProjectRoute(getReq);
      const getJson = await getRes.json();
      assert.equal(getJson.success, true);
      assert.equal(
        getJson.currentSessionNumber,
        12,
        "GET /api/teaching-projects must return currentSessionNumber from class metadata"
      );

      // S6-06 regression: unknown class must return currentSessionNumber = 0 (never assume Session 11)
      const unknownReq = new NextRequest(
        "http://127.0.0.1:3000/api/teaching-projects?classCode=VT-C4K-UNKNOWN",
        {
          method: "GET",
          headers: { host: "127.0.0.1:3000" },
        }
      );
      const unknownRes = await getTeachingProjectRoute(unknownReq);
      const unknownJson = await unknownRes.json();
      assert.equal(
        unknownJson.currentSessionNumber,
        0,
        "S6-06: Unknown class must return currentSessionNumber = 0"
      );
    } finally {
      TeachingProjectService.loadClassProject = origLoad;
    }

    const dashboardSrc = fs.readFileSync(
      path.join(process.cwd(), "src/app/page.tsx"),
      "utf8"
    );
    const teachingPageSrc = fs.readFileSync(
      path.join(process.cwd(), "src/app/teaching-projects/page.tsx"),
      "utf8"
    );
    assert.equal(
      dashboardSrc.includes("{false &&"),
      false,
      "src/app/page.tsx must not contain {false && ...} dead blocks"
    );
    assert.equal(
      dashboardSrc.includes('export const dynamic = "force-dynamic"'),
      true,
      "S6-07: src/app/page.tsx must export dynamic = 'force-dynamic'"
    );
    assert.equal(
      teachingPageSrc.includes("{false &&"),
      false,
      "src/app/teaching-projects/page.tsx must not contain {false && ...} dead blocks"
    );

    console.log(
      "  -> PASS [S6-T3]: S6.5 (từ chối approve/approve_and_save, trả currentSessionNumber & 0 khối {false && ...}) đạt chuẩn.\n"
    );
  }

  // =========================================================================
  // [S6-T4] S6.1, S6.2, S6.3: Playwright Mounted UI Verification
  // =========================================================================
  console.log(
    "[S6-T4] Kiểm thử UI thực tế (Playwright): Màn 5 (1 nút Cập nhật theo buổi + mục Nâng cao) & Màn 3 (Thẻ gợi ý Tiến độ + Mở Phiếu điểm)..."
  );
  {
    const aliasPlugin: esbuild.Plugin = {
      name: "alias-at",
      setup(build) {
        build.onResolve({ filter: /^@\// }, (args) => {
          const rel = args.path.slice(2);
          const base = path.join(process.cwd(), "src", rel);
          for (const ext of [".tsx", ".ts", ".js", "/index.tsx", "/index.ts"]) {
            if (fs.existsSync(base + ext)) {
              return { path: base + ext };
            }
          }
          return { path: base };
        });
      },
    };

    const tpBundle = await esbuild.build({
      stdin: {
        contents: `
          import React from "react";
          import { createRoot } from "react-dom/client";
          import TeachingProjectsPage from "./src/app/teaching-projects/page";
          const rootEl = document.getElementById("root")!;
          createRoot(rootEl).render(<TeachingProjectsPage />);
        `,
        resolveDir: process.cwd(),
        loader: "tsx",
      },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: ["es2020"],
      plugins: [aliasPlugin],
      define: { "process.env.NODE_ENV": '"development"' },
    });
    const tpBundleCode = tpBundle.outputFiles[0].text;

    const spckBundle = await esbuild.build({
      stdin: {
        contents: `
          import React from "react";
          import { createRoot } from "react-dom/client";
          import FinalProjectPage from "./src/app/final-project/page";
          const rootEl = document.getElementById("root")!;
          createRoot(rootEl).render(<FinalProjectPage />);
        `,
        resolveDir: process.cwd(),
        loader: "tsx",
      },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: ["es2020"],
      plugins: [aliasPlugin],
      define: { "process.env.NODE_ENV": '"development"' },
    });
    const spckBundleCode = spckBundle.outputFiles[0].text;

    const browser = await chromium.launch({ headless: true });
    try {
      // ---------------------------------------------------------------------
      // Part A: Screen 5 (TeachingProjectsPage) — 1-click button & collapsible Advanced
      // ---------------------------------------------------------------------
      const pageTp = await browser.newPage();
      await pageTp.addInitScript("window.__name = (fn) => fn;");
      await pageTp.route("http://127.0.0.1:3000/**", async (route) => {
        const reqUrl = route.request().url();
        if (reqUrl.includes("/teaching-projects-test")) {
          await route.fulfill({
            status: 200,
            contentType: "text/html; charset=utf-8",
            body: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>`,
          });
          return;
        }
        await route.continue();
      });

      await pageTp.goto(
        "http://127.0.0.1:3000/teaching-projects-test?classId=VT-C4K-JSB12"
      );

      await pageTp.evaluate(() => {
        const w = window as any;
        w.__tpProgressCalls = [];
        w.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : (input as Request).url;
          const method = (init?.method || "GET").toUpperCase();
          const bodyObj = init?.body ? JSON.parse(String(init.body)) : {};

          if (url.includes("/api/teaching-projects/progress") && method === "POST") {
            w.__tpProgressCalls.push(bodyObj);
            return new Response(
              JSON.stringify({
                success: true,
                updatedCount: 10,
                progress: {
                  "101_1": 100,
                  "102_1": 100,
                  "103_1": 100,
                  "104_1": 0,
                  "105_1": 0,
                },
              }),
              { status: 200 }
            );
          }

          if (url.includes("/api/teaching-projects") && method === "GET") {
            const u = new URL(url, "http://127.0.0.1:3000");
            const cls = u.searchParams.get("classCode") || "VT-C4K-JSB12";
            const tasks = [1, 2, 3, 4, 5].map((slot) => ({
              slotIndex: slot,
              taskId: 100 + slot,
              taskName: `Việc ${slot}`,
              description: `Mô tả ${slot}`,
              weightPercent: 20,
              deadline: "2026-11-15",
              assignedStudentIds: [1, 2],
              status: "VERIFIED",
              contentHash: "hash",
            }));
            return new Response(
              JSON.stringify({
                success: true,
                selectedClassCode: cls,
                currentSessionNumber: 12,
                runningClasses: [
                  {
                    classCode: "VT-C4K-JSB12",
                    className: "JSB 12",
                    currentSessionNumber: 12,
                  },
                ],
                students: [
                  { id: 1, studentName: "Nguyễn Minh Khôi", classCode: cls },
                  { id: 2, studentName: "Trần Bảo Ngọc", classCode: cls },
                ],
                tasks,
                progress: {},
                record: {
                  classId: cls,
                  projectId: 99,
                  projectName: "SPCK JSB12",
                  projectDescription: "Mô tả dự án",
                  startDate: "2026-10-01",
                  endDate: "2026-11-15",
                  status: "VERIFIED",
                  draftVersion: 1,
                },
              }),
              { status: 200 }
            );
          }

          return new Response(JSON.stringify({ success: true }), { status: 200 });
        };
      });

      await pageTp.addScriptTag({ content: tpBundleCode });
      await pageTp.waitForSelector(
        "button:has-text('Cập nhật tiến độ theo buổi hiện tại (Buổi 12 → 60%)')"
      );

      // Verify manual milestones & LMS date button & sliders are hidden while Advanced is collapsed
      const manualBtnCountBefore = await pageTp
        .locator("button:has-text('Xong Việc 1 (20%)')")
        .count();
      const lmsDateBtnCountBefore = await pageTp
        .locator("button:has-text('Lấy ngày chuẩn từ LMS')")
        .count();
      const sliderCountBefore = await pageTp.locator('input[type="range"]').count();
      assert.equal(
        manualBtnCountBefore,
        0,
        "Manual milestone buttons must be hidden while Advanced is collapsed"
      );
      assert.equal(
        lmsDateBtnCountBefore,
        0,
        "LMS date button must be hidden while Advanced is collapsed"
      );
      assert.equal(
        sliderCountBefore,
        0,
        "Per-student sliders must be hidden while Advanced is collapsed"
      );

      // Click the 1-click button
      await pageTp.click(
        "button:has-text('Cập nhật tiến độ theo buổi hiện tại (Buổi 12 → 60%)')"
      );
      await pageTp.waitForFunction(
        () => (window as any).__tpProgressCalls.length === 1
      );
      const tpProgressCalls = await pageTp.evaluate(
        () => (window as any).__tpProgressCalls
      );
      assert.equal(tpProgressCalls[0].classCode, "VT-C4K-JSB12");
      assert.equal(tpProgressCalls[0].milestoneTaskCount, 3);
      assert.equal(
        tpProgressCalls[0].resetOthers,
        false,
        "Point 2: Quick 1-click milestone button must be non-decreasing (resetOthers=false)"
      );
      assert.equal(
        tpProgressCalls[0].allowDecrease,
        false,
        "Point 2: Quick 1-click milestone button must set allowDecrease=false"
      );

      // Point 4: Verify unified draft status badge renders "Đã lưu nháp"
      const draftBadgeText = await pageTp
        .locator('[data-testid="tp-draft-status-badge"]')
        .textContent();
      assert.equal(
        (draftBadgeText || "").trim(),
        "Đã lưu nháp",
        "Point 4: Unified draft status badge must render 'Đã lưu nháp' when clean"
      );

      // Open Advanced section -> manual buttons, LMS date button, and sliders appear
      await pageTp.click("button:has-text('⚙️ Nâng cao')");
      await pageTp.waitForSelector("button:has-text('Xong Việc 1 (20%)')");
      await pageTp.waitForSelector("button:has-text('Lấy ngày chuẩn từ LMS')");
      const sliderCountAfter = await pageTp.locator('input[type="range"]').count();
      assert.ok(
        sliderCountAfter > 0,
        "Per-student sliders must appear when Advanced is expanded"
      );
      await pageTp.close();

      // ---------------------------------------------------------------------
      // Part B: Screen 3 (FinalProjectPage) — S6.2 & S6.3 Handoff Cards
      // ---------------------------------------------------------------------
      const pageSpck = await browser.newPage();
      await pageSpck.addInitScript("window.__name = (fn) => fn;");
      await pageSpck.route("http://127.0.0.1:3000/**", async (route) => {
        const reqUrl = route.request().url();
        if (reqUrl.includes("/spck-s6-test")) {
          await route.fulfill({
            status: 200,
            contentType: "text/html; charset=utf-8",
            body: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>`,
          });
          return;
        }
        await route.continue();
      });

      await pageSpck.goto(
        "http://127.0.0.1:3000/spck-s6-test?classId=VT-C4K-JSB15&sessionNumber=12"
      );

      await pageSpck.evaluate(() => {
        const w = window as any;
        w.__spckTeachingProgressCalls = [];
        w.__simulateEval14FailOnce = false;

        const students = [
          { studentId: "STU_01", fullName: "Nguyễn Minh Khôi" },
          { studentId: "STU_02", fullName: "Trần Bảo Ngọc" },
        ];

        const makeRecord = (
          sid: string,
          name: string,
          status: string,
          sessNum: number
        ) => ({
          classId: "VT-C4K-JSB15",
          studentId: sid,
          localFolderPath: "D:\\\\SPCK\\\\VT-C4K-JSB15\\\\01_" + sid,
          matchScore: 1,
          isConfirmedByTeacher: 1,
          projectTitle: "Dự án " + name,
          thumbnailPath: "D:\\\\SPCK\\\\VT-C4K-JSB15\\\\01_" + sid + "\\\\thumb.png",
          screenshotsJson: JSON.stringify([
            "D:\\\\SPCK\\\\VT-C4K-JSB15\\\\01_" + sid + "\\\\s1.png",
          ]),
          attachmentsJson: JSON.stringify(["index.html"]),
          youtubeUrlsJson: "[]",
          relatedLinksJson: JSON.stringify([
            {
              name: "Sản phẩm trên Google Drive",
              url: "https://drive.google.com/drive/folders/" + sid,
            },
          ]),
          teacherComment:
            "- Nhận xét về sản phẩm: Tốt.\n- Nhận xét về thái độ và kỹ năng của học viên: Tốt.",
          quickTagsJson: JSON.stringify(["Hoàn thành tốt sản phẩm cuối khóa"]),
          teacherNote: "",
          status,
          contentHash: status === "VERIFIED" ? "hash_v" : "",
          draftVersion: 1,
          sessionResultsJson:
            status === "VERIFIED"
              ? JSON.stringify({
                  [String(sessNum)]: {
                    status: "VERIFIED",
                    submittedContentHash: "hash_v",
                    verifiedAt: "2026-10-30 18:00:00",
                  },
                })
              : "{}",
        });

        w.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : (input as Request).url;
          const method = (init?.method || "GET").toUpperCase();
          const bodyObj = init?.body ? JSON.parse(String(init.body)) : {};

          if (url.includes("/api/spck/student-portal")) {
            return new Response(
              JSON.stringify({
                success: true,
                portalStatus: { isRunning: false, submissions: [] },
              }),
              { status: 200 }
            );
          }

          if (url.includes("/api/spck/list")) {
            const u = new URL(url, "http://127.0.0.1:3000");
            const sess = Number(u.searchParams.get("sessionNumber") || 12);
            return new Response(
              JSON.stringify({
                success: true,
                classes: [
                  {
                    classId: "VT-C4K-JSB15",
                    className: "VT-C4K-JSB15 - Web",
                    studentCount: 2,
                  },
                ],
                selectedClassId: "VT-C4K-JSB15",
                selectedSessionNumber: sess,
                activeSessionNumber: sess,
                students,
                records: students.map((s) =>
                  makeRecord(s.studentId, s.fullName, "WAITING_APPROVAL", sess)
                ),
                savedFolderPath: "D:\\\\SPCK\\\\VT-C4K-JSB15",
                session14TagLabels: ["Hoàn thành tốt sản phẩm cuối khóa"],
              }),
              { status: 200 }
            );
          }

          if (url.includes("/api/spck/approve")) {
            const sess = Number(bodyObj.sessionNumber || 12);
            return new Response(
              JSON.stringify({
                success: true,
                approvedStudentIds: bodyObj.studentIds || ["STU_01", "STU_02"],
                skipped: [],
                records: students.map((s) =>
                  makeRecord(s.studentId, s.fullName, "APPROVED", sess)
                ),
              }),
              { status: 200 }
            );
          }

          if (url.includes("/api/spck/upload-lms") && !url.includes("session14-eval")) {
            const sess = Number(bodyObj.sessionNumber || 12);
            return new Response(
              JSON.stringify({
                success: true,
                records: students.map((s) =>
                  makeRecord(s.studentId, s.fullName, "VERIFIED", sess)
                ),
                uploadResult: {
                  verifiedCount: 2,
                  failedCount: 0,
                  results: [
                    { studentId: "STU_01", status: "VERIFIED" },
                    { studentId: "STU_02", status: "VERIFIED" },
                  ],
                },
              }),
              { status: 200 }
            );
          }

          if (url.includes("/api/spck/session14-eval") && method === "GET") {
            return new Response(
              JSON.stringify({
                success: true,
                records: students.map((s) => ({
                  classId: "VT-C4K-JSB15",
                  studentId: s.studentId,
                  fullName: s.fullName,
                  awardRanking: "Giải Nhất",
                  demoScores: {
                    algorithm: 1.5,
                    creativity: 1.0,
                    communication: 0.5,
                    problemSolving: 1.0,
                    computerSkills: 1.0,
                  },
                  demoTotalScore: 5.0,
                  competencyScores: {
                    knowledgeInClass: 4,
                    knowledgeSelfStudy: 4,
                    skillCommunication: 4,
                    skillComputerUse: 4,
                    skillProblemSolving: 4,
                    skillCreativity: 4,
                    skillComputational: 4,
                    attitudeHomework: 4,
                    attitudeInClass: 4,
                  },
                  competencyTotalScore: 36,
                  quickTags: ["Hoàn thành tốt sản phẩm cuối khóa"],
                  teacherNote: "",
                  learnedFromMindx: "Đã học tốt",
                  suggestionsFromMindx: "Góp ý tốt",
                  futureDirection: "Định hướng tốt",
                  status: "APPROVED",
                  contentHash: "eval_hash",
                  draftVersion: 1,
                })),
              }),
              { status: 200 }
            );
          }

          if (
            url.includes("/api/spck/session14-eval") &&
            method === "POST" &&
            !url.includes("upload-lms")
          ) {
            return new Response(
              JSON.stringify({
                success: true,
                approvedIds: bodyObj.studentIds || ["STU_01", "STU_02"],
              }),
              { status: 200 }
            );
          }

          if (url.includes("/api/spck/session14-eval/upload-lms")) {
            if (w.__simulateEval14FailOnce) {
              w.__simulateEval14FailOnce = false;
              return new Response(
                JSON.stringify({
                  success: true,
                  records: [],
                  uploadResult: {
                    verifiedCount: 1,
                    failedCount: 1,
                    results: [
                      {
                        studentId: "STU_01",
                        fullName: "Nguyễn Minh Khôi",
                        status: "VERIFIED",
                      },
                      {
                        studentId: "STU_02",
                        fullName: "Trần Bảo Ngọc",
                        status: "FAILED",
                        errorMessage: "Timeout Cột 2",
                      },
                    ],
                  },
                }),
                { status: 200 }
              );
            }
            const reqIds = bodyObj.studentIds || ["STU_01", "STU_02"];
            return new Response(
              JSON.stringify({
                success: true,
                records: [],
                uploadResult: {
                  verifiedCount: reqIds.length,
                  failedCount: 0,
                  results: reqIds.map((sid: string) => ({
                    studentId: sid,
                    status: "VERIFIED",
                  })),
                },
              }),
              { status: 200 }
            );
          }

          if (url.includes("/api/teaching-projects/progress")) {
            w.__spckTeachingProgressCalls.push(bodyObj);
            return new Response(
              JSON.stringify({
                success: true,
                updatedCount: 10,
              }),
              { status: 200 }
            );
          }

          return new Response(JSON.stringify({ success: true }), { status: 200 });
        };
      });

      await pageSpck.addScriptTag({ content: spckBundleCode });
      await pageSpck.waitForSelector("button:has-text('Nộp 2 bài — Buổi 12')");

      // Before VERIFIED: no suggestion card
      assert.equal(
        await pageSpck
          .locator("button:has-text('📈 Cập nhật tiến độ Teaching lên 60%')")
          .count(),
        0,
        "Teaching progress suggestion must NOT appear before SPCK is VERIFIED"
      );

      // Submit Session 12 -> VERIFIED -> suggestion card appears for 60%
      await pageSpck.click("button:has-text('Nộp 2 bài — Buổi 12')");
      await pageSpck.waitForSelector(
        "button:has-text('📈 Cập nhật tiến độ Teaching lên 60%')"
      );
      await pageSpck.click(
        "button:has-text('📈 Cập nhật tiến độ Teaching lên 60%')"
      );
      await pageSpck.waitForSelector(
        "text=Đã cập nhật tiến độ Teaching lên 60% thành công"
      );
      const s12Calls = await pageSpck.evaluate(
        () => (window as any).__spckTeachingProgressCalls
      );
      assert.equal(s12Calls.length, 1);
      assert.equal(s12Calls[0].classCode, "VT-C4K-JSB15");
      assert.equal(s12Calls[0].milestoneTaskCount, 3);

      // Switch to Session 14
      await pageSpck.click("button:has-text('Buổi 14')");
      await pageSpck.waitForSelector(
        "button:has-text('🚀 Nộp Buổi 14 đầy đủ (Sản phẩm + Đánh giá)')"
      );

      // Simulate Part 1 (SPCK) success + Part 2 (Eval) failure -> Report Card handoff must NOT appear yet
      await pageSpck.evaluate(() => {
        (window as any).__simulateEval14FailOnce = true;
      });
      await pageSpck.click(
        "button:has-text('🚀 Nộp Buổi 14 đầy đủ (Sản phẩm + Đánh giá)')"
      );
      await pageSpck.waitForSelector(
        "button:has-text('🔄 Thử lại riêng phần Đánh giá (1)')"
      );
      assert.equal(
        await pageSpck.locator("a:has-text('📋 Mở Phiếu điểm → Quét')").count(),
        0,
        "Report Card handoff must NOT appear while Session 14 Eval still has failed students"
      );

      // Retry Part 2 (Eval) -> now BOTH parts are VERIFIED -> Report Card handoff link & 100% progress button appear!
      await pageSpck.click(
        "button:has-text('🔄 Thử lại riêng phần Đánh giá (1)')"
      );
      await pageSpck.waitForSelector("a:has-text('📋 Mở Phiếu điểm → Quét')");
      await pageSpck.waitForSelector(
        "button:has-text('📈 Cập nhật tiến độ Teaching lên 100%')"
      );
      const rcHref = await pageSpck
        .locator("a:has-text('📋 Mở Phiếu điểm → Quét')")
        .getAttribute("href");
      assert.equal(
        rcHref,
        "/homework-grader?classId=VT-C4K-JSB15&autoScan=1",
        "Report Card handoff link must include classId and autoScan=1"
      );

      // S6-03 (R2-UI25): Editing a Session 14 letter textarea immediately demotes evaluation status -> Report Card handoff disappears
      const firstRowExpandBtn = pageSpck
        .locator("button:has-text('Sửa chi tiết / Cột 2')")
        .first();
      if ((await firstRowExpandBtn.count()) > 0) {
        await firstRowExpandBtn.click();
      }
      const learnedTextarea = pageSpck
        .locator("textarea[placeholder*='học được gì từ MindX']")
        .first();
      if ((await learnedTextarea.count()) > 0) {
        await learnedTextarea.fill("Đã sửa nội dung thư gửi học viên");
        assert.equal(
          await pageSpck.locator("a:has-text('📋 Mở Phiếu điểm → Quét')").count(),
          0,
          "S6-03 (R2-UI25): Editing Session 14 evaluation text must immediately hide Report Card handoff"
        );
      }

      // S6-02 (R2-UI28 / R2-UI29): Unassigning all student rows must hide both 100% progress button and Report Card handoff
      const studentSelects = pageSpck
        .locator("select")
        .filter({ has: pageSpck.locator("option").filter({ hasText: "-- Ghép học viên --" }) });
      const selCount = await studentSelects.count();
      assert.equal(selCount, 2, "Must find 2 student assignment select dropdowns");
      for (let idx = 0; idx < selCount; idx++) {
        await studentSelects.nth(idx).selectOption("");
      }
      assert.equal(
        await pageSpck
          .locator("button:has-text('📈 Cập nhật tiến độ Teaching lên 100%')")
          .count(),
        0,
        "S6-02 (R2-UI28): Unassigning all rows must hide 100% progress button"
      );
      assert.equal(
        await pageSpck.locator("a:has-text('📋 Mở Phiếu điểm → Quét')").count(),
        0,
        "S6-02 (R2-UI29): Unassigning all rows must hide Report Card handoff"
      );

      await pageSpck.close();

      // F05 readiness regression checks inside [S6-T4] browser session:
      // 1) Search input present but table failed to load -> success:false, preserve cache
      // 2) Table shell present with empty tbody + load error -> success:false, preserve cache
      // 3) Class-list GraphQL/API HTTP 500 error with "No classes" table -> success:false, preserve cache
      // 4) Confirmed valid empty table ("No classes" and no load/API error) -> success:true, clear cache to []
      const { ClassSyncer } = await import("../src/lib/playwright/sync-class");
      const { BrowserManager } = await import("../src/lib/playwright/browser-manager");
      const { authService } = await import("../src/lib/playwright/auth");
      const { getRunningClasses } = await import("../src/lib/db/json-config");
      const db = getDb();
      db.prepare("DELETE FROM classes_sessions").run();

      const pageReadiness = await browser.newPage();
      let mockGraphqlError = false;
      await pageReadiness.route("**/*", async (route) => {
        const reqUrl = route.request().url();
        if (reqUrl.includes("lms-api.mindx.edu.vn/graphql")) {
          if (mockGraphqlError) {
            await route.fulfill({
              status: 500,
              contentType: "application/json",
              body: JSON.stringify({ errors: [{ message: "Upstream GraphQL 500" }] }),
            });
          } else {
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({ data: { classes: [] } }),
            });
          }
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: '<html><body><input placeholder="Search classes" /><main>Unable to load classes. Try again.</main></body></html>',
        });
      });
      await pageReadiness.goto("https://lms.mindx.edu.vn/admin/classes");

      const bm = BrowserManager.getInstance();
      const origGetPage = bm.getPage;
      const origEnsureAuth = authService.ensureAuthenticated;
      const origWait = pageReadiness.waitForTimeout;
      (bm as any).getPage = async () => pageReadiness;
      (authService as any).ensureAuthenticated = async () => true;
      (pageReadiness as any).waitForTimeout = async () => {};

      const priorCache = [{ classCode: "VT-JSB87", status: "Running" }];
      try {
        fs.writeFileSync(testRunningClassesPath, JSON.stringify(priorCache), "utf8");
        const r1 = await ClassSyncer.fetchRunningClasses({ persistToConfig: true });
        assert.equal(r1.success, false, "F05-R3-1: Search input with load error must return success:false");
        assert.deepEqual(getRunningClasses(), priorCache, "F05-R3-1: Cache must be preserved on load error");

        fs.writeFileSync(testRunningClassesPath, JSON.stringify(priorCache), "utf8");
        await pageReadiness.setContent(
          "<html><body><table><thead><tr><th>Class</th></tr></thead><tbody></tbody></table><main>Unable to load classes. Try again.</main></body></html>"
        );
        const r2 = await ClassSyncer.fetchRunningClasses({ persistToConfig: true });
        assert.equal(r2.success, false, "F05-R3-2: Empty table shell with load error must return success:false");
        assert.deepEqual(getRunningClasses(), priorCache, "F05-R3-2: Cache must be preserved on empty table shell error");

        fs.writeFileSync(testRunningClassesPath, JSON.stringify(priorCache), "utf8");
        mockGraphqlError = true;
        await pageReadiness.setContent(
          "<html><body><table><tbody><tr><td>No classes</td></tr></tbody></table><script>fetch('https://lms-api.mindx.edu.vn/graphql',{method:'POST',body:JSON.stringify({operationName:'getClasses'})});</script></body></html>"
        );
        const r3 = await ClassSyncer.fetchRunningClasses({ persistToConfig: true });
        assert.equal(r3.success, false, "F05-R3-3: Failed class-list API response must return success:false");
        assert.deepEqual(getRunningClasses(), priorCache, "F05-R3-3: Cache must be preserved when class-list API fails");

        mockGraphqlError = false;
        fs.writeFileSync(testRunningClassesPath, JSON.stringify(priorCache), "utf8");
        await pageReadiness.setContent(
          "<html><body><table><tbody><tr><td>No classes</td></tr></tbody></table></body></html>"
        );
        const r4 = await ClassSyncer.fetchRunningClasses({ persistToConfig: true });
        assert.equal(r4.success, true, "F05-R3-4: Confirmed empty table must return success:true");
        assert.deepEqual(r4.classes, [], "F05-R3-4: Confirmed empty table must return classes:[]");
        assert.deepEqual(getRunningClasses(), [], "F05-R3-4: Confirmed empty table must clear cache to []");

        // F02-1: Failed search input clear must return success:false and preserve cache
        fs.writeFileSync(testRunningClassesPath, JSON.stringify(priorCache), "utf8");
        await pageReadiness.setContent(
          '<html><body><input placeholder="Search classes" value="old"/><button>Clear</button><table><tbody><tr><td>1</td><td>VT-JSB87</td><td>JSB</td><td>VT</td><td>Running</td></tr></tbody></table></body></html>'
        );
        const origLoc = pageReadiness.locator.bind(pageReadiness);
        (pageReadiness as any).locator = (sel: any, ...args: any[]) => {
          const loc = origLoc(sel, ...args);
          if (typeof sel === "string" && sel.includes("input[placeholder")) {
            const origFirst = loc.first.bind(loc);
            loc.first = () => {
              const inp = origFirst();
              (inp as any).fill = async () => {
                throw new Error("simulated fill error");
              };
              return inp;
            };
          }
          return loc;
        };
        try {
          const rFailClear = await ClassSyncer.fetchRunningClasses({ persistToConfig: true });
          assert.equal(rFailClear.success, false, "F02-1: Failed search input clearing must return success:false");
          assert.deepEqual(getRunningClasses(), priorCache, "F02-1: Cache must be preserved when search input cannot be cleared");
        } finally {
          (pageReadiness as any).locator = origLoc;
        }

        // F02-R2: Delayed refresh (4000ms) & unconfirmed refresh (never completes)
        const threeClasses = [
          { classCode: "VT-QA-JSB501", status: "Running" },
          { classCode: "VT-QA-JSB502", status: "Running" },
          { classCode: "VT-QA-JSB503", status: "Running" },
        ];
        const rowHtml = (code: string) =>
          `<tr><td>1</td><td>${code}</td><td>JSB</td><td>VT</td><td>Running</td></tr>`;

        for (const [caseId, readyAfterMs] of [
          ["F02-R2-refresh-completes-at-4000ms", 4000],
          ["F02-R2-refresh-never-completes", Number.POSITIVE_INFINITY],
        ] as const) {
          fs.writeFileSync(testRunningClassesPath, JSON.stringify(threeClasses), "utf8");
          await pageReadiness.setContent(
            `<input placeholder="Search classes" value="old"/><table><tbody>${threeClasses
              .slice(0, 2)
              .map((x) => rowHtml(x.classCode))
              .join("")}</tbody></table>`
          );
          let elapsedMs = 0;
          (pageReadiness as any).waitForTimeout = async (ms: number) => {
            elapsedMs += ms;
            if (elapsedMs >= readyAfterMs) {
              await pageReadiness.locator("tbody").evaluate(
                (el, html) => {
                  el.innerHTML = html;
                },
                threeClasses.map((x) => rowHtml(x.classCode)).join("")
              );
            }
          };
          const resBoundary = await ClassSyncer.fetchRunningClasses({ persistToConfig: true });
          const cachedAfter = getRunningClasses();
          assert.equal(
            cachedAfter.length,
            3,
            `${caseId}: Unconfirmed stale 2-row table must never overwrite 3-class cache`
          );
          if (Number.isFinite(readyAfterMs)) {
            assert.equal(resBoundary.success, true, `${caseId}: Delayed 4000ms refresh must succeed`);
            assert.equal(resBoundary.classes.length, 3, `${caseId}: Must return all 3 classes`);
          } else {
            assert.equal(resBoundary.success, false, `${caseId}: Unconfirmed refresh must return success:false`);
          }
        }
        (pageReadiness as any).waitForTimeout = async () => {};

        // F02-R3: Valid post-clear API confirmation vs non-class / pre-clear stale filtered API response
        const r3Codes = ["VT-QA-JSB601", "VT-QA-JSB602", "VT-QA-JSB603"];
        for (const mode of ["valid-same-table", "non-class-response", "stale-filtered-response"] as const) {
          let elapsedR3 = 0;
          let pendingRoute: any;
          let markRouteSeen!: () => void;
          const routeSeenP = new Promise<void>((resolve) => {
            markRouteSeen = resolve;
          });
          const priorR3 = r3Codes
            .slice(0, mode === "valid-same-table" ? 2 : 3)
            .map((classCode) => ({ classCode, status: "Running" }));
          const tableHtmlR3 = r3Codes.slice(0, 2).map(rowHtml).join("");
          const opName = mode === "non-class-response" ? "getMe" : "getClasses";
          const vars =
            mode === "stale-filtered-response"
              ? { search: "old" }
              : mode === "valid-same-table"
                ? { search: "" }
                : {};
          const respBody =
            mode === "non-class-response"
              ? { data: { me: { id: "SYNTHETIC_TEACHER" } } }
              : {
                  data: {
                    classes: r3Codes
                      .slice(0, 2)
                      .map((classCode) => ({ classCode, status: "Running" })),
                  },
                };
          await pageReadiness.unrouteAll({ behavior: "wait" });
          await pageReadiness.route("**/*", async (route) => {
            if (route.request().resourceType() === "document") {
              await route.fulfill({
                status: 200,
                contentType: "text/html",
                body: '<meta charset="utf-8"><body></body>',
              });
            } else if (route.request().url() === "https://lms-api.mindx.edu.vn/graphql") {
              pendingRoute = route;
              markRouteSeen();
            } else {
              await route.abort();
            }
          });
          await pageReadiness.goto("https://lms.mindx.edu.vn/admin/classes");
          await pageReadiness.setContent(
            `<input placeholder="Search classes" value="old"><table><tbody>${tableHtmlR3}</tbody></table>`
          );
          await pageReadiness.evaluate(
            ({ opName, vars, mode, tableHtmlR3 }) => {
              (window as any).__done = false;
              (window as any).__start = () => {
                void fetch("https://lms-api.mindx.edu.vn/graphql", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ operationName: opName, variables: vars }),
                })
                  .then((r) => r.json())
                  .then(() => {
                    if (mode === "valid-same-table") {
                      document.querySelector("tbody")!.innerHTML = tableHtmlR3;
                    }
                    (window as any).__done = true;
                  });
              };
              if (mode !== "stale-filtered-response") {
                document.querySelector("input")!.addEventListener("keydown", (e) => {
                  if ((e as KeyboardEvent).key === "Enter") (window as any).__start();
                });
              }
            },
            { opName, vars, mode, tableHtmlR3 }
          );
          fs.writeFileSync(testRunningClassesPath, JSON.stringify(priorR3), "utf8");
          (authService as any).ensureAuthenticated = async () => {
            if (mode === "stale-filtered-response") {
              await pageReadiness.evaluate(() => (window as any).__start());
              await routeSeenP;
            }
            return true;
          };
          (pageReadiness as any).waitForTimeout = async (ms: number) => {
            elapsedR3 += ms;
            if (elapsedR3 === 400) {
              await routeSeenP;
              await pendingRoute.fulfill({
                status: 200,
                contentType: "application/json",
                headers: { "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify(respBody),
              });
              await pageReadiness.waitForFunction(() => (window as any).__done === true);
            }
          };
          const resR3 = await ClassSyncer.fetchRunningClasses({ persistToConfig: true });
          const cacheR3 = getRunningClasses();
          if (mode === "valid-same-table") {
            assert.equal(resR3.success, true, `F02-R3-${mode}: Valid post-clear response must succeed`);
            assert.equal(cacheR3.length, 2, `F02-R3-${mode}: Cache must have 2 classes`);
          } else {
            assert.equal(
              resR3.success,
              false,
              `F02-R3-${mode}: Non-class or pre-clear stale filtered response must fail`
            );
            assert.equal(
              cacheR3.length,
              3,
              `F02-R3-${mode}: Cache must retain all 3 classes`
            );
          }
        }
        (authService as any).ensureAuthenticated = async () => true;
        (pageReadiness as any).waitForTimeout = async () => {};

        // F02-R4: Exact API-to-DOM correspondence & stale response mutating DOM
        const r4Codes = ["VT-QA-JSB701", "VT-QA-JSB711", "VT-QA-JSB721"];
        for (const r4Mode of [
          "empty-class-array",
          "id-only-array",
          "api-subset-of-stale-dom",
          "api-codes-only-prefix-match",
          "stale-response-changes-dom",
        ] as const) {
          let elapsedR4 = 0;
          let pendingR4: any;
          let markR4Seen!: () => void;
          const r4SeenP = new Promise<void>((resolve) => {
            markR4Seen = resolve;
          });
          const priorR4 = r4Codes.map((classCode) => ({ classCode, status: "Running" }));
          const tableHtmlR4 = r4Codes.slice(0, 2).map(rowHtml).join("");
          const varsR4 =
            r4Mode === "stale-response-changes-dom" ? { search: "old" } : { search: "" };
          const classesPayload =
            r4Mode === "empty-class-array"
              ? []
              : r4Mode === "id-only-array"
                ? [{ id: "SYNTHETIC_CLASS" }]
                : r4Mode === "api-subset-of-stale-dom" || r4Mode === "stale-response-changes-dom"
                  ? [{ classCode: r4Codes[0], status: "Running" }]
                  : [
                      { classCode: "VT-QA-JSB70", status: "Running" },
                      { classCode: "VT-QA-JSB71", status: "Running" },
                    ];
          const respBodyR4 = { data: { classes: classesPayload } };
          await pageReadiness.unrouteAll({ behavior: "wait" });
          await pageReadiness.route("**/*", async (route) => {
            if (route.request().resourceType() === "document") {
              await route.fulfill({
                status: 200,
                contentType: "text/html",
                body: '<meta charset="utf-8"><body></body>',
              });
            } else if (route.request().url() === "https://lms-api.mindx.edu.vn/graphql") {
              pendingR4 = route;
              markR4Seen();
            } else {
              await route.abort();
            }
          });
          await pageReadiness.goto("https://lms.mindx.edu.vn/admin/classes");
          await pageReadiness.setContent(
            `<input placeholder="Search classes" value="old"><table><tbody>${tableHtmlR4}</tbody></table>`
          );
          await pageReadiness.evaluate(
            ({ varsR4, r4Mode }) => {
              (window as any).__done = false;
              (window as any).__start = () => {
                void fetch("https://lms-api.mindx.edu.vn/graphql", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ operationName: "getClasses", variables: varsR4 }),
                })
                  .then((r) => r.json())
                  .then(() => {
                    if (r4Mode === "stale-response-changes-dom") {
                      document.querySelector("tbody tr:last-child")?.remove();
                    }
                    (window as any).__done = true;
                  });
              };
              if (r4Mode !== "stale-response-changes-dom") {
                document.querySelector("input")!.addEventListener("keydown", (e) => {
                  if ((e as KeyboardEvent).key === "Enter") (window as any).__start();
                });
              }
            },
            { varsR4, r4Mode }
          );
          fs.writeFileSync(testRunningClassesPath, JSON.stringify(priorR4), "utf8");
          const beforeBytes = fs.readFileSync(testRunningClassesPath);
          (authService as any).ensureAuthenticated = async () => {
            if (r4Mode === "stale-response-changes-dom") {
              await pageReadiness.evaluate(() => (window as any).__start());
              await r4SeenP;
            }
            return true;
          };
          (pageReadiness as any).waitForTimeout = async (ms: number) => {
            elapsedR4 += ms;
            if (elapsedR4 === 400) {
              await r4SeenP;
              await pendingR4.fulfill({
                status: 200,
                contentType: "application/json",
                headers: { "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify(respBodyR4),
              });
              await pageReadiness.waitForFunction(() => (window as any).__done === true);
            }
          };
          const resR4 = await ClassSyncer.fetchRunningClasses({ persistToConfig: true });
          const afterBytes = fs.readFileSync(testRunningClassesPath);
          assert.equal(resR4.success, false, `F02-R4-${r4Mode}: Must return success:false`);
          assert.equal(
            beforeBytes.equals(afterBytes),
            true,
            `F02-R4-${r4Mode}: Must preserve exact bytes of 3-class cache`
          );
        }
        (authService as any).ensureAuthenticated = async () => true;
        (pageReadiness as any).waitForTimeout = async () => {};
      } finally {
        bm.getPage = origGetPage;
        authService.ensureAuthenticated = origEnsureAuth;
        pageReadiness.waitForTimeout = origWait;
        await pageReadiness.close();
      }
    } finally {
      await browser.close();
    }

    console.log(
      "  -> PASS [S6-T4]: UI Màn 5 (1 nút Cập nhật theo buổi + Nâng cao) & Màn 3 (Thẻ gợi ý Tiến độ + Mở Phiếu điểm) hoạt động hoàn hảo.\n"
    );
  }

  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {}

  console.log("==========================================================");
  console.log("🎉 TẤT CẢ CÁC BÀI KIỂM THỬ GIAI ĐOẠN S6 ĐỀU PASS 100%!");
  console.log("==========================================================");
}

runTests().catch((err) => {
  console.error("❌ TEST GIAI ĐOẠN S6 THẤT BẠI:", err);
  process.exit(1);
});
