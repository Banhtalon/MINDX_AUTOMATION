import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { transformSync } from "esbuild";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v340-s4-"));
process.env.MINDX_DB_PATH = path.join(tmpDir, "mindx_s4.db");
process.env.MINDX_RUNNING_CLASSES_PATH = path.join(tmpDir, "running_classes.json");
process.env.ALLOWED_LOCAL_DIRS = tmpDir;

async function main() {
  console.log("==========================================================");
  console.log("🚀 RUNNING v3.4.0 STAGE S4 STREAMLINE TEST SUITE");
  console.log("==========================================================");

  const {
    getDb,
    studentRepo,
    session14EvalRepo,
    reportCardRepo,
    scoreMatrixRepo,
  } = await import("../src/lib/db/sqlite");
  const {
    computeClassReportCard,
    formatScore2,
    normalizeScoreToScale5,
    round2,
  } = await import("../src/lib/report-card/report-card-calculator");
  const {
    formatCellForExport,
    sanitizeSpreadsheetCell,
  } = await import("../src/lib/report-card/export-cell-formatter");
  const exportRouteFormatCell = formatCellForExport;
  const exportRouteSanitizeCell = sanitizeSpreadsheetCell;
  const { GET: exportGET } = await import("../src/app/api/homework-grader/export/route");
  const { GET: scoresGET } = await import("../src/app/api/homework-grader/scores/route");
  const {
    GET: reportCardGET,
    POST: reportCardPOST,
    PUT: reportCardPUT,
  } = await import("../src/app/api/report-card/route");
  const { computeReportCardStaleness } = await import(
    "../src/lib/report-card/report-card-staleness"
  );
  const { ScoreScraper } = await import("../src/lib/playwright/scrape-scores");

  function makeLocalReq(urlPath: string, init?: RequestInit): any {
    return new Request(`http://127.0.0.1:3000${urlPath}`, {
      ...init,
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        "content-type": "application/json",
        ...(init?.headers || {}),
      },
    });
  }

  function makeSnapshotFixture(
    classId: string,
    scrapedAt: string,
    opts?: { missingCp2?: boolean; finalProjectScore?: number | null }
  ) {
    return {
      classId,
      classCode: classId,
      isRobotics: false,
      scrapedAt,
      btvnSessions: [
        {
          sessionNumber: 1,
          lessonTitle: "Buổi 1",
          hasPractice: true,
          practiceColumnCount: 1,
          hasQuiz: true,
        },
      ],
      students: [
        {
          studentId: `${classId}_STU_01`,
          lmsStudentUid: "UID_01",
          fullName: "Nguyễn Văn An",
          btvnSessions: [
            {
              sessionNumber: 1,
              lessonTitle: "Buổi 1",
              hasPractice: true,
              practiceColumnCount: 1,
              hasQuiz: true,
              practiceSubmissions: [
                {
                  columnId: "S1_P1",
                  title: "Thực hành 1",
                  status: "GRADED" as const,
                  score: 90,
                  maxScore: 100,
                },
              ],
              practiceScoreRaw: 90,
              practiceSubmitted: true,
              quizScoreRaw: 100,
              quizMaxScore: 100,
              quizSubmitted: true,
            },
          ],
          stageScores: {
            cp1Theory: 4.5,
            cp1TheoryRaw: 90,
            cp1TheoryMax: 100,
            cp1Practice: 4.0,
            cp1PracticeRaw: 8,
            cp1PracticeMax: 10,
            cp2Theory: opts?.missingCp2 ? null : 4.5,
            cp2TheoryRaw: opts?.missingCp2 ? null : 90,
            cp2TheoryMax: 100,
            cp2Practice: opts?.missingCp2 ? null : 4.5,
            cp2PracticeRaw: opts?.missingCp2 ? null : 9,
            cp2PracticeMax: 10,
            finalProduct:
              opts?.finalProjectScore !== undefined ? opts.finalProjectScore : 4.5,
            finalCompetency: 4.5,
            finalPresentation: 4.5,
            finalPresentationRaw: 4.5,
            finalPresentationMax: 5,
            finalProject:
              opts?.finalProjectScore !== undefined ? opts.finalProjectScore : 4.5,
            finalProjectRaw:
              opts?.finalProjectScore !== undefined ? opts.finalProjectScore : 4.5,
            finalProjectMax: 5,
          },
        },
      ],
    };
  }

  // Helper to mount TeachingReportCardView in a lightweight VM harness
  function createReportCardViewHarness(
    fetchImpl: (url: string, options?: any) => Promise<any>,
    initialProps: Record<string, any> = {}
  ) {
    let src = fs.readFileSync(
      path.join(process.cwd(), "src/components/teaching-report-card-view.tsx"),
      "utf8"
    );
    const exposed = [
      "record",
      "snapshot",
      "staleness",
      "computedReportCard",
      "isClassMatched",
      "isLoading",
      "isApproving",
      "isSyncingTeaching",
      "isScrapingLms",
      "errorMsg",
      "toastMsg",
      "loadReportCard",
      "handleScrapeFromLms",
      "handleApproveReportCard",
      "handleSyncToTeaching",
      "handleApproveAndSyncTeaching",
    ];
    const marker = '\n  return (\n    <div className="space-y-5">';
    src = src.replace(marker, `\nglobalThis.api = {${exposed.join(",")}};${marker}`);
    src = src
      .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
      .replace(/\bexport\s+default\s+/g, "")
      .replace(/\bexport\s+/g, "");

    const js = transformSync(src, {
      loader: "tsx",
      target: "es2022",
      jsx: "transform",
    }).code;

    const slots: any[] = [];
    const depsArr: any[] = [];
    const memoVals: any[] = [];
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
          pending.push(fn);
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

    const IconStub = (props: any) => ({ type: "icon", props });
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
      RefreshCw: IconStub,
      CheckCircle2: IconStub,
      AlertTriangle: IconStub,
      Send: IconStub,
      SlidersHorizontal: IconStub,
      Calculator: IconStub,
      BarChart3: IconStub,
      Edit3: IconStub,
      RotateCcw: IconStub,
      X: IconStub,
      Check: IconStub,
      Copy: IconStub,
      Download: IconStub,
      Info: IconStub,
      Award: IconStub,
      BookOpen: IconStub,
      Layers: IconStub,
      ShieldCheck: IconStub,
      Sparkles: IconStub,
      React: {
        ...hooks,
        Fragment: "fragment",
        createElement(type: any, p: any, ...children: any[]) {
          return { type, props: { ...(p || {}), children } };
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

    vm.runInContext(js + "\nglobalThis.render = TeachingReportCardView;", ctx);
    let currentProps = { classId: "VT-C4K-S4A", classCode: "VT-C4K-S4A", ...initialProps };

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

    const collectText = (node: any): string => {
      if (node == null || typeof node === "boolean") return "";
      if (typeof node === "string" || typeof node === "number") return String(node);
      if (Array.isArray(node)) return node.map(collectText).join(" ");
      if (typeof node === "object" && node.props) {
        return collectText(node.props.children);
      }
      return "";
    };

    return {
      get api() {
        return ctx.api;
      },
      get treeText() {
        return collectText(tree);
      },
      flush,
      setProps(next: Record<string, any>) {
        currentProps = { ...currentProps, ...next };
        dirty = true;
      },
    };
  }

  // =========================================================================
  // [S4-T1] 1-click "Duyệt & Đồng bộ Teaching" + 409 Conflict Guard
  // =========================================================================
  console.log("[S4-T1] Testing 1-click Approve & Sync Teaching + 409 conflict guard...");
  {
    const classId = "VT-C4K-S4A";
    const snap = makeSnapshotFixture(classId, "2026-10-30T08:00:00.000Z");
    reportCardRepo.saveLmsSnapshot(classId, snap as any);

    // Verify backend approve route deduplication (POST and PUT both enforce expectedVersion)
    const conflictPostRes = await reportCardPOST(
      makeLocalReq("/api/report-card", {
        method: "POST",
        body: JSON.stringify({
          action: "approve",
          classId,
          expectedVersion: 999,
        }),
      })
    );
    assert.equal(conflictPostRes.status, 409, "POST approve with wrong version must return 409");

    const conflictPutRes = await reportCardPUT(
      makeLocalReq("/api/report-card", {
        method: "PUT",
        body: JSON.stringify({
          action: "approve",
          classId,
          expectedVersion: 999,
        }),
      })
    );
    assert.equal(conflictPutRes.status, 409, "PUT approve with wrong version must return 409");

    // Mount TeachingReportCardView and test 1-click handleApproveAndSyncTeaching happy path
    const callOrder: string[] = [];
    const initialGetRes = await reportCardGET(
      makeLocalReq(`/api/report-card?classId=${classId}`)
    );
    const initialPayload = await initialGetRes.json();
    assert.equal(initialPayload.success, true);
    assert.equal(initialPayload.record.status, "DRAFT");

    const h = createReportCardViewHarness(async (url: string, options?: any) => {
      if (!options?.method || options.method === "GET") {
        callOrder.push("GET");
        return {
          ok: true,
          status: 200,
          json: async () => initialPayload,
        };
      }
      if (String(url).includes("/api/report-card/sync-teaching")) {
        callOrder.push("SYNC_TEACHING");
        const body = JSON.parse(options.body);
        assert.equal(
          body.expectedVersion,
          initialPayload.record.draftVersion,
          "Sync must pass the approved version"
        );
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ...initialPayload,
            record: {
              ...initialPayload.record,
              status: "VERIFIED",
              contentHash: "abc1234567890def",
              verifiedAt: "2026-10-30T08:05:00.000Z",
            },
            syncResult: {
              verifiedStudents: 1,
              totalStudents: 1,
            },
          }),
        };
      }
      callOrder.push("APPROVE");
      const body = JSON.parse(options.body);
      assert.equal(body.action, "approve");
      assert.equal(body.expectedVersion, initialPayload.record.draftVersion);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ...initialPayload,
          record: {
            ...initialPayload.record,
            status: "APPROVED",
            contentHash: "abc1234567890def",
          },
        }),
      };
    });

    await h.flush();
    assert.deepEqual(callOrder, ["GET"]);
    assert.ok(
      h.treeText.includes("Duyệt &") && h.treeText.includes("Đồng bộ Teaching"),
      "Primary 1-click CTA 'Duyệt & Đồng bộ Teaching' must be rendered"
    );
    assert.ok(
      h.treeText.includes("Chỉ duyệt"),
      "Secondary 'Chỉ duyệt' button must be rendered"
    );

    await h.api.handleApproveAndSyncTeaching();
    await h.flush();

    assert.deepEqual(
      callOrder,
      ["GET", "APPROVE", "SYNC_TEACHING"],
      "handleApproveAndSyncTeaching must run APPROVE then SYNC_TEACHING in 1 click"
    );
    assert.equal(h.api.record.status, "VERIFIED");
    assert.ok(
      h.api.toastMsg?.includes("Đã duyệt (SHA-256) & đồng bộ Read-after-Write thành công"),
      "Must display combined approve+sync success toast"
    );

    // Now test 409 version conflict on approve: MUST NOT call sync-teaching
    const conflictCallOrder: string[] = [];
    const hConflict = createReportCardViewHarness(async (url: string, options?: any) => {
      if (!options?.method || options.method === "GET") {
        conflictCallOrder.push("GET");
        return {
          ok: true,
          status: 200,
          json: async () => initialPayload,
        };
      }
      if (String(url).includes("/api/report-card/sync-teaching")) {
        conflictCallOrder.push("SYNC_TEACHING");
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        };
      }
      conflictCallOrder.push("APPROVE_409");
      return {
        ok: false,
        status: 409,
        json: async () => ({
          ...initialPayload,
          success: false,
          conflict: true,
          error: "Xung đột phiên bản (409): Dữ liệu phiếu điểm đã thay đổi.",
          record: {
            ...initialPayload.record,
            draftVersion: initialPayload.record.draftVersion + 1,
          },
        }),
      };
    });

    await hConflict.flush();
    await hConflict.api.handleApproveAndSyncTeaching();
    await hConflict.flush();

    assert.deepEqual(
      conflictCallOrder,
      ["GET", "APPROVE_409"],
      "When approve returns 409, sync-teaching MUST NOT be called"
    );
    assert.ok(
      hConflict.api.errorMsg?.includes("409"),
      "Must display 409 conflict error message"
    );
  }
  console.log("✅ [S4-T1] PASSED!");

  // =========================================================================
  // [S4-T2] Staleness Detection (Session 14 newer updatedAt & missing CP scores)
  // =========================================================================
  console.log("[S4-T2] Testing staleness detection (Session 14 updatedAt & missing CP)...");
  {
    const classId = "VT-C4K-S4B";
    studentRepo.upsert({
      studentId: `${classId}_STU_01`,
      classId,
      fullName: "Nguyễn Văn An",
      isActive: 1,
    });

    // Case A: Fresh snapshot with complete CP1 & CP2 and no newer Session 14 evaluation
    const snapFresh = makeSnapshotFixture(classId, "2026-10-30T08:00:00.000Z");
    reportCardRepo.saveLmsSnapshot(classId, snapFresh as any);

    const resA = await reportCardGET(makeLocalReq(`/api/report-card?classId=${classId}`));
    const jsonA = await resA.json();
    assert.equal(jsonA.staleness.isStale, false, "Case A: Fresh complete snapshot must not be stale");
    assert.equal(jsonA.staleness.hasNewerSession14, false);
    assert.equal(jsonA.staleness.missingCheckpointScores, false);

    // Case B: Session 14 evaluation updated AFTER snapshot.scrapedAt
    session14EvalRepo.saveDraft({
      classId,
      studentId: `${classId}_STU_01`,
      teacherNote: "Bài làm tốt",
      learnedFromMindx: "Con nắm vững kiến thức",
    });
    // Force updatedAt to be newer than scrapedAt (2026-10-30T09:30:00.000Z > 08:00:00.000Z)
    getDb()
      .prepare(
        "UPDATE spck_session14_evaluations SET updatedAt = ? WHERE classId = ? AND studentId = ?"
      )
      .run("2026-10-30T09:30:00.000Z", classId, `${classId}_STU_01`);

    const resB = await reportCardGET(makeLocalReq(`/api/report-card?classId=${classId}`));
    const jsonB = await resB.json();
    assert.equal(jsonB.staleness.isStale, true, "Case B: Newer Session 14 evaluation must mark report card stale");
    assert.equal(jsonB.staleness.hasNewerSession14, true);
    assert.ok(
      jsonB.staleness.reasons.some((r: string) => r.includes("Buổi 14")),
      "Case B: Staleness reasons must mention Buổi 14"
    );

    // Verify TeachingReportCardView renders the amber staleness banner when isStale is true
    const hStale = createReportCardViewHarness(
      async () => ({
        ok: true,
        status: 200,
        json: async () => jsonB,
      }),
      { classId, classCode: classId }
    );
    await hStale.flush();
    assert.equal(hStale.api.staleness?.isStale, true);
    assert.ok(
      hStale.treeText.includes("Có dữ liệu Buổi 14 mới, bấm Quét lại"),
      "UI must display 'Có dữ liệu Buổi 14 mới, bấm Quét lại' banner when stale"
    );

    // Case C: Missing CP2 score
    const snapMissingCp2 = makeSnapshotFixture(classId, "2026-10-30T10:00:00.000Z", {
      missingCp2: true,
    });
    (snapMissingCp2.students[0].stageScores as any).finalProduct = 0;
    (snapMissingCp2.students[0].stageScores as any).finalCompetency = 4;
    reportCardRepo.saveLmsSnapshot(classId, snapMissingCp2 as any);
    const resC = await reportCardGET(makeLocalReq(`/api/report-card?classId=${classId}`));
    const jsonC = await resC.json();
    assert.equal(jsonC.staleness.isStale, true, "Case C: Missing CP2 must mark report card stale");
    assert.equal(jsonC.staleness.missingCheckpointScores, true);
    assert.equal(jsonC.staleness.missingCp2, true);
    assert.equal(jsonC.staleness.hasNewerSession14, false);

    // Case D: Re-scrape at 10:30:00.000Z with complete CP1/CP2 & Session 14 clears staleness
    const snapRescraped = makeSnapshotFixture(classId, "2026-10-30T10:30:00.000Z", {
      missingCp2: false,
      finalProjectScore: 0,
    });
    (snapRescraped.students[0].stageScores as any).finalProduct = 0;
    (snapRescraped.students[0].stageScores as any).finalCompetency = 4;
    reportCardRepo.saveLmsSnapshot(classId, snapRescraped as any);
    const resD = await reportCardGET(makeLocalReq(`/api/report-card?classId=${classId}`));
    const jsonD = await resD.json();
    assert.equal(jsonD.staleness.isStale, false, "Case D: Re-scraping newer than Session 14 with full CP clears staleness");

    const hFresh = createReportCardViewHarness(
      async () => ({
        ok: true,
        status: 200,
        json: async () => jsonD,
      }),
      { classId, classCode: classId }
    );
    await hFresh.flush();
    assert.equal(hFresh.api.staleness?.isStale, false);
    assert.equal(
      hFresh.treeText.includes("Có dữ liệu Buổi 14 mới, bấm Quét lại"),
      false,
      "Staleness banner must disappear once report card is fresh"
    );

    // Case E (v3.8.9+): Session-aware CP1/CP2 staleness & Dashboard Todo Cards
    const { getDashboardTodayTodoCards } = await import("../src/lib/dashboard/today-tasks");
    const runSessionAwareScenario = async (params: {
      cid: string;
      className: string;
      isRobotics: boolean;
      cp1Session: number;
      cp2Session: number;
    }) => {
      const { cid, className, isRobotics, cp1Session, cp2Session } = params;
      const stuId = `${cid}_STU_01`;
      studentRepo.upsert({
        studentId: stuId,
        classId: cid,
        fullName: "Học Viên Kiểm Thử",
        isActive: 1,
      });

      const db = getDb();
      const upsertSess = db.prepare(
        `INSERT INTO classes_sessions (classId, className, sessionId, sessionNumber, date)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(classId, sessionId) DO UPDATE SET date = excluded.date`
      );
      for (let n = 1; n <= 14; n++) {
        const sid = `${cid}_SESS_${String(n).padStart(2, "0")}`;
        // Sessions <= 3 in past, future sessions initially in 2099
        const dateStr = n <= 3 ? `0${n}/10/2026` : `01/01/2099`;
        upsertSess.run(cid, className, sid, n, dateStr);
      }
      const markFeedbackVerified = (sessNum: number) => {
        const sid = `${cid}_SESS_${String(sessNum).padStart(2, "0")}`;
        db.prepare(
          `INSERT INTO session_feedbacks (classId, sessionId, studentId, status, attendanceStatus, finalText)
           VALUES (?, ?, ?, 'VERIFIED', 'PRESENT', 'Nhận xét kiểm thử')
           ON CONFLICT(classId, sessionId, studentId) DO UPDATE SET status = 'VERIFIED', attendanceStatus = 'PRESENT'`
        ).run(cid, sid, stuId);
      };
      const baseSnapshot = (optsSnap: {
        hasCp1: boolean;
        hasCp2: boolean;
      }) => ({
        classId: cid,
        classCode: cid,
        isRobotics,
        scrapedAt: "2026-11-25T05:00:00.000Z",
        btvnSessions: [],
        students: [
          {
            studentId: stuId,
            lmsStudentUid: `${stuId}_UID`,
            fullName: "Học Viên Kiểm Thử",
            isActive: true,
            btvnSessions: [],
            stageScores: {
              cp1Theory: optsSnap.hasCp1 ? 4.0 : null,
              cp1Practice: optsSnap.hasCp1 ? 3.5 : null,
              cp1Competency: optsSnap.hasCp1 ? 4.0 : null,
              cp2Theory: optsSnap.hasCp2 ? 4.5 : null,
              cp2Practice: optsSnap.hasCp2 ? 4.0 : null,
              cp2Competency: optsSnap.hasCp2 ? 4.2 : null,
              finalProduct: null,
              finalCompetency: null,
            },
          },
        ],
      });

      // 1) Session 3 (before CP1): neither CP1 nor CP2 is due -> not stale
      const snapEmpty = baseSnapshot({ hasCp1: false, hasCp2: false });
      reportCardRepo.saveLmsSnapshot(cid, snapEmpty as any);
      const resS3 = await reportCardGET(makeLocalReq(`/api/report-card?classId=${cid}`));
      const jsonS3 = await resS3.json();
      assert.equal(jsonS3.staleness.missingCp1, false, `${cid} Session 3 must not require CP1`);
      assert.equal(jsonS3.staleness.missingCp2, false, `${cid} Session 3 must not require CP2`);
      assert.equal(jsonS3.staleness.isStale, false, `${cid} Session 3 must not be stale`);

      // 2) Advance to CP1 session without CP1 scores -> missingCp1 = true, missingCp2 = false, allDone = false
      for (let n = 4; n <= cp1Session; n++) {
        upsertSess.run(
          cid,
          className,
          `${cid}_SESS_${String(n).padStart(2, "0")}`,
          n,
          `${String(n + 5).padStart(2, "0")}/10/2026`
        );
      }
      markFeedbackVerified(cp1Session);
      fs.writeFileSync(
        process.env.MINDX_RUNNING_CLASSES_PATH!,
        JSON.stringify([{ classCode: cid, courseName: className, status: "Running" }], null, 2),
        "utf8"
      );

      // Even if report card was marked VERIFIED earlier with no CP1 scores, CP1 must still require re-sync
      db.prepare(
        `UPDATE class_report_cards
         SET status = 'VERIFIED', teachingSyncStatus = 'VERIFIED', teachingSyncedAt = '2026-11-25 10:00:00'
         WHERE classId = ?`
      ).run(cid);
      const resCp1Missing = await reportCardGET(makeLocalReq(`/api/report-card?classId=${cid}`));
      const jsonCp1Missing = await resCp1Missing.json();
      assert.equal(jsonCp1Missing.staleness.missingCp1, true, `${cid} at CP1 without CP1 scores must set missingCp1=true`);
      assert.equal(jsonCp1Missing.staleness.missingCp2, false, `${cid} at CP1 must NOT set missingCp2=true`);
      assert.equal(jsonCp1Missing.staleness.isStale, true, `${cid} at CP1 without CP1 scores must be stale`);
      const cardCp1Missing = getDashboardTodayTodoCards({ limit: 24, includeSynthetic: true }).find(
        (c) => c.classId === cid
      )!;
      assert.equal(cardCp1Missing.allDone, false, `${cid} at CP1 without CP1 scores must stay pending on Dashboard`);
      assert.equal(cardCp1Missing.steps[1].isDone, false);

      // 3) Save CP1 scores (CP2 still null) and mark Teaching VERIFIED -> NOT stale, Dashboard Done!
      reportCardRepo.saveLmsSnapshot(cid, baseSnapshot({ hasCp1: true, hasCp2: false }) as any);
      db.prepare(
        `UPDATE class_report_cards
         SET status = 'VERIFIED', teachingSyncStatus = 'VERIFIED', teachingSyncedAt = '2026-11-25 12:26:58'
         WHERE classId = ?`
      ).run(cid);
      const resCp1Done = await reportCardGET(makeLocalReq(`/api/report-card?classId=${cid}`));
      const jsonCp1Done = await resCp1Done.json();
      assert.equal(jsonCp1Done.staleness.missingCp1, false, `${cid} with CP1 scores must set missingCp1=false`);
      assert.equal(jsonCp1Done.staleness.missingCp2, false, `${cid} at CP1 must NOT require CP2`);
      assert.equal(jsonCp1Done.staleness.isStale, false, `${cid} at CP1 with CP1 scores must not be stale`);
      const cardCp1Done = getDashboardTodayTodoCards({ limit: 24, includeSynthetic: true }).find(
        (c) => c.classId === cid
      )!;
      assert.equal(cardCp1Done.isCheckpoint, true);
      assert.equal(cardCp1Done.steps[0].isDone, true);
      assert.equal(cardCp1Done.steps[1].isDone, true, `${cid} at CP1 with VERIFIED CP1 must mark step 2 done`);
      assert.equal(cardCp1Done.allDone, true, `${cid} at CP1 with VERIFIED CP1 must be allDone=true`);

      // Also verify OUT_OF_SYNC still marks step 2 as pending on Dashboard
      db.prepare(
        `UPDATE class_report_cards SET teachingSyncStatus = 'OUT_OF_SYNC' WHERE classId = ?`
      ).run(cid);
      const cardOutOfSync = getDashboardTodayTodoCards({ limit: 24, includeSynthetic: true }).find(
        (c) => c.classId === cid
      )!;
      assert.equal(cardOutOfSync.steps[1].isDone, false, `${cid} OUT_OF_SYNC must block Dashboard step 2`);
      assert.equal(cardOutOfSync.allDone, false);

      // Restore VERIFIED, then advance to CP2 session -> missingCp2 must flip to true and re-open step 2
      db.prepare(
        `UPDATE class_report_cards SET teachingSyncStatus = 'VERIFIED' WHERE classId = ?`
      ).run(cid);
      for (let n = cp1Session + 1; n <= cp2Session; n++) {
        upsertSess.run(
          cid,
          className,
          `${cid}_SESS_${String(n).padStart(2, "0")}`,
          n,
          `${String(n).padStart(2, "0")}/11/2026`
        );
      }
      markFeedbackVerified(cp2Session);
      const resCp2Missing = await reportCardGET(makeLocalReq(`/api/report-card?classId=${cid}`));
      const jsonCp2Missing = await resCp2Missing.json();
      assert.equal(jsonCp2Missing.staleness.missingCp1, false);
      assert.equal(jsonCp2Missing.staleness.missingCp2, true, `${cid} at CP2 without CP2 scores must set missingCp2=true`);
      assert.equal(jsonCp2Missing.staleness.isStale, true);
      const cardCp2Missing = getDashboardTodayTodoCards({ limit: 24, includeSynthetic: true }).find(
        (c) => c.classId === cid
      )!;
      assert.equal(cardCp2Missing.steps[1].isDone, false, `${cid} at CP2 without CP2 scores must flip Dashboard step 2 back to pending`);
      assert.equal(cardCp2Missing.allDone, false);

      // Finally save CP2 scores and mark VERIFIED -> allDone = true again
      reportCardRepo.saveLmsSnapshot(cid, baseSnapshot({ hasCp1: true, hasCp2: true }) as any);
      db.prepare(
        `UPDATE class_report_cards
         SET status = 'VERIFIED', teachingSyncStatus = 'VERIFIED', teachingSyncedAt = '2026-11-25 13:00:00'
         WHERE classId = ?`
      ).run(cid);
      const cardCp2Done = getDashboardTodayTodoCards({ limit: 24, includeSynthetic: true }).find(
        (c) => c.classId === cid
      )!;
      assert.equal(cardCp2Done.allDone, true, `${cid} at CP2 with full CP1+CP2 VERIFIED must be allDone=true`);
    };

    const prevRunningExists = fs.existsSync(process.env.MINDX_RUNNING_CLASSES_PATH!);
    const prevRunningContent = prevRunningExists
      ? fs.readFileSync(process.env.MINDX_RUNNING_CLASSES_PATH!, "utf8")
      : null;
    try {
      await runSessionAwareScenario({
        cid: "VT-CSA04-S4CP",
        className: "Computer Scientist Advance",
        isRobotics: false,
        cp1Session: 5,
        cp2Session: 9,
      });
      await runSessionAwareScenario({
        cid: "VT-ROB-ARMS4",
        className: "Robotics Arm Intensive",
        isRobotics: true,
        cp1Session: 4,
        cp2Session: 8,
      });

      // F01 regressions (Neon XHigh Round 1): Running class without dated classes_sessions
      // must still infer snapshotFloor from CP2 / Final scores in parsedSnapshot
      const f01Cid = "VT-C4K-S4F01";
      const f01StuId = `${f01Cid}_STU_01`;
      studentRepo.upsert({
        studentId: f01StuId,
        classId: f01Cid,
        fullName: "Học Viên F01",
        isActive: 1,
      });
      fs.writeFileSync(
        process.env.MINDX_RUNNING_CLASSES_PATH!,
        JSON.stringify(
          [{ classCode: f01Cid, courseName: "Coding F01", status: "Running" }],
          null,
          2
        ),
        "utf8"
      );

      // PROBE 3b: Running class without classes_sessions, snapshot has CP2 scores but misses CP1 -> missingCp1 = true
      reportCardRepo.saveLmsSnapshot(f01Cid, {
        classId: f01Cid,
        classCode: f01Cid,
        isRobotics: false,
        scrapedAt: "2026-11-25T05:00:00.000Z",
        btvnSessions: [],
        students: [
          {
            studentId: f01StuId,
            fullName: "Học Viên F01",
            isActive: true,
            btvnSessions: [],
            stageScores: {
              cp1Theory: null,
              cp1Practice: null,
              cp1Competency: null,
              cp2Theory: 4.5,
              cp2Practice: 4.0,
              cp2Competency: 4.2,
              finalProduct: null,
              finalCompetency: null,
            },
          },
        ],
      } as any);
      const resF01Cp2 = await reportCardGET(makeLocalReq(`/api/report-card?classId=${f01Cid}`));
      const jsonF01Cp2 = await resF01Cp2.json();
      assert.equal(jsonF01Cp2.staleness.missingCp1, true, "F01 PROBE 3b: snapshot with CP2 but missing CP1 must set missingCp1=true");
      assert.equal(jsonF01Cp2.staleness.missingCp2, false);
      assert.equal(jsonF01Cp2.staleness.isStale, true);

      // PROBE 3b2: Running class without classes_sessions (or undated rows), snapshot has Final scores but misses CP2 -> missingCp2 = true
      const f01Db = getDb();
      for (let n = 1; n <= 10; n++) {
        f01Db
          .prepare(
            `INSERT INTO classes_sessions (classId, className, sessionId, sessionNumber, date)
             VALUES (?, ?, ?, ?, '')
             ON CONFLICT(classId, sessionId) DO UPDATE SET date = ''`
          )
          .run(f01Cid, "Coding F01", `${f01Cid}_SESS_${String(n).padStart(2, "0")}`, n);
      }
      reportCardRepo.saveLmsSnapshot(f01Cid, {
        classId: f01Cid,
        classCode: f01Cid,
        isRobotics: false,
        scrapedAt: "2026-11-25T05:00:00.000Z",
        btvnSessions: [],
        students: [
          {
            studentId: f01StuId,
            fullName: "Học Viên F01",
            isActive: true,
            btvnSessions: [],
            stageScores: {
              cp1Theory: 4.0,
              cp1Practice: 4.0,
              cp1Competency: 4.0,
              cp2Theory: null,
              cp2Practice: null,
              cp2Competency: null,
              finalProduct: 4.5,
              finalCompetency: 4.2,
            },
          },
        ],
      } as any);
      const resF01Final = await reportCardGET(makeLocalReq(`/api/report-card?classId=${f01Cid}`));
      const jsonF01Final = await resF01Final.json();
      assert.equal(jsonF01Final.staleness.missingCp1, false);
      assert.equal(jsonF01Final.staleness.missingCp2, true, "F01 PROBE 3b2/3c: undated Running class with Final scores must set missingCp2=true");
      assert.equal(jsonF01Final.staleness.isStale, true);
    } finally {
      if (prevRunningExists && prevRunningContent !== null) {
        fs.writeFileSync(process.env.MINDX_RUNNING_CLASSES_PATH!, prevRunningContent, "utf8");
      } else if (fs.existsSync(process.env.MINDX_RUNNING_CLASSES_PATH!)) {
        fs.unlinkSync(process.env.MINDX_RUNNING_CLASSES_PATH!);
      }
    }
  }
  console.log("✅ [S4-T2] PASSED!");

  // =========================================================================
  // [S4-T3] Unified Cell Formatter (Excel/CSV Export vs Google Sheets TSV)
  // =========================================================================
  console.log("[S4-T3] Testing unified formatCellForExport across Excel/CSV and TSV...");
  {
    const sampleCells = [
      { status: "GRADED" as const, score: 95, quizScore: 80 },
      { status: "GRADED" as const, score: 0, quizScore: 100 },
      { status: "SUBMITTED_UNGRADED" as const, score: null, quizScore: 70 },
      { status: "REDO_REQUESTED" as const, score: null, quizScore: 60 },
      { status: "NOT_SUBMITTED" as const, score: null, quizScore: null },
      undefined,
    ];
    for (const mode of ["both", "practice", "quiz"] as const) {
      for (const cell of sampleCells) {
        assert.equal(
          exportRouteFormatCell(cell as any, mode),
          formatCellForExport(cell as any, mode),
          `export/route.ts and export-cell-formatter.ts must match for mode=${mode}`
        );
      }
    }
    assert.equal(exportRouteSanitizeCell("=SUM(A1:A2)"), sanitizeSpreadsheetCell("=SUM(A1:A2)"));

    // Verify export route produces valid CSV with unified formatter
    const classId = "VT-C4K-S4C";
    scoreMatrixRepo.save(classId, {
      success: true,
      classId,
      classCode: classId,
      columns: [
        { colIndex: 0, columnId: "C1", title: "Buổi 1", sessionNumber: 1 },
      ],
      rows: [
        {
          studentId: "S1",
          fullName: "Nguyễn Văn An",
          isActive: true,
          cells: {
            C1: {
              columnId: "C1",
              sessionNumber: 1,
              status: "SUBMITTED_UNGRADED",
              score: null,
              quizScore: 85,
              maxScore: 100,
              rawText: "Chưa chấm",
            },
          },
          averageScore: null,
          averageQuizScore: 85,
          gradedCount: 0,
          submittedUngradedCount: 1,
          notSubmittedCount: 0,
          redoCount: 0,
        },
      ],
      summary: {
        totalStudents: 1,
        totalColumns: 1,
        gradedCells: 0,
        submittedUngradedCells: 1,
        notSubmittedCells: 0,
        redoCells: 0,
        zeroScoreCells: 0,
      },
      scrapedAt: "2026-10-30T08:00:00.000Z",
    });

    const csvRes = await exportGET(
      makeLocalReq(`/api/homework-grader/export?classId=${classId}&format=csv&mode=both`)
    );
    assert.equal(csvRes.status, 200);
    const csvText = await csvRes.text();
    assert.ok(
      csvText.includes("Chưa chấm (Quiz: 85)"),
      "CSV export must format SUBMITTED_UNGRADED + Quiz using unified formatter"
    );
  }
  console.log("✅ [S4-T3] PASSED!");

  // =========================================================================
  // [S4-T4] Screen 2 Streamlining, Single-Load on Mount & Dead-Code Cleanup
  // =========================================================================
  console.log("[S4-T4] Testing Screen 2 UI streamlining, single-load on mount & cleanup...");
  {
    const hwPageSrc = fs.readFileSync(
      path.join(process.cwd(), "src/app/homework-grader/page.tsx"),
      "utf8"
    );
    const rcViewSrc = fs.readFileSync(
      path.join(process.cwd(), "src/components/teaching-report-card-view.tsx"),
      "utf8"
    );

    assert.equal(
      hwPageSrc.includes("formatCellForTsv"),
      false,
      "Duplicate formatCellForTsv must be removed from homework-grader/page.tsx"
    );
    assert.equal(
      hwPageSrc.includes("Cào dữ liệu điểm mới nhất"),
      false,
      "Duplicate green scrape button in Hero header must be removed"
    );
    assert.equal(
      hwPageSrc.includes("Boolean(0)"),
      false,
      "Dead Boolean(0) block must be removed from homework-grader/page.tsx"
    );
    assert.equal(
      rcViewSrc.includes("{false &&"),
      false,
      "All {false && ...} dead blocks must be removed from teaching-report-card-view.tsx"
    );
    assert.ok(
      hwPageSrc.includes('scrapeTrigger=""'),
      "HomeworkGraderPage must pass scrapeTrigger=\"\" so initial cache load does not double-load report card"
    );
    assert.ok(
      hwPageSrc.includes("showSubmissionDetails"),
      "HomeworkGraderPage must render collapsible submission details section"
    );

    // Verify GET /api/homework-grader/scores does not return unused sessions/students/rubrics
    const scoresRes = await scoresGET(
      makeLocalReq("/api/homework-grader/scores?classId=VT-C4K-S4C")
    );
    const scoresJson = await scoresRes.json();
    assert.equal(scoresJson.success, true);
    assert.equal("sessions" in scoresJson.data, false, "Unused sessions must be removed from GET /scores");
    assert.equal("students" in scoresJson.data, false, "Unused students must be removed from GET /scores");
    assert.equal("rubrics" in scoresJson.data, false, "Unused rubrics must be removed from GET /scores");
  }
  console.log("✅ [S4-T4] PASSED!");

  // =========================================================================
  // [S4-T5] Codex S4 Round 1 Regressions (S4-01, S4-02, S4-03)
  // =========================================================================
  console.log("[S4-T5] Testing Codex S4 Round 1 regressions (S4-01, S4-02, S4-03)...");
  {
    const classId = "VT-C4K-S4R1";
    const stuId = `${classId}_STU_01`;
    studentRepo.upsert({
      studentId: stuId,
      classId,
      fullName: "Nguyễn Văn An",
      isActive: 1,
    });

    // 1. Default untouched DRAFT row from getOrInit must NOT mark report card stale
    session14EvalRepo.getOrInit(classId, stuId);
    getDb()
      .prepare("UPDATE spck_session14_evaluations SET updatedAt = ? WHERE classId = ? AND studentId = ?")
      .run("2026-10-30T09:00:00.000Z", classId, stuId);
    const snapBase = makeSnapshotFixture(classId, "2026-10-30T08:00:00.500Z", {
      finalProjectScore: 4,
    });
    (snapBase.students[0].stageScores as any).finalProduct = 4;
    (snapBase.students[0].stageScores as any).finalCompetency = 4;
    assert.equal(
      computeReportCardStaleness(classId, snapBase as any).isStale,
      false,
      "Untouched default DRAFT row from getOrInit must NOT mark snapshot stale"
    );

    const setS14Row = (demo: number, comp: number, updatedAt: string, status = "APPROVED") => {
      getDb()
        .prepare(
          "UPDATE spck_session14_evaluations SET demoTotalScore = ?, competencyTotalScore = ?, updatedAt = ?, status = ? WHERE classId = ? AND studentId = ?"
        )
        .run(demo, comp, updatedAt, status, classId, stuId);
    };

    // 2. S4-01: Overlapping scrape (read Demo=4 at 08:00:00Z, edited to Demo=5 at 08:00:30Z, scrape finished at 08:01:00Z with Demo=4)
    setS14Row(5, 4, "2026-10-30T08:00:30.000Z", "APPROVED");
    const snapOverlapping = makeSnapshotFixture(classId, "2026-10-30T08:01:00.000Z", {
      finalProjectScore: 4,
    });
    (snapOverlapping.students[0].stageScores as any).finalProduct = 4;
    (snapOverlapping.students[0].stageScores as any).finalCompetency = 4;
    const staleOverlap = computeReportCardStaleness(classId, snapOverlapping as any);
    assert.equal(staleOverlap.isStale, true, "S4-01: Edit during overlapping scrape must mark report card stale");
    assert.equal(staleOverlap.hasNewerSession14, true);

    // Once re-scraped at 08:02:00Z with Demo=5, staleness must clear
    const snapAfterRescrape = makeSnapshotFixture(classId, "2026-10-30T08:02:00.000Z", {
      finalProjectScore: 5,
    });
    (snapAfterRescrape.students[0].stageScores as any).finalProduct = 5;
    (snapAfterRescrape.students[0].stageScores as any).finalCompetency = 4;
    const freshAfterRescrape = computeReportCardStaleness(classId, snapAfterRescrape as any);
    assert.equal(freshAfterRescrape.isStale, false, "S4-01: Re-scraping with updated Demo=5 clears staleness");

    // 3. S4-02: Same-second transitions (4 -> 0, 0 -> 4, 4 -> 5, and unchanged 4 -> 4) in both ISO and SQLite localtime
    const localTime08 = new Date("2026-10-30T08:00:00Z");
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const sqliteTs08 = `${localTime08.getFullYear()}-${pad2(localTime08.getMonth() + 1)}-${pad2(
      localTime08.getDate()
    )} ${pad2(localTime08.getHours())}:${pad2(localTime08.getMinutes())}:${pad2(
      localTime08.getSeconds()
    )}`;

    for (const ts of ["2026-10-30T08:00:00.000Z", sqliteTs08]) {
      // 4 -> 0
      setS14Row(0, 4, ts, "APPROVED");
      const s4to0 = computeReportCardStaleness(classId, snapBase as any);
      assert.equal(s4to0.isStale, true, `S4-02: Same-second 4 -> 0 (${ts}) must be detected as stale`);
      assert.equal(s4to0.hasNewerSession14, true);

      // 4 -> 5
      setS14Row(5, 4, ts, "APPROVED");
      const s4to5 = computeReportCardStaleness(classId, snapBase as any);
      assert.equal(s4to5.isStale, true, `S4-02: Same-second 4 -> 5 (${ts}) must be detected as stale`);

      // 4 -> 4 (unchanged)
      setS14Row(4, 4, ts, "APPROVED");
      const s4to4 = computeReportCardStaleness(classId, snapBase as any);
      assert.equal(s4to4.isStale, false, `S4-02: Same-second unchanged 4 -> 4 (${ts}) must not be stale`);

      // 0 -> 4
      const snapZero = structuredClone(snapBase);
      (snapZero.students[0].stageScores as any).finalProduct = 0;
      setS14Row(4, 4, ts, "APPROVED");
      const s0to4 = computeReportCardStaleness(classId, snapZero as any);
      assert.equal(s0to4.isStale, true, `S4-02: Same-second 0 -> 4 (${ts}) must be detected as stale`);
    }

    // 4. S4-03: Banner title reflects exact staleness cause (only Session 14, only missing CP, and both)
    reportCardRepo.saveLmsSnapshot(classId, snapBase as any);
    setS14Row(4, 4, "2026-10-30T08:00:00.000Z", "APPROVED");
    const baseGet = await (await reportCardGET(makeLocalReq(`/api/report-card?classId=${classId}`))).json();

    // Case S4-03a: Only missing CP
    const payloadOnlyCp = structuredClone(baseGet);
    payloadOnlyCp.staleness = {
      isStale: true,
      hasNewerSession14: false,
      missingCheckpointScores: true,
      missingCp1: false,
      missingCp2: true,
      latestSession14UpdatedAt: null,
      scrapedAt: snapBase.scrapedAt,
      reasons: ["Chưa có điểm Check-point 2 trên bản quét hiện tại"],
    };
    const hOnlyCp = createReportCardViewHarness(
      async () => ({ ok: true, status: 200, json: async () => payloadOnlyCp }),
      { classId, classCode: classId }
    );
    await hOnlyCp.flush();
    assert.ok(
      hOnlyCp.treeText.includes("Bản quét hiện tại chưa có đủ điểm Check-point, bấm Quét lại"),
      "S4-03: Missing CP-only banner must state missing Check-point"
    );
    assert.equal(
      hOnlyCp.treeText.includes("Có dữ liệu Buổi 14 mới"),
      false,
      "S4-03: Missing CP-only banner must NOT claim newer Session 14 data"
    );

    // Case S4-03b: Both newer Session 14 AND missing CP
    const payloadBoth = structuredClone(baseGet);
    payloadBoth.staleness = {
      isStale: true,
      hasNewerSession14: true,
      missingCheckpointScores: true,
      missingCp1: false,
      missingCp2: true,
      latestSession14UpdatedAt: "2026-10-30T09:00:00.000Z",
      scrapedAt: snapBase.scrapedAt,
      reasons: [
        "Có dữ liệu Buổi 14 mới, bấm Quét lại",
        "Chưa có điểm Check-point 2 trên bản quét hiện tại",
      ],
    };
    const hBoth = createReportCardViewHarness(
      async () => ({ ok: true, status: 200, json: async () => payloadBoth }),
      { classId, classCode: classId }
    );
    await hBoth.flush();
    assert.ok(
      hBoth.treeText.includes("Có dữ liệu Buổi 14 mới và thiếu điểm Check-point, bấm Quét lại"),
      "S4-03: Combined staleness banner must mention both Session 14 and Check-point"
    );

    // 5. S4-R2-01, S4-R2-02, S4-R2-03: ScoreScraper <-> computeReportCardStaleness identity & status parity
    const dupClassId = "VT-C4K-S4R2-DUP";
    const slugId = `STU_${dupClassId}_nguy_n_v_n_an`;
    studentRepo.upsert({
      studentId: `${dupClassId}_A`,
      classId: dupClassId,
      fullName: "Nguyễn Văn An",
      lmsStudentUid: "UID_A",
      isActive: 1,
    } as any);
    studentRepo.upsert({
      studentId: slugId,
      classId: dupClassId,
      fullName: "Nguyễn Văn An",
      lmsStudentUid: "",
      isActive: 1,
    } as any);
    session14EvalRepo.getOrInit(dupClassId, "UID_A");
    session14EvalRepo.getOrInit(dupClassId, slugId);
    getDb()
      .prepare(
        "UPDATE spck_session14_evaluations SET demoTotalScore = ?, competencyTotalScore = ?, status = ?, updatedAt = ? WHERE classId = ? AND studentId = ?"
      )
      .run(4.5, 4.0, "APPROVED", "2026-10-30T08:00:00.000Z", dupClassId, "UID_A");
    getDb()
      .prepare(
        "UPDATE spck_session14_evaluations SET demoTotalScore = ?, competencyTotalScore = ?, status = ?, updatedAt = ? WHERE classId = ? AND studentId = ?"
      )
      .run(2.5, 3.0, "APPROVED", "2026-10-30T08:00:00.000Z", dupClassId, slugId);

    const dupScrapedSnap = ScoreScraper.extractReportCardSnapshotFromGql({
      classId: dupClassId,
      classCode: dupClassId,
      scrapedAt: "2026-10-30T08:01:00.000Z",
      existingStudents: studentRepo.findByClass(dupClassId, false),
      session14Evals: session14EvalRepo.findByClass(dupClassId),
      fallbackMatrix: {
        columns: [],
        rows: [
          {
            studentId: `${dupClassId}_A`,
            studentUid: "UID_A",
            fullName: "Nguyễn Văn An",
            isActive: true,
            cells: {},
            averageScore: 4,
            averageQuizScore: 4,
            gradedCount: 1,
            submittedUngradedCount: 0,
            notSubmittedCount: 0,
            redoCount: 0,
          },
          {
            studentId: slugId,
            studentUid: "",
            fullName: "Nguyễn Văn An",
            isActive: true,
            cells: {},
            averageScore: 4,
            averageQuizScore: 4,
            gradedCount: 1,
            submittedUngradedCount: 0,
            notSubmittedCount: 0,
            redoCount: 0,
          },
        ],
      },
    });
    for (const s of dupScrapedSnap.students) {
      s.stageScores.cp1Theory = 4;
      s.stageScores.cp1Practice = 4;
      s.stageScores.cp2Theory = 4;
      s.stageScores.cp2Practice = 4;
    }
    assert.equal(
      computeReportCardStaleness(dupClassId, dupScrapedSnap).isStale,
      false,
      "S4-R2-01: Duplicate student names with distinct evaluations must NOT stay permanently stale after re-scrape"
    );

    // S4-R2-02: WAITING_APPROVAL with default 0/0 and empty learnedFromMindx
    const waitClassId = "VT-C4K-S4R2-WAIT";
    studentRepo.upsert({
      studentId: `${waitClassId}_A`,
      classId: waitClassId,
      fullName: "Nguyễn Văn An",
      lmsStudentUid: "UID_WAIT",
      isActive: 1,
    } as any);
    session14EvalRepo.getOrInit(waitClassId, `${waitClassId}_A`);
    getDb()
      .prepare(
        "UPDATE spck_session14_evaluations SET demoTotalScore = 0, competencyTotalScore = 0, learnedFromMindx = '', status = 'WAITING_APPROVAL', updatedAt = '2026-10-30T08:00:00.000Z' WHERE classId = ? AND studentId = ?"
      )
      .run(waitClassId, `${waitClassId}_A`);
    const waitSnap = makeSnapshotFixture(waitClassId, "2026-10-30T08:01:00.000Z");
    waitSnap.students[0].studentId = `${waitClassId}_A`;
    (waitSnap.students[0] as any).studentUid = "UID_WAIT";
    assert.equal(
      computeReportCardStaleness(waitClassId, waitSnap as any).isStale,
      false,
      "S4-R2-02: WAITING_APPROVAL with default 0/0 and empty learnedFromMindx must match ScoreScraper hasEvaluatedS14"
    );

    // S4-R2-03: CRM-keyed Session 14 evaluation matched via preserved crmStudentId
    const crmClassId = "VT-C4K-S4R2-CRM";
    studentRepo.upsert({
      studentId: `${crmClassId}_CANON`,
      classId: crmClassId,
      fullName: "Nguyễn Văn An",
      lmsStudentUid: "UID_CRM",
      isActive: 1,
    } as any);
    session14EvalRepo.getOrInit(crmClassId, "CRM_KEY_01");
    getDb()
      .prepare(
        "UPDATE spck_session14_evaluations SET demoTotalScore = 4.5, competencyTotalScore = 4.0, status = 'APPROVED', updatedAt = '2026-10-30T08:00:00.000Z' WHERE classId = ? AND studentId = ?"
      )
      .run(crmClassId, "CRM_KEY_01");
    const crmSnap = ScoreScraper.extractReportCardSnapshotFromGql({
      classId: crmClassId,
      classCode: crmClassId,
      scrapedAt: "2026-10-30T08:01:00.000Z",
      existingStudents: studentRepo.findByClass(crmClassId, false),
      session14Evals: session14EvalRepo.findByClass(crmClassId),
      classByIdGqlData: {
        students: [
          {
            activeInClass: true,
            student: {
              id: "CRM_KEY_01",
              fullName: "Nguyễn Văn An",
            },
          },
        ],
      },
      fallbackMatrix: {
        columns: [],
        rows: [
          {
            studentId: `${crmClassId}_CANON`,
            studentUid: "UID_CRM",
            fullName: "Nguyễn Văn An",
            isActive: true,
            cells: {},
            averageScore: 4,
            averageQuizScore: 4,
            gradedCount: 1,
            submittedUngradedCount: 0,
            notSubmittedCount: 0,
            redoCount: 0,
          },
        ],
      },
    });
    crmSnap.students[0].stageScores.cp1Theory = 4;
    crmSnap.students[0].stageScores.cp1Practice = 4;
    crmSnap.students[0].stageScores.cp2Theory = 4;
    crmSnap.students[0].stageScores.cp2Practice = 4;
    assert.equal(crmSnap.students[0].crmStudentId, "CRM_KEY_01");
    assert.equal(
      computeReportCardStaleness(crmClassId, crmSnap).isStale,
      false,
      "S4-R2-03: CRM-keyed evaluation must match snapshot when fresh"
    );
    getDb()
      .prepare(
        "UPDATE spck_session14_evaluations SET demoTotalScore = 5.0, updatedAt = '2026-10-30T09:00:00.000Z' WHERE classId = ? AND studentId = ?"
      )
      .run(crmClassId, "CRM_KEY_01");
    assert.equal(
      computeReportCardStaleness(crmClassId, crmSnap).isStale,
      true,
      "S4-R2-03: Newer CRM-keyed evaluation must mark snapshot stale"
    );
  }
  console.log("✅ [S4-T5] PASSED!");

  console.log("==========================================================");
  console.log("🎉 ALL v3.4.0 STAGE S4 STREAMLINE TESTS PASSED!");
  console.log("==========================================================");
}

main().catch((err) => {
  console.error("❌ Stage S4 test failed:", err);
  process.exit(1);
});
