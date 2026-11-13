import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { chromium } from "playwright";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-rc-batch-test-"));
const tempConfigDir = path.join(tempDir, "config");
process.env.MINDX_DB_PATH = path.join(tempDir, "mindx_rc_batch.db");
process.env.MINDX_CONFIG_DIR = tempConfigDir;
process.env.MINDX_RUNNING_CLASSES_PATH = path.join(
  tempDir,
  "running_classes.json"
);
process.env.MINDX_LMS_CLASS_IDS_PATH = path.join(
  tempConfigDir,
  "lms_class_ids.json"
);
process.env.ALLOWED_LOCAL_DIRS = tempDir;

async function main() {
  const {
    closeDb,
    getDb,
    reportCardRepo,
    studentRepo,
    parseManualOverridesMap,
    parseReportCardLmsSnapshot,
  } = await import("../src/lib/db/sqlite");
  const { computeClassReportCard } = await import(
    "../src/lib/report-card/report-card-calculator"
  );
  const {
    discoverRunningClassesForBatchSync,
    isSafeBatchClassCode,
    countSyncableReportCardScores,
    syncSingleClassReportCardFlow,
    runBatchReportCardSync,
  } = await import("../src/lib/report-card/report-card-batch-sync");
  const { taskQueue } = await import("../src/lib/queue/task-queue");
  const { TeachingReportCardSyncService } = await import(
    "../src/lib/playwright/teaching-report-card-sync"
  );
  const { GET: batchSyncGET, POST: batchSyncPOST } = await import(
    "../src/app/api/report-card/batch-sync/route"
  );

  function makeCodingSnapshot(
    classId: string,
    opts?: {
      withBtvn?: boolean;
      theoryRaw?: number;
      practiceRaw?: number;
      cp1Theory?: number | null;
      emptyStudents?: boolean;
    }
  ) {
    if (opts?.emptyStudents) {
      return {
        classId,
        classCode: classId,
        isRobotics: false,
        scrapedAt: new Date().toISOString(),
        btvnSessions: [],
        students: [],
      };
    }
    const withBtvn = opts?.withBtvn !== false;
    return {
      classId,
      classCode: classId,
      isRobotics: false,
      scrapedAt: new Date().toISOString(),
      btvnSessions: withBtvn
        ? [
            {
              sessionNumber: 1,
              title: "Bài 1",
              hasTheory: true,
              hasPractice: true,
              practiceTaskCount: 1,
              maxTheoryScore: 100,
              maxPracticeScore: 100,
            },
          ]
        : [],
      students: [
        {
          studentId: `${classId}_STU_01`,
          fullName: "Nguyễn Văn An",
          isActive: true,
          btvnScores: withBtvn
            ? {
                1: {
                  sessionNumber: 1,
                  theoryRaw: opts?.theoryRaw ?? 80,
                  theoryMax: 100,
                  practiceRaw: opts?.practiceRaw ?? 90,
                  practiceMax: 100,
                },
              }
            : {},
          stageScores: {
            cp1Theory: opts?.cp1Theory !== undefined ? opts.cp1Theory : 4.5,
            cp1Practice: withBtvn ? 4.0 : null,
            cp1Competency: withBtvn ? 4.0 : null,
            cp2Theory: null,
            cp2Practice: null,
            cp2Competency: null,
            finalProduct: null,
            finalCompetency: null,
          },
        },
      ],
    };
  }

  function makeRoboticsSnapshot(
    classId: string,
    opts?: { hasCp1?: boolean }
  ) {
    const hasCp1 = Boolean(opts?.hasCp1);
    return {
      classId,
      classCode: classId,
      isRobotics: true,
      scrapedAt: new Date().toISOString(),
      btvnSessions: [
        {
          sessionNumber: 1,
          title: "Robotics Buổi 1",
          hasTheory: true,
          hasPractice: true,
          practiceTaskCount: 1,
          maxTheoryScore: 100,
          maxPracticeScore: 100,
        },
      ],
      students: [
        {
          studentId: `${classId}_STU_01`,
          fullName: "Trần Gia Bảo",
          isActive: true,
          // Even if btvnScores exist in raw snapshot, Robotics never pushes BTVN!
          btvnScores: {
            1: {
              sessionNumber: 1,
              theoryRaw: 100,
              theoryMax: 100,
              practiceRaw: 100,
              practiceMax: 100,
            },
          },
          stageScores: {
            cp1Theory: hasCp1 ? 4.5 : null,
            cp1Practice: hasCp1 ? 4.0 : null,
            cp1Competency: hasCp1 ? 4.5 : null,
            cp2Theory: null,
            cp2Practice: null,
            cp2Competency: null,
            finalProduct: null,
            finalCompetency: null,
          },
        },
      ],
    };
  }

  function makeMockTransport(opts?: {
    failClasses?: Set<string>;
    remoteStudentsByClass?: Record<string, Array<{ id: number; student_name: string }>>;
    onSaveScores?: (classCode: string, scores: any[]) => void;
  }) {
    const exercisesByClass = new Map<string, any[]>();
    const scoresByClass = new Map<string, any[]>();

    return {
      async getStudents(classCode: string) {
        if (opts?.failClasses?.has(classCode)) {
          throw new Error(`Chưa có danh sách học viên lớp ${classCode} trên Teaching`);
        }
        const custom = opts?.remoteStudentsByClass?.[classCode];
        if (custom) {
          return custom.map((s) => ({
            id: s.id,
            student_name: s.student_name,
            class_code: classCode,
            status: "đang học",
          }));
        }
        return [
          {
            id: 101,
            student_name: classCode.includes("ROB")
              ? "Trần Gia Bảo"
              : "Nguyễn Văn An",
            class_code: classCode,
            status: "đang học",
          },
        ];
      },
      async getExercises(classCode: string) {
        return exercisesByClass.get(classCode) || [];
      },
      async getScores(classCode: string) {
        return scoresByClass.get(classCode) || [];
      },
      async addMultiExercise(payload: any) {
        const list = exercisesByClass.get(payload.classCode) || [];
        let nextId = list.length + 1;
        for (const sn of payload.sessions) {
          for (const ef of payload.exerciseForms) {
            list.push({
              id: nextId++,
              class_code: payload.classCode,
              session_number: sn,
              exercise_type: payload.exerciseType,
              exercise_form: ef,
              max_score: ef === "nang_luc" ? payload.maxScoreNangLuc || 5 : payload.maxScore,
            });
          }
        }
        exercisesByClass.set(payload.classCode, list);
        return { success: true };
      },
      async saveScores(scores: any[]) {
        if (!Array.isArray(scores) || scores.length === 0) {
          return { success: false, message: "Empty scores" };
        }
        const code = scores[0].class_code;
        opts?.onSaveScores?.(code, scores);
        const existing = scoresByClass.get(code) || [];
        const map = new Map<string, any>();
        for (const row of existing) {
          map.set(
            `${row.student_id}-${row.session_number}-${row.exercise_type}-${row.exercise_form}`,
            row
          );
        }
        for (const s of scores) {
          const norm = Math.round(((s.raw_score / s.max_score) * 5) * 100) / 100;
          map.set(
            `${s.student_id}-${s.session_number}-${s.exercise_type}-${s.exercise_form}`,
            {
              student_id: s.student_id,
              class_code: s.class_code,
              session_number: s.session_number,
              exercise_type: s.exercise_type,
              exercise_form: s.exercise_form,
              raw_score: s.raw_score,
              normalized_score: norm,
              max_score: s.max_score,
              note: s.note || "",
            }
          );
        }
        scoresByClass.set(code, Array.from(map.values()));
        return { success: true };
      },
    };
  }

  try {
    console.log("=== BS-01: Class Discovery Filtering & Stopped Queue ===");
    assert.equal(isSafeBatchClassCode(" vt-c4k-pti12 "), "VT-C4K-PTI12");
    assert.equal(isSafeBatchClassCode("TEST_CLASS_01"), null);
    assert.equal(
      isSafeBatchClassCode("TEST_CLASS_01", { allowSyntheticForTest: true }),
      "TEST_CLASS_01"
    );
    assert.equal(isSafeBatchClassCode("bad code!"), null);

    const fixedNow = new Date("2026-11-13T10:00:00+07:00").getTime();
    const discRes = await discoverRunningClassesForBatchSync({
      nowMs: fixedNow,
      fetchRunningClassesFn: async () => ({
        success: true,
        classes: [
          { classCode: "VT-C4K-PTA12", status: "Running", endDate: "30/12/2026" },
          { classCode: "VT-C4K-PTA12", status: "Running" }, // duplicate
          { classCode: "VT-C4K-PTB12", status: "Finished", endDate: "10/11/2026" }, // superseded by PTA12
          { classCode: "VT-JSB15", status: "Finished", endDate: "10/11/2026" }, // within 15d, no successor -> keep
          { classCode: "VT-JSB10", status: "Finished", endDate: "01/09/2026" }, // > 15d -> exclude
          { classCode: "TEST_SYNTH_01", status: "Running" }, // synthetic -> exclude
        ],
      }),
    });
    assert.equal(discRes.success, true);
    assert.equal(discRes.statusCode, 200);
    assert.deepEqual(
      discRes.classes.map((c) => c.classCode),
      ["VT-C4K-PTA12", "VT-JSB15"]
    );

    const stoppedDiscRes = await discoverRunningClassesForBatchSync({
      isQueueStoppedFn: () => true,
    });
    assert.equal(stoppedDiscRes.success, false);
    assert.equal(stoppedDiscRes.statusCode, 409);
    assert.equal(stoppedDiscRes.cancelled, true);

    console.log("=== BS-02: Mixed Batch Outcomes + Robotics Pre-CP1 + Error Isolation ===");
    const transport2 = makeMockTransport({
      failClasses: new Set(["VT-C4K-ERR1"]),
    });
    let teachingCallCountForUnchanged = 0;

    // Pre-seed UNCHANGED VERIFIED class
    const snapUnchanged = makeCodingSnapshot("VT-C4K-SAME");
    reportCardRepo.saveLmsSnapshot("VT-C4K-SAME", snapUnchanged as any);
    const sameInit = reportCardRepo.findOne("VT-C4K-SAME")!;
    reportCardRepo.approveReportCard("VT-C4K-SAME", sameInit.draftVersion);
    const sameApproved = reportCardRepo.findOne("VT-C4K-SAME")!;
    const preSyncRes = await TeachingReportCardSyncService.syncReportCardToTeaching(
      "VT-C4K-SAME",
      {
        classCode: "VT-C4K-SAME",
        expectedVersion: sameApproved.draftVersion,
        transport: transport2 as any,
      }
    );
    assert.equal(preSyncRes.success, true);

    const batchMixed = await runBatchReportCardSync({
      classCodes: [
        "VT-C4K-PTI12", // Coding with scores -> SYNCED
        "VT-C4K-SAME", // Unchanged -> SKIPPED_UNCHANGED (0 Teaching calls)
        "VT-ROB-01", // Robotics pre-CP1 (has btvnScores in raw snap, 0 CP/Final) -> SKIPPED_NO_SCORES
        "VT-C4K-NEW1", // Newly opened Coding (0 students) -> SKIPPED_NO_SCORES
        "VT-C4K-ERR1", // Teaching mismatch -> NEEDS_ATTENTION (isolated)
        "VT-C4K-PTI13", // Must STILL run after VT-C4K-ERR1 -> SYNCED!
      ],
      scrapeFn: async (code) => {
        if (code === "VT-C4K-NEW1") {
          reportCardRepo.saveLmsSnapshot(
            code,
            makeCodingSnapshot(code, { emptyStudents: true }) as any
          );
        } else if (code === "VT-ROB-01") {
          reportCardRepo.saveLmsSnapshot(
            code,
            makeRoboticsSnapshot(code, { hasCp1: false }) as any
          );
        } else if (code === "VT-C4K-SAME") {
          reportCardRepo.saveLmsSnapshot(
            code,
            makeCodingSnapshot(code) as any
          );
        } else {
          reportCardRepo.saveLmsSnapshot(
            code,
            makeCodingSnapshot(code) as any
          );
        }
        return { success: true };
      },
      syncTeachingFn: async (id, opts) => {
        if (id === "VT-C4K-SAME") teachingCallCountForUnchanged++;
        return TeachingReportCardSyncService.syncReportCardToTeaching(id, {
          ...opts,
          transport: transport2 as any,
        });
      },
    });

    assert.equal(batchMixed.success, true);
    assert.equal(batchMixed.totalClasses, 6);
    assert.equal(batchMixed.syncedCount, 2);
    assert.equal(batchMixed.skippedUnchangedCount, 1);
    assert.equal(batchMixed.skippedNoScoresCount, 2);
    assert.equal(batchMixed.needsAttentionCount, 1);
    assert.equal(teachingCallCountForUnchanged, 0);
    assert.equal(batchMixed.results[0].outcome, "SYNCED");
    assert.equal(batchMixed.results[1].outcome, "SKIPPED_UNCHANGED");
    assert.equal(batchMixed.results[2].outcome, "SKIPPED_NO_SCORES");
    assert.equal(batchMixed.results[3].outcome, "SKIPPED_NO_SCORES");
    assert.equal(batchMixed.results[4].outcome, "NEEDS_ATTENTION");
    assert.equal(batchMixed.results[5].outcome, "SYNCED");
    // Pre-CP1 Robotics & New Coding remain DRAFT (NOT FAILED!)
    assert.equal(reportCardRepo.findOne("VT-ROB-01")?.status, "DRAFT");
    assert.equal(reportCardRepo.findOne("VT-C4K-NEW1")?.status, "DRAFT");
    assert.equal(reportCardRepo.findOne("VT-C4K-PTI12")?.status, "VERIFIED");
    assert.equal(reportCardRepo.findOne("VT-C4K-PTI13")?.status, "VERIFIED");

    // Verify Robotics countSyncableReportCardScores equals 0 pre-CP1, > 0 with CP1
    const robPreComputed = computeClassReportCard(
      parseReportCardLmsSnapshot(
        reportCardRepo.findOne("VT-ROB-01")!.lmsSnapshotJson,
        "VT-ROB-01"
      )!
    );
    assert.equal(countSyncableReportCardScores(robPreComputed), 0);
    const robCpComputed = computeClassReportCard(
      makeRoboticsSnapshot("VT-ROB-02", { hasCp1: true }) as any
    );
    assert.equal(countSyncableReportCardScores(robCpComputed), 3);

    console.log("=== BS-03: Manual Overrides Preserved + Edit-After-Batch + Concurrent Mid-Scrape Guard ===");
    const savedPayloads: Record<string, any[]> = {};
    const transport3 = makeMockTransport({
      onSaveScores: (code, scores) => {
        savedPayloads[code] = scores;
      },
    });
    const ovCode = "VT-C4K-OV1";
    reportCardRepo.saveLmsSnapshot(
      ovCode,
      makeCodingSnapshot(ovCode, { theoryRaw: 60 }) as any
    );
    const ovRec0 = reportCardRepo.findOne(ovCode)!;
    const ovSave = reportCardRepo.saveManualOverrides({
      classId: ovCode,
      expectedVersion: ovRec0.draftVersion,
      updates: [
        {
          studentId: `${ovCode}_STU_01`,
          fieldKey: "btvn_1_theory",
          normScore: 4.5,
          rawScore: 90,
          maxScore: 100,
          note: "Giáo viên cộng điểm thưởng",
        },
      ],
    });
    assert.equal(ovSave.success, true);

    // Re-scrape brings updated practiceRaw=95 while manual theory override=90 must remain!
    const ovBatchRes = await syncSingleClassReportCardFlow(ovCode, {
      scrapeFn: async (code) => {
        reportCardRepo.saveLmsSnapshot(
          code,
          makeCodingSnapshot(code, { theoryRaw: 60, practiceRaw: 95 }) as any
        );
        return { success: true };
      },
      syncTeachingFn: async (id, opts) =>
        TeachingReportCardSyncService.syncReportCardToTeaching(id, {
          ...opts,
          transport: transport3 as any,
        }),
    });
    assert.equal(ovBatchRes.outcome, "SYNCED");
    const ovAfter = reportCardRepo.findOne(ovCode)!;
    assert.equal(ovAfter.status, "VERIFIED");
    const ovMap = parseManualOverridesMap(ovAfter.manualOverridesJson);
    assert.equal(ovMap[`${ovCode}_STU_01::btvn_1_theory`]?.rawScore, 90);
    const sentTheory = savedPayloads[ovCode]?.find(
      (s) => s.exercise_type === "btvn" && s.exercise_form === "theory"
    );
    assert.equal(sentTheory?.raw_score, 90);

    // Teacher edits AFTER batch -> status downgrades to WAITING_APPROVAL and can re-approve & sync
    const ovEditAfter = reportCardRepo.saveManualOverrides({
      classId: ovCode,
      expectedVersion: ovAfter.draftVersion,
      updates: [
        {
          studentId: `${ovCode}_STU_01`,
          fieldKey: "cp1_theory",
          normScore: 5,
          rawScore: 5,
          maxScore: 5,
          note: "Sửa tay sau batch",
        },
      ],
    });
    assert.equal(ovEditAfter.success, true);
    assert.equal(ovEditAfter.record.status, "WAITING_APPROVAL");
    reportCardRepo.approveReportCard(ovCode, ovEditAfter.record.draftVersion);
    const afterManualSync = await TeachingReportCardSyncService.syncReportCardToTeaching(
      ovCode,
      {
        classCode: ovCode,
        expectedVersion: reportCardRepo.findOne(ovCode)!.draftVersion,
        transport: transport3 as any,
      }
    );
    assert.equal(afterManualSync.success, true);
    assert.equal(reportCardRepo.findOne(ovCode)?.status, "VERIFIED");

    // Concurrent mid-scrape teacher edit guard
    const concurrentRes = await syncSingleClassReportCardFlow(ovCode, {
      scrapeFn: async (code) => {
        const cur = reportCardRepo.findOne(code)!;
        reportCardRepo.saveManualOverrides({
          classId: code,
          expectedVersion: cur.draftVersion,
          updates: [
            {
              studentId: `${code}_STU_01`,
              fieldKey: "cp1_practice",
              normScore: 4.8,
              rawScore: 4.8,
              maxScore: 5,
              note: "Sửa đúng lúc đang quét",
            },
          ],
        });
        return { success: true };
      },
      syncTeachingFn: async () => {
        throw new Error("Should NOT call Teaching sync on CONCURRENT_EDIT");
      },
    });
    assert.equal(concurrentRes.success, false);
    assert.equal(concurrentRes.outcome, "NEEDS_ATTENTION");
    assert.equal(concurrentRes.stage, "CONCURRENT_EDIT");

    console.log("=== BS-04: Regression Guard for Prior-Synced Class Returning Empty Snapshot ===");
    const regCode = "VT-C4K-REG1";
    reportCardRepo.saveLmsSnapshot(regCode, makeCodingSnapshot(regCode) as any);
    reportCardRepo.approveReportCard(regCode, reportCardRepo.findOne(regCode)!.draftVersion);
    const regInitSync = await TeachingReportCardSyncService.syncReportCardToTeaching(
      regCode,
      {
        classCode: regCode,
        expectedVersion: reportCardRepo.findOne(regCode)!.draftVersion,
        transport: makeMockTransport() as any,
      }
    );
    assert.equal(regInitSync.success, true);

    const regEmptyRes = await syncSingleClassReportCardFlow(regCode, {
      scrapeFn: async (code) => {
        reportCardRepo.saveLmsSnapshot(
          code,
          makeCodingSnapshot(code, { emptyStudents: true }) as any
        );
        return { success: true };
      },
    });
    assert.equal(regEmptyRes.success, false);
    assert.equal(regEmptyRes.outcome, "NEEDS_ATTENTION");
    assert.equal(regEmptyRes.stage, "CHECK_SCORES");

    console.log("=== BS-05: Locks (409) & Zero Deadlock With Real SequentialTaskQueue ===");
    let releaseSlowScrape!: () => void;
    const slowScrapePromise = new Promise<void>((r) => {
      releaseSlowScrape = r;
    });
    let nestedQueueSyncRan = false;

    const firstRealQueueFlow = syncSingleClassReportCardFlow("VT-C4K-QUEUE1", {
      scrapeFn: async (code) =>
        taskQueue.enqueue({
          id: `mock_scrape_${code}`,
          jobType: "SCRAPE_SCORES",
          classId: code,
          description: `Mock scrape ${code}`,
          execute: async () => {
            await slowScrapePromise;
            reportCardRepo.saveLmsSnapshot(
              code,
              makeCodingSnapshot(code) as any
            );
            return { success: true };
          },
        }),
      syncTeachingFn: async (id, opts) => {
        nestedQueueSyncRan = true;
        return TeachingReportCardSyncService.syncReportCardToTeaching(id, {
          ...opts,
          transport: makeMockTransport() as any,
        });
      },
    });

    // Duplicate same class while first is in flight -> 409 immediately
    const dupLockRes = await syncSingleClassReportCardFlow("VT-C4K-QUEUE1");
    assert.equal(dupLockRes.statusCode, 409);
    assert.equal(dupLockRes.conflict, true);

    releaseSlowScrape();
    const realQueueOutcome = await firstRealQueueFlow;
    assert.equal(realQueueOutcome.outcome, "SYNCED");
    assert.equal(nestedQueueSyncRan, true);

    console.log("=== BS-06: API Security & Input Validation ===");
    const extGet = await batchSyncGET(
      new Request("http://127.0.0.1:3000/api/report-card/batch-sync", {
        headers: { host: "evil.example.com" },
      }) as any
    );
    assert.equal(extGet.status, 403);

    const extPost = await batchSyncPOST(
      new Request("http://127.0.0.1:3000/api/report-card/batch-sync", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "https://evil.example.com",
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "discover_classes" }),
      }) as any
    );
    assert.equal(extPost.status, 403);

    const badJsonPost = await batchSyncPOST(
      new Request("http://127.0.0.1:3000/api/report-card/batch-sync", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          "content-type": "application/json",
        },
        body: "{bad json",
      }) as any
    );
    assert.equal(badJsonPost.status, 400);

    const synthSinglePost = await batchSyncPOST(
      new Request("http://127.0.0.1:3000/api/report-card/batch-sync", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "sync_single_class",
          classCode: "TEST_SYNTH_99",
        }),
      }) as any
    );
    assert.equal(synthSinglePost.status, 400);

    console.log("=== BS-07: Client Boundary Security & VM Harness Compatibility ===");
    const panelSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/report-card-batch-sync-panel.tsx"),
      "utf8"
    );
    assert.equal(panelSrc.startsWith('"use client";'), true);
    for (const badToken of [
      "TEACHING_PASSWORD",
      "LMS_PASSWORD",
      "GEMINI_API_KEY",
      "@/lib/config",
      "@/lib/db/",
      "@/lib/playwright/",
      "better-sqlite3",
    ]) {
      assert.equal(
        panelSrc.includes(badToken),
        false,
        `Client component must NEVER reference ${badToken}`
      );
    }

    const hwPageSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/homework-grader/page.tsx"),
      "utf8"
    );
    const helperPrefix = hwPageSrc.slice(
      0,
      hwPageSrc.indexOf("export default function")
    );
    const bareCtx = vm.createContext({ console });
    vm.runInContext(
      stripTypeScriptTypes(
        helperPrefix
          .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
          .replace(/\bexport\s+/g, "")
      ) + "\nglobalThis.out = { sanitizeTsvCell, htmlToPlainText };",
      bareCtx
    );
    assert.equal(typeof bareCtx.out.sanitizeTsvCell, "function");
    assert.equal(typeof bareCtx.out.htmlToPlainText, "function");

    console.log("=== BS-08: Headless Chromium Real Component E2E (Hero Button, Live Progress, Stop & Retry) ===");
    const { createRequire } = await import("node:module");
    const req = createRequire(import.meta.url);
    const { buildSync } = req("esbuild");

    const entryVirtual = path.join(tempDir, "batch_e2e_entry.tsx");
    const bundleOut = path.join(tempDir, "batch_e2e_bundle.js");
    const panelAbs = path
      .resolve(process.cwd(), "src/components/report-card-batch-sync-panel.tsx")
      .replace(/\\/g, "/");

    fs.writeFileSync(
      entryVirtual,
      `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ReportCardBatchSyncPanel } from "${panelAbs}";

function HarnessApp() {
  const [classCode, setClassCode] = useState("VT-C4K-PTI12");
  const [triggerSeq, setTriggerSeq] = useState(0);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [progressLabel, setProgressLabel] = useState("");
  const [selectedLogs, setSelectedLogs] = useState<string[]>([]);

  return (
    <div style={{ padding: 16, fontFamily: "sans-serif" }}>
      <div className="mindx-hero" style={{ display: "flex", gap: 12, alignItems: "center", padding: 12, background: "#1d3a8a", color: "#fff" }}>
        <div data-testid="selected-class">{classCode}</div>
        <button
          type="button"
          data-testid="batch-sync-running-classes-btn"
          disabled={isBatchRunning}
          onClick={() => setTriggerSeq((n) => n + 1)}
        >
          {isBatchRunning ? progressLabel || "Đang đồng bộ..." : "Quét & Đồng bộ tất cả lớp đang dạy"}
        </button>
      </div>
      <ReportCardBatchSyncPanel
        triggerSeq={triggerSeq}
        activeClassCode={classCode}
        onRunningStateChange={(running, label) => {
          setIsBatchRunning(running);
          setProgressLabel(label);
        }}
        onClassesDiscovered={() => {}}
        onClassProcessed={() => {}}
        onSelectClass={(nextCode) => {
          setClassCode(nextCode);
          setSelectedLogs((prev) => [...prev, nextCode]);
        }}
      />
      <div data-testid="selected-history">{selectedLogs.join(",")}</div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<HarnessApp />);
`,
      "utf8"
    );

    buildSync({
      entryPoints: [entryVirtual],
      bundle: true,
      outfile: bundleOut,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      nodePaths: [path.resolve(process.cwd(), "node_modules")],
    });
    const bundledJs = fs.readFileSync(bundleOut, "utf8");

    let scenarioMode: "stop_graceful" | "retry_recover" = "stop_graceful";
    let failAttemptCount = 0;
    const syncCalls: string[] = [];

    const e2eServer = http.createServer((req, res) => {
      const url = String(req.url || "/");
      if (url === "/bundle.js") {
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
        res.end(bundledJs);
        return;
      }
      if (url === "/api/report-card/batch-sync" && req.method === "POST") {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          const body = JSON.parse(raw || "{}");
          if (body.action === "discover_classes") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: true,
                statusCode: 200,
                classes: [
                  { classCode: "VT-C4K-PTI12", courseName: "App Producer", status: "Running" },
                  { classCode: "VT-C4K-GA38", courseName: "GameMaker", status: "Running" },
                  { classCode: "VT-JSB16", courseName: "Web Basic", status: "Running" },
                ],
              })
            );
            return;
          }
          if (body.action === "sync_single_class") {
            const code = String(body.classCode);
            syncCalls.push(code);
            const delayMs = scenarioMode === "stop_graceful" ? 280 : 30;
            setTimeout(() => {
              res.writeHead(200, { "Content-Type": "application/json" });
              if (code === "VT-C4K-GA38" && scenarioMode === "retry_recover" && failAttemptCount === 0) {
                failAttemptCount++;
                res.end(
                  JSON.stringify({
                    success: false,
                    statusCode: 200,
                    classCode: code,
                    outcome: "NEEDS_ATTENTION",
                    stage: "SYNC_TEACHING",
                    syncedScoreCount: 0,
                    declaredExerciseCount: 0,
                    error: "Lệch tên học sinh trên Teaching",
                  })
                );
                return;
              }
              res.end(
                JSON.stringify({
                  success: true,
                  statusCode: 200,
                  classCode: code,
                  outcome: code === "VT-JSB16" ? "SKIPPED_UNCHANGED" : "SYNCED",
                  stage: "SYNC_TEACHING",
                  syncedScoreCount: code === "VT-JSB16" ? 0 : 12,
                  declaredExerciseCount: 0,
                  message:
                    code === "VT-JSB16"
                      ? "Điểm không thay đổi."
                      : "Đã đồng bộ 12 đầu điểm lên Teaching.",
                })
              );
            }, delayMs);
            return;
          }
          res.writeHead(400).end("{}");
        });
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><html><body><div id="root"></div><script src="/bundle.js"></script></body></html>`
      );
    });

    await new Promise<void>((resolve) =>
      e2eServer.listen(0, "127.0.0.1", () => resolve())
    );
    const srvAddr = e2eServer.address();
    assert.ok(srvAddr && typeof srvAddr === "object");
    const e2eUrl = `http://127.0.0.1:${srvAddr.port}`;

    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(e2eUrl, { waitUntil: "domcontentloaded" });

      // 1. Trigger batch -> click graceful Stop while class 1 is in flight
      scenarioMode = "stop_graceful";
      await page.click('[data-testid="batch-sync-running-classes-btn"]');
      await page.waitForSelector('[data-testid="batch-stop-graceful-btn"]', {
        timeout: 8000,
      });
      await page.click('[data-testid="batch-stop-graceful-btn"]');

      // Wait until button becomes enabled again (finished after 1st class cleanly)
      await page.waitForSelector(
        '[data-testid="batch-sync-running-classes-btn"]:not([disabled])',
        { timeout: 10000 }
      );
      assert.deepEqual(syncCalls, ["VT-C4K-PTI12"]);
      assert.match(
        (await page.textContent('[data-testid="batch-summary-synced"]')) || "",
        /1 lớp/
      );
      assert.match(
        (await page.textContent('[data-testid="batch-row-VT-C4K-GA38"]')) || "",
        /Đã dừng/
      );

      // 2. Full batch run with 1 failed class -> Retry Attention -> Click class row
      syncCalls.length = 0;
      scenarioMode = "retry_recover";
      failAttemptCount = 0;
      await page.click('[data-testid="batch-sync-running-classes-btn"]');
      await page.waitForSelector('[data-testid="batch-retry-attention-btn"]', {
        timeout: 10000,
      });
      assert.match(
        (await page.textContent('[data-testid="batch-summary-synced"]')) || "",
        /1 lớp/
      );
      assert.match(
        (await page.textContent('[data-testid="batch-summary-skipped"]')) || "",
        /1 lớp/
      );
      assert.match(
        (await page.textContent('[data-testid="batch-summary-attention"]')) || "",
        /1 lớp/
      );

      // Retry only VT-C4K-GA38
      await page.click('[data-testid="batch-retry-attention-btn"]');
      await page.waitForSelector(
        '[data-testid="batch-sync-running-classes-btn"]:not([disabled])',
        { timeout: 10000 }
      );
      assert.deepEqual(syncCalls, [
        "VT-C4K-PTI12",
        "VT-C4K-GA38",
        "VT-JSB16",
        "VT-C4K-GA38",
      ]);
      assert.match(
        (await page.textContent('[data-testid="batch-summary-synced"]')) || "",
        /2 lớp/
      );
      assert.match(
        (await page.textContent('[data-testid="batch-summary-attention"]')) || "",
        /0 lớp/
      );

      // Clicking a class row selects it for editing & contains a direct Teaching link
      const teachingHref = await page.getAttribute(
        '[data-testid="batch-row-VT-C4K-GA38"] a',
        "href"
      );
      assert.ok(
        teachingHref &&
          teachingHref.includes(
            "teachingmindx.top/diem-tong-ket.php?from=hocsinh&class_code=VT-C4K-GA38"
          )
      );
      await page.click('[data-testid="batch-row-VT-C4K-GA38"]');
      assert.equal(
        await page.textContent('[data-testid="selected-class"]'),
        "VT-C4K-GA38"
      );
    } finally {
      if (browser) await browser.close().catch(() => {});
      await new Promise<void>((resolve) => e2eServer.close(() => resolve()));
    }

    console.log("=== BS-09: Partial Teaching Roster Sync (VT-JSB16 Missing / Inactive Student) & Auto Backfill ===");
    const jsb16Names = [
      "Nguyễn Hữu Phước",
      "Phạm Bùi Quang Minh",
      "Trần Gia Vỹ",
      "Nguyễn Hoàng Bách",
      "Lê Xuân Thế Anh",
      "Nguyễn Lê Minh",
      "Thái Xuân Nguyên",
      "Hoàng Sỹ Tùng",
      "Nguyễn Trần Gia Kiệt",
      "Dương Đăng Khôi",
    ];
    const makeJsb16Snapshot = () => ({
      classId: "VT-JSB16",
      classCode: "VT-JSB16",
      isRobotics: false,
      scrapedAt: "2026-11-13T18:05:00.000Z",
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
      ],
      students: jsb16Names.map((fullName, idx) => ({
        studentId: `STU_VT-JSB16_${idx + 1}`,
        fullName,
        isActive: true,
        btvnScores: {
          1: {
            sessionNumber: 1,
            theoryRaw: 90,
            theoryMax: 100,
            practiceRaw: 85,
            practiceMax: 100,
          },
        },
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
      })),
    });

    const createPartialTransport = (
      remoteStudents: Array<{
        id: number;
        student_name: string;
        class_code: string;
        status: string;
      }>
    ) => {
      const savedRows: any[] = [];
      const transport = {
        async getStudents() {
          return remoteStudents;
        },
        async getExercises() {
          return [
            { id: 1, class_code: "VT-JSB16", session_number: 1, exercise_type: "btvn", exercise_form: "theory", max_score: 100 },
            { id: 2, class_code: "VT-JSB16", session_number: 1, exercise_type: "btvn", exercise_form: "practice", max_score: 100 },
            { id: 3, class_code: "VT-JSB16", session_number: 5, exercise_type: "cp1", exercise_form: "theory", max_score: 5 },
            { id: 4, class_code: "VT-JSB16", session_number: 5, exercise_type: "cp1", exercise_form: "practice", max_score: 5 },
            { id: 5, class_code: "VT-JSB16", session_number: 5, exercise_type: "cp1", exercise_form: "nang_luc", max_score: 5 },
            { id: 6, class_code: "VT-JSB16", session_number: 9, exercise_type: "cp2", exercise_form: "theory", max_score: 5 },
            { id: 7, class_code: "VT-JSB16", session_number: 9, exercise_type: "cp2", exercise_form: "practice", max_score: 5 },
            { id: 8, class_code: "VT-JSB16", session_number: 9, exercise_type: "cp2", exercise_form: "nang_luc", max_score: 5 },
            { id: 9, class_code: "VT-JSB16", session_number: 14, exercise_type: "final", exercise_form: "practice", max_score: 5 },
            { id: 10, class_code: "VT-JSB16", session_number: 14, exercise_type: "final", exercise_form: "nang_luc", max_score: 5 },
          ];
        },
        async addMultiExercise() {
          return { success: true };
        },
        async saveScores(scores: any[]) {
          savedRows.length = 0;
          for (const s of scores) {
            savedRows.push({
              ...s,
              normalized_score: Math.round(((s.raw_score / s.max_score) * 5) * 100) / 100,
            });
          }
          return { success: true };
        },
        async getScores() {
          return savedRows;
        },
      };
      return { transport, savedRows };
    };

    // 9A. Missing "Dương Đăng Khôi" on Teaching (9/10 match) -> VERIFIED + warning + persisted skippedStudents
    const jsb16Snap = makeJsb16Snapshot();
    reportCardRepo.saveLmsSnapshot("VT-JSB16", jsb16Snap);
    const jsbRec0 = reportCardRepo.findOne("VT-JSB16")!;
    const jsbApp0 = reportCardRepo.approveReportCard("VT-JSB16", jsbRec0.draftVersion);
    assert.equal(jsbApp0.success, true);

    const nineRemoteStudents = jsb16Names
      .filter((name) => name !== "Dương Đăng Khôi")
      .map((name, idx) => ({
        id: 1690 + idx,
        student_name: name,
        class_code: "VT-JSB16",
        status: "đang học",
      }));
    const tMissing1 = createPartialTransport(nineRemoteStudents);
    const sync9of10 = await TeachingReportCardSyncService.syncReportCardToTeaching(
      "VT-JSB16",
      {
        expectedVersion: jsbApp0.record.draftVersion,
        transport: tMissing1.transport,
      }
    );
    assert.equal(sync9of10.success, true, `BS-09A failed: ${sync9of10.error}`);
    assert.equal(sync9of10.record?.status, "VERIFIED");
    assert.equal(sync9of10.record?.teachingSyncStatus, "VERIFIED");
    assert.equal(sync9of10.matchedStudentCount, 9);
    assert.equal(sync9of10.skippedStudentCount, 1);
    assert.equal(sync9of10.skippedStudents?.[0]?.localFullName, "Dương Đăng Khôi");
    assert.equal(sync9of10.skippedStudents?.[0]?.reason, "NOT_FOUND_ON_TEACHING");
    assert.match(sync9of10.warning || "", /Dương Đăng Khôi/);
    assert.equal(tMissing1.savedRows.length, 18); // 9 students * (theory + practice)
    const verifiedMeta = JSON.parse(sync9of10.record?.teachingVerifiedSnapshotJson || "{}");
    assert.equal(verifiedMeta.skippedStudentCount, 1);
    assert.equal(verifiedMeta.skippedStudents?.[0]?.localFullName, "Dương Đăng Khôi");

    // 9B. INACTIVE_ON_TEACHING student is skipped cleanly while matched students sync
    const inactiveRemoteStudents = jsb16Names.map((name, idx) => ({
      id: 2690 + idx,
      student_name: name,
      class_code: "VT-JSB16",
      status: name === "Dương Đăng Khôi" ? "nghi_hoc" : "đang học",
    }));
    const tInactive = createPartialTransport(inactiveRemoteStudents);
    const syncWithInactive = await TeachingReportCardSyncService.syncReportCardToTeaching(
      "VT-JSB16",
      {
        expectedVersion: sync9of10.record!.draftVersion,
        transport: tInactive.transport,
      }
    );
    assert.equal(syncWithInactive.success, true);
    assert.equal(syncWithInactive.matchedStudentCount, 9);
    assert.equal(syncWithInactive.skippedStudentCount, 1);
    assert.equal(syncWithInactive.skippedStudents?.[0]?.reason, "INACTIVE_ON_TEACHING");
    assert.equal(syncWithInactive.skippedStudents?.[0]?.localFullName, "Dương Đăng Khôi");

    // 9C. Ambiguous duplicate active names & 0-match must STILL fail loudly even with allowPartialStudentMatch=true
    const dupRemoteStudents = [
      ...nineRemoteStudents,
      { id: 9991, student_name: "Hoàng Sỹ Tùng", class_code: "VT-JSB16", status: "đang học" },
    ];
    const tDup = createPartialTransport(dupRemoteStudents);
    const syncDupRes = await TeachingReportCardSyncService.syncReportCardToTeaching(
      "VT-JSB16",
      {
        expectedVersion: syncWithInactive.record!.draftVersion,
        transport: tDup.transport,
      }
    );
    assert.equal(syncDupRes.success, false);
    assert.match(syncDupRes.error || "", /Student Match Error.*trùng tên/i);

    // Re-approve after FAILED so 0-match check runs cleanly
    const jsbReApp = reportCardRepo.approveReportCard(
      "VT-JSB16",
      reportCardRepo.findOne("VT-JSB16")!.draftVersion
    );
    assert.equal(jsbReApp.success, true);
    const tZeroMatch = createPartialTransport([
      { id: 8881, student_name: "Người Hoàn Toàn Khác", class_code: "VT-JSB16", status: "đang học" },
    ]);
    const syncZeroRes = await TeachingReportCardSyncService.syncReportCardToTeaching(
      "VT-JSB16",
      {
        expectedVersion: jsbReApp.record.draftVersion,
        transport: tZeroMatch.transport,
      }
    );
    assert.equal(syncZeroRes.success, false);
    assert.match(syncZeroRes.error || "", /Student Match Error/);

    // 9D. Re-seed VT-JSB16 as VERIFIED with skippedStudentCount=1, then verify batch re-sync auto-backfills all 10 when Khôi appears on Teaching, and only afterwards fast-skips
    const jsbReApp2 = reportCardRepo.approveReportCard(
      "VT-JSB16",
      reportCardRepo.findOne("VT-JSB16")!.draftVersion
    );
    assert.equal(jsbReApp2.success, true);
    const tPartialSeed = createPartialTransport(nineRemoteStudents);
    const seededPartial = await TeachingReportCardSyncService.syncReportCardToTeaching(
      "VT-JSB16",
      {
        expectedVersion: jsbReApp2.record.draftVersion,
        transport: tPartialSeed.transport,
      }
    );
    assert.equal(seededPartial.success, true);
    assert.equal(seededPartial.skippedStudentCount, 1);

    const allTenRemoteStudents = jsb16Names.map((name, idx) => ({
      id: 3690 + idx,
      student_name: name,
      class_code: "VT-JSB16",
      status: "đang học",
    }));
    const tAllTen = createPartialTransport(allTenRemoteStudents);
    let batchSyncCalls = 0;
    const backfillRes = await syncSingleClassReportCardFlow("VT-JSB16", {
      allowSyntheticForTest: true,
      scrapeFn: async () => ({ success: true }),
      syncTeachingFn: async (id, opts) => {
        batchSyncCalls++;
        return await TeachingReportCardSyncService.syncReportCardToTeaching(id, {
          ...opts,
          transport: tAllTen.transport,
        });
      },
    });
    assert.equal(batchSyncCalls, 1, "Class with prior skippedStudentCount > 0 must NOT SKIPPED_UNCHANGED");
    assert.equal(backfillRes.outcome, "SYNCED");
    assert.equal(backfillRes.matchedStudentCount, 10);
    assert.equal(backfillRes.skippedStudentCount ?? 0, 0);
    assert.equal(tAllTen.savedRows.length, 20);

    // Subsequent batch sync now fast-skips cleanly because all 10 students are verified
    let secondCallCount = 0;
    const fastSkipAfterBackfill = await syncSingleClassReportCardFlow("VT-JSB16", {
      allowSyntheticForTest: true,
      scrapeFn: async () => ({ success: true }),
      syncTeachingFn: async () => {
        secondCallCount++;
        return { success: true, syncedScoreCount: 0, declaredExerciseCount: 0 };
      },
    });
    assert.equal(fastSkipAfterBackfill.outcome, "SKIPPED_UNCHANGED");
    assert.equal(secondCallCount, 0);

    console.log("ALL BS-01..BS-09 CHECKS PASSED.");
  } finally {
    closeDb();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
