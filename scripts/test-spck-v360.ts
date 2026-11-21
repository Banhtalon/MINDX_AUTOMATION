/**
 * MINDX AUTOMATION BOT - COMPREHENSIVE ISOLATED VERIFICATION SUITE FOR v3.6.0
 * "Tinh gọn 3-Chạm SPCK B12–13–14 & Đồng bộ Tự động LMS + Teaching"
 *
 * 100% hermetically isolated inside `os.tmpdir()` (`MINDX_DB_PATH`, `MINDX_CONFIG_DIR`,
 * `MINDX_RUNNING_CLASSES_PATH`, `MINDX_LMS_CLASS_IDS_PATH`, `MINDX_ROLE_STATE_DIR`,
 * `ALLOWED_LOCAL_DIRS` set BEFORE any project module import; `closeDb()` + temp cleanup in `finally`).
 *
 * Covers 5 full scenario groups + adversarial & Round-38 regression invariants:
 * - [V360-01] 9 `[ĐNL]` Competency radio calculation from Checkpoints (Coding B5 & B9 / Robotics B4 & B8):
 *             exact `commentAreaId` `DOM[0..8]` order (`3768` Tự học before `e16c` Tại lớp), `COMPETENCY_ITEMS_UI`
 *             alignment, shuffled `commentByAreas`, missing single `RATE` cell (`26/8 = 3.25` without column shift),
 *             absent 1 checkpoint, smart alternating `.5` rounding (`bestK` prioritizing `CP2 > CP1`), and
 *             Chromium `Session14EvalUploader` radio group `DOM[0..8]` verification.
 * - [V360-02] 3-decimal-place Demo Award Rankings (`Giải Nhất` / `Đồng Giải Nhì` / `Đồng Giải Ba` / `COMPLETED`),
 *             Slot 14 `Summary` auto-generation + teacher edit/reset, 3-Quill (`JSB`/`GA`) vs 4-Quill (`Robotics`)
 *             PII-safe AI course summary (including error-path PII guard), and Chromium E2E Slot 14 `Summary` +
 *             partial-class evaluation upload (`id="13"` `checked === false` + `UpdateSlotComment` HTTP 200).
 * - [V360-03] Oversized `.yyz` (`16 MB` `Snd_win.mp3` > `15 MB` LMS limit) trimmed `.zip` for LMS (`< 15 MB`/entry),
 *             strict stripping of sensitive secrets (`.env*`, `*.key`, `*.pem`, `id_rsa`, `serviceAccountKey.json`),
 *             Zip-Slip/executable rejection, newer-`mtime` `.yyz` selection, full original `.yyz` preserved for
 *             Google Drive, `SpckWebDeployer` `GCM_INTERACTIVE=never` + empty `git status` skip, and `< 1s` fast-skip
 *             for unchanged students on both Web & Google Drive.
 * - [V360-04] Creative topic title auto-upgrade (`"SPCK <Tên>"` -> `<Đề tài> - <Tên>`), `CSI`/`CSA` Quick Tags
 *             auto-suggestion, Session 14 BGK `communication` presentation Quick Tag + 1-click 2-part SPCK comment,
 *             and Student Portal `autoUploadDrive = false` default.
 * - [V360-05] Real Chromium E2E of 3-Touch `/final-project` + `<TopNavbar />` (`v3.6.0`, compact header, Portal
 *             auto-close before `1. Đồng bộ bài làm`, `2. AI Soạn nhận xét` Summary box & top-3-only award badges,
 *             `3. Duyệt & Nộp tất cả` non-blocking partial submit + Teaching `60%/80%/100%` + Session 14 Report Card
 *             chain) + `docs/audits/round-38/adversarial.mjs` VM & client-secret compatibility.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import AdmZip from "adm-zip";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as esbuild from "esbuild";
import { chromium, type Browser } from "playwright";

const ROOT = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-v360-test-"));
const tempDbPath = path.join(tempRoot, "mindx_v360_test.db");
const tempConfigDir = path.join(tempRoot, "config");
const tempSpckRoot = path.join(tempRoot, "spck_root");
const tempRoleDir = path.join(tempRoot, "role-state");
const tempShotDir = path.join(tempRoot, "shots");

fs.mkdirSync(path.join(tempConfigDir, "demo-sheet-templates"), { recursive: true });
fs.mkdirSync(tempSpckRoot, { recursive: true });
fs.mkdirSync(tempRoleDir, { recursive: true });
fs.mkdirSync(tempShotDir, { recursive: true });

const MINIMAL_1X1_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64"
);

const liveTemplatesDir = path.join(ROOT, "data", "config", "demo-sheet-templates");
if (fs.existsSync(liveTemplatesDir)) {
  for (const file of fs.readdirSync(liveTemplatesDir)) {
    if (file.toLowerCase().endsWith(".xlsx")) {
      fs.copyFileSync(
        path.join(liveTemplatesDir, file),
        path.join(tempConfigDir, "demo-sheet-templates", file)
      );
    }
  }
}
for (const cfgFile of ["default-demo-sheet-template.xlsx", "default-spck-thumbnail.png"]) {
  const srcPath = path.join(ROOT, "data", "config", cfgFile);
  const destPath = path.join(tempConfigDir, cfgFile);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
  } else if (cfgFile.endsWith(".png")) {
    fs.writeFileSync(destPath, MINIMAL_1X1_PNG);
  }
}
if (!fs.existsSync(path.join(tempConfigDir, "default-spck-thumbnail.png"))) {
  fs.writeFileSync(path.join(tempConfigDir, "default-spck-thumbnail.png"), MINIMAL_1X1_PNG);
}
fs.writeFileSync(path.join(tempConfigDir, "lms_class_ids.json"), "{}\n", "utf8");
fs.writeFileSync(path.join(tempRoot, "running_classes.json"), "[]\n", "utf8");

// MUST be set BEFORE any dynamic import from ../src/**
process.env.MINDX_DB_PATH = tempDbPath;
process.env.MINDX_CONFIG_DIR = tempConfigDir;
process.env.MINDX_RUNNING_CLASSES_PATH = path.join(tempRoot, "running_classes.json");
process.env.MINDX_LMS_CLASS_IDS_PATH = path.join(tempConfigDir, "lms_class_ids.json");
process.env.MINDX_ROLE_STATE_DIR = tempRoleDir;
process.env.MINDX_DEBUG_SCREENSHOT_DIR = tempShotDir;
process.env.ALLOWED_LOCAL_DIRS = tempRoot;
process.env.MINDX_ALLOWED_EXTRA_PATHS = tempRoot;
process.env.MINDX_DISABLE_PORTAL_TUNNEL = "1";
process.env.MINDX_DISABLE_BROWSER_EXPORT_FALLBACK = "1";
if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "your_gemini_api_key_here") {
  process.env.GEMINI_API_KEY = "V360_OFFLINE_MOCK_GEMINI_KEY";
}

function localJsonRequest(url: string, body?: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: {
      Host: "127.0.0.1:3000",
      Origin: "http://127.0.0.1:3000",
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function buildMultiTabDemoXlsxBuffer(
  tabs: Array<{
    tabName: string;
    studentCellB2: string;
    subScoresE?: {
      E8: number;
      E9: number;
      E10: number;
      E14: number;
      E15: number;
      E16: number;
      E18: number;
      E20: number;
      E21: number;
      E23: number;
      E24: number;
    };
    summaryB?: [number, number, number, number, number];
    judgeComment1?: string;
    judgeComment2?: string;
  }>
): Buffer {
  const zip = new AdmZip();
  const sheetXmlEntries = tabs
    .map(
      (t, idx) =>
        `<sheet name="${t.tabName.replace(/"/g, "&quot;")}" sheetId="${idx + 1}" r:id="rId${idx + 1}"/>`
    )
    .join("");
  const relEntries = tabs
    .map(
      (_, idx) =>
        `<Relationship Id="rId${idx + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${idx + 1}.xml"/>`
    )
    .join("");

  zip.addFile(
    "xl/workbook.xml",
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetXmlEntries}</sheets></workbook>`,
      "utf8"
    )
  );
  zip.addFile(
    "xl/_rels/workbook.xml.rels",
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relEntries}</Relationships>`,
      "utf8"
    )
  );

  tabs.forEach((tab, idx) => {
    const rowsXml: string[] = [
      `<row r="2"><c r="A2" t="inlineStr"><is><t>Họ và tên Học viên:</t></is></c><c r="B2" t="inlineStr"><is><t>${tab.studentCellB2}</t></is></c></row>`,
    ];
    if (tab.subScoresE) {
      for (const [cellRef, val] of Object.entries(tab.subScoresE)) {
        const rowNum = cellRef.slice(1);
        rowsXml.push(`<row r="${rowNum}"><c r="${cellRef}"><v>${val}</v></c></row>`);
      }
    }
    if (tab.summaryB) {
      // MindX LOs summary rows: B32=algorithm, B33=computerSkills, B34=creativity, B35=problemSolving, B36=communication
      const [alg, cmp, cre, prb, com] = tab.summaryB;
      rowsXml.push(`<row r="32"><c r="B32"><v>${alg}</v></c></row>`);
      rowsXml.push(`<row r="33"><c r="B33"><v>${cmp}</v></c></row>`);
      rowsXml.push(`<row r="34"><c r="B34"><v>${cre}</v></c></row>`);
      rowsXml.push(`<row r="35"><c r="B35"><v>${prb}</v></c></row>`);
      rowsXml.push(`<row r="36"><c r="B36"><v>${com}</v></c></row>`);
    }
    if (tab.judgeComment1) {
      rowsXml.push(
        `<row r="27"><c r="A27" t="inlineStr"><is><t>Nhận xét của giám khảo 1</t></is></c><c r="C27" t="inlineStr"><is><t>${tab.judgeComment1}</t></is></c></row>`
      );
    }
    if (tab.judgeComment2) {
      rowsXml.push(
        `<row r="28"><c r="A28" t="inlineStr"><is><t>Nhận xét của giám khảo 2</t></is></c><c r="C28" t="inlineStr"><is><t>${tab.judgeComment2}</t></is></c></row>`
      );
    }
    zip.addFile(
      `xl/worksheets/sheet${idx + 1}.xml`,
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>${rowsXml.join("")}</sheetData></worksheet>`,
        "utf8"
      )
    );
  });

  return zip.toBuffer();
}

function createTsconfigAndNextStubPlugin(): esbuild.Plugin {
  return {
    name: "v360-alias-and-next-stubs",
    setup(build) {
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({
        path: "next-navigation-stub",
        namespace: "next-stub",
      }));
      build.onResolve({ filter: /^next\/link$/ }, () => ({
        path: "next-link-stub",
        namespace: "next-stub",
      }));
      build.onLoad({ filter: /.*/, namespace: "next-stub" }, (args) => {
        if (args.path === "next-navigation-stub") {
          return {
            contents: `
              export function usePathname() { return "/final-project"; }
              export function useRouter() { return { push() {}, replace() {}, prefetch() {} }; }
              export function useSearchParams() { return new URLSearchParams(); }
            `,
            loader: "ts",
            resolveDir: ROOT,
          };
        }
        return {
          contents: `
            import React from "react";
            export default function Link(props: any) {
              const { href, children, ...rest } = props || {};
              return React.createElement("a", { href: String(href || "#"), ...rest }, children);
            }
          `,
          loader: "tsx",
          resolveDir: ROOT,
        };
      });
      build.onResolve({ filter: /^@\// }, (args) => {
        const subPath = args.path.slice(2);
        const targetBase = path.join(ROOT, "src", subPath);
        for (const ext of ["", ".tsx", ".ts", ".jsx", ".js", "/index.ts", "/index.tsx"]) {
          const candidate = targetBase + ext;
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return { path: candidate };
          }
        }
        return { path: targetBase };
      });
    },
  };
}

async function buildUiBundleWithNavbar(outDir: string): Promise<string> {
  const navbarPath = path.join(ROOT, "src/components/top-navbar.tsx");
  const pagePath = path.join(ROOT, "src/app/final-project/page.tsx");
  const entryFile = path.join(outDir, "entry_v360.tsx");
  const outFile = path.join(outDir, "bundle_v360.js");

  fs.writeFileSync(
    entryFile,
    `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { TopNavbar } from ${JSON.stringify(navbarPath)};
      import FinalProjectPage from ${JSON.stringify(pagePath)};

      const rootEl = document.getElementById("root")!;
      createRoot(rootEl).render(
        <div>
          <TopNavbar />
          <FinalProjectPage />
        </div>
      );
    `,
    "utf8"
  );

  await esbuild.build({
    entryPoints: [entryFile],
    bundle: true,
    outfile: outFile,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    jsx: "automatic",
    absWorkingDir: ROOT,
    nodePaths: [path.join(ROOT, "node_modules")],
    plugins: [createTsconfigAndNextStubPlugin()],
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  });

  return fs.readFileSync(outFile, "utf8");
}

async function runTests() {
  console.log("=== BỘ KIỂM THỬ CÔ LẬP TOÀN DIỆN v3.6.0 (TINH GỌN 3-CHẠM SPCK B12–13–14) ===");

  const sqliteMod = await import("../src/lib/db/sqlite");
  const {
    classSessionRepo,
    closeDb,
    computeCheckpointCompetencyScores: _unusedAlias,
    computeSession14AwardRankingsPure,
    getDb,
    SESSION14_COMPETENCY_KEYS,
    session14ClassSummaryRepo,
    session14EvalRepo,
    spckSessionRepo,
    spckUploadRepo,
    studentRepo,
  } = sqliteMod as any;

  assert.strictEqual(
    path.resolve(getDb().name),
    path.resolve(tempDbPath),
    "getDb() bắt buộc phải trỏ vào tempDbPath trong os.tmpdir()!"
  );
  assert.strictEqual(
    fs.existsSync(path.join(ROOT, "src", "app", "api", "spck", "session14-live-ops")),
    false,
    "Thư mục route chết session14-live-ops bắt buộc đã bị gỡ bỏ hoàn toàn!"
  );

  const {
    buildClassSession14SummaryDraft,
    computeClassDemoAwardRankings,
    computeSession14CompetencyFromCheckpoints,
    SESSION14_COMPETENCY_AREA_SPECS,
  } = await import("../src/lib/local-files/spck-demo-score-reader");
  const {
    COMPETENCY_ITEMS_UI,
    resolveStudentAwardLabel,
  } = await import("../src/lib/spck/spck-ui-helpers");
  const {
    buildTrimmedLmsZipForOversizedArchive,
    computeStudentFolderContentDigest,
    isSensitiveSecretFile,
  } = await import("../src/lib/local-files/spck-scanner");
  const {
    prepareStudentZipBundleAndStandaloneMediaForDrive,
    SpckDriveUploader,
  } = await import("../src/lib/playwright/spck-drive-uploader");
  const { SpckWebDeployer } = await import("../src/lib/github/spck-web-deployer");
  const { Session14EvalUploader } = await import(
    "../src/lib/playwright/session14-eval-uploader"
  );
  const { LmsHelpers } = await import("../src/lib/playwright/lms-helpers");
  const { BrowserManager } = await import("../src/lib/playwright/browser-manager");
  const { authService } = await import("../src/lib/playwright/auth");
  const {
    suggestSession14PresentationTagFromDemoScore,
    suggestSpckQuickTagsFromProject,
  } = await import("../src/lib/spck/spck-quick-tags");
  const { studentPortalManager } = await import(
    "../src/lib/student-portal/student-portal-server"
  );

  const { GET: s14EvalGet, POST: s14EvalPost } = await import(
    "../src/app/api/spck/session14-eval/route"
  );
  const { POST: s14ImportDemoPost } = await import(
    "../src/app/api/spck/session14-eval/import-demo-scores/route"
  );
  const { POST: s14GenAiPost } = await import(
    "../src/app/api/spck/session14-eval/generate-ai/route"
  );
  const { POST: s14UploadLmsPost } = await import(
    "../src/app/api/spck/session14-eval/upload-lms/route"
  );
  const { POST: scanPost } = await import("../src/app/api/spck/scan/route");
  const { POST: spckGenAiPost } = await import(
    "../src/app/api/spck/generate-ai/route"
  );
  const { POST: uploadDrivePost } = await import(
    "../src/app/api/spck/upload-drive/route"
  );
  const { POST: portalPost } = await import(
    "../src/app/api/spck/student-portal/route"
  );
  const { POST: saveDraftPost } = await import(
    "../src/app/api/spck/save-draft/route"
  );

  let sharedBrowser: Browser | null = null;
  const origGetGenerativeModel = GoogleGenerativeAI.prototype.getGenerativeModel;

  try {
    sharedBrowser = await chromium.launch({
      headless: true,
      args: ["--disable-background-networking", "--disable-component-update"],
    });

    // =========================================================================
    // [V360-01] Trung bình [ĐNL] 9 ô tròn từ Buổi 5 & 9 (Robotics: Buổi 4 & 8)
    // =========================================================================
    console.log(
      "\n[V360-01] Kiểm thử tính 9 ô tròn [ĐNL] từ Buổi Kiểm tra (DOM[0..8], đảo mảng, khuyết 1 ô, vắng 1 buổi & làm tròn .5)..."
    );
    {
      // 1a) Exact DOM[0..8] order: 3768 (Tự học) BEFORE e16c (Tại lớp) across Backend + UI
      const expectedAreaSuffixes = [
        ["knowledgeSelfStudy", "3768"],
        ["knowledgeInClass", "e16c"],
        ["skillCommunication", "4316"],
        ["skillComputerUse", "406f"],
        ["skillProblemSolving", "2db6"],
        ["skillCreativity", "e198"],
        ["skillComputational", "e187"],
        ["attitudeHomework", "44c1"],
        ["attitudeInClass", "434f"],
      ] as const;

      assert.strictEqual(SESSION14_COMPETENCY_KEYS.length, 9);
      assert.strictEqual(SESSION14_COMPETENCY_AREA_SPECS.length, 9);
      assert.strictEqual(COMPETENCY_ITEMS_UI.length, 9);

      expectedAreaSuffixes.forEach(([key, suffix], idx) => {
        assert.strictEqual(
          SESSION14_COMPETENCY_KEYS[idx],
          key,
          `SESSION14_COMPETENCY_KEYS[${idx}] phải là ${key}`
        );
        assert.strictEqual(SESSION14_COMPETENCY_AREA_SPECS[idx].key, key);
        assert.ok(
          SESSION14_COMPETENCY_AREA_SPECS[idx].commentAreaId.endsWith(suffix),
          `DOM[${idx}] commentAreaId phải kết thúc bằng ${suffix}`
        );
        assert.strictEqual(
          COMPETENCY_ITEMS_UI[idx].key,
          key,
          `COMPETENCY_ITEMS_UI[${idx}] phải khớp thứ tự DOM[${idx}] = ${key}`
        );
      });

      // 1b) Coding (B5 & B9) vs Robotics (B4 & B8) slot selection + reversed commentByAreas + TEXT noise
      const cp1GradesDomOrder = [5, 3, 4, 4, 3, 4, 5, 4, 4]; // sum=36, avg=4.00
      const cp2GradesDomOrder = [5, 3, 5, 4, 4, 5, 5, 5, 4]; // sum=40, avg=4.44
      // 3 criteria have .5 average: DOM[2] (4->5, +1), DOM[4] (3->4, +1), DOM[5] (4->5, +1), DOM[7] (4->5, +1) -> 4 half-candidates!
      // Wait: cp1Avg=4.00, cp2Avg=4.44 -> targetAvg=4.22 -> 4.22*9 = 37.98 -> best sum = 38!
      // Base ratings: [5, 3, 4, 4, 3, 4, 5, 4, 4] (baseSum = 36) -> bestK = 2 rounded up (36+2 = 38 -> 38/9 = 4.22 exact!).

      const buildAreasReversedWithTextNoise = (grades: Array<number | null>) => [
        { type: "TEXT", commentAreaId: "665e7d33181e0e47f6c69999", content: "Nhận xét chung" },
        ...SESSION14_COMPETENCY_AREA_SPECS.map((spec, idx) => ({
          type: "RATE",
          commentAreaId: spec.commentAreaId,
          grade: grades[idx] ?? 0,
        })).reverse(),
      ];

      const codingSlots = Array.from({ length: 14 }, (_, idx) => ({
        slotNumber: idx + 1,
        studentAttendance:
          idx + 1 === 5
            ? [
                {
                  student: { id: "STU_GA_01", fullName: "Trần Minh Khoa" },
                  status: "PRESENT",
                  commentByAreas: buildAreasReversedWithTextNoise(cp1GradesDomOrder),
                },
              ]
            : idx + 1 === 9
            ? [
                {
                  student: { id: "STU_GA_01", fullName: "Trần Minh Khoa" },
                  status: "PRESENT",
                  commentByAreas: buildAreasReversedWithTextNoise(cp2GradesDomOrder),
                },
              ]
            : [],
      }));

      const codingRes = computeSession14CompetencyFromCheckpoints({
        classId: "VT-C4K-GA09",
        studentId: "STU_GA_01",
        fullName: "Trần Minh Khoa",
        slots: codingSlots,
      });
      assert.strictEqual(codingRes.matchedFromCheckpoints, true);
      assert.strictEqual(codingRes.sourceType, "CHECKPOINT_BOTH");
      assert.strictEqual(codingRes.cp1SlotNumber, 5);
      assert.strictEqual(codingRes.cp2SlotNumber, 9);
      assert.strictEqual(codingRes.competencyScores.knowledgeSelfStudy, 5, "DOM[0] Tự học = 5");
      assert.strictEqual(codingRes.competencyScores.knowledgeInClass, 3, "DOM[1] Tại lớp = 3");
      assert.strictEqual(
        codingRes.competencyTotalScore,
        4.22,
        "Làm tròn luân phiên .5 phải đạt đúng TB 4.22 khớp (4.00 + 4.44)/2"
      );

      // 1c) Robotics class uses Slot 4 & Slot 8 (ignoring Slot 5 & Slot 9 decoys)
      const roboticsSlots = Array.from({ length: 14 }, (_, idx) => ({
        slotNumber: idx + 1,
        studentAttendance:
          idx + 1 === 4 || idx + 1 === 8
            ? [
                {
                  student: { id: "STU_ROB_01", fullName: "Lê Bảo Nam" },
                  status: "PRESENT",
                  commentByAreas: buildAreasReversedWithTextNoise([5, 4, 5, 4, 5, 5, 4, 5, 5]),
                },
              ]
            : idx + 1 === 5 || idx + 1 === 9
            ? [
                {
                  student: { id: "STU_ROB_01", fullName: "Lê Bảo Nam" },
                  status: "PRESENT",
                  commentByAreas: buildAreasReversedWithTextNoise([1, 1, 1, 1, 1, 1, 1, 1, 1]),
                },
              ]
            : [],
      }));
      const robRes = computeSession14CompetencyFromCheckpoints({
        classId: "VT-ROB-ARMI13",
        studentId: "STU_ROB_01",
        fullName: "Lê Bảo Nam",
        slots: roboticsSlots,
      });
      assert.strictEqual(robRes.cp1SlotNumber, 4);
      assert.strictEqual(robRes.cp2SlotNumber, 8);
      assert.deepStrictEqual(robRes.ratingsInDomOrder, [5, 4, 5, 4, 5, 5, 4, 5, 5]);

      // 1d) Missing 1 RATE cell in CP1 (26/8 = 3.25): inherits CP2's exact grade at DOM[3] without shifting columns!
      const cp1MissingDom3: Array<number | null> = [4, 3, 3, null, 3, 4, 3, 3, 3]; // 8 valid cells, sum=26 -> 26/8 = 3.25
      const cp2Full: Array<number | null> = [4, 3, 3, 5, 3, 4, 3, 3, 3]; // DOM[3] = 5
      const missingCellRes = computeSession14CompetencyFromCheckpoints({
        classId: "VT-C4K-GA09",
        studentId: "STU_MISSING_CELL",
        cp1CommentByAreas: buildAreasReversedWithTextNoise(cp1MissingDom3),
        cp2CommentByAreas: buildAreasReversedWithTextNoise(cp2Full),
      });
      assert.strictEqual(missingCellRes.cp1Avg, 3.25, "8 ô hợp lệ tổng 26 phải tính cp1Avg = 3.25");
      assert.strictEqual(
        missingCellRes.competencyScores.skillComputerUse,
        5,
        "Ô khuyết ở CP1 (DOM[3]) phải kế thừa đúng điểm 5 của CP2 mà không lệch cột!"
      );
      assert.strictEqual(missingCellRes.competencyScores.skillProblemSolving, 3);

      // 1e) Absent 1 checkpoint (CP1 only vs CP2 only) + CP2 > CP1 priority on .5 tie-break
      const absentCp1Res = computeSession14CompetencyFromCheckpoints({
        classId: "VT-C4K-JSB08",
        studentId: "STU_ABSENT_CP1",
        cp1CommentByAreas: [],
        cp2CommentByAreas: buildAreasReversedWithTextNoise([4, 5, 4, 4, 5, 4, 4, 5, 4]),
      });
      assert.strictEqual(absentCp1Res.sourceType, "CHECKPOINT_CP2_ONLY");
      assert.deepStrictEqual(absentCp1Res.ratingsInDomOrder, [4, 5, 4, 4, 5, 4, 4, 5, 4]);

      // Priority check: DOM[0] dropped (4 -> 3, delta = -1) while DOM[8] improved (3 -> 4, delta = +1)
      // Remaining 7 criteria are 4 -> cp1 sum = 4+4*7+3 = 35 (3.89), cp2 sum = 3+4*7+4 = 35 (3.89) -> targetAvg = 3.89 -> sum 35 -> bestK = 1!
      // DOM[8] (CP2 > CP1) MUST be rounded up to 4 while DOM[0] (CP2 < CP1) stays at 3!
      const priorityRes = computeSession14CompetencyFromCheckpoints({
        classId: "VT-C4K-JSB08",
        studentId: "STU_PRIORITY",
        cp1CommentByAreas: buildAreasReversedWithTextNoise([4, 4, 4, 4, 4, 4, 4, 4, 3]),
        cp2CommentByAreas: buildAreasReversedWithTextNoise([3, 4, 4, 4, 4, 4, 4, 4, 4]),
      });
      assert.strictEqual(
        priorityRes.competencyScores.attitudeInClass,
        4,
        "Tiêu chí tiến bộ ở CP2 (3 -> 4) phải được ưu tiên làm tròn lên 4"
      );
      assert.strictEqual(
        priorityRes.competencyScores.knowledgeSelfStudy,
        3,
        "Tiêu chí giảm ở CP2 (4 -> 3) giữ ở 3 để bảo toàn đúng tổng trung bình 3.89"
      );

      // 1f) Chromium verification: Session14EvalUploader ticks DOM[0] = knowledgeSelfStudy (5) & DOM[1] = knowledgeInClass (2)
      const radioCls = "V360_RADIO_ORDER";
      const radioSid = "STU_RADIO_01";
      classSessionRepo.upsert({
        classId: radioCls,
        className: radioCls,
        sessionId: `${radioCls}_14`,
        sessionNumber: 14,
        date: "2026-11-18",
      });
      studentRepo.upsert({
        classId: radioCls,
        studentId: radioSid,
        fullName: "Phạm Tuấn Kiệt",
        isActive: 1,
      });
      session14EvalRepo.saveDraft({
        classId: radioCls,
        studentId: radioSid,
        competencyScores: {
          knowledgeSelfStudy: 5,
          knowledgeInClass: 2,
          skillCommunication: 4,
          skillComputerUse: 3,
          skillProblemSolving: 4,
          skillCreativity: 5,
          skillComputational: 4,
          attitudeHomework: 3,
          attitudeInClass: 5,
        },
        demoScores: {
          algorithm: 1.4,
          creativity: 0.9,
          communication: 0.5,
          problemSolving: 0.9,
          computerSkills: 0.9,
        },
        learnedFromMindx:
          "Kết quả đánh giá:\nĐiểm Demo: 4.6 điểm\nĐiểm Năng lực: 3.89 điểm\n- Đã nắm vững kiến thức cốt lõi.",
        suggestionsFromMindx: "- Em chủ động hoàn thiện sản phẩm tốt.",
        futureDirection: "- Tiếp tục phát triển dự án nâng cao.",
      });
      assert.strictEqual(session14EvalRepo.approveDraft(radioCls, radioSid).success, true);

      const origOpen01 = LmsHelpers.openClassDrawer;
      const origClean = LmsHelpers.ensureCleanDialogAndToast;
      const origSlot = LmsHelpers.ensureCommentsSlotReady;
      (LmsHelpers as any).openClassDrawer = async () => {};
      (LmsHelpers as any).ensureCleanDialogAndToast = async () => {};
      (LmsHelpers as any).ensureCommentsSlotReady = async () => {};
      const page = await sharedBrowser.newPage();
      let persistedEval01: any = null;
      try {
        await page.route("https://lms-api.mindx.edu.vn/graphql", async (route) => {
          const body = JSON.parse(route.request().postData() || "{}");
          if (body.operationName === "UpdateStudentEvaluation" && body.variables?.input) {
            persistedEval01 = {
              id: "EVAL_OK",
              studentId: body.variables.studentId,
              classId: body.variables.classId,
              slotNumber: body.variables.slotNumber,
              ...body.variables.input,
            };
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              headers: { "access-control-allow-origin": "*" },
              body: JSON.stringify({ data: { updateStudentEvaluation: { id: "EVAL_OK" } } }),
            });
            return;
          }
          if (body.operationName === "GetStudentEvaluation" && persistedEval01) {
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              headers: { "access-control-allow-origin": "*" },
              body: JSON.stringify({ data: { studentEvaluation: persistedEval01 } }),
            });
            return;
          }
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "access-control-allow-origin": "*" },
            body: JSON.stringify({ data: { updateStudentEvaluation: { id: "EVAL_OK" } } }),
          });
        });
        await page.setContent(`<!doctype html><html><body>
          <div class="MuiDrawer-root">
            <table><tbody><tr data-student-id="${radioSid}"><td>Phạm Tuấn Kiệt</td><td><button id="open-btn" type="button">Nhận xét học sinh</button></td></tr></tbody></table>
          </div>
          <div id="eval-dialog" role="dialog" style="display:none">
            <input type="number" disabled value="0" />
            <div id="radios"></div>
            <div id="demos">
              <input type="number" value="0" /><input type="number" value="0" />
              <input type="number" value="0" /><input type="number" value="0" /><input type="number" value="0" />
            </div>
            <div class="ql-editor" contenteditable="true"></div>
            <div class="ql-editor" contenteditable="true"></div>
            <div class="ql-editor" contenteditable="true"></div>
            <button id="save-btn" type="button">Save</button>
            <button id="close-btn" type="button" aria-label="close">Cancel</button>
          </div>
          <script>
            const rWrap = document.getElementById("radios");
            for (let g = 0; g < 9; g++) {
              const div = document.createElement("div");
              for (let v = 1; v <= 5; v++) {
                const inp = document.createElement("input");
                inp.type = "radio"; inp.name = "comp_" + g; inp.value = String(v);
                div.appendChild(inp);
              }
              rWrap.appendChild(div);
            }
            let openCount = 0;
            document.getElementById("open-btn").onclick = () => {
              openCount += 1;
              document.getElementById("eval-dialog").style.display = "block";
              if (openCount > 1) {
                fetch("https://lms-api.mindx.edu.vn/graphql", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    operationName: "GetStudentEvaluation",
                    variables: { studentId: "${radioSid}", classId: "${radioCls}", slotNumber: 14 },
                    query: "query GetStudentEvaluation { studentEvaluation { id } }"
                  })
                })
                  .then(r => r.json())
                  .then(json => {
                    const ev = json?.data?.studentEvaluation;
                    if (!ev) return;
                    document.querySelectorAll(".ql-editor").forEach((el, i) => { el.textContent = ev.texts[i]; });
                    document.querySelectorAll('#demos input[type="number"]').forEach((el, i) => { el.value = ev.nums[i]; });
                    ev.ratings.forEach((rv, g) => {
                      const r = document.querySelector('input[name="comp_' + g + '"][value="' + rv + '"]');
                      if (r) r.checked = true;
                    });
                  });
              }
            };
            document.getElementById("close-btn").onclick = () => {
              document.getElementById("eval-dialog").style.display = "none";
            };
            document.getElementById("save-btn").onclick = () => {
              const ratings = Array.from({ length: 9 }, (_, g) =>
                Number(document.querySelector('input[name="comp_' + g + '"]:checked')?.value || 0)
              );
              const nums = Array.from(document.querySelectorAll('#demos input[type="number"]')).map(e => e.value);
              const texts = Array.from(document.querySelectorAll('.ql-editor')).map(e => e.innerText);
              window.__savedRatings = ratings;
              fetch("https://lms-api.mindx.edu.vn/graphql", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  operationName: "UpdateStudentEvaluation",
                  variables: {
                    studentId: "${radioSid}",
                    classId: "${radioCls}",
                    slotNumber: 14,
                    input: { learnedFromMindx: texts[0], suggestionsFromMindx: texts[1], futureDirection: texts[2], ratings, nums, texts }
                  },
                  query: "mutation UpdateStudentEvaluation($input: EvalInput) { updateStudentEvaluation(input:$input) { id } }"
                })
              });
            };
          </script>
        </body></html>`);

        const upRes = await Session14EvalUploader.uploadApprovedEvaluations({
          classId: radioCls,
          studentIds: [radioSid],
          customPage: page,
          skipNavigation: false,
        });
        assert.strictEqual(upRes.verifiedCount, 1);
        const domRatings = await page.evaluate(() => (window as any).__savedRatings);
        assert.deepStrictEqual(
          domRatings,
          [5, 2, 4, 3, 4, 5, 4, 3, 5],
          "Session14EvalUploader phải tích đúng DOM[0]=5 (Tự học) trước DOM[1]=2 (Tại lớp)!"
        );
      } finally {
        (LmsHelpers as any).openClassDrawer = origOpen01;
        (LmsHelpers as any).ensureCleanDialogAndToast = origClean;
        (LmsHelpers as any).ensureCommentsSlotReady = origSlot;
        await page.close();
      }
    }
    console.log("  -> PASS V360-01.");

    // =========================================================================
    // [V360-02] Xếp hạng Nhất/Đồng Nhì/Đồng Ba 3dp, Summary B14 & Nộp từng phần
    // =========================================================================
    console.log(
      "\n[V360-02] Kiểm thử xếp hạng 3 chữ số thập phân, Summary Buổi 14 (id='13' unchecked + UpdateSlotComment), 3-Quill vs Robotics 4-Quill & nộp từng phần..."
    );
    {
      // 2a) Pure 3dp tie/separation check: 3.880 beats 3.875 even though both round to 3.88 at 2dp!
      const precisionCheck = computeSession14AwardRankingsPure([
        { studentId: "P1", fullName: "Học Viên Một", rawTotalScore3dp: 4.5 },
        { studentId: "P2", fullName: "Học Viên Hai", rawTotalScore3dp: 3.88 },
        { studentId: "P3", fullName: "Học Viên Ba", rawTotalScore3dp: 3.875 },
      ]);
      assert.strictEqual(precisionCheck[1].studentId, "P2");
      assert.strictEqual(precisionCheck[1].displayTotalScore2dp, 3.88);
      assert.strictEqual(precisionCheck[1].awardLabel, "Giải Nhì");
      assert.strictEqual(precisionCheck[2].studentId, "P3");
      assert.strictEqual(precisionCheck[2].displayTotalScore2dp, 3.88);
      assert.strictEqual(
        precisionCheck[2].awardLabel,
        "Giải Ba",
        "Điểm gốc 3.875 và 3.880 phải được phân hạng chính xác trước khi làm tròn 2dp LMS!"
      );

      // 2b) Full class .xlsx import with Giải Nhất (4.250), Đồng Giải Nhì (4.125 x2), Đồng Giải Ba (3.875 x2),
      //     COMPLETED 4th tier (3.375), withdrawn student (isActive=0), and 1 unready student (missing score)
      const awardCls = "VT-C4K-JSB08";
      classSessionRepo.upsert({
        classId: awardCls,
        className: awardCls,
        sessionId: `${awardCls}_14`,
        sessionNumber: 14,
        date: "2026-11-18",
      });

      const roster = [
        { id: "JSB_S1", name: "Nguyễn Hoàng Anh", active: 1, title: "Cẩm Nang Du Lịch Việt Nam" },
        { id: "JSB_S2", name: "Trần Gia Bảo", active: 1, title: "Sàn Thương Mại Sách Xanh" },
        { id: "JSB_S3", name: "Lê Minh Châu", active: 1, title: "Không Gian Học Tập Pomodoro" },
        { id: "JSB_S4", name: "Phạm Đức Duy", active: 1, title: "Bản Đồ Ẩm Thực Đường Phố" },
        { id: "JSB_S5", name: "Võ Thảo Vy", active: 1, title: "Nhật Ký Chăm Sóc Cây Trồng" },
        { id: "JSB_S6", name: "Đặng Quốc Huy", active: 1, title: "Trang Tin Thể Thao Học Đường" },
        { id: "JSB_S7_OFF", name: "Bùi Bảo Long", active: 0, title: "Đã Bảo Lưu" },
        { id: "JSB_S8_MISS", name: "Ngô Hải Đăng", active: 1, title: "" },
      ];

      for (const s of roster) {
        studentRepo.upsert({
          classId: awardCls,
          studentId: s.id,
          fullName: s.name,
          isActive: s.active,
        });
        if (s.title && s.active === 1) {
          const stuDir = path.join(tempSpckRoot, awardCls, s.name);
          fs.mkdirSync(stuDir, { recursive: true });
          fs.writeFileSync(path.join(stuDir, "index.html"), `<h1>${s.title}</h1>`, "utf8");
          spckUploadRepo.upsert({
            classId: awardCls,
            studentId: s.id,
            localFolderPath: stuDir,
            isConfirmedByTeacher: 1,
            projectTitle: `${s.title} - Buổi 14`,
            baseProjectTitle: s.title,
            thumbnailPath: path.join(tempConfigDir, "default-spck-thumbnail.png"),
            status: "DRAFT",
          });
        }
      }

      const xlsxPath = path.join(tempSpckRoot, awardCls, "Bang_Cham_Diem_JSB08.xlsx");
      const wbBuf = buildMultiTabDemoXlsxBuffer([
        {
          tabName: "Hoàng Anh",
          studentCellB2: "Nguyễn Hoàng Anh",
          // 1.375 + 0.750 + 0.875 + 0.750 + 0.500 = 4.250 (Giải Nhất)
          summaryB: [1.375, 0.75, 0.875, 0.75, 0.5],
          judgeComment1: "Nguyễn Hoàng Anh thuyết trình rất tự tin, bố cục rõ.",
        },
        {
          tabName: "Gia Bảo",
          studentCellB2: "Trần Gia Bảo",
          // 1.250 + 0.750 + 0.875 + 0.750 + 0.500 = 4.125 (Đồng Giải Nhì)
          summaryB: [1.25, 0.75, 0.875, 0.75, 0.5],
        },
        {
          tabName: "Minh Châu",
          studentCellB2: "Lê Minh Châu",
          // 4.125 (Đồng Giải Nhì)
          summaryB: [1.25, 0.75, 0.875, 0.75, 0.5],
        },
        {
          tabName: "Đức Duy",
          studentCellB2: "Phạm Đức Duy",
          // 1.125 + 0.750 + 0.875 + 0.750 + 0.375 = 3.875 (Đồng Giải Ba)
          summaryB: [1.125, 0.75, 0.875, 0.75, 0.375],
        },
        {
          tabName: "Thảo Vy",
          studentCellB2: "Võ Thảo Vy",
          // 3.875 (Đồng Giải Ba)
          summaryB: [1.125, 0.75, 0.875, 0.75, 0.375],
        },
        {
          tabName: "Quốc Huy",
          studentCellB2: "Đặng Quốc Huy",
          // 1.000 + 0.625 + 0.750 + 0.625 + 0.375 = 3.375 (Hạng 4 -> COMPLETED, không trao giải)
          summaryB: [1.0, 0.625, 0.75, 0.625, 0.375],
        },
      ]);
      fs.writeFileSync(xlsxPath, wbBuf);

      const impRes = await s14ImportDemoPost(
        localJsonRequest("http://127.0.0.1:3000/api/spck/session14-eval/import-demo-scores", {
          classId: awardCls,
          sourcePathOrUrl: xlsxPath,
        })
      );
      const impJson = await impRes.json();
      assert.strictEqual(impJson.success, true, impJson.error || "Import Demo .xlsx phải thành công");
      assert.strictEqual(impJson.importResult.matchedCount, 6);

      const rankings: any[] = impJson.rankings;
      assert.strictEqual(
        rankings.some((r) => r.studentId === "JSB_S7_OFF"),
        false,
        "Học viên bảo lưu (isActive=0) không được xuất hiện trong bảng xếp hạng vinh danh!"
      );
      const byStu = new Map(rankings.map((r) => [r.studentId, r]));
      assert.strictEqual(byStu.get("JSB_S1")?.awardLabel, "Giải Nhất");
      assert.strictEqual(byStu.get("JSB_S1")?.rawTotalScore3dp, 4.25);
      assert.strictEqual(byStu.get("JSB_S2")?.awardLabel, "Đồng Giải Nhì");
      assert.strictEqual(byStu.get("JSB_S2")?.rawScoreText, "4.125");
      assert.strictEqual(byStu.get("JSB_S3")?.awardLabel, "Đồng Giải Nhì");
      assert.strictEqual(byStu.get("JSB_S4")?.awardLabel, "Đồng Giải Ba");
      assert.strictEqual(byStu.get("JSB_S4")?.rawScoreText, "3.875");
      assert.strictEqual(byStu.get("JSB_S4")?.displayTotalScore2dp, 3.88);
      assert.strictEqual(byStu.get("JSB_S5")?.awardLabel, "Đồng Giải Ba");
      assert.strictEqual(byStu.get("JSB_S6")?.awardTier, "COMPLETED");
      assert.strictEqual(byStu.get("JSB_S6")?.awardLabel, "Hoàn thành dự án cuối khóa");
      assert.strictEqual(byStu.get("JSB_S8_MISS")?.awardTier, "UNSCORED");

      // [F1] UI helper check: COMPLETED 4th-place student MUST NOT receive a podium award badge!
      const s6RecUi = impJson.records.find((r: any) => r.studentId === "JSB_S6");
      const s2RecUi = impJson.records.find((r: any) => r.studentId === "JSB_S2");
      assert.strictEqual(
        resolveStudentAwardLabel(s6RecUi),
        "",
        "[F1] Học viên hạng 4+ (COMPLETED / 'Hoàn thành dự án cuối khóa') tuyệt đối không được gắn huy hiệu giải thưởng!"
      );
      assert.strictEqual(resolveStudentAwardLabel(s2RecUi), "Đồng Giải Nhì");

      // Auto-generated classSummary HTML check + teacher edit preservation + reset
      assert.match(
        impJson.classSummary.summaryHtml,
        /<strong>BUỔI 14: TỔNG KẾT CUỐI KHÓA &amp; VINH DANH BẢO VỆ DỰ ÁN \(DEMO DAY\) — LỚP VT-C4K-JSB08<\/strong>/
      );
      assert.ok(impJson.classSummary.bodyText.includes("🥇 Giải Nhất (4.25/5.0 điểm): Nguyễn Hoàng Anh"));
      assert.ok(impJson.classSummary.bodyText.includes("🥈 Đồng Giải Nhì (4.125/5.0 điểm):"));
      assert.ok(impJson.classSummary.bodyText.includes("🥉 Đồng Giải Ba (3.875/5.0 điểm):"));

      const editSumRes = await s14EvalPost(
        localJsonRequest("http://127.0.0.1:3000/api/spck/session14-eval", {
          action: "save_class_summary",
          classId: awardCls,
          bodyText: "Bản tổng kết do thầy chỉnh sửa tay cho lớp JSB08.",
        })
      );
      const editSumJson = await editSumRes.json();
      assert.strictEqual(editSumJson.success, true);
      assert.strictEqual(editSumJson.classSummary.isEditedByTeacher, 1);

      // Re-importing scores MUST preserve teacher's edited classSummary
      await s14ImportDemoPost(
        localJsonRequest("http://127.0.0.1:3000/api/spck/session14-eval/import-demo-scores", {
          classId: awardCls,
          sourcePathOrUrl: xlsxPath,
        })
      );
      assert.ok(
        session14ClassSummaryRepo.findOne(awardCls)?.bodyText.includes("do thầy chỉnh sửa tay"),
        "Nạp lại điểm BGK không được ghi đè bản Summary giáo viên đã tự chỉnh sửa!"
      );

      // Reset restores auto-generated vinh danh summary
      const resetSumRes = await s14EvalPost(
        localJsonRequest("http://127.0.0.1:3000/api/spck/session14-eval", {
          action: "reset_class_summary",
          classId: awardCls,
        })
      );
      const resetSumJson = await resetSumRes.json();
      assert.strictEqual(resetSumJson.success, true);
      assert.strictEqual(resetSumJson.classSummary.isEditedByTeacher, 0);
      assert.ok(resetSumJson.classSummary.bodyText.includes("🥇 Giải Nhất"));

      // 2c) AI Course Summary: 3-Quill Coding (`awardRanking === ""`) vs 4-Quill Robotics + PII Guard (including catch path [B2]!)
      const outboundPrompts: string[] = [];
      let shouldThrowOnSecondCall = false;
      let aiCallIdx = 0;
      GoogleGenerativeAI.prototype.getGenerativeModel = (() => ({
        generateContent: async (promptText: string) => {
          aiCallIdx += 1;
          outboundPrompts.push(String(promptText));
          if (shouldThrowOnSecondCall && aiCallIdx === 2) {
            throw new Error("Simulated Gemini 503 Overload");
          }
          return {
            response: {
              text: () =>
                JSON.stringify({
                  knowledgeParagraph1:
                    "Trong suốt quá trình học, STUDENT_SHORT_01 nắm vững kiến thức cốt lõi và vận dụng tốt vào các bài thực hành trên lớp.",
                  knowledgeParagraph2:
                    "Em có tinh thần tự giác tìm hiểu và chủ động sửa lỗi chương trình khi gặp vấn đề.",
                  knowledgeParagraph3:
                    "Ở dự án cuối khóa, STUDENT_SHORT_01 hoàn thiện sản phẩm chỉn chu, bố cục rõ ràng và đúng yêu cầu đề tài.",
                  softSkillsParagraph1:
                    "STUDENT_SHORT_01 hợp tác tích cực với giáo viên và các bạn trong lớp.",
                  softSkillsParagraph2:
                    "Phần thuyết trình cuối khóa của STUDENT_SHORT_01 tự tin, mạch lạc và trả lời tốt câu hỏi phản biện.",
                  personalParagraph1:
                    "STUDENT_SHORT_01 có tư duy logic tốt và thái độ học tập nghiêm túc.",
                  personalParagraph2:
                    "Khuyến khích STUDENT_SHORT_01 tiếp tục duy trì thói quen tự rèn luyện dự án thực tế.",
                  suggestionsFromMindx:
                    "Trong thời gian tới, khuyến khích STUDENT_SHORT_01 tiếp tục tự thực hành và mở rộng các tính năng nâng cao cho sản phẩm.",
                  futureDirection:
                    "STUDENT_SHORT_01 có nền tảng vững vàng và sẵn sàng chinh phục khóa học nâng cao tiếp theo tại MindX.",
                }),
            },
          };
        },
      })) as any;

      shouldThrowOnSecondCall = true;
      const genCodingRes = await s14GenAiPost(
        localJsonRequest("http://127.0.0.1:3000/api/spck/session14-eval/generate-ai", {
          classId: awardCls,
          students: [
            {
              studentId: "JSB_S1",
              teacherNote: "Nguyễn Hoàng Anh hỗ trợ bạn Trần Gia Bảo rất nhiệt tình.",
            },
            {
              studentId: "JSB_S2",
              teacherNote: "Trần Gia Bảo phối hợp cùng Lê Minh Châu tốt.",
            },
          ],
        })
      );
      const genCodingJson = await genCodingRes.json();
      assert.strictEqual(genCodingJson.success, true);
      const resS1 = genCodingJson.results.find((r: any) => r.studentId === "JSB_S1");
      const resS2Err = genCodingJson.results.find((r: any) => r.studentId === "JSB_S2");
      assert.strictEqual(resS1.status, "SUCCESS");
      assert.strictEqual(resS2Err.status, "ERROR");

      // [B2] Both outboundPrompts AND error-path outboundPromptSample MUST contain 0 real names!
      for (const sample of [...outboundPrompts, String(resS2Err.outboundPromptSample || "")]) {
        for (const r of roster) {
          assert.strictEqual(
            sample.includes(r.name),
            false,
            `[B2] PII Leak: Tên thật '${r.name}' tuyệt đối không được xuất hiện trong prompt hoặc outboundPromptSample lỗi!`
          );
        }
      }
      assert.strictEqual(
        session14EvalRepo.findOne(awardCls, "JSB_S1")?.awardRanking,
        "",
        "Lớp lập trình 3-Quill (JSB/GA) bắt buộc giữ awardRanking === ''!"
      );

      // Robotics class populates 4th Quill box (`awardRanking`)
      const robAwardCls = "VT-ROB-ARMI13";
      classSessionRepo.upsert({
        classId: robAwardCls,
        className: robAwardCls,
        sessionId: `${robAwardCls}_14`,
        sessionNumber: 14,
        date: "2026-11-18",
      });
      studentRepo.upsert({
        classId: robAwardCls,
        studentId: "ROB_S1",
        fullName: "Phan Gia Hưng",
        isActive: 1,
      });
      session14EvalRepo.saveDraft({
        classId: robAwardCls,
        studentId: "ROB_S1",
        demoScores: {
          creativity: 1.2,
          communication: 0.7,
          problemSolving: 0.95,
          computerSkills: 0.45,
          algorithm: 0.95,
        },
        demoRawTotalScore: 4.25,
      });
      shouldThrowOnSecondCall = false;
      const genRobRes = await s14GenAiPost(
        localJsonRequest("http://127.0.0.1:3000/api/spck/session14-eval/generate-ai", {
          classId: robAwardCls,
          students: [{ studentId: "ROB_S1", teacherNote: "Lắp ráp cơ khí vững vàng." }],
        })
      );
      const genRobJson = await genRobRes.json();
      assert.strictEqual(genRobJson.success, true);
      assert.strictEqual(
        session14EvalRepo.findOne(robAwardCls, "ROB_S1")?.awardRanking,
        "Giải Nhất (4.25/4.5 điểm)",
        "Lớp Robotics có ô Quill thứ 4 bắt buộc điền đúng hạng giải thưởng kèm điểm ('Giải Nhất (4.25/4.5 điểm)')!"
      );

      // 2d) Partial Class Approval & Chromium Slot 14 Summary + Student Upload (`id="13"` unchecked + `UpdateSlotComment`)
      // Approve JSB_S1 while JSB_S8_MISS remains DRAFT/missing -> allowPartial succeeds for JSB_S1!
      const partialApproveRes = await s14EvalPost(
        localJsonRequest("http://127.0.0.1:3000/api/spck/session14-eval", {
          action: "approve",
          classId: awardCls,
          studentIds: ["JSB_S1", "JSB_S8_MISS"],
          allowPartial: true,
          isolatePerStudent: true,
        })
      );
      const partialApproveJson = await partialApproveRes.json();
      assert.strictEqual(partialApproveJson.success, true);
      assert.deepStrictEqual(partialApproveJson.approvedIds, ["JSB_S1"]);
      assert.strictEqual(
        Array.isArray(partialApproveJson.errors) &&
          partialApproveJson.errors.some((e: any) => e.studentId === "JSB_S8_MISS"),
        true
      );

      // Chromium mock LMS Drawer with pre-checked checkbox id="13", collapsed Summary card, delayed UpdateSlotComment (450ms), and 3-Quill student modal
      const origOpenDrawer = LmsHelpers.openClassDrawer;
      const origSwitchTab = LmsHelpers.switchDrawerTab;
      const origClean2 = LmsHelpers.ensureCleanDialogAndToast;
      const origSlot2 = LmsHelpers.ensureCommentsSlotReady;
      const bm = BrowserManager.getInstance();
      const origGetPage = bm.getPage.bind(bm);
      const origEnsureAuth = authService.ensureAuthenticated.bind(authService);

      const slotPage = await sharedBrowser.newPage();
      let updateSlotCommentCalls = 0;
      let failSlotCommentMutation = false;
      let persistedEvalS1: any = null;

      try {
        (authService as any).ensureAuthenticated = async () => {};
        (bm as any).getPage = async () => slotPage;
        (LmsHelpers as any).openClassDrawer = async () => {};
        (LmsHelpers as any).switchDrawerTab = async () => {};
        (LmsHelpers as any).ensureCleanDialogAndToast = async () => {};
        (LmsHelpers as any).ensureCommentsSlotReady = async () => {};

        await slotPage.route("https://lms-api.mindx.edu.vn/graphql", async (route) => {
          const body = JSON.parse(route.request().postData() || "{}");
          if (body.operationName === "UpdateSlotComment") {
            updateSlotCommentCalls += 1;
            await new Promise((r) => setTimeout(r, 350));
            if (failSlotCommentMutation) {
              await route.fulfill({
                status: 500,
                contentType: "application/json",
                headers: { "access-control-allow-origin": "*" },
                body: JSON.stringify({ errors: [{ message: "Internal Server Error" }] }),
              });
              return;
            }
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              headers: { "access-control-allow-origin": "*" },
              body: JSON.stringify({
                data: { updateSlotComment: { id: "SLOT_14_OK", summary: body.variables?.summary } },
              }),
            });
            return;
          }
          if (body.operationName === "UpdateStudentEvaluation" && body.variables?.input) {
            persistedEvalS1 = {
              id: "EVAL_S1_OK",
              studentId: body.variables.studentId,
              classId: body.variables.classId,
              slotNumber: body.variables.slotNumber,
              ...body.variables.input,
            };
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              headers: { "access-control-allow-origin": "*" },
              body: JSON.stringify({ data: { updateStudentEvaluation: { id: "EVAL_S1_OK" } } }),
            });
            return;
          }
          if (body.operationName === "GetStudentEvaluation" && persistedEvalS1) {
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              headers: { "access-control-allow-origin": "*" },
              body: JSON.stringify({ data: { studentEvaluation: persistedEvalS1 } }),
            });
            return;
          }
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "access-control-allow-origin": "*" },
            body: JSON.stringify({ data: { updateStudentEvaluation: { id: "EVAL_S1_OK" } } }),
          });
        });

        await slotPage.goto("about:blank");
        await slotPage.setContent(`<!doctype html><html><body>
          <div class="MuiDrawer-root MuiDrawer-paperAnchorRight" aria-labelledby="class-detail">
            <div>
              <input type="checkbox" id="13" checked />
              <button id="class-comments-slot-carousel-13" class="active">#14</button>
            </div>
            <div><div><div><div><span>Summary</span><svg data-testid="ExpandMoreIcon"></svg></div></div></div>
              <div id="summary-body" style="display:none">
                <div><div><div class="ql-editor" contenteditable="true"><p>Old summary</p></div></div></div>
              </div>
            </div>
            <table>
              <thead><tr><th>student</th><th>Comment</th></tr></thead>
              <tbody>
                <tr data-student-id="JSB_S1"><td>Nguyễn Hoàng Anh</td><td><button id="open-s1" type="button">Nhận xét học sinh</button></td></tr>
                <tr data-student-id="JSB_S8_MISS"><td>Ngô Hải Đăng</td><td><button id="open-s8" type="button">Nhận xét học sinh</button></td></tr>
              </tbody>
            </table>
          </div>
          <div id="s14-modal" role="dialog" style="display:none">
            <input type="number" disabled value="0" />
            <div id="m-radios"></div>
            <div id="m-demos">
              <input type="number" value="0" /><input type="number" value="0" />
              <input type="number" value="0" /><input type="number" value="0" /><input type="number" value="0" />
            </div>
            <div class="ql-editor" contenteditable="true"></div>
            <div class="ql-editor" contenteditable="true"></div>
            <div class="ql-editor" contenteditable="true"></div>
            <button id="m-save" type="button">Save</button>
            <button id="m-close" type="button" aria-label="close">Cancel</button>
          </div>
          <script>
            document.querySelector('[data-testid="ExpandMoreIcon"]').addEventListener("click", () => {
              document.getElementById("summary-body").style.display = "block";
            });
            const sumEditor = document.querySelector("#summary-body .ql-editor");
            let debTimer = null;
            sumEditor.addEventListener("input", () => {
              clearTimeout(debTimer);
              debTimer = setTimeout(() => {
                fetch("https://lms-api.mindx.edu.vn/graphql", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    operationName: "UpdateSlotComment",
                    variables: { slotIndex: 13, summary: sumEditor.innerHTML },
                    query: "mutation UpdateSlotComment($summary: String) { updateSlotComment(summary: $summary) { id } }"
                  })
                });
              }, 120);
            });

            const rWrap = document.getElementById("m-radios");
            for (let g = 0; g < 9; g++) {
              const d = document.createElement("div");
              for (let v = 1; v <= 5; v++) {
                const inp = document.createElement("input");
                inp.type = "radio"; inp.name = "mg_" + g; inp.value = String(v);
                d.appendChild(inp);
              }
              rWrap.appendChild(d);
            }
            let openS1Count = 0;
            document.getElementById("open-s1").onclick = () => {
              openS1Count += 1;
              document.getElementById("s14-modal").style.display = "block";
              if (openS1Count > 1) {
                fetch("https://lms-api.mindx.edu.vn/graphql", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    operationName: "GetStudentEvaluation",
                    variables: { studentId: "JSB_S1", classId: "${awardCls}", slotNumber: 14 },
                    query: "query GetStudentEvaluation { studentEvaluation { id } }"
                  })
                })
                  .then(r => r.json())
                  .then(json => {
                    const ev = json?.data?.studentEvaluation;
                    if (!ev) return;
                    document.querySelectorAll("#s14-modal .ql-editor").forEach((el, i) => { el.textContent = ev.texts[i]; });
                    document.querySelectorAll('#m-demos input[type="number"]').forEach((el, i) => { el.value = ev.nums[i]; });
                    ev.ratings.forEach((rv, g) => {
                      const r = document.querySelector('input[name="mg_' + g + '"][value="' + rv + '"]');
                      if (r) r.checked = true;
                    });
                  });
              }
            };
            document.getElementById("m-close").onclick = () => {
              document.getElementById("s14-modal").style.display = "none";
            };
            document.getElementById("m-save").onclick = () => {
              const ratings = Array.from({ length: 9 }, (_, g) =>
                Number(document.querySelector('input[name="mg_' + g + '"]:checked')?.value || 0)
              );
              const nums = Array.from(document.querySelectorAll('#m-demos input[type="number"]')).map(e => e.value);
              const texts = Array.from(document.querySelectorAll('#s14-modal .ql-editor')).map(e => e.innerText);
              fetch("https://lms-api.mindx.edu.vn/graphql", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  operationName: "UpdateStudentEvaluation",
                  variables: {
                    studentId: "JSB_S1",
                    classId: "${awardCls}",
                    slotNumber: 14,
                    input: { learnedFromMindx: texts[0], suggestionsFromMindx: texts[1], futureDirection: texts[2], ratings, nums, texts }
                  },
                  query: "mutation UpdateStudentEvaluation($input: EvalInput) { updateStudentEvaluation(input:$input) { id } }"
                })
              });
            };
          </script>
        </body></html>`);

        // First: fail-closed check when UpdateSlotComment returns HTTP 500
        failSlotCommentMutation = true;
        const failSumUploadRes = await s14UploadLmsPost(
          localJsonRequest("http://127.0.0.1:3000/api/spck/session14-eval/upload-lms", {
            classId: awardCls,
            studentIds: ["JSB_S1", "JSB_S8_MISS"],
            uploadClassSummary: true,
            skipUnapproved: true,
          })
        );
        const failSumJson = await failSumUploadRes.json();
        assert.ok(
          failSumJson.uploadResult,
          `upload-lms không được văng ngoại lệ 500: ${failSumJson.error || JSON.stringify(failSumJson)}`
        );
        assert.strictEqual(
          failSumJson.uploadResult.classSummaryStatus,
          "FAILED",
          "Khi API UpdateSlotComment lỗi HTTP 500, classSummaryStatus bắt buộc phải là FAILED!"
        );
        assert.strictEqual(
          failSumJson.uploadResult.verifiedCount,
          1,
          "Học viên JSB_S1 đã duyệt vẫn phải được xác minh VERIFIED độc lập khi JSB_S8_MISS chưa duyệt!"
        );
        assert.strictEqual(
          failSumJson.uploadResult.skippedCount,
          1,
          "Học viên JSB_S8_MISS thiếu bài/chưa duyệt phải được SKIPPED nhẹ nhàng!"
        );

        // Re-approve JSB_S1 to test clean HTTP 200 Summary + checkbox id="13" === false
        session14EvalRepo.saveDraft({
          classId: awardCls,
          studentId: "JSB_S1",
          teacherNote: "Cập nhật nhẹ để kiểm thử lần 2",
        });
        session14EvalRepo.approveDraft(awardCls, "JSB_S1");
        await slotPage.evaluate(() => {
          (document.getElementById("13") as HTMLInputElement).checked = true;
        });
        failSlotCommentMutation = false;

        const okUploadRes = await s14UploadLmsPost(
          localJsonRequest("http://127.0.0.1:3000/api/spck/session14-eval/upload-lms", {
            classId: awardCls,
            studentIds: ["JSB_S1", "JSB_S8_MISS"],
            uploadClassSummary: true,
            skipUnapproved: true,
          })
        );
        const okUploadJson = await okUploadRes.json();
        assert.strictEqual(okUploadJson.success, true);
        assert.strictEqual(okUploadJson.uploadResult.classSummaryStatus, "VERIFIED");
        assert.strictEqual(okUploadJson.uploadResult.classSummaryVerified, true);
        assert.ok(updateSlotCommentCalls >= 2, "Phải chờ mutation UpdateSlotComment thực sự bắn đi");

        const cb13CheckedAfter = await slotPage.locator('input[type="checkbox"][id="13"]').isChecked();
        assert.strictEqual(
          cb13CheckedAfter,
          false,
          "Checkbox id='13' trên đầu trang Buổi 14 bắt buộc phải giữ checked === false!"
        );
        assert.strictEqual(session14ClassSummaryRepo.findOne(awardCls)?.status, "VERIFIED");
      } finally {
        (authService as any).ensureAuthenticated = origEnsureAuth;
        (bm as any).getPage = origGetPage;
        (LmsHelpers as any).openClassDrawer = origOpenDrawer;
        (LmsHelpers as any).switchDrawerTab = origSwitchTab;
        (LmsHelpers as any).ensureCleanDialogAndToast = origClean2;
        (LmsHelpers as any).ensureCommentsSlotReady = origSlot2;
        await slotPage.close();
      }
    }
    console.log("  -> PASS V360-02.");

    // =========================================================================
    // [V360-03] Gói .yyz > 15 MB (nhạc 16 MB), lọc file nhạy cảm & Bỏ qua nhanh < 1s
    // =========================================================================
    console.log(
      "\n[V360-03] Kiểm thử tách gọn .yyz có nhạc 16 MB (>15 MB), lọc sạch file bí mật, GCM_INTERACTIVE=never & bỏ qua nhanh < 1s..."
    );
    {
      const gaCls = "VT-C4K-GA12";
      for (const n of [12, 13, 14]) {
        classSessionRepo.upsert({
          classId: gaCls,
          className: gaCls,
          sessionId: `${gaCls}_${n}`,
          sessionNumber: n,
          date: "2026-11-18",
        });
      }
      studentRepo.upsert({
        classId: gaCls,
        studentId: "GA_STU_01",
        fullName: "Hoàng Minh Quân",
        isActive: 1,
      });

      const gaClassDir = path.join(tempSpckRoot, gaCls);
      const stuGameDir = path.join(gaClassDir, "Hoàng Minh Quân");
      fs.mkdirSync(stuGameDir, { recursive: true });

      // Older .yyz with older mtime (must NOT win over newer .yyz)
      const olderYyzPath = path.join(stuGameDir, "OldDraft.yyz");
      const olderZip = new AdmZip();
      olderZip.addFile("OldDraft.yyp", Buffer.from('{"name":"Bản Cũ"}', "utf8"));
      fs.writeFileSync(olderYyzPath, olderZip.toBuffer());
      const pastTime = new Date(Date.now() - 60_000);
      fs.utimesSync(olderYyzPath, pastTime, pastTime);

      // Newer .yyz containing 16 MB Snd_win.mp3 + GameMaker structure + injected sensitive secrets!
      const newerYyzPath = path.join(stuGameDir, "HiepSiNganHa.yyz");
      const bigAudio16Mb = Buffer.alloc(16 * 1024 * 1024, 0x55); // 16 MB > 15 MB single-file LMS cap
      const gameZip = new AdmZip();
      gameZip.addFile(
        "HiepSiNganHa.yyp",
        Buffer.from(
          JSON.stringify({ resourceType: "GMProject", name: "Hiệp Sĩ Ngân Hà Đại Chiến" }),
          "utf8"
        )
      );
      gameZip.addFile("rooms/Rm_main/Rm_main.yy", Buffer.from('{"name":"Rm_main"}', "utf8"));
      gameZip.addFile("objects/Obj_player/Obj_player.yy", Buffer.from('{"name":"Obj_player"}', "utf8"));
      gameZip.addFile(
        "scripts/Scr_player/Scr_player.gml",
        Buffer.from("function move_hero() { x += 4; }\n", "utf8")
      );
      gameZip.addFile("sprites/Spr_hero/Spr_hero.png", MINIMAL_1X1_PNG);
      gameZip.addFile("sprites/Spr_hero/layers/layer_dup.png", MINIMAL_1X1_PNG);
      gameZip.addFile("sounds/Snd_win/Snd_win.mp3", bigAudio16Mb);
      // [B1] Sensitive files that MUST NEVER leak into spck_lms_trim_*.zip
      gameZip.addFile(".env", Buffer.from("GEMINI_API_KEY=LEAK_SECRET\n", "utf8"));
      gameZip.addFile("config/.env.local", Buffer.from("LMS_PASSWORD=LEAK_SECRET\n", "utf8"));
      gameZip.addFile("keys/server.pem", Buffer.from("-----BEGIN PRIVATE KEY-----\nabc\n", "utf8"));
      gameZip.addFile("keys/private.key", Buffer.from("secret-key", "utf8"));
      gameZip.addFile("ssh/id_rsa", Buffer.from("ssh-private-key", "utf8"));
      gameZip.addFile(
        "serviceAccountKey.json",
        Buffer.from('{"private_key":"-----BEGIN PRIVATE KEY-----","client_email":"a@b.iam.gserviceaccount.com"}', "utf8")
      );
      fs.writeFileSync(newerYyzPath, gameZip.toBuffer());

      // Direct unit checks on isSensitiveSecretFile
      for (const secretName of [
        ".env",
        ".env.production",
        "server.pem",
        "private.key",
        "cert.pfx",
        "id_rsa",
        "id_ed25519",
        "service-account-prod.json",
      ]) {
        assert.strictEqual(
          isSensitiveSecretFile(secretName),
          true,
          `[B1] isSensitiveSecretFile('${secretName}') bắt buộc phải trả về true!`
        );
      }

      // Scan via POST /api/spck/scan -> trimmed .zip for LMS, full 16 MB .yyz for Google Drive
      const scanRes = await scanPost(
        localJsonRequest("http://127.0.0.1:3000/api/spck/scan", {
          classId: gaCls,
          folderPath: gaClassDir,
          sessionNumber: 12,
        })
      );
      const scanJson = await scanRes.json();
      assert.strictEqual(scanJson.success, true, scanJson.error || "Scan GA12 phải thành công");

      const gaRec = spckUploadRepo.findOne(gaCls, "GA_STU_01")!;
      const lmsAttachments: string[] = JSON.parse(gaRec.attachmentsJson || "[]");
      assert.strictEqual(lmsAttachments.length, 1, "Phải đính kèm đúng 1 gói rút gọn cho LMS");
      const trimmedZipPath = lmsAttachments[0];
      assert.match(path.basename(trimmedZipPath), /^spck_lms_trim_.*\.zip$/i);
      assert.ok(
        trimmedZipPath.startsWith(tempRoot),
        "Gói spck_lms_trim_*.zip khi chạy test bắt buộc nằm trong tempRoot, không chạm workspace!"
      );

      const trimmedEntries = new AdmZip(trimmedZipPath).getEntries();
      const trimmedNames = trimmedEntries.map((e) => e.entryName);
      assert.ok(trimmedNames.includes("HiepSiNganHa.yyp"), "Phải chọn đúng file .yyz mới hơn");
      assert.ok(trimmedNames.includes("scripts/Scr_player/Scr_player.gml"));
      assert.strictEqual(
        trimmedNames.some((n) => n.includes("Snd_win.mp3")),
        false,
        "File nhạc Snd_win.mp3 (16 MB > 15 MB) phải được lược bỏ khỏi gói LMS"
      );
      for (const e of trimmedEntries) {
        assert.ok(
          e.header.size <= 15 * 1024 * 1024,
          `Mọi entry trong gói LMS phải <= 15 MB (${e.entryName})`
        );
        const lowerBase = path.posix.basename(e.entryName).toLowerCase();
        assert.strictEqual(
          lowerBase.startsWith(".env") ||
            lowerBase.endsWith(".pem") ||
            lowerBase.endsWith(".key") ||
            lowerBase === "id_rsa" ||
            lowerBase === "serviceaccountkey.json",
          false,
          `[B1] Tệp nhạy cảm '${e.entryName}' tuyệt đối không được lọt vào spck_lms_trim_*.zip!`
        );
      }

      // Zip-Slip (`../escape.gml`) & `.exe` inside oversized .yyz MUST be rejected (`null`)
      const evilYyzPath = path.join(tempRoot, "EvilExec.yyz");
      const evilZip = new AdmZip();
      evilZip.addFile("Evil.yyp", Buffer.from('{"name":"Evil"}', "utf8"));
      evilZip.addFile("sounds/big.mp3", bigAudio16Mb);
      evilZip.addFile("payload.exe", Buffer.from("MZ_EXECUTABLE", "utf8"));
      fs.writeFileSync(evilYyzPath, evilZip.toBuffer());
      assert.strictEqual(
        buildTrimmedLmsZipForOversizedArchive(evilYyzPath, "EVIL_STU"),
        null,
        "Gói .yyz chứa file thực thi .exe bắt buộc bị từ chối!"
      );

      const slipYyzPath = path.join(tempRoot, "EvilSlip.yyz");
      const slipZip = new AdmZip();
      slipZip.addFile("Evil.yyp", Buffer.from('{"name":"Evil"}', "utf8"));
      slipZip.addFile("sounds/big.mp3", bigAudio16Mb);
      slipZip.addFile("scripts/safe_xx.gml", Buffer.from("// zip slip", "utf8"));
      const rawSlipBuf = slipZip.toBuffer();
      const needle = Buffer.from("scripts/safe_xx.gml", "utf8");
      const poison = Buffer.from("../evil_slip_xx.gml", "utf8");
      assert.strictEqual(needle.length, poison.length);
      let searchPos = 0;
      while (true) {
        const hit = rawSlipBuf.indexOf(needle, searchPos);
        if (hit < 0) break;
        poison.copy(rawSlipBuf, hit);
        searchPos = hit + poison.length;
      }
      fs.writeFileSync(slipYyzPath, rawSlipBuf);
      assert.strictEqual(
        buildTrimmedLmsZipForOversizedArchive(slipYyzPath, "SLIP_STU"),
        null,
        "Gói .yyz chứa đường dẫn Zip-Slip (..) bắt buộc bị từ chối!"
      );

      // Google Drive bundle MUST preserve the full original 16 MB `HiepSiNganHa.yyz`!
      const driveBundle = prepareStudentZipBundleAndStandaloneMediaForDrive(
        stuGameDir,
        "GA_STU_01",
        "Hoàng Minh Quân",
        { sessionNumber: 12 }
      );
      try {
        const driveZipEntries = new AdmZip(driveBundle.zipFilePath).getEntries();
        const yyzInDrive = driveZipEntries.find((e) => e.entryName === "HiepSiNganHa.yyz");
        assert.ok(yyzInDrive, "Gói Google Drive phải giữ nguyên file gốc HiepSiNganHa.yyz");
        const driveYyzBuf = yyzInDrive.getData();
        assert.strictEqual(
          driveYyzBuf.equals(fs.readFileSync(newerYyzPath)),
          true,
          "Bản HiepSiNganHa.yyz trên Google Drive phải khớp từng byte với bản gốc!"
        );
        const innerAudio = new AdmZip(driveYyzBuf)
          .getEntries()
          .find((e) => e.entryName === "sounds/Snd_win/Snd_win.mp3");
        assert.strictEqual(
          innerAudio?.header.size,
          16 * 1024 * 1024,
          "File nhạc Snd_win.mp3 (16 MB) bên trong bản HiepSiNganHa.yyz trên Google Drive phải còn nguyên 100%!"
        );
      } finally {
        driveBundle.cleanup();
      }

      // 3b) SpckWebDeployer: GCM_INTERACTIVE=never + local bare Git repo deploy + <1s fast-skip + empty git status skip
      const deployerSrc = fs.readFileSync(
        path.join(ROOT, "src/lib/github/spck-web-deployer.ts"),
        "utf8"
      );
      assert.match(deployerSrc, /GCM_INTERACTIVE:\s*["']never["']/);
      assert.match(deployerSrc, /GIT_TERMINAL_PROMPT:\s*["']0["']/);

      const bareRepoDir = path.join(tempRoot, "web_product_show_bare.git");
      execFileSync("git", ["init", "--bare", "--initial-branch=main", bareRepoDir], {
        stdio: "ignore",
      });

      const webFastCls = "VT-C4K-JSA05";
      classSessionRepo.upsert({
        classId: webFastCls,
        className: webFastCls,
        sessionId: `${webFastCls}_12`,
        sessionNumber: 12,
        date: "2026-11-18",
      });
      studentRepo.upsert({
        classId: webFastCls,
        studentId: "JSA_FAST_01",
        fullName: "Đỗ Gia Hân",
        isActive: 1,
      });
      const jsaStuDir = path.join(tempSpckRoot, webFastCls, "Đỗ Gia Hân");
      fs.mkdirSync(jsaStuDir, { recursive: true });
      fs.writeFileSync(
        path.join(jsaStuDir, "index.html"),
        "<!doctype html><html><head><title> Sổ Tay Công Thức Nấu Ăn Gia Đình </title></head><body><h1>Cooking</h1></body></html>",
        "utf8"
      );
      spckUploadRepo.upsert({
        classId: webFastCls,
        studentId: "JSA_FAST_01",
        localFolderPath: jsaStuDir,
        isConfirmedByTeacher: 1,
        projectTitle: "Sổ Tay Công Thức Nấu Ăn Gia Đình",
        thumbnailPath: path.join(tempConfigDir, "default-spck-thumbnail.png"),
        status: "DRAFT",
      });

      const dep1 = await SpckWebDeployer.deployClassWebSpckToGithubPages({
        classId: webFastCls,
        repoUrl: bareRepoDir,
        sessionNumber: 12,
      });
      assert.strictEqual(dep1.deployedStudentsCount, 1);
      assert.strictEqual(dep1.failedStudentsCount, 0);

      const commitsAfterFirst = Number(
        execFileSync("git", ["rev-list", "--count", "main"], {
          cwd: bareRepoDir,
          encoding: "utf8",
        }).trim()
      );
      assert.strictEqual(commitsAfterFirst, 1);

      // Unchanged 2nd deploy -> fast-skips in < 1s!
      const tWeb0 = Date.now();
      const dep2 = await SpckWebDeployer.deployClassWebSpckToGithubPages({
        classId: webFastCls,
        repoUrl: bareRepoDir,
        sessionNumber: 12,
      });
      const elapsedWebSkipMs = Date.now() - tWeb0;
      assert.ok(
        elapsedWebSkipMs < 1000,
        `Bỏ qua nhanh Web không đổi phải < 1000ms (thực tế: ${elapsedWebSkipMs}ms)`
      );
      assert.strictEqual(dep2.skippedUnchangedCount, 1);
      assert.strictEqual(dep2.results[0]?.skippedUnchanged, true);

      // Forced redeploy with identical files -> git status --porcelain empty -> skips git commit/push!
      const dep3Force = await SpckWebDeployer.deployClassWebSpckToGithubPages({
        classId: webFastCls,
        repoUrl: bareRepoDir,
        sessionNumber: 12,
        forceRedeploy: true,
      });
      assert.strictEqual(dep3Force.failedStudentsCount, 0);
      const commitsAfterNoOpForce = Number(
        execFileSync("git", ["rev-list", "--count", "main"], {
          cwd: bareRepoDir,
          encoding: "utf8",
        }).trim()
      );
      assert.strictEqual(
        commitsAfterNoOpForce,
        1,
        "Khi git status rỗng, SpckWebDeployer phải bỏ qua git commit/push (giữ nguyên 1 commit)!"
      );

      // 3c) Google Drive fast-skip (< 1s, 0 Playwright getPage calls) when !hasFileDrift
      const jsaDigest = computeStudentFolderContentDigest(jsaStuDir).digest;
      const curRec = spckUploadRepo.findOne(webFastCls, "JSA_FAST_01")!;
      spckUploadRepo.upsert({
        ...curRec,
        relatedLinksJson: JSON.stringify([
          {
            name: "Link Google Drive SPCK (Đỗ Gia Hân)",
            url: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345",
          },
        ]),
        lastDriveUploadedDigest: jsaDigest,
        lastPreppedFolderDigest: jsaDigest,
      });

      const bm = BrowserManager.getInstance();
      const origGetPage = bm.getPage.bind(bm);
      let browserCallsDuringFastSkip = 0;
      (bm as any).getPage = async () => {
        browserCallsDuringFastSkip += 1;
        throw new Error("Fast-skip Drive không được phép gọi BrowserManager.getPage()!");
      };
      try {
        const tDrive0 = Date.now();
        const driveFastRes = await uploadDrivePost(
          localJsonRequest("http://127.0.0.1:3000/api/spck/upload-drive", {
            classId: webFastCls,
            sessionNumber: 12,
          })
        );
        const elapsedDriveSkipMs = Date.now() - tDrive0;
        const driveFastJson = await driveFastRes.json();
        assert.strictEqual(driveFastJson.success, true);
        assert.ok(
          elapsedDriveSkipMs < 1000,
          `Bỏ qua nhanh Google Drive bài không đổi phải < 1000ms (thực tế: ${elapsedDriveSkipMs}ms)`
        );
        assert.strictEqual(driveFastJson.driveResult.skippedUnchangedCount, 1);
        assert.strictEqual(driveFastJson.driveResult.results[0]?.skippedUnchanged, true);
        assert.strictEqual(browserCallsDuringFastSkip, 0);
      } finally {
        (bm as any).getPage = origGetPage;
      }
    }
    console.log("  -> PASS V360-03.");

    // =========================================================================
    // [V360-04] Tự gợi ý Tên đề tài, Quick Tags CSI/CSA + Thuyết trình B14 & Cổng thu bài autoUploadDrive=false
    // =========================================================================
    console.log(
      "\n[V360-04] Kiểm thử nâng cấp Tên đề tài sáng tạo, Quick Tags CSI/CSA, Thuyết trình Buổi 14 & Cổng thu bài autoUploadDrive=false..."
    );
    {
      const csiCls = "VT-CSI02";
      for (const n of [12, 13, 14]) {
        classSessionRepo.upsert({
          classId: csiCls,
          className: csiCls,
          sessionId: `${csiCls}_${n}`,
          sessionNumber: n,
          date: "2026-11-18",
        });
      }
      studentRepo.upsert({
        classId: csiCls,
        studentId: "CSI_STU_01",
        fullName: "Nguyễn Khánh Linh",
        isActive: 1,
      });

      const csiClassDir = path.join(tempSpckRoot, csiCls);
      const csiStuDir = path.join(csiClassDir, "Nguyễn Khánh Linh");
      fs.mkdirSync(csiStuDir, { recursive: true });
      fs.writeFileSync(
        path.join(csiStuDir, "app.py"),
        [
          "import pandas as pd",
          "import streamlit as st",
          "from sklearn.ensemble import RandomForestClassifier",
          'st.set_page_config(page_title="Trợ Lý Dự Báo Chất Lượng Không Khí AI")',
          'st.title("Trợ Lý Dự Báo Chất Lượng Không Khí AI")',
          "df = pd.DataFrame({'aqi': [42, 68]})",
          "st.line_chart(df)",
        ].join("\n"),
        "utf8"
      );

      // Seed default placeholder title `"SPCK Nguyễn Khánh Linh"` to verify auto-upgrade on scan!
      spckUploadRepo.upsert({
        classId: csiCls,
        studentId: "CSI_STU_01",
        localFolderPath: csiStuDir,
        isConfirmedByTeacher: 1,
        projectTitle: "SPCK Nguyễn Khánh Linh",
        baseProjectTitle: "SPCK Nguyễn Khánh Linh",
        thumbnailPath: path.join(tempConfigDir, "default-spck-thumbnail.png"),
        status: "DRAFT",
      });

      const csiScanRes = await scanPost(
        localJsonRequest("http://127.0.0.1:3000/api/spck/scan", {
          classId: csiCls,
          folderPath: csiClassDir,
          sessionNumber: 12,
          autoSuggestQuickTags: true,
        })
      );
      const csiScanJson = await csiScanRes.json();
      assert.strictEqual(csiScanJson.success, true);

      const csiRec = spckUploadRepo.findOne(csiCls, "CSI_STU_01")!;
      assert.ok(
        csiRec.baseProjectTitle.includes("Trợ Lý Dự Báo Chất Lượng Không Khí AI"),
        `Tên đề tài mặc định 'SPCK <Tên>' phải tự đổi sang tên đề tài thật, nhận được: '${csiRec.baseProjectTitle}'`
      );
      assert.ok(csiRec.projectTitle.length <= 100);
      const csiEnrichedRec = (csiScanJson.records || []).find(
        (r: any) => r.studentId === "CSI_STU_01"
      );
      const csiTags: string[] = JSON.parse(csiEnrichedRec?.quickTagsJson || "[]");
      assert.ok(
        csiTags.length >= 2,
        `Lớp VT-CSI02 phải được tự gợi ý sẵn Quick Tags chuyên môn khi quét (nhận được ${csiTags.length} thẻ)`
      );

      // Also verify CSA Quick Tags suggestion
      const csaTags = suggestSpckQuickTagsFromProject({
        classId: "VT-C4K-CSA12",
        sessionNumber: 13,
        fileExtensions: [".py"],
        hasStreamlitCode: true,
        hasPandasOrCsvCode: true,
        hasDataVisualizationCode: true,
        hasMlOrAiModelCode: true,
      });
      assert.ok(csaTags.length >= 2, "Lớp CSA có code Pandas/Streamlit phải có sẵn Quick Tags gợi ý");

      // Presentation tag mapping across all 3 BGK communication score bands
      const highPresTag = suggestSession14PresentationTagFromDemoScore(0.9, 1.0); // 90% >= 80%
      const midPresTag = suggestSession14PresentationTagFromDemoScore(0.6, 1.0); // 60% in [50..79%]
      const lowPresTag = suggestSession14PresentationTagFromDemoScore(0.3, 1.0); // 30% < 50%
      assert.ok(highPresTag && highPresTag !== midPresTag && midPresTag !== lowPresTag);

      // Seed BGK communication score for CSI_STU_01 (0.9 / 1.0 = 90%) and clear presentation tag ->
      // POST /api/spck/generate-ai on Session 14 MUST auto-attach presentation tag + return 2-part comment!
      session14EvalRepo.saveDraft({
        classId: csiCls,
        studentId: "CSI_STU_01",
        demoScores: {
          algorithm: 1.4,
          creativity: 0.9,
          communication: 0.9,
          problemSolving: 0.9,
          computerSkills: 0.45,
        },
      });

      GoogleGenerativeAI.prototype.getGenerativeModel = (() => ({
        generateContent: async () => ({
          response: {
            text: () =>
              JSON.stringify({
                presentationEvaluation:
                  "Thầy đánh giá cao phần bảo vệ dự án cuối khóa của STUDENT_01: con trình bày mạch lạc, tự tin giải thích mô hình dữ liệu và trả lời tốt câu hỏi phản biện.",
                attitudeSummary:
                  "Trong suốt quá trình thực hiện dự án, STUDENT_01 làm việc nghiêm túc và chủ động.",
                productAndDesignEvaluation:
                  "Ứng dụng Streamlit có bố cục trực quan, biểu đồ hiển thị rõ ràng.",
                technicalApplicationEvaluation:
                  "Con vận dụng tốt Pandas, Scikit-learn và Streamlit để xử lý dữ liệu.",
              }),
          },
        }),
      })) as any;

      const spckAiRes = await spckGenAiPost(
        localJsonRequest("http://127.0.0.1:3000/api/spck/generate-ai", {
          classId: csiCls,
          sessionNumber: 14,
          students: [
            {
              studentId: "CSI_STU_01",
              fullName: "Nguyễn Khánh Linh",
              projectTitle: csiRec.projectTitle,
              quickTags: [], // Even with empty UI tags, CSI code + BGK communication auto-suggests!
              teacherNote: "",
              includePresentation: false,
            },
          ],
        })
      );
      const spckAiJson = await spckAiRes.json();
      assert.strictEqual(spckAiJson.success, true);
      const aiItem = spckAiJson.results[0];
      assert.notStrictEqual(
        aiItem.status,
        "INSUFFICIENT_INFO",
        "Lớp VT-CSI02 có code + điểm BGK Buổi 14 không được rơi vào INSUFFICIENT_INFO!"
      );
      assert.ok(
        aiItem.formattedTeacherComment.startsWith("Nguyễn Khánh Linh — Dự án:"),
        "Bình luận SPCK Buổi 14 phải mở đầu bằng 'Họ tên — Dự án: ...'"
      );
      assert.ok(aiItem.formattedTeacherComment.includes("[THUYẾT TRÌNH & SLIDE]\n+ "));
      assert.ok(aiItem.formattedTeacherComment.includes("[ĐIỂM NỔI BẬT CỦA SẢN PHẨM]\n+ "));
      assert.ok(aiItem.formattedTeacherComment.includes("[ĐIỂM CẦN HOÀN THIỆN THÊM]\n+ "));
      assert.ok(
        aiItem.formattedTeacherComment.includes("Khánh Linh") &&
          !aiItem.formattedTeacherComment.includes("STUDENT_01"),
        "Nhận xét SPCK Buổi 14 phải khử ẩn danh chuẩn về tên gọi 'Khánh Linh' và không còn mã ẩn danh!"
      );

      // Student Portal default `autoUploadDrive = false` when omitted
      const startPortalRes = await portalPost(
        localJsonRequest("http://127.0.0.1:3000/api/spck/student-portal", {
          action: "start",
          classId: csiCls,
          folderPath: csiClassDir,
          sessionNumber: 12,
        })
      );
      const startPortalJson = await startPortalRes.json();
      try {
        assert.strictEqual(startPortalJson.success, true);
        assert.strictEqual(startPortalJson.portalStatus.isRunning, true);
        assert.strictEqual(
          startPortalJson.portalStatus.autoUploadDrive,
          false,
          "Cổng thu bài học sinh bắt buộc mặc định autoUploadDrive === false để đóng cổng cực nhanh!"
        );
      } finally {
        await studentPortalManager.stopPortal().catch(() => {});
      }
    }
    console.log("  -> PASS V360-04.");

    // =========================================================================
    // [V360-05] Giao diện 3-Chạm `/final-project` + Chuỗi LMS->Teaching + Round-38 Harness
    // =========================================================================
    console.log(
      "\n[V360-05] Kiểm thử E2E Chromium Giao diện 3-Chạm `/final-project` (B12 60%, B13 80%, B14 Combo 4 bước) & tương thích Round-38..."
    );
    {
      // 5a) Build & mount real <TopNavbar /> + <FinalProjectPage /> in Chromium
      const bundleJs = await buildUiBundleWithNavbar(tempRoot);
      const uiPage = await sharedBrowser.newPage({ viewport: { width: 1440, height: 900 } });

      try {
        await uiPage.route("http://127.0.0.1:3999/**", async (route) => {
          const u = new URL(route.request().url());
          if (u.pathname === "/final-project") {
            await route.fulfill({
              status: 200,
              contentType: "text/html; charset=utf-8",
              body: `<!doctype html><html lang="vi"><head><meta charset="utf-8" /></head><body>
                <div id="root"></div>
                <script>
                  window.__apiCalls = [];
                  window.__portalOpen = true;
                  window.__activeSession = 14;
                  const CLS = "VT-C4K-JSB99";
                  const makeStudents = () => [
                    { studentId: "S1", classId: CLS, fullName: "Nguyễn Hoàng Anh", isActive: 1, attendanceStatus: "PRESENT" },
                    { studentId: "S2", classId: CLS, fullName: "Đặng Quốc Huy", isActive: 1, attendanceStatus: "PRESENT" },
                    { studentId: "S3_MISS", classId: CLS, fullName: "Ngô Hải Đăng", isActive: 1, attendanceStatus: "PRESENT" }
                  ];
                  const makeSpckRecords = (commentReady, verifiedSession) => [
                    {
                      classId: CLS,
                      studentId: "S1",
                      localFolderPath: "D:/SPCK/VT-C4K-JSB99/Nguyen Hoang Anh",
                      matchScore: 1,
                      isConfirmedByTeacher: 1,
                      projectTitle: "Cẩm Nang Du Lịch - Buổi " + window.__activeSession,
                      baseProjectTitle: "Cẩm Nang Du Lịch",
                      thumbnailPath: "D:/SPCK/thumb.png",
                      screenshotsJson: '["D:/SPCK/shot1.png"]',
                      attachmentsJson: '["D:/SPCK/code.zip"]',
                      youtubeUrlsJson: '[]',
                      relatedLinksJson: '[{"name":"Link Web","url":"https://banhtalon.github.io/WEB_PRODUCT_SHOW/VT-C4K-JSB99/Nguyen-Hoang-Anh/"},{"name":"Link Drive","url":"https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv"}]',
                      quickTagsJson: '["✨ Bố cục rõ ràng"]',
                      teacherNote: "",
                      includePresentation: 1,
                      teacherComment: commentReady ? "1. Về phần thuyết trình:\\nTốt.\\n2. Về phần sản phẩm cuối khóa:\\nHoàn chỉnh." : "",
                      contentHash: verifiedSession ? "HASH_OK_S1" : "",
                      status: verifiedSession ? "VERIFIED" : "WAITING_APPROVAL",
                      draftVersion: 3,
                      hasHtmlFiles: true,
                      sessionResultsJson: verifiedSession ? JSON.stringify({ [String(verifiedSession)]: { sessionNumber: verifiedSession, status: "VERIFIED", verifiedAt: "2026-11-18T10:00:00Z", contentHash: "HASH_OK_S1" } }) : "{}"
                    },
                    {
                      classId: CLS,
                      studentId: "S2",
                      localFolderPath: "D:/SPCK/VT-C4K-JSB99/Dang Quoc Huy",
                      matchScore: 1,
                      isConfirmedByTeacher: 1,
                      projectTitle: "Tin Thể Thao - Buổi " + window.__activeSession,
                      baseProjectTitle: "Tin Thể Thao",
                      thumbnailPath: "D:/SPCK/thumb2.png",
                      screenshotsJson: '["D:/SPCK/shot2.png"]',
                      attachmentsJson: '["D:/SPCK/code2.zip"]',
                      youtubeUrlsJson: '[]',
                      relatedLinksJson: '[]',
                      quickTagsJson: '["✨ Bố cục rõ ràng"]',
                      teacherNote: "",
                      includePresentation: 1,
                      teacherComment: commentReady ? "1. Về phần thuyết trình:\\nỔn.\\n2. Về phần sản phẩm cuối khóa:\\nĐầy đủ." : "",
                      contentHash: verifiedSession ? "HASH_OK_S2" : "",
                      status: verifiedSession ? "VERIFIED" : "WAITING_APPROVAL",
                      draftVersion: 2,
                      hasHtmlFiles: true,
                      sessionResultsJson: verifiedSession ? JSON.stringify({ [String(verifiedSession)]: { sessionNumber: verifiedSession, status: "VERIFIED", verifiedAt: "2026-11-18T10:00:00Z", contentHash: "HASH_OK_S2" } }) : "{}"
                    }
                  ];
                  const makeS14Evals = (withAi, verified) => [
                    {
                      classId: CLS,
                      studentId: "S1",
                      fullName: "Nguyễn Hoàng Anh",
                      competencyScores: { knowledgeSelfStudy: 5, knowledgeInClass: 4, skillCommunication: 5, skillComputerUse: 4, skillProblemSolving: 4, skillCreativity: 5, skillComputational: 4, attitudeHomework: 4, attitudeInClass: 5 },
                      competencyTotalScore: 4.44,
                      demoScores: { algorithm: 1.375, creativity: 0.875, communication: 0.5, problemSolving: 0.75, computerSkills: 0.75 },
                      demoTotalScore: 4.25,
                      demoRawTotalScore: 4.25,
                      awardTier: "FIRST",
                      awardLabel: "Giải Nhất",
                      awardRank: 1,
                      learnedFromMindx: withAi ? "- Đã nắm vững HTML/CSS/JS." : "",
                      suggestionsFromMindx: withAi ? "- Rất chủ động." : "",
                      futureDirection: withAi ? "- Tiến lên JSA." : "",
                      awardRanking: "",
                      quickTags: ["✨ Bố cục rõ ràng"],
                      teacherNote: "",
                      status: verified ? "VERIFIED" : "WAITING_APPROVAL",
                      contentHash: verified ? "EVAL_HASH_1" : "",
                      draftVersion: 5
                    },
                    {
                      classId: CLS,
                      studentId: "S2",
                      fullName: "Đặng Quốc Huy",
                      competencyScores: { knowledgeSelfStudy: 4, knowledgeInClass: 4, skillCommunication: 4, skillComputerUse: 4, skillProblemSolving: 4, skillCreativity: 4, skillComputational: 4, attitudeHomework: 4, attitudeInClass: 4 },
                      competencyTotalScore: 4.0,
                      demoScores: { algorithm: 1.0, creativity: 0.75, communication: 0.375, problemSolving: 0.625, computerSkills: 0.625 },
                      demoTotalScore: 3.38,
                      demoRawTotalScore: 3.375,
                      awardTier: "COMPLETED",
                      awardLabel: "Hoàn thành dự án cuối khóa",
                      awardRank: 4,
                      learnedFromMindx: withAi ? "- Đã nắm cơ bản Web." : "",
                      suggestionsFromMindx: withAi ? "- Cần rèn thêm JS." : "",
                      futureDirection: withAi ? "- Ôn kỹ DOM trước khi lên JSA." : "",
                      awardRanking: "",
                      quickTags: ["✨ Bố cục rõ ràng"],
                      teacherNote: "",
                      status: verified ? "VERIFIED" : "WAITING_APPROVAL",
                      contentHash: verified ? "EVAL_HASH_2" : "",
                      draftVersion: 4
                    },
                    {
                      classId: CLS,
                      studentId: "S3_MISS",
                      fullName: "Ngô Hải Đăng",
                      competencyScores: { knowledgeSelfStudy: 4, knowledgeInClass: 4, skillCommunication: 4, skillComputerUse: 4, skillProblemSolving: 4, skillCreativity: 4, skillComputational: 4, attitudeHomework: 4, attitudeInClass: 4 },
                      competencyTotalScore: 4.0,
                      demoScores: { algorithm: 0, creativity: 0, communication: 0, problemSolving: 0, computerSkills: 0 },
                      demoTotalScore: 0,
                      demoRawTotalScore: 0,
                      awardTier: "UNSCORED",
                      awardLabel: "",
                      awardRank: null,
                      learnedFromMindx: "",
                      suggestionsFromMindx: "",
                      futureDirection: "",
                      awardRanking: "",
                      quickTags: [],
                      teacherNote: "",
                      status: "DRAFT",
                      contentHash: "",
                      draftVersion: 1
                    }
                  ];
                  let aiGenerated = false;
                  let lmsVerifiedSession = 0;
                  let evalVerified = false;

                  window.confirm = () => true;
                  const origFetch = window.fetch.bind(window);
                  window.fetch = async (input, init) => {
                    const urlStr = typeof input === "string" ? input : input.url;
                    const u = new URL(urlStr, "http://127.0.0.1:3999");
                    const method = (init?.method || "GET").toUpperCase();
                    let body = null;
                    if (init?.body) {
                      try { body = JSON.parse(String(init.body)); } catch {}
                    }
                    window.__apiCalls.push({ path: u.pathname, search: u.search, method, body });
                    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
                      status,
                      headers: { "Content-Type": "application/json" }
                    });

                    if (u.pathname === "/api/classes") {
                      return json({
                        success: true,
                        classes: [{ classId: CLS, className: CLS, status: "RUNNING" }]
                      });
                    }
                    if (u.pathname === "/api/spck/list") {
                      const sNum = Number(u.searchParams.get("sessionNumber") || window.__activeSession || 14);
                      window.__activeSession = sNum;
                      return json({
                        success: true,
                        selectedClassId: CLS,
                        selectedSessionNumber: sNum,
                        classes: [{ classId: CLS, className: CLS }],
                        students: makeStudents(),
                        records: makeSpckRecords(aiGenerated, lmsVerifiedSession === sNum ? sNum : 0),
                        defaultFolderPath: "D:/SPCK/VT-C4K-JSB99",
                        demoSheetMeta: {
                          coursePrefix: "JSB",
                          sheetTitle: "Bảng chấm điểm buổi Demo Web - Basic",
                          latestDemoSheetUrl: "https://docs.google.com/spreadsheets/d/1DemoSheetIdJsb99/edit",
                          spckExempt: false,
                          demoExempt: false
                        }
                      });
                    }
                    if (u.pathname === "/api/spck/student-portal") {
                      if (method === "POST" && body?.action === "stop") {
                        window.__portalOpen = false;
                      } else if (method === "POST" && body?.action === "start") {
                        window.__portalOpen = true;
                      }
                      return json({
                        success: true,
                        unchanged: false,
                        portalStatus: {
                          isRunning: window.__portalOpen,
                          classId: CLS,
                          primaryShareUrl: "http://127.0.0.1:45678/p/tok",
                          autoUploadDrive: false,
                          stateVersion: window.__portalOpen ? 1 : 2,
                          submissions: []
                        },
                        records: makeSpckRecords(aiGenerated, lmsVerifiedSession === window.__activeSession ? window.__activeSession : 0)
                      });
                    }
                    if (u.pathname === "/api/spck/scan") {
                      return json({
                        success: true,
                        classId: CLS,
                        resolvedFolderPath: "D:/SPCK/VT-C4K-JSB99",
                        sessionNumber: body?.sessionNumber || window.__activeSession,
                        scanResult: {
                          rootFolderPath: "D:/SPCK/VT-C4K-JSB99",
                          items: [
                            {
                              folderName: "Nguyen Hoang Anh",
                              folderPath: "D:/SPCK/VT-C4K-JSB99/Nguyen Hoang Anh",
                              match: {
                                suggestedStudentId: "S1",
                                matchScore: 1,
                                autoConfirmed: true,
                                requiresManualConfirmation: false,
                                warningReasons: []
                              },
                              packageData: {
                                projectTitle: "Cẩm Nang Du Lịch",
                                thumbnailPath: "D:/SPCK/thumb.png",
                                screenshots: ["D:/SPCK/shot1.png"],
                                attachments: ["D:/SPCK/code.zip"],
                                youtubeUrls: [],
                                relatedLinks: []
                              },
                              hasHtmlFiles: true,
                              folderContentChanged: true
                            },
                            {
                              folderName: "Dang Quoc Huy",
                              folderPath: "D:/SPCK/VT-C4K-JSB99/Dang Quoc Huy",
                              match: {
                                suggestedStudentId: "S2",
                                matchScore: 1,
                                autoConfirmed: true,
                                requiresManualConfirmation: false,
                                warningReasons: []
                              },
                              packageData: {
                                projectTitle: "Tin Thể Thao",
                                thumbnailPath: "D:/SPCK/thumb2.png",
                                screenshots: ["D:/SPCK/shot2.png"],
                                attachments: ["D:/SPCK/code2.zip"],
                                youtubeUrls: [],
                                relatedLinks: []
                              },
                              hasHtmlFiles: true,
                              folderContentChanged: true
                            }
                          ]
                        },
                        records: makeSpckRecords(aiGenerated, 0),
                        students: makeStudents()
                      });
                    }
                    if (u.pathname === "/api/spck/save-draft") {
                      return json({ success: true, draftVersion: 4, record: makeSpckRecords(aiGenerated, 0)[0] });
                    }
                    if (u.pathname === "/api/spck/capture-screenshots") {
                      return json({
                        success: true,
                        captureResult: { capturedStudentsCount: 2, totalRequested: 2, failedStudentsCount: 0, results: [] },
                        records: makeSpckRecords(aiGenerated, 0)
                      });
                    }
                    if (u.pathname === "/api/spck/sync-drive-thumbnails") {
                      return json({
                        success: true,
                        syncResult: {
                          classId: CLS,
                          classSubfolderFound: true,
                          totalProcessed: 2,
                          matchedFromDriveCount: 2,
                          downloadedCount: 2,
                          reusedCachedCount: 0,
                          fallbackLogoCount: 0,
                          keptManualOwnerCount: 0,
                          failedCount: 0,
                          warnings: [],
                          results: []
                        },
                        records: makeSpckRecords(aiGenerated, 0)
                      });
                    }
                    if (u.pathname === "/api/spck/deploy-web") {
                      return json({
                        success: true,
                        deployResult: { deployedStudentsCount: 2, skippedUnchangedCount: 0, skippedNoHtmlCount: 0, failedStudentsCount: 0, totalRequested: 2, results: [] },
                        records: makeSpckRecords(aiGenerated, 0)
                      });
                    }
                    if (u.pathname === "/api/spck/upload-drive") {
                      return json({
                        success: true,
                        driveResult: { uploadedStudentsCount: 2, skippedUnchangedCount: 0, failedStudentsCount: 0, totalRequested: 2, results: [] },
                        records: makeSpckRecords(aiGenerated, 0)
                      });
                    }
                    if (u.pathname === "/api/spck/session14-eval" && method === "GET") {
                      return json({
                        success: true,
                        records: makeS14Evals(aiGenerated, evalVerified),
                        rankings: [
                          { studentId: "S1", fullName: "Nguyễn Hoàng Anh", rawTotalScore3dp: 4.25, displayTotalScore2dp: 4.25, rawScoreText: "4.25", awardRank: 1, awardTier: "FIRST", isTiedAward: false, awardLabel: "Giải Nhất", awardBadge: "🥇 Giải Nhất", projectTitle: "Cẩm Nang Du Lịch" },
                          { studentId: "S2", fullName: "Đặng Quốc Huy", rawTotalScore3dp: 3.375, displayTotalScore2dp: 3.38, rawScoreText: "3.375", awardRank: 4, awardTier: "COMPLETED", isTiedAward: false, awardLabel: "Hoàn thành dự án cuối khóa", awardBadge: "👏 Hoàn thành", projectTitle: "Tin Thể Thao" }
                        ],
                        classSummary: {
                          classId: CLS,
                          title: "BUỔI 14: TỔNG KẾT CUỐI KHÓA & VINH DANH BẢO VỆ DỰ ÁN (DEMO DAY) — LỚP VT-C4K-JSB99",
                          bodyText: "🥇 Giải Nhất (4.25/5.0 điểm): Nguyễn Hoàng Anh — Đề tài \\"Cẩm Nang Du Lịch\\".",
                          summaryHtml: "<p><strong>BUỔI 14: TỔNG KẾT CUỐI KHÓA</strong></p><p><strong>🥇 Giải Nhất (4.25/5.0 điểm):</strong> Nguyễn Hoàng Anh.</p>",
                          isEditedByTeacher: 0,
                          status: evalVerified ? "VERIFIED" : "DRAFT",
                          contentHash: "SUM_HASH"
                        }
                      });
                    }
                    if (u.pathname === "/api/spck/session14-eval/import-demo-scores") {
                      return json({
                        success: true,
                        importResult: { matchedCount: 2 },
                        records: makeS14Evals(aiGenerated, evalVerified),
                        spckRecords: makeSpckRecords(aiGenerated, 0),
                        rankings: [
                          { studentId: "S1", fullName: "Nguyễn Hoàng Anh", rawTotalScore3dp: 4.25, displayTotalScore2dp: 4.25, rawScoreText: "4.25", awardRank: 1, awardTier: "FIRST", isTiedAward: false, awardLabel: "Giải Nhất", awardBadge: "🥇 Giải Nhất", projectTitle: "Cẩm Nang Du Lịch" },
                          { studentId: "S2", fullName: "Đặng Quốc Huy", rawTotalScore3dp: 3.375, displayTotalScore2dp: 3.38, rawScoreText: "3.375", awardRank: 4, awardTier: "COMPLETED", isTiedAward: false, awardLabel: "Hoàn thành dự án cuối khóa", awardBadge: "👏 Hoàn thành", projectTitle: "Tin Thể Thao" }
                        ],
                        classSummary: {
                          classId: CLS,
                          title: "BUỔI 14: TỔNG KẾT CUỐI KHÓA & VINH DANH BẢO VỆ DỰ ÁN (DEMO DAY) — LỚP VT-C4K-JSB99",
                          bodyText: "🥇 Giải Nhất (4.25/5.0 điểm): Nguyễn Hoàng Anh — Đề tài \\"Cẩm Nang Du Lịch\\".",
                          summaryHtml: "<p><strong>BUỔI 14: TỔNG KẾT CUỐI KHÓA</strong></p><p><strong>🥇 Giải Nhất (4.25/5.0 điểm):</strong> Nguyễn Hoàng Anh.</p>",
                          isEditedByTeacher: 0,
                          status: "DRAFT",
                          contentHash: "SUM_HASH"
                        }
                      });
                    }
                    if (u.pathname === "/api/spck/generate-ai") {
                      aiGenerated = true;
                      return json({
                        success: true,
                        results: [
                          { studentId: "S1", status: "WAITING_APPROVAL", formattedTeacherComment: "1. Về phần thuyết trình:\\nTốt.\\n2. Về phần sản phẩm cuối khóa:\\nHoàn chỉnh.", draftVersion: 4 },
                          { studentId: "S2", status: "WAITING_APPROVAL", formattedTeacherComment: "1. Về phần thuyết trình:\\nỔn.\\n2. Về phần sản phẩm cuối khóa:\\nĐầy đủ.", draftVersion: 3 }
                        ],
                        records: makeSpckRecords(true, 0)
                      });
                    }
                    if (u.pathname === "/api/spck/session14-eval/generate-ai") {
                      aiGenerated = true;
                      return json({
                        success: true,
                        results: [
                          { studentId: "S1", status: "SUCCESS" },
                          { studentId: "S2", status: "SUCCESS" }
                        ],
                        records: makeS14Evals(true, false),
                        classSummary: {
                          classId: CLS,
                          title: "BUỔI 14: TỔNG KẾT CUỐI KHÓA & VINH DANH BẢO VỆ DỰ ÁN (DEMO DAY) — LỚP VT-C4K-JSB99",
                          bodyText: "🥇 Giải Nhất (4.25/5.0 điểm): Nguyễn Hoàng Anh — Đề tài \\"Cẩm Nang Du Lịch\\".",
                          summaryHtml: "<p><strong>BUỔI 14: TỔNG KẾT CUỐI KHÓA</strong></p><p><strong>🥇 Giải Nhất (4.25/5.0 điểm):</strong> Nguyễn Hoàng Anh.</p>",
                          isEditedByTeacher: 0,
                          status: "DRAFT",
                          contentHash: "SUM_HASH"
                        }
                      });
                    }
                    if (u.pathname === "/api/spck/approve") {
                      return json({
                        success: true,
                        approvedStudentIds: body?.studentIds || ["S1", "S2"],
                        approvedCount: (body?.studentIds || ["S1", "S2"]).length,
                        records: makeSpckRecords(true, 0)
                      });
                    }
                    if (u.pathname === "/api/spck/upload-lms") {
                      lmsVerifiedSession = Number(body?.sessionNumber || window.__activeSession || 14);
                      return json({
                        success: true,
                        uploadResult: {
                          verifiedCount: 2,
                          failedCount: 0,
                          totalRequested: 2,
                          results: [
                            { studentId: "S1", fullName: "Nguyễn Hoàng Anh", status: "VERIFIED" },
                            { studentId: "S2", fullName: "Đặng Quốc Huy", status: "VERIFIED" }
                          ]
                        },
                        records: makeSpckRecords(true, lmsVerifiedSession)
                      });
                    }
                    if (u.pathname === "/api/spck/session14-eval" && method === "POST") {
                      if (body?.action === "approve") {
                        return json({
                          success: true,
                          approvedIds: body?.studentIds || ["S1", "S2"],
                          records: makeS14Evals(true, false)
                        });
                      }
                      return json({ success: true, record: makeS14Evals(true, false)[0], records: makeS14Evals(true, false) });
                    }
                    if (u.pathname === "/api/spck/session14-eval/upload-lms") {
                      evalVerified = true;
                      return json({
                        success: true,
                        uploadResult: {
                          verifiedCount: 2,
                          failedCount: 0,
                          skippedCount: 0,
                          classSummaryVerified: true,
                          classSummaryStatus: "VERIFIED",
                          results: [
                            { studentId: "S1", status: "VERIFIED" },
                            { studentId: "S2", status: "VERIFIED" }
                          ]
                        },
                        records: makeS14Evals(true, true)
                      });
                    }
                    if (u.pathname === "/api/teaching-projects/progress") {
                      return json({
                        success: true,
                        result: {
                          updatedStudentsCount: 2,
                          milestoneTaskCount: body?.milestoneTaskCount,
                          percentage: (body?.milestoneTaskCount || 0) * 20
                        }
                      });
                    }
                    if (u.pathname === "/api/report-card") {
                      return json({
                        success: true,
                        record: { classId: CLS, status: body?.action === "approve" ? "APPROVED" : "DRAFT", studentCount: 2 }
                      });
                    }
                    if (u.pathname === "/api/report-card/sync-teaching") {
                      return json({
                        success: true,
                        syncResult: { matchedStudentCount: 2, updatedStudentsCount: 2 }
                      });
                    }
                    return origFetch(input, init);
                  };
                </script>
                <script>${bundleJs}</script>
              </body></html>`,
            });
            return;
          }
          await route.abort();
        });

        await uiPage.goto("http://127.0.0.1:3999/final-project", {
          waitUntil: "domcontentloaded",
        });

        // Verify TopNavbar v3.x & select class VT-C4K-JSB99
        await uiPage
          .locator(".mindx-brand-text")
          .filter({ hasText: /^MindX Bot v3\.\d+\.\d+$/ })
          .waitFor({ timeout: 8000 });
        const classBtn = uiPage.locator("button", { hasText: "VT-C4K-JSB99" }).first();
        if (await classBtn.isVisible().catch(() => false)) {
          await classBtn.click();
        } else {
          const selectEl = uiPage.locator("select").first();
          if ((await selectEl.count()) > 0) {
            await selectEl.selectOption("VT-C4K-JSB99");
          }
        }

        await uiPage.waitForSelector('[data-testid="spck-main-step1-sync"]', { timeout: 8000 });
        assert.strictEqual(
          await uiPage.locator('[data-testid="spck-main-step2-ai"]').isVisible(),
          true
        );
        assert.strictEqual(
          await uiPage.locator('[data-testid="spck-main-step3-submit"]').isVisible(),
          true
        );

        // Check classroom tools drawer has autoUploadDrive checkbox unchecked by default
        await uiPage.locator('[data-testid="spck-classroom-tools-toggle"]').click();
        const autoDriveCb = uiPage.locator('[data-testid="spck-portal-auto-drive-checkbox"]');
        if ((await autoDriveCb.count()) > 0) {
          assert.strictEqual(
            await autoDriveCb.isChecked(),
            false,
            "Checkbox tự đẩy Google Drive trong Cổng thu bài phải bỏ tích mặc định (false)!"
          );
        }

        // --- Touch 1 on Buổi 14: `1. Đồng bộ bài làm` MUST stop running portal FIRST, then sync all & import demo scores ---
        await uiPage.evaluate(() => {
          (window as any).__apiCalls = [];
        });
        await uiPage.locator('[data-testid="spck-main-step1-sync"]').click();
        await uiPage.waitForFunction(
          () =>
            (window as any).__apiCalls.some(
              (c: any) => c.path === "/api/spck/session14-eval/import-demo-scores"
            ),
          null,
          { timeout: 10000 }
        );
        const step1Calls: any[] = await uiPage.evaluate(() => (window as any).__apiCalls);
        const stopPortalIdx = step1Calls.findIndex(
          (c) => c.path === "/api/spck/student-portal" && c.body?.action === "stop"
        );
        const scanIdx = step1Calls.findIndex((c) => c.path === "/api/spck/scan");
        const demoIdx = step1Calls.findIndex(
          (c) => c.path === "/api/spck/session14-eval/import-demo-scores"
        );
        assert.ok(
          stopPortalIdx >= 0 && stopPortalIdx < scanIdx,
          "Bấm '1. Đồng bộ bài làm' khi Cổng thu bài đang mở bắt buộc phải tự đóng cổng trước khi quét!"
        );
        assert.ok(demoIdx > scanIdx, "Buổi 14 phải tự động gọi import-demo-scores cuối Bước 1");

        // --- Touch 2 on Buổi 14: `2. AI Soạn nhận xét` calls both AI endpoints & reveals Summary box + top-3-only award badge ---
        await uiPage.evaluate(() => {
          (window as any).__apiCalls = [];
        });
        await uiPage.locator('[data-testid="spck-main-step2-ai"]').click();
        await uiPage.waitForSelector('[data-testid="s14-class-summary-box"]', { timeout: 8000 });
        const summaryTextareaVal = await uiPage
          .locator('[data-testid="s14-class-summary-textarea"]')
          .inputValue();
        assert.match(summaryTextareaVal, /Giải Nhất.*Nguyễn Hoàng Anh/);

        // [F1] Award badge check in rendered DOM: ONLY 1 badge (for S1 Giải Nhất), NOT on S2 COMPLETED!
        const awardBadgeTexts = await uiPage
          .locator('[data-testid="s14-row-award-badge"]')
          .allInnerTexts();
        assert.strictEqual(
          awardBadgeTexts.length,
          1,
          `[F1] Chỉ học viên đạt Giải Nhất/Nhì/Ba mới có huy hiệu giải thưởng trên dòng, thực tế thấy: ${JSON.stringify(awardBadgeTexts)}`
        );
        assert.match(awardBadgeTexts[0], /Giải Nhất/);
        assert.ok((await uiPage.locator('[data-testid="s14-row-bgk-badge"]').count()) >= 2);
        assert.ok((await uiPage.locator('[data-testid="s14-row-dnl-badge"]').count()) >= 2);

        // --- Touch 3 on Buổi 14: `3. Duyệt & Nộp tất cả` runs all 4 phases sequentially without blocking on S3_MISS ---
        await uiPage.evaluate(() => {
          (window as any).__apiCalls = [];
        });
        await uiPage.locator('[data-testid="spck-main-step3-submit"]').click();
        await uiPage.waitForFunction(
          () =>
            (window as any).__apiCalls.some(
              (c: any) => c.path === "/api/report-card/sync-teaching"
            ),
          null,
          { timeout: 12000 }
        );
        const step3B14Calls: any[] = await uiPage.evaluate(() => (window as any).__apiCalls);
        const idxSpckLms = step3B14Calls.findIndex((c) => c.path === "/api/spck/upload-lms");
        const idxEvalLms = step3B14Calls.findIndex(
          (c) => c.path === "/api/spck/session14-eval/upload-lms"
        );
        const idxTp100 = step3B14Calls.findIndex(
          (c) =>
            c.path === "/api/teaching-projects/progress" && c.body?.milestoneTaskCount === 5
        );
        const idxRcSync = step3B14Calls.findIndex(
          (c) => c.path === "/api/report-card/sync-teaching"
        );
        assert.ok(
          idxSpckLms >= 0 &&
            idxEvalLms > idxSpckLms &&
            idxTp100 > idxEvalLms &&
            idxRcSync > idxTp100,
          `Chuỗi Bước 3 Buổi 14 phải chạy đúng thứ tự (1) SPCK -> (2) Eval+Summary -> (3) Teaching 100% -> (4) ReportCard, thấy: ${JSON.stringify(
            step3B14Calls.map((c) => c.path)
          )}`
        );
        assert.strictEqual(
          step3B14Calls[idxEvalLms].body?.uploadClassSummary,
          true,
          "Bước 3 Buổi 14 phải gửi kèm uploadClassSummary: true!"
        );
        // [F3] Verify zero redundant save_draft calls during Step 3 when teacher made no local edits!
        const redundantSaveDrafts = step3B14Calls.filter(
          (c) => c.path === "/api/spck/session14-eval" && c.body?.action === "save_draft"
        );
        assert.strictEqual(
          redundantSaveDrafts.length,
          0,
          "[F3] Khi không sửa tay sau AI, Bước 3 không được gọi lại save_draft thừa cho từng học viên!"
        );

        // --- Switch to Buổi 12 (`60%`, milestoneTaskCount=3) & Buổi 13 (`80%`, milestoneTaskCount=4) ---
        for (const [sessNum, expectedMilestone] of [
          [12, 3],
          [13, 4],
        ] as const) {
          await uiPage
            .locator("button", { hasText: new RegExp(`Buổi\\s*${sessNum}\\b`) })
            .first()
            .click();
          await uiPage.waitForTimeout(150);
          await uiPage.evaluate(() => {
            (window as any).__apiCalls = [];
          });
          await uiPage.locator('[data-testid="spck-submitbar-step3-submit"]').click();
          await uiPage.waitForFunction(
            (ms) =>
              (window as any).__apiCalls.some(
                (c: any) =>
                  c.path === "/api/teaching-projects/progress" &&
                  c.body?.milestoneTaskCount === ms
              ),
            expectedMilestone,
            { timeout: 10000 }
          );
          // Unready student S3_MISS is flagged with missing alert without blocking S1 & S2
          assert.ok(
            (await uiPage
              .locator(
                '[data-testid="spck-missing-roster-alert"], [data-testid="spck-row-missing-alert"]'
              )
              .count()) >= 1,
            `Buổi ${sessNum}: Học viên thiếu thư mục bài làm phải hiện cảnh báo đỏ nhưng không chặn cả lớp!`
          );
        }
      } finally {
        await uiPage.close();
      }

      // 5b) Round-38 Adversarial Compatibility (`R38-L-client`, `R38-U-reload`, `R38-U-class-race`, `R38-U-note-race`)
      const clientFilesToCheck = [
        "src/app/final-project/page.tsx",
        "src/components/final-project/useSpckWorkflow.ts",
        "src/components/final-project/Step1Header.tsx",
        "src/components/final-project/ToolsDrawer.tsx",
        "src/components/final-project/StudentRow.tsx",
        "src/components/final-project/StudentTable.tsx",
        "src/components/final-project/SubmitBar.tsx",
        "src/lib/spck/spck-ui-helpers.ts",
      ];
      for (const relFile of clientFilesToCheck) {
        const content = fs.readFileSync(path.join(ROOT, relFile), "utf8");
        assert.strictEqual(
          /TEACHING_PASSWORD|LMS_PASSWORD|GEMINI_API_KEY|from\s+["'][^"']*(?:lib\/db|lib\/config|lib\/playwright)/.test(
            content
          ),
          false,
          `[R38-L-client] Tệp Client '${relFile}' tuyệt đối không được tham chiếu biến môi trường nhạy cảm hoặc module server!`
        );
      }

      const r38Cid = "V360_R38_SYNTHETIC";
      const r38StuDir = path.join(tempSpckRoot, r38Cid, "Dang Minh An");
      fs.mkdirSync(r38StuDir, { recursive: true });
      fs.writeFileSync(path.join(r38StuDir, "main.py"), "print('ok')\n", "utf8");
      studentRepo.upsert({
        classId: r38Cid,
        studentId: "R38_S1",
        fullName: "Đặng Minh An",
        isActive: 1,
      });
      spckUploadRepo.upsert({
        classId: r38Cid,
        studentId: "R38_S1",
        localFolderPath: r38StuDir,
        isConfirmedByTeacher: 1,
        matchScore: 1,
        projectTitle: "SPCK reviewed",
        teacherComment: "OLD PERSISTED",
        draftSeq: 900,
        status: "WAITING_APPROVAL",
      });

      const cleanImportsAndExports = (src: string) =>
        src
          .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
          .replace(/\bexport\s+default\s+/g, "")
          .replace(/\bexport\s+/g, "");

      const pageSource = fs.readFileSync(
        path.join(ROOT, "src/app/final-project/page.tsx"),
        "utf8"
      );
      const cutIdx = pageSource.indexOf('\n  return (\n    <div className="space-y-6">');
      assert.ok(cutIdx > 0, "[R38-U] Điểm cắt JSX chuẩn trong src/app/final-project/page.tsx phải còn nguyên!");

      const uiRowR38 = (extra: Record<string, unknown> = {}) => ({
        folderName: "student",
        folderPath: r38StuDir,
        assignedStudentId: "R38_S1",
        matchScore: 1,
        requiresManualConfirmation: false,
        isConfirmedByTeacher: true,
        warningReasons: [],
        projectTitle: "SPCK reviewed",
        thumbnailPath: "",
        screenshots: [],
        attachments: [],
        youtubeUrlsText: "",
        relatedLinksText: "",
        quickTags: ["Hoàn thành"],
        teacherNote: "",
        includePresentation: false,
        teacherComment: "Nhận xét giáo viên đã duyệt.",
        contentHash: "",
        status: "WAITING_APPROVAL",
        ...extra,
      });

      const buildR38VmHarness = (fetcher: any, initialRows = [uiRowR38()]) => {
        const partial =
          pageSource.slice(0, cutIdx) +
          "\nreturn {loadClassData,handleClassChange,persistRowDraft,handleGenerateAiComments,handleApproveAndUpload};\n}\nglobalThis.api=FinalProjectPage();";
        const states: any[] = [
          [],
          r38Cid,
          [{ studentId: "R38_S1", classId: r38Cid, fullName: "Đặng Minh An", isActive: 1 }],
          "",
          initialRows,
          false,
          false,
          false,
          false,
          false,
          null,
        ];
        let stateIdx = 0;
        const ctx = vm.createContext({
          console,
          fetch: fetcher,
          useState: (initial: any) => {
            const i = stateIdx++;
            if (!(i in states)) states[i] = initial;
            return [
              states[i],
              (v: any) => (states[i] = typeof v === "function" ? v(states[i]) : v),
            ];
          },
          useCallback: (f: any) => f,
          useEffect() {},
          useMemo: (f: any) => f(),
        });
        vm.runInContext(stripTypeScriptTypes(cleanImportsAndExports(partial), { mode: "strip" }), ctx);
        return { api: (ctx as any).api, states };
      };

      // R38-U-reload
      const hReload = buildR38VmHarness(async (_url: string, opt: any) => {
        const res = await saveDraftPost(
          localJsonRequest("http://127.0.0.1:3000/api/spck/save-draft", {
            classId: r38Cid,
            ...JSON.parse(opt.body),
          })
        );
        const data = await res.json();
        return Response.json(data, { status: res.status });
      });
      await hReload.api.persistRowDraft(uiRowR38(), { teacherComment: "NEW AFTER RELOAD" });
      assert.strictEqual(
        spckUploadRepo.findOne(r38Cid, "R38_S1")?.teacherComment,
        "NEW AFTER RELOAD",
        "[R38-U-reload] Lần sửa mới sau tải lại trang không được coi là nháp cũ!"
      );

      // R38-U-class-race
      let releaseApproval!: (res: Response) => void;
      let markAtApproval!: () => void;
      const atApprovalPromise = new Promise<void>((r) => (markAtApproval = r));
      const hClassRace = buildR38VmHarness(async (url: string) => {
        if (url.includes("save-draft")) {
          return Response.json({ success: true, record: { status: "WAITING_APPROVAL" } });
        }
        if (url.includes("/approve")) {
          markAtApproval();
          return new Promise<Response>((r) => (releaseApproval = r));
        }
        if (url.includes("/list")) {
          return Response.json({
            success: true,
            selectedClassId: "R38_B",
            classes: [],
            students: [],
            records: [
              {
                classId: "R38_B",
                studentId: "R38_S1",
                localFolderPath: r38StuDir,
                isConfirmedByTeacher: 1,
                matchScore: 1,
                projectTitle: "SPCK B",
                teacherComment: "CLASS B STILL WAITING",
                status: "WAITING_APPROVAL",
                contentHash: "",
              },
            ],
          });
        }
        return Response.json({ success: true });
      });
      const pendingApprove = hClassRace.api.handleApproveAndUpload(["R38_S1"], true);
      await atApprovalPromise;
      await hClassRace.api.handleClassChange("R38_B");
      releaseApproval(
        Response.json({
          success: true,
          approvedStudentIds: ["R38_S1"],
          approvedCount: 1,
          records: [
            {
              classId: r38Cid,
              studentId: "R38_S1",
              status: "APPROVED",
              contentHash: "HASH_OF_CLASS_A",
            },
          ],
        })
      );
      await pendingApprove;
      assert.strictEqual(hClassRace.states[4][0].status, "WAITING_APPROVAL");
      assert.strictEqual(hClassRace.states[4][0].contentHash, "");

      // R38-U-note-race
      let releaseAi!: (res: Response) => void;
      const hNoteRace = buildR38VmHarness(() => new Promise<Response>((r) => (releaseAi = r)));
      const pendingAi = hNoteRace.api.handleGenerateAiComments();
      hNoteRace.states[4] = [uiRowR38({ teacherNote: "Ghi chú MỚI khi AI đang chạy" })];
      releaseAi(
        Response.json({
          success: true,
          results: [
            {
              studentId: "R38_S1",
              status: "WAITING_APPROVAL",
              formattedTeacherComment: "OLD AI BASED ON OLD NOTE",
            },
          ],
        })
      );
      await pendingAi;
      assert.notStrictEqual(
        hNoteRace.states[4][0].teacherComment,
        "OLD AI BASED ON OLD NOTE",
        "[R38-U-note-race] Đổi ghi chú khi AI đang chạy không được ghi đè kết quả từ ghi chú cũ!"
      );
    }
    console.log("  -> PASS V360-05.");

    console.log(
      "\n🎉 TẤT CẢ 5 NHÓM KỊCH BẢN v3.6.0 (V360-01 -> V360-05) & HỒI QUY ROUND-38 ĐỀU PASS 100%!"
    );
  } finally {
    GoogleGenerativeAI.prototype.getGenerativeModel = origGetGenerativeModel;
    await studentPortalManager.stopPortal().catch(() => {});
    if (sharedBrowser) {
      await sharedBrowser.close().catch(() => {});
    }
    try {
      closeDb();
    } catch {}
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  }
}

runTests().catch((err) => {
  console.error("❌ LỖI BỘ KIỂM THỬ v3.6.0:", err);
  process.exit(1);
});
