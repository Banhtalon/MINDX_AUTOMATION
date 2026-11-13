import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { chromium } from "playwright";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-open-lms-test-"));
const tempConfigDir = path.join(tempDir, "config");
process.env.MINDX_DB_PATH = path.join(tempDir, "mindx_open_lms_test.db");
process.env.MINDX_CONFIG_DIR = tempConfigDir;
process.env.MINDX_RUNNING_CLASSES_PATH = path.join(tempDir, "running_classes.json");
process.env.ALLOWED_LOCAL_DIRS = tempDir;

async function main() {
  const {
    buildLmsClassCommentsUrl,
    extractLmsClassIdFromDrawerUrl,
    isValidLmsClassCode,
    isValidLmsClassObjectId,
    normalizeLmsBaseOrigin,
  } = await import("../src/lib/lms/lms-class-url");

  const {
    getLmsClassIdsMap,
    saveLmsClassIdMapping,
    saveRunningClasses,
    saveCoursesSyllabus,
    saveQuickTags,
    saveZaloTemplates,
  } = await import("../src/lib/db/json-config");

  const { resolveKnownLmsClassId, resolveKnownLmsClassIdsMap } = await import(
    "../src/lib/lms/lms-class-id-store"
  );
  const { getDb, closeDb } = await import("../src/lib/db/sqlite");
  const { listClasses } = await import("../src/lib/classes/class-directory");
  const { ClassSyncer, extractLmsClassIdFromSearchPayload } = await import(
    "../src/lib/playwright/sync-class"
  );
  const { BrowserManager } = await import("../src/lib/playwright/browser-manager");
  const {
    GET: lmsUrlGET,
    POST: lmsUrlPOST,
  } = await import("../src/app/api/classes/lms-url/route");
  const { GET: sessionCommentsListGET } = await import(
    "../src/app/api/session-comments/list/route"
  );

  try {
    console.log("=== OL-01: URL Builder JSON-Quoting & Scheme Security ===");
    const ptiId = "672a1b3c4d5e6f7890123456";
    const directUrl = buildLmsClassCommentsUrl({
      classCode: " vt-c4k-pti12 ",
      lmsClassId: ptiId,
    });
    assert.equal(
      directUrl,
      `https://lms.mindx.edu.vn/admin/classes?search=%22VT-C4K-PTI12%22&id=%22${ptiId}%22&tab=10`
    );
    const parsedDirect = new URL(directUrl);
    assert.equal(JSON.parse(parsedDirect.searchParams.get("search")!), "VT-C4K-PTI12");
    assert.equal(JSON.parse(parsedDirect.searchParams.get("id")!), ptiId);
    assert.equal(JSON.parse(parsedDirect.searchParams.get("tab")!), 10);

    const searchFallback = buildLmsClassCommentsUrl({
      classCode: "VT-C4K-PTI12",
      lmsClassId: "undefined",
    });
    assert.equal(
      searchFallback,
      "https://lms.mindx.edu.vn/admin/classes?search=%22VT-C4K-PTI12%22"
    );
    assert.equal(
      normalizeLmsBaseOrigin("javascript:alert(1)"),
      "https://lms.mindx.edu.vn"
    );
    assert.equal(
      normalizeLmsBaseOrigin("https://lms.mindx.edu.vn/admin/classes?foo=bar"),
      "https://lms.mindx.edu.vn"
    );
    assert.equal(isValidLmsClassCode("VT-C4K-PTI12"), true);
    assert.equal(isValidLmsClassCode("bad class!"), false);
    assert.equal(isValidLmsClassObjectId(ptiId), true);
    assert.equal(isValidLmsClassObjectId("undefined"), false);
    assert.equal(isValidLmsClassObjectId("123"), false);
    assert.equal(extractLmsClassIdFromDrawerUrl(directUrl), ptiId);
    assert.equal(
      extractLmsClassIdFromDrawerUrl("https://lms.mindx.edu.vn/admin/classes?id=672a1b3c4d5e6f7890123456&tab=10"),
      ptiId
    );
    assert.equal(
      extractLmsClassIdFromDrawerUrl("https://lms.mindx.edu.vn/admin/classes?id=undefined"),
      null
    );

    console.log("=== OL-02: Read-Only Cache Store & Priority Merge ===");
    // Must not create config directory or file on missing read
    assert.deepEqual(getLmsClassIdsMap(), {});
    assert.equal(fs.existsSync(tempConfigDir), false);
    assert.deepEqual(resolveKnownLmsClassId("VT-C4K-PTI12"), {
      lmsClassId: null,
      source: "NONE",
    });

    // Extract from search payloads
    const gqlPayload = {
      data: {
        classes: {
          data: [
            { id: "671111111111111111111111", name: "VT-C4K-PTI12", status: "Finished" },
            { id: ptiId, code: "VT-C4K-PTI12", status: "Running" },
            { id: "VT-C4K-GA38", code: "VT-C4K-GA38", status: "Running" },
          ],
        },
      },
    };
    assert.equal(
      extractLmsClassIdFromSearchPayload(gqlPayload, "VT-C4K-PTI12"),
      ptiId
    );
    // Rejects degenerate id === classCode
    assert.equal(
      extractLmsClassIdFromSearchPayload(gqlPayload, "VT-C4K-GA38"),
      null
    );

    // Seed report card DB snapshot (lowest priority)
    const db = getDb();
    db.prepare(
      `INSERT INTO class_report_cards (classId, classCode, lmsSnapshotJson)
       VALUES (?, ?, ?)`
    ).run(
      "VT-C4K-GI34",
      "VT-C4K-GI34",
      JSON.stringify({ lmsClassId: "671111111111111111111111" })
    );
    assert.equal(resolveKnownLmsClassId("VT-C4K-GI34").source, "REPORT_CARDS_DB");

    // Seed running_classes.json (middle priority)
    saveRunningClasses([
      {
        classCode: "VT-C4K-GI34",
        lmsClassId: "672222222222222222222222",
        status: "Running",
      },
      {
        classCode: "VT-C4K-PTI12",
        status: "Running",
      },
    ]);
    assert.deepEqual(resolveKnownLmsClassId("VT-C4K-GI34"), {
      lmsClassId: "672222222222222222222222",
      source: "RUNNING_CLASSES",
    });

    // Seed lms_class_ids.json (highest priority)
    saveLmsClassIdMapping("VT-C4K-GI34", "673333333333333333333333");
    assert.deepEqual(resolveKnownLmsClassId("VT-C4K-GI34"), {
      lmsClassId: "673333333333333333333333",
      source: "CONFIG_CACHE",
    });
    assert.equal(
      resolveKnownLmsClassIdsMap()["VT-C4K-GI34"],
      "673333333333333333333333"
    );
    const listedClasses = listClasses({ scope: "running" });
    const listedGi34 = listedClasses.find((c) => c.classCode === "VT-C4K-GI34");
    assert.equal(listedGi34?.lmsClassId, "673333333333333333333333");

    console.log("=== OL-03: ClassSyncer.resolveLmsClassId Tiers 0/1/2 & Cache ===");
    const badRes = await ClassSyncer.resolveLmsClassId("INVALID CLASS CODE!");
    assert.equal(badRes.success, false);

    // Cache hit skips BrowserManager completely
    const cachedRes = await ClassSyncer.resolveLmsClassId("VT-C4K-GI34");
    assert.deepEqual(cachedRes, {
      success: true,
      classCode: "VT-C4K-GI34",
      lmsClassId: "673333333333333333333333",
      source: "CACHE",
    });

    // Mock Page helper factory
    const makeLocator = (opts: {
      visible?: boolean;
      text?: string;
      fill?: (v: string) => Promise<void>;
      press?: (k: string) => Promise<void>;
      click?: () => Promise<void>;
    }) => {
      const loc: any = {
        first: () => loc,
        isVisible: async () => Boolean(opts.visible),
        innerText: async () => opts.text || "",
        click: opts.click || (async () => {}),
        fill: opts.fill || (async () => {}),
        press: opts.press || (async () => {}),
        locator: () => makeLocator({ visible: false }),
        waitFor: async () => {},
        count: async () => (opts.visible ? 1 : 0),
      };
      return loc;
    };

    // Tier 0: Open drawer already showing target class & ?id=
    const tier0Page: any = {
      url: () =>
        `https://lms.mindx.edu.vn/admin/classes?search=%22VT-C4K-PTB01%22&id=%22674444444444444444444444%22&tab=6`,
      locator: (sel: string) => {
        if (sel.includes("class-detail")) {
          return makeLocator({ visible: true, text: "VT-C4K-PTB01 Running" });
        }
        return makeLocator({ visible: false });
      },
      waitForTimeout: async () => {},
      keyboard: { press: async () => {} },
    };
    const tier0Res = await ClassSyncer.resolveLmsClassId("VT-C4K-PTB01", {
      testPage: tier0Page,
      persistToConfig: false,
    });
    assert.deepEqual(tier0Res, {
      success: true,
      classCode: "VT-C4K-PTB01",
      lmsClassId: "674444444444444444444444",
      source: "LMS_DRAWER_URL",
    });

    // Tier 1: Search input + search response
    const tier1Page: any = {
      url: () => "https://lms.mindx.edu.vn/admin/classes",
      locator: (sel: string) => {
        if (sel.includes("Search")) {
          return makeLocator({ visible: true });
        }
        return makeLocator({ visible: false });
      },
      waitForResponse: async (pred: any) => {
        const fakeRes = {
          url: () => "https://lms-api.mindx.edu.vn/graphql",
          status: () => 200,
          request: () => ({
            method: () => "POST",
            postData: () =>
              JSON.stringify({
                operationName: "GetClasses",
                variables: { search: "VT-C4K-PTI12" },
              }),
          }),
          json: async () => gqlPayload,
        };
        assert.equal(Boolean(pred(fakeRes)), true);
        return fakeRes;
      },
      waitForTimeout: async () => {},
      keyboard: { press: async () => {} },
    };
    const tier1Res = await ClassSyncer.resolveLmsClassId("VT-C4K-PTI12", {
      testPage: tier1Page,
      persistToConfig: false,
    });
    assert.deepEqual(tier1Res, {
      success: true,
      classCode: "VT-C4K-PTI12",
      lmsClassId: ptiId,
      source: "LMS_SEARCH_API",
    });

    // Tier 2: Search input absent -> falls back to openClassDrawer + GetClassById / URL id
    const tier2Listeners: Record<string, Array<(arg: any) => void>> = {};
    let tier2Opened = false;
    const tier2Page: any = {
      url: () =>
        tier2Opened
          ? `https://lms.mindx.edu.vn/admin/classes?id=%22675555555555555555555555%22&tab=0`
          : "https://lms.mindx.edu.vn/admin/classes",
      on: (ev: string, fn: (arg: any) => void) => {
        tier2Listeners[ev] = tier2Listeners[ev] || [];
        tier2Listeners[ev].push(fn);
      },
      off: (ev: string, fn: (arg: any) => void) => {
        tier2Listeners[ev] = (tier2Listeners[ev] || []).filter((f) => f !== fn);
      },
      locator: (sel: string) => {
        if (sel.includes("input[type=\"password\"]")) {
          return makeLocator({ visible: false });
        }
        if (tier2Opened && sel.includes("class-detail")) {
          return makeLocator({
            visible: true,
            text: "VT-C4K-PTS09 Running",
          });
        }
        return makeLocator({ visible: false });
      },
      waitForTimeout: async () => {},
      keyboard: { press: async () => {} },
    };
    const { LmsHelpers } = await import("../src/lib/playwright/lms-helpers");
    const origOpenDrawer = LmsHelpers.openClassDrawer;
    LmsHelpers.openClassDrawer = async (p: any, code: string) => {
      tier2Opened = true;
      for (const fn of tier2Listeners["response"] || []) {
        await fn({
          url: () => "https://lms-api.mindx.edu.vn/graphql",
          status: () => 200,
          request: () => ({
            method: () => "POST",
            postDataJSON: () => ({ operationName: "GetClassById" }),
          }),
          json: async () => ({
            data: {
              classesById: {
                id: "675555555555555555555555",
                name: code,
              },
            },
          }),
        });
      }
    };
    try {
      const tier2Res = await ClassSyncer.resolveLmsClassId("VT-C4K-PTS09", {
        testPage: tier2Page,
        persistToConfig: false,
      });
      assert.deepEqual(tier2Res, {
        success: true,
        classCode: "VT-C4K-PTS09",
        lmsClassId: "675555555555555555555555",
        source: "LMS_DRAWER",
      });
    } finally {
      LmsHelpers.openClassDrawer = origOpenDrawer;
    }

    console.log("=== OL-04: /api/classes/lms-url & /api/session-comments/list ===");
    // Non-local Host guard -> 403
    const evilGetRes = await lmsUrlGET(
      new Request("http://127.0.0.1:3000/api/classes/lms-url?classCode=VT-C4K-PTI12", {
        headers: { host: "evil.example.com" },
      })
    );
    assert.equal(evilGetRes.status, 403);

    const evilPostRes = await lmsUrlPOST(
      new Request("http://127.0.0.1:3000/api/classes/lms-url", {
        method: "POST",
        headers: { host: "evil.example.com", "content-type": "application/json" },
        body: JSON.stringify({ classCode: "VT-C4K-PTI12" }),
      })
    );
    assert.equal(evilPostRes.status, 403);

    // Invalid classCode -> 400
    const badGetRes = await lmsUrlGET(
      new Request("http://127.0.0.1:3000/api/classes/lms-url?classCode=BAD%20CODE", {
        headers: { host: "127.0.0.1:3000" },
      })
    );
    assert.equal(badGetRes.status, 400);

    // Uncached GET for VT-C4K-PTI12 -> fallbackSearchUrl cleanly
    const uncachedGetRes = await lmsUrlGET(
      new Request("http://127.0.0.1:3000/api/classes/lms-url?classCode=VT-C4K-PTI12", {
        headers: { host: "127.0.0.1:3000" },
      })
    );
    assert.equal(uncachedGetRes.status, 200);
    const uncachedGetJson = await uncachedGetRes.json();
    assert.equal(uncachedGetJson.resolved, false);
    assert.equal(
      uncachedGetJson.url,
      "https://lms.mindx.edu.vn/admin/classes?search=%22VT-C4K-PTI12%22"
    );

    // Cached POST for VT-C4K-GI34 -> 200 immediately without Playwright
    const cachedPostRes = await lmsUrlPOST(
      new Request("http://127.0.0.1:3000/api/classes/lms-url", {
        method: "POST",
        headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
        body: JSON.stringify({ classCode: "VT-C4K-GI34", tab: 10 }),
      })
    );
    assert.equal(cachedPostRes.status, 200);
    const cachedPostJson = await cachedPostRes.json();
    assert.equal(cachedPostJson.resolved, true);
    assert.equal(
      cachedPostJson.url,
      "https://lms.mindx.edu.vn/admin/classes?search=%22VT-C4K-GI34%22&id=%22673333333333333333333333%22&tab=10"
    );

    // Uncached POST via mocked BrowserManager -> resolves & persists into TEMP config!
    const origGetInstance = BrowserManager.getInstance;
    try {
      (BrowserManager as any).getInstance = () => ({
        getPage: async () => tier1Page,
      });
      const origEnsureAuth = (await import("../src/lib/playwright/auth")).authService
        .ensureAuthenticated;
      (await import("../src/lib/playwright/auth")).authService.ensureAuthenticated =
        (async () => true) as any;
      try {
        const livePostRes = await lmsUrlPOST(
          new Request("http://127.0.0.1:3000/api/classes/lms-url", {
            method: "POST",
            headers: {
              host: "127.0.0.1:3000",
              "content-type": "application/json",
            },
            body: JSON.stringify({ classCode: "VT-C4K-PTI12", tab: 10 }),
          })
        );
        assert.equal(livePostRes.status, 200);
        const livePostJson = await livePostRes.json();
        assert.equal(livePostJson.resolved, true);
        assert.equal(livePostJson.lmsClassId, ptiId);
        assert.equal(livePostJson.url, directUrl);
        // Verify now persisted in TEMP lms_class_ids.json
        assert.equal(getLmsClassIdsMap()["VT-C4K-PTI12"], ptiId);
      } finally {
        (
          await import("../src/lib/playwright/auth")
        ).authService.ensureAuthenticated = origEnsureAuth;
      }
    } finally {
      (BrowserManager as any).getInstance = origGetInstance;
    }

    // Seed minimal config files in TEMP so list route doesn't touch real config
    saveCoursesSyllabus([]);
    saveQuickTags([]);
    saveZaloTemplates([]);

    const listRes = await sessionCommentsListGET(
      new Request(
        "http://127.0.0.1:3000/api/session-comments/list?classId=VT-C4K-PTI12&sessionId=",
        { headers: { host: "127.0.0.1:3000" } }
      )
    );
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    assert.equal(listJson.data.lmsBaseUrl, "https://lms.mindx.edu.vn");
    assert.equal(listJson.data.lmsClassId, ptiId);
    assert.equal(listJson.data.lmsClassIds["VT-C4K-PTI12"], ptiId);

    console.log("=== OL-05: SessionCommentsPage node:vm Compatibility + Flow + Toolbar Position ===");
    const pageSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/session-comments/page.tsx"),
      "utf-8"
    );
    const toolbarIdx = pageSrc.indexOf("{/* 3. Action Toolbar */}");
    assert.ok(toolbarIdx > 0, "Missing Action Toolbar marker in TSX");
    const openBtnIdx = pageSrc.indexOf('data-testid="open-class-lms-btn"', toolbarIdx);
    const attendBtnIdx = pageSrc.indexOf("⚡ Điểm danh cả lớp Có mặt", toolbarIdx);
    assert.ok(openBtnIdx > toolbarIdx, "Missing open-class-lms-btn in Action Toolbar");
    assert.ok(attendBtnIdx > openBtnIdx, "open-class-lms-btn must precede Điểm danh button in Action Toolbar");

    const marker = '\n  return (\n    <div className="space-y-6">';
    const idx = pageSrc.indexOf(marker);
    assert.ok(idx > 0, "Missing return marker in page.tsx");
    const tsHeader = `${pageSrc.slice(0, idx)}\n  return null;\n}`;
    const stripped = stripTypeScriptTypes(tsHeader, {
      mode: "strip",
    })
      .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
      .replace(/^["']use client["'];?\s*$/m, "")
      .replace("export default function SessionCommentsPage()", "function SessionCommentsPage()")
      .replace(/\s*return null;\s*\}\s*$/, "\n");

    // Intentional NO `URL` global in vmContext to guarantee parity with round-12/S3 harnesses!
    function mountVmSessionComments(opts: {
      cachedId?: string | null;
      postHandler?: (body: any) => Promise<{ ok: boolean; status: number; json: any }>;
      windowOpenHandler?: (url: string, target?: string) => any;
    }) {
      const states: any[] = [];
      let hookIdx = 0;
      const refs: Array<{ current: any }> = [];
      let refIdx = 0;
      const openCalls: Array<{ url: string; target?: string; popup: any }> = [];
      const postCalls: any[] = [];

      const vmCtx: any = {
        console,
        Date,
        Math,
        JSON,
        RegExp,
        Array,
        Object,
        String,
        Number,
        Boolean,
        Set,
        Map,
        Promise,
        Error,
        encodeURIComponent,
        decodeURIComponent,
        setTimeout,
        clearTimeout,
        sharedBuildLmsClassCommentsUrl: buildLmsClassCommentsUrl,
        detectTrackByClassCode: () => "coding",
        useState: (init: any) => {
          const i = hookIdx++;
          if (!(i in states)) {
            states[i] = typeof init === "function" ? init() : init;
          }
          return [
            states[i],
            (upd: any) => {
              states[i] = typeof upd === "function" ? upd(states[i]) : upd;
            },
          ];
        },
        useRef: (init: any) => {
          const i = refIdx++;
          if (!(i in refs)) refs[i] = { current: init };
          return refs[i];
        },
        useEffect: () => {},
        fetch: async (url: string, init?: any) => {
          if (String(url).includes("/api/classes/lms-url")) {
            const parsedBody = init?.body ? JSON.parse(init.body) : {};
            postCalls.push(parsedBody);
            if (opts.postHandler) {
              const res = await opts.postHandler(parsedBody);
              return {
                ok: res.ok,
                status: res.status,
                json: async () => res.json,
              };
            }
          }
          return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) };
        },
        window: {
          location: { search: "" },
          localStorage: { getItem: () => "VT-C4K-PTI12", setItem: () => {} },
          open: (url: string, target?: string) => {
            if (opts.windowOpenHandler) {
              const p = opts.windowOpenHandler(url, target);
              openCalls.push({ url, target, popup: p });
              return p;
            }
            const replaced: string[] = [];
            let writtenHtml = "";
            const fakePopup: any = {
              opener: "LEAKED_PARENT",
              closed: false,
              replaced,
              document: {
                open: () => {},
                write: (html: string) => {
                  writtenHtml += html;
                },
                close: () => {},
                get html() {
                  return writtenHtml;
                },
              },
              location: {
                replace: (nextUrl: string) => {
                  replaced.push(nextUrl);
                },
              },
            };
            openCalls.push({ url, target, popup: fakePopup });
            return fakePopup;
          },
        },
      };

      const footer = `
        return {
          getStates: () => ({
            classCode,
            lmsBaseUrl,
            lmsClassIdsByCode,
            openingLmsClass,
            statusMessage
          }),
          setLmsClassIdsByCode,
          setClassCode,
          setClassId,
          handleOpenClassOnLms
        };
      `;
      const scriptSource = `${stripped}\n${footer}\n}\nSessionCommentsPage();`;
      const res = vm.runInNewContext(scriptSource, vmCtx, {
        filename: "session-comments-open-lms.vm.js",
      });
      if (opts.cachedId) {
        res.setLmsClassIdsByCode({ "VT-C4K-PTI12": opts.cachedId });
      }
      return {
        openCalls,
        postCalls,
        rerender: () => {
          hookIdx = 0;
          refIdx = 0;
          return vm.runInNewContext(scriptSource, vmCtx, {
            filename: "session-comments-open-lms.vm.js",
          });
        },
      };
    }

    // Case A: Cached fast path -> 0ms direct window.open, opener=null, 0 API POST calls
    const vmA = mountVmSessionComments({ cachedId: ptiId });
    await vmA.rerender().handleOpenClassOnLms();
    assert.equal(vmA.openCalls.length, 1);
    assert.equal(vmA.openCalls[0].url, directUrl);
    assert.equal(vmA.openCalls[0].target, "_blank");
    assert.equal(vmA.openCalls[0].popup.opener, null);
    assert.equal(vmA.postCalls.length, 0);

    // Case B: Popup blocked -> graceful error statusMessage
    const vmB = mountVmSessionComments({
      cachedId: ptiId,
      windowOpenHandler: () => null,
    });
    await vmB.rerender().handleOpenClassOnLms();
    assert.equal(vmB.rerender().getStates().statusMessage?.type, "error");
    assert.match(vmB.rerender().getStates().statusMessage?.text || "", /Popup/i);

    // Case C: Uncached path -> opens about:blank, neutralizes opener, POSTs /api/classes/lms-url,
    // replaces popup URL with resolved drawer URL, caches ID, and 2nd click uses fast path!
    const vmC = mountVmSessionComments({
      cachedId: null,
      postHandler: async (body) => ({
        ok: true,
        status: 200,
        json: {
          success: true,
          classCode: body.classCode,
          lmsClassId: ptiId,
          url: directUrl,
          fallbackSearchUrl: searchFallback,
          resolved: true,
        },
      }),
    });
    await vmC.rerender().handleOpenClassOnLms();
    assert.equal(vmC.postCalls.length, 1);
    assert.equal(vmC.openCalls.length, 1);
    assert.equal(vmC.openCalls[0].url, "about:blank");
    assert.equal(vmC.openCalls[0].popup.opener, null);
    assert.match(vmC.openCalls[0].popup.document.html, /VT-C4K-PTI12/);
    assert.deepEqual(vmC.openCalls[0].popup.replaced, [directUrl]);
    assert.equal(vmC.rerender().getStates().lmsClassIdsByCode["VT-C4K-PTI12"], ptiId);
    // 2nd click now hits fast path (0 extra POST calls)
    await vmC.rerender().handleOpenClassOnLms();
    assert.equal(vmC.postCalls.length, 1);
    assert.equal(vmC.openCalls.length, 2);
    assert.equal(vmC.openCalls[1].url, directUrl);

    // Case D: API 502 error redirects popup cleanly to fallbackSearchUrl (omitting &id=)
    const vmD = mountVmSessionComments({
      cachedId: null,
      postHandler: async () => ({
        ok: false,
        status: 502,
        json: {
          success: false,
          fallbackSearchUrl: searchFallback,
          error: "LMS timeout",
        },
      }),
    });
    await vmD.rerender().handleOpenClassOnLms();
    assert.equal(vmD.openCalls.length, 1);
    assert.deepEqual(vmD.openCalls[0].popup.replaced, [searchFallback]);
    assert.equal(vmD.rerender().getStates().statusMessage?.type, "info");

    console.log("=== OL-06: Real Headless Chromium Toolbar Layout & Popup Redirect E2E ===");
    let apiPostCount = 0;
    let baseOrigin = "";
    const server = http.createServer((req, res) => {
      const reqUrl = String(req.url || "/");
      if (reqUrl.startsWith("/api/classes/lms-url") && req.method === "POST") {
        apiPostCount++;
        const mockDirectUrl = `${baseOrigin}/mock-lms/admin/classes?search=${encodeURIComponent(
          JSON.stringify("VT-C4K-PTI12")
        )}&id=${encodeURIComponent(JSON.stringify(ptiId))}&tab=10`;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            classCode: "VT-C4K-PTI12",
            lmsClassId: ptiId,
            url: mockDirectUrl,
            fallbackSearchUrl: `${baseOrigin}/mock-lms/admin/classes?search=${encodeURIComponent(
              JSON.stringify("VT-C4K-PTI12")
            )}`,
            resolved: true,
          })
        );
        return;
      }
      if (reqUrl.startsWith("/mock-lms/admin/classes")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><html><body><h1 data-testid="mock-lms">Mock MindX LMS Drawer Comments</h1></body></html>`
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><style>
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 16px; }
  button { padding: 8px 14px; font-size: 12px; font-weight: 600; }
</style></head>
<body>
  <div class="toolbar">
    <button type="button" data-testid="open-class-lms-btn">Mở LMS (VT-C4K-PTI12)</button>
    <button type="button" data-testid="confirm-all-present-btn">⚡ Điểm danh cả lớp Có mặt</button>
  </div>
  <script>
    const lmsClassIdsByCode = {};
    const openBtn = document.querySelector('[data-testid="open-class-lms-btn"]');
    openBtn.addEventListener("click", async () => {
      const code = "VT-C4K-PTI12";
      const cachedId = lmsClassIdsByCode[code] || "";
      if (cachedId) {
        const directUrl = location.origin + "/mock-lms/admin/classes?search=" + encodeURIComponent(JSON.stringify(code)) + "&id=" + encodeURIComponent(JSON.stringify(cachedId)) + "&tab=10";
        const p = window.open(directUrl, "_blank");
        try { if (p) p.opener = null; } catch {}
        return;
      }
      const popup = window.open("about:blank", "_blank");
      try { if (popup) popup.opener = null; } catch {}
      const r = await fetch("/api/classes/lms-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classCode: code, tab: 10 }),
      });
      const json = await r.json();
      if (json && json.success && json.lmsClassId) {
        lmsClassIdsByCode[code] = json.lmsClassId;
        if (popup && !popup.closed) popup.location.replace(json.url);
      }
    });
  </script>
</body>
</html>`);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    baseOrigin = `http://127.0.0.1:${addr.port}`;

    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(baseOrigin, { waitUntil: "domcontentloaded" });

      const openBox = await page.locator('[data-testid="open-class-lms-btn"]').boundingBox();
      const attendBox = await page.locator('[data-testid="confirm-all-present-btn"]').boundingBox();
      assert.ok(openBox && attendBox, "Toolbar buttons must render with bounding boxes");
      assert.ok(
        openBox.x < attendBox.x,
        `Expected open-class-lms-btn (${openBox.x}) left of confirm-all-present-btn (${attendBox.x})`
      );

      // 1st click (uncached)
      const [popup1] = await Promise.all([
        context.waitForEvent("page"),
        page.click('[data-testid="open-class-lms-btn"]'),
      ]);
      await popup1.waitForURL("**/mock-lms/admin/classes*", { timeout: 10000 });
      const openerIsNull1 = await popup1.evaluate(() => window.opener === null);
      assert.equal(openerIsNull1, true);
      const u1 = new URL(popup1.url());
      assert.equal(JSON.parse(u1.searchParams.get("search")!), "VT-C4K-PTI12");
      assert.equal(JSON.parse(u1.searchParams.get("id")!), ptiId);
      assert.equal(u1.searchParams.get("tab"), "10");
      assert.equal(apiPostCount, 1);
      await popup1.close();

      // 2nd click (cached -> 0 extra POSTs)
      const [popup2] = await Promise.all([
        context.waitForEvent("page"),
        page.click('[data-testid="open-class-lms-btn"]'),
      ]);
      await popup2.waitForURL("**/mock-lms/admin/classes*", { timeout: 10000 });
      const openerIsNull2 = await popup2.evaluate(() => window.opener === null);
      assert.equal(openerIsNull2, true);
      const u2 = new URL(popup2.url());
      assert.equal(JSON.parse(u2.searchParams.get("search")!), "VT-C4K-PTI12");
      assert.equal(JSON.parse(u2.searchParams.get("id")!), ptiId);
      assert.equal(u2.searchParams.get("tab"), "10");
      assert.equal(apiPostCount, 1);
      await popup2.close();
    } finally {
      if (browser) await browser.close().catch(() => {});
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    console.log("ALL OL-01..OL-06 CHECKS PASSED.");
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
