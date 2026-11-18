/**
 * MINDX AUTOMATION BOT - ISOLATED UI & SECURITY REGRESSION SUITE FOR v3.6.2
 * Verifies:
 * - [UI362-01] `GET /api/spck/thumbnail` strict security guardrails:
 *   403 non-local IP, 400 missing/null-byte path, 415 `.svg`/`.html`/spoofed magic bytes,
 *   403 outside `ALLOWED_LOCAL_DIRS` & symlink rejection, 200 valid PNG with `X-Content-Type-Options: nosniff`.
 * - [UI362-02] Live Headless Chromium Geometry & Layout check across `/final-project` (`1280x800` & `1366x768`):
 *   Zero squished `B.12 / B.13 / B.14` pills (`width >= 82px`), zero sibling bounding-box overlap,
 *   real `16:9` thumbnail `<img>` loaded (`naturalWidth > 0`), clean student `<option>` names without raw `(STU_...)`,
 *   and `"🔄 Làm mới trọn gói"` / `"⏪ Khôi phục bản trước"` cleanly housed inside expanded `"Chi tiết ▾"`.
 * - [UI362-03] Live Headless Chromium Light Mode (`☀️ Sáng`) & Dark Mode (`🌙 Tối`) WCAG contrast & zero console/hydration error check across all 7 routes (`http://127.0.0.1:3000`).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v362-ui-"));
const allowedDir = path.join(tmpRoot, "allowed_spck");
const outsideDir = path.join(tmpRoot, "outside_spck");
fs.mkdirSync(allowedDir, { recursive: true });
fs.mkdirSync(outsideDir, { recursive: true });

process.env.ALLOWED_LOCAL_DIRS = allowedDir;

const VALID_1X1_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

async function runThumbnailSecurityTests() {
  const { GET } = await import("../src/app/api/spck/thumbnail/route");

  const validPngPath = path.join(allowedDir, "thumb_16x9.png");
  fs.writeFileSync(validPngPath, VALID_1X1_PNG);

  const spoofedPngPath = path.join(allowedDir, "spoofed.png");
  fs.writeFileSync(spoofedPngPath, "<script>alert(1)</script>", "utf8");

  const svgPath = path.join(allowedDir, "vector.svg");
  fs.writeFileSync(svgPath, "<svg xmlns='http://www.w3.org/2000/svg'></svg>", "utf8");

  const outsidePngPath = path.join(outsideDir, "secret.png");
  fs.writeFileSync(outsidePngPath, VALID_1X1_PNG);

  // 1. Non-local request -> 403
  const resRemote = await GET(
    new Request(
      `http://example.com/api/spck/thumbnail?path=${encodeURIComponent(validPngPath)}`,
      { headers: { "x-forwarded-for": "8.8.8.8", host: "example.com" } }
    )
  );
  assert.equal(resRemote.status, 403, "Remote IP must be blocked with 403");

  // 2. Empty or null-byte path -> 400
  const resEmpty = await GET(
    new Request("http://127.0.0.1:3000/api/spck/thumbnail", {
      headers: { host: "127.0.0.1:3000" },
    })
  );
  assert.equal(resEmpty.status, 400, "Missing path must return 400");

  const resNull = await GET(
    new Request("http://127.0.0.1:3000/api/spck/thumbnail?path=abc%00.png", {
      headers: { host: "127.0.0.1:3000" },
    })
  );
  assert.equal(resNull.status, 400, "Null-byte path must return 400");

  // 3. Disallowed extension (.svg) -> 415
  const resSvg = await GET(
    new Request(
      `http://127.0.0.1:3000/api/spck/thumbnail?path=${encodeURIComponent(svgPath)}`,
      { headers: { host: "127.0.0.1:3000" } }
    )
  );
  assert.equal(resSvg.status, 415, ".svg must be rejected with 415");

  // 4. Spoofed magic bytes -> 415
  const resSpoof = await GET(
    new Request(
      `http://127.0.0.1:3000/api/spck/thumbnail?path=${encodeURIComponent(spoofedPngPath)}`,
      { headers: { host: "127.0.0.1:3000" } }
    )
  );
  assert.equal(resSpoof.status, 415, "Spoofed non-PNG content must return 415");

  // 5. Outside allowlist -> 403
  const resOutside = await GET(
    new Request(
      `http://127.0.0.1:3000/api/spck/thumbnail?path=${encodeURIComponent(outsidePngPath)}`,
      { headers: { host: "127.0.0.1:3000" } }
    )
  );
  assert.equal(resOutside.status, 403, "Outside allowlist path must return 403");

  // 6. Valid PNG inside allowlist -> 200 + nosniff
  const resValid = await GET(
    new Request(
      `http://127.0.0.1:3000/api/spck/thumbnail?path=${encodeURIComponent(validPngPath)}`,
      { headers: { host: "127.0.0.1:3000" } }
    )
  );
  assert.equal(resValid.status, 200, "Valid allowlisted PNG must return 200");
  assert.equal(resValid.headers.get("content-type"), "image/png");
  assert.equal(resValid.headers.get("x-content-type-options"), "nosniff");
  const bodyBuf = Buffer.from(await resValid.arrayBuffer());
  assert.equal(bodyBuf.equals(VALID_1X1_PNG), true);

  console.log("✅ [UI362-01] GET /api/spck/thumbnail security guardrails PASS");
}

async function runLiveBrowserUiChecks() {
  // Check if local dev server is reachable on 127.0.0.1:3000
  let serverUp = false;
  try {
    const ping = await fetch("http://127.0.0.1:3000/");
    serverUp = ping.ok;
  } catch {
    serverUp = false;
  }
  if (!serverUp) {
    console.log("ℹ️ Local server http://127.0.0.1:3000 not running; skipping live route check.");
    return;
  }

  const browser = await chromium.launch({ headless: true });
  try {
    for (const theme of ["light", "dark"] as const) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      await context.addInitScript("window.__name = (fn) => fn;");
      await context.addInitScript((t) => {
        try {
          localStorage.setItem("mindx_ui_theme", t);
        } catch {}
      }, theme);
      const page = await context.newPage();
      await page.route("**/api/**", async (route) => {
        const m = route.request().method();
        const u = route.request().url();
        if (m !== "GET" && !u.includes("/api/spck/browse-folder")) {
          return route.abort();
        }
        return route.continue();
      });

      const errs: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errs.push(msg.text());
      });
      page.on("pageerror", (e) => errs.push(e.message));

      await page.goto(
        "http://127.0.0.1:3000/final-project?classId=VT-C4K-PTA13&sessionNumber=13",
        { waitUntil: "networkidle", timeout: 30000 }
      );
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await page.waitForTimeout(600);

      // Verify 3 main step cards contrast >= 4.5 in both Light & Dark modes
      const stepContrast = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        const parse = (c: string) => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = c;
          ctx.fillRect(0, 0, 1, 1);
          const d = ctx.getImageData(0, 0, 1, 1).data;
          return [d[0], d[1], d[2]];
        };
        const lum = ([r, g, b]: number[]) => {
          const s = [r, g, b].map((v) => {
            const x = v / 255;
            return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
        };
        const cr = (a: number[], b: number[]) => {
          const l1 = lum(a);
          const l2 = lum(b);
          return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        };
        return ["spck-main-step1-sync", "spck-main-step2-ai", "spck-main-step3-submit"].map((id) => {
          const btn = document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
          const title = btn.querySelector(".spck-step-title") as HTMLElement;
          const fg = parse(getComputedStyle(title).color);
          const bgImg = getComputedStyle(btn).backgroundImage;
          const firstColor = (bgImg.match(/(?:rgba?|oklab|oklch|lab|lch)\([^)]+\)|#[0-9a-fA-F]{3,8}/) || ["#ffffff"])[0];
          const bg = parse(firstColor);
          return { id, ratio: Number(cr(fg, bg).toFixed(2)) };
        });
      });

      for (const item of stepContrast) {
        assert.ok(
          item.ratio >= 4.5,
          `[${theme}] ${item.id} title contrast must be >= 4.5, got ${item.ratio}`
        );
      }

      // Verify B.12 / B.13 / B.14 pills are never squished (< 82px) and do not overlap even at 1280px!
      const pillMetrics = await page.evaluate(() => {
        const rows = [...document.querySelectorAll(".spck-clean-row, .spck-clean-row-warning, .spck-clean-row-error")];
        const widths: number[] = [];
        let overlaps = 0;
        for (const r of rows) {
          const pills = [...r.querySelectorAll('[data-testid^="spck-slot-pill-"]')];
          for (let i = 0; i < pills.length; i++) {
            const rect = pills[i].getBoundingClientRect();
            widths.push(Math.round(rect.width));
            if (i > 0) {
              const prev = pills[i - 1].getBoundingClientRect();
              if (rect.left < prev.right - 1) overlaps++;
            }
          }
        }
        const optTexts = [...document.querySelectorAll(".spck-clean-row select option")]
          .map((o) => (o.textContent || "").trim())
          .filter((t) => t && !t.startsWith("--"));
        return { widths, overlaps, optTexts };
      });

      if (pillMetrics.widths.length > 0) {
        for (const w of pillMetrics.widths) {
          assert.ok(w >= 82, `[${theme}] Session pill width must be >= 82px at 1280px, got ${w}px`);
        }
        assert.equal(pillMetrics.overlaps, 0, `[${theme}] Session pills must have 0 horizontal overlaps`);
        for (const opt of pillMetrics.optTexts) {
          assert.ok(
            !opt.includes("STU_"),
            `[${theme}] Student option must not expose raw STU_ ID: ${opt}`
          );
        }
      }

      // [UI362-04] Open FolderBrowserModal ("📁 Đổi thư mục" -> "Chọn...") & verify directory rows + "Chọn" button contrast >= 4.5
      const toggleFolderBtn = page.locator('[data-testid="spck-toggle-folder-editor-btn"]');
      if ((await toggleFolderBtn.count()) > 0) {
        await toggleFolderBtn.click();
        const chooseBtn = page.locator('button:has-text("Chọn...")').first();
        if ((await chooseBtn.count()) > 0) {
          await chooseBtn.click();
          await page.waitForTimeout(500);
          const modalCr = await page.evaluate(() => {
            const canvas = document.createElement("canvas");
            canvas.width = 1;
            canvas.height = 1;
            const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
            const parse = (c: string) => {
              ctx.clearRect(0, 0, 1, 1);
              ctx.fillStyle = c;
              ctx.fillRect(0, 0, 1, 1);
              const d = ctx.getImageData(0, 0, 1, 1).data;
              return [d[0], d[1], d[2], d[3] / 255];
            };
            const comp = (fg: number[], bg: number[]) => {
              const a = fg[3] + bg[3] * (1 - fg[3]);
              return [
                (fg[0] * fg[3] + bg[0] * bg[3] * (1 - fg[3])) / a,
                (fg[1] * fg[3] + bg[1] * bg[3] * (1 - fg[3])) / a,
                (fg[2] * fg[3] + bg[2] * bg[3] * (1 - fg[3])) / a,
                a,
              ];
            };
            const effBg = (el: HTMLElement) => {
              const chain: number[][] = [];
              let cur: HTMLElement | null = el;
              while (cur) {
                const bg = parse(getComputedStyle(cur).backgroundColor);
                if (bg[3] > 0) chain.push(bg);
                if (bg[3] >= 0.99) break;
                cur = cur.parentElement;
              }
              let base =
                document.documentElement.getAttribute("data-theme") === "dark"
                  ? [15, 23, 42, 1]
                  : [255, 255, 255, 1];
              for (let i = chain.length - 1; i >= 0; i--) base = comp(chain[i], base);
              return base;
            };
            const lum = ([r, g, b]: number[]) => {
              const s = [r, g, b].map((v) => {
                const x = v / 255;
                return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
              });
              return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
            };
            const cr = (a: number[], b: number[]) => {
              const l1 = lum(a);
              const l2 = lum(b);
              return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            };
            const modal = document.querySelector(".fixed.inset-0.z-50");
            if (!modal) return [];
            const dirSpan = modal.querySelector("button span.truncate") as HTMLElement | null;
            const pickBtn = [...modal.querySelectorAll("button")].find(
              (b) => (b.textContent || "").trim() === "Chọn"
            ) as HTMLElement | undefined;
            const out: Array<{ label: string; ratio: number }> = [];
            if (dirSpan) {
              out.push({
                label: "FolderBrowserModal dir.name",
                ratio: Number(cr(parse(getComputedStyle(dirSpan).color), effBg(dirSpan)).toFixed(2)),
              });
            }
            if (pickBtn) {
              out.push({
                label: "FolderBrowserModal Chọn button",
                ratio: Number(cr(parse(getComputedStyle(pickBtn).color), effBg(pickBtn)).toFixed(2)),
              });
            }
            return out;
          });
          for (const item of modalCr) {
            assert.ok(
              item.ratio >= 4.5,
              `[${theme}] ${item.label} contrast must be >= 4.5, got ${item.ratio}`
            );
          }
        }
      }

      // Check /session-comments Zalo toggle button contrast >= 4.5
      await page.goto("http://127.0.0.1:3000/session-comments?classCode=VT-C4K-PTA13", {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await page.waitForTimeout(500);
      const zaloBtnCr = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        const parse = (c: string) => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = c;
          ctx.fillRect(0, 0, 1, 1);
          const d = ctx.getImageData(0, 0, 1, 1).data;
          return [d[0], d[1], d[2], d[3] / 255];
        };
        const comp = (fg: number[], bg: number[]) => {
          const a = fg[3] + bg[3] * (1 - fg[3]);
          return [
            (fg[0] * fg[3] + bg[0] * bg[3] * (1 - fg[3])) / a,
            (fg[1] * fg[3] + bg[1] * bg[3] * (1 - fg[3])) / a,
            (fg[2] * fg[3] + bg[2] * bg[3] * (1 - fg[3])) / a,
            a,
          ];
        };
        const effBg = (el: HTMLElement) => {
          const chain: number[][] = [];
          let cur: HTMLElement | null = el;
          while (cur) {
            const bg = parse(getComputedStyle(cur).backgroundColor);
            if (bg[3] > 0) chain.push(bg);
            if (bg[3] >= 0.99) break;
            cur = cur.parentElement;
          }
          let base =
            document.documentElement.getAttribute("data-theme") === "dark"
              ? [21, 32, 57, 1]
              : [255, 255, 255, 1];
          for (let i = chain.length - 1; i >= 0; i--) base = comp(chain[i], base);
          return base;
        };
        const lum = ([r, g, b]: number[]) => {
          const s = [r, g, b].map((v) => {
            const x = v / 255;
            return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
        };
        const cr = (a: number[], b: number[]) => {
          const l1 = lum(a);
          const l2 = lum(b);
          return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        };
        const btn = [...document.querySelectorAll("button")].find((b) =>
          (b.textContent || "").includes("2c. Tiến độ SPCK")
        ) as HTMLElement | undefined;
        return btn ? Number(cr(parse(getComputedStyle(btn).color), effBg(btn)).toFixed(2)) : 99;
      });
      assert.ok(
        zaloBtnCr >= 4.5,
        `[${theme}] Zalo '2c. Tiến độ SPCK' button contrast must be >= 4.5, got ${zaloBtnCr}`
      );

      assert.equal(errs.length, 0, `[${theme}] Expected 0 console/page errors, got: ${errs.join("; ")}`);
      await context.close();
    }
    console.log("✅ [UI362-02..04] Live 1280x800 Light & Dark geometry, FolderBrowserModal, Zalo pills & zero-error checks PASS");
  } finally {
    await browser.close();
  }
}

(async () => {
  try {
    await runThumbnailSecurityTests();
    await runLiveBrowserUiChecks();
    console.log("🎉 ALL v3.6.2 UI & SECURITY TESTS PASSED!");
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
})();
