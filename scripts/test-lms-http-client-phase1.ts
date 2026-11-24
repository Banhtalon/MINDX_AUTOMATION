/**
 * KIỂM THỬ TỰ ĐỘNG ĐỢT 1 (`v3.8.8`) — PURE NODE.JS LMS HTTP/GRAPHQL READ CLIENT & PII HARDENING
 *
 * Chạy 100% cô lập trong `os.tmpdir()` — KHÔNG đọc/ghi dữ liệu thật trong `data/` hay `playwright-auth/`.
 *
 * Nhóm kiểm thử:
 * - [P1-01] createMindxDnsLookup (`lms-api.mindx.edu.vn`, `lms.mindx.edu.vn`, `resources.mindx.edu.vn`) & TLS `rejectUnauthorized: true`
 * - [P1-02] Auto-refresh Firebase `idToken` qua `securetoken.googleapis.com`, retry HTTP 401 (1x refresh -> 1x bootstrap),
 *           cô lập `lms_token_teacher.json` vs `lms_token_admin.json`, và KHÔNG kích hoạt refresh/bootstrap khi GraphQL trả `FORBIDDEN` phân quyền
 * - [P1-03] Công tắc `MINDX_LMS_API_READ=false`, `forcePlaywright: true`, fallback Playwright khi API lỗi, và `QUEUE_STOPPED` dừng tức thì
 * - [P1-04] `redactSecrets` che sạch JWT thô, `Authorization:` có/không `Bearer`, `refresh_token=`, `id_token=`, `session=`, `firebaseApiKey`
 * - [P1-05] `pii-anonymizer.ts`: `createRosterNameScrubber` & `anonymizeSession14Text` che SĐT/Email, giữ nguyên ngày/điểm/mã lớp/tên file
 * - [P1-06] `fetchMindxResourceJson` & `fetchMindxResourceBuffer` (max 3 redirects, host allowlist, >25MB cap) + E2E `ClassSyncer.syncClass` &
 *           `ScoreScraper.scrapeClassScores` thuần API với 0 lần gọi Chromium + giữ chốt `S2-05` không lùi về Playwright
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-phase1-v388-"));
const tokenDir = path.join(tmpRoot, "tokens");
const configDir = path.join(tmpRoot, "config");
fs.mkdirSync(tokenDir, { recursive: true });
fs.mkdirSync(configDir, { recursive: true });

(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.MINDX_DB_PATH = path.join(tmpRoot, "mindx_bot.db");
process.env.MINDX_RUNNING_CLASSES_PATH = path.join(tmpRoot, "running_classes.json");
process.env.MINDX_CONFIG_DIR = configDir;
process.env.ALLOWED_LOCAL_DIRS = tmpRoot;
process.env.MINDX_LMS_TOKEN_DIR = tokenDir;
process.env.MINDX_LMS_API_READ = "true";
process.env.MINDX_ALLOW_TEST_HOSTS = "1";
process.env.LMS_USERNAME = "teacher.p1test";
process.env.LMS_PASSWORD = "P1TeacherPassword#99";
process.env.ADMIN_LMS_USERNAME = "admin.p1test";
process.env.ADMIN_LMS_PASSWORD = "P1AdminPassword#99";

function makeUnsignedJwt(payload: Record<string, unknown>): string {
  const headerB64 = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString(
    "base64url"
  );
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.randomBytes(12).toString("base64url");
  return `${headerB64}.${payloadB64}.${sig}`;
}

async function main() {
  const lmsHttpMod = await import("../src/lib/lms/lms-http-client");
  const gqlQueriesMod = await import("../src/lib/lms/lms-graphql-queries");
  const redactorMod = await import("../src/lib/security/secret-redactor");
  const piiMod = await import("../src/lib/ai/pii-anonymizer");
  const syncMod = await import("../src/lib/playwright/sync-class");
  const scoreMod = await import("../src/lib/playwright/scrape-scores");
  const dlMod = await import("../src/lib/playwright/download-submissions");
  const adminScanMod = await import("../src/lib/admin-center/admin-lms-scanner");
  const browserMod = await import("../src/lib/playwright/browser-manager");
  const queueMod = await import("../src/lib/queue/task-queue");
  const sqliteMod = await import("../src/lib/db/sqlite");
  const jsonCfgMod = await import("../src/lib/db/json-config");

  const {
    createMindxDnsLookup,
    clearMindxDnsCacheForTest,
    fetchMindxResourceBuffer,
    fetchMindxResourceJson,
    isLmsApiReadEnabled,
    lmsHttpClient,
    resolveLmsTokenFilePath,
    selectBestFirebaseIdbCandidate,
    setLmsBootstrapHandlerForTest,
    setLmsHttpTransportForTest,
  } = lmsHttpMod;
  const { LMS_GET_CLASS_BY_ID_SAFE_QUERY } = gqlQueriesMod;
  const { redactSecrets } = redactorMod;
  const { createRosterNameScrubber, anonymizeSession14Text } = piiMod;
  const { ClassSyncer, parseSlotOrClassDateToEndOfDayMs } = syncMod;
  const { ScoreScraper } = scoreMod;
  const { SubmissionDownloader } = dlMod;
  const { scanAdminCenterClasses } = adminScanMod;
  const { BrowserManager } = browserMod;
  const { taskQueue } = queueMod;

  const bmInstance = BrowserManager.getInstance() as any;
  const origGetPage = bmInstance.getPage.bind(bmInstance);
  const origGetContext = bmInstance.getContext.bind(bmInstance);
  let browserGetPageCalls = 0;

  try {
    console.log("=== [v3.8.8] BẮT ĐẦU KIỂM THỬ ĐỢT 1 (PURE NODE LMS HTTP CLIENT) ===");

    // -------------------------------------------------------------------------
    // [P1-01] DNS Bypass Lookup & Strict TLS Verification Check
    // -------------------------------------------------------------------------
    const lookupFn = createMindxDnsLookup({
      lmsIp: "103.109.43.92",
      resourcesIp: "45.117.83.246",
    });

    await new Promise<void>((resolve, reject) => {
      lookupFn("lms-api.mindx.edu.vn", (err: Error | null, addr: string, family: number) => {
        try {
          assert.ifError(err);
          assert.equal(addr, "103.109.43.92");
          assert.equal(family, 4);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      lookupFn("lms.mindx.edu.vn", { all: true }, (err: Error | null, list: any[]) => {
        try {
          assert.ifError(err);
          assert.equal(Array.isArray(list), true);
          assert.equal(list[0].address, "103.109.43.92");
          assert.equal(list[0].family, 4);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      lookupFn("resources.mindx.edu.vn", (err: Error | null, addr: string, family: number) => {
        try {
          assert.ifError(err);
          assert.equal(addr, "45.117.83.246");
          assert.equal(family, 4);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });

    const httpClientSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/lms/lms-http-client.ts"),
      "utf8"
    );
    assert.ok(
      httpClientSrc.includes("rejectUnauthorized: true") &&
        httpClientSrc.includes("servername: parsed.hostname") &&
        !httpClientSrc.includes("rejectUnauthorized: false"),
      "Bắt buộc giữ kiểm tra chứng chỉ SSL/SNI chặt chẽ (rejectUnauthorized: true)"
    );
    console.log("  ✅ [P1-01] PASS: DNS bypass + TLS verification");

    // -------------------------------------------------------------------------
    // [P1-02] Auto-Refresh Token, Retry 401 (1x refresh -> 1x bootstrap),
    //         Teacher vs Admin Token Isolation & Pure FORBIDDEN Non-Retry Guard
    // -------------------------------------------------------------------------
    const nowSec = Math.floor(Date.now() / 1000);
    const expiredTeacherJwt = makeUnsignedJwt({
      email: "teacher.p1test@mindx.edu.vn",
      user_id: "uid_teacher_1",
      exp: nowSec - 600,
    });
    const refreshedTeacherJwt = makeUnsignedJwt({
      email: "teacher.p1test@mindx.edu.vn",
      user_id: "uid_teacher_1",
      exp: nowSec + 3600,
    });
    const bootstrappedTeacherJwt = makeUnsignedJwt({
      email: "teacher.p1test@mindx.edu.vn",
      user_id: "uid_teacher_1",
      exp: nowSec + 7200,
    });
    const adminJwt = makeUnsignedJwt({
      email: "admin.p1test@mindx.edu.vn",
      user_id: "uid_admin_1",
      exp: nowSec + 3600,
    });

    const teacherTokenPath = resolveLmsTokenFilePath("TEACHER");
    const adminTokenPath = resolveLmsTokenFilePath("ADMIN");
    assert.notEqual(teacherTokenPath, adminTokenPath);
    assert.ok(teacherTokenPath.endsWith("lms_token_teacher.json"));
    assert.ok(adminTokenPath.endsWith("lms_token_admin.json"));

    fs.writeFileSync(
      teacherTokenPath,
      JSON.stringify({
        role: "TEACHER",
        username: "teacher.p1test",
        email: "teacher.p1test@mindx.edu.vn",
        userId: "uid_teacher_1",
        firebaseApiKey: "AIzaSyFakeFirebaseApiKeyForUnitTest1234",
        idToken: expiredTeacherJwt,
        refreshToken: "refresh_teacher_v1",
        expiresAtMs: Date.now() - 60_000,
        updatedAt: new Date().toISOString(),
      }),
      "utf8"
    );
    fs.writeFileSync(
      adminTokenPath,
      JSON.stringify({
        role: "ADMIN",
        username: "admin.p1test",
        email: "admin.p1test@mindx.edu.vn",
        userId: "uid_admin_1",
        firebaseApiKey: "AIzaSyFakeAdminFirebaseKeyForUnitTest1",
        idToken: adminJwt,
        refreshToken: "refresh_admin_v1",
        expiresAtMs: Date.now() + 3600_000,
        updatedAt: new Date().toISOString(),
      }),
      "utf8"
    );

    let refreshCount = 0;
    let bootstrapCount = 0;
    let mockMode: "NORMAL" | "FORCE_401_THEN_BOOTSTRAPPED" | "GRAPHQL_FORBIDDEN" = "NORMAL";
    const seenAuthHeaders: Array<{ url: string; auth: string }> = [];

    setLmsBootstrapHandlerForTest(async (role) => {
      bootstrapCount++;
      assert.equal(role, "TEACHER");
      return {
        role: "TEACHER",
        username: "teacher.p1test",
        email: "teacher.p1test@mindx.edu.vn",
        userId: "uid_teacher_1",
        firebaseApiKey: "AIzaSyFakeFirebaseApiKeyForUnitTest1234",
        idToken: bootstrappedTeacherJwt,
        refreshToken: "refresh_teacher_bootstrapped",
        expiresAtMs: Date.now() + 7200_000,
        updatedAt: new Date().toISOString(),
      };
    });

    setLmsHttpTransportForTest(async ({ url, headers, body }) => {
      if (url.includes("securetoken.googleapis.com")) {
        refreshCount++;
        const bodyText = String(body || "");
        assert.ok(
          bodyText.includes("grant_type=refresh_token"),
          "Request gia hạn Firebase phải dùng grant_type=refresh_token"
        );
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({
              id_token: refreshedTeacherJwt,
              refresh_token: "refresh_teacher_v2",
              expires_in: "3600",
              user_id: "uid_teacher_1",
            })
          ),
        };
      }

      const authHeader = headers.authorization || headers.Authorization || "";
      seenAuthHeaders.push({ url, auth: authHeader });

      if (mockMode === "FORCE_401_THEN_BOOTSTRAPPED" && authHeader !== bootstrappedTeacherJwt) {
        return {
          status: 401,
          headers: { "content-type": "application/json" },
          body: Buffer.from(JSON.stringify({ errors: [{ message: "JWT expired" }] })),
        };
      }

      if (mockMode === "GRAPHQL_FORBIDDEN") {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({
              data: null,
              errors: [
                {
                  message: `Bạn không có quyền truy cập lớp này (token=${bootstrappedTeacherJwt})`,
                  extensions: { code: "FORBIDDEN" },
                },
              ],
            })
          ),
        };
      }

      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ data: { ping: authHeader === adminJwt ? "admin" : "teacher" } })),
      };
    });

    // Sub-case 2a: expired teacher token auto-refreshes via securetoken without calling Playwright bootstrap
    const teacherRes1 = await lmsHttpClient.gql<any>({
      role: "TEACHER",
      query: "query { ping }",
    });
    assert.equal(teacherRes1.data?.ping, "teacher");
    assert.equal(refreshCount, 1);
    assert.equal(bootstrapCount, 0);
    assert.equal(seenAuthHeaders[seenAuthHeaders.length - 1].auth, refreshedTeacherJwt);
    assert.ok(!seenAuthHeaders[seenAuthHeaders.length - 1].auth.startsWith("Bearer "));

    const updatedTeacherFile = JSON.parse(fs.readFileSync(teacherTokenPath, "utf8"));
    assert.equal(updatedTeacherFile.refreshToken, "refresh_teacher_v2");
    const intactAdminFile = JSON.parse(fs.readFileSync(adminTokenPath, "utf8"));
    assert.equal(intactAdminFile.refreshToken, "refresh_admin_v1", "Token ADMIN phải giữ nguyên độc lập");

    // Verify ADMIN role picks up admin token cleanly
    const adminRes = await lmsHttpClient.gql<any>({
      role: "ADMIN",
      query: "query { ping }",
    });
    assert.equal(adminRes.data?.ping, "admin");
    assert.equal(refreshCount, 1);

    // Sub-case 2b: LMS returns 401 -> tries refresh (1x) -> still 401 -> tries bootstrap (1x) -> succeeds
    mockMode = "FORCE_401_THEN_BOOTSTRAPPED";
    const retryRes = await lmsHttpClient.gql<any>({
      role: "TEACHER",
      query: "query { ping }",
    });
    assert.equal(retryRes.data?.ping, "teacher");
    assert.equal(refreshCount, 2, "Phải thử refresh đúng 1 lần khi 401");
    assert.equal(bootstrapCount, 1, "Refresh xong vẫn 401 phải gọi bootstrap đúng 1 lần");
    assert.equal(seenAuthHeaders[seenAuthHeaders.length - 1].auth, bootstrappedTeacherJwt);

    // Sub-case 2c: GraphQL FORBIDDEN permission error MUST NOT trigger refresh or bootstrap
    // AND F04: returned errors + thrown findClassByCode errors MUST be redacted
    mockMode = "GRAPHQL_FORBIDDEN";
    const forbiddenRes = await lmsHttpClient.gql<any>({
      role: "TEACHER",
      query: "query { ping }",
    });
    assert.equal(refreshCount, 2, "GraphQL FORBIDDEN phân quyền không được retry refresh");
    assert.equal(bootstrapCount, 1, "GraphQL FORBIDDEN phân quyền không được gọi bootstrap");
    assert.equal(Array.isArray(forbiddenRes.errors) && forbiddenRes.errors.length > 0, true);
    assert.ok(
      !JSON.stringify(forbiddenRes.errors).includes(bootstrappedTeacherJwt) &&
        !JSON.stringify(forbiddenRes.rawJson).includes(bootstrappedTeacherJwt),
      "F04: gql() HTTP 200 errors không được rò rỉ JWT thô"
    );

    await assert.rejects(
      () => lmsHttpClient.findClassByCode("TEACHER", "VT-LEAK-TEST"),
      (err: any) => {
        const msg = String(err?.message || err);
        assert.ok(!msg.includes(bootstrappedTeacherJwt), "findClassByCode không được rò JWT");
        return true;
      }
    );

    // Sub-case 2d (F01): Poisoned teacher token file holding ADMIN JWT MUST be rejected & re-bootstrapped
    fs.writeFileSync(
      teacherTokenPath,
      JSON.stringify({
        role: "TEACHER",
        username: "teacher.p1test",
        email: "teacher.p1test@mindx.edu.vn",
        userId: "uid_admin_wrong",
        firebaseApiKey: "AIzaSyFakeFirebaseApiKeyForUnitTest1234",
        idToken: adminJwt,
        refreshToken: "refresh_wrong_admin",
        expiresAtMs: Date.now() + 3600_000,
        updatedAt: new Date().toISOString(),
      }),
      "utf8"
    );
    const beforeWrongJwtBoot = bootstrapCount;
    const pickedValidTeacher = await lmsHttpClient.getValidTokenRecord("TEACHER");
    assert.equal(
      bootstrapCount,
      beforeWrongJwtBoot + 1,
      "F01: Không được chấp nhận JWT thuộc ADMIN nằm trong file TEACHER"
    );
    assert.equal(pickedValidTeacher.idToken, bootstrappedTeacherJwt);

    // Multi-row Firebase IndexedDB selector must pick ADMIN row[1] rather than blind row[0] TEACHER
    const pickedAdminCand = selectBestFirebaseIdbCandidate(
      [
        { email: "teacher.p1test@mindx.edu.vn", idToken: bootstrappedTeacherJwt, refreshToken: "ref_t" },
        { email: "admin.p1test@mindx.edu.vn", idToken: adminJwt, refreshToken: "ref_a" },
      ],
      "admin.p1test",
      ""
    );
    assert.equal(pickedAdminCand.picked?.refreshToken, "ref_a", "F01: IDB phải chọn đúng hàng ADMIN");

    // Sub-case 2e (F03): Apollo HTTP 400 schema validation error MUST fall back through SAFE query
    assert.ok(
      LMS_GET_CLASS_BY_ID_SAFE_QUERY.includes("commentAreaId") &&
        /\bslots\s*\{[\s\S]*\bindex\b/.test(LMS_GET_CLASS_BY_ID_SAFE_QUERY),
      "F03: LMS_GET_CLASS_BY_ID_SAFE_QUERY bắt buộc giữ commentAreaId và slots.index"
    );
    const seenOpsOn400: string[] = [];
    setLmsHttpTransportForTest(async ({ body }) => {
      const parsedBody = JSON.parse(String(body || "{}"));
      seenOpsOn400.push(String(parsedBody.operationName || ""));
      if (parsedBody.operationName === "GetClassById") {
        return {
          status: 400,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({
              errors: [{ message: 'Cannot query field "numberOfSessions" on type "Class".' }],
            })
          ),
        };
      }
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(
          JSON.stringify({
            data: {
              classesById: {
                id: "66f100000000000000000001",
                name: "VT-CSA-400SAFE",
                status: "RUNNING",
                students: [],
                slots: [{ _id: "S1", index: 1 }],
              },
            },
          })
        ),
      };
    });
    const safeRes400 = await lmsHttpClient.getClassById("TEACHER", "66f100000000000000000001");
    assert.equal(safeRes400.clsPayload?.name, "VT-CSA-400SAFE");
    assert.deepEqual(
      seenOpsOn400,
      ["GetClassById", "GetClassByIdSafe"],
      "F03: Apollo HTTP 400 phải kích hoạt fallback sang GetClassByIdSafe"
    );

    console.log("  ✅ [P1-02] PASS: Auto-refresh, 401/400 fallback, Token role lock (F01/F03/F04) & FORBIDDEN guard");

    // -------------------------------------------------------------------------
    // [P1-03] Runtime switch MINDX_LMS_API_READ, forcePlaywright, Fallback & QUEUE_STOPPED
    // -------------------------------------------------------------------------
    process.env.MINDX_LMS_API_READ = "false";
    assert.equal(isLmsApiReadEnabled(), false);
    process.env.MINDX_LMS_API_READ = "true";
    assert.equal(isLmsApiReadEnabled(), true);
    assert.equal(isLmsApiReadEnabled({ forcePlaywright: true }), false);
    assert.equal(isLmsApiReadEnabled({ testPage: {} }), false);

    // Force Playwright + Fallback spy
    bmInstance.getPage = async () => {
      browserGetPageCalls++;
      throw new Error("MOCK_BROWSER_INVOKED_AS_EXPECTED");
    };

    const prevBrowserCount = browserGetPageCalls;
    await assert.rejects(
      () =>
        ClassSyncer.syncClass("VT-TEST-FALLBACK", {
          forcePlaywright: true,
        }),
      /MOCK_BROWSER_INVOKED_AS_EXPECTED/
    );
    assert.equal(
      browserGetPageCalls,
      prevBrowserCount + 1,
      "forcePlaywright: true phải bỏ qua API và gọi Playwright"
    );

    // API error fallback -> falls back to Playwright
    setLmsHttpTransportForTest(async () => {
      throw new Error("SIMULATED_NETWORK_TIMEOUT");
    });
    const beforeFallbackCount = browserGetPageCalls;
    await assert.rejects(
      () => ClassSyncer.syncClass("VT-TEST-FALLBACK"),
      /MOCK_BROWSER_INVOKED_AS_EXPECTED/
    );
    assert.equal(
      browserGetPageCalls,
      beforeFallbackCount + 1,
      "Khi API lỗi không phải QUEUE_STOPPED phải tự động lùi về Playwright"
    );

    // QUEUE_STOPPED -> stops immediately WITHOUT invoking Playwright
    const beforeStopCount = browserGetPageCalls;
    taskQueue.stopQueue();
    try {
      const stopSyncRes = await ClassSyncer.syncClass("VT-TEST-STOP");
      assert.equal(stopSyncRes.success, false);
      assert.ok(stopSyncRes.error?.includes("QUEUE_STOPPED"));
      const stopScoreRes = await ScoreScraper.scrapeClassScores("VT-TEST-STOP");
      assert.equal(stopScoreRes.success, false);
      assert.ok(stopScoreRes.error?.includes("QUEUE_STOPPED"));
      assert.equal(
        browserGetPageCalls,
        beforeStopCount,
        "Stop Bot (QUEUE_STOPPED) phải dừng tức thì và KHÔNG gọi Playwright"
      );
    } finally {
      taskQueue.resumeQueue();
    }
    console.log("  ✅ [P1-03] PASS: Runtime switch, forcePlaywright, fallback & Stop Bot instant abort");

    // -------------------------------------------------------------------------
    // [P1-04] redactSecrets Comprehensive Secret/Token/Header/Cookie Masking
    // -------------------------------------------------------------------------
    const sampleJwt = makeUnsignedJwt({ email: "leak@mindx.edu.vn", sub: "12345" });
    const rawSensitive = [
      `auth=${sampleJwt}`,
      `Authorization: ${sampleJwt}`,
      `Authorization: Bearer ${sampleJwt}`,
      `{"authorization":"Bearer opaque_secret_999","customToken":"ctok_secret_777"}`,
      `POST https://securetoken.googleapis.com/v1/token?key=AIzaSyTestSecretKey1234567890123`,
      `POST https://example.com/v1/token?key=NonAizaKey123456`,
      `grant_type=refresh_token&refresh_token=super_secret_refresh_999&id_token=super_secret_id_888`,
      `Cookie: session=s%3Amindx_cookie_secret_val.abc123; theme=dark`,
      `{"firebaseApiKey":"AIzaSySecretJsonKey9999999999999"}`,
    ].join(" | ");
    const redacted = redactSecrets(rawSensitive);
    assert.ok(!redacted.includes(sampleJwt), "Không được để lọt JWT thô");
    assert.ok(!redacted.includes("opaque_secret_999"), "F04: Không được để lọt authorization Bearer opaque secret");
    assert.ok(!redacted.includes("NonAizaKey123456"), "F04: Không được để lọt query ?key= non-AIza");
    assert.ok(!redacted.includes("super_secret_refresh_999"), "Không được để lọt refresh_token=");
    assert.ok(!redacted.includes("super_secret_id_888"), "Không được để lọt id_token=");
    assert.ok(!redacted.includes("mindx_cookie_secret_val"), "Không được để lọt session= cookie");
    assert.ok(!redacted.includes("AIzaSySecretJsonKey"), "Không được để lọt firebaseApiKey");
    assert.ok(!redacted.includes("ctok_secret_777"), "Không được để lọt customToken");
    assert.ok(redacted.includes("[REDACTED_JWT]") || redacted.includes("[REDACTED]"));
    console.log("  ✅ [P1-04] PASS: redactSecrets che kín JWT/Authorization/key/session/refresh_token");

    // -------------------------------------------------------------------------
    // [P1-05] PII Anonymizer Phone/Email Precision (No False Positives on Dates/Scores/Files)
    // -------------------------------------------------------------------------
    const scrubber = createRosterNameScrubber(["Nguyễn Văn An", "Trần Bình"]);
    const rawTeacherNote =
      "Con Nguyễn Văn An ngày 05-11-2026 08:30 (05/11/2026 08:30, 2026-05-11 09:30, 05.11.2026 18.00) điểm 9.5/10 (0.0 1.5), lớp VT-C4K-CSA04, IP 103.109.43.92, tệp 1701234567890_app.py. SĐT mẹ: 0912345678, bố: 0912 345 678., (+84) 912 345 678, (028) 3822 1234, 09 1234 5678, cặp 0912345678/0987654321 và 0912345678-0987654321, máy bàn 0254 385 1234, email phuhuynh.an@gmail.com.";
    const scrubbedNote = scrubber(rawTeacherNote);
    assert.ok(!scrubbedNote.includes("Nguyễn Văn An"));
    assert.ok(!scrubbedNote.includes("0912345678"));
    assert.ok(!scrubbedNote.includes("0987654321"));
    assert.ok(!scrubbedNote.includes("0912 345 678"));
    assert.ok(!scrubbedNote.includes("3822 1234"));
    assert.ok(!scrubbedNote.includes("1234 5678"));
    assert.ok(!scrubbedNote.includes("0254 385 1234"));
    assert.ok(!scrubbedNote.includes("phuhuynh.an@gmail.com"));
    assert.ok(scrubbedNote.includes("[REDACTED_PHONE]."), "Phải giữ dấu chấm cuối câu sau SĐT");
    assert.ok(scrubbedNote.includes("[REDACTED_PHONE]/[REDACTED_PHONE]"), "F06: Phải che cặp 2 SĐT nối dấu /");
    assert.ok(scrubbedNote.includes("[REDACTED_PHONE]-[REDACTED_PHONE]"), "F06: Phải che cặp 2 SĐT nối dấu -");
    assert.ok(scrubbedNote.includes("[REDACTED_EMAIL]"));
    assert.ok(scrubbedNote.includes("05-11-2026 08:30"), "Không che nhầm ngày giờ gạch ngang");
    assert.ok(scrubbedNote.includes("05/11/2026 08:30"), "Không che nhầm ngày giờ gạch chéo");
    assert.ok(scrubbedNote.includes("2026-05-11 09:30"), "Không che nhầm ngày ISO");
    assert.ok(scrubbedNote.includes("05.11.2026 18.00"), "Không che nhầm ngày dấu chấm");
    assert.ok(scrubbedNote.includes("9.5/10"), "Không che nhầm điểm số");
    assert.ok(scrubbedNote.includes("0.0 1.5"), "Không che nhầm chuỗi số thập phân");
    assert.ok(scrubbedNote.includes("VT-C4K-CSA04"), "Không che nhầm mã lớp");
    assert.ok(scrubbedNote.includes("103.109.43.92"), "Không che nhầm IP");
    assert.ok(scrubbedNote.includes("1701234567890_app.py"), "Không che nhầm tên file có timestamp");

    const s14Raw =
      "Em Bình lớp VT-C4K-CSA04 nộp 1701234567890_app.py ngày 12/11/2026, SĐT gia đình 0987 654 321 hoặc (+84) 987 654 321, email me.binh@yahoo.com, điểm 4.5.";
    const s14Anon = anonymizeSession14Text(
      s14Raw,
      "Trần Bình",
      "Bình",
      "STUDENT_02",
      "STUDENT_02_SHORT",
      ["Nguyễn Văn An"]
    );
    assert.ok(!s14Anon.includes("0987 654 321"));
    assert.ok(!s14Anon.includes("654 321"));
    assert.ok(!s14Anon.includes("me.binh@yahoo.com"));
    assert.ok(s14Anon.includes("[REDACTED_PHONE]"));
    assert.ok(s14Anon.includes("[REDACTED_EMAIL]"));
    assert.ok(s14Anon.includes("12/11/2026") && s14Anon.includes("4.5") && s14Anon.includes("1701234567890_app.py"));
    console.log("  ✅ [P1-05] PASS: pii-anonymizer che đủ SĐT (cả cặp /,- và ngoặc)/Email, 0 false-positive");

    // -------------------------------------------------------------------------
    // [P1-06] Resource Downloader Guards + Pure-Node E2E syncClass & scrapeClassScores (0 Browser Calls)
    // -------------------------------------------------------------------------
    let evilFetchCalled = 0;
    setLmsHttpTransportForTest(async ({ url }) => {
      if (url.includes("evil.example.com")) {
        evilFetchCalled++;
      }
      if (url.startsWith("https://resources.mindx.edu.vn/api/v1/get-presigned-url")) {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({ url: "https://s3.ap-southeast-1.amazonaws.com/bucket/hop1.py" })
          ),
        };
      }
      if (url === "https://s3.ap-southeast-1.amazonaws.com/bucket/hop1.py") {
        return {
          status: 302,
          headers: { location: "https://s3.ap-southeast-1.amazonaws.com/bucket/hop2.py" },
          body: Buffer.alloc(0),
        };
      }
      if (url === "https://s3.ap-southeast-1.amazonaws.com/bucket/hop2.py") {
        return {
          status: 200,
          headers: {},
          body: Buffer.from("print('hello phase1')\n"),
        };
      }
      if (url.includes("redirect-evil.py")) {
        return {
          status: 302,
          headers: { location: "https://evil.example.com/steal.py" },
          body: Buffer.alloc(0),
        };
      }
      if (url.includes("too-many-hops")) {
        return {
          status: 302,
          headers: { location: "https://s3.ap-southeast-1.amazonaws.com/bucket/too-many-hops?n=next" },
          body: Buffer.alloc(0),
        };
      }
      if (url.includes("oversize-file.zip")) {
        return {
          status: 200,
          headers: { "content-length": String(26 * 1024 * 1024) },
          body: Buffer.from("x"),
        };
      }
      return { status: 404, headers: {}, body: Buffer.alloc(0) };
    });

    const isAllowed = (u: string) => (SubmissionDownloader as any).isAllowedDownloadUrl(u);
    const blockedJson = await fetchMindxResourceJson("https://evil.example.com/data.json", {
      isAllowedUrl: isAllowed,
    });
    assert.equal(blockedJson.status, 0);
    assert.equal(blockedJson.data, null);

    const presignOk = await fetchMindxResourceJson<{ url?: string }>(
      "https://resources.mindx.edu.vn/api/v1/get-presigned-url?key=abc.py",
      { isAllowedUrl: isAllowed }
    );
    assert.equal(presignOk.status, 200);
    assert.ok(presignOk.data?.url?.includes("amazonaws.com"));

    const bufOk = await fetchMindxResourceBuffer(presignOk.data!.url!, {
      label: "hop1.py",
      isAllowedUrl: isAllowed,
    });
    assert.equal(bufOk?.toString("utf8"), "print('hello phase1')\n");

    const bufEvilRedir = await fetchMindxResourceBuffer(
      "https://s3.ap-southeast-1.amazonaws.com/bucket/redirect-evil.py",
      { isAllowedUrl: isAllowed }
    );
    assert.equal(bufEvilRedir, null);
    assert.equal(evilFetchCalled, 0, "Chuyển hướng sang host ngoài allowlist phải bị chặn trước khi request");

    const bufTooMany = await fetchMindxResourceBuffer(
      "https://s3.ap-southeast-1.amazonaws.com/bucket/too-many-hops",
      { maxRedirects: 3, isAllowedUrl: isAllowed }
    );
    assert.equal(bufTooMany, null, "Quá 3 lần redirect phải trả về null");

    await assert.rejects(
      () =>
        fetchMindxResourceBuffer(
          "https://s3.ap-southeast-1.amazonaws.com/bucket/oversize-file.zip",
          { label: "oversize-file.zip", isAllowedUrl: isAllowed }
        ),
      /25MB/
    );

    // Pure-Node E2E syncClass + scrapeClassScores with 0 Playwright calls
    const p1ClassCode = "VT-CSA-P1TEST";
    const p1LmsId = "66f100000000000000000001";
    jsonCfgMod.saveLmsClassIdMapping(p1ClassCode, p1LmsId);

    let simulateDuplicateCrmConflict = false;
    setLmsHttpTransportForTest(async ({ url, body }) => {
      if (!url.includes("lms-api.mindx.edu.vn")) {
        return { status: 404, headers: {}, body: Buffer.alloc(0) };
      }
      const reqJson = JSON.parse(String(body || "{}"));
      const op = reqJson.operationName;
      if (op === "GetClassById") {
        const studentsList = simulateDuplicateCrmConflict
          ? [
              { activeInClass: true, student: { id: "CRM_S1", fullName: "Nguyễn Trùng Tên" } },
              { activeInClass: true, student: { id: "CRM_S2", fullName: "Nguyễn Trùng Tên" } },
            ]
          : [
              { activeInClass: true, student: { id: "CRM_S1", fullName: "Nguyễn Minh An" } },
              { activeInClass: true, student: { id: "CRM_S2", fullName: "Lê Quốc Bảo" } },
            ];
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({
              data: {
                classesById: {
                  id: p1LmsId,
                  name: p1ClassCode,
                  status: "RUNNING",
                  startDate: "2026-10-01T00:00:00.000Z",
                  endDate: "2027-01-20T00:00:00.000Z",
                  course: { id: "CRS_1", name: "Computer Science Advance", shortName: "CSA" },
                  centre: { id: "CTR_1", name: "Vũng Tàu", shortName: "VT" },
                  teachers: [
                    { role: { name: "Teacher" }, teacher: { id: "T1", fullName: "Thầy Quang", username: "teacher.p1test" } },
                  ],
                  students: studentsList,
                  slots: [
                    {
                      _id: "SLOT_01",
                      index: 1,
                      date: "2026-10-01T00:00:00.000Z",
                      startTime: "18:00",
                      endTime: "20:00",
                      summary: "Buổi 1: Python Ôn tập",
                      homework: "Bài tập Buổi 1",
                      studentAttendance: [
                        {
                          status: "PRESENT",
                          comment: "",
                          sendCommentStatus: "PENDING",
                          commentByAreas: [],
                          student: { id: "CRM_S1", fullName: "Nguyễn Minh An" },
                        },
                      ],
                    },
                  ],
                },
              },
            })
          ),
        };
      }
      if (op === "FindStudentSubmissionByClass") {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({
              data: {
                findStudentSubmissionByClass: {
                  lessons: [
                    { id: "LES_1", name: "Homework 1", type: "REVIEW_AND_PRACTICE", displayOrder: 1 },
                  ],
                  students: [
                    { id: "CRM_S1", studentUid: "UID_S1", displayName: "Nguyễn Minh An" },
                    { id: "CRM_S2", studentUid: "UID_S2", displayName: "Lê Quốc Bảo" },
                  ],
                  submissions: [
                    {
                      id: "SUB_S1_1",
                      lessonId: "LES_1",
                      studentUid: "UID_S1",
                      category: "PRACTICE",
                      status: "MARKED",
                      score: 95,
                      submittedAt: "2026-10-05T10:00:00.000Z",
                      content: { attachments: ["1700000000000_main.py"] },
                    },
                  ],
                },
              },
            })
          ),
        };
      }
      return { status: 404, headers: {}, body: Buffer.alloc(0) };
    });

    const browserCallsBeforeApiE2E = browserGetPageCalls;
    const apiSyncRes = await ClassSyncer.syncClass(p1ClassCode);
    assert.equal(apiSyncRes.success, true, `syncClass API failed: ${apiSyncRes.error}`);
    assert.equal(apiSyncRes.studentsCount, 2);
    assert.equal(apiSyncRes.sessionsCount, 1);
    assert.equal(apiSyncRes.students[0].studentId, "STU_VT-CSA-P1TEST_NGUYEN_MINH_AN");

    const apiScoreRes = await ScoreScraper.scrapeClassScores(p1ClassCode);
    assert.equal(apiScoreRes.success, true, `scrapeClassScores API failed: ${apiScoreRes.error}`);
    assert.equal(apiScoreRes.rows.length, 2);
    assert.equal(apiScoreRes.columns.length, 1);
    assert.equal(apiScoreRes.rows[0].cells["LES_1"].score, 95);

    const quickMatrix = await ScoreScraper.buildQuickMatrixFromSubmissionGql({
      classId: p1ClassCode,
      classCode: p1ClassCode,
      lmsClassId: p1LmsId,
      submissionGqlData: {
        lessons: [{ id: "LES_1", name: "Homework 1", type: "REVIEW_AND_PRACTICE", displayOrder: 1 }],
        students: [
          { id: "CRM_S1", studentUid: "UID_S1", displayName: "Nguyễn Minh An" },
          { id: "CRM_S2", studentUid: "UID_S2", displayName: "Lê Quốc Bảo" },
        ],
        submissions: [],
      },
    });
    assert.equal(quickMatrix.success, true);
    assert.equal(quickMatrix.rows.length, 2);

    assert.equal(
      browserGetPageCalls,
      browserCallsBeforeApiE2E,
      "Luồng syncClass + scrapeClassScores qua API thuần không được mở Chromium (0 browser calls)"
    );

    // Ensure S2-05 duplicate identity error from processAndPersistScrapedGqlData NEVER falls back to Playwright
    simulateDuplicateCrmConflict = true;
    const dupRes = await ScoreScraper.scrapeClassScores(p1ClassCode);
    assert.equal(dupRes.success, false);
    assert.ok(dupRes.error && /trùng tên|ánh xạ/i.test(dupRes.error), `Actual error: ${dupRes.error}`);
    assert.equal(
      browserGetPageCalls,
      browserCallsBeforeApiE2E,
      "Lỗi nghiệp vụ S2-05 sau khi API tải thành công KHÔNG được lùi về Playwright"
    );

    console.log("  ✅ [P1-06] PASS: Resource download guards + Pure-Node E2E (0 Chromium) + S2-05 no-fallback guard");

    // -------------------------------------------------------------------------
    // [P1-07] Neon XHigh Audit Remediations: F02 (Epoch + Wipe Guard), F05 (Admin Discovery Fallback),
    //         F07 (Download classId check + QUEUE_STOPPED abort), F08 (Malformed Redirect Location)
    // -------------------------------------------------------------------------
    // F08.2: Malformed redirect Location must return null gracefully instead of throwing TypeError
    setLmsHttpTransportForTest(async () => ({
      status: 302,
      headers: { location: "http://[::invalid" },
      body: Buffer.alloc(0),
    }));
    const badRedirBuf = await fetchMindxResourceBuffer(
      "https://s3.ap-southeast-1.amazonaws.com/bucket/bad-redir.py",
      { isAllowedUrl: isAllowed }
    );
    assert.equal(badRedirBuf, null, "F08: Location redirect sai cú pháp phải trả về null");

    // F02.1: Epoch 10-digit & 13-digit timestamps in parseSlotOrClassDateToEndOfDayMs & syncClass
    assert.ok(parseSlotOrClassDateToEndOfDayMs(1760000000) !== null, "F02: Phải parse epoch 10 chữ số (number)");
    assert.ok(parseSlotOrClassDateToEndOfDayMs("1760604800000") !== null, "F02: Phải parse epoch 13 chữ số (string)");

    const epochNowMs = Date.now();
    const epochSlot1Sec = Math.floor((epochNowMs - 8 * 86400_000) / 1000);
    const epochSlot2MsStr = String(epochNowMs - 86400_000);
    const epochSlot3Ms = epochNowMs + 6 * 86400_000;
    const epochClassCode = "VT-CSA-EPOCH";
    const epochLmsId = "66f100000000000000000002";
    jsonCfgMod.saveLmsClassIdMapping(epochClassCode, epochLmsId);
    setLmsHttpTransportForTest(async ({ url, body }) => {
      if (!url.includes("lms-api.mindx.edu.vn")) {
        return { status: 404, headers: {}, body: Buffer.alloc(0) };
      }
      const reqJson = JSON.parse(String(body || "{}"));
      if (reqJson.operationName === "GetClassById") {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({
              data: {
                classesById: {
                  id: epochLmsId,
                  name: epochClassCode,
                  status: "RUNNING",
                  startDate: epochSlot1Sec,
                  endDate: String(epochNowMs + 60 * 86400_000),
                  course: { id: "CRS_E", name: "Computer Science Advance" },
                  teachers: [],
                  students: [
                    { activeInClass: true, student: { id: "E_S1", fullName: "Trần Minh Epoch" } },
                  ],
                  slots: [
                    {
                      _id: "E_SLOT_1",
                      index: 0,
                      date: epochSlot1Sec,
                      startTime: "18:00",
                      endTime: "20:00",
                      summary: "Buổi 1 Epoch",
                      homework: "HW1",
                      studentAttendance: [
                        { status: "PRESENT", comment: "", student: { id: "E_S1", fullName: "Trần Minh Epoch" } },
                      ],
                    },
                    {
                      _id: "E_SLOT_2",
                      index: 1,
                      date: epochSlot2MsStr,
                      startTime: "18:00",
                      endTime: "20:00",
                      summary: "Buổi 2 Epoch",
                      homework: "HW2",
                      studentAttendance: [
                        { status: "PRESENT", comment: "", student: { id: "E_S1", fullName: "Trần Minh Epoch" } },
                      ],
                    },
                    {
                      _id: "E_SLOT_3",
                      index: 2,
                      date: epochSlot3Ms,
                      startTime: "18:00",
                      endTime: "20:00",
                      summary: "Buổi 3 Epoch",
                      homework: "HW3",
                      studentAttendance: [],
                    },
                  ],
                },
              },
            })
          ),
        };
      }
      return { status: 404, headers: {}, body: Buffer.alloc(0) };
    });

    const epochSync = await ClassSyncer.syncClass(epochClassCode);
    assert.equal(epochSync.success, true, `F02 Epoch sync failed: ${epochSync.error}`);
    assert.ok(epochSync.sessions[0]?.date && epochSync.sessions[1]?.date, "F02: Epoch slot dates phải được giải mã");
    assert.equal(epochSync.latestActiveSessionId, "VT-CSA-EPOCH_SESS_02", "F02: Phải tiến lên SESS_02");

    // F02.2: fetchRunningClassesViaApi must NOT wipe running_classes.json when RUNNING=[]/total=null & FINISHED=errors
    jsonCfgMod.saveRunningClasses([
      { classCode: "VT-EXISTING-SAFE", status: "Running", courseName: "Keep Me", center: "205ALHP" },
    ]);
    setLmsHttpTransportForTest(async ({ body }) => {
      const parsed = JSON.parse(String(body || "{}"));
      const st = parsed?.variables?.payload?.status_in || [];
      if (st.includes("RUNNING")) {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(JSON.stringify({ data: { classes: { data: [], pagination: null } } })),
        };
      }
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ data: null, errors: [{ message: "FINISHED schema failure" }] })),
      };
    });
    const beforeWipeGuardCalls = browserGetPageCalls;
    await assert.rejects(
      () => ClassSyncer.fetchRunningClasses({ persistToConfig: true }),
      /MOCK_BROWSER_INVOKED_AS_EXPECTED/
    );
    assert.equal(
      browserGetPageCalls,
      beforeWipeGuardCalls + 1,
      "F02: Khi RUNNING rỗng/total=null & FINISHED lỗi phải lùi về Playwright"
    );
    const preservedList = jsonCfgMod.getRunningClasses();
    assert.equal(preservedList.length, 1);
    assert.equal(preservedList[0].classCode, "VT-EXISTING-SAFE", "F02: Không được xóa trắng running_classes.json");

    // F05: scanAdminCenterClasses falls back to Playwright Admin Session when Node API discovery fails with HTTP 200 GraphQL errors
    fs.writeFileSync(
      adminTokenPath,
      JSON.stringify({
        role: "ADMIN",
        username: "admin.p1test",
        email: "admin.p1test@mindx.edu.vn",
        userId: "uid_admin_1",
        firebaseApiKey: "AIzaSyFakeAdminFirebaseKeyForUnitTest1",
        idToken: makeUnsignedJwt({
          email: "admin.p1test@mindx.edu.vn",
          user_id: "uid_admin_1",
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
        refreshToken: "refresh_admin_v1",
        expiresAtMs: Date.now() + 3600_000,
        updatedAt: new Date().toISOString(),
      }),
      "utf8"
    );
    setLmsHttpTransportForTest(async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ data: null, errors: [{ message: "Internal LMS schema error" }] })),
    }));
    const { authService } = await import("../src/lib/playwright/auth");
    const origCaptureSnap = (authService as any).captureMindxRoleSnapshot;
    let adminFallbackCalls = 0;
    let adminSessionEntries = 0;
    (authService as any).captureMindxRoleSnapshot = async (...args: any[]) => {
      adminSessionEntries++;
      return await origCaptureSnap.apply(authService, args);
    };
    bmInstance.getContext = async () => {
      adminFallbackCalls++;
      throw new Error("MOCK_ADMIN_BROWSER_FALLBACK");
    };
    bmInstance.getPage = async () => {
      adminFallbackCalls++;
      throw new Error("MOCK_ADMIN_BROWSER_FALLBACK");
    };
    let f05ScanRes: any;
    try {
      f05ScanRes = await scanAdminCenterClasses({
        scope: "SINGLE_CLASS",
        classCode: p1ClassCode,
        centerCode: "205ALHP",
        teachingDeps: {
          httpClient: {
            getHtmlPage: async () => "<html><body></body></html>",
          } as any,
        },
      });
    } finally {
      (authService as any).captureMindxRoleSnapshot = origCaptureSnap;
    }
    assert.equal(f05ScanRes.success, false);
    assert.ok(adminFallbackCalls >= 1, "F05: Discovery GraphQL HTTP 200 lỗi phải kích hoạt Playwright fallback Admin");
    assert.equal(
      adminSessionEntries,
      1,
      "R2-F01: Khi fallback Playwright Admin gặp lỗi chỉ được gọi runPlaywrightAdminBundle() đúng 1 lần"
    );
    assert.equal(
      f05ScanRes.warnings?.length,
      1,
      "R2-F01: Chỉ được ghi đúng 1 cảnh báo fallback (không bắt đúp lỗi Playwright)"
    );

    // F07: download-submissions forceScrapeMatrix: false classId mismatch + QUEUE_STOPPED immediate abort
    bmInstance.getPage = origGetPage;
    bmInstance.getContext = origGetContext;
    const f07Class = "VT-CSA-F07TEST";
    const f07LmsId = "66f100000000000000000007";
    jsonCfgMod.saveLmsClassIdMapping(f07Class, f07LmsId);
    setLmsHttpTransportForTest(async ({ url }) => {
      if (url.includes("lms-api.mindx.edu.vn")) {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({
              data: {
                findStudentSubmissionByClass: {
                  classId: "66f100000000000000009999",
                  lessons: [{ id: "LES_F07", name: "Homework 1", type: "REVIEW_AND_PRACTICE", displayOrder: 1 }],
                  students: [{ id: "S_W", studentUid: "S_W", displayName: "Wrong Class Student" }],
                  submissions: [],
                },
              },
            })
          ),
        };
      }
      return { status: 404, headers: {}, body: Buffer.alloc(0) };
    });
    const f07MismatchDl = await SubmissionDownloader.downloadLessonSubmissions({
      classId: f07Class,
      classCode: f07Class,
      sessionId: `${f07Class}_SESS_01`,
      forceScrapeMatrix: false,
    });
    assert.equal(f07MismatchDl.success, false);
    assert.ok(
      f07MismatchDl.error?.includes("classId") || f07MismatchDl.error?.includes("Integrity Violation"),
      `F07: Phải chặn sai classId ở nhánh forceScrapeMatrix=false (actual=${f07MismatchDl.error})`
    );

    // F07.2: Stop Bot inside per-student download loop must abort immediately instead of continuing loop
    sqliteMod.scoreMatrixRepo.save(f07Class, {
      success: true,
      classId: f07Class,
      classCode: f07Class,
      lmsClassId: f07LmsId,
      columns: [
        { colIndex: 0, columnId: "LES_F07", lessonId: "LES_F07", title: "Homework 1", sessionNumber: 1 },
      ],
      rows: [
        {
          studentId: "STU_1",
          fullName: "Học Viên Một",
          isActive: true,
          cells: {
            LES_F07: {
              columnId: "LES_F07",
              lessonId: "LES_F07",
              sessionNumber: 1,
              status: "SUBMITTED_UNGRADED",
              score: null,
              maxScore: 100,
              submissionId: "SUB_STOP_1",
              attachments: ["1700000000001_a.py"],
              rawText: "Chưa chấm",
            },
          },
          averageScore: null,
          gradedCount: 0,
          submittedUngradedCount: 1,
          notSubmittedCount: 0,
          redoCount: 0,
        },
        {
          studentId: "STU_2",
          fullName: "Học Viên Hai",
          isActive: true,
          cells: {
            LES_F07: {
              columnId: "LES_F07",
              lessonId: "LES_F07",
              sessionNumber: 1,
              status: "SUBMITTED_UNGRADED",
              score: null,
              maxScore: 100,
              submissionId: "SUB_STOP_2",
              attachments: ["1700000000002_b.py"],
              rawText: "Chưa chấm",
            },
          },
          averageScore: null,
          gradedCount: 0,
          submittedUngradedCount: 1,
          notSubmittedCount: 0,
          redoCount: 0,
        },
      ],
      summary: {
        totalStudents: 2,
        totalColumns: 1,
        gradedCells: 0,
        submittedUngradedCells: 2,
        notSubmittedCells: 0,
        redoCells: 0,
        zeroScoreCells: 0,
      },
      scrapedAt: new Date().toISOString(),
    });

    let presignDownloadAttempts = 0;
    setLmsHttpTransportForTest(async ({ url }) => {
      if (url.includes("resources.mindx.edu.vn/api/v1/get-presigned-url")) {
        presignDownloadAttempts++;
        taskQueue.stopQueue();
      }
      return { status: 404, headers: {}, body: Buffer.alloc(0) };
    });
    const f07StopDl = await SubmissionDownloader.downloadLessonSubmissions({
      classId: f07Class,
      classCode: f07Class,
      sessionId: `${f07Class}_SESS_01`,
      forceScrapeMatrix: false,
    });
    assert.equal(f07StopDl.success, false);
    assert.ok(f07StopDl.error?.includes("QUEUE_STOPPED"));
    assert.equal(
      presignDownloadAttempts,
      1,
      "F07: Bấm Stop Bot giữa chừng phải thoát ngay vòng lặp sau học viên thứ 1"
    );
    taskQueue.resumeQueue();

    console.log("  ✅ [P1-07] PASS: Toàn bộ kiểm thử hồi quy Neon XHigh F02/F05/F07/F08 đều xanh");
    console.log("\n🎉 TOÀN BỘ 7 NHÓM KIỂM THỬ ĐỢT 1 ([P1-01]..[P1-07]) ĐỀU PASS 100%!");
  } finally {
    bmInstance.getPage = origGetPage;
    bmInstance.getContext = origGetContext;
    setLmsHttpTransportForTest(null);
    setLmsBootstrapHandlerForTest(null);
    clearMindxDnsCacheForTest();
    taskQueue.resumeQueue();
    try {
      (sqliteMod as any).closeDb?.();
    } catch {}
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error("❌ KIỂM THỬ ĐỢT 1 THẤT BẠI:", err);
  process.exit(1);
});
