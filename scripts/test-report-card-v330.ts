/**
 * MINDX AUTOMATION BOT — AUTOMATED TEST SUITE FOR PHASE 9 (v3.3.0)
 * Teaching Report Card (BTVN, Checkpoint 1 & 2, Final DEMO & Teaching Sync)
 * Runs strictly on an isolated temporary SQLite database (MINDX_DB_PATH).
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";

const prodDbPath = path.resolve(process.cwd(), "data/mindx_bot.db");
const prodRunningClassesPath = path.resolve(process.cwd(), "data/running_classes.json");

const tempBaseRoot = process.env.MINDX_DB_PATH
  ? path.dirname(path.resolve(process.env.MINDX_DB_PATH))
  : os.tmpdir();
const tempDir = fs.mkdtempSync(path.join(tempBaseRoot, "mindx_test_rc_v330_"));
const tempDbPath = path.join(tempDir, "test_mindx_rc_v330.db");
const tempRunningClassesPath = path.join(tempDir, "running_classes.json");
assert.notEqual(path.resolve(tempDbPath), prodDbPath);
assert.notEqual(path.resolve(tempRunningClassesPath), prodRunningClassesPath);
process.env.MINDX_DB_PATH = tempDbPath;
process.env.MINDX_RUNNING_CLASSES_PATH = tempRunningClassesPath;

import { config } from "../src/lib/config";
if (!config.allowedLocalDirs.includes(tempDir)) {
  config.allowedLocalDirs.push(tempDir);
}
if (!config.allowedLocalDirs.includes(tempBaseRoot)) {
  config.allowedLocalDirs.push(tempBaseRoot);
}

import {
  closeDb,
  computeReportCardContentHash,
  getDb,
  isRoboticsClassCode,
  parseManualOverridesMap,
  parseReportCardLmsSnapshot,
  reportCardRepo,
  scoreMatrixRepo,
  session14EvalRepo,
  studentRepo,
} from "../src/lib/db/sqlite";
import { ScoreScraper } from "../src/lib/playwright/scrape-scores";
import {
  matchReportCardStudentsToTeaching,
  parseStrictFiniteScore,
  TeachingReportCardSyncService,
  type AddMultiExercisePayload,
  type RemoteTeachingExercise,
  type RemoteTeachingScoreRow,
  type TeachingReportCardHttpTransport,
  type TeachingScoreInputItem,
} from "../src/lib/playwright/teaching-report-card-sync";
import { NextRequest } from "next/server";
import {
  GET as reportCardGET,
  POST as reportCardPOST,
  PUT as reportCardPUT,
} from "../src/app/api/report-card/route";
import { POST as reportCardSyncPOST } from "../src/app/api/report-card/sync-teaching/route";
import * as calculatorMod from "../src/lib/report-card/report-card-calculator";
import {
  computeCheckpointStage,
  computeClassReportCard,
  computeFinalStage,
  computeOverallSummary,
  formatScore2,
  isValidOverrideFieldKey,
  makeOverrideKey,
  normalizeScoreToScale5,
  round2,
  type ClassReportCardLmsSnapshot,
} from "../src/lib/report-card/report-card-calculator";

async function runTests() {
  console.log("==========================================================");
  console.log("🚀 RUNNING PHASE 9 (v3.3.0) REPORT CARD TEST SUITE");
  console.log("==========================================================");

  try {
    // ========================================================================
    // RC-01: Mathematical Oracle — Exact Match with VT-C4K-GB40 & VT-C4K-GA22
    // ========================================================================
    console.log("\n[RC-01] Checking exact mathematical match against VT-C4K-GB40 & VT-C4K-GA22...");

    const gb40Snapshot: ClassReportCardLmsSnapshot = {
      classId: "VT-C4K-GB40",
      classCode: "VT-C4K-GB40",
      isRobotics: false,
      scrapedAt: "2026-10-29T00:00:00.000Z",
      btvnSessions: [1, 2, 3, 4, 6, 7, 8].map((s) => ({
        sessionNumber: s,
        title: `Buổi ${s}`,
        hasTheory: true,
        hasPractice: true,
        practiceTaskCount: 1,
        maxTheoryScore: 5,
        maxPracticeScore: 5,
      })),
      students: [
        {
          studentId: "GB40_01",
          fullName: "Đỗ Đông Quân",
          isActive: true,
          btvnScores: {
            1: { sessionNumber: 1, theoryRaw: 3.5, theoryMax: 5, practiceRaw: 4, practiceMax: 5 },
            2: { sessionNumber: 2, theoryRaw: 3, theoryMax: 5, practiceRaw: 5, practiceMax: 5 },
            3: { sessionNumber: 3, theoryRaw: 2.5, theoryMax: 5, practiceRaw: 5, practiceMax: 5 },
          },
          stageScores: {
            cp1Theory: 3.5,
            cp1Practice: 4.0,
            cp1Competency: 4.0,
            cp2Theory: 3.0,
            cp2Practice: 5.0,
            cp2Competency: 4.11,
            finalProduct: null,
            finalCompetency: null,
          },
        },
        {
          studentId: "GB40_02",
          fullName: "Mai Quang Nghị",
          isActive: true,
          btvnScores: {},
          stageScores: {
            cp1Theory: 3.5,
            cp1Practice: 3.5,
            cp1Competency: 3.67,
            cp2Theory: 3.0,
            cp2Practice: 3.0,
            cp2Competency: 3.67,
            finalProduct: null,
            finalCompetency: null,
          },
        },
        {
          studentId: "GB40_03",
          fullName: "Nguyễn Công Gia Bảo",
          isActive: true,
          btvnScores: {},
          stageScores: {
            cp1Theory: 2.5,
            cp1Practice: 3.0,
            cp1Competency: 3.56,
            cp2Theory: 2.5,
            cp2Practice: 3.0,
            cp2Competency: 3.11,
            finalProduct: null,
            finalCompetency: null,
          },
        },
        {
          studentId: "GB40_04",
          fullName: "Nguyễn Đức Khoa",
          isActive: true,
          btvnScores: {},
          stageScores: {
            cp1Theory: 3.5,
            cp1Practice: 5.0,
            cp1Competency: 4.56,
            cp2Theory: 4.5,
            cp2Practice: 5.0,
            cp2Competency: 4.56,
            finalProduct: null,
            finalCompetency: null,
          },
        },
        {
          studentId: "GB40_05",
          fullName: "Nguyễn Hải An",
          isActive: true,
          btvnScores: {},
          stageScores: {
            cp1Theory: 4.0,
            cp1Practice: 3.75,
            cp1Competency: 4.56,
            cp2Theory: 3.0,
            cp2Practice: 4.1,
            cp2Competency: 4.33,
            finalProduct: null,
            finalCompetency: null,
          },
        },
        {
          studentId: "GB40_06",
          fullName: "Phạm Trường Sơn",
          isActive: true,
          btvnScores: {},
          stageScores: {
            cp1Theory: null,
            cp1Practice: null,
            cp1Competency: null,
            cp2Theory: null,
            cp2Practice: null,
            cp2Competency: null,
            finalProduct: null,
            finalCompetency: null,
          },
        },
        {
          studentId: "GB40_07",
          fullName: "Trần Hoàng Đăng Khôi",
          isActive: true,
          btvnScores: {},
          stageScores: {
            cp1Theory: 4.5,
            cp1Practice: 4.75,
            cp1Competency: 4.67,
            cp2Theory: 4.5,
            cp2Practice: 5.0,
            cp2Competency: 4.33,
            finalProduct: null,
            finalCompetency: null,
          },
        },
        {
          studentId: "GB40_08",
          fullName: "Vũ Duy Bảo",
          isActive: true,
          btvnScores: {},
          stageScores: {
            cp1Theory: 4.0,
            cp1Practice: 4.0,
            cp1Competency: 3.56,
            cp2Theory: 3.5,
            cp2Practice: 3.5,
            cp2Competency: 3.33,
            finalProduct: null,
            finalCompetency: null,
          },
        },
        {
          studentId: "GB40_09",
          fullName: "Vũ Minh Hà",
          isActive: true,
          btvnScores: {},
          stageScores: {
            cp1Theory: 3.0,
            cp1Practice: 3.0,
            cp1Competency: 3.11,
            cp2Theory: null,
            cp2Practice: null,
            cp2Competency: null,
            finalProduct: null,
            finalCompetency: null,
          },
        },
      ],
    };

    const gb40Computed = computeClassReportCard(gb40Snapshot);
    const expectedGb40 = [
      { name: "Đỗ Đông Quân", cp1: 3.9, cp2: 4.07, final: null, tbck: 1.59, xepLoai: "Chưa đạt", hang: "Hạng D", cls: "rank-d", cp1ChartAvg: 3.83 },
      { name: "Mai Quang Nghị", cp1: 3.6, cp2: 3.4, final: null, tbck: 1.4, xepLoai: "Chưa đạt", hang: "Hạng D", cls: "rank-d", cp1ChartAvg: 3.56 },
      { name: "Nguyễn Công Gia Bảo", cp1: 3.24, cp2: 2.97, final: null, tbck: 1.24, xepLoai: "Chưa đạt", hang: "Hạng D", cls: "rank-d", cp1ChartAvg: 3.02 },
      { name: "Nguyễn Đức Khoa", cp1: 4.44, cp2: 4.64, final: null, tbck: 1.82, xepLoai: "Chưa đạt", hang: "Hạng D", cls: "rank-d", cp1ChartAvg: 4.35 },
      { name: "Nguyễn Hải An", cp1: 4.29, cp2: 4.02, final: null, tbck: 1.66, xepLoai: "Chưa đạt", hang: "Hạng D", cls: "rank-d", cp1ChartAvg: 4.1 },
      { name: "Phạm Trường Sơn", cp1: null, cp2: null, final: null, tbck: null, xepLoai: "", hang: "", cls: "", cp1ChartAvg: null },
      { name: "Trần Hoàng Đăng Khôi", cp1: 4.65, cp2: 4.5, final: null, tbck: 1.83, xepLoai: "Chưa đạt", hang: "Hạng D", cls: "rank-d", cp1ChartAvg: 4.64 },
      { name: "Vũ Duy Bảo", cp1: 3.74, cp2: 3.4, final: null, tbck: 1.43, xepLoai: "Chưa đạt", hang: "Hạng D", cls: "rank-d", cp1ChartAvg: 3.85 },
      { name: "Vũ Minh Hà", cp1: 3.07, cp2: null, final: null, tbck: 1.23, xepLoai: "Chưa đạt", hang: "Hạng D", cls: "rank-d", cp1ChartAvg: 3.04 },
    ];

    for (let i = 0; i < expectedGb40.length; i++) {
      const actual = gb40Computed.students[i];
      const exp = expectedGb40[i];
      assert.equal(actual.fullName, exp.name);
      assert.equal(actual.cp1.total, exp.cp1, `CP1 mismatch for ${exp.name}`);
      assert.equal(actual.cp2.total, exp.cp2, `CP2 mismatch for ${exp.name}`);
      assert.equal(actual.final.total, exp.final, `Final mismatch for ${exp.name}`);
      assert.equal(actual.tbck, exp.tbck, `TBCK mismatch for ${exp.name}`);
      assert.equal(actual.xepLoai, exp.xepLoai, `Xếp loại mismatch for ${exp.name}`);
      assert.equal(actual.hang, exp.hang, `Hạng mismatch for ${exp.name}`);
      assert.equal(actual.rowRankClass, exp.cls, `Row class mismatch for ${exp.name}`);
      assert.equal(actual.cp1.chartAvg, exp.cp1ChartAvg, `CP1 Chart Avg mismatch for ${exp.name}`);
    }

    // Check Đỗ Đông Quân BTVN: 6/14 submitted, avg = (3.5 + 4 + 3 + 5 + 2.5 + 5)/6 = 23/6 = 3.83
    assert.equal(gb40Computed.students[0].submittedCount, 6);
    assert.equal(gb40Computed.students[0].totalAssignedItems, 14);
    assert.equal(gb40Computed.students[0].btvnAvgNorm, 3.83);

    // Check VT-C4K-GA22 (Full CP1 + CP2 + Final DEMO)
    const ga22Rows = [
      {
        name: "Bùi Hoàng Nhu",
        scores: { cp1Theory: 3, cp1Practice: 4, cp1Competency: 3.89, cp2Theory: 1.25, cp2Practice: 4, cp2Competency: 3.55, finalProduct: 3, finalCompetency: 4 },
        exp: { cp1: 3.73, cp2: 3.18, final: 3.4, tbck: 3.42, xepLoai: "Đạt", hang: "Hạng C", cls: "rank-c" },
      },
      {
        name: "Hoàng Minh Khang",
        scores: { cp1Theory: 4, cp1Practice: 3, cp1Competency: 4.5, cp2Theory: 4, cp2Practice: 4, cp2Competency: 3, finalProduct: 3, finalCompetency: 2 },
        exp: { cp1: 4.1, cp2: 3.4, final: 2.6, tbck: 3.06, xepLoai: "Đạt", hang: "Hạng C", cls: "rank-c" },
      },
      {
        name: "Lưu Minh Triết",
        scores: { cp1Theory: 2.5, cp1Practice: 5, cp1Competency: 4.11, cp2Theory: 4, cp2Practice: 4, cp2Competency: 4, finalProduct: 5, finalCompetency: 5 },
        exp: { cp1: 3.97, cp2: 4.0, final: 5.0, tbck: 4.59, xepLoai: "Xuất sắc", hang: "Hạng A", cls: "rank-a" },
      },
      {
        name: "Nguyễn Hải Đăng",
        scores: { cp1Theory: 2.2, cp1Practice: 5, cp1Competency: 3, cp2Theory: 5, cp2Practice: 5, cp2Competency: 5, finalProduct: 1, finalCompetency: 4 },
        exp: { cp1: 3.24, cp2: 5.0, final: 2.2, tbck: 2.97, xepLoai: "Đạt", hang: "Hạng C", cls: "rank-c" },
      },
      {
        name: "Trần Quang Vũ",
        scores: { cp1Theory: 3, cp1Practice: 3, cp1Competency: 2.7, cp2Theory: 3, cp2Practice: 3, cp2Competency: 3, finalProduct: 4, finalCompetency: 4 },
        exp: { cp1: 2.82, cp2: 3.0, final: 4.0, tbck: 3.56, xepLoai: "Đạt", hang: "Hạng C", cls: "rank-c" },
      },
      {
        name: "VÕ MINH HOÀNG",
        scores: { cp1Theory: 3, cp1Practice: 3, cp1Competency: 4, cp2Theory: 2, cp2Practice: 2, cp2Competency: 2, finalProduct: 2, finalCompetency: 0 },
        exp: { cp1: 3.6, cp2: 2.0, final: 1.2, tbck: 1.84, xepLoai: "Chưa đạt", hang: "Hạng D", cls: "rank-d" },
      },
    ];

    for (const item of ga22Rows) {
      const cp1 = computeCheckpointStage(item.scores.cp1Theory, item.scores.cp1Practice, item.scores.cp1Competency);
      const cp2 = computeCheckpointStage(item.scores.cp2Theory, item.scores.cp2Practice, item.scores.cp2Competency);
      const fin = computeFinalStage(item.scores.finalProduct, item.scores.finalCompetency);
      const ov = computeOverallSummary({
        totalCP1: cp1.total,
        totalCP2: cp2.total,
        totalFinal: fin.total,
        ...item.scores,
      });
      assert.equal(cp1.total, item.exp.cp1, `GA22 CP1 mismatch for ${item.name}`);
      assert.equal(cp2.total, item.exp.cp2, `GA22 CP2 mismatch for ${item.name}`);
      assert.equal(fin.total, item.exp.final, `GA22 Final mismatch for ${item.name}`);
      assert.equal(ov.tbck, item.exp.tbck, `GA22 TBCK mismatch for ${item.name}`);
      assert.equal(ov.xepLoai, item.exp.xepLoai, `GA22 Xếp loại mismatch for ${item.name}`);
      assert.equal(ov.hang, item.exp.hang, `GA22 Hạng mismatch for ${item.name}`);
      assert.equal(ov.rowRankClass, item.exp.cls, `GA22 Row class mismatch for ${item.name}`);
    }

    // Verify Rank B (4.0 <= TBCK < 4.5 with all 8 columns > 0) vs downgrade to Rank C when 1 column is missing or 0
    const rankBFull = computeOverallSummary({
      totalCP1: 4.2,
      totalCP2: 4.2,
      totalFinal: 4.2,
      cp1Theory: 4,
      cp1Practice: 4,
      cp1Competency: 4.33,
      cp2Theory: 4,
      cp2Practice: 4,
      cp2Competency: 4.33,
      finalProduct: 4.2,
      finalCompetency: 4.2,
    });
    assert.equal(rankBFull.tbck, 4.2);
    assert.equal(rankBFull.hang, "Hạng B");
    assert.equal(rankBFull.xepLoai, "Tốt");

    const rankDowngradedMissingCol = computeOverallSummary({
      totalCP1: 4.5,
      totalCP2: 4.5,
      totalFinal: 5.0,
      cp1Theory: null, // missing 1 column
      cp1Practice: 4.5,
      cp1Competency: 4.5,
      cp2Theory: 4.5,
      cp2Practice: 4.5,
      cp2Competency: 4.5,
      finalProduct: 5,
      finalCompetency: 5,
    });
    assert.equal(rankDowngradedMissingCol.tbck, 4.8);
    assert.equal(rankDowngradedMissingCol.hang, "Hạng C");
    assert.equal(rankDowngradedMissingCol.xepLoai, "Đạt");

    // [F06 Regression] Decimal half-up boundary ties (e.g. 4.015 -> 4.02, 80.30/100 -> 4.02)
    assert.equal(round2(4.015), 4.02, "F06: round2(4.015) must be 4.02");
    assert.equal(round2(2.005), 2.01, "F06: round2(2.005) must be 2.01");
    assert.equal(round2(1.005), 1.01, "F06: round2(1.005) must be 1.01");
    assert.equal(round2(3.555), 3.56, "F06: round2(3.555) must be 3.56");
    assert.equal(normalizeScoreToScale5(80.3, 100), 4.02, "F06: normalizeScoreToScale5(80.3, 100) must be 4.02");

    console.log("✅ [RC-01] Mathematical Oracle (VT-C4K-GB40 & VT-C4K-GA22 + F06 ties) PASSED 100%!");

    // ========================================================================
    // RC-02: Robotics Class & Dynamic BTVN Session Filtering
    // ========================================================================
    console.log("\n[RC-02] Checking Robotics report card & dynamic BTVN filtering...");

    const filteredGb40 = computeClassReportCard(gb40Snapshot, {}, { selectedBtvnSessions: [1, 2] });
    assert.equal(filteredGb40.activeBtvnSessionNumbers.length, 2);
    assert.equal(filteredGb40.students[0].submittedCount, 4);
    assert.equal(filteredGb40.students[0].totalAssignedItems, 4);
    assert.equal(filteredGb40.students[0].btvnAvgNorm, round2((3.5 + 4 + 3 + 5) / 4));

    const roboticsSnapshot: ClassReportCardLmsSnapshot = {
      classId: "VT-ROB-ARMA13",
      classCode: "VT-ROB-ARMA13",
      isRobotics: true,
      btvnSessions: [],
      scrapedAt: "2026-10-29T00:00:00.000Z",
      students: [
        {
          studentId: "ROB_01",
          fullName: "Nguyễn Minh Khôi",
          isActive: true,
          btvnScores: {},
          stageScores: {
            cp1Theory: 4.0,
            cp1Practice: 4.5,
            cp1Competency: 4.0,
            cp2Theory: 4.5,
            cp2Practice: 4.5,
            cp2Competency: 4.22,
            finalProduct: 4.5,
            finalCompetency: 4.33,
          },
        },
      ],
    };
    const robComputed = computeClassReportCard(roboticsSnapshot);
    assert.equal(robComputed.isRobotics, true);
    assert.equal(robComputed.showBtvnBlock, false);
    assert.equal(robComputed.students[0].hang, "Hạng B");
    console.log("✅ [RC-02] Robotics & dynamic BTVN filtering PASSED 100%!");

    // ========================================================================
    // RC-03: SQLite reportCardRepo — Overrides, Versioning & Drift Detection
    // ========================================================================
    console.log("\n[RC-03] Checking SQLite reportCardRepo overrides, version locking & drift...");

    studentRepo.upsert({ studentId: "GB40_01", classId: "VT-C4K-GB40", fullName: "Đỗ Đông Quân", isActive: 1 });
    studentRepo.upsert({ studentId: "GB40_02", classId: "VT-C4K-GB40", fullName: "Mai Quang Nghị", isActive: 1 });

    const savedRec1 = reportCardRepo.saveLmsSnapshot("VT-C4K-GB40", gb40Snapshot);
    assert.equal(savedRec1.classId, "VT-C4K-GB40");
    assert.equal(savedRec1.draftVersion, 2);

    // Reject missing expectedVersion
    const missingVerRes = reportCardRepo.saveManualOverrides({
      classId: "VT-C4K-GB40",
      updates: [{ studentId: "GB40_01", fieldKey: "final_practice", normScore: 4.5 }],
    });
    assert.equal(missingVerRes.success, false);

    // Reject stale expectedVersion
    const staleVerRes = reportCardRepo.saveManualOverrides({
      classId: "VT-C4K-GB40",
      expectedVersion: 1,
      updates: [{ studentId: "GB40_01", fieldKey: "final_practice", normScore: 4.5 }],
    });
    assert.equal(staleVerRes.success, false);
    assert.equal(staleVerRes.conflict, true);

    // Reject invalid score (> 5)
    const invalidScoreRes = reportCardRepo.saveManualOverrides({
      classId: "VT-C4K-GB40",
      expectedVersion: 2,
      updates: [{ studentId: "GB40_01", fieldKey: "final_practice", normScore: 5.5 }],
    });
    assert.equal(invalidScoreRes.success, false);

    // Valid override on final_practice & final_nang_luc for GB40_01
    const okOverrideRes = reportCardRepo.saveManualOverrides({
      classId: "VT-C4K-GB40",
      expectedVersion: 2,
      updates: [
        { studentId: "GB40_01", fieldKey: "final_practice", normScore: 4.5, note: "Điểm Demo bổ sung" },
        { studentId: "GB40_01", fieldKey: "final_nang_luc", normScore: 4.2 },
      ],
    });
    assert.equal(okOverrideRes.success, true);
    assert.equal(okOverrideRes.record.draftVersion, 3);

    // Approve report card
    const approvedRes = reportCardRepo.approveReportCard("VT-C4K-GB40", 3);
    assert.equal(approvedRes.success, true);
    assert.equal(approvedRes.record.status, "APPROVED");
    const approvedHash = approvedRes.record.contentHash;
    assert.ok(approvedHash.length === 64);

    // Mark syncing & verified
    reportCardRepo.markSyncingTeaching("VT-C4K-GB40", approvedHash);
    const verifiedRec = reportCardRepo.markTeachingVerified("VT-C4K-GB40", approvedHash, { syncedCount: 9 });
    assert.equal(verifiedRec.status, "VERIFIED");
    assert.equal(verifiedRec.teachingSyncStatus, "VERIFIED");

    // Re-scraping LMS preserves teacher manual overrides!
    const rescrapedRec = reportCardRepo.saveLmsSnapshot("VT-C4K-GB40", gb40Snapshot);
    const overridesAfterRescrape = parseManualOverridesMap(rescrapedRec.manualOverridesJson);
    assert.equal(overridesAfterRescrape[makeOverrideKey("GB40_01", "final_practice")]?.normScore, 4.5);
    assert.equal(overridesAfterRescrape[makeOverrideKey("GB40_01", "final_nang_luc")]?.normScore, 4.2);
    // Since effective scores didn't change on identical rescrape, status stays VERIFIED
    assert.equal(rescrapedRec.status, "VERIFIED");

    // Modifying an override after VERIFIED automatically demotes status to WAITING_APPROVAL & OUT_OF_SYNC
    const driftRes = reportCardRepo.saveManualOverrides({
      classId: "VT-C4K-GB40",
      expectedVersion: rescrapedRec.draftVersion,
      updates: [{ studentId: "GB40_01", fieldKey: "final_practice", normScore: 5.0 }],
    });
    assert.equal(driftRes.success, true);
    assert.equal(driftRes.record.status, "WAITING_APPROVAL");
    assert.equal(driftRes.record.teachingSyncStatus, "OUT_OF_SYNC");
    assert.equal(driftRes.record.contentHash, "");

    // Restore single overridden field back to LMS value
    const restoreRes = reportCardRepo.restoreLmsValues({
      classId: "VT-C4K-GB40",
      expectedVersion: driftRes.record.draftVersion,
      studentId: "GB40_01",
      fieldKey: "final_practice",
    });
    assert.equal(restoreRes.success, true);
    const afterRestoreMap = parseManualOverridesMap(restoreRes.record.manualOverridesJson);
    assert.equal(afterRestoreMap[makeOverrideKey("GB40_01", "final_practice")], undefined);
    assert.equal(afterRestoreMap[makeOverrideKey("GB40_01", "final_nang_luc")]?.normScore, 4.2);

    // [F02 Regression] Valid & invalid BTVN overrides on 100-scale + stage maxScore validation
    const curVerBeforeF02 = restoreRes.record.draftVersion;
    const f02NegRaw = reportCardRepo.saveManualOverrides({
      classId: "VT-C4K-GB40",
      expectedVersion: curVerBeforeF02,
      updates: [{ studentId: "GB40_01", fieldKey: "btvn_1_theory", normScore: 5, rawScore: -10, maxScore: 100 }],
    });
    assert.equal(f02NegRaw.success, false, "F02: Must reject negative rawScore");
    assert.match(String(f02NegRaw.error || ""), /rawScore=-10/);

    const f02ContradictRaw = reportCardRepo.saveManualOverrides({
      classId: "VT-C4K-GB40",
      expectedVersion: curVerBeforeF02,
      updates: [{ studentId: "GB40_01", fieldKey: "btvn_1_theory", normScore: 5, rawScore: 40, maxScore: 100 }],
    });
    assert.equal(f02ContradictRaw.success, false, "F02: Must reject rawScore contradicting normScore");
    assert.match(String(f02ContradictRaw.error || ""), /mâu thuẫn/);

    const f02InvalidStageMax = reportCardRepo.saveManualOverrides({
      classId: "VT-C4K-GB40",
      expectedVersion: curVerBeforeF02,
      updates: [{ studentId: "GB40_01", fieldKey: "cp1_theory", normScore: 4, rawScore: 4, maxScore: 100 }],
    });
    assert.equal(f02InvalidStageMax.success, false, "F02: Stage fields must reject maxScore !== 5");
    assert.match(String(f02InvalidStageMax.error || ""), /thang điểm tối đa là 5/);

    const f02RawWithNullNorm = reportCardRepo.saveManualOverrides({
      classId: "VT-C4K-GB40",
      expectedVersion: curVerBeforeF02,
      updates: [{ studentId: "GB40_01", fieldKey: "btvn_1_theory", normScore: null, rawScore: 50, maxScore: 100 }],
    });
    assert.equal(f02RawWithNullNorm.success, false, "F02: Must reject non-null rawScore when normScore is null");
    assert.match(String(f02RawWithNullNorm.error || ""), /normScore\) là null/);

    // Valid BTVN overrides on 100-scale (both explicit rawScore=80/100 and derived rawScore from normScore=4/maxScore=100)
    const f02ValidBtvn = reportCardRepo.saveManualOverrides({
      classId: "VT-C4K-GB40",
      expectedVersion: curVerBeforeF02,
      updates: [
        { studentId: "GB40_01", fieldKey: "btvn_1_theory", normScore: 4, rawScore: 80, maxScore: 100 },
        { studentId: "GB40_01", fieldKey: "btvn_1_practice", normScore: 4, maxScore: 100 },
      ],
    });
    assert.equal(f02ValidBtvn.success, true, "F02: Valid BTVN 100-scale override must succeed");
    const parsedF02Map = parseManualOverridesMap(f02ValidBtvn.record.manualOverridesJson);
    assert.equal(parsedF02Map[makeOverrideKey("GB40_01", "btvn_1_theory")]?.rawScore, 80);
    assert.equal(parsedF02Map[makeOverrideKey("GB40_01", "btvn_1_theory")]?.maxScore, 100);
    assert.equal(parsedF02Map[makeOverrideKey("GB40_01", "btvn_1_practice")]?.rawScore, 80);
    assert.equal(parsedF02Map[makeOverrideKey("GB40_01", "btvn_1_practice")]?.maxScore, 100);

    // Restore BTVN overrides before continuing
    const restoreF02Btvn1 = reportCardRepo.restoreLmsValues({
      classId: "VT-C4K-GB40",
      expectedVersion: f02ValidBtvn.record.draftVersion,
      studentId: "GB40_01",
      fieldKey: "btvn_1_theory",
    });
    assert.equal(restoreF02Btvn1.success, true);
    const restoreF02Btvn2 = reportCardRepo.restoreLmsValues({
      classId: "VT-C4K-GB40",
      expectedVersion: restoreF02Btvn1.record.draftVersion,
      studentId: "GB40_01",
      fieldKey: "btvn_1_practice",
    });
    assert.equal(restoreF02Btvn2.success, true);
    const curVerAfterF02 = restoreF02Btvn2.record.draftVersion;

    // [F05 Regression] Require expectedVersion on approveReportCard
    const f05MissingVer = reportCardRepo.approveReportCard(
      "VT-C4K-GB40",
      undefined as unknown as number
    );
    assert.equal(f05MissingVer.success, false, "F05: approveReportCard must reject omitted expectedVersion");

    const f05StaleVer = reportCardRepo.approveReportCard("VT-C4K-GB40", curVerAfterF02 - 1);
    assert.equal(f05StaleVer.success, false, "F05: approveReportCard must reject stale expectedVersion");
    assert.equal(f05StaleVer.conflict, true);

    // [F03 Regression] Content hash must change when BTVN session metadata (hasTheory/hasPractice) or raw/max changes
    const reApprove = reportCardRepo.approveReportCard("VT-C4K-GB40", curVerAfterF02);
    assert.equal(reApprove.success, true);
    assert.equal(reApprove.record.status, "APPROVED");
    const hashBeforeMetaChange = reApprove.record.contentHash;

    const modifiedMetaSnapshot: ClassReportCardLmsSnapshot = {
      ...gb40Snapshot,
      btvnSessions: gb40Snapshot.btvnSessions.map((s) =>
        s.sessionNumber === 1 ? { ...s, hasPractice: false } : s
      ),
    };
    const recAfterMetaChange = reportCardRepo.saveLmsSnapshot("VT-C4K-GB40", modifiedMetaSnapshot);
    assert.equal(
      recAfterMetaChange.status,
      "WAITING_APPROVAL",
      "F03: Changing BTVN session metadata must trigger drift to WAITING_APPROVAL"
    );
    assert.equal(recAfterMetaChange.contentHash, "", "F03/F04: Drift must clear contentHash");
    assert.notEqual(
      computeReportCardContentHash(modifiedMetaSnapshot, afterRestoreMap),
      hashBeforeMetaChange,
      "F03: Content hash must differ when hasPractice changes"
    );

    // [F04 Regression] Block edits while SAVING, invalidate hash on FAILED edits & durably repair on hash mismatch
    const reApprove2 = reportCardRepo.approveReportCard("VT-C4K-GB40", recAfterMetaChange.draftVersion);
    assert.equal(reApprove2.success, true);
    const savingRec = reportCardRepo.markSyncingTeaching("VT-C4K-GB40", reApprove2.record.contentHash);
    assert.equal(savingRec.status, "SAVING");

    const editDuringSaving = reportCardRepo.saveManualOverrides({
      classId: "VT-C4K-GB40",
      expectedVersion: savingRec.draftVersion,
      updates: [{ studentId: "GB40_01", fieldKey: "cp1_theory", normScore: 4.5 }],
    });
    assert.equal(editDuringSaving.success, false, "F04: Must reject saveManualOverrides while SAVING");
    assert.equal(editDuringSaving.conflict, true);

    assert.throws(
      () => reportCardRepo.saveLmsSnapshot("VT-C4K-GB40", gb40Snapshot),
      /SAVING/,
      "F04: Must reject saveLmsSnapshot while SAVING"
    );

    // Calling markTeachingVerified with wrong hash must throw AND durably repair state out of SAVING
    assert.throws(
      () => reportCardRepo.markTeachingVerified("VT-C4K-GB40", "wrong-hash", {}),
      /Sai lệch contentHash/,
      "F04: markTeachingVerified must throw on hash mismatch"
    );
    const afterVerifyMismatch = reportCardRepo.findOne("VT-C4K-GB40")!;
    assert.equal(
      afterVerifyMismatch.status,
      "WAITING_APPROVAL",
      "F04: markTeachingVerified mismatch must durably repair status to WAITING_APPROVAL (not leave SAVING)"
    );
    assert.equal(afterVerifyMismatch.contentHash, "", "F04: markTeachingVerified mismatch must clear contentHash");
    assert.equal(afterVerifyMismatch.teachingSyncStatus, "FAILED");

    // Approve again and test markSyncingTeaching with wrong hash -> must durably repair to WAITING_APPROVAL
    const reApprove3 = reportCardRepo.approveReportCard("VT-C4K-GB40", afterVerifyMismatch.draftVersion);
    assert.equal(reApprove3.success, true);
    assert.throws(
      () => reportCardRepo.markSyncingTeaching("VT-C4K-GB40", "wrong-hash"),
      /Sai lệch contentHash/,
      "F04: markSyncingTeaching must throw on hash mismatch"
    );
    const afterSyncMismatch = reportCardRepo.findOne("VT-C4K-GB40")!;
    assert.equal(
      afterSyncMismatch.status,
      "WAITING_APPROVAL",
      "F04: markSyncingTeaching mismatch must durably repair status to WAITING_APPROVAL"
    );
    assert.equal(afterSyncMismatch.contentHash, "", "F04: markSyncingTeaching mismatch must clear contentHash");

    // Re-approve, mark syncing, then test markSyncingTeaching re-entry with wrong hash while SAVING -> must NOT retain SYNCING lock
    const reApprove3b = reportCardRepo.approveReportCard("VT-C4K-GB40", afterSyncMismatch.draftVersion);
    assert.equal(reApprove3b.success, true);
    const savingRec3b = reportCardRepo.markSyncingTeaching("VT-C4K-GB40", reApprove3b.record.contentHash);
    assert.equal(savingRec3b.status, "SAVING");
    assert.equal(savingRec3b.teachingSyncStatus, "SYNCING");

    assert.throws(
      () => reportCardRepo.markSyncingTeaching("VT-C4K-GB40", "wrong-hash"),
      /Sai lệch contentHash/,
      "F04: markSyncingTeaching re-entry with wrong hash must throw"
    );
    const afterReentryMismatch = reportCardRepo.findOne("VT-C4K-GB40")!;
    assert.equal(afterReentryMismatch.status, "WAITING_APPROVAL");
    assert.equal(
      afterReentryMismatch.teachingSyncStatus,
      "FAILED",
      "F04: markSyncingTeaching re-entry mismatch must clear SYNCING to FAILED"
    );
    assert.equal(afterReentryMismatch.contentHash, "");

    const editAfterReentryMismatch = reportCardRepo.saveManualOverrides({
      classId: "VT-C4K-GB40",
      expectedVersion: afterReentryMismatch.draftVersion,
      updates: [{ studentId: "GB40_01", fieldKey: "cp1_theory", normScore: 4.0 }],
    });
    assert.equal(
      editAfterReentryMismatch.success,
      true,
      "F04: Ordinary edits must succeed after markSyncingTeaching re-entry mismatch"
    );

    // Re-approve, mark syncing, mark failed, then edit from FAILED state
    const reApprove4 = reportCardRepo.approveReportCard("VT-C4K-GB40", editAfterReentryMismatch.record.draftVersion);
    assert.equal(reApprove4.success, true);
    reportCardRepo.markSyncingTeaching("VT-C4K-GB40", reApprove4.record.contentHash);
    const failedRec = reportCardRepo.markTeachingSyncFailed("VT-C4K-GB40", "Lỗi mạng giả lập");
    assert.equal(failedRec.status, "FAILED");
    assert.equal(failedRec.contentHash, reApprove4.record.contentHash);

    const editAfterFailed = reportCardRepo.saveManualOverrides({
      classId: "VT-C4K-GB40",
      expectedVersion: failedRec.draftVersion,
      updates: [{ studentId: "GB40_01", fieldKey: "cp1_theory", normScore: 4.5 }],
    });
    assert.equal(editAfterFailed.success, true);
    assert.equal(
      editAfterFailed.record.status,
      "WAITING_APPROVAL",
      "F04: Editing from FAILED state must transition to WAITING_APPROVAL"
    );
    assert.equal(editAfterFailed.record.contentHash, "", "F04: Editing from FAILED state must clear contentHash");

    // [F07 Regression] Reject mismatched classId / classCode in saveLmsSnapshot
    assert.throws(
      () => reportCardRepo.saveLmsSnapshot("VT-C4K-GB40", { ...gb40Snapshot, classId: "VT-C4K-OTHER" }),
      /Sai lệch mã lớp/,
      "F07: saveLmsSnapshot must reject mismatched snapshot.classId"
    );
    assert.throws(
      () => reportCardRepo.saveLmsSnapshot("VT-C4K-GB40", { ...gb40Snapshot, classCode: "VT-C4K-OTHER" }),
      /Sai lệch mã lớp/,
      "F07: saveLmsSnapshot must reject mismatched snapshot.classCode"
    );

    console.log("✅ [RC-03] SQLite reportCardRepo overrides, versioning, F01..F07 regressions PASSED 100%!");

    // =========================================================================
    // [RC-04] Stage 2: ScoreScraper.extractReportCardSnapshotFromGql (Coding Dual/Single Practice + CP1/CP2 + Final DEMO + Robotics)
    // =========================================================================
    console.log("\n[RC-04] Testing ScoreScraper LMS extraction (Coding dual/single practice, CP1/CP2, Final DEMO & Robotics)...");

    // RC-04A: Coding class with Dual Practice Tasks (PRACTICE_TASK1 + PRACTICE_TASK2), CP1 (Slot 4), CP2 (Slot 8), Final DEMO (Slot 13 + spck_session14_evaluations)
    const jsb16StudentsInDb = [
      { classId: "VT-JSB16", studentId: "STU_VT-JSB16_PHAM_BUI_QUANG_MINH", fullName: "Phạm Bùi Quang Minh", isActive: 1 },
      { classId: "VT-JSB16", studentId: "STU_VT-JSB16_NGUYEN_TRAN_GIA_KIET", fullName: "Nguyễn Trần Gia Kiệt", isActive: 1 },
      { classId: "VT-JSB16", studentId: "STU_VT-JSB16_DUONG_DANG_KHOI", fullName: "Dương Đăng Khôi", isActive: 1 },
    ];
    for (const st of jsb16StudentsInDb) {
      studentRepo.upsert(st);
    }

    session14EvalRepo.saveDraft({
      classId: "VT-JSB16",
      studentId: "STU_VT-JSB16_PHAM_BUI_QUANG_MINH",
      competencyScores: {
        knowledgeInClass: 4,
        knowledgeSelfStudy: 4,
        skillCommunication: 4,
        skillComputerUse: 4,
        skillProblemSolving: 4,
        skillCreativity: 4,
        skillComputational: 4,
        attitudeHomework: 5,
        attitudeInClass: 5,
      },
      demoScores: {
        algorithm: 1.5,
        creativity: 1.0,
        communication: 0.5,
        problemSolving: 0.75,
        computerSkills: 0.75,
      },
      learnedFromMindx: "Điểm Demo: 4.5 điểm\nĐiểm Năng lực: 4.22 điểm",
      suggestionsFromMindx: "Tiếp tục phát huy",
      futureDirection: "Lên khóa JSA",
    });

    const jsb16SubmissionGql = {
      classCode: "VT-JSB16",
      lessons: [
        { id: "L1", name: "Homework 1 - Website hoạt động như thế nào?", type: "REVIEW_AND_PRACTICE", displayOrder: 1 },
        { id: "L2", name: "Homework 2 - HTML Bậc trung", type: "REVIEW_AND_PRACTICE", displayOrder: 2 },
        { id: "L3", name: "Homework 3 - Trang trí website", type: "REVIEW_AND_PRACTICE", displayOrder: 3 },
        { id: "L4", name: "Homework 4 - CSS Bậc trung", type: "REVIEW_AND_PRACTICE", displayOrder: 4 },
        { id: "L5", name: "Homework 5 - CSS Nâng cao", type: "REVIEW_AND_PRACTICE", displayOrder: 5 },
        { id: "L6", name: "Homework 6 - Bootstrap Phần 1", type: "REVIEW_AND_PRACTICE", displayOrder: 6 },
        { id: "L7", name: "Homework 7 - Bootstrap Phần 2", type: "REVIEW_AND_PRACTICE", displayOrder: 7 },
        { id: "L8", name: "Homework 8 - Thu thập dữ liệu", type: "REVIEW_AND_PRACTICE", displayOrder: 8 },
        { id: "L_CP1", name: "Bài kiểm tra định kỳ lần 1 - CP1", type: "CHECKPOINT", displayOrder: 9 },
        { id: "L_CP2", name: "Bài kiểm tra định kỳ lần 2 - CP2", type: "CHECKPOINT", displayOrder: 10 },
      ],
      students: [
        { id: "CRM_MINH", studentUid: "UID_MINH", displayName: "Phạm Bùi Quang Minh" },
        // Shortened displayName in FindStudentSubmissionByClass ("Tuấn Kiệt") bridged via CRM_KIET in GetClassById -> "Nguyễn Trần Gia Kiệt"
        { id: "CRM_KIET", studentUid: "UID_KIET", displayName: "Tuấn Kiệt" },
      ],
      submissions: [
        // Homework 1 for Minh: QUIZ = 90, PRACTICE_TASK1 = 80, PRACTICE_TASK2 = 90 -> practiceRaw = 85 (norm 4.25)
        { id: "S1", lessonId: "L1", studentUid: "UID_MINH", category: "QUIZ", type: "QUIZ", status: "MARKED", score: 90 },
        { id: "S2", lessonId: "L1", studentUid: "UID_MINH", category: "PRACTICE_TASK1", type: "UPLOAD_FILE", status: "MARKED", score: 80 },
        { id: "S3", lessonId: "L1", studentUid: "UID_MINH", category: "PRACTICE_TASK2", type: "UPLOAD_FILE", status: "MARKED", score: 90 },
        // Homework 2 for Minh: QUIZ = 100, PRACTICE_TASK1 = 70
        { id: "S4", lessonId: "L2", studentUid: "UID_MINH", category: "QUIZ", type: "QUIZ", status: "MARKED", score: 100 },
        { id: "S5", lessonId: "L2", studentUid: "UID_MINH", category: "PRACTICE_TASK1", type: "UPLOAD_FILE", status: "MARKED", score: 70 },
        // Homework 1 for Kiet: QUIZ = 80, PRACTICE_TASK1 = 60, PRACTICE_TASK2 = IN_PROGRESS (only 1 marked -> practiceRaw = 60)
        { id: "S6", lessonId: "L1", studentUid: "UID_KIET", category: "QUIZ", type: "QUIZ", status: "MARKED", score: 80 },
        { id: "S7", lessonId: "L1", studentUid: "UID_KIET", category: "PRACTICE_TASK1", type: "UPLOAD_FILE", status: "MARKED", score: 60 },
        { id: "S8", lessonId: "L1", studentUid: "UID_KIET", category: "PRACTICE_TASK2", type: "UPLOAD_FILE", status: "IN_PROGRESS", score: 0 },
        // Fallback CP2 in FindStudentSubmissionByClass for Kiet (when Kiet's slot 8 has no CHECKPOINT area): QUIZ = 80 (-> 4.00), PRACTICE_TASK1 = 70 (-> 3.50)
        { id: "S9", lessonId: "L_CP2", studentUid: "UID_KIET", category: "QUIZ", type: "QUIZ", status: "MARKED", score: 80 },
        { id: "S10", lessonId: "L_CP2", studentUid: "UID_KIET", category: "PRACTICE_TASK1", type: "UPLOAD_FILE", status: "MARKED", score: 70 },
      ],
    };

    const makeNineRateAreas = (grades: number[]) => [
      ...grades.map((g, idx) => ({
        type: "RATE",
        grade: g,
        commentAreaId: `RATE_${idx + 1}`,
        content: `Tiêu chí ${idx + 1}`,
      })),
      // Trailing survey link with grade: 0 must be ignored when averaging [ĐNL]
      {
        type: "RATE",
        grade: 0,
        commentAreaId: "SURVEY_0",
        content: "Khảo sát phụ huynh https://forms.office.com/...",
      },
    ];

    const jsb16ClassByIdGql = {
      id: "65c017373df88ed8c24cd138",
      name: "VT-JSB16",
      students: [
        { student: { id: "CRM_MINH", fullName: "Phạm Bùi Quang Minh", status: "ACTIVE" }, activeInClass: true },
        { student: { id: "CRM_KIET", fullName: "Nguyễn Trần Gia Kiệt", status: "IDLE" }, activeInClass: true },
        // Dương Đăng Khôi is in GetClassById.students & SQLite but not in FindStudentSubmissionByClass.students
        { student: { id: "CRM_KHOI", fullName: "Dương Đăng Khôi", status: "ACTIVE" }, activeInClass: true },
      ],
      slots: Array.from({ length: 14 }, (_, idx) => {
        if (idx === 4) {
          // Buổi 5: Check-point 1 for Coding
          return {
            index: 4,
            studentAttendance: [
              {
                student: { id: "CRM_MINH", fullName: "Phạm Bùi Quang Minh" },
                status: "ATTENDED",
                commentByAreas: [
                  ...makeNineRateAreas([4, 4, 4, 3, 3, 4, 4, 4, 4]), // avg = 34/9 = 3.78
                  {
                    type: "CHECKPOINT",
                    grade: 0,
                    checkpoint: { practiceScore: 4, checkpointScore: 4 },
                    content: "Điểm thực hành: 4\n<p>Điểm trắc nghiệm: 4</p>",
                  },
                ],
              },
              {
                student: { id: "CRM_KIET", fullName: "Nguyễn Trần Gia Kiệt" },
                status: "ATTENDED",
                commentByAreas: [
                  ...makeNineRateAreas([3, 3, 3, 3, 3, 3, 3, 3, 3]), // avg = 3.00
                  {
                    type: "CHECKPOINT",
                    grade: 0,
                    checkpoint: { practiceScore: 3.5, checkpointScore: 3 },
                    content: "Điểm thực hành: 3.5\n<p>Điểm trắc nghiệm: 3</p>",
                  },
                ],
              },
            ],
          };
        }
        if (idx === 8) {
          // Buổi 9: Check-point 2 for Coding
          return {
            index: 8,
            studentAttendance: [
              {
                student: { id: "CRM_MINH", fullName: "Phạm Bùi Quang Minh" },
                status: "ATTENDED",
                commentByAreas: [
                  ...makeNineRateAreas([4, 4, 4, 4, 4, 4, 4, 4, 4]), // avg = 4.00
                  {
                    type: "CHECKPOINT",
                    grade: 0,
                    checkpoint: { practiceScore: 4.5, checkpointScore: 4 },
                    content: "Điểm thực hành: 4.5\n<p>Điểm trắc nghiệm: 4</p>",
                  },
                ],
              },
              {
                student: { id: "CRM_KIET", fullName: "Nguyễn Trần Gia Kiệt" },
                status: "ATTENDED",
                commentByAreas: [
                  ...makeNineRateAreas([4, 3, 4, 3, 4, 3, 4, 3, 4]), // avg = 32/9 = 3.56
                  // Kiet's slot 8 has no CHECKPOINT area -> should fallback to L_CP2 in FindStudentSubmissionByClass (LT=4.00, TH=3.50)
                ],
              },
              {
                student: { id: "CRM_KHOI", fullName: "Dương Đăng Khôi" },
                status: "LATE_ARRIVED",
                commentByAreas: [
                  ...makeNineRateAreas([4, 4, 4, 3, 4, 3, 3, 4, 3]), // avg = 32/9 = 3.56
                  {
                    type: "CHECKPOINT",
                    grade: 0,
                    checkpoint: { practiceScore: 3.5, checkpointScore: 3.5 },
                    content: "Điểm thực hành: 3.5\n<p>Điểm trắc nghiệm: 3.5</p>",
                  },
                ],
              },
            ],
          };
        }
        if (idx === 13) {
          // Buổi 14: Final DEMO on LMS (for Kiet, while Minh gets Final DEMO from spck_session14_evaluations)
          return {
            index: 13,
            studentAttendance: [
              {
                student: { id: "CRM_KIET", fullName: "Nguyễn Trần Gia Kiệt" },
                status: "ATTENDED",
                commentByAreas: [
                  ...makeNineRateAreas([4, 4, 4, 4, 4, 4, 4, 4, 4]), // avg = 4.00
                  {
                    type: "DEMO",
                    grade: 0,
                    demoQuestions: [
                      { id: "D1", score: 1.2 },
                      { id: "D2", score: 0.8 },
                      { id: "D3", score: 0.5 },
                      { id: "D4", score: 0.8 },
                      { id: "D5", score: 0.7 },
                    ], // sum = 4.00
                  },
                ],
              },
            ],
          };
        }
        return { index: idx, studentAttendance: [] };
      }),
    };

    const jsb16Snap = ScoreScraper.extractReportCardSnapshotFromGql({
      classId: "VT-JSB16",
      classCode: "VT-JSB16",
      submissionGqlData: jsb16SubmissionGql,
      classByIdGqlData: jsb16ClassByIdGql,
      existingStudents: studentRepo.findByClass("VT-JSB16", false),
      session14Evals: session14EvalRepo.findByClass("VT-JSB16"),
    });

    assert.equal(jsb16Snap.isRobotics, false);
    assert.deepEqual(
      jsb16Snap.btvnSessions.map((s) => s.sessionNumber),
      [1, 2, 3, 4, 6, 7, 8],
      "RC-04A: Must filter out CHECKPOINT lessons and Buổi 5, keeping standard 7 BTVN sessions [1,2,3,4,6,7,8]"
    );
    assert.equal(jsb16Snap.btvnSessions[0].practiceTaskCount, 2, "Homework 1 has 2 practice tasks");
    assert.equal(jsb16Snap.btvnSessions[1].practiceTaskCount, 1, "Homework 2 has 1 practice task");
    assert.equal(jsb16Snap.students.length, 3, "All 3 students (including Dương Đăng Khôi) must be extracted");

    const jsb16Computed = computeClassReportCard(jsb16Snap, {});
    const minhRow = jsb16Computed.students.find((s) => s.studentId === "STU_VT-JSB16_PHAM_BUI_QUANG_MINH")!;
    assert.ok(minhRow, "Minh must be mapped to STU_VT-JSB16_PHAM_BUI_QUANG_MINH");
    assert.equal(minhRow.btvnCells[1].theoryRaw, 90);
    assert.equal(minhRow.btvnCells[1].theoryNorm, 4.5);
    assert.equal(minhRow.btvnCells[1].practiceTask1Raw, 80);
    assert.equal(minhRow.btvnCells[1].practiceTask2Raw, 90);
    assert.equal(minhRow.btvnCells[1].practiceRaw, 85, "Dual practice tasks 80 & 90 must average to 85");
    assert.equal(minhRow.btvnCells[1].practiceNorm, 4.25, "85/100 must normalize to 4.25 on scale 5");
    assert.equal(minhRow.cp1.theory.value, 4);
    assert.equal(minhRow.cp1.practice.value, 4);
    assert.equal(minhRow.cp1.competency.value, 3.78);
    assert.equal(minhRow.cp1.total, 3.87); // round2(0.4*4 + 0.6*3.78 = 3.868) = 3.87
    assert.equal(minhRow.cp2.theory.value, 4);
    assert.equal(minhRow.cp2.practice.value, 4.5);
    assert.equal(minhRow.cp2.competency.value, 4);
    assert.equal(minhRow.cp2.total, 4.1); // round2(0.4*4.25 + 0.6*4.00) = 4.10
    assert.equal(minhRow.final.product.value, 4.5, "Final product from spck_session14_evaluations");
    assert.equal(minhRow.final.competency.value, 4.22, "Final competency from spck_session14_evaluations");
    assert.equal(minhRow.final.total, 4.39); // round2(0.6*4.5 + 0.4*4.22 = 4.388) = 4.39
    assert.equal(minhRow.tbck, 4.23); // round2(0.4*((3.87+4.10)/2) + 0.6*4.39 = 4.228) = 4.23
    assert.equal(minhRow.hang, "Hạng B");
    assert.equal(minhRow.xepLoai, "Tốt");

    const kietRow = jsb16Computed.students.find((s) => s.studentId === "STU_VT-JSB16_NGUYEN_TRAN_GIA_KIET")!;
    assert.ok(kietRow, "Shortened 'Tuấn Kiệt' must bridge via CRM_KIET to STU_VT-JSB16_NGUYEN_TRAN_GIA_KIET");
    assert.equal(kietRow.fullName, "Nguyễn Trần Gia Kiệt");
    assert.equal(kietRow.btvnCells[1].practiceRaw, 60, "Only marked practice task (60) is averaged, ignoring IN_PROGRESS task 2");
    assert.equal(kietRow.cp2.theory.value, 4, "Fallback to L_CP2 QUIZ 80/100 -> 4.00");
    assert.equal(kietRow.cp2.practice.value, 3.5, "Fallback to L_CP2 PRACTICE 70/100 -> 3.50");
    assert.equal(kietRow.cp2.competency.value, 3.56);
    assert.equal(kietRow.final.product.value, 4, "Final product from Slot 13 demoQuestions");
    assert.equal(kietRow.final.competency.value, 4, "Final competency from Slot 13 RATE areas");

    const khoiRow = jsb16Computed.students.find((s) => s.studentId === "STU_VT-JSB16_DUONG_DANG_KHOI")!;
    assert.ok(khoiRow, "Dương Đăng Khôi must be present with his CP2 scores");
    assert.equal(khoiRow.cp1.total, null);
    assert.equal(khoiRow.cp2.theory.value, 3.5);
    assert.equal(khoiRow.cp2.practice.value, 3.5);
    assert.equal(khoiRow.cp2.competency.value, 3.56);
    assert.equal(khoiRow.cp2.total, 3.54);

    // RC-04B: Robotics class (VT-ROB-ARMA13) -> skips BTVN, reads CP1 from Buổi 4 (slot 3), CP2 from Buổi 8 (slot 7), Final from Buổi 14 (slot 13)
    studentRepo.upsert({
      classId: "VT-ROB-ARMA13",
      studentId: "STU_ROB_01",
      fullName: "Lê Minh Khôi",
      isActive: 1,
    });
    const robClassByIdGql = {
      id: "8ceec0d93ecfa6657f42ce34",
      name: "VT-ROB-ARMA13",
      students: [
        { student: { id: "CRM_ROB_01", fullName: "Lê Minh Khôi", status: "ACTIVE" }, activeInClass: true },
      ],
      slots: Array.from({ length: 14 }, (_, idx) => {
        if (idx === 3) {
          // Buổi 4: CP1 for Robotics
          return {
            index: 3,
            studentAttendance: [
              {
                student: { id: "CRM_ROB_01", fullName: "Lê Minh Khôi" },
                status: "ATTENDED",
                commentByAreas: [
                  ...makeNineRateAreas([5, 5, 4, 4, 5, 4, 5, 4, 5]), // avg = 41/9 = 4.56
                  {
                    type: "CHECKPOINT",
                    grade: 0,
                    checkpoint: { practiceScore: 4.5, checkpointScore: 4.5 },
                  },
                ],
              },
            ],
          };
        }
        if (idx === 7) {
          // Buổi 8: CP2 for Robotics
          return {
            index: 7,
            studentAttendance: [
              {
                student: { id: "CRM_ROB_01", fullName: "Lê Minh Khôi" },
                status: "ATTENDED",
                commentByAreas: [
                  ...makeNineRateAreas([5, 5, 5, 4, 5, 5, 4, 5, 5]), // avg = 43/9 = 4.78
                  {
                    type: "CHECKPOINT",
                    grade: 0,
                    checkpoint: { practiceScore: 5, checkpointScore: 4.5 },
                  },
                ],
              },
            ],
          };
        }
        if (idx === 13) {
          // Buổi 14: Final DEMO for Robotics
          return {
            index: 13,
            studentAttendance: [
              {
                student: { id: "CRM_ROB_01", fullName: "Lê Minh Khôi" },
                status: "ATTENDED",
                commentByAreas: [
                  ...makeNineRateAreas([5, 5, 5, 5, 4, 5, 5, 5, 5]), // avg = 44/9 = 4.89
                  {
                    type: "DEMO",
                    grade: 0,
                    demoQuestions: [
                      { id: "R1", score: 1.25 },
                      { id: "R2", score: 0.75 },
                      { id: "R3", score: 1.0 },
                      { id: "R4", score: 0.5 },
                      { id: "R5", score: 1.0 },
                    ], // sum = 4.50
                  },
                ],
              },
            ],
          };
        }
        return { index: idx, studentAttendance: [] };
      }),
    };

    const robSnap = ScoreScraper.extractReportCardSnapshotFromGql({
      classId: "VT-ROB-ARMA13",
      classCode: "VT-ROB-ARMA13",
      classByIdGqlData: robClassByIdGql,
      existingStudents: studentRepo.findByClass("VT-ROB-ARMA13", false),
    });
    assert.equal(robSnap.isRobotics, true);
    assert.equal(robSnap.btvnSessions.length, 0, "Robotics class must have empty btvnSessions");
    const robScrapeComputed = computeClassReportCard(robSnap, {});
    assert.equal(robScrapeComputed.showBtvnBlock, false, "Robotics class must hide Khối 1 BTVN block");
    assert.equal(robScrapeComputed.students.length, 1);
    const robStu = robScrapeComputed.students[0];
    assert.equal(robStu.studentId, "STU_ROB_01");
    assert.equal(robStu.cp1.theory.value, 4.5);
    assert.equal(robStu.cp1.practice.value, 4.5);
    assert.equal(robStu.cp1.competency.value, 4.56);
    assert.equal(robStu.cp1.total, 4.54); // round2(0.4*4.5 + 0.6*4.56 = 4.536) = 4.54
    assert.equal(robStu.cp2.theory.value, 4.5);
    assert.equal(robStu.cp2.practice.value, 5);
    assert.equal(robStu.cp2.competency.value, 4.78);
    assert.equal(robStu.cp2.total, 4.77); // round2(0.4*4.75 + 0.6*4.78 = 4.768) = 4.77
    assert.equal(robStu.final.product.value, 4.5);
    assert.equal(robStu.final.competency.value, 4.89);
    assert.equal(robStu.final.total, 4.66); // round2(0.6*4.5 + 0.4*4.89 = 4.656) = 4.66
    assert.equal(robStu.tbck, 4.66); // round2(0.4*((4.54+4.77)/2) + 0.6*4.66 = 4.658) = 4.66
    assert.equal(robStu.hang, "Hạng A");
    assert.equal(robStu.xepLoai, "Xuất sắc");

    // Also test real captured LMS GraphQL files if present in scratch/
    const scratchDir = "C:/Users/QQ/.gemini/antigravity/brain/29fbdd6a-6319-41ff-ac36-0f55d001765d/scratch";
    if (fs.existsSync(path.join(scratchDir, "lms-gql-VT-JSB16.json"))) {
      const rawJsb16 = JSON.parse(fs.readFileSync(path.join(scratchDir, "lms-gql-VT-JSB16.json"), "utf8"));
      const realGetCls = rawJsb16.find((x: any) => x.operationName === "GetClassById")?.data?.classesById;
      const realSubGql = rawJsb16.find((x: any) => x.operationName === "FindStudentSubmissionByClass")?.data?.findStudentSubmissionByClass;
      const realSnap = ScoreScraper.extractReportCardSnapshotFromGql({
        classId: "VT-JSB16-LIVE",
        classCode: "VT-JSB16-LIVE",
        submissionGqlData: realSubGql,
        classByIdGqlData: realGetCls,
      });
      assert.deepEqual(realSnap.btvnSessions.map((s) => s.sessionNumber), [1, 2, 3, 4, 6, 7, 8]);
      assert.equal(realSnap.students.length, 10, "Live VT-JSB16 payload must extract all 10 students");
      const realComp = computeClassReportCard(realSnap, {});
      assert.equal(realComp.students.length, 10);
    }

    // RC-04C: Stage 2 Codex Findings S2-01..S2-09 Full Scraper & Persistence Integration Regressions
    console.log("   -> Running Stage 2 Codex regression suite (S2-01..S2-09)...");
    const scrapeSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/playwright/scrape-scores.ts"),
      "utf8"
    );
    const scrapeJs = stripTypeScriptTypes(scrapeSource)
      .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
      .replace(/\bexport\s+/g, "");

    const A_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
    const B_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";

    function createStage2ScraperHarness(opts: {
      cid?: string;
      existing?: any[];
      cls?: any;
      classStatus?: number;
      classGqlErrors?: any[];
      classRequestId?: string;
      deferClassTicks?: number;
      neverResolveClass?: boolean;
      submission?: any;
      submissionStatus?: number;
      submissionRequestId?: string;
      realDb?: boolean;
    } = {}) {
      let reqListener: any;
      let listener: any;
      let tabClicks = 0;
      let waitTicks = 0;
      let releaseClass: (() => void) | undefined;
      const writes: any[] = [];
      const emptyLoc: any = {
        first() {
          return this;
        },
        locator() {
          return this;
        },
        count: async () => 0,
        isVisible: async () => false,
        innerText: async () => opts.cid || "CLASS_A",
        getAttribute: async () => "false",
        scrollIntoViewIfNeeded: async () => {},
        click: async () => {},
      };

      const emitGql = async (
        operationName: string,
        payload: any,
        requestId = A_ID,
        status = 200,
        errors?: any[]
      ) => {
        if (!listener) return;
        const reqObj = {
          method: () => "POST",
          postDataJSON: () => ({
            operationName,
            variables:
              operationName === "GetClassById"
                ? { id: requestId }
                : { payload: { classId: requestId } },
          }),
        };
        if (reqListener) {
          await reqListener(reqObj);
        }
        await listener({
          url: () => "https://lms-api.mindx.edu.vn/graphql",
          status: () => status,
          request: () => reqObj,
          json: async () => {
            if (
              operationName === "GetClassById" &&
              (opts.neverResolveClass || (opts.deferClassTicks && opts.deferClassTicks > 0))
            ) {
              await new Promise<void>((resolve) => {
                releaseClass = resolve;
              });
            }
            if (errors && errors.length > 0) {
              return { errors };
            }
            return {
              data: {
                [operationName === "GetClassById"
                  ? "classesById"
                  : "findStudentSubmissionByClass"]: payload,
              },
            };
          },
        });
      };

      const tabLoc = {
        ...emptyLoc,
        count: async () => 1,
        click: async () => {
          tabClicks++;
          if (opts.submission || opts.submissionStatus) {
            await emitGql(
              "FindStudentSubmissionByClass",
              opts.submission,
              opts.submissionRequestId || A_ID,
              opts.submissionStatus || 200
            );
          }
        },
      };
      const drawerLoc = {
        ...emptyLoc,
        locator: (sel: string) => (sel.includes("#tab-3") ? tabLoc : emptyLoc),
      };
      const pageMock = {
        locator: () => drawerLoc,
        on: (ev: string, fn: any) => {
          if (ev === "request") reqListener = fn;
          if (ev === "response") listener = fn;
        },
        off: (ev: string) => {
          if (ev === "request") reqListener = null;
          if (ev === "response") listener = null;
        },
        waitForTimeout: async () => {
          waitTicks++;
          if (
            opts.deferClassTicks &&
            waitTicks >= opts.deferClassTicks &&
            !opts.neverResolveClass &&
            releaseClass
          ) {
            const rel = releaseClass;
            releaseClass = undefined;
            rel();
            await new Promise((r) => setTimeout(r, 0));
          }
        },
      };

      const sb: any = {
        console,
        Date,
        Math,
        Map,
        Set,
        JSON,
        RegExp,
        Error,
        Array,
        Object,
        Number,
        String,
        Boolean,
        parseInt,
        parseFloat,
        setTimeout,
        ...calculatorMod,
        isRoboticsClassCode,
        getDb: opts.realDb ? getDb : undefined,
        authService: { ensureAuthenticated: async () => {} },
        BrowserManager: { getInstance: () => ({ getPage: async () => pageMock }) },
        createNetworkInterceptor: () => ({ dismissForbiddenToast: async () => {} }),
        LmsHelpers: {
          openClassDrawer: async () => {
            if (opts.cls !== undefined || opts.classStatus || opts.classGqlErrors) {
              const task = emitGql(
                "GetClassById",
                opts.cls,
                opts.classRequestId || A_ID,
                opts.classStatus || 200,
                opts.classGqlErrors
              );
              if (!opts.neverResolveClass && !(opts.deferClassTicks && opts.deferClassTicks > 0)) {
                await task;
              }
            }
          },
          switchDrawerTab: async () => {},
        },
        SELECTORS: { tabs: { grading: "" } },
        studentRepo: { findByClass: () => opts.existing || [] },
        jobLogRepo: { add() {} },
        session14EvalRepo: { findByClass: () => [] },
        reportCardRepo: opts.realDb
          ? reportCardRepo
          : {
              saveLmsSnapshot: (cid: string, s: any) => {
                writes.push({ kind: "snapshot", cid, snapshot: s });
              },
            },
        scoreMatrixRepo: opts.realDb
          ? scoreMatrixRepo
          : {
              save: (cid: string, matrix: any) => {
                writes.push({ kind: "matrix", cid, matrix });
              },
            },
      };
      vm.createContext(sb);
      vm.runInContext(scrapeJs + "\nglobalThis.scraper = ScoreScraper;", sb);
      return {
        scraper: sb.scraper,
        writes,
        clicks: () => tabClicks,
        releaseClass: () => releaseClass?.(),
      };
    }

    const seedSnap = (cid: string): ClassReportCardLmsSnapshot => ({
      classId: cid,
      classCode: cid,
      isRobotics: cid.includes("ROB"),
      scrapedAt: "2026-10-29T00:00:00.000Z",
      btvnSessions: [],
      students: [
        {
          studentId: "LOCAL_A",
          fullName: "Student Alpha",
          isActive: true,
          btvnScores: {},
          stageScores: {
            cp1Theory: 4,
            cp1Practice: 4,
            cp1Competency: 4,
            cp2Theory: 4,
            cp2Practice: 4,
            cp2Competency: 4,
            finalProduct: 4,
            finalCompetency: 4,
          },
        },
      ],
    });
    const hwLesson1 = {
      id: "L1",
      name: "Homework 1",
      displayOrder: 1,
      type: "REVIEW_AND_PRACTICE",
    };
    const mkSub = (
      uid: string,
      score: number,
      lessonId = "L1",
      category = "PRACTICE_TASK1"
    ) => ({
      id: `${uid}_${lessonId}_${category}`,
      studentUid: uid,
      lessonId,
      category,
      type: category === "QUIZ" ? "QUIZ" : "UPLOAD_FILE",
      status: "MARKED",
      score,
    });
    const mkAtt = (id: string, fullName: string, cp = 4) => ({
      student: { id, fullName },
      commentByAreas: [
        { type: "CHECKPOINT", checkpoint: { checkpointScore: cp, practiceScore: cp } },
        { type: "RATE", grade: 4 },
      ],
    });

    // S2-01a: Robotics HTTP 500 or GraphQL error must fail and preserve existing snapshot
    reportCardRepo.saveLmsSnapshot("VT-ROB-S201", seedSnap("VT-ROB-S201"));
    const hS201Rob = createStage2ScraperHarness({
      cid: "VT-ROB-S201",
      existing: [{ classId: "VT-ROB-S201", studentId: "LOCAL_A", fullName: "Student Alpha", isActive: 1 }],
      classStatus: 500,
      realDb: true,
    });
    const resS201Rob = await hS201Rob.scraper.scrapeClassScores("VT-ROB-S201");
    assert.equal(resS201Rob.success, false, "S2-01a: Robotics GetClassById HTTP 500 must fail");
    assert.equal(hS201Rob.clicks(), 0, "S2-01a: Robotics must never click #tab-3");
    assert.equal(
      JSON.parse(reportCardRepo.findOne("VT-ROB-S201")!.lmsSnapshotJson).students[0].stageScores.cp1Practice,
      4,
      "S2-01a: Prior Robotics CP1=4 must be preserved when GetClassById fails"
    );

    // S2-01b: Delayed HTTP 200 GetClassById body that resolves within wait loop is awaited and captured
    const hS201DelayedOk = createStage2ScraperHarness({
      cid: "CLASS_S201_DELAY_OK",
      deferClassTicks: 3,
      existing: [{ classId: "CLASS_S201_DELAY_OK", studentId: "LOCAL_A", fullName: "Student Alpha", isActive: 1 }],
      cls: {
        id: A_ID,
        name: "CLASS_S201_DELAY_OK",
        students: [{ student: { id: "CRM_A", fullName: "Student Alpha" }, activeInClass: true }],
        slots: [{ index: 4, studentAttendance: [mkAtt("CRM_A", "Student Alpha", 5)] }],
      },
      submission: {
        classCode: "CLASS_S201_DELAY_OK",
        lessons: [hwLesson1],
        students: [{ id: "CRM_A", studentUid: "UID_A", displayName: "Student Alpha" }],
        submissions: [mkSub("UID_A", 80)],
      },
    });
    const resS201DelayedOk = await hS201DelayedOk.scraper.scrapeClassScores("CLASS_S201_DELAY_OK");
    assert.equal(resS201DelayedOk.success, true, "S2-01b: Delayed GetClassById body resolving within timeout must succeed");
    assert.equal(
      resS201DelayedOk.reportCardSnapshot.students[0].stageScores.cp1Practice,
      5,
      "S2-01b: Delayed GetClassById CP1=5 must be awaited and captured"
    );

    // S2-01c: GetClassById body that hangs/never resolves must timeout and fail (never overwrite with null)
    const hS201Timeout = createStage2ScraperHarness({
      cid: "CLASS_S201_TIMEOUT",
      neverResolveClass: true,
      existing: [{ classId: "CLASS_S201_TIMEOUT", studentId: "LOCAL_A", fullName: "Student Alpha", isActive: 1 }],
      cls: {
        id: A_ID,
        name: "CLASS_S201_TIMEOUT",
        students: [{ student: { id: "CRM_A", fullName: "Student Alpha" }, activeInClass: true }],
        slots: [{ index: 4, studentAttendance: [mkAtt("CRM_A", "Student Alpha", 5)] }],
      },
      submission: {
        classCode: "CLASS_S201_TIMEOUT",
        lessons: [hwLesson1],
        students: [{ id: "CRM_A", studentUid: "UID_A", displayName: "Student Alpha" }],
        submissions: [mkSub("UID_A", 80)],
      },
    });
    const resS201Timeout = await hS201Timeout.scraper.scrapeClassScores("CLASS_S201_TIMEOUT");
    hS201Timeout.releaseClass();
    assert.equal(resS201Timeout.success, false, "S2-01c: Unfinished GetClassById JSON body must fail on timeout");

    // S2-02: Cross-class submission or nameless foreign GetClassById must be rejected
    const hS202Sub = createStage2ScraperHarness({
      cid: "CLASS_S202",
      cls: {
        id: A_ID,
        name: "CLASS_S202",
        students: [{ student: { id: "CRM_A", fullName: "Student Alpha" }, activeInClass: true }],
        slots: [],
      },
      existing: [{ classId: "CLASS_S202", studentId: "LOCAL_A", fullName: "Student Alpha", isActive: 1 }],
      submissionRequestId: B_ID,
      submission: {
        lessons: [hwLesson1],
        students: [{ id: "CRM_A", studentUid: "UID_A", displayName: "Student Alpha" }],
        submissions: [mkSub("UID_A", 99)],
      },
    });
    const resS202Sub = await hS202Sub.scraper.scrapeClassScores("CLASS_S202");
    assert.equal(resS202Sub.success, false, "S2-02a: Foreign submissionRequestId conflicting with verified lmsClassId must fail");

    const hS202Cls = createStage2ScraperHarness({
      cid: "VT-ROB-FOREIGN",
      existing: [{ classId: "VT-ROB-FOREIGN", studentId: "LOCAL_A", fullName: "Student Alpha", isActive: 1 }],
      cls: {
        id: B_ID,
        students: [{ student: { id: "CRM_A", fullName: "Student Alpha" }, activeInClass: true }],
        slots: [{ index: 3, studentAttendance: [mkAtt("CRM_A", "Student Alpha", 5)] }],
      },
    });
    const resS202Cls = await hS202Cls.scraper.scrapeClassScores("VT-ROB-FOREIGN");
    assert.equal(resS202Cls.success, false, "S2-02b: Nameless GetClassById with foreign ID must fail");

    // S2-03: Locked reportCardRepo (SAVING/SYNCING) must cause scrapeClassScores to fail atomically without updating scoreMatrixRepo
    reportCardRepo.saveLmsSnapshot("CLASS_S203", seedSnap("CLASS_S203"));
    getDb()
      .prepare("UPDATE class_report_cards SET status='SAVING', teachingSyncStatus='SYNCING' WHERE classId='CLASS_S203'")
      .run();
    const hS203 = createStage2ScraperHarness({
      cid: "CLASS_S203",
      realDb: true,
      existing: [{ classId: "CLASS_S203", studentId: "LOCAL_A", fullName: "Student Alpha", isActive: 1 }],
      cls: {
        id: A_ID,
        name: "CLASS_S203",
        students: [{ student: { id: "CRM_A", fullName: "Student Alpha" }, activeInClass: true }],
        slots: [{ index: 4, studentAttendance: [mkAtt("CRM_A", "Student Alpha", 2)] }],
      },
      submission: {
        classCode: "CLASS_S203",
        lessons: [hwLesson1],
        students: [{ id: "CRM_A", studentUid: "UID_A", displayName: "Student Alpha" }],
        submissions: [mkSub("UID_A", 80)],
      },
    });
    const resS203 = await hS203.scraper.scrapeClassScores("CLASS_S203");
    assert.equal(resS203.success, false, "S2-03: Locked reportCardRepo must fail scrapeClassScores");
    assert.equal(scoreMatrixRepo.findByClass("CLASS_S203"), null, "S2-03: scoreMatrixRepo must not be written when reportCardRepo rejects save");
    assert.equal(
      JSON.parse(reportCardRepo.findOne("CLASS_S203")!.lmsSnapshotJson).students[0].stageScores.cp1Practice,
      4,
      "S2-03: Stored reportCardRepo snapshot must remain untouched"
    );

    // S2-04: DOM fallback rows must preserve BTVN scores even when GetClassById supplies a CRM roster
    const domCell = {
      columnId: "L1",
      lessonId: "L1",
      sessionNumber: 1,
      status: "GRADED" as const,
      score: 80,
      quizScore: 90,
      maxScore: 100,
      rawText: "Đã chấm (80/100)",
    };
    const snapS204 = ScoreScraper.extractReportCardSnapshotFromGql({
      classId: "CLASS_S204",
      classCode: "CLASS_S204",
      classByIdGqlData: {
        students: [{ student: { id: "CRM_A", fullName: "Student Alpha" }, activeInClass: true }],
      },
      existingStudents: [{ classId: "CLASS_S204", studentId: "LOCAL_A", fullName: "Student Alpha", isActive: 1 }],
      fallbackMatrix: {
        columns: [{ colIndex: 0, columnId: "L1", lessonId: "L1", title: "Homework 1", sessionNumber: 1 }],
        rows: [
          {
            studentId: "LOCAL_A",
            fullName: "Student Alpha",
            isActive: true,
            cells: { L1: domCell },
            averageScore: 80,
            averageQuizScore: 90,
            gradedCount: 1,
            submittedUngradedCount: 0,
            notSubmittedCount: 0,
            redoCount: 0,
          },
        ],
      },
    });
    const compS204 = computeClassReportCard(snapS204, {});
    assert.equal(compS204.students[0].btvnCells[1].practiceRaw, 80, "S2-04: DOM fallback practiceRaw must be preserved");
    assert.equal(compS204.students[0].btvnCells[1].theoryRaw, 90, "S2-04: DOM fallback theoryRaw must be preserved");

    // S2-05: Verified CRM identity bridge must take priority over crossed mutable displayNames
    const snapS205 = ScoreScraper.extractReportCardSnapshotFromGql({
      classId: "CLASS_S205",
      classCode: "CLASS_S205",
      existingStudents: [
        { classId: "CLASS_S205", studentId: "LOCAL_A", fullName: "Student Alpha", isActive: 1 },
        { classId: "CLASS_S205", studentId: "LOCAL_B", fullName: "Student Beta", isActive: 1 },
      ],
      classByIdGqlData: {
        students: [
          { student: { id: "CRM_A", fullName: "Student Alpha" }, activeInClass: true },
          { student: { id: "CRM_B", fullName: "Student Beta" }, activeInClass: true },
        ],
      },
      submissionGqlData: {
        lessons: [hwLesson1],
        students: [
          { id: "CRM_A", studentUid: "UID_A", displayName: "Student Beta" },
          { id: "CRM_B", studentUid: "UID_B", displayName: "Student Alpha" },
        ],
        submissions: [mkSub("UID_A", 90), mkSub("UID_B", 20)],
      },
    });
    assert.equal(
      snapS205.students.find((s) => s.studentId === "LOCAL_A")?.btvnScores[1]?.practiceRaw,
      90,
      "S2-05: LOCAL_A must receive CRM_A's score (90) via verified CRM bridge despite crossed displayName"
    );
    assert.equal(
      snapS205.students.find((s) => s.studentId === "LOCAL_B")?.btvnScores[1]?.practiceRaw,
      20,
      "S2-05: LOCAL_B must receive CRM_B's score (20) via verified CRM bridge"
    );

    // S2-06: Active CRM pupil without Denise account must appear in both matrix rows & snapshot; same-name distinct CRM IDs must not collapse
    const hS206 = createStage2ScraperHarness({
      cid: "CLASS_S206",
      cls: {
        id: A_ID,
        name: "CLASS_S206",
        students: [
          { student: { id: "CRM_A", fullName: "Student Alpha" }, activeInClass: true },
          { student: { id: "CRM_B", fullName: "Student Beta" }, activeInClass: true },
        ],
        slots: [],
      },
      submission: {
        classCode: "CLASS_S206",
        lessons: [hwLesson1],
        students: [{ id: "CRM_A", studentUid: "UID_A", displayName: "Student Alpha" }],
        submissions: [mkSub("UID_A", 80)],
      },
    });
    const resS206 = await hS206.scraper.scrapeClassScores("CLASS_S206");
    assert.equal(resS206.success, true);
    assert.equal(resS206.rows.length, 2, "S2-06a: Matrix rows must include active CRM student without Denise account");
    assert.equal(resS206.reportCardSnapshot.students.length, 2, "S2-06a: Snapshot must include both active CRM students");

    const snapS206Dup = ScoreScraper.extractReportCardSnapshotFromGql({
      classId: "CLASS_S206_DUP",
      classCode: "CLASS_S206_DUP",
      classByIdGqlData: {
        students: [
          { student: { id: "CRM_A", fullName: "Same Name" }, activeInClass: true },
          { student: { id: "CRM_B", fullName: "Same Name" }, activeInClass: true },
        ],
      },
      submissionGqlData: {
        lessons: [hwLesson1],
        students: [{ id: "CRM_A", studentUid: "UID_A", displayName: "Same Name" }],
        submissions: [],
      },
    });
    assert.equal(snapS206Dup.students.length, 2, "S2-06b: Two distinct CRM IDs sharing the same name must both be preserved");

    // S2-07: Sole Checkpoint 2 lesson must populate CP2 (not CP1)
    const snapS207 = ScoreScraper.extractReportCardSnapshotFromGql({
      classId: "CLASS_S207",
      classCode: "CLASS_S207",
      submissionGqlData: {
        lessons: [{ id: "CP2", name: "Checkpoint 2", type: "CHECKPOINT", displayOrder: 10 }],
        students: [{ id: "CRM_A", studentUid: "UID_A", displayName: "Student Alpha" }],
        submissions: [mkSub("UID_A", 80, "CP2", "QUIZ"), mkSub("UID_A", 60, "CP2")],
      },
    });
    assert.equal(snapS207.students[0].stageScores.cp1Theory, null, "S2-07: Sole Checkpoint 2 must leave CP1 theory null");
    assert.equal(snapS207.students[0].stageScores.cp2Theory, 4, "S2-07: Sole Checkpoint 2 must populate CP2 theory = 4");
    assert.equal(snapS207.students[0].stageScores.cp2Practice, 3, "S2-07: Sole Checkpoint 2 must populate CP2 practice = 3");

    // S2-08: Explicit all-zero DEMO scores with completion evidence (RATE > 0) must produce 0, while ungraded default template stays null
    const snapS208GradedZero = ScoreScraper.extractReportCardSnapshotFromGql({
      classId: "CLASS_S208",
      classCode: "CLASS_S208",
      classByIdGqlData: {
        students: [{ student: { id: "CRM_A", fullName: "Student Alpha" }, activeInClass: true }],
        slots: [
          {
            index: 13,
            studentAttendance: [
              {
                student: { id: "CRM_A", fullName: "Student Alpha" },
                commentByAreas: [
                  { type: "RATE", grade: 4 },
                  { type: "DEMO", demoQuestions: Array.from({ length: 5 }, () => ({ score: 0 })) },
                ],
              },
            ],
          },
        ],
      },
    });
    assert.equal(snapS208GradedZero.students[0].stageScores.finalProduct, 0, "S2-08a: Completed all-zero DEMO must preserve 0");

    const snapS208UngradedDefault = ScoreScraper.extractReportCardSnapshotFromGql({
      classId: "CLASS_S208_UNGRADED",
      classCode: "CLASS_S208_UNGRADED",
      classByIdGqlData: {
        students: [{ student: { id: "CRM_A", fullName: "Student Alpha" }, activeInClass: true }],
        slots: [
          {
            index: 13,
            studentAttendance: [
              {
                student: { id: "CRM_A", fullName: "Student Alpha" },
                commentByAreas: [
                  { type: "RATE", grade: 0 },
                  { type: "DEMO", grade: 0, content: "", demoQuestions: Array.from({ length: 5 }, () => ({ id: "Q", content: "Criteria", score: 0 })) },
                ],
              },
            ],
          },
        ],
      },
    });
    assert.equal(snapS208UngradedDefault.students[0].stageScores.finalProduct, null, "S2-08b: Ungraded default DEMO template must stay null");

    const snapS208NoteOnly = ScoreScraper.extractReportCardSnapshotFromGql({
      classId: "CLASS_S208_NOTE_ONLY",
      classCode: "CLASS_S208_NOTE_ONLY",
      classByIdGqlData: {
        students: [{ student: { id: "CRM_A", fullName: "Student Alpha" }, activeInClass: true }],
        slots: [
          {
            index: 13,
            studentAttendance: [
              {
                student: { id: "CRM_A", fullName: "Student Alpha" },
                commentByAreas: [
                  { type: "RATE", grade: 0 },
                  { type: "DEMO", demoQuestions: Array.from({ length: 5 }, () => ({ score: 0 })) },
                  { type: "CONTENT", content: "Con tham gia tích cực." },
                ],
              },
            ],
          },
        ],
      },
    });
    assert.equal(
      snapS208NoteOnly.students[0].stageScores.finalProduct,
      null,
      "S2-08c: General CONTENT feedback without DEMO/RATE completion evidence must not turn default zeros into 0"
    );

    const snapR201BlankDemo = ScoreScraper.extractReportCardSnapshotFromGql({
      classId: "CLASS_R201_BLANK",
      classCode: "CLASS_R201_BLANK",
      classByIdGqlData: {
        students: [{ student: { id: "CRM_A", fullName: "Student Alpha" }, activeInClass: true }],
        slots: [
          {
            index: 13,
            studentAttendance: [
              {
                student: { id: "CRM_A", fullName: "Student Alpha" },
                commentByAreas: [
                  { type: "RATE", grade: 4 },
                  { type: "DEMO", demoQuestions: Array.from({ length: 5 }, () => ({ score: "" })) },
                ],
              },
            ],
          },
        ],
      },
    });
    assert.equal(
      snapR201BlankDemo.students[0].stageScores.finalProduct,
      null,
      "R2-01: Blank string DEMO scores must remain null even when RATE is graded"
    );

    // S2-07b: Unidentified checkpoint without ordinal/session stays null; reversed [CP2, CP1] maps to exact stage
    const snapS207Opaque = ScoreScraper.extractReportCardSnapshotFromGql({
      classId: "CLASS_S207_OPAQUE",
      classCode: "CLASS_S207_OPAQUE",
      submissionGqlData: {
        lessons: [{ id: "opaque-lesson", name: "Bài kiểm tra", type: "CHECKPOINT" }],
        students: [{ id: "CRM_A", studentUid: "UID_A", displayName: "Student Alpha" }],
        submissions: [mkSub("UID_A", 80, "opaque-lesson", "QUIZ"), mkSub("UID_A", 60, "opaque-lesson")],
      },
    });
    assert.equal(snapS207Opaque.students[0].stageScores.cp1Theory, null, "S2-07b: Unidentified checkpoint must leave CP1 null");
    assert.equal(snapS207Opaque.students[0].stageScores.cp2Theory, null, "S2-07b: Unidentified checkpoint must leave CP2 null");

    const snapS207Reversed = ScoreScraper.extractReportCardSnapshotFromGql({
      classId: "CLASS_S207_REV",
      classCode: "CLASS_S207_REV",
      submissionGqlData: {
        lessons: [
          { id: "CP2_ID", name: "Bài kiểm tra định kỳ lần 2", type: "CHECKPOINT", displayOrder: 1 },
          { id: "CP1_ID", name: "Bài kiểm tra định kỳ lần 1", type: "CHECKPOINT", displayOrder: 2 },
        ],
        students: [{ id: "CRM_A", studentUid: "UID_A", displayName: "Student Alpha" }],
        submissions: [
          mkSub("UID_A", 90, "CP2_ID", "QUIZ"),
          mkSub("UID_A", 80, "CP2_ID"),
          mkSub("UID_A", 70, "CP1_ID", "QUIZ"),
          mkSub("UID_A", 60, "CP1_ID"),
        ],
      },
    });
    assert.equal(snapS207Reversed.students[0].stageScores.cp1Theory, 3.5, "S2-07c: Reversed CP1 theory must be 3.5");
    assert.equal(snapS207Reversed.students[0].stageScores.cp1Practice, 3, "S2-07c: Reversed CP1 practice must be 3.0");
    assert.equal(snapS207Reversed.students[0].stageScores.cp2Theory, 4.5, "S2-07c: Reversed CP2 theory must be 4.5");
    assert.equal(snapS207Reversed.students[0].stageScores.cp2Practice, 4, "S2-07c: Reversed CP2 practice must be 4.0");

    // S2-02c: Late response from a stale pre-scrape request object (no request event in current scrape) must be ignored
    {
      const listeners = new Map<string, Set<any>>();
      const mkReq = (op: string) => ({
        method: () => "POST",
        postDataJSON: () => ({
          operationName: op,
          variables: op === "GetClassById" ? { id: A_ID } : { payload: { classId: A_ID } },
        }),
      });
      const staleReq = mkReq("FindStudentSubmissionByClass");
      const emitReq = async (r: any) => {
        for (const fn of listeners.get("request") || []) await fn(r);
      };
      const emitRes = async (r: any, data: any) => {
        const op = r.postDataJSON().operationName;
        const res = {
          url: () => "https://lms-api.mindx.edu.vn/graphql",
          status: () => 200,
          request: () => r,
          json: async () => ({
            data: {
              [op === "GetClassById" ? "classesById" : "findStudentSubmissionByClass"]: data,
            },
          }),
        };
        for (const fn of listeners.get("response") || []) await fn(res);
      };
      const empty: any = {
        first() {
          return this;
        },
        locator() {
          return this;
        },
        count: async () => 0,
        isVisible: async () => false,
        innerText: async () => "CLASS_S202_STALE",
        getAttribute: async () => "false",
        scrollIntoViewIfNeeded: async () => {},
        click: async () => {},
      };
      const tab = {
        ...empty,
        count: async () => 1,
        click: async () => {
          const freshReq = mkReq("FindStudentSubmissionByClass");
          await emitReq(freshReq);
          await emitRes(freshReq, {
            lessons: [hwLesson1],
            students: [{ id: "CRM_A", studentUid: "UID_A", displayName: "Student Alpha" }],
            submissions: [mkSub("UID_A", 80)],
          });
          // Now emit a late response for staleReq (which had no request event in this scrape)
          await emitRes(staleReq, {
            lessons: [hwLesson1],
            students: [{ id: "CRM_A", studentUid: "UID_A", displayName: "Student Alpha" }],
            submissions: [mkSub("UID_A", 99)],
          });
        },
      };
      const drawer = { ...empty, locator: (s: string) => (s.includes("#tab-3") ? tab : empty) };
      const page: any = {
        locator: () => drawer,
        waitForTimeout: async () => {},
        on: (ev: string, fn: any) => {
          if (!listeners.has(ev)) listeners.set(ev, new Set());
          listeners.get(ev)!.add(fn);
        },
        off: (ev: string, fn: any) => {
          listeners.get(ev)?.delete(fn);
        },
      };
      const sb: any = {
        console,
        Date,
        Math,
        Map,
        Set,
        JSON,
        RegExp,
        Error,
        Array,
        Object,
        Number,
        String,
        Boolean,
        parseInt,
        parseFloat,
        setTimeout,
        ...calculatorMod,
        isRoboticsClassCode,
        getDb,
        authService: { ensureAuthenticated: async () => {} },
        BrowserManager: { getInstance: () => ({ getPage: async () => page }) },
        createNetworkInterceptor: () => ({ dismissForbiddenToast: async () => {} }),
        LmsHelpers: {
          openClassDrawer: async () => {
            const clsReq = mkReq("GetClassById");
            await emitReq(clsReq);
            await emitRes(clsReq, {
              id: A_ID,
              name: "CLASS_S202_STALE",
              students: [{ student: { id: "CRM_A", fullName: "Student Alpha" }, activeInClass: true }],
              slots: [],
            });
          },
          switchDrawerTab: async () => {},
        },
        SELECTORS: { tabs: { grading: "" } },
        studentRepo: {
          findByClass: () => [
            { classId: "CLASS_S202_STALE", studentId: "LOCAL_A", fullName: "Student Alpha", isActive: 1 },
          ],
        },
        jobLogRepo: { add() {} },
        session14EvalRepo: { findByClass: () => [] },
        reportCardRepo,
        scoreMatrixRepo,
      };
      vm.createContext(sb);
      vm.runInContext(scrapeJs + "\nglobalThis.scraper = ScoreScraper;", sb);
      const staleOut = await sb.scraper.scrapeClassScores("CLASS_S202_STALE");
      assert.equal(staleOut.success, true);
      assert.equal(staleOut.rows[0].cells.L1.score, 80, "S2-02c: Fresh score 80 must not be overwritten by stale 99");
      assert.equal(
        scoreMatrixRepo.findByClass("CLASS_S202_STALE")!.matrix.rows[0].cells.L1.score,
        80,
        "S2-02c: Cached matrix must store fresh score 80"
      );
      assert.equal(
        JSON.parse(reportCardRepo.findOne("CLASS_S202_STALE")!.lmsSnapshotJson).students[0].btvnScores[1].practiceRaw,
        80,
        "S2-02c: Persisted report card snapshot must store fresh score 80"
      );

      // S2-02d: Stale GetClassById response arriving BEFORE the first fresh request event must be rejected and preserve prior CP1=4
      for (const staleCid of ["CLASS_S202_PRE_REQ", "VT-ROB-S202_PRE_REQ"]) {
        reportCardRepo.saveLmsSnapshot(staleCid, seedSnap(staleCid));
        const preListeners = new Map<string, Set<any>>();
        const preExistingClassReq = mkReq("GetClassById");
        const emitPreReq = async (r: any) => {
          for (const fn of preListeners.get("request") || []) await fn(r);
        };
        const emitPreRes = async (r: any, data: any) => {
          const op = r.postDataJSON().operationName;
          const res = {
            url: () => "https://lms-api.mindx.edu.vn/graphql",
            status: () => 200,
            request: () => r,
            json: async () => ({
              data: {
                [op === "GetClassById" ? "classesById" : "findStudentSubmissionByClass"]: data,
              },
            }),
          };
          for (const fn of preListeners.get("response") || []) await fn(res);
        };
        const preTab = {
          ...empty,
          count: async () => 1,
          click: async () => {
            const freshSubReq = mkReq("FindStudentSubmissionByClass");
            await emitPreReq(freshSubReq);
            await emitPreRes(freshSubReq, {
              lessons: [hwLesson1],
              students: [{ id: "CRM_A", studentUid: "UID_A", displayName: "Student Alpha" }],
              submissions: [mkSub("UID_A", 80)],
            });
          },
        };
        const preDrawer = { ...empty, innerText: async () => staleCid, locator: (s: string) => (s.includes("#tab-3") ? preTab : empty) };
        const prePage: any = {
          locator: () => preDrawer,
          waitForTimeout: async () => {},
          on: (ev: string, fn: any) => {
            if (!preListeners.has(ev)) preListeners.set(ev, new Set());
            preListeners.get(ev)!.add(fn);
          },
          off: (ev: string, fn: any) => {
            preListeners.get(ev)?.delete(fn);
          },
        };
        const preSb: any = {
          console,
          Date,
          Math,
          Map,
          Set,
          JSON,
          RegExp,
          Error,
          Array,
          Object,
          Number,
          String,
          Boolean,
          parseInt,
          parseFloat,
          setTimeout,
          ...calculatorMod,
          isRoboticsClassCode,
          getDb,
          authService: { ensureAuthenticated: async () => {} },
          BrowserManager: { getInstance: () => ({ getPage: async () => prePage }) },
          createNetworkInterceptor: () => ({ dismissForbiddenToast: async () => {} }),
          LmsHelpers: {
            openClassDrawer: async () => {
              // Emit response for preExistingClassReq WITHOUT emitting a request event
              await emitPreRes(preExistingClassReq, {
                id: A_ID,
                name: staleCid,
                students: [{ student: { id: "CRM_A", fullName: "Student Alpha" }, activeInClass: true }],
                slots: [
                  {
                    index: staleCid.includes("ROB") ? 3 : 4,
                    studentAttendance: [mkAtt("CRM_A", "Student Alpha", 5)],
                  },
                ],
              });
            },
            switchDrawerTab: async () => {},
          },
          SELECTORS: { tabs: { grading: "" } },
          studentRepo: {
            findByClass: () => [
              { classId: staleCid, studentId: "LOCAL_A", fullName: "Student Alpha", isActive: 1 },
            ],
          },
          jobLogRepo: { add() {} },
          session14EvalRepo: { findByClass: () => [] },
          reportCardRepo,
          scoreMatrixRepo,
        };
        vm.createContext(preSb);
        vm.runInContext(scrapeJs + "\nglobalThis.scraper = ScoreScraper;", preSb);
        const preRes = await preSb.scraper.scrapeClassScores(staleCid);
        assert.equal(preRes.success, false, `S2-02d: Stale class response before first fresh request must fail for ${staleCid}`);
        assert.equal(
          JSON.parse(reportCardRepo.findOne(staleCid)!.lmsSnapshotJson).students[0].stageScores.cp1Theory,
          4,
          `S2-02d: Persisted CP1=4 must be preserved for ${staleCid}`
        );
      }

      // S2-07d: Unnamed checkpoint at position 5 or position 9 must NOT inherit Buổi 5 / Buổi 9 identity from array index
      for (const pos of [5, 9]) {
        const prefixLessons = Array.from({ length: pos - 1 }, (_, i) => ({
          id: `L${i + 1}`,
          name: `Homework ${i + 1}`,
          type: "REVIEW_AND_PRACTICE",
        }));
        const snapPos = ScoreScraper.extractReportCardSnapshotFromGql({
          classId: "CLASS_S207_POS",
          classCode: "CLASS_S207_POS",
          submissionGqlData: {
            lessons: [...prefixLessons, { id: "opaque-lesson", type: "CHECKPOINT" }],
            students: [{ id: "CRM_A", studentUid: "UID_A", displayName: "Student Alpha" }],
            submissions: [mkSub("UID_A", 80, "opaque-lesson", "QUIZ"), mkSub("UID_A", 60, "opaque-lesson")],
          },
        });
        assert.equal(snapPos.students[0].stageScores.cp1Theory, null, `S2-07d: Unnamed checkpoint at pos ${pos} must leave CP1 null`);
        assert.equal(snapPos.students[0].stageScores.cp2Theory, null, `S2-07d: Unnamed checkpoint at pos ${pos} must leave CP2 null`);
      }
    }

    // S2-09: Checkpoint-session BTVN exclusion (Buổi 5 & Buổi 9) must hold even for 1- or 2-lesson payloads
    const snapS209 = ScoreScraper.extractReportCardSnapshotFromGql({
      classId: "CLASS_S209",
      classCode: "CLASS_S209",
      submissionGqlData: {
        lessons: [{ id: "L5", name: "Homework 5", type: "REVIEW_AND_PRACTICE" }],
        students: [],
        submissions: [],
      },
    });
    assert.equal(snapS209.btvnSessions.length, 0, "S2-09: Homework 5 must be excluded even in a 1-lesson payload");

    console.log("✅ [RC-04] ScoreScraper LMS extraction & S2-01..S2-09 regressions PASSED 100%!");

    // =========================================================================
    // [RC-05] TEACHING REPORT CARD SYNC (hocsinh.php) & API ROUTES
    // =========================================================================
    console.log("\n[RC-05] Testing TeachingReportCardSyncService (hocsinh.php) & API Routes...");

    function createMockTeachingTransport(opts: {
      classCode: string;
      students: Array<{ id: number; student_name: string; class_code?: string; status?: string }>;
      initialExercises?: RemoteTeachingExercise[];
      initialScores?: RemoteTeachingScoreRow[];
      onSaveScores?: (scores: TeachingScoreInputItem[]) => void;
      tamperReadbackScores?: (scores: RemoteTeachingScoreRow[]) => RemoteTeachingScoreRow[];
      skipExerciseOnDeclare?: boolean;
    }): TeachingReportCardHttpTransport & {
      declaredCalls: AddMultiExercisePayload[];
      savedScoreBatches: TeachingScoreInputItem[][];
      exercises: RemoteTeachingExercise[];
      scores: RemoteTeachingScoreRow[];
    } {
      let nextExId = 5000;
      const exercises: RemoteTeachingExercise[] = [...(opts.initialExercises || [])];
      const scores: RemoteTeachingScoreRow[] = [...(opts.initialScores || [])];
      const declaredCalls: AddMultiExercisePayload[] = [];
      const savedScoreBatches: TeachingScoreInputItem[][] = [];

      return {
        declaredCalls,
        savedScoreBatches,
        exercises,
        scores,
        async getStudents() {
          return opts.students.map((s) => ({
            id: s.id,
            student_name: s.student_name,
            class_code: s.class_code ?? opts.classCode,
            status: s.status ?? "Đang học",
          }));
        },
        async getExercises() {
          return [...exercises];
        },
        async getScores() {
          const out = [...scores];
          return opts.tamperReadbackScores ? opts.tamperReadbackScores(out) : out;
        },
        async addMultiExercise(payload) {
          declaredCalls.push(payload);
          if (!opts.skipExerciseOnDeclare) {
            for (const sn of payload.sessions) {
              for (const form of payload.exerciseForms) {
                const max =
                  form === "nang_luc"
                    ? payload.maxScoreNangLuc ?? 5
                    : payload.maxScore;
                const existingIdx = exercises.findIndex(
                  (e) =>
                    Number(e.session_number) === Number(sn) &&
                    e.exercise_type === payload.exerciseType &&
                    e.exercise_form === form
                );
                const exItem: RemoteTeachingExercise = {
                  id: existingIdx >= 0 ? exercises[existingIdx].id : nextExId++,
                  class_code: payload.classCode,
                  session_number: sn,
                  exercise_type: payload.exerciseType,
                  exercise_form: form,
                  exercise_title: payload.exerciseTitle || "",
                  max_score: max,
                };
                if (existingIdx >= 0) {
                  exercises[existingIdx] = exItem;
                } else {
                  exercises.push(exItem);
                }
              }
            }
          }
          return { success: true };
        },
        async saveScores(batch) {
          savedScoreBatches.push(batch);
          if (opts.onSaveScores) {
            opts.onSaveScores(batch);
          }
          for (const item of batch) {
            const norm = round2((item.raw_score / item.max_score) * 5);
            const idx = scores.findIndex(
              (s) =>
                Number(s.student_id) === Number(item.student_id) &&
                Number(s.session_number) === Number(item.session_number) &&
                s.exercise_type === item.exercise_type &&
                s.exercise_form === item.exercise_form
            );
            const row: RemoteTeachingScoreRow = {
              student_id: item.student_id,
              class_code: item.class_code,
              session_number: item.session_number,
              exercise_type: item.exercise_type,
              exercise_form: item.exercise_form,
              raw_score: item.raw_score,
              normalized_score: norm,
              max_score: item.max_score,
              note: item.note,
            };
            if (idx >= 0) {
              scores[idx] = row;
            } else {
              scores.push(row);
            }
          }
          return { success: true };
        },
      };
    }

    // 5A. Student matching & strict numeric parsing checks
    assert.equal(parseStrictFiniteScore(""), null);
    assert.equal(parseStrictFiniteScore("   "), null);
    assert.equal(parseStrictFiniteScore(null), null);
    assert.equal(parseStrictFiniteScore(undefined), null);
    assert.equal(parseStrictFiniteScore(true), null);
    assert.equal(parseStrictFiniteScore(false), null);
    assert.equal(parseStrictFiniteScore(0), 0);
    assert.equal(parseStrictFiniteScore("0"), 0);
    assert.equal(parseStrictFiniteScore("4.25"), 4.25);

    const sampleSnapSync: ClassReportCardLmsSnapshot = {
      classId: "VT-C4K-SYNC01",
      classCode: "VT-C4K-SYNC01",
      isRobotics: false,
      scrapedAt: "2026-10-29T10:00:00.000Z",
      btvnSessions: [
        {
          sessionNumber: 1,
          title: "Buổi 1",
          hasTheory: true,
          hasPractice: true,
          practiceTaskCount: 1,
          maxTheoryScore: 100,
          maxPracticeScore: 100,
        },
        {
          sessionNumber: 2,
          title: "Buổi 2",
          hasTheory: true,
          hasPractice: true,
          practiceTaskCount: 1,
          maxTheoryScore: 100,
          maxPracticeScore: 100,
        },
      ],
      students: [
        {
          studentId: "STU_MINH",
          fullName: "Nguyễn Lê Minh ",
          isActive: true,
          btvnScores: {
            1: { sessionNumber: 1, theoryRaw: 80, theoryMax: 100, practiceRaw: 90, practiceMax: 100 },
            2: { sessionNumber: 2, theoryRaw: 0, theoryMax: 100, practiceRaw: 100, practiceMax: 100 },
          },
          stageScores: {
            cp1Theory: 4,
            cp1Practice: 4.5,
            cp1Competency: 4.22,
            cp2Theory: 5,
            cp2Practice: 4,
            cp2Competency: 4.5,
            finalProduct: 4.8,
            finalCompetency: 4.6,
          },
        },
        {
          studentId: "STU_KHANG",
          fullName: "Trần Minh Khang",
          isActive: true,
          btvnScores: {
            1: { sessionNumber: 1, theoryRaw: 100, theoryMax: 100, practiceRaw: 75, practiceMax: 100 },
            2: { sessionNumber: 2, theoryRaw: null, theoryMax: 100, practiceRaw: 80, practiceMax: 100 },
          },
          stageScores: {
            cp1Theory: 3.5,
            cp1Practice: 4,
            cp1Competency: 4,
            cp2Theory: 4,
            cp2Practice: 4.5,
            cp2Competency: 4.11,
            finalProduct: 0,
            finalCompetency: 3.5,
          },
        },
      ],
    };

    reportCardRepo.saveLmsSnapshot("VT-C4K-SYNC01", sampleSnapSync);
    const unapprovedRec = reportCardRepo.findOne("VT-C4K-SYNC01")!;
    assert.equal(unapprovedRec.status, "DRAFT");

    // 5B. Unapproved sync must be rejected before making any network calls
    const mockTransport5B = createMockTeachingTransport({
      classCode: "VT-C4K-SYNC01",
      students: [
        { id: 101, student_name: "  nguyễn lê minh" },
        { id: 102, student_name: "Trần Minh Khang" },
      ],
    });
    const unapprovedSyncRes = await TeachingReportCardSyncService.syncReportCardToTeaching(
      "VT-C4K-SYNC01",
      {
        expectedVersion: unapprovedRec.draftVersion,
        transport: mockTransport5B,
      }
    );
    assert.equal(unapprovedSyncRes.success, false, "RC-05: Unapproved report card must not sync");
    assert.equal(unapprovedSyncRes.statusCode, 400);
    assert.equal(mockTransport5B.declaredCalls.length, 0);
    assert.equal(mockTransport5B.savedScoreBatches.length, 0);
    assert.equal(reportCardRepo.findOne("VT-C4K-SYNC01")!.status, "DRAFT");

    // 5C. Approve report card, then test version conflict (409) & invalid version (400)
    const appSync01 = reportCardRepo.approveReportCard(
      "VT-C4K-SYNC01",
      unapprovedRec.draftVersion
    );
    assert.equal(appSync01.success, true);

    const staleVerSyncRes = await TeachingReportCardSyncService.syncReportCardToTeaching(
      "VT-C4K-SYNC01",
      {
        expectedVersion: appSync01.record.draftVersion + 99,
        transport: mockTransport5B,
      }
    );
    assert.equal(staleVerSyncRes.success, false);
    assert.equal(staleVerSyncRes.statusCode, 409);
    assert.equal(staleVerSyncRes.conflict, true);
    assert.equal(
      reportCardRepo.findOne("VT-C4K-SYNC01")!.status,
      "APPROVED",
      "RC-05: Stale version rejection must preserve APPROVED status"
    );

    for (const badVer of [0, -1, 1.5, "1.5", "", true, null]) {
      const badVerRes = await TeachingReportCardSyncService.syncReportCardToTeaching(
        "VT-C4K-SYNC01",
        {
          expectedVersion: badVer,
          transport: mockTransport5B,
        }
      );
      assert.equal(badVerRes.success, false);
      assert.equal(badVerRes.statusCode, 400);
    }

    // 5D. Full Coding class sync with trailing-space & NFD student names, missing exercise declaration & Read-after-Write
    const syncCodingOk = await TeachingReportCardSyncService.syncReportCardToTeaching(
      "VT-C4K-SYNC01",
      {
        expectedVersion: appSync01.record.draftVersion,
        transport: mockTransport5B,
      }
    );
    assert.equal(syncCodingOk.success, true, `Coding sync failed: ${syncCodingOk.error}`);
    assert.equal(syncCodingOk.record?.status, "VERIFIED");
    assert.equal(syncCodingOk.record?.teachingSyncStatus, "VERIFIED");
    // 2 BTVN sessions * 2 forms + 3 CP1 + 3 CP2 + 2 Final = 12 exercises declared
    assert.equal(syncCodingOk.declaredExerciseCount, 12);
    // Student 1: 4 BTVN + 8 stage = 12 scores; Student 2: 3 BTVN (S2 theory is null) + 8 stage = 11 scores -> total 23
    assert.equal(syncCodingOk.syncedScoreCount, 23);

    // Explicit 0 scores must be preserved in saved batch
    const flatSaved = mockTransport5B.savedScoreBatches.flat();
    const s1Btvn2Theory = flatSaved.find(
      (s) =>
        s.student_id === 101 &&
        s.session_number === 2 &&
        s.exercise_type === "btvn" &&
        s.exercise_form === "theory"
    );
    assert.ok(s1Btvn2Theory, "Explicit 0 BTVN score must be saved");
    assert.equal(s1Btvn2Theory!.raw_score, 0);

    const s2FinalProd = flatSaved.find(
      (s) =>
        s.student_id === 102 &&
        s.session_number === 14 &&
        s.exercise_type === "final" &&
        s.exercise_form === "practice"
    );
    assert.ok(s2FinalProd, "Explicit 0 Final Product score must be saved");
    assert.equal(s2FinalProd!.raw_score, 0);

    // 5E. Scaling when pre-existing BTVN exercise on Teaching has max_score = 5 (like VT-C4K-GB40)
    const mockTransportScale5 = createMockTeachingTransport({
      classCode: "VT-C4K-SYNC01",
      students: [
        { id: 101, student_name: "Nguyễn Lê Minh" },
        { id: 102, student_name: "Trần Minh Khang" },
      ],
      initialExercises: [
        { id: 1, class_code: "VT-C4K-SYNC01", session_number: 1, exercise_type: "btvn", exercise_form: "theory", max_score: 5 },
        { id: 2, class_code: "VT-C4K-SYNC01", session_number: 1, exercise_type: "btvn", exercise_form: "practice", max_score: 5 },
      ],
    });
    const syncScale5Ok = await TeachingReportCardSyncService.syncReportCardToTeaching(
      "VT-C4K-SYNC01",
      {
        expectedVersion: syncCodingOk.record!.draftVersion,
        transport: mockTransportScale5,
      }
    );
    assert.equal(syncScale5Ok.success, true);
    const s1ScaledTheory = mockTransportScale5.savedScoreBatches
      .flat()
      .find(
        (s) =>
          s.student_id === 101 &&
          s.session_number === 1 &&
          s.exercise_type === "btvn" &&
          s.exercise_form === "theory"
      );
    assert.equal(s1ScaledTheory?.raw_score, 4);
    assert.equal(s1ScaledTheory?.max_score, 5);

    // 5F. Robotics class sync: NO BTVN declared or pushed; CP1 at session 4, CP2 at session 8, Final at session 14
    const robSnapSync: ClassReportCardLmsSnapshot = {
      classId: "VT-ROB-SYNC02",
      classCode: "VT-ROB-SYNC02",
      isRobotics: true,
      scrapedAt: "2026-10-29T10:00:00.000Z",
      btvnSessions: [
        // Even if raw snapshot had a stray BTVN session, Robotics sync must ignore it
        {
          sessionNumber: 1,
          title: "Stray BTVN",
          hasTheory: true,
          hasPractice: true,
          practiceTaskCount: 1,
          maxTheoryScore: 100,
          maxPracticeScore: 100,
        },
      ],
      students: [
        {
          studentId: "ROB_STU_1",
          fullName: "Lê Hoàng Bách",
          isActive: true,
          btvnScores: {
            1: { sessionNumber: 1, theoryRaw: 90, theoryMax: 100, practiceRaw: 90, practiceMax: 100 },
          },
          stageScores: {
            cp1Theory: 4,
            cp1Practice: 4,
            cp1Competency: 3.5,
            cp2Theory: 4.5,
            cp2Practice: 5,
            cp2Competency: 4.2,
            finalProduct: 4.8,
            finalCompetency: 4.5,
          },
        },
      ],
    };
    reportCardRepo.saveLmsSnapshot("VT-ROB-SYNC02", robSnapSync);
    const robRec0 = reportCardRepo.findOne("VT-ROB-SYNC02")!;
    const robApp = reportCardRepo.approveReportCard("VT-ROB-SYNC02", robRec0.draftVersion);
    assert.equal(robApp.success, true);

    const mockRobTransport = createMockTeachingTransport({
      classCode: "VT-ROB-SYNC02",
      students: [{ id: 201, student_name: "Lê Hoàng Bách " }],
    });
    const syncRobOk = await TeachingReportCardSyncService.syncReportCardToTeaching(
      "VT-ROB-SYNC02",
      {
        expectedVersion: robApp.record.draftVersion,
        transport: mockRobTransport,
      }
    );
    assert.equal(syncRobOk.success, true, `Robotics sync failed: ${syncRobOk.error}`);
    assert.equal(
      mockRobTransport.declaredCalls.some((c) => c.exerciseType === "btvn"),
      false,
      "RC-05: Robotics must NEVER declare btvn exercises"
    );
    assert.equal(
      mockRobTransport.savedScoreBatches.flat().some((s) => s.exercise_type === "btvn"),
      false,
      "RC-05: Robotics must NEVER save btvn scores"
    );
    assert.ok(
      mockRobTransport.declaredCalls.some(
        (c) => c.exerciseType === "cp1" && c.sessions.includes(4)
      ),
      "RC-05: Robotics CP1 must be declared at session 4"
    );
    assert.ok(
      mockRobTransport.declaredCalls.some(
        (c) => c.exerciseType === "cp2" && c.sessions.includes(8)
      ),
      "RC-05: Robotics CP2 must be declared at session 8"
    );
    assert.ok(
      mockRobTransport.declaredCalls.some(
        (c) => c.exerciseType === "final" && c.sessions.includes(14)
      ),
      "RC-05: Robotics Final DEMO must be declared at session 14"
    );
    assert.equal(syncRobOk.syncedScoreCount, 8);

    // 5G. Adversarial Guards: Cross-Class, Ambiguous Duplicate Names, Missing Student, Read-after-Write Mismatches & Blank Coercion
    // Cross-class student
    const crossClassStuRes = await TeachingReportCardSyncService.syncReportCardToTeaching(
      "VT-ROB-SYNC02",
      {
        expectedVersion: syncRobOk.record!.draftVersion,
        transport: createMockTeachingTransport({
          classCode: "VT-ROB-SYNC02",
          students: [{ id: 201, student_name: "Lê Hoàng Bách", class_code: "VT-ROB-FOREIGN" }],
        }),
      }
    );
    assert.equal(crossClassStuRes.success, false);
    assert.match(crossClassStuRes.error || "", /Cross-Class Guard Error/);
    assert.equal(crossClassStuRes.record?.status, "FAILED");

    // Re-approve VT-ROB-SYNC02 for next adversarial checks
    const reApproveRob = () => {
      const r = reportCardRepo.findOne("VT-ROB-SYNC02")!;
      const a = reportCardRepo.approveReportCard("VT-ROB-SYNC02", r.draftVersion);
      assert.equal(a.success, true);
      return a.record;
    };

    // Duplicate remote student names
    const dupRemoteRes = await TeachingReportCardSyncService.syncReportCardToTeaching(
      "VT-ROB-SYNC02",
      {
        expectedVersion: reApproveRob().draftVersion,
        transport: createMockTeachingTransport({
          classCode: "VT-ROB-SYNC02",
          students: [
            { id: 201, student_name: "Lê Hoàng Bách" },
            { id: 202, student_name: "Lê Hoàng Bách" },
          ],
        }),
      }
    );
    assert.equal(dupRemoteRes.success, false);
    assert.match(dupRemoteRes.error || "", /Student Match Error/);

    // Missing student on Teaching
    const missingRemoteStuRes = await TeachingReportCardSyncService.syncReportCardToTeaching(
      "VT-ROB-SYNC02",
      {
        expectedVersion: reApproveRob().draftVersion,
        transport: createMockTeachingTransport({
          classCode: "VT-ROB-SYNC02",
          students: [{ id: 299, student_name: "Người Lạ" }],
        }),
      }
    );
    assert.equal(missingRemoteStuRes.success, false);
    assert.match(missingRemoteStuRes.error || "", /Student Match Error/);

    // Read-after-Write score mismatch
    const rawMismatchRes = await TeachingReportCardSyncService.syncReportCardToTeaching(
      "VT-ROB-SYNC02",
      {
        expectedVersion: reApproveRob().draftVersion,
        transport: createMockTeachingTransport({
          classCode: "VT-ROB-SYNC02",
          students: [{ id: 201, student_name: "Lê Hoàng Bách" }],
          tamperReadbackScores: (rows) =>
            rows.map((r, i) => (i === 0 ? { ...r, raw_score: 1.23 } : r)),
        }),
      }
    );
    assert.equal(rawMismatchRes.success, false);
    assert.match(rawMismatchRes.error || "", /Read-after-Write Error/);
    assert.equal(rawMismatchRes.record?.status, "FAILED");

    // Read-after-Write blank string "" when expected score is 0 must NOT coerce to 0
    const reAppCoding = reportCardRepo.approveReportCard(
      "VT-C4K-SYNC01",
      reportCardRepo.findOne("VT-C4K-SYNC01")!.draftVersion
    );
    assert.equal(reAppCoding.success, true);
    const blankZeroReadbackRes = await TeachingReportCardSyncService.syncReportCardToTeaching(
      "VT-C4K-SYNC01",
      {
        expectedVersion: reAppCoding.record.draftVersion,
        transport: createMockTeachingTransport({
          classCode: "VT-C4K-SYNC01",
          students: [
            { id: 101, student_name: "Nguyễn Lê Minh" },
            { id: 102, student_name: "Trần Minh Khang" },
          ],
          tamperReadbackScores: (rows) =>
            rows.map((r) =>
              Number(r.raw_score) === 0 ? { ...r, raw_score: "" } : r
            ),
        }),
      }
    );
    assert.equal(
      blankZeroReadbackRes.success,
      false,
      "RC-05: Blank raw_score '' on Teaching must not pass Read-after-Write for expected 0"
    );
    assert.match(blankZeroReadbackRes.error || "", /Read-after-Write Error/);

    // Read-after-Write stale non-null score on Teaching for a slot that is null in approved report card
    const reAppCoding2 = reportCardRepo.approveReportCard(
      "VT-C4K-SYNC01",
      reportCardRepo.findOne("VT-C4K-SYNC01")!.draftVersion
    );
    assert.equal(reAppCoding2.success, true);
    const staleNullSlotRes = await TeachingReportCardSyncService.syncReportCardToTeaching(
      "VT-C4K-SYNC01",
      {
        expectedVersion: reAppCoding2.record.draftVersion,
        transport: createMockTeachingTransport({
          classCode: "VT-C4K-SYNC01",
          students: [
            { id: 101, student_name: "Nguyễn Lê Minh" },
            { id: 102, student_name: "Trần Minh Khang" },
          ],
          initialScores: [
            // Student 102 has null for BTVN session 2 theory in sampleSnapSync
            {
              student_id: 102,
              class_code: "VT-C4K-SYNC01",
              session_number: 2,
              exercise_type: "btvn",
              exercise_form: "theory",
              raw_score: 75,
              normalized_score: 3.75,
            },
          ],
        }),
      }
    );
    assert.equal(
      staleNullSlotRes.success,
      false,
      "RC-05: Stale non-null score on Teaching for a null local slot must fail Read-after-Write"
    );
    assert.match(staleNullSlotRes.error || "", /Read-after-Write Error/);

    // Concurrent contentHash drift during saveScores -> must downgrade to WAITING_APPROVAL and NOT verify
    const reAppCoding3 = reportCardRepo.approveReportCard(
      "VT-C4K-SYNC01",
      reportCardRepo.findOne("VT-C4K-SYNC01")!.draftVersion
    );
    assert.equal(reAppCoding3.success, true);
    const raceDriftRes = await TeachingReportCardSyncService.syncReportCardToTeaching(
      "VT-C4K-SYNC01",
      {
        expectedVersion: reAppCoding3.record.draftVersion,
        transport: createMockTeachingTransport({
          classCode: "VT-C4K-SYNC01",
          students: [
            { id: 101, student_name: "Nguyễn Lê Minh" },
            { id: 102, student_name: "Trần Minh Khang" },
          ],
          onSaveScores: () => {
            // Simulate concurrent modification in SQLite while network call is in flight
            getDb()
              .prepare(
                `UPDATE class_report_cards SET manualOverridesJson = ? WHERE classId = ?`
              )
              .run(
                JSON.stringify({
                  [makeOverrideKey("STU_MINH", "cp1_theory")]: {
                    studentId: "STU_MINH",
                    fieldKey: "cp1_theory",
                    normScore: 1,
                    rawScore: 1,
                    maxScore: 5,
                    updatedAt: new Date().toISOString(),
                  },
                }),
                "VT-C4K-SYNC01"
              );
          },
        }),
      }
    );
    assert.equal(raceDriftRes.success, false, "RC-05: Concurrent drift during sync must fail");
    const afterRaceRec = reportCardRepo.findOne("VT-C4K-SYNC01")!;
    assert.equal(afterRaceRec.status, "WAITING_APPROVAL");
    assert.equal(afterRaceRec.contentHash, "");

    // 5H. API Routes (/api/report-card & /api/report-card/sync-teaching)
    // Non-local request must be blocked with 403
    const nonLocalReq = new NextRequest("http://example.com/api/report-card?classCode=VT-C4K-SYNC01", {
      headers: { host: "example.com", "x-forwarded-for": "8.8.8.8" },
    });
    const nonLocalRes = await reportCardGET(nonLocalReq);
    assert.equal(nonLocalRes.status, 403, "RC-05: Non-local GET must return 403");

    // Mismatched classId and classCode in GET/POST/PUT must return 400
    const mismatchGetReq = new NextRequest(
      "http://127.0.0.1:3000/api/report-card?classId=VT-C4K-SYNC01&classCode=VT-C4K-OTHER",
      { headers: { host: "127.0.0.1:3000" } }
    );
    const mismatchGetRes = await reportCardGET(mismatchGetReq);
    assert.equal(mismatchGetRes.status, 400);

    // Valid GET returns reportCard
    const getOkReq = new NextRequest(
      "http://127.0.0.1:3000/api/report-card?classCode=VT-C4K-SYNC01",
      { headers: { host: "127.0.0.1:3000" } }
    );
    const getOkRes = await reportCardGET(getOkReq);
    assert.equal(getOkRes.status, 200);
    const getOkJson = await getOkRes.json();
    assert.equal(getOkJson.success, true);
    assert.equal(getOkJson.classCode, "VT-C4K-SYNC01");
    assert.equal(getOkJson.reportCard.students.length, 2);

    // PUT override with missing/invalid expectedVersion -> 400; stale expectedVersion -> 409; valid -> 200
    const putBadVerReq = new NextRequest("http://127.0.0.1:3000/api/report-card", {
      method: "PUT",
      headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify({
        classCode: "VT-C4K-SYNC01",
        expectedVersion: "bad",
        patchOverrides: { [makeOverrideKey("STU_MINH", "cp1_theory")]: 4.5 },
      }),
    });
    assert.equal((await reportCardPUT(putBadVerReq)).status, 400);

    const putStaleVerReq = new NextRequest("http://127.0.0.1:3000/api/report-card", {
      method: "PUT",
      headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify({
        classCode: "VT-C4K-SYNC01",
        expectedVersion: getOkJson.record.draftVersion + 50,
        patchOverrides: { [makeOverrideKey("STU_MINH", "cp1_theory")]: 4.5 },
      }),
    });
    assert.equal((await reportCardPUT(putStaleVerReq)).status, 409);

    const putOkReq = new NextRequest("http://127.0.0.1:3000/api/report-card", {
      method: "PUT",
      headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify({
        classCode: "VT-C4K-SYNC01",
        expectedVersion: getOkJson.record.draftVersion,
        patchOverrides: { [makeOverrideKey("STU_MINH", "cp1_theory")]: 4.75 },
      }),
    });
    const putOkRes = await reportCardPUT(putOkReq);
    assert.equal(putOkRes.status, 200);
    const putOkJson = await putOkRes.json();
    assert.equal(putOkJson.success, true);
    assert.equal(putOkJson.reportCard.students[0].cp1.theory.value, 4.75);

    // POST sync-teaching while WAITING_APPROVAL must return 400
    const syncBeforeApproveReq = new NextRequest(
      "http://127.0.0.1:3000/api/report-card/sync-teaching",
      {
        method: "POST",
        headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
        body: JSON.stringify({
          classCode: "VT-C4K-SYNC01",
          expectedVersion: putOkJson.record.draftVersion,
        }),
      }
    );
    const syncBeforeApproveRes = await reportCardSyncPOST(syncBeforeApproveReq);
    assert.equal(syncBeforeApproveRes.status, 400);

    // POST approve via /api/report-card -> 200
    const approveApiReq = new NextRequest("http://127.0.0.1:3000/api/report-card", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify({
        action: "approve",
        classCode: "VT-C4K-SYNC01",
        expectedVersion: putOkJson.record.draftVersion,
      }),
    });
    const approveApiRes = await reportCardPOST(approveApiReq);
    assert.equal(approveApiRes.status, 200);
    const approveApiJson = await approveApiRes.json();
    assert.equal(approveApiJson.record.status, "APPROVED");

    // 5I. Stage 3 Codex Audit Regressions (S3-01 .. S3-09)
    // S3-01: Bare numeric local studentId ("101" for "Nguyễn Văn An") must match exact-tone #102 ("Nguyễn Văn An") instead of #101 ("Nguyễn Văn Ân"), and must reject duplicate remote names
    const s301LocalStudents = computeClassReportCard(
      {
        classId: "VT-C4K-S301",
        classCode: "VT-C4K-S301",
        isRobotics: false,
        scrapedAt: "2026-10-29T00:00:00Z",
        btvnSessions: [],
        students: [
          {
            studentId: "101",
            fullName: "Nguyễn Văn An",
            isActive: true,
            btvnScores: {},
            stageScores: {
              cp1Theory: 4,
              cp1Practice: 4,
              cp1Competency: 4,
              cp2Theory: 4,
              cp2Practice: 4,
              cp2Competency: 4,
              finalProduct: 4,
              finalCompetency: 4,
            },
          },
        ],
      },
      {}
    ).students;

    const s301Matched = matchReportCardStudentsToTeaching(
      s301LocalStudents,
      [
        { id: 101, student_name: "Nguyễn Văn Ân", class_code: "VT-C4K-S301", status: "active" },
        { id: 102, student_name: "Nguyễn Văn An", class_code: "VT-C4K-S301", status: "active" },
      ],
      "VT-C4K-S301"
    );
    assert.equal(
      s301Matched.get("101")?.teachingStudentId,
      102,
      "S3-01: Bare numeric local studentId must NOT override exact tone match (#102 Nguyễn Văn An)"
    );
    assert.throws(
      () =>
        matchReportCardStudentsToTeaching(
          s301LocalStudents,
          [
            { id: 101, student_name: "Nguyễn Văn An", class_code: "VT-C4K-S301", status: "active" },
            { id: 102, student_name: "Nguyễn Văn An", class_code: "VT-C4K-S301", status: "active" },
          ],
          "VT-C4K-S301"
        ),
      /trùng tên/i,
      "S3-01: Bare numeric local studentId must not bypass duplicate remote name check"
    );

    // S3-02: Inactive remote students (inactive, dropped, nghỉ học, nghi_hoc) must NEVER be matched
    for (const inactiveStatus of ["inactive", "dropped", "nghỉ học", "nghi_hoc", "tam_nghi", "bao_luu"]) {
      assert.throws(
        () =>
          matchReportCardStudentsToTeaching(
            s301LocalStudents,
            [
              {
                id: 101,
                student_name: "Nguyễn Văn An",
                class_code: "VT-C4K-S301",
                status: inactiveStatus,
              },
            ],
            "VT-C4K-S301"
          ),
        /nghỉ học|inactive/i,
        `S3-02: Inactive status "${inactiveStatus}" must be rejected`
      );
    }
    const s302ActiveBesideAsciiInactive = matchReportCardStudentsToTeaching(
      s301LocalStudents,
      [
        { id: 101, student_name: "Nguyễn Văn An", class_code: "VT-C4K-S301", status: "nghi_hoc" },
        { id: 102, student_name: "Nguyễn Văn An", class_code: "VT-C4K-S301", status: "active" },
      ],
      "VT-C4K-S301"
    );
    assert.equal(
      s302ActiveBesideAsciiInactive.get("101")?.teachingStudentId,
      102,
      "S3-02: nghi_hoc must be excluded so active #102 is selected without false ambiguity"
    );

    // S3-03: Missing/blank/malformed normalized_score or stale normalized_score on null slot must fail Read-after-Write
    for (const badNorm of [undefined, null, "", "   ", [] as any]) {
      const reAppS303 = reportCardRepo.approveReportCard(
        "VT-C4K-SYNC01",
        reportCardRepo.findOne("VT-C4K-SYNC01")!.draftVersion
      );
      assert.equal(reAppS303.success, true);
      const badNormRes = await TeachingReportCardSyncService.syncReportCardToTeaching(
        "VT-C4K-SYNC01",
        {
          expectedVersion: reAppS303.record.draftVersion,
          transport: createMockTeachingTransport({
            classCode: "VT-C4K-SYNC01",
            students: [
              { id: 101, student_name: "Nguyễn Lê Minh" },
              { id: 102, student_name: "Trần Minh Khang" },
            ],
            tamperReadbackScores: (rows) =>
              rows.map((r, i) => (i === 0 ? { ...r, normalized_score: badNorm } : r)),
          }),
        }
      );
      assert.equal(badNormRes.success, false, "S3-03: Missing/malformed normalized_score must fail");
      assert.equal(badNormRes.record?.status, "FAILED");
    }

    const reAppS303NullNorm = reportCardRepo.approveReportCard(
      "VT-C4K-SYNC01",
      reportCardRepo.findOne("VT-C4K-SYNC01")!.draftVersion
    );
    assert.equal(reAppS303NullNorm.success, true);
    const staleNullNormRes = await TeachingReportCardSyncService.syncReportCardToTeaching(
      "VT-C4K-SYNC01",
      {
        expectedVersion: reAppS303NullNorm.record.draftVersion,
        transport: createMockTeachingTransport({
          classCode: "VT-C4K-SYNC01",
          students: [
            { id: 101, student_name: "Nguyễn Lê Minh" },
            { id: 102, student_name: "Trần Minh Khang" },
          ],
          tamperReadbackScores: (rows) => [
            ...rows,
            {
              student_id: 102,
              class_code: "VT-C4K-SYNC01",
              session_number: 2,
              exercise_type: "btvn",
              exercise_form: "theory",
              raw_score: null,
              normalized_score: 5,
            },
          ],
        }),
      }
    );
    assert.equal(
      staleNullNormRes.success,
      false,
      "S3-03: Stale normalized_score on an expected-null slot must fail Read-after-Write"
    );

    // S3-05: Omitting expectedVersion at service boundary must fail with 400
    const omitVerRes = await TeachingReportCardSyncService.syncReportCardToTeaching(
      "VT-C4K-SYNC01",
      {
        transport: mockTransport5B,
      }
    );
    assert.equal(omitVerRes.success, false);
    assert.equal(omitVerRes.statusCode, 400);

    // S3-06: Malformed JSON & non-object JSON must return 400 (never 500)
    for (const badBody of ["{", "[]", "null", '"str"']) {
      for (const [m, handler, u] of [
        ["POST", reportCardPOST, "http://127.0.0.1:3000/api/report-card"],
        ["PUT", reportCardPUT, "http://127.0.0.1:3000/api/report-card"],
        ["POST", reportCardSyncPOST, "http://127.0.0.1:3000/api/report-card/sync-teaching"],
      ] as const) {
        const res = await handler(
          new NextRequest(u, {
            method: m,
            headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
            body: badBody,
          })
        );
        assert.equal(res.status, 400, `S3-06: ${m} ${u} with body ${badBody} must return 400`);
      }
    }

    // S3-07: Explicit PUT actions (set_override, clear_override, reset_student_overrides, reset_all_overrides, approve) & contradictory action rejection
    let curVer = reportCardRepo.findOne("VT-C4K-SYNC01")!.draftVersion;
    const setOvRes = await reportCardPUT(
      new NextRequest("http://127.0.0.1:3000/api/report-card", {
        method: "PUT",
        headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
        body: JSON.stringify({
          action: "set_override",
          classId: "VT-C4K-SYNC01",
          expectedVersion: curVer,
          studentId: "STU_MINH",
          fieldKey: "cp1_theory",
          normScore: 3.25,
        }),
      })
    );
    assert.equal(setOvRes.status, 200);
    const setOvJson = await setOvRes.json();
    assert.equal(setOvJson.reportCard.students[0].cp1.theory.value, 3.25);
    curVer = setOvJson.record.draftVersion;

    // Contradictory clear_override + updates must be rejected with 400
    const contradictoryPutRes = await reportCardPUT(
      new NextRequest("http://127.0.0.1:3000/api/report-card", {
        method: "PUT",
        headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
        body: JSON.stringify({
          action: "clear_override",
          classId: "VT-C4K-SYNC01",
          expectedVersion: curVer,
          updates: [{ studentId: "STU_MINH", fieldKey: "cp1_theory", normScore: 2 }],
        }),
      })
    );
    assert.equal(contradictoryPutRes.status, 400, "S3-07: Contradictory clear_override + updates must return 400");

    // Valid clear_override
    const clearOvRes = await reportCardPUT(
      new NextRequest("http://127.0.0.1:3000/api/report-card", {
        method: "PUT",
        headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
        body: JSON.stringify({
          action: "clear_override",
          classId: "VT-C4K-SYNC01",
          expectedVersion: curVer,
          studentId: "STU_MINH",
          fieldKey: "cp1_theory",
        }),
      })
    );
    assert.equal(clearOvRes.status, 200);
    const clearOvJson = await clearOvRes.json();
    assert.equal(clearOvJson.reportCard.students[0].cp1.theory.isOverridden, false);
    curVer = clearOvJson.record.draftVersion;

    // Put approve action
    const putApproveRes = await reportCardPUT(
      new NextRequest("http://127.0.0.1:3000/api/report-card", {
        method: "PUT",
        headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          classId: "VT-C4K-SYNC01",
          expectedVersion: curVer,
        }),
      })
    );
    assert.equal(putApproveRes.status, 200);
    const putApproveJson = await putApproveRes.json();
    assert.equal(putApproveJson.record.status, "APPROVED");

    // Round 2 boundary regressions:
    // 1) Explicit TEACHING_101 / TID:101 binding with wrong Vietnamese tone must throw (never fall through to no-tone)
    for (const explicitBindId of ["TEACHING_101", "TID:101"]) {
      const explicitBindStudent = [{ ...s301LocalStudents[0], studentId: explicitBindId, fullName: "Nguyễn Văn An" }];
      assert.throws(
        () =>
          matchReportCardStudentsToTeaching(
            explicitBindStudent,
            [{ id: 101, student_name: "Nguyễn Văn Ân", class_code: "VT-C4K-S301", status: "active" }],
            "VT-C4K-S301"
          ),
        /dấu tiếng Việt|không khớp/i,
        `S3-01 Round 2: Explicit binding ${explicitBindId} must reject tone mismatch without falling through`
      );
    }

    // 2) S3-03 Round 2: 0.01 cent normalized_score discrepancy (4.01 or 3.99 instead of 4.00) must fail Read-after-Write
    for (const centDelta of [0.01, -0.01]) {
      const reAppCent = reportCardRepo.approveReportCard(
        "VT-C4K-SYNC01",
        reportCardRepo.findOne("VT-C4K-SYNC01")!.draftVersion
      );
      assert.equal(reAppCent.success, true);
      const centRes = await TeachingReportCardSyncService.syncReportCardToTeaching(
        "VT-C4K-SYNC01",
        {
          expectedVersion: reAppCent.record.draftVersion,
          transport: createMockTeachingTransport({
            classCode: "VT-C4K-SYNC01",
            students: [
              { id: 101, student_name: "Nguyễn Lê Minh" },
              { id: 102, student_name: "Trần Minh Khang" },
            ],
            tamperReadbackScores: (rows) =>
              rows.map((r, i) =>
                i === 0
                  ? { ...r, normalized_score: round2(Number(r.normalized_score) + centDelta) }
                  : r
              ),
          }),
        }
      );
      assert.equal(
        centRes.success,
        false,
        `S3-03 Round 2: ${centDelta} normalized discrepancy must fail Read-after-Write`
      );
    }

    // 3) S3-07 Round 2: Conflicting top-level score + updates array in set_override must be rejected with 400
    const conflictSourcePut = await reportCardPUT(
      new NextRequest("http://127.0.0.1:3000/api/report-card", {
        method: "PUT",
        headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
        body: JSON.stringify({
          action: "set_override",
          classId: "VT-C4K-SYNC01",
          expectedVersion: reportCardRepo.findOne("VT-C4K-SYNC01")!.draftVersion,
          studentId: "STU_MINH",
          fieldKey: "cp1_theory",
          normScore: 1,
          updates: [{ studentId: "STU_MINH", fieldKey: "cp1_theory", normScore: 5 }],
        }),
      })
    );
    assert.equal(
      conflictSourcePut.status,
      400,
      "S3-07 Round 2: Conflicting top-level + updates payload must return 400"
    );

    console.log("✅ [RC-05] TeachingReportCardSyncService & API Routes PASSED 100%!");

    // =========================================================================
    // [RC-06] Stage 4: TeachingReportCardView UI, Client Boundary Security & Streamlining
    // =========================================================================
    console.log("\n👉 [RC-06] Testing Stage 4 UI (TeachingReportCardView, /homework-grader, /syllabus-config, / & top-navbar)...");
    const { sanitizeReportCardTsvCell } = await import(
      "../src/components/teaching-report-card-view"
    );

    // 1. Verify TSV formula-injection guard
    assert.equal(sanitizeReportCardTsvCell("=SUM(A1:A5)"), "'=SUM(A1:A5)");
    assert.equal(sanitizeReportCardTsvCell("+cmd|' /C calc'!A0"), "'+cmd|' /C calc'!A0");
    assert.equal(sanitizeReportCardTsvCell("-10+20"), "'-10+20");
    assert.equal(sanitizeReportCardTsvCell("@HYPERLINK(\"http://evil\")"), "'@HYPERLINK(\"http://evil\")");
    assert.equal(sanitizeReportCardTsvCell("Nguyễn\tAn\nBình"), "Nguyễn An Bình");

    // 2. Verify Client Component security boundaries across all modified UI files
    const clientUiFiles = [
      "src/components/teaching-report-card-view.tsx",
      "src/app/homework-grader/page.tsx",
      "src/app/syllabus-config/page.tsx",
      "src/components/top-navbar.tsx",
    ];
    const forbiddenClientTokens = [
      "TEACHING_PASSWORD",
      "LMS_PASSWORD",
      "GEMINI_API_KEY",
      "@/lib/config",
      "@/lib/db/",
      "@/lib/playwright/",
      "better-sqlite3",
    ];

    for (const relFile of clientUiFiles) {
      const fullPath = path.resolve(process.cwd(), relFile);
      const src = fs.readFileSync(fullPath, "utf8");
      assert.ok(
        src.startsWith('"use client";'),
        `RC-06: ${relFile} must start with "use client";`
      );
      for (const token of forbiddenClientTokens) {
        assert.ok(
          !src.includes(token),
          `RC-06 Security: ${relFile} must NEVER contain or import '${token}'`
        );
      }
    }

    // 3. Verify TeachingReportCardView features & API wiring
    const rcViewSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/teaching-report-card-view.tsx"),
      "utf8"
    );
    for (const requiredMarker of [
      "/api/report-card",
      "/api/report-card/sync-teaching",
      "teachingmindx.top/diem-tong-ket.php",
      "computedReportCard.showBtvnBlock",
      "setScaleMode",
      "selectedBtvnSessions",
      "stageFilter",
      "handleSortColumn",
      "set_override",
      "clear_override",
      "reset_all_overrides",
      "expectedVersion",
      "showFormulaModal",
      "activeChartModal",
      "Mốc Đạt (2.50)",
      "Copy ảnh BTVN",
      "Copy ảnh Tổng kết",
      "Đồng bộ điểm lên Teaching",
    ]) {
      assert.ok(
        rcViewSource.includes(requiredMarker),
        `RC-06: teaching-report-card-view.tsx must include '${requiredMarker}'`
      );
    }

    // 4. Verify UI streamlining in /homework-grader & /syllabus-config & top-navbar
    const hwGraderSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/homework-grader/page.tsx"),
      "utf8"
    );
    assert.ok(
      hwGraderSource.includes("<TeachingReportCardView"),
      "RC-06: /homework-grader must render <TeachingReportCardView />"
    );
    assert.ok(
      !hwGraderSource.includes("<HomeworkAutoGraderTab"),
      "RC-06: /homework-grader must remove the redundant <HomeworkAutoGraderTab /> from UI"
    );
    assert.ok(
      fs.existsSync(
        path.resolve(process.cwd(), "src/components/homework-auto-grader-tab.tsx")
      ),
      "RC-06: src/components/homework-auto-grader-tab.tsx must remain intact on disk"
    );

    const syllabusPageSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/syllabus-config/page.tsx"),
      "utf8"
    );
    assert.ok(
      !syllabusPageSource.includes('setActiveTab("rubrics")'),
      "RC-06: /syllabus-config must hide the redundant Barem tab button in UI"
    );

    const topNavbarSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/top-navbar.tsx"),
      "utf8"
    );
    assert.ok(
      topNavbarSource.includes("Phiếu điểm & BTVN"),
      "RC-06: top-navbar.tsx must show updated label 'Phiếu điểm & BTVN'"
    );

    // 5. Execute behavioral Stage 4 UI probe (S4-01..S4-06 + Canvas/TSV/Robotics/Chart controls)
    const { createRequire: createReqRc06 } = await import("node:module");
    const reqRc06 = createReqRc06(import.meta.url);
    const { transformSync: transformTsxRc06 } = reqRc06("esbuild");

    const deferRc06 = <T = any>() => {
      let resolve!: (val: T) => void;
      const promise = new Promise<T>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    };
    const respRc06 = (data: any, ok = true) => ({ ok, json: async () => data });
    const fixtureRc06 = (code: string, version = 2, opts: Record<string, any> = {}) => {
      const scores = {
        cp1Theory: 2,
        cp1Practice: 4,
        cp1Competency: 5,
        cp2Theory: 4,
        cp2Practice: 2,
        cp2Competency: 3,
        finalProduct: 5,
        finalCompetency: 1,
      };
      const snapshot: ClassReportCardLmsSnapshot = {
        classId: code,
        classCode: code,
        isRobotics: false,
        scrapedAt: "2026-10-29T00:00:00Z",
        btvnSessions: [1, 2].map((n) => ({
          sessionNumber: n,
          title: `Lesson ${n}`,
          hasTheory: true,
          hasPractice: true,
          practiceTaskCount: 2,
          maxTheoryScore: 100,
          maxPracticeScore: 100,
        })),
        students: [
          {
            studentId: "SHARED",
            fullName: `Pupil ${code}`,
            isActive: true,
            btvnScores: {
              1: {
                sessionNumber: 1,
                theoryRaw: 80,
                theoryMax: 100,
                practiceRaw: 60,
                practiceMax: 100,
                practiceTask1Raw: 40,
                practiceTask2Raw: 80,
              },
              2: {
                sessionNumber: 2,
                theoryRaw: 20,
                theoryMax: 100,
                practiceRaw: null,
                practiceMax: 100,
              },
            },
            stageScores: scores,
          },
        ],
        ...opts,
      };
      return {
        success: true,
        record: {
          classId: code,
          classCode: code,
          draftVersion: version,
          status: "APPROVED",
          contentHash: `hash-${code}-${version}`,
        },
        snapshot,
        overrides: {},
        reportCard: computeClassReportCard(snapshot),
      };
    };

    const exposedRc06 = [
      "record",
      "snapshot",
      "overrides",
      "computedReportCard",
      "selectedBtvnSessions",
      "isLoading",
      "errorMsg",
      "toastMsg",
      "overrideModal",
      "loadReportCard",
      "handleScrapeFromLms",
      "handleApproveReportCard",
      "handleSyncToTeaching",
      "handleSaveManualOverride",
      "handleClearSingleOverride",
      "handleResetAllOverrides",
      "openOverrideEditor",
      "setOverrideInputValue",
      "setOverrideInputMode",
      "setSelectedBtvnSessions",
      "setStageFilter",
      "setScaleMode",
      "setShowFormulaModal",
      "setActiveChartModal",
      "setChartVisibility",
      "handleCopyTsvToSheets",
      "handleCopyBlockImageToZalo",
      "handleCopyChartImage",
      "handleSortColumn",
      "sortedStudents",
      "chartCanvasRef",
      "isScrapingLms",
      "isApproving",
      "isSyncingTeaching",
      "isSavingOverride",
      "overrideInputValue",
      "isClassMatched",
    ];

    function createRc06Harness(fetchImpl: any, props: Record<string, any> = {}, parent = false) {
      let src = fs.readFileSync(
        path.resolve(
          process.cwd(),
          parent ? "src/app/homework-grader/page.tsx" : "src/components/teaching-report-card-view.tsx"
        ),
        "utf8"
      );
      let names = exposedRc06;
      let compName = "TeachingReportCardView";
      if (parent) {
        src = src.slice(0, src.indexOf("  const renderCellBadge ="));
        names = ["handleScrapeScores", "statusMessage"];
        compName = "HomeworkGraderPage";
        src += `\nglobalThis.api = {${names.join(",")}}; return null; }`;
      } else {
        const marker = '\n  return (\n    <div className="space-y-5">';
        src = src.replace(marker, `\nglobalThis.api = {${names.join(",")}};${marker}`);
      }
      src = src
        .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
        .replace(/\bexport\s+default\s+/g, "")
        .replace(/\bexport\s+/g, "");
      const js = transformTsxRc06(src, { loader: "tsx", target: "es2022", jsx: "transform" }).code;
      const slots: any[] = [];
      const depsArr: any[] = [];
      const memoVals: any[] = [];
      const cleanups: any[] = [];
      let cursor = 0;
      let dirty = true;
      let pending: any[] = [];
      let tree: any;
      const changed = (a: any, b: any) =>
        !a || !b || a.length !== b.length || a.some((v: any, i: number) => !Object.is(v, b[i]));
      const hooks = {
        useState(initial: any) {
          const i = cursor++;
          if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
          return [
            slots[i],
            (val: any) => {
              const next = typeof val === "function" ? val(slots[i]) : val;
              if (!Object.is(next, slots[i])) {
                slots[i] = next;
                dirty = true;
              }
            },
          ];
        },
        useRef(initial: any) {
          const i = cursor++;
          if (!(i in slots)) slots[i] = { current: initial };
          return slots[i];
        },
        useEffect(fn: any, deps: any) {
          const i = cursor++;
          if (changed(depsArr[i], deps)) {
            depsArr[i] = deps;
            pending.push(() => {
              cleanups[i]?.();
              cleanups[i] = fn();
            });
          }
        },
        useMemo(fn: any, deps: any) {
          const i = cursor++;
          if (changed(depsArr[i], deps)) {
            depsArr[i] = deps;
            memoVals[i] = fn();
          }
          return memoVals[i];
        },
        useCallback(fn: any, deps: any) {
          return hooks.useMemo(() => fn, deps);
        },
      };
      const ctx = vm.createContext({
        console,
        computeClassReportCard,
        formatScore2,
        normalizeScoreToScale5,
        round2,
        ...hooks,
        setTimeout,
        clearTimeout,
        encodeURIComponent,
        fetch: fetchImpl,
        React: {
          ...hooks,
          Fragment: "fragment",
          createElement(type: any, p: any, ...children: any[]) {
            return { type, props: { ...p, children } };
          },
        },
        navigator: { clipboard: { writeText: async () => {}, write: async () => {} } },
        window: {
          devicePixelRatio: 2,
          ClipboardItem: class {},
          localStorage: { getItem: () => null, setItem() {} },
        },
        document: {
          createElement() {
            return {
              width: 0,
              height: 0,
              getContext: () => new Proxy({}, { get: () => () => {} }),
              toBlob: (cb: any) => cb({ type: "image/png" }),
              toDataURL: () => "data:image/png;base64,stub",
              click() {},
            };
          },
        },
      });
      vm.runInContext(js + `\nglobalThis.render = ${compName};`, ctx);
      let currentProps = { classId: "A", classCode: "A", ...props };
      const flush = async () => {
        for (let n = 0; n < 12; n++) {
          await new Promise((r) => setImmediate(r));
          if (dirty) {
            dirty = false;
            cursor = 0;
            tree = ctx.render(currentProps);
            const effects = pending;
            pending = [];
            effects.forEach((fn) => fn());
          }
        }
      };
      return {
        get api() {
          return ctx.api;
        },
        get tree() {
          return tree;
        },
        flush,
        props(next: Record<string, any>) {
          currentProps = { ...currentProps, ...next };
          dirty = true;
        },
      };
    }

    // S4-01 & S4-02: Late mutation from Class A must not overwrite Class B; unseen Class B cannot be approved while loading
    {
      const delayed = deferRc06();
      const h = createRc06Harness((url: string, options?: any) => {
        if (options?.method) return delayed.promise;
        const cid = new URL(String(url), "http://local").searchParams.get("classId") || "A";
        return Promise.resolve(respRc06(fixtureRc06(cid)));
      });
      await h.flush();
      const pendingApprove = h.api.handleApproveReportCard();
      h.props({ classId: "B", classCode: "B" });
      await h.flush();
      assert.equal(h.api.record.classId, "B");
      delayed.resolve(respRc06(fixtureRc06("A", 3)));
      await pendingApprove;
      await h.flush();
      assert.equal(h.api.record.classId, "B", "S4-01: Late Class A approve must not overwrite Class B");
      assert.equal(h.api.snapshot.classId, "B", "S4-01: Late Class A snapshot must not overwrite Class B");
    }

    // S4-02: While Class B GET is pending, record is null and handleApproveReportCard is blocked
    {
      const delayedB = deferRc06();
      let postCalled = false;
      const h = createRc06Harness((url: string, options?: any) => {
        if (options?.method) {
          postCalled = true;
          return Promise.resolve(respRc06(fixtureRc06("B", 3)));
        }
        return String(url).includes("classId=B")
          ? delayedB.promise
          : Promise.resolve(respRc06(fixtureRc06("A", 2)));
      });
      await h.flush();
      h.props({ classId: "B", classCode: "B" });
      await h.flush();
      assert.equal(h.api.isLoading, true);
      assert.equal(h.api.record, null, "S4-02: Switching to Class B must immediately clear Class A record");
      await h.api.handleApproveReportCard();
      await h.flush();
      assert.equal(postCalled, false, "S4-02: Cannot approve unseen Class B while GET is pending");
      delayedB.resolve(respRc06(fixtureRc06("B", 2)));
      await h.flush();
      assert.equal(h.api.record.classId, "B");
    }

    // S4-03: Manual editor opened at v2 rejects stale save when background refresh updates class to v3
    {
      let cur = fixtureRc06("A", 2);
      let putBody: any = null;
      const h = createRc06Harness((_url: string, options?: any) => {
        if (options?.method) {
          putBody = JSON.parse(options.body);
          return Promise.resolve(respRc06(cur));
        }
        return Promise.resolve(respRc06(cur));
      });
      await h.flush();
      h.api.openOverrideEditor({
        studentId: "SHARED",
        studentName: "Pupil A",
        fieldKey: "cp1_theory",
        fieldLabel: "CP1 LT",
        currentNorm: 2,
        currentRaw: 2,
        lmsNorm: 2,
        lmsRaw: 2,
        maxRawScore: 5,
        isBtvnField: false,
        isOverridden: false,
        note: "",
      });
      await h.flush();
      cur = fixtureRc06("A", 3);
      cur.snapshot.students[0].stageScores.cp1Theory = 5;
      cur.reportCard = computeClassReportCard(cur.snapshot);
      await h.api.loadReportCard("A");
      await h.flush();
      assert.equal(h.api.computedReportCard.students[0].cp1.theory.value, 5);
      await h.api.handleSaveManualOverride();
      await h.flush();
      assert.equal(putBody, null, "S4-03: Stale editor opened at v2 must not overwrite v3");
      assert.ok(h.api.errorMsg?.includes("v3"), "S4-03: Must show version conflict error");
    }

    // S4-04: Explicit empty BTVN session selection stays [] (0 active sessions)
    {
      const h = createRc06Harness(async () => respRc06(fixtureRc06("A")));
      await h.flush();
      h.api.setSelectedBtvnSessions([]);
      await h.flush();
      assert.deepEqual(
        Array.from(h.api.computedReportCard.activeBtvnSessionNumbers),
        [],
        "S4-04: Empty BTVN selection must remain empty, not reselect all"
      );
      assert.equal(h.api.computedReportCard.students[0].btvnAvgNorm, null);
    }

    // S4-05: Parent scrape failure propagates error to child without false success toast
    {
      const parentH = createRc06Harness(
        async () => respRc06({ success: false, error: "LMS scrape failed" }, false),
        {},
        true
      );
      await parentH.flush();
      const childH = createRc06Harness(async () => respRc06(fixtureRc06("A")), {
        onRequestScrapeLms: () => parentH.api.handleScrapeScores(),
      });
      await childH.flush();
      await childH.api.handleScrapeFromLms();
      await parentH.flush();
      await childH.flush();
      assert.equal(childH.api.toastMsg, null, "S4-05: Must not show success toast on scrape failure");
      assert.ok(childH.api.errorMsg?.includes("LMS scrape failed"));
    }

    // S4-01 (Round 2): Delayed mutation response/JSON (v3) after a newer same-class GET (v4) must not regress v4 across all 6 actions
    {
      const actions = [
        "handleApproveReportCard",
        "handleSyncToTeaching",
        "handleSaveManualOverride",
        "handleClearSingleOverride",
        "handleResetAllOverrides",
        "handleScrapeFromLms",
      ] as const;

      for (const action of actions) {
        for (const phase of ["fetch", "json"] as const) {
          const gate = deferRc06();
          const reloadGate = deferRc06();
          let getCount = 0;
          const older = fixtureRc06("A", 3);
          older.snapshot.students[0].stageScores.cp1Theory = 1;
          older.reportCard = computeClassReportCard(older.snapshot);
          const newer = fixtureRc06("A", 4);
          newer.snapshot.students[0].stageScores.cp1Theory = 5;
          newer.reportCard = computeClassReportCard(newer.snapshot);

          const h = createRc06Harness((_url: string, opts?: any) => {
            if (opts?.method) {
              return phase === "fetch"
                ? gate.promise
                : Promise.resolve({ ok: true, json: () => gate.promise });
            }
            getCount++;
            if (getCount === 1) return Promise.resolve(respRc06(fixtureRc06("A", 2)));
            if (getCount === 2) return Promise.resolve(respRc06(newer));
            return reloadGate.promise;
          });
          await h.flush();
          if (action === "handleSaveManualOverride" || action === "handleClearSingleOverride") {
            h.api.openOverrideEditor({
              studentId: "SHARED",
              studentName: "Pupil A",
              fieldKey: "cp1_theory",
              fieldLabel: "CP1 LT",
              currentNorm: 2,
              currentRaw: 2,
              lmsNorm: 2,
              lmsRaw: 2,
              maxRawScore: 5,
              isBtvnField: false,
              isOverridden: true,
              note: "",
            });
            await h.flush();
          }

          const pending = h.api[action]();
          await h.flush();
          h.props({ scrapeTrigger: `external-v4-${action}-${phase}` });
          await h.flush();
          assert.equal(h.api.record.draftVersion, 4);
          gate.resolve(phase === "fetch" ? respRc06(older) : older);
          await h.flush();
          if (action === "handleScrapeFromLms") {
            reloadGate.resolve(respRc06(newer));
          }
          await pending;
          await h.flush();
          assert.equal(
            h.api.record.draftVersion,
            4,
            `S4-01 R2: ${action} (${phase}) must not regress v4 to v3`
          );
          assert.equal(h.api.computedReportCard.students[0].cp1.theory.value, 5);
          assert.equal(h.api.toastMsg, null, `S4-01 R2: ${action} (${phase}) must not toast on rejected v3`);
        }
      }
    }

    // R2-01 (Round 2): Overlapping operation types release their own busy flags without stranding controls
    {
      for (const first of [
        "handleApproveReportCard",
        "handleSyncToTeaching",
        "handleScrapeFromLms",
      ] as const) {
        const firstGate = deferRc06();
        let writes = 0;
        const seeded = fixtureRc06("A", 2);
        (seeded as any).overrides = { "SHARED::cp1_theory": { normScore: 2 } };
        const resetPayload = fixtureRc06("A", 3);
        resetPayload.record.status = "DRAFT";
        const h = createRc06Harness((_url: string, opts?: any) => {
          if (!opts?.method) return Promise.resolve(respRc06(seeded));
          writes++;
          return writes === 1 ? firstGate.promise : Promise.resolve(respRc06(resetPayload));
        });
        await h.flush();
        const pendingFirst = h.api[first]();
        await h.flush();
        await h.api.handleResetAllOverrides();
        await h.flush();
        firstGate.resolve(respRc06(fixtureRc06("A", 2)));
        await pendingFirst;
        await h.flush();
        assert.equal(h.api.isApproving, false, `R2-01: ${first} isApproving must be false`);
        assert.equal(h.api.isSyncingTeaching, false, `R2-01: ${first} isSyncingTeaching must be false`);
        assert.equal(h.api.isScrapingLms, false, `R2-01: ${first} isScrapingLms must be false`);
        assert.equal(h.api.isSavingOverride, false, `R2-01: ${first} isSavingOverride must be false`);
      }
    }

    // S4-06: Formula modal & rank legend match calculator weights (40/60 CP, 60/40 DEMO, 40/60 TBCK, 4.50/4.00/2.50)
    assert.ok(
      rcViewSource.includes("Tổng_CP = round(TB_chưa_làm_tròn(LT, TH) × 0.4 + Năng_Lực × 0.6, 2)"),
      "S4-06: Formula modal must show 40% LT+TH + 60% NL for CP"
    );
    assert.ok(
      rcViewSource.includes("Tổng_DEMO = round(Sản_Phẩm × 0.6 + Năng_Lực × 0.4, 2)"),
      "S4-06: Formula modal must show 60% Product + 40% NL for DEMO"
    );
    assert.ok(
      rcViewSource.includes("Điểm_TBCK = round(TB_chưa_làm_tròn(Tổng_CP1, Tổng_CP2) × 0.4 + Tổng_DEMO × 0.6, 2)"),
      "S4-06: Formula modal must show 40% CP + 60% DEMO for TBCK"
    );
    assert.ok(
      rcViewSource.includes("Hạng A ≥ 4.50"),
      "S4-06: Rank legend must show Hạng A >= 4.50"
    );
    assert.ok(
      rcViewSource.includes("Hạng B ≥ 4.00"),
      "S4-06: Rank legend must show Hạng B >= 4.00"
    );

    console.log("✅ [RC-06] Stage 4 UI, Security Boundary, Streamlining & S4-01..S4-06 + R2-01 Behavioral Suite PASSED 100%!");

    console.log("\n==========================================================");
    console.log("🎉 ALL STAGE 1, STAGE 2, STAGE 3 & STAGE 4 REPORT CARD TESTS PASSED!");
    console.log("==========================================================");
  } finally {
    closeDb();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  }
}

runTests().catch((err) => {
  console.error("❌ TEST FAILED:", err);
  process.exit(1);
});
