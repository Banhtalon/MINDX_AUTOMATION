import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v340-s3-"));
process.env.MINDX_DB_PATH = path.join(tempDir, "mindx_s3_test.db");
process.env.MINDX_RUNNING_CLASSES_PATH = path.join(tempDir, "running_classes_s3.json");
process.env.ALLOWED_LOCAL_DIRS = tempDir;

async function main() {
  console.log("=== KIỂM THỬ GIAI ĐOẠN S3 (v3.4.0): MÀN 1 (/session-comments) 5 -> 3 CLICKS ===");

  const { classSessionRepo, studentRepo, sessionFeedbackRepo, calculateSha256, closeDb } = await import(
    "../src/lib/db/sqlite"
  );
  const { GET: listGET } = await import("../src/app/api/session-comments/list/route");
  const { POST: saveDraftPOST } = await import(
    "../src/app/api/session-comments/save-draft/route"
  );
  const { POST: approvePOST } = await import("../src/app/api/session-comments/approve/route");
  const { POST: saveLmsPOST } = await import("../src/app/api/session-comments/save-lms/route");
  const { CommentSaver } = await import("../src/lib/playwright/save-comments");
  const {
    formatShortZaloName,
    addDaysToDdMmYyyy,
    buildBtvnPart2,
    buildAutoZaloBroadcastText,
  } = await import("../src/lib/zalo/zalo-summary");
  const quickTagHelpers = await import("../src/lib/quick-tags");

  const classId = "VT-C4K-GA38";
  const sess1Id = "VT-C4K-GA38_SESS_01";
  const sess2Id = "VT-C4K-GA38_SESS_02";

  classSessionRepo.upsert({
    classId,
    className: classId,
    sessionId: sess1Id,
    sessionNumber: 1,
    date: "05/04/2026",
    topic: "Làm quen GameMaker",
  });
  classSessionRepo.upsert({
    classId,
    className: classId,
    sessionId: sess2Id,
    sessionNumber: 2,
    date: "12/04/2026",
    topic: "Lập trình di chuyển nhân vật",
  });

  studentRepo.upsert({
    studentId: "STU_01",
    classId,
    fullName: "Nguyễn Thành Phong",
    isActive: 1,
  });
  studentRepo.upsert({
    studentId: "STU_02",
    classId,
    fullName: "Trần Minh Khôi",
    isActive: 1,
  });
  studentRepo.upsert({
    studentId: "STU_03",
    classId,
    fullName: "Lê Hoàng Bách",
    isActive: 1,
  });
  studentRepo.upsert({
    studentId: "STU_04",
    classId,
    fullName: "Phạm Bảo Ngọc",
    isActive: 1,
  });

  // ---------------------------------------------------------------------------
  // 1. S3.1: Batch POST /api/session-comments/save-draft (1 request for whole class)
  // ---------------------------------------------------------------------------
  console.log("1. Kiểm tra S3.1: Batch POST /api/session-comments/save-draft (1 request cho cả lớp)...");
  const batchSaveRes = await saveDraftPOST(
    new Request("http://127.0.0.1:3000/api/session-comments/save-draft", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        classId,
        sessionId: sess2Id,
        items: [
          {
            studentId: "STU_01",
            attendanceStatus: "PRESENT",
            quickTags: ["🌟 Tiếp thu nhanh & Vận dụng sáng tạo"],
            status: "DRAFT",
          },
          {
            studentId: "STU_02",
            attendanceStatus: "PRESENT",
            quickTags: ["✅ Tiếp thu tốt"],
            status: "DRAFT",
          },
          {
            studentId: "STU_03",
            attendanceStatus: "PRESENT",
            quickTags: [],
            status: "INSUFFICIENT_INFO",
          },
          {
            studentId: "STU_04",
            attendanceStatus: "ABSENT",
            quickTags: [],
            status: "DRAFT",
          },
        ],
      }),
    })
  );
  assert.equal(batchSaveRes.status, 200);
  const batchSaveJson = await batchSaveRes.json();
  assert.equal(batchSaveJson.success, true);
  assert.equal(batchSaveJson.batch, true);
  assert.equal(batchSaveJson.savedCount, 4);
  assert.equal(batchSaveJson.failedCount, 0);

  const fb1 = sessionFeedbackRepo.findOne(classId, sess2Id, "STU_01");
  const fb2 = sessionFeedbackRepo.findOne(classId, sess2Id, "STU_02");
  const fb4 = sessionFeedbackRepo.findOne(classId, sess2Id, "STU_04");
  assert.equal(fb1?.attendanceStatus, "PRESENT");
  assert.equal(fb1?.quickTagsJson, JSON.stringify(["🌟 Tiếp thu nhanh & Vận dụng sáng tạo"]));
  assert.equal(fb2?.attendanceStatus, "PRESENT");
  assert.equal(fb2?.quickTagsJson, JSON.stringify(["✅ Tiếp thu tốt"]));
  assert.equal(fb4?.attendanceStatus, "ABSENT");
  console.log("   [PASS] S3.1: Batch save-draft lưu toàn bộ lớp trong 1 request thành công.");

  // ---------------------------------------------------------------------------
  // 2. S3.3: Batch POST /api/session-comments/approve & Iron Rule 4 hash demotion
  // ---------------------------------------------------------------------------
  console.log("2. Kiểm tra S3.3: Batch POST /api/session-comments/approve & kiểm tra Iron Rule 4...");
  const comment1 =
    "- **Điểm mạnh của học viên:** Con hiểu nhanh cơ chế điều khiển nhân vật.\n\n- **Điểm cần cải thiện:** Cần rà soát kỹ va chạm.\n\n- **Lời khuyên:** Con tiếp tục phát huy ở nhà nhé.";
  const comment2 =
    "- **Điểm mạnh của học viên:** Con hoàn thành bài thực hành đầy đủ.\n\n- **Điểm cần cải thiện:** Thao tác gõ lệnh cần nhanh hơn.\n\n- **Lời khuyên:** Con ôn lại bài trên Denise nhé.";

  await saveDraftPOST(
    new Request("http://127.0.0.1:3000/api/session-comments/save-draft", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify({
        classId,
        sessionId: sess2Id,
        items: [
          { studentId: "STU_01", finalText: comment1, status: "DRAFT" },
          { studentId: "STU_02", finalText: comment2, status: "DRAFT" },
        ],
      }),
    })
  );

  const batchApproveRes = await approvePOST(
    new Request("http://127.0.0.1:3000/api/session-comments/approve", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify({
        classId,
        sessionId: sess2Id,
        items: [
          { studentId: "STU_01", approvedText: comment1, attendanceStatus: "PRESENT" },
          { studentId: "STU_02", approvedText: comment2, attendanceStatus: "PRESENT" },
        ],
      }),
    })
  );
  assert.equal(batchApproveRes.status, 200);
  const batchApproveJson = await batchApproveRes.json();
  assert.equal(batchApproveJson.success, true);
  assert.equal(batchApproveJson.batch, true);
  assert.equal(batchApproveJson.approvedCount, 2);
  assert.equal(batchApproveJson.contentHashByStudent.STU_01, calculateSha256(comment1));
  assert.equal(batchApproveJson.contentHashByStudent.STU_02, calculateSha256(comment2));

  // Verify rejecting INSUFFICIENT_INFO or ABSENT students when passed to approve
  const invalidApproveRes = await approvePOST(
    new Request("http://127.0.0.1:3000/api/session-comments/approve", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify({
        classId,
        sessionId: sess2Id,
        items: [
          {
            studentId: "STU_03",
            approvedText: "Chưa đủ thông tin để nhận xét",
            status: "INSUFFICIENT_INFO",
          },
          {
            studentId: "STU_04",
            approvedText: "Nhận xét cho học sinh nghỉ học",
            attendanceStatus: "ABSENT",
          },
        ],
      }),
    })
  );
  assert.equal(invalidApproveRes.status, 400);
  const invalidApproveJson = await invalidApproveRes.json();
  assert.equal(invalidApproveJson.approvedCount, 0);
  assert.equal(invalidApproveJson.failedCount, 2);

  // Verify Session 14 is blocked on Screen 1 save-lms
  classSessionRepo.upsert({
    classId,
    className: classId,
    sessionId: "VT-C4K-GA38_SESS_14",
    sessionNumber: 14,
    date: "05/07/2026",
    topic: "Tổng kết cuối khóa & SPCK",
  });
  const sess14SaveLmsRes = await saveLmsPOST(
    new Request("http://127.0.0.1:3000/api/session-comments/save-lms", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify({
        classId,
        classCode: classId,
        sessionId: "VT-C4K-GA38_SESS_14",
      }),
    })
  );
  assert.equal(sess14SaveLmsRes.status, 400);
  const sess14Json = await sess14SaveLmsRes.json();
  assert.equal(sess14Json.success, false);
  assert.equal(sess14Json.error.includes("Buổi 14"), true);
  console.log("   [PASS] S3.3 & Session 14 guard: Batch approve & chặn Buổi 14 hoạt động chính xác.");

  // ---------------------------------------------------------------------------
  // 3. S3.1 - S3.4 Component VM Harness: Debounce 600ms, UNKNOWN prompt on AI, 1-click Approve & Save
  // ---------------------------------------------------------------------------
  console.log("3. Kiểm tra VM Component Harness cho SessionCommentsPage (S3.1, S3.2, S3.3, S3.4)...");
  const sess3Id = "VT-C4K-GA38_SESS_03";
  classSessionRepo.upsert({
    classId,
    className: classId,
    sessionId: sess3Id,
    sessionNumber: 3,
    date: "19/04/2026",
    topic: "Va chạm và tính điểm",
  });
  // Seed STU_04 as ABSENT in session 3, while STU_01, STU_02, STU_03 are UNKNOWN
  sessionFeedbackRepo.upsert({
    classId,
    sessionId: sess3Id,
    studentId: "STU_04",
    attendanceStatus: "ABSENT",
    status: "DRAFT",
  });

  let pageSource = fs
    .readFileSync(path.resolve("src/app/session-comments/page.tsx"), "utf8")
    .replaceAll("\r\n", "\n");
  const marker = '\n  return (\n    <div className="space-y-6">';
  assert.equal(pageSource.includes(marker), true);
  const stripped = stripTypeScriptTypes(
    pageSource
      .slice(0, pageSource.indexOf(marker)) +
      "\n globalThis.api = { students, statusMessage, setClassId, setClassCode, setSelectedSessionId, loadClassData, handleConfirmAllPresent, handleNoteChange, handleTextEdit, flushPendingDraftSave, flushAllPendingDraftSaves, handleGenerateAi, handleApproveAndSaveLms, handleApproveAndSaveSingle, unsavedDraftPatchRef }; return null; }"
  )
    .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/\bexport\s+default\s+/g, "")
    .replace(/\bexport\s+/g, "");

  const postCalls: Array<{ url: string; body: any }> = [];
  let confirmCalls = 0;
  const mockNetState = {
    holdDraft: false,
    failDraft: false,
    rejectDraftNetwork: false,
    draftReleases: [] as Array<() => void>,
  };

  const originalSaveComments = CommentSaver.saveComments.bind(CommentSaver);
  (CommentSaver as any).saveComments = async (params: any) => {
    const candidates = params.studentId ? [params.studentId] : ["STU_01", "STU_02"];
    return {
      totalCandidates: candidates.length,
      verifiedCount: candidates.length,
      failedCount: 0,
      results: candidates.map((sid) => ({ studentId: sid, verified: true })),
    };
  };

  const slots: any[] = [];
  const effects: any[] = [];
  let cursor = 0;
  let dirty = true;
  let pendingEffects: any[] = [];

  const ctx: any = {
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
    Promise,
    setTimeout,
    clearTimeout,
    ...quickTagHelpers,
    sharedFormatShortZaloName: formatShortZaloName,
    sharedAddDaysToDdMmYyyy: addDaysToDdMmYyyy,
    sharedBuildAutoZaloBroadcastText: buildAutoZaloBroadcastText,
    sharedResolveCheckpointSessionsForClass: quickTagHelpers.resolveCheckpointSessionsForClass,
    sharedIsCheckpointSession: quickTagHelpers.isCheckpointSession,
    confirm: () => {
      confirmCalls++;
      return true;
    },
    fetch: async (url: string, options?: any) => {
      const fullUrl = String(url).startsWith("http")
        ? String(url)
        : `http://127.0.0.1:3000${url}`;
      if (options?.method === "POST") {
        const parsedBody = options?.body ? JSON.parse(options.body) : {};
        postCalls.push({ url: fullUrl, body: parsedBody });
        if (fullUrl.includes("/api/session-comments/save-draft")) {
          if (mockNetState.holdDraft) {
            await new Promise<void>((resolve) => mockNetState.draftReleases.push(resolve));
          }
          if (mockNetState.rejectDraftNetwork) {
            throw new Error("INJECTED_NETWORK_DISCONNECT");
          }
          if (mockNetState.failDraft) {
            return Response.json(
              { success: false, error: "INJECTED_SAVE_FAILURE" },
              { status: 500 }
            );
          }
          return saveDraftPOST(
            new Request(fullUrl, {
              method: "POST",
              headers: {
                host: "127.0.0.1:3000",
                "content-type": "application/json",
                ...(options?.headers || {}),
              },
              body: options?.body,
            })
          );
        }
        if (fullUrl.includes("/api/session-comments/approve")) {
          return approvePOST(
            new Request(fullUrl, {
              method: "POST",
              headers: {
                host: "127.0.0.1:3000",
                "content-type": "application/json",
                ...(options?.headers || {}),
              },
              body: options?.body,
            })
          );
        }
        if (fullUrl.includes("/api/session-comments/generate-ai")) {
          const genClassId = parsedBody.session?.classId || classId;
          const genSessionId = parsedBody.session?.sessionId || sess3Id;
          return Response.json({
            success: true,
            data: (parsedBody.students || []).map((st: any) => {
              const hasInfo = (st.quickTags && st.quickTags.length > 0) || st.teacherNote;
              const formattedFullComment = hasInfo
                ? `- **Điểm mạnh của học viên:** Hiểu bài tốt.\n\n- **Điểm cần cải thiện:** Cần thực hành thêm.\n\n- **Lời khuyên:** Làm BTVN đầy đủ.`
                : "Chưa đủ thông tin để nhận xét";
              const existingRow = sessionFeedbackRepo.findOne(genClassId, genSessionId, st.studentId) as any;
              let prevMeta: any = { rowVer: 0, fields: {} };
              try {
                if (existingRow?.versionMetaJson) prevMeta = JSON.parse(existingRow.versionMetaJson);
              } catch {}
              const nextMeta = {
                rowVer: (prevMeta.rowVer || 0) + 1,
                fields: { ...(prevMeta.fields || {}) },
              };
              if (hasInfo) {
                sessionFeedbackRepo.upsert({
                  classId: genClassId,
                  sessionId: genSessionId,
                  studentId: st.studentId,
                  attendanceStatus: existingRow?.attendanceStatus || st.attendanceStatus || "PRESENT",
                  quickTagsJson: existingRow?.quickTagsJson || JSON.stringify(st.quickTags || []),
                  teacherNote: existingRow?.teacherNote || st.teacherNote || "",
                  strengths: "Hiểu bài tốt",
                  improvements: "Cần thực hành thêm",
                  actionPlan: "Làm BTVN đầy đủ",
                  finalText: formattedFullComment,
                  status: "DRAFT",
                  versionMetaJson: JSON.stringify(nextMeta),
                });
              }
              return {
                studentId: st.studentId,
                status: hasInfo ? "DRAFT" : "INSUFFICIENT_INFO",
                strengths: "Hiểu bài tốt",
                improvements: "Cần thực hành thêm",
                actionPlan: "Làm BTVN đầy đủ",
                formattedFullComment,
                versionMeta: nextMeta,
              };
            }),
          });
        }
        if (fullUrl.includes("/api/session-comments/save-lms")) {
          return saveLmsPOST(
            new Request(fullUrl, {
              method: "POST",
              headers: {
                host: "127.0.0.1:3000",
                "content-type": "application/json",
                ...(options?.headers || {}),
              },
              body: options?.body,
            })
          );
        }
      }
      if (fullUrl.includes("/api/session-comments/list")) {
        return listGET(new Request(fullUrl, { headers: { host: "127.0.0.1:3000" } }));
      }
      return Response.json({ success: true, data: {} });
    },
    useState(initial: any) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [
        slots[i],
        (value: any) => {
          const n = typeof value === "function" ? value(slots[i]) : value;
          if (!Object.is(n, slots[i])) {
            slots[i] = n;
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
      if (
        !effects[i] ||
        !deps ||
        deps.some((v: any, j: number) => !Object.is(v, effects[i][j]))
      ) {
        effects[i] = deps;
        pendingEffects.push(fn);
      }
    },
  };

  vm.createContext(ctx);
  vm.runInContext(stripped + "\nglobalThis.render = SessionCommentsPage;", ctx);
  const flushUi = async () => {
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setImmediate(r));
      if (dirty) {
        dirty = false;
        cursor = 0;
        ctx.render();
        const jobs = pendingEffects;
        pendingEffects = [];
        jobs.forEach((fn) => fn());
      }
    }
  };

  await flushUi();
  ctx.api.setClassId(classId);
  ctx.api.setSelectedSessionId(sess3Id);
  await flushUi();

  // Check inherited tags on STU_01 and STU_02 from Session 2
  const stu1Before = ctx.api.students.find((s: any) => s.studentId === "STU_01");
  assert.deepEqual([...(stu1Before.quickTags || [])], ["💡 Vận dụng & Sáng tạo tốt"]);
  assert.equal(stu1Before.inheritedFromSession, 2);

  // S3.2: Click "AI Soạn Nhận Xét" when STU_01, STU_02, STU_03 are UNKNOWN and STU_04 is ABSENT
  postCalls.length = 0;
  await ctx.api.handleGenerateAi();
  await flushUi();
  assert.equal(confirmCalls, 1, "S3.2: Phải hỏi xác nhận khi còn học viên UNKNOWN");

  const batchDraftCalls = postCalls.filter((c) => c.url.includes("/api/session-comments/save-draft"));
  assert.equal(
    batchDraftCalls.length,
    1,
    "S3.1 & S3.2: Điểm danh các bạn UNKNOWN chỉ gửi đúng 1 batch request save-draft"
  );
  assert.equal(
    batchDraftCalls[0].body.items.length,
    3,
    "S3.2: Chỉ điểm danh 3 bạn UNKNOWN (STU_01, STU_02, STU_03), giữ nguyên bạn STU_04 đang ABSENT"
  );
  // STU_01 had inherited tags ["💡 Vận dụng & Sáng tạo tốt"] -> must preserve them!
  const itemStu1 = batchDraftCalls[0].body.items.find((i: any) => i.studentId === "STU_01");
  assert.deepEqual(
    itemStu1.quickTags,
    ["💡 Vận dụng & Sáng tạo tốt"],
    "S3.1 (R2-01/R2-02): Không được ghi đè thẻ kế thừa của STU_01 bằng thẻ mặc định"
  );
  // STU_03 had no tags -> gets default good tag "✅ Tiếp thu tốt"
  const itemStu3 = batchDraftCalls[0].body.items.find((i: any) => i.studentId === "STU_03");
  assert.deepEqual(
    itemStu3.quickTags,
    ["✅ Tiếp thu tốt"],
    "S3.1: Học viên chưa có thẻ được gắn thẻ mặc định Tiếp thu tốt"
  );
  assert.equal(
    sessionFeedbackRepo.findOne(classId, sess3Id, "STU_04")?.attendanceStatus,
    "ABSENT",
    "S3.2: Học viên STU_04 nghỉ học vẫn giữ nguyên trạng thái ABSENT"
  );

  // S3.1: Debounce 600ms + immediate flush on blur
  postCalls.length = 0;
  ctx.api.handleNoteChange("STU_01", "G", { debounceMs: 600 });
  ctx.api.handleNoteChange("STU_01", "Gh", { debounceMs: 600 });
  ctx.api.handleNoteChange("STU_01", "Ghi", { debounceMs: 600 });
  ctx.api.handleNoteChange("STU_01", "Ghi chú", { debounceMs: 600 });
  ctx.api.handleNoteChange("STU_01", "Ghi chú hoàn chỉnh", { debounceMs: 600 });
  await flushUi();
  assert.equal(
    postCalls.filter((c) => c.url.includes("/api/session-comments/save-draft")).length,
    0,
    "S3.1: Trong thời gian debounce 600ms không được bắn 5 request liên tiếp"
  );
  // Simulate onBlur immediate flush
  await ctx.api.flushPendingDraftSave("STU_01");
  await flushUi();
  const debouncedSaveCalls = postCalls.filter((c) =>
    c.url.includes("/api/session-comments/save-draft")
  );
  assert.equal(
    debouncedSaveCalls.length,
    1,
    "S3.1: Gõ 5 ký tự liên tiếp + onBlur chỉ gửi đúng 1 request lưu nháp"
  );
  assert.equal(
    sessionFeedbackRepo.findOne(classId, sess3Id, "STU_01")?.teacherNote,
    "Ghi chú hoàn chỉnh"
  );

  // Mark STU_03 as INSUFFICIENT_INFO in state to test S3.3 skipping INSUFFICIENT_INFO
  ctx.api.handleTextEdit("STU_03", "finalText", "", { immediate: true });
  await flushUi();

  // S3.3: Click "✅ Duyệt & Đẩy LMS" -> 1 batch approve call + 1 save-lms call + summary message
  postCalls.length = 0;
  await ctx.api.handleApproveAndSaveLms();
  await flushUi();
  const approveCalls = postCalls.filter((c) => c.url.includes("/api/session-comments/approve"));
  const saveLmsCalls = postCalls.filter((c) => c.url.includes("/api/session-comments/save-lms"));
  assert.equal(approveCalls.length, 1, "S3.3: Duyệt hàng loạt chỉ gửi đúng 1 request approve");
  assert.equal(
    approveCalls[0].body.items.length,
    2,
    "S3.3: Chỉ duyệt 2 học sinh hợp lệ (STU_01, STU_02), bỏ qua STU_03 (trống) và STU_04 (ABSENT)"
  );
  assert.equal(saveLmsCalls.length, 1, "S3.3: Tự động gọi save-lms ngay sau khi duyệt");
  assert.equal(
    ctx.api.statusMessage?.text.includes("Đã lưu 2 / Bỏ qua 1 (thiếu thông tin) / Lỗi 0"),
    true,
    `S3.3: Thông báo tổng kết phải hiển thị 'Đã lưu 2 / Bỏ qua 1 (thiếu thông tin) / Lỗi 0', nhận được: ${ctx.api.statusMessage?.text}`
  );

  // S3.4: Test handleApproveAndSaveSingle on APPROVED row (retries directly without re-approving)
  // and on edited DRAFT row (approves first then pushes to LMS)
  postCalls.length = 0;
  await ctx.api.handleApproveAndSaveSingle("STU_02");
  await flushUi();
  assert.equal(
    postCalls.filter((c) => c.url.includes("/api/session-comments/approve")).length,
    0,
    "S3.4: Khi dòng đã APPROVED, bấm Đẩy lại gọi thẳng save-lms mà không cần duyệt lại"
  );
  assert.equal(
    postCalls.filter((c) => c.url.includes("/api/session-comments/save-lms")).length,
    1,
    "S3.4: Gọi save-lms cho STU_02"
  );

  // Edit STU_01 -> demoted to DRAFT -> handleApproveAndSaveSingle must approve first then save-lms
  ctx.api.handleTextEdit(
    "STU_01",
    "finalText",
    `- **Điểm mạnh của học viên:** Con hoàn thành xuất sắc bài lập trình.\n\n- **Điểm cần cải thiện:** Cần kiểm tra kỹ biên va chạm.\n\n- **Lời khuyên:** Con luyện tập thêm ở nhà nhé.`,
    { immediate: true }
  );
  await flushUi();
  postCalls.length = 0;
  await ctx.api.handleApproveAndSaveSingle("STU_01");
  await flushUi();
  assert.equal(
    postCalls.filter((c) => c.url.includes("/api/session-comments/approve")).length,
    1,
    "S3.4: Khi dòng đang ở trạng thái DRAFT, bấm Duyệt & Lưu riêng phải tự động gọi approve trước"
  );
  assert.equal(
    postCalls.filter((c) => c.url.includes("/api/session-comments/save-lms")).length,
    1,
    "S3.4: Sau khi approve thành công phải tự động gọi save-lms"
  );
  console.log("   [PASS] S3.1 - S3.4 Component VM Harness PASS 100%.");

  // ---------------------------------------------------------------------------
  // 4. S3.6: Unified Zalo Summary Engine (6 sections, +7 days, Part 2 only with image)
  // ---------------------------------------------------------------------------
  console.log("4. Kiểm tra S3.6: Unified Zalo Summary Engine (zalo-summary.ts)...");
  assert.equal(formatShortZaloName("Nguyễn Thành Phong"), "Thành Phong");
  assert.equal(formatShortZaloName("Đức Tuấn"), "Đức Tuấn");
  assert.equal(addDaysToDdMmYyyy("12/04/2026", 7), "Chủ nhật, ngày 19/04/2026");

  const zaloPart1Only = buildAutoZaloBroadcastText({
    classCode: classId,
    selectedSessionId: sess2Id,
    sessions: [
      { sessionId: sess2Id, sessionNumber: 2, topic: "Lập trình di chuyển nhân vật", date: "12/04/2026" },
    ],
    students: [
      { studentId: "STU_01", fullName: "Nguyễn Thành Phong", isActive: true, attendanceStatus: "PRESENT" },
      { studentId: "STU_02", fullName: "Trần Minh Khôi", isActive: true, attendanceStatus: "PRESENT" },
      { studentId: "STU_04", fullName: "Phạm Bảo Ngọc", isActive: true, attendanceStatus: "ABSENT" },
    ],
    currentTopic: "Lập trình di chuyển nhân vật",
    currentKeyKnowledge: ["Xử lý sự kiện bàn phím 4 hướng", "Kiểm soát tốc độ di chuyển"],
    syllabusList: [
      {
        courseCode: "GA",
        sessions: [
          { sessionNumber: 2, topic: "Lập trình di chuyển nhân vật" },
          { sessionNumber: 3, topic: "Va chạm và tính điểm" },
        ],
      },
    ],
  });

  assert.equal(
    zaloPart1Only.includes(
      "Kính gửi quý phụ huynh, giáo viên xin phép tổng kết sau buổi học số 2 ngày 12/04/2026"
    ),
    true
  );
  assert.equal(zaloPart1Only.includes("Lớp sĩ số 2/3 (vắng bạn Bảo Ngọc) ổn định đầu giờ tốt."), true);
  assert.equal(zaloPart1Only.includes("📘 NỘI DUNG BUỔI HỌC:"), true);
  assert.equal(zaloPart1Only.includes("📍 NHỮNG ĐIỂM CẦN LƯU Ý:"), true);
  assert.equal(zaloPart1Only.includes("📝 NHIỆM VỤ KHI VỀ NHÀ:"), true);
  assert.equal(zaloPart1Only.includes("+ 10 câu hỏi trắc nghiệm."), true);
  assert.equal(zaloPart1Only.includes("+ 2 bài thực hành (làm theo yêu cầu đề bài)."), true);
  assert.equal(zaloPart1Only.includes("⏰ Hạn nộp: Chủ nhật, ngày 19/04/2026"), true);
  assert.equal(zaloPart1Only.includes("📌 NỘI DUNG BUỔI HỌC KẾ TIẾP:"), true);
  assert.equal(zaloPart1Only.includes("Thời gian: Chủ nhật, ngày 19/04/2026"), true);
  assert.equal(zaloPart1Only.includes("Nội dung bài học: BUỔI 3: VA CHẠM VÀ TÍNH ĐIỂM"), true);
  // Kiểm tra thứ tự Đoạn 1: Yêu cầu/Dặn dò BTVN đứng trước Thời gian buổi học kế tiếp
  assert.equal(
    zaloPart1Only.indexOf("📝 NHIỆM VỤ KHI VỀ NHÀ:") <
      zaloPart1Only.indexOf("📌 NỘI DUNG BUỔI HỌC KẾ TIẾP:"),
    true,
    "Thứ tự Đoạn 1 phải đặt Yêu cầu/Dặn dò BTVN trước Thời gian buổi học kế tiếp"
  );
  assert.equal(zaloPart1Only.includes("Em xin phép cập nhật tình trạng làm bài"), false);

  // Kiểm tra Đoạn 2 (2a. Tình hình chung, 2b. BTVN, 2c. Tiến độ SPCK ở Buổi 12) & Đoạn 3 (Hình ảnh & Học liệu)
  const zaloFull3Sections = buildAutoZaloBroadcastText({
    classCode: classId,
    sessionNumber: 12,
    sessionDate: "21/06/2026",
    students: [
      {
        studentId: "STU_01",
        fullName: "Nguyễn Thành Phong",
        isActive: true,
        attendanceStatus: "PRESENT",
        quickTags: ["🐢 Tiếp thu chậm / Cần kèm sát"],
      },
    ],
    currentTopic: "Xây dựng Sản phẩm cuối khóa GĐ1",
    includeGeneralUpdate: true,
    includePart3MediaReminder: true,
    part2Text: buildBtvnPart2(["Nguyễn Thành Phong"]),
  });
  assert.equal(zaloFull3Sections.includes("🌟 CẬP NHẬT TÌNH HÌNH CHUNG:"), true);
  assert.equal(zaloFull3Sections.includes("Thành Phong"), true);
  assert.equal(zaloFull3Sections.includes("🚀 TIẾN ĐỘ SẢN PHẨM CUỐI KHÓA (SPCK):"), true);
  assert.equal(zaloFull3Sections.includes("📊 TÌNH TRẠNG BÀI TẬP VỀ NHÀ:"), true);
  assert.equal(zaloFull3Sections.includes("📸 HÌNH ẢNH & TÀI LIỆU BUỔI HỌC:"), true);

  const part2Text = buildBtvnPart2(["Nguyễn Thành Phong", "Lê Hoàng Bách"]);
  assert.equal(part2Text.includes("*Thành Phong, Hoàng Bách*"), true);
  assert.equal(formatShortZaloName("Nguyễn Thành Phong"), "Thành Phong");
  assert.equal(addDaysToDdMmYyyy("12/04/2026", 7), "Chủ nhật, ngày 19/04/2026");
  console.log("   [PASS] S3.6: Zalo Summary Engine thống nhất 1 nguồn duy nhất đạt chuẩn 3 đoạn mới + Phần 2 BTVN.");

  // ---------------------------------------------------------------------------
  // 5. S3.1 - S3.7 Source & Component Contract Verification on page.tsx
  // ---------------------------------------------------------------------------
  console.log("5. Kiểm tra S3.1 - S3.7 trên src/app/session-comments/page.tsx...");
  assert.equal(
    pageSource.includes("{false &&"),
    false,
    "Không còn nhánh JSX chết {false && ...} trong src/app/session-comments/page.tsx"
  );
  assert.equal(
    pageSource.includes("Em ${target.fullName}"),
    false,
    "Đã dọn nhánh ghép chuỗi 'Em ${target.fullName}' không còn dùng trong handleTextEdit"
  );
  assert.equal(
    pageSource.includes("DRAFT_SAVE_DEBOUNCE_MS = 600"),
    true,
    "Có cấu hình debounce 600ms cho lưu nháp"
  );
  assert.equal(
    pageSource.includes("flushPendingDraftSave"),
    true,
    "Có cơ chế flush ngay lập tức khi onBlur / trước khi duyệt"
  );
  assert.equal(
    pageSource.includes("Duyệt & Đẩy LMS"),
    true,
    "Có nút chính 1-click '✅ Duyệt & Đẩy LMS'"
  );
  assert.equal(
    pageSource.includes("Duyệt & Lưu riêng"),
    true,
    "Có nút 1-click 'Duyệt & Lưu riêng' trên từng dòng học sinh"
  );
  assert.equal(
    pageSource.includes("Thầy hãy tích Điểm Năng lực trên LMS rồi bấm Đẩy lại"),
    true,
    "Có nhắc nhở rõ ràng trên dòng học sinh ở buổi Checkpoint"
  );
  console.log("   [PASS] S3.1 - S3.7: Giao diện & hợp đồng hàm trên src/app/session-comments/page.tsx đạt chuẩn.");

  // ---------------------------------------------------------------------------
  // 6. Codex S3 Round 1 & Round 2 Regression Checks (S3-01 .. S3-07)
  // ---------------------------------------------------------------------------
  console.log("6. Kiểm tra hồi quy Codex S3 Round 1 & Round 2 (S3-01 .. S3-07)...");
  // S3-04: Batch save-draft with malformed field type must report per-item results without throwing 500
  const malformedBatchRes = await saveDraftPOST(
    new Request("http://127.0.0.1:3000/api/session-comments/save-draft", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify({
        classId,
        sessionId: sess3Id,
        items: [
          { studentId: "STU_01", teacherNote: "Valid note A" },
          { studentId: "STU_02", teacherNote: { bad: "binding" } },
        ],
      }),
    })
  );
  assert.equal(malformedBatchRes.status, 400);
  const malformedBatchData = await malformedBatchRes.json();
  assert.equal(Array.isArray(malformedBatchData.results), true);
  assert.equal(malformedBatchData.results[0].success, true);
  assert.equal(malformedBatchData.results[1].success, false);

  // S3-05: Approve must check existing SQLite status (INSUFFICIENT_INFO / FAILED) even when item.status is omitted
  sessionFeedbackRepo.upsert({
    ...(sessionFeedbackRepo.findOne(classId, sess3Id, "STU_03") as any),
    classId,
    sessionId: sess3Id,
    studentId: "STU_03",
    attendanceStatus: "PRESENT",
    finalText: "Some text on insufficient row",
    status: "INSUFFICIENT_INFO",
  });
  const blockedApproveRes = await approvePOST(
    new Request("http://127.0.0.1:3000/api/session-comments/approve", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify({
        classId,
        sessionId: sess3Id,
        items: [{ studentId: "STU_03", approvedText: "Some text on insufficient row" }],
      }),
    })
  );
  assert.equal(blockedApproveRes.status, 400);
  assert.equal(
    (sessionFeedbackRepo.findOne(classId, sess3Id, "STU_03") as any)?.status,
    "INSUFFICIENT_INFO"
  );

  // S3-07 (Q01): Verify all /save-lms requests include classCode
  const allSaveLmsCalls = postCalls.filter((c) => c.url.includes("/api/session-comments/save-lms"));
  assert.equal(allSaveLmsCalls.length >= 1, true);
  for (const call of allSaveLmsCalls) {
    assert.equal(call.body.classCode, classId, "Mọi request /save-lms phải có classCode");
  }

  // S3-01 (Q03 / Q11): Overlapping saves on different fields (teacherNote fails after finalText succeeds)
  mockNetState.holdDraft = true;
  mockNetState.failDraft = false;
  mockNetState.draftReleases = [];

  ctx.api.handleNoteChange("STU_01", "NOTE LOST AFTER BLUR");
  await flushUi();
  const flushNotePromise = ctx.api.flushPendingDraftSave("STU_01");
  await flushUi();

  ctx.api.handleTextEdit("STU_01", "finalText", "TEXT SAVED AFTER BLUR");
  await flushUi();
  const flushTextPromise = ctx.api.flushPendingDraftSave("STU_01");
  await flushUi();

  assert.equal(mockNetState.draftReleases.length, 2);
  // Release Request B (finalText) first -> succeeds
  mockNetState.draftReleases[1]();
  await flushUi();
  // Release Request A (teacherNote) second with injected HTTP 500 failure
  mockNetState.failDraft = true;
  mockNetState.holdDraft = false;
  mockNetState.draftReleases[0]();
  const [noteFlushOk, textFlushOk] = await Promise.all([flushNotePromise, flushTextPromise]);
  await flushUi();
  assert.equal(noteFlushOk, false);
  assert.equal(textFlushOk, false);
  assert.equal(
    Object.keys(ctx.api.unsavedDraftPatchRef.current).includes("STU_01"),
    true,
    "Trường teacherNote lỗi phải được giữ lại trong unsavedDraftPatchRef"
  );

  // Reload with preserveLocalUnsavedEdits while note is still unsaved must preserve local note
  await ctx.api.loadClassData(classId, sess3Id, { preserveLocalUnsavedEdits: true });
  await flushUi();
  const stu1AfterReloadBeforeRetry = ctx.api.students.find((s: any) => s.studentId === "STU_01");
  assert.equal(stu1AfterReloadBeforeRetry.teacherNote, "NOTE LOST AFTER BLUR");

  // Clear injected failure and call flushAllPendingDraftSaves() -> must retry and persist note to SQLite
  mockNetState.failDraft = false;
  const retryFlushOk = await ctx.api.flushAllPendingDraftSaves();
  await flushUi();
  assert.equal(retryFlushOk, true);
  assert.equal(
    (sessionFeedbackRepo.findOne(classId, sess3Id, "STU_01") as any)?.teacherNote,
    "NOTE LOST AFTER BLUR"
  );
  assert.equal(
    (sessionFeedbackRepo.findOne(classId, sess3Id, "STU_01") as any)?.finalText,
    "TEXT SAVED AFTER BLUR"
  );

  // S3-01b: Same overlapping two-field out-of-order scenario with network connection rejection (throw Error)
  mockNetState.holdDraft = true;
  mockNetState.failDraft = false;
  mockNetState.rejectDraftNetwork = false;
  mockNetState.draftReleases = [];

  ctx.api.handleNoteChange("STU_01", "NOTE AFTER NET DROP");
  await flushUi();
  const netFlushNotePromise = ctx.api.flushPendingDraftSave("STU_01");
  await flushUi();

  ctx.api.handleTextEdit("STU_01", "finalText", "TEXT AFTER NET DROP");
  await flushUi();
  const netFlushTextPromise = ctx.api.flushPendingDraftSave("STU_01");
  await flushUi();

  assert.equal(mockNetState.draftReleases.length, 2);
  // Release Request B (finalText) first -> succeeds
  mockNetState.draftReleases[1]();
  await flushUi();
  // Release Request A (teacherNote) second with network error
  mockNetState.rejectDraftNetwork = true;
  mockNetState.holdDraft = false;
  mockNetState.draftReleases[0]();
  const [netNoteOk, netTextOk] = await Promise.all([netFlushNotePromise, netFlushTextPromise]);
  await flushUi();
  assert.equal(netNoteOk, false);
  assert.equal(netTextOk, false);
  assert.equal(
    Object.keys(ctx.api.unsavedDraftPatchRef.current).includes("STU_01"),
    true,
    "Trường teacherNote lỗi kết nối mạng phải được giữ lại trong unsavedDraftPatchRef"
  );

  mockNetState.rejectDraftNetwork = false;
  const retryNetFlushOk = await ctx.api.flushAllPendingDraftSaves();
  await flushUi();
  assert.equal(retryNetFlushOk, true);
  assert.equal(
    (sessionFeedbackRepo.findOne(classId, sess3Id, "STU_01") as any)?.teacherNote,
    "NOTE AFTER NET DROP"
  );
  assert.equal(
    (sessionFeedbackRepo.findOne(classId, sess3Id, "STU_01") as any)?.finalText,
    "TEXT AFTER NET DROP"
  );

  // S3-08 (R3-M01 / N04): Partial field acceptance when bundled retry has stale teacherNote + fresh finalText
  const stu1PreM01 = sessionFeedbackRepo.findOne(classId, sess3Id, "STU_01") as any;
  const preM01Meta = JSON.parse(stu1PreM01?.versionMetaJson || "{}");
  const preM01NoteVer = preM01Meta?.fields?.teacherNote?.ver ?? 0;

  // 1) Local teacher edits teacherNote, blur flushes, server returns HTTP 500
  mockNetState.failDraft = true;
  ctx.api.handleNoteChange("STU_01", "LOCAL NOTE MUST SURVIVE");
  await flushUi();
  const m01FirstSaveOk = await ctx.api.flushPendingDraftSave("STU_01");
  await flushUi();
  assert.equal(m01FirstSaveOk, false, "S3-08: Lần lưu note đầu bị lỗi HTTP 500 phải trả false");
  mockNetState.failDraft = false;

  // 2) Another tab (OTHER_TAB) saves teacherNote via the real save-draft route
  const otherTabRes = await saveDraftPOST(
    new Request(
      `http://127.0.0.1:3000/api/session-comments/save-draft?cid=OTHER_TAB&rev=99&base=${preM01Meta?.rowVer ?? 0}&fbase=${encodeURIComponent(`teacherNote:${preM01NoteVer}`)}&f=teacherNote`,
      {
        method: "POST",
        headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
        body: JSON.stringify({
          classId,
          sessionId: sess3Id,
          studentId: "STU_01",
          teacherNote: "OTHER TAB NOTE",
          status: "DRAFT",
        }),
      }
    )
  );
  assert.equal(otherTabRes.status, 200, "S3-08: Tab khác lưu teacherNote thành công");

  // 3) Local teacher edits finalText and blurs -> flushPendingDraftSave bundles teacherNote + finalText
  ctx.api.handleTextEdit("STU_01", "finalText", "LOCAL FINAL TEXT ACCEPTED");
  await flushUi();
  const m01BundledFlushOk = await ctx.api.flushPendingDraftSave("STU_01");
  await flushUi();
  assert.equal(
    m01BundledFlushOk,
    false,
    "S3-08: Khi server nhận finalText nhưng từ chối teacherNote xung đột, flushPendingDraftSave phải trả false"
  );
  assert.equal(
    (sessionFeedbackRepo.findOne(classId, sess3Id, "STU_01") as any)?.teacherNote,
    "OTHER TAB NOTE",
    "S3-08: DB vẫn bảo vệ teacherNote của tab khác"
  );
  assert.equal(
    (sessionFeedbackRepo.findOne(classId, sess3Id, "STU_01") as any)?.finalText,
    "LOCAL FINAL TEXT ACCEPTED",
    "S3-08: DB vẫn lưu được finalText mới không xung đột"
  );
  assert.equal(
    ctx.api.unsavedDraftPatchRef.current["STU_01"]?.patch?.teacherNote,
    "LOCAL NOTE MUST SURVIVE",
    "S3-08: unsavedDraftPatchRef phải giữ lại teacherNote bị từ chối"
  );
  assert.equal(
    ctx.api.unsavedDraftPatchRef.current["STU_01"]?.reason,
    "stale",
    "S3-08: unsavedDraftPatchRef phải đánh dấu reason='stale' cho trường xung đột"
  );
  assert.equal(
    await ctx.api.flushAllPendingDraftSaves(),
    false,
    "S3-08: flushAllPendingDraftSaves phải tiếp tục trả false để chặn AI/Duyệt/Đẩy LMS cho tới khi xử lý xung đột"
  );

  // 4) Reload with preserveLocalUnsavedEdits:true must NOT overwrite local teacherNote with OTHER TAB NOTE
  await ctx.api.loadClassData(classId, sess3Id, { preserveLocalUnsavedEdits: true });
  await flushUi();
  const stu1AfterM01Reload = ctx.api.students.find((s: any) => s.studentId === "STU_01");
  assert.equal(
    stu1AfterM01Reload.teacherNote,
    "LOCAL NOTE MUST SURVIVE",
    "S3-08: Tải lại với preserveLocalUnsavedEdits:true phải giữ nguyên ghi chú cục bộ trên màn hình"
  );
  assert.equal(
    stu1AfterM01Reload.finalText,
    "LOCAL FINAL TEXT ACCEPTED",
    "S3-08: Tải lại vẫn giữ finalText đã lưu"
  );

  // 5) Teacher intentionally edits teacherNote to resolve conflict -> now saves cleanly
  ctx.api.handleNoteChange("STU_01", "RESOLVED NOTE BY TEACHER");
  await flushUi();
  const m01ResolvedOk = await ctx.api.flushAllPendingDraftSaves();
  await flushUi();
  assert.equal(m01ResolvedOk, true, "S3-08: Sau khi giáo viên chủ động sửa lại note xung đột, lưu thành công");
  assert.equal(
    (sessionFeedbackRepo.findOne(classId, sess3Id, "STU_01") as any)?.teacherNote,
    "RESOLVED NOTE BY TEACHER"
  );

  // S3-08b (R4-M02 / N05): In-flight teacherNote save + OTHER_TAB update + concurrent other-field save AND preserving reload before Request A fails
  const stu1PreM02 = sessionFeedbackRepo.findOne(classId, sess3Id, "STU_01") as any;
  const preM02Meta = JSON.parse(stu1PreM02?.versionMetaJson || "{}");
  const preM02NoteVer = preM02Meta?.fields?.teacherNote?.ver ?? 0;

  mockNetState.holdDraft = true;
  mockNetState.failDraft = false;
  mockNetState.draftReleases = [];

  // Request A: local teacherNote edit sent and held in-flight
  ctx.api.handleNoteChange("STU_01", "INFLIGHT LOCAL NOTE");
  await flushUi();
  const inflightNotePromise = ctx.api.flushPendingDraftSave("STU_01");
  await flushUi();
  assert.equal(mockNetState.draftReleases.length, 1);

  // While Request A is in-flight, OTHER_TAB updates teacherNote in SQLite via real route
  const otherTabM02Res = await saveDraftPOST(
    new Request(
      `http://127.0.0.1:3000/api/session-comments/save-draft?cid=OTHER_TAB&rev=120&base=${preM02Meta?.rowVer ?? 0}&fbase=${encodeURIComponent(`teacherNote:${preM02NoteVer}`)}&f=teacherNote`,
      {
        method: "POST",
        headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
        body: JSON.stringify({
          classId,
          sessionId: sess3Id,
          studentId: "STU_01",
          teacherNote: "REMOTE NOTE MUST SURVIVE",
          status: "DRAFT",
        }),
      }
    )
  );
  assert.equal(otherTabM02Res.status, 200);

  // Branch 1: While Request A is still in-flight, another field (finalText) saves and succeeds
  ctx.api.handleTextEdit("STU_01", "finalText", "UNRELATED FINAL TEXT WHILE NOTE INFLIGHT");
  await flushUi();
  const inflightTextPromise = ctx.api.flushPendingDraftSave("STU_01");
  await flushUi();
  assert.equal(mockNetState.draftReleases.length, 2);
  mockNetState.draftReleases[1]();
  await flushUi();

  // Branch 2: Also run loadClassData(..., { preserveLocalUnsavedEdits: true }) while Request A is still in-flight
  await ctx.api.loadClassData(classId, sess3Id, { preserveLocalUnsavedEdits: true });
  await flushUi();

  // Now release Request A (teacherNote) with HTTP 500 failure
  mockNetState.failDraft = true;
  mockNetState.holdDraft = false;
  mockNetState.draftReleases[0]();
  const [inflightNoteOk, inflightTextOk] = await Promise.all([
    inflightNotePromise,
    inflightTextPromise,
  ]);
  await flushUi();
  assert.equal(inflightNoteOk, false);
  assert.equal(inflightTextOk, false);
  mockNetState.failDraft = false;

  // Retry (or click Duyệt & Lưu riêng): must use original base version, detect conflict with REMOTE NOTE MUST SURVIVE, and block approve/save-lms
  postCalls.length = 0;
  await ctx.api.handleApproveAndSaveSingle("STU_01");
  await flushUi();
  assert.equal(
    postCalls.filter((c) => c.url.includes("/api/session-comments/approve")).length,
    0,
    "R4-M02/N05: Không được gọi approve khi retry note phát hiện xung đột với tab khác"
  );
  assert.equal(
    postCalls.filter((c) => c.url.includes("/api/session-comments/save-lms")).length,
    0,
    "R4-M02/N05: Không được gọi save-lms khi retry note phát hiện xung đột với tab khác"
  );
  assert.equal(
    (sessionFeedbackRepo.findOne(classId, sess3Id, "STU_01") as any)?.teacherNote,
    "REMOTE NOTE MUST SURVIVE",
    "R4-M02/N05: Không được ghi đè note mới của tab khác khi retry"
  );
  assert.equal(
    ctx.api.unsavedDraftPatchRef.current["STU_01"]?.reason,
    "stale",
    "R4-M02/N05: Sau retry phải khóa xung đột với reason='stale'"
  );
  assert.equal(
    ctx.api.students.find((s: any) => s.studentId === "STU_01")?.teacherNote,
    "INFLIGHT LOCAL NOTE",
    "R4-M02/N05: Giữ nguyên note cục bộ trên màn hình để giáo viên đối chiếu"
  );

  (CommentSaver as any).saveComments = originalSaveComments;
  console.log("   [PASS] S3-01 .. S3-08 (kể cả R4-M02 / N05 in-flight): Các kịch bản biên bất đồng bộ, chồng lấp đa trường, batch validation & route save-lms thật đạt 100%.");

  console.log("\n🎉 HOÀN TẤT KIỂM THỬ GIAI ĐOẠN S3 (v3.4.0) — TẤT CẢ GATES ĐẠT 100%!");
  closeDb();
}

main()
  .catch(async (err) => {
    console.error("❌ Lỗi kiểm thử S3:", err);
    try {
      const { closeDb } = await import("../src/lib/db/sqlite");
      closeDb();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    process.exit(1);
  })
  .finally(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });
