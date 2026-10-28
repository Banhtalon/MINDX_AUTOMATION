import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import esbuild from "esbuild";
import { chromium } from "playwright";
import { NextRequest } from "next/server";

// F13: Set isolated SQLite path & isolated running_classes.json path BEFORE any DB/config calls
// so data/mindx_bot.db and data/running_classes.json are never opened for writing or modified
const ISOLATED_DB_REL = "data/tmp-test-teaching-v320.db";
const ISOLATED_RUNNING_CLASSES_REL = "data/tmp-test-running-classes-v320.json";
process.env.MINDX_DB_PATH = ISOLATED_DB_REL;
process.env.MINDX_RUNNING_CLASSES_PATH = ISOLATED_RUNNING_CLASSES_REL;

import { assertPathAllowed } from "../src/lib/security/path-allowlist";
import {
  buildDefaultTeachingProjectName,
  closeDb,
  computeTeachingProjectHash,
  getDb,
  isValidIsoDateYmd,
  normalizeDateToIsoYmd,
  teachingProjectRepo,
  validateTeachingProjectForApproval,
  type TeachingProjectTaskItem,
  type TeachingStudentItem,
} from "../src/lib/db/sqlite";
import {
  ClassSyncer,
  doesLmsClassSearchPayloadMatchCode,
  isLmsClassSearchRequestForCode,
  parseClassDateToEndOfDayMs,
  resolveClassDateRangeInfo,
} from "../src/lib/playwright/sync-class";
import {
  detectTeachingCourseTrack,
  generateTeachingProjectTasksWithAI,
  getStandardFiveTasksForClass,
  mergeExistingTeachingTasksWithStandardFive,
  sanitizeTeachingAiHint,
} from "../src/lib/gemini/teaching-project-generator";
import {
  TeachingProjectService,
  parseRemoteTeachingProgressPayload,
  type RemoteTeachingProject,
  type RemoteTeachingStudent,
  type RemoteTeachingTask,
  type TeachingHttpTransport,
} from "../src/lib/playwright/teaching-project-service";
import { POST as postTeachingProjectRoute } from "../src/app/api/teaching-projects/route";
import { POST as postTeachingSyncRoute } from "../src/app/api/teaching-projects/sync/route";
import { POST as postTeachingGenerateAiRoute } from "../src/app/api/teaching-projects/generate-ai/route";
import { POST as postFetchLmsDatesRoute } from "../src/app/api/teaching-projects/fetch-lms-dates/route";
import { POST as postTeachingProgressRoute } from "../src/app/api/teaching-projects/progress/route";

function readAllowedUtf8(filePath: string): string {
  const safePath = assertPathAllowed(filePath);
  return fs.readFileSync(safePath, "utf8");
}

function getFileSha256IfExists(filePath: string): string | null {
  const safePath = assertPathAllowed(filePath);
  if (!fs.existsSync(safePath)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(safePath)).digest("hex");
}

function cleanupIsolatedDbFiles(absDbPath: string): void {
  closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const candidate = `${absDbPath}${suffix}`;
    if (fs.existsSync(candidate)) {
      fs.rmSync(candidate, { force: true });
    }
  }
}

class MockTeachingTransport implements TeachingHttpTransport {
  public projects = new Map<string, RemoteTeachingProject>();
  public students = new Map<string, RemoteTeachingStudent[]>();
  public tasks = new Map<number, RemoteTeachingTask[]>();
  public progress = new Map<number, Record<string, number>>();
  public nextProjectId = 500;
  public nextTaskId = 2000;
  public corruptReadAfterWriteDeadline = false;
  public corruptReadAfterWriteField:
    | null
    | "project_name"
    | "start_date"
    | "end_date"
    | "description" = null;
  public corruptProgressReadAfterWrite = false;
  public rawProgressOverride: Record<string, unknown> | null = null;
  public throwOnGetStudents = false;
  public updateProgressCallCount = 0;

  async getProject(classCode: string): Promise<RemoteTeachingProject | null> {
    const code = String(classCode || "").trim().toUpperCase();
    const proj = this.projects.get(code) ?? null;
    if (!proj) return null;
    if (this.corruptReadAfterWriteField === "project_name") {
      return { ...proj, project_name: "CORRUPTED_PROJECT_NAME" };
    }
    if (this.corruptReadAfterWriteField === "start_date") {
      return { ...proj, start_date: "2099-01-01" };
    }
    if (this.corruptReadAfterWriteField === "end_date") {
      return { ...proj, end_date: "2099-12-31" };
    }
    if (this.corruptReadAfterWriteField === "description") {
      return { ...proj, description: "CORRUPTED_DESCRIPTION" };
    }
    return { ...proj };
  }

  async getStudents(classCode: string): Promise<RemoteTeachingStudent[]> {
    if (this.throwOnGetStudents) {
      throw new Error("Simulated Teaching network failure");
    }
    const code = String(classCode || "").trim().toUpperCase();
    return this.students.get(code) ?? [];
  }

  async getTasks(projectId: number): Promise<RemoteTeachingTask[]> {
    const list = this.tasks.get(Number(projectId)) ?? [];
    if (this.corruptReadAfterWriteDeadline && list.length > 0) {
      return list.map((item, idx) =>
        idx === 0 ? { ...item, deadline: "0000-00-00" } : item
      );
    }
    return list;
  }

  async getTaskProgress(projectId: number): Promise<Record<string, number>> {
    if (this.corruptProgressReadAfterWrite) {
      return {};
    }
    if (this.rawProgressOverride !== null) {
      return parseRemoteTeachingProgressPayload(this.rawProgressOverride);
    }
    return { ...(this.progress.get(Number(projectId)) ?? {}) };
  }

  async createProject(payload: {
    classCode: string;
    projectName: string;
    startDate: string;
    endDate: string;
    description: string;
  }): Promise<{ success: boolean; message?: string; id?: number }> {
    const code = payload.classCode.trim().toUpperCase();
    const created: RemoteTeachingProject = {
      id: this.nextProjectId++,
      class_code: code,
      project_name: payload.projectName,
      start_date: payload.startDate,
      end_date: payload.endDate,
      description: payload.description,
    };
    this.projects.set(code, created);
    if (!this.tasks.has(created.id)) {
      this.tasks.set(created.id, []);
    }
    return { success: true, id: created.id };
  }

  async saveTask(payload: {
    projectId: number;
    taskId?: number | null;
    taskName: string;
    weightPercent: number;
    deadline: string;
    description: string;
    assignedStudentIds: number[];
  }): Promise<{ success: boolean; message?: string; id?: number }> {
    const pid = Number(payload.projectId);
    const list = [...(this.tasks.get(pid) ?? [])];
    if (payload.taskId && Number(payload.taskId) > 0) {
      const tid = Number(payload.taskId);
      const idx = list.findIndex((t) => Number(t.id) === tid);
      const updated: RemoteTeachingTask = {
        id: tid,
        project_id: pid,
        task_name: payload.taskName,
        description: payload.description,
        weight_percent: payload.weightPercent,
        deadline: payload.deadline,
        assigned_students: JSON.stringify(payload.assignedStudentIds),
        status: "doing",
      };
      if (idx >= 0) list[idx] = updated;
      else list.push(updated);
      this.tasks.set(pid, list);
      return { success: true, id: tid };
    } else {
      const tid = this.nextTaskId++;
      list.push({
        id: tid,
        project_id: pid,
        task_name: payload.taskName,
        description: payload.description,
        weight_percent: payload.weightPercent,
        deadline: payload.deadline,
        assigned_students: JSON.stringify(payload.assignedStudentIds),
        status: "doing",
      });
      this.tasks.set(pid, list);
      return { success: true, id: tid };
    }
  }

  async deleteTask(taskId: number): Promise<{ success: boolean; message?: string }> {
    const tid = Number(taskId);
    for (const [pid, list] of this.tasks.entries()) {
      this.tasks.set(
        pid,
        list.filter((t) => Number(t.id) !== tid)
      );
    }
    return { success: true };
  }

  async updateTaskProgress(payload: {
    taskId: number;
    studentId: number;
    progressPercent: number;
  }): Promise<{ success: boolean; message?: string }> {
    this.updateProgressCallCount += 1;
    const tid = Number(payload.taskId);
    const sid = Number(payload.studentId);
    const pct = Number(payload.progressPercent);
    for (const [pid, list] of this.tasks.entries()) {
      if (list.some((t) => Number(t.id) === tid)) {
        const curr = { ...(this.progress.get(pid) ?? {}) };
        curr[`${tid}_${sid}`] = pct;
        this.progress.set(pid, curr);
      }
    }
    return { success: true };
  }
}

async function runTests() {
  console.log("=== [v3.2.0] STARTING ISOLATED TEACHING FINAL PROJECT TEST SUITE ===");
  const root = process.cwd();
  const absIsolatedDb = assertPathAllowed(path.join(root, ISOLATED_DB_REL));
  const absIsolatedRunningClasses = assertPathAllowed(path.join(root, ISOLATED_RUNNING_CLASSES_REL));
  const absProdDb = assertPathAllowed(path.join(root, "data/mindx_bot.db"));
  const absRunningClasses = assertPathAllowed(path.join(root, "data/running_classes.json"));

  // Snapshot production DB & running_classes.json SHA-256 before tests (F13)
  const prodDbHashBefore = getFileSha256IfExists(absProdDb);
  const runningClassesHashBefore = getFileSha256IfExists(absRunningClasses);
  if (fs.existsSync(absRunningClasses)) {
    fs.writeFileSync(absIsolatedRunningClasses, readAllowedUtf8(absRunningClasses), "utf8");
  }
  cleanupIsolatedDbFiles(absIsolatedDb);

  const db = getDb();

  try {
    // Seed synthetic session 11 for VT-C4K-GA38 in isolated DB
    db.prepare(
      `INSERT INTO classes_sessions (classId, className, sessionId, sessionNumber, topic, date)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("VT-C4K-GA38", "VT-C4K-GA38", "VT-C4K-GA38_SESS_11", 11, "Buổi 11", "25/10/2026");

    // Seed synthetic students in isolated SQLite students table for F06 roster PII check (including overlapping given name "Khôi")
    db.prepare(
      `INSERT INTO students (studentId, classId, fullName, isActive)
       VALUES (?, ?, ?, 1)`
    ).run("STU_GA38_01", "VT-C4K-GA38", "Nguyễn Minh Khôi");
    db.prepare(
      `INSERT INTO students (studentId, classId, fullName, isActive)
       VALUES (?, ?, ?, 1)`
    ).run("STU_GA38_02", "VT-C4K-GA38", "Trần Gia Khôi");
    db.prepare(
      `INSERT INTO students (studentId, classId, fullName, isActive)
       VALUES (?, ?, ?, 1)`
    ).run("STU_GA38_03", "VT-C4K-GA38", "Lê Hoàng Bách");

    // -------------------------------------------------------------------------
    // TP-01: Date Resolution, Strict YMD/DMY Parsing (F10), LMS Network Guard (F11) & Naming
    // -------------------------------------------------------------------------
    console.log("-> Running TP-01: Date resolution, YMD/DMY parsing (F10) & LMS network guard (F11)...");
    assert.equal(buildDefaultTeachingProjectName("VT-C4K-GA38", false), "SPCK - GA38");
    assert.equal(buildDefaultTeachingProjectName("VT-C4K-GA38", true), "SPCK - VT-C4K-GA38");

    assert.equal(normalizeDateToIsoYmd("16/08/2026"), "2026-08-16");
    assert.equal(normalizeDateToIsoYmd("2026-11-15"), "2026-11-15");
    assert.equal(normalizeDateToIsoYmd("0000-00-00"), "");
    assert.equal(normalizeDateToIsoYmd("2026-02-31"), "");
    assert.equal(normalizeDateToIsoYmd("31/02/2026"), "");
    assert.equal(isValidIsoDateYmd("2026-11-15"), true);
    assert.equal(isValidIsoDateYmd("0000-00-00"), false);

    // F10: parseClassDateToEndOfDayMs must parse YYYY-MM-DD as 2026-10-28, never 20/10/2026
    const oct28Ms = parseClassDateToEndOfDayMs("2026-10-28");
    assert.notEqual(oct28Ms, null, "2026-10-28 must parse to valid timestamp");
    const oct28Date = new Date(oct28Ms!);
    assert.equal(oct28Date.getFullYear(), 2026);
    assert.equal(oct28Date.getMonth(), 9);
    assert.equal(oct28Date.getDate(), 28);
    assert.equal(parseClassDateToEndOfDayMs("31/02/2026"), null, "31/02/2026 must be rejected");
    assert.equal(parseClassDateToEndOfDayMs("2026-02-31"), null, "2026-02-31 must be rejected");

    const rangeInfo = resolveClassDateRangeInfo("VT-C4K-GA38");
    assert.equal(rangeInfo.startDateIso, "2026-08-16");
    assert.equal(rangeInfo.endDateIso, "2026-11-15");

    // F11 unit checks on request/response filters:
    assert.equal(
      isLmsClassSearchRequestForCode(
        "https://lms-api.mindx.edu.vn/graphql",
        "POST",
        JSON.stringify({ operationName: "GetStudents", variables: { classCode: "SYNTH-LMS-F11" } }),
        "SYNTH-LMS-F11"
      ),
      false,
      "F11: GetStudents must be rejected as a class search request"
    );
    assert.equal(
      isLmsClassSearchRequestForCode(
        "https://lms-api.mindx.edu.vn/graphql",
        "POST",
        JSON.stringify({ operationName: "GetClasses", variables: { search: "SYNTH-LMS-F11-OTHER" } }),
        "SYNTH-LMS-F11"
      ),
      false,
      "F11: Prefix-similar SYNTH-LMS-F11-OTHER must not match SYNTH-LMS-F11"
    );
    assert.equal(
      doesLmsClassSearchPayloadMatchCode(
        { data: { classes: [{ code: "SYNTH-LMS-F11-OTHER" }] } },
        "SYNTH-LMS-F11"
      ),
      false,
      "F11: Response payload with only SYNTH-LMS-F11-OTHER must not match SYNTH-LMS-F11"
    );
    assert.equal(
      doesLmsClassSearchPayloadMatchCode(null, "SYNTH-LMS-F11"),
      false,
      "F11: null payload must be rejected"
    );
    assert.equal(
      doesLmsClassSearchPayloadMatchCode({}, "SYNTH-LMS-F11"),
      false,
      "F11: empty object {} payload must be rejected"
    );
    assert.equal(
      doesLmsClassSearchPayloadMatchCode({ success: false }, "SYNTH-LMS-F11"),
      false,
      "F11: { success: false } payload must be rejected"
    );
    assert.equal(
      doesLmsClassSearchPayloadMatchCode({ data: { user: { id: 1 } } }, "SYNTH-LMS-F11"),
      false,
      "F11: Unrelated payload schema must be rejected"
    );

    // F11: Test ClassSyncer.fetchClassDatesFromLms against a Playwright page with a valid DOM row
    // under (a) HTTP 403 error, (b) non-class GetStudents 200 before GetClasses 403,
    // (c) prefix-similar SYNTH-LMS-F11-OTHER 200, (d) invalid JSON / null / {} / {success:false} / unrelated schema,
    // (e) timeout, and (f) valid HTTP 200 class search
    const scratchF11 = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v320-f11-"));
    const browserF11 = await chromium.launch({ headless: true });
    try {
      const pageF11 = await browserF11.newPage();
      let searchResponseMode:
        | "403"
        | "STUDENT_200_THEN_CLASS_403"
        | "PREFIX_SIMILAR_ONLY"
        | "INVALID_JSON"
        | "EMPTY_OBJECT"
        | "SUCCESS_FALSE"
        | "UNRELATED_SCHEMA"
        | "UNRELATED_ONLY"
        | "200" = "403";

      await pageF11.route("https://lms-api.mindx.edu.vn/**", async (route) => {
        const postBody = route.request().postData() || "";
        if (searchResponseMode === "STUDENT_200_THEN_CLASS_403") {
          if (postBody.includes("GetStudents")) {
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({ data: { students: [{ classCode: "SYNTH-LMS-F11" }] } }),
            });
            return;
          }
          await route.fulfill({
            status: 403,
            contentType: "application/json",
            body: JSON.stringify({ message: "Forbidden on GetClasses" }),
          });
          return;
        }
        if (searchResponseMode === "PREFIX_SIMILAR_ONLY") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ data: { classes: [{ code: "SYNTH-LMS-F11-OTHER" }] } }),
          });
          return;
        }
        if (searchResponseMode === "INVALID_JSON") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: "<<<not-valid-json>>>",
          });
          return;
        }
        if (searchResponseMode === "EMPTY_OBJECT") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({}),
          });
          return;
        }
        if (searchResponseMode === "SUCCESS_FALSE") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ success: false }),
          });
          return;
        }
        if (searchResponseMode === "UNRELATED_SCHEMA") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ data: { viewer: { id: "u1" } } }),
          });
          return;
        }
        if (searchResponseMode === "403") {
          await route.fulfill({
            status: 403,
            contentType: "application/json",
            body: JSON.stringify({ message: "Forbidden" }),
          });
          return;
        }
        if (searchResponseMode === "UNRELATED_ONLY") {
          await new Promise((r) => setTimeout(r, 800));
          await route.abort("timedout");
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { classes: [{ code: "SYNTH-LMS-F11" }] } }),
        });
      });

      await pageF11.setContent(`
        <html><body>
          <input placeholder="Search class" id="search-input" />
          <table><tbody>
            <tr>
              <td>1</td>
              <td>SYNTH-LMS-F11</td>
              <td>GameMaker Basic</td>
              <td>Vũng Tàu</td>
              <td>16/08/2026</td>
              <td>15/11/2026</td>
            </tr>
          </tbody></table>
          <script>
            const inp = document.getElementById("search-input");
            let sentForVal = "";
            inp.addEventListener("keydown", (e) => {
              if (e.key === "Enter" && inp.value && sentForVal !== inp.value) {
                sentForVal = inp.value;
                setTimeout(() => { sentForVal = ""; }, 100);
                fetch("https://lms-api.mindx.edu.vn/graphql", {
                  method: "POST",
                  body: JSON.stringify({ operationName: "GetStudents", variables: { classCode: inp.value } })
                }).catch(() => {});
                fetch("https://lms-api.mindx.edu.vn/graphql?search=" + encodeURIComponent(inp.value), {
                  method: "POST",
                  body: JSON.stringify({ operationName: "GetClasses", variables: { search: inp.value } })
                }).catch(() => {});
              }
            });
          </script>
        </body></html>
      `);

      // Case 1: HTTP 403 on class search -> MUST return success: false, source: "NONE" even though table row is in DOM
      searchResponseMode = "403";
      const res403 = await ClassSyncer.fetchClassDatesFromLms("SYNTH-LMS-F11", {
        testPage: pageF11,
        skipAuth: true,
        searchTimeoutMs: 400,
      });
      assert.equal(res403.success, false, "F11: HTTP 403 must return success: false");
      assert.equal(res403.source, "NONE", "F11: HTTP 403 must not return source: LMS_LIVE");
      assert(res403.error?.includes("HTTP 403"), `Expected HTTP 403 error, got: ${res403.error}`);

      // Case 1b: GetStudents HTTP 200 followed by GetClasses HTTP 403 -> MUST NOT be fooled by GetStudents 200
      searchResponseMode = "STUDENT_200_THEN_CLASS_403";
      const resStudent200Class403 = await ClassSyncer.fetchClassDatesFromLms("SYNTH-LMS-F11", {
        testPage: pageF11,
        skipAuth: true,
        searchTimeoutMs: 400,
      });
      assert.equal(
        resStudent200Class403.success,
        false,
        "F11: GetStudents 200 before GetClasses 403 must still return success: false"
      );
      assert.equal(resStudent200Class403.source, "NONE");

      // Case 1c: GetClasses HTTP 200 returning only prefix-similar SYNTH-LMS-F11-OTHER -> MUST NOT match SYNTH-LMS-F11
      searchResponseMode = "PREFIX_SIMILAR_ONLY";
      const resPrefixSimilar = await ClassSyncer.fetchClassDatesFromLms("SYNTH-LMS-F11", {
        testPage: pageF11,
        skipAuth: true,
        searchTimeoutMs: 300,
      });
      assert.equal(
        resPrefixSimilar.success,
        false,
        "F11: Response with only SYNTH-LMS-F11-OTHER must not satisfy search for SYNTH-LMS-F11"
      );
      assert.equal(resPrefixSimilar.source, "NONE");

      // Case 1d: HTTP 200 with invalid JSON, {}, {success:false}, or unrelated payload schema -> MUST return success: false, source: "NONE"
      for (const badMode of [
        "INVALID_JSON",
        "EMPTY_OBJECT",
        "SUCCESS_FALSE",
        "UNRELATED_SCHEMA",
      ] as const) {
        searchResponseMode = badMode;
        const resBadPayload = await ClassSyncer.fetchClassDatesFromLms("SYNTH-LMS-F11", {
          testPage: pageF11,
          skipAuth: true,
          searchTimeoutMs: 300,
        });
        assert.equal(
          resBadPayload.success,
          false,
          `F11: Mode ${badMode} must return success: false`
        );
        assert.equal(
          resBadPayload.source,
          "NONE",
          `F11: Mode ${badMode} must not return source: LMS_LIVE`
        );
      }

      // Case 2: Network failure / timeout on class search -> MUST return success: false, source: "NONE"
      searchResponseMode = "UNRELATED_ONLY";
      const resTimeout = await ClassSyncer.fetchClassDatesFromLms("SYNTH-LMS-F11", {
        testPage: pageF11,
        skipAuth: true,
        searchTimeoutMs: 300,
      });
      assert.equal(resTimeout.success, false, "F11: Timeout/abort must return success: false");
      assert.equal(resTimeout.source, "NONE", "F11: Timeout/abort must not return source: LMS_LIVE");
      assert(
        resTimeout.error?.includes("Hết thời gian chờ"),
        `Expected timeout error, got: ${resTimeout.error}`
      );

      // Case 3: Valid HTTP 200 response matching SYNTH-LMS-F11 -> returns success: true, source: "LMS_LIVE"
      searchResponseMode = "200";
      const res200 = await ClassSyncer.fetchClassDatesFromLms("SYNTH-LMS-F11", {
        testPage: pageF11,
        skipAuth: true,
        searchTimeoutMs: 2000,
      });
      assert.equal(
        res200.success,
        true,
        `F11: Valid HTTP 200 must return success: true (error: ${res200.error})`
      );
      assert.equal(res200.source, "LMS_LIVE");
      assert.equal(res200.startDateIso, "2026-08-16");
      assert.equal(res200.endDateIso, "2026-11-15");
    } finally {
      await browserF11.close();
      fs.rmSync(scratchF11, { recursive: true, force: true });
    }
    console.log("   [PASS] TP-01 passed.");

    // -------------------------------------------------------------------------
    // TP-02: Course Tracks, Partial Merge (F02) & Multi-Pass Overlapping PII Redaction (F06)
    // -------------------------------------------------------------------------
    console.log("-> Running TP-02: Course tracks, partial merge (F02) & overlapping PII redaction (F06)...");
    const sampleClassCodes = [
      { code: "VT-C4K-GA38", expectedTrack: "GAMEMAKER" },
      { code: "VT-C4K-SB21", expectedTrack: "SCRATCH" },
      { code: "VT-C4K-PTA09", expectedTrack: "PYTHON_APP" },
      { code: "VT-C4K-JSB12", expectedTrack: "WEB" },
      { code: "VT-C4K-CSA02", expectedTrack: "COMPUTER_SCIENCE" },
      { code: "VT-ROB-01", expectedTrack: "ROBOTICS" },
    ];

    for (const item of sampleClassCodes) {
      const detected = detectTeachingCourseTrack(item.code);
      assert.equal(detected, item.expectedTrack, `Track mismatch for ${item.code}`);
      const fiveTasks = getStandardFiveTasksForClass(item.code, "2026-11-15", [1704, 1705]);
      assert.equal(fiveTasks.length, 5);
      const sumWeight = fiveTasks.reduce(
        (s: number, t: TeachingProjectTaskItem) => s + t.weightPercent,
        0
      );
      assert.equal(sumWeight, 100);
    }

    // F02: Filling empty remote assigned_students from defaultStudents must set wasAutoCompleted = true
    const remoteFiveNoAssignees = getStandardFiveTasksForClass(
      "VT-C4K-GA38",
      "2026-11-15",
      []
    ).map((t, idx) => ({
      id: 3001 + idx,
      task_name: t.taskName,
      description: t.description,
      weight_percent: 20,
      deadline: "2026-11-15",
      assigned_students: "[]",
    }));
    const mergedEmptyAssignees = mergeExistingTeachingTasksWithStandardFive({
      classCode: "VT-C4K-GA38",
      endDate: "2026-11-15",
      allStudentIds: [1704, 1705],
      existingRemoteTasks: remoteFiveNoAssignees,
    });
    assert.equal(mergedEmptyAssignees.wasAutoCompleted, true);

    // F06: Overlapping/duplicate given names ("Nguyễn Minh Khôi" = STUDENT_01, "Trần Gia Khôi" = STUDENT_02)
    // Must NEVER turn "Trần Gia Khôi" into "Trần Gia STUDENT_01"
    const overlapRoster = ["Nguyễn Minh Khôi", "Trần Gia Khôi", "Lê Hoàng Bách"];
    assert.equal(
      sanitizeTeachingAiHint("Trần Gia Khôi", overlapRoster),
      "STUDENT_02",
      "F06: Full name of second student with shared given name must map to STUDENT_02 without leaking prefix"
    );
    assert.equal(
      sanitizeTeachingAiHint("Nguyễn Minh Khôi và Trần Gia Khôi", overlapRoster),
      "STUDENT_01 và STUDENT_02",
      "F06: Both full names must map to their respective STUDENT_01 and STUDENT_02 aliases"
    );
    assert.equal(
      sanitizeTeachingAiHint("Gia Khôi và Minh Khôi", overlapRoster),
      "STUDENT_02 và STUDENT_01",
      "F06: 2-word suffixes must map to STUDENT_02 and STUDENT_01 without leaking middle names"
    );
    assert.equal(
      sanitizeTeachingAiHint("Trần Khôi", overlapRoster),
      "STUDENT_02",
      "F06: First+last name combination must map to STUDENT_02 without leaking family name"
    );
    assert.equal(
      sanitizeTeachingAiHint("Khoi", overlapRoster),
      "STUDENT_01",
      "F06: Unaccented single-word given name Khoi must be redacted to STUDENT_01"
    );
    assert.equal(
      sanitizeTeachingAiHint("Bach", overlapRoster),
      "STUDENT_03",
      "F06: Unaccented single-word given name Bach must be redacted to STUDENT_03"
    );

    const dirtyHint =
      "Làm game bắn tàu cho Trần Gia Khôi, Nguyễn Minh Khôi và bạn Bách, liên hệ khoi@gmail.com hoặc 0912345678";
    const cleanHint = sanitizeTeachingAiHint(dirtyHint, undefined, "VT-C4K-GA38");
    assert(!cleanHint.includes("Nguyễn"), "Must redact family name Nguyễn");
    assert(!cleanHint.includes("Trần"), "Must redact family name Trần");
    assert(!cleanHint.includes("Gia"), "Must redact middle name Gia");
    assert(!/\bKhôi\b/i.test(cleanHint), "Must redact given name Khôi");
    assert(!/\bBách\b/i.test(cleanHint), "Must redact given name Bách");
    assert(cleanHint.includes("STUDENT_01") && cleanHint.includes("STUDENT_02") && cleanHint.includes("STUDENT_03"));

    // Rule 5 / F13: INSUFFICIENT_INFO when track is GENERAL, no syllabus, and teacherHint is empty
    const insufficientRes = await generateTeachingProjectTasksWithAI({
      classCode: "VT-UNKNOWN-999",
      endDate: "2026-11-15",
      assignedStudentIds: [1704],
      teacherHint: "   ",
    });
    assert.equal(insufficientRes.success, false);
    assert.equal(insufficientRes.errorCode, "INSUFFICIENT_INFO");
    console.log("   [PASS] TP-02 passed.");

    // -------------------------------------------------------------------------
    // TP-03: Strict Validation Including Fractional Weights (F08), Hash & Concurrency (F07)
    // -------------------------------------------------------------------------
    console.log("-> Running TP-03: Strict non-coercing validation (F08), fractional weights & concurrency (F07)...");
    const synthClass = "SYNTH-TP-GA99";
    const synthStudents: TeachingStudentItem[] = [
      { id: 9001, studentName: "STUDENT_A", classCode: synthClass, status: "đang học" },
      { id: 9002, studentName: "STUDENT_B", classCode: synthClass, status: "đang học" },
    ];
    const validTasks = getStandardFiveTasksForClass(synthClass, "2026-11-15", [9001, 9002]);

    // F08: Fractional weights (20.4 * 5 = 102%) must NOT be rounded to 20 and must fail approval
    const fractionalTasks = validTasks.map((t) => ({ ...t, weightPercent: 20.4 }));
    const savedFractional = teachingProjectRepo.saveDraft({
      classId: synthClass,
      projectName: "SPCK - GA99",
      startDate: "2026-08-16",
      endDate: "2026-11-15",
      description: "Mô tả",
      students: synthStudents,
      tasks: fractionalTasks,
    });
    const parsedFractional = teachingProjectRepo.parseTasks(savedFractional.record);
    assert.equal(
      parsedFractional[0].weightPercent,
      20.4,
      "F08: saveDraft must preserve fractional weight 20.4 without rounding to 20"
    );
    const approveFractional = teachingProjectRepo.approveDraft(synthClass);
    assert.equal(
      approveFractional.success,
      false,
      "F08: approveDraft must reject fractional weightPercent 20.4"
    );

    // F08: 6 tasks, empty assignees, zero weight, empty deadline must all fail approval
    teachingProjectRepo.saveDraft({
      classId: synthClass,
      tasks: [...validTasks, { ...validTasks[0], slotIndex: 6, taskName: "6. Thừa" }],
    });
    assert.equal(teachingProjectRepo.approveDraft(synthClass).success, false);

    teachingProjectRepo.saveDraft({
      classId: synthClass,
      tasks: validTasks.map((t, idx) => (idx === 0 ? { ...t, assignedStudentIds: [] } : t)),
    });
    assert.equal(teachingProjectRepo.approveDraft(synthClass).success, false);

    teachingProjectRepo.saveDraft({
      classId: synthClass,
      tasks: validTasks.map((t, idx) => (idx === 0 ? { ...t, deadline: "" } : t)),
    });
    assert.equal(teachingProjectRepo.approveDraft(synthClass).success, false);

    // Save valid 5 tasks -> Approve -> Verify -> Edit -> Auto-downgrade to WAITING_APPROVAL
    const savedValid = teachingProjectRepo.saveDraft({
      classId: synthClass,
      projectName: "SPCK - GA99",
      startDate: "2026-08-16",
      endDate: "2026-11-15",
      description: "Dự án kiểm thử",
      students: synthStudents,
      tasks: validTasks,
    });
    const approveRes = teachingProjectRepo.approveDraft(synthClass, savedValid.record.draftVersion);
    assert.equal(approveRes.success, true);

    const verifiedTasksWithIds = validTasks.map((t, i) => ({ ...t, taskId: 2001 + i }));
    const verifiedHash = computeTeachingProjectHash({
      classId: synthClass,
      projectName: approveRes.record.projectName,
      startDate: approveRes.record.startDate,
      endDate: approveRes.record.endDate,
      description: approveRes.record.description,
      tasks: verifiedTasksWithIds,
    });
    const verifiedRec = teachingProjectRepo.markVerified(synthClass, verifiedHash, {
      teachingProjectId: 501,
      verifiedProject: {
        projectName: approveRes.record.projectName,
        startDate: approveRes.record.startDate,
        endDate: approveRes.record.endDate,
        description: approveRes.record.description,
      },
      verifiedTasks: verifiedTasksWithIds,
    });
    assert.equal(verifiedRec.status, "VERIFIED");

    // F07: Verify API routes enforce expectedVersion (400 when missing, 409 when stale)
    const missingVerResp = await postTeachingProjectRoute(
      new NextRequest("http://127.0.0.1:3000/api/teaching-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", host: "127.0.0.1:3000" },
        body: JSON.stringify({ classCode: synthClass, projectName: "No version" }),
      })
    );
    assert.equal(missingVerResp.status, 400);

    const staleSyncResp = await postTeachingSyncRoute(
      new NextRequest("http://127.0.0.1:3000/api/teaching-projects/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", host: "127.0.0.1:3000" },
        body: JSON.stringify({ classCode: synthClass, expectedVersion: 1 }),
      })
    );
    assert.equal(staleSyncResp.status, 409);

    const staleAiResp = await postTeachingGenerateAiRoute(
      new NextRequest("http://127.0.0.1:3000/api/teaching-projects/generate-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", host: "127.0.0.1:3000" },
        body: JSON.stringify({ classCode: synthClass, expectedVersion: 1 }),
      })
    );
    assert.equal(staleAiResp.status, 409);

    const staleDatesResp = await postFetchLmsDatesRoute(
      new NextRequest("http://127.0.0.1:3000/api/teaching-projects/fetch-lms-dates", {
        method: "POST",
        headers: { "Content-Type": "application/json", host: "127.0.0.1:3000" },
        body: JSON.stringify({ classCode: synthClass, expectedVersion: 1 }),
      })
    );
    assert.equal(staleDatesResp.status, 409);
    console.log("   [PASS] TP-03 passed.");

    // -------------------------------------------------------------------------
    // TP-04: TeachingProjectService Sync & Full 4-Field Read-after-Write (F01, F02, F04)
    // -------------------------------------------------------------------------
    console.log("-> Running TP-04: TeachingProjectService sync & 4-field Read-after-Write on new & existing projects (F01, F02, F04)...");
    const mockTransport = new MockTeachingTransport();
    const syncClass = "SYNTH-TP-NEW88";

    mockTransport.projects.set(syncClass, {
      id: 106,
      class_code: syncClass,
      project_name: "SPCK - NEW88",
      start_date: "2026-08-16",
      end_date: "2026-11-15",
      description: "Dự án mẫu",
    });
    mockTransport.students.set(syncClass, [
      { id: 1704, student_name: "STUDENT_01", class_code: syncClass, status: "đang học" },
      { id: 1705, student_name: "STUDENT_02", class_code: syncClass, status: "đang học" },
    ]);
    mockTransport.tasks.set(
      106,
      getStandardFiveTasksForClass(syncClass, "2026-11-15", [1704, 1705]).map((t, idx) => ({
        id: 1024 + idx,
        project_id: 106,
        task_name: t.taskName,
        description: t.description,
        weight_percent: 20,
        deadline: "2026-11-15",
        assigned_students: "[1704,1705]",
      }))
    );

    const loaded = await TeachingProjectService.loadClassProject(syncClass, {
      forceRefreshFromTeaching: true,
      transport: mockTransport,
    });
    assert.equal(loaded.record.status, "DRAFT", "F02: Must stay DRAFT on load");

    // F04: Preserve local draft when forceRefreshFromTeaching = false or on network failure
    const customEdited = teachingProjectRepo.saveDraft({
      classId: syncClass,
      description: "Bản nháp riêng của giáo viên chưa duyệt",
      expectedVersion: loaded.record.draftVersion,
    });
    const reloadedNoForce = await TeachingProjectService.loadClassProject(syncClass, {
      forceRefreshFromTeaching: false,
      transport: mockTransport,
    });
    assert.equal(reloadedNoForce.record.description, "Bản nháp riêng của giáo viên chưa duyệt");
    assert.equal(reloadedNoForce.record.draftVersion, customEdited.record.draftVersion);

    mockTransport.throwOnGetStudents = true;
    const reloadedOnNetworkFail = await TeachingProjectService.loadClassProject(syncClass, {
      forceRefreshFromTeaching: true,
      transport: mockTransport,
    });
    mockTransport.throwOnGetStudents = false;
    assert.equal(reloadedOnNetworkFail.record.description, "Bản nháp riêng của giáo viên chưa duyệt");

    // F01: Test all 4 project fields mismatching on an EXISTING project (projectId = 106)
    const existingFieldCases: Array<{
      patch: Partial<{ projectName: string; startDate: string; endDate: string; description: string }>;
      label: string;
    }> = [
      { patch: { projectName: "SPCK - NEW88 RENAMED" }, label: "existing project_name" },
      { patch: { startDate: "2026-08-01" }, label: "existing start_date" },
      { patch: { endDate: "2026-11-20" }, label: "existing end_date" },
      { patch: { description: "Mô tả khác với remote" }, label: "existing description" },
    ];

    for (const c of existingFieldCases) {
      teachingProjectRepo.saveDraft({
        classId: syncClass,
        projectName: c.patch.projectName ?? "SPCK - NEW88",
        startDate: c.patch.startDate ?? "2026-08-16",
        endDate: c.patch.endDate ?? "2026-11-15",
        description: c.patch.description ?? "Dự án mẫu",
        tasks: getStandardFiveTasksForClass(
          syncClass,
          c.patch.endDate ?? "2026-11-15",
          [1704, 1705]
        ),
      });
      assert.equal(teachingProjectRepo.approveDraft(syncClass).success, true);
      const mismatchRes = await TeachingProjectService.syncProjectAndTasksToTeaching(syncClass, {
        transport: mockTransport,
      });
      assert.equal(mismatchRes.success, false, `F01: Must fail Read-after-Write on ${c.label}`);
      assert.equal(mismatchRes.record.status, "FAILED");
      assert(mismatchRes.error?.includes("[Read-after-Write Error]"));
    }

    // F01: Test all 4 project fields mismatching on a NEWLY CREATED project (teachingProjectId = null)
    const newCreateFields: Array<"project_name" | "start_date" | "end_date" | "description"> = [
      "project_name",
      "start_date",
      "end_date",
      "description",
    ];
    for (const field of newCreateFields) {
      const freshClass = `SYNTH-NEW-${field.toUpperCase()}`;
      mockTransport.students.set(freshClass, [
        { id: 1901, student_name: "STUDENT_N1", class_code: freshClass, status: "đang học" },
      ]);
      await TeachingProjectService.loadClassProject(freshClass, {
        forceRefreshFromTeaching: true,
        transport: mockTransport,
      });
      teachingProjectRepo.saveDraft({
        classId: freshClass,
        projectName: `SPCK - ${freshClass}`,
        startDate: "2026-08-16",
        endDate: "2026-11-15",
        description: "Mô tả mới",
        tasks: getStandardFiveTasksForClass(freshClass, "2026-11-15", [1901]),
      });
      assert.equal(teachingProjectRepo.approveDraft(freshClass).success, true);
      mockTransport.corruptReadAfterWriteField = field;
      const newMismatchRes = await TeachingProjectService.syncProjectAndTasksToTeaching(freshClass, {
        transport: mockTransport,
      });
      mockTransport.corruptReadAfterWriteField = null;
      assert.equal(
        newMismatchRes.success,
        false,
        `F01: Must fail Read-after-Write when newly created project corrupts ${field}`
      );
      assert.equal(newMismatchRes.record.status, "FAILED");
    }

    // Restore syncClass to matching state and verify
    teachingProjectRepo.saveDraft({
      classId: syncClass,
      projectName: "SPCK - NEW88",
      startDate: "2026-08-16",
      endDate: "2026-11-15",
      description: "Dự án mẫu",
      tasks: getStandardFiveTasksForClass(syncClass, "2026-11-15", [1704, 1705]),
    });
    assert.equal(teachingProjectRepo.approveDraft(syncClass).success, true);
    const reSynced = await TeachingProjectService.syncProjectAndTasksToTeaching(syncClass, {
      transport: mockTransport,
    });
    assert.equal(reSynced.success, true);
    assert.equal(reSynced.record.status, "VERIFIED");
    console.log("   [PASS] TP-04 passed.");

    // -------------------------------------------------------------------------
    // TP-05: Progress Sync, Cross-Class/Unapproved Task/Empty Assignees (F05) & 0% Key Check (F09)
    // -------------------------------------------------------------------------
    console.log("-> Running TP-05: Progress sync, F05 guards (unapproved task & empty assignees) & F09...");
    const verifiedTasksForProg = reSynced.verifiedTasks!;
    const callsBeforeF05 = mockTransport.updateProgressCallCount;

    // F05 Case 1: Foreign taskId not in project
    const foreignTaskAttempt = await TeachingProjectService.updateTaskProgressOnTeaching(
      syncClass,
      [{ taskId: 999999, studentId: 1704, progressPercent: 100 }],
      { transport: mockTransport }
    );
    assert.equal(foreignTaskAttempt.success, false);
    assert.equal(mockTransport.updateProgressCallCount, callsBeforeF05);

    // F05 Case 2: Task in the SAME remote project (project_id = 106) but NOT in the 5 approved tasks in SQLite
    const currentRemoteTasks = mockTransport.tasks.get(106) ?? [];
    mockTransport.tasks.set(106, [
      ...currentRemoteTasks,
      {
        id: 8888,
        project_id: 106,
        task_name: "Extra unapproved remote task",
        description: "Not in SQLite approved list",
        weight_percent: 20,
        deadline: "2026-11-15",
        assigned_students: "[1704,1705]",
      },
    ]);
    const unapprovedSameProjAttempt = await TeachingProjectService.updateTaskProgressOnTeaching(
      syncClass,
      [{ taskId: 8888, studentId: 1704, progressPercent: 100 }],
      { transport: mockTransport }
    );
    assert.equal(
      unapprovedSameProjAttempt.success,
      false,
      "F05: Must reject task that is in remote project but not in SQLite approved tasks"
    );
    assert.equal(mockTransport.updateProgressCallCount, callsBeforeF05);
    mockTransport.tasks.set(106, currentRemoteTasks);

    // F05 Case 3: Task with empty assigned_students = "[]" on remote
    const firstTid = Number(verifiedTasksForProg[0].taskId);
    mockTransport.tasks.set(
      106,
      currentRemoteTasks.map((t) =>
        Number(t.id) === firstTid ? { ...t, assigned_students: "[]" } : t
      )
    );
    const emptyAssigneesAttempt = await TeachingProjectService.updateTaskProgressOnTeaching(
      syncClass,
      [{ taskId: firstTid, studentId: 1704, progressPercent: 100 }],
      { transport: mockTransport }
    );
    assert.equal(
      emptyAssigneesAttempt.success,
      false,
      "F05: Must reject progress update when remote task has empty assigned_students"
    );
    assert.equal(mockTransport.updateProgressCallCount, callsBeforeF05);
    mockTransport.tasks.set(106, currentRemoteTasks);

    // Valid bulk milestone update
    const bulkUpdates: Array<{ taskId: number; studentId: number; progressPercent: number }> = [];
    for (let i = 0; i < verifiedTasksForProg.length; i++) {
      const tid = Number(verifiedTasksForProg[i].taskId);
      const pct = i < 3 ? 100 : 0;
      for (const sid of [1704, 1705]) {
        bulkUpdates.push({ taskId: tid, studentId: sid, progressPercent: pct });
      }
    }
    const progResult = await TeachingProjectService.updateTaskProgressOnTeaching(
      syncClass,
      bulkUpdates,
      { transport: mockTransport }
    );
    assert.equal(progResult.success, true);
    assert.equal(progResult.updatedCount, 10);

    // F09: Missing key OR malformed value (null, "", "not-a-number", NaN, boolean, float) when expectedPercent is 0 must fail Read-after-Write
    const parsedRawProg = parseRemoteTeachingProgressPayload({
      "10_1": 0,
      "10_2": "0",
      "10_3": 100,
      "10_4": "100",
      "10_null": null,
      "10_empty": "",
      "10_nan": "not-a-number",
      "10_bool": false,
      "10_float": 12.5,
      "10_neg": -1,
      "10_over": 101,
    });
    assert.deepEqual(parsedRawProg, {
      "10_1": 0,
      "10_2": 0,
      "10_3": 100,
      "10_4": 100,
    });

    mockTransport.corruptProgressReadAfterWrite = true;
    const failedZeroProg = await TeachingProjectService.updateTaskProgressOnTeaching(
      syncClass,
      [{ taskId: firstTid, studentId: 1704, progressPercent: 0 }],
      { transport: mockTransport }
    );
    mockTransport.corruptProgressReadAfterWrite = false;
    assert.equal(failedZeroProg.success, false);
    assert(failedZeroProg.error?.includes("[Read-after-Write Error]"));

    for (const badVal of [null, "", "not-a-number"] as const) {
      mockTransport.rawProgressOverride = { [`${firstTid}_1704`]: badVal };
      const failedBadVal = await TeachingProjectService.updateTaskProgressOnTeaching(
        syncClass,
        [{ taskId: firstTid, studentId: 1704, progressPercent: 0 }],
        { transport: mockTransport }
      );
      mockTransport.rawProgressOverride = null;
      assert.equal(
        failedBadVal.success,
        false,
        `F09: Malformed remote progress value ${JSON.stringify(badVal)} must fail Read-after-Write when saving 0%`
      );
      assert(failedBadVal.error?.includes("[Read-after-Write Error]"));
    }

    // R4-01: Malformed incoming progressPercent (undefined, null, "", "abc", false, 12.5, -1, 101)
    // must be rejected BEFORE any write and must NEVER overwrite existing 80% progress with 0%
    await TeachingProjectService.updateTaskProgressOnTeaching(
      syncClass,
      [{ taskId: firstTid, studentId: 1704, progressPercent: 80 }],
      { transport: mockTransport }
    );
    const callsBeforeR401 = mockTransport.updateProgressCallCount;
    for (const badInputPct of [undefined, null, "", "abc", false, 12.5, -1, 101] as const) {
      const badInputRes = await TeachingProjectService.updateTaskProgressOnTeaching(
        syncClass,
        [{ taskId: firstTid, studentId: 1704, progressPercent: badInputPct as any }],
        { transport: mockTransport }
      );
      assert.equal(
        badInputRes.success,
        false,
        `R4-01: Must reject malformed incoming progressPercent ${JSON.stringify(badInputPct)}`
      );
      assert.equal(
        mockTransport.updateProgressCallCount,
        callsBeforeR401,
        `R4-01: Must not write to Teaching when progressPercent is ${JSON.stringify(badInputPct)}`
      );
      assert.equal(
        mockTransport.progress.get(106)?.[`${firstTid}_1704`],
        80,
        "R4-01: Existing 80% progress must remain untouched"
      );
    }

    // R4-01: Route-level validation for updates and milestoneTaskCount
    for (const badPayload of [
      { classCode: syncClass, updates: [{ taskId: firstTid, studentId: 1704, progressPercent: null }] },
      { classCode: syncClass, updates: [{ taskId: firstTid, studentId: 1704, progressPercent: "" }] },
      { classCode: syncClass, updates: [{ taskId: firstTid, studentId: 1704, progressPercent: false }] },
      { classCode: syncClass, updates: [{ taskId: firstTid, studentId: 1704, progressPercent: 12.5 }] },
      { classCode: syncClass, milestoneTaskCount: null },
      { classCode: syncClass, milestoneTaskCount: "" },
      { classCode: syncClass, milestoneTaskCount: "abc" },
      { classCode: syncClass, milestoneTaskCount: false },
      { classCode: syncClass, milestoneTaskCount: 2.5 },
      { classCode: syncClass, milestoneTaskCount: -1 },
      { classCode: syncClass, milestoneTaskCount: 6 },
    ]) {
      const badRouteResp = await postTeachingProgressRoute(
        new NextRequest("http://127.0.0.1:3000/api/teaching-projects/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json", host: "127.0.0.1:3000" },
          body: JSON.stringify(badPayload),
        })
      );
      assert.equal(
        badRouteResp.status,
        400,
        `R4-01: Route must reject invalid payload ${JSON.stringify(badPayload)} with HTTP 400`
      );
    }
    console.log("   [PASS] TP-05 passed.");

    // -------------------------------------------------------------------------
    // TP-06: Extracted Page Classes Contrast (Normal + Hover) & Class-Switch Race Guard (F03, F12)
    // -------------------------------------------------------------------------
    console.log("-> Running TP-06: Extracted page classes contrast (normal + :hover) & class-switch race guard (F03, F12)...");
    const navbarSource = readAllowedUtf8(path.join(root, "src/components/top-navbar.tsx"));
    assert(navbarSource.includes('href: "/teaching-projects"'));

    const pageSource = readAllowedUtf8(path.join(root, "src/app/teaching-projects/page.tsx"));
    assert(!pageSource.includes("mindx-badge-"), "F12: Must not use .mindx-badge-*");
    assert(!pageSource.includes("hover:bg-emerald-600"), "F12: Must not use hover:bg-emerald-600");
    assert(!pageSource.includes("hover:bg-blue-600"), "F12: Must not use hover:bg-blue-600");
    assert(!pageSource.includes("hover:bg-indigo-600"), "F12: Must not use hover:bg-indigo-600");
    assert(!pageSource.includes("hover:bg-slate-600"), "F12: Must not use hover:bg-slate-600");

    // Extract every mindx-dark-keep class string directly from src/app/teaching-projects/page.tsx
    const extractedDarkKeepClasses = Array.from(
      new Set(
        Array.from(
          pageSource.matchAll(/className="([^"]*mindx-dark-keep[^"]*)"/g),
          (m) => m[1]
        )
      )
    );
    assert(
      extractedDarkKeepClasses.length >= 10,
      `Expected at least 10 extracted mindx-dark-keep class strings from page.tsx, got ${extractedDarkKeepClasses.length}`
    );

    const sourceCss = readAllowedUtf8(path.join(root, "src/app/globals.css"));
    const compiledCss = (
      await postcss([tailwind({ base: root })]).process(sourceCss, {
        from: path.join(root, "src/app/globals.css"),
      })
    ).css;

    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v320-tp06-"));
    const context = await chromium.launchPersistentContext(
      path.join(scratch, "playwright-auth"),
      { headless: true, viewport: { width: 1366, height: 768 } }
    );
    try {
      const page = await context.newPage();
      const dynamicNodesHtml = extractedDarkKeepClasses
        .map((cls, idx) => {
          const isBtn = cls.includes("hover:bg-");
          const tag = isBtn ? "button" : "span";
          return `<${tag} id="extracted-dk-${idx}" data-hoverable="${isBtn ? "1" : "0"}" class="${cls}">Sample ${idx}</${tag}>`;
        })
        .join("\n");

      await page.setContent(`
        <html data-theme="light">
          <head><style>${compiledCss}</style></head>
          <body class="mindx-body">
            <main class="mindx-main p-4 space-y-4">
              <div class="mindx-hero px-5 py-4 rounded-2xl">
                <h1 id="tp-title" class="text-xl font-extrabold text-white">Dự Án Cuối Khóa</h1>
              </div>
              <section class="mindx-card mindx-card-emerald p-4 rounded-2xl flex flex-wrap gap-2">
                ${dynamicNodesHtml}
              </section>
            </main>
          </body>
        </html>
      `);

      const idsToCheck = [
        "tp-title",
        ...extractedDarkKeepClasses.map((_, idx) => `extracted-dk-${idx}`),
      ];

      const measureContrastForId = async (targetId: string) => {
        return (await page.evaluate(`(() => {
          const id = ${JSON.stringify(targetId)};
          const normalize = (value) => {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = value;
            ctx.fillRect(0, 0, 1, 1);
            const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
            return \`rgb(\${r}, \${g}, \${b})\`;
          };
          const background = (el) => {
            let curr = el;
            while (curr) {
              const bg = getComputedStyle(curr).backgroundColor;
              if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return normalize(bg);
              if (curr.classList && curr.classList.contains("mindx-hero")) {
                return document.documentElement.dataset.theme === "light"
                  ? "rgb(37, 99, 235)"
                  : "rgb(27, 41, 71)";
              }
              curr = curr.parentElement;
            }
            return "rgb(255, 255, 255)";
          };
          const contrast = (a, b) => {
            const lum = (c) => {
              const rgb = (c.match(/[\\d.]+/g) || [0, 0, 0])
                .slice(0, 3)
                .map(Number)
                .map((v) => {
                  const s = v / 255;
                  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
                });
              return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
            };
            const l1 = lum(a);
            const l2 = lum(b);
            return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          };
          const el = document.getElementById(id);
          const fg = normalize(getComputedStyle(el).color);
          const bg = background(el);
          return { id, fg, bg, ratio: contrast(fg, bg), hoverable: el.dataset.hoverable === "1" };
        })()`)) as { id: string; fg: string; bg: string; ratio: number; hoverable: boolean };
      };

      for (const osTheme of ["light", "dark"] as const) {
        for (const appTheme of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme: osTheme });
          await page.evaluate(`document.documentElement.dataset.theme = "${appTheme}"`);

          for (const id of idsToCheck) {
            await page.mouse.move(0, 0);
            const restItem = await measureContrastForId(id);
            assert(
              restItem.ratio >= 4.5,
              `Low rest contrast on #${id} (${restItem.ratio.toFixed(2)}) in os=${osTheme}, app=${appTheme}`
            );

            if (restItem.hoverable) {
              await page.locator(`#${id}`).hover();
              const hoverItem = await measureContrastForId(id);
              assert(
                hoverItem.ratio >= 4.5,
                `Low :hover contrast on #${id} (${hoverItem.ratio.toFixed(2)}, bg=${hoverItem.bg}) in os=${osTheme}, app=${appTheme}`
              );
            }
          }
        }
      }

      // Also mount the REAL TeachingProjectsPage React component via esbuild to test:
      // (a) Real rendered component DOM contrast (rest + :hover) across all 4 theme combinations (F12)
      // (b) Real component class-switch race condition protection when Class A resolves after Class B (F03)
      const bundleResult = await esbuild.build({
        stdin: {
          contents: `
            import React from "react";
            import { createRoot } from "react-dom/client";
            import TeachingProjectsPage from "./src/app/teaching-projects/page";
            const rootEl = document.getElementById("app-root");
            if (rootEl) {
              createRoot(rootEl).render(React.createElement(TeachingProjectsPage));
            }
          `,
          resolveDir: root,
          loader: "tsx",
        },
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        jsx: "automatic",
        define: {
          "process.env.NODE_ENV": '"production"',
        },
      });
      const clientBundleJs = bundleResult.outputFiles[0].text;

      let slowClassADelayMs = 0;
      const livePage = await context.newPage();
      await livePage.route("http://127.0.0.1:3000/**", async (route) => {
        const reqUrl = new URL(route.request().url());
        if (reqUrl.pathname === "/teaching-projects") {
          await route.fulfill({
            status: 200,
            contentType: "text/html",
            body: `<!DOCTYPE html>
              <html data-theme="light">
                <head><meta charset="utf-8" /><style>${compiledCss}</style></head>
                <body class="mindx-body">
                  <main class="mindx-main p-4">
                    <div id="app-root"></div>
                  </main>
                  <script>${clientBundleJs}</script>
                </body>
              </html>`,
          });
          return;
        }
        if (reqUrl.pathname === "/api/running-classes") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              success: true,
              classes: [
                {
                  classCode: "VT-C4K-GA38",
                  courseName: "GameMaker Advanced",
                  startDate: "16/08/2026",
                  endDate: "15/11/2026",
                },
                {
                  classCode: "VT-C4K-SB21",
                  courseName: "Scratch Basic",
                  startDate: "01/09/2026",
                  endDate: "01/12/2026",
                },
              ],
            }),
          });
          return;
        }
        if (reqUrl.pathname === "/api/teaching-projects") {
          const code = (reqUrl.searchParams.get("classCode") || "VT-C4K-GA38").toUpperCase();
          if (code === "VT-C4K-GA38" && slowClassADelayMs > 0) {
            await new Promise((r) => setTimeout(r, slowClassADelayMs));
          }
          const isGa38 = code === "VT-C4K-GA38";
          const tasksList = getStandardFiveTasksForClass(
            code,
            isGa38 ? "2026-11-15" : "2026-12-01",
            [1704, 1705]
          ).map((t, i) => ({ ...t, taskId: 2001 + i }));
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              success: true,
              classCode: code,
              classes: [
                {
                  classCode: "VT-C4K-GA38",
                  courseName: "GameMaker Advanced",
                  startDate: "16/08/2026",
                  endDate: "15/11/2026",
                },
                {
                  classCode: "VT-C4K-SB21",
                  courseName: "Scratch Basic",
                  startDate: "01/09/2026",
                  endDate: "01/12/2026",
                },
              ],
              courseName: isGa38 ? "GameMaker Advanced" : "Scratch Basic",
              dateSource: "LMS_LIVE",
              record: {
                classId: code,
                teachingProjectId: isGa38 ? 106 : 208,
                projectName: isGa38 ? "SPCK - GA38" : "SPCK - SB21",
                startDate: isGa38 ? "2026-08-16" : "2026-09-01",
                endDate: isGa38 ? "2026-11-15" : "2026-12-01",
                description: isGa38 ? "Dự án GA38" : "Dự án SB21",
                status: "VERIFIED",
                draftVersion: isGa38 ? 3 : 9,
                contentHash: "a".repeat(64),
                verifiedAt: "2026-10-28T10:00:00.000Z",
                errorMessage: null,
              },
              students: [
                { id: 1704, studentName: "STUDENT_01", classCode: code, status: "đang học" },
                { id: 1705, studentName: "STUDENT_02", classCode: code, status: "đang học" },
              ],
              tasks: tasksList,
              progress: { "2001_1704": 100, "2001_1705": 50 },
            }),
          });
          return;
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      });

      await livePage.goto("http://127.0.0.1:3000/teaching-projects");
      await livePage.waitForSelector('input[placeholder="VD: SPCK - GA38"]');

      // Verify contrast on the live mounted React component across all 4 theme combinations
      for (const osTheme of ["light", "dark"] as const) {
        for (const appTheme of ["light", "dark"] as const) {
          await livePage.emulateMedia({ colorScheme: osTheme });
          await livePage.evaluate(`document.documentElement.dataset.theme = "${appTheme}"`);
          const liveRatios = (await livePage.evaluate(`(() => {
            const normalize = (value) => {
              const canvas = document.createElement("canvas");
              canvas.width = canvas.height = 1;
              const ctx = canvas.getContext("2d");
              ctx.fillStyle = value;
              ctx.fillRect(0, 0, 1, 1);
              const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
              return \`rgb(\${r}, \${g}, \${b})\`;
            };
            const background = (el) => {
              let curr = el;
              while (curr) {
                const bg = getComputedStyle(curr).backgroundColor;
                if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return normalize(bg);
                if (curr.classList && curr.classList.contains("mindx-hero")) {
                  return document.documentElement.dataset.theme === "light"
                    ? "rgb(37, 99, 235)"
                    : "rgb(27, 41, 71)";
                }
                curr = curr.parentElement;
              }
              return "rgb(255, 255, 255)";
            };
            const contrast = (a, b) => {
              const lum = (c) => {
                const rgb = (c.match(/[\\d.]+/g) || [0, 0, 0])
                  .slice(0, 3)
                  .map(Number)
                  .map((v) => {
                    const s = v / 255;
                    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
                  });
                return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
              };
              const l1 = lum(a);
              const l2 = lum(b);
              return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            };
            const nodes = Array.from(document.querySelectorAll(".mindx-dark-keep"));
            return nodes.map((el, idx) => ({
              idx,
              text: (el.textContent || "").trim().slice(0, 30),
              ratio: contrast(normalize(getComputedStyle(el).color), background(el)),
            }));
          })()`)) as Array<{ idx: number; text: string; ratio: number }>;

          assert(liveRatios.length >= 10, "Mounted React page must render >= 10 .mindx-dark-keep elements");
          for (const item of liveRatios) {
            assert(
              item.ratio >= 4.5,
              `Low contrast (${item.ratio.toFixed(2)}) on mounted React element [${item.idx}] "${item.text}" in os=${osTheme}, app=${appTheme}`
            );
          }
        }
      }

      // F03 Behavioral Test on the REAL mounted React component:
      // 1) Verify that while VT-C4K-GA38 is loading (350ms), the <select> and action buttons are disabled (isAnyMutationBusy)
      // 2) And if an overlapping change event is dispatched to <select> for VT-C4K-SB21 while VT-C4K-GA38 is in flight,
      //    activeLoadSeqRef ignores VT-C4K-GA38's late response and keeps "SPCK - SB21"!
      slowClassADelayMs = 350;
      const selectLoc = livePage.locator("select").first();
      await selectLoc.selectOption("VT-C4K-SB21");
      await livePage.waitForTimeout(80);
      assert.equal(
        await livePage.locator('input[placeholder="VD: SPCK - GA38"]').inputValue(),
        "SPCK - SB21"
      );

      // Dispatch overlapping select change to slow VT-C4K-GA38 (350ms) then immediately to fast VT-C4K-SB21 (0ms)
      await livePage.evaluate(`(() => {
        const sel = document.querySelector("select");
        const setNativeValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        setNativeValue.call(sel, "VT-C4K-GA38");
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        setTimeout(() => {
          setNativeValue.call(sel, "VT-C4K-SB21");
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        }, 40);
      })()`);
      await livePage.waitForTimeout(550);

      const finalProjectNameVal = await livePage
        .locator('input[placeholder="VD: SPCK - GA38"]')
        .inputValue();
      assert.equal(
        finalProjectNameVal,
        "SPCK - SB21",
        "F03: Mounted TeachingProjectsPage must ignore stale response from VT-C4K-GA38 after switching to VT-C4K-SB21"
      );
      await livePage.close();
    } finally {
      await context.close();
      fs.rmSync(scratch, { recursive: true, force: true });
    }
    console.log("   [PASS] TP-06 passed.");
  } finally {
    cleanupIsolatedDbFiles(absIsolatedDb);
    for (const suffix of ["", ".tmp"]) {
      const candidate = `${absIsolatedRunningClasses}${suffix}`;
      if (fs.existsSync(candidate)) {
        fs.rmSync(candidate, { force: true });
      }
    }
    const prodDbHashAfter = getFileSha256IfExists(absProdDb);
    const runningClassesHashAfter = getFileSha256IfExists(absRunningClasses);
    assert.equal(
      prodDbHashAfter,
      prodDbHashBefore,
      "F13: Production data/mindx_bot.db must remain 100% untouched (identical SHA-256)"
    );
    assert.equal(
      runningClassesHashAfter,
      runningClassesHashBefore,
      "F13: Production data/running_classes.json must remain 100% untouched (identical SHA-256)"
    );
  }

  console.log("=== [v3.2.0] ALL 6 TEACHING PROJECT TEST GROUPS PASSED ON ISOLATED DB ===");
}

runTests().catch((err) => {
  console.error("TEST SUITE FAILED:", err);
  process.exit(1);
});
