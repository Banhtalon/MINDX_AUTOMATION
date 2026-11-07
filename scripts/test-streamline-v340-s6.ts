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
import { getDb } from "../src/lib/db/sqlite";
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
           lastVerifiedAt = '2026-11-06 20:50:42',
           lastVerifiedHash = 'hash_verified_12'
       WHERE classId = 'VT-C4K-JSB12' AND studentId = 'STU_1' AND sessionNumber = 12`
    ).run();

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
