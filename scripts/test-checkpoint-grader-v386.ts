import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Strictly isolate SQLite DB, config dir, and running_classes.json in os.tmpdir() BEFORE importing app modules
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mindx-cpg-v386-"));
const tempDbPath = path.join(tempRoot, "test_mindx.db");
const tempConfigDir = path.join(tempRoot, "config");
const tempRunningClassesPath = path.join(tempRoot, "running_classes.json");
fs.mkdirSync(tempConfigDir, { recursive: true });

// Copy seed config files into isolated tempConfigDir so real data/config is never mutated
const realConfigDir = path.resolve(process.cwd(), "data/config");
for (const cfgName of ["grading_rubrics.json", "lms_class_ids.json", "syllabus.json", "quick_tags.json"]) {
  const srcFile = path.join(realConfigDir, cfgName);
  if (fs.existsSync(srcFile)) {
    fs.copyFileSync(srcFile, path.join(tempConfigDir, cfgName));
  }
}
const realDatasetDir = path.join(realConfigDir, "checkpoint-datasets", "CSA_SESSION_05");
if (fs.existsSync(realDatasetDir)) {
  const dstDatasetDir = path.join(tempConfigDir, "checkpoint-datasets", "CSA_SESSION_05");
  fs.mkdirSync(dstDatasetDir, { recursive: true });
  for (const f of fs.readdirSync(realDatasetDir)) {
    fs.copyFileSync(path.join(realDatasetDir, f), path.join(dstDatasetDir, f));
  }
}
fs.writeFileSync(tempRunningClassesPath, JSON.stringify(["VT-CSA04-HB"], null, 2), "utf8");

process.env.MINDX_DB_PATH = tempDbPath;
process.env.MINDX_CONFIG_DIR = tempConfigDir;
process.env.MINDX_RUNNING_CLASSES_PATH = tempRunningClassesPath;
process.env.ALLOWED_LOCAL_DIRS = tempRoot;
process.env.MINDX_ALLOW_TEST_HOSTS = "1";

function cleanupTempSubmissionsForPrefix(prefix: string) {
  const base = path.resolve(process.cwd(), "temp_submissions");
  if (!fs.existsSync(base)) return;
  for (const entry of fs.readdirSync(base)) {
    if (entry.toUpperCase().startsWith(prefix.toUpperCase())) {
      try {
        fs.rmSync(path.join(base, entry), { recursive: true, force: true });
      } catch {}
    }
  }
}

async function main() {
  console.log("=== [v3.8.6] BẮT ĐẦU KIỂM THỬ TỰ ĐỘNG CHẤM BÀI CHECKPOINT (CP1 & CP2) ===");

  const {
    closeDb,
    studentRepo,
    scoreMatrixRepo,
    homeworkSubmissionRepo,
    computeHomeworkContentHash,
  } = await import("../src/lib/db/sqlite");
  const {
    isDedicatedCheckpointColumn,
    resolveTargetMatrixColumn,
    classifySubmissionAttachments,
    getCanonicalCheckpointSessionNumber,
  } = await import("../src/lib/checkpoint/checkpoint-column-resolver");
  const { getHomeworkColumnShortLabel } = await import(
    "../src/lib/report-card/homework-completion-helpers"
  );
  const { SubmissionDownloader, buildDeterministicSubmissionZipBuffer } = await import(
    "../src/lib/playwright/download-submissions"
  );
  const { runIsolatedPythonSubmissionVerification } = await import(
    "../src/lib/file-parsers/python-notebook-verifier"
  );
  const { normalizeCriteriaMaxPointsTo100 } = await import(
    "../src/lib/gemini/checkpoint-rubric-generator"
  );
  const { GET: rubricAiGET, POST: rubricAiPOST } = await import(
    "../src/app/api/homework-grader/rubric-ai/route"
  );
  const { GET: submissionsGET } = await import(
    "../src/app/api/homework-grader/submissions/route"
  );
  const { POST: approvePOST } = await import(
    "../src/app/api/homework-grader/approve/route"
  );
  const { POST: downloadAndGradePOST } = await import(
    "../src/app/api/homework-grader/download-and-grade/route"
  );
  const { POST: saveLmsPOST } = await import(
    "../src/app/api/homework-grader/save-lms/route"
  );
  const { HomeworkGradeWorker } = await import("../src/lib/playwright/grade-worker");
  const { BrowserManager } = await import("../src/lib/playwright/browser-manager");
  const { authService } = await import("../src/lib/playwright/auth");
  const { LmsHelpers } = await import("../src/lib/playwright/lms-helpers");
  const { chromium } = await import("playwright");

  try {
    // =========================================================================
    // [CPG-01] Column Resolver & Short Labels
    // =========================================================================
    console.log("\n[CPG-01] Kiểm thử ánh xạ cột Checkpoint (CP1/CP2) & nhãn rút gọn...");
    {
      const csaCols = [
        { colIndex: 0, columnId: "L_HW1", lessonId: "L_HW1", title: "Homework 1 - Làm quen với dữ liệu", sessionNumber: 1 },
        { colIndex: 1, columnId: "L_HW2", lessonId: "L_HW2", title: "Homework 2 - Thu thập dữ liệu", sessionNumber: 2 },
        { colIndex: 7, columnId: "L_CP1", lessonId: "L_CP1", title: "Bài kiểm tra định kỳ lần 1 - CP1", sessionNumber: 1 }, // legacy cached sessionNumber=1
        { colIndex: 8, columnId: "L_CP2", lessonId: "L_CP2", title: "Bài kiểm tra định kỳ lần 2 - CP2", sessionNumber: 2 },
      ];

      // Session 1 must resolve Homework 1, NOT CP1!
      const hw1Res = resolveTargetMatrixColumn(csaCols, "VT-CSA04-HB", 1);
      assert.equal(hw1Res.column?.columnId, "L_HW1", "Buổi 1 phải khớp Homework 1, cấm khớp nhầm CP1");

      // Session 5 must resolve CP1 even when legacy cache stored sessionNumber=1!
      const cp1Res = resolveTargetMatrixColumn(csaCols, "VT-CSA04-HB", 5);
      assert.equal(cp1Res.column?.columnId, "L_CP1", "Buổi 5 Coding phải khớp chính xác cột CP1");
      assert.equal(isDedicatedCheckpointColumn(cp1Res.column!), true);

      // Session 9 must resolve CP2
      const cp2Res = resolveTargetMatrixColumn(csaCols, "VT-CSA04-HB", 9);
      assert.equal(cp2Res.column?.columnId, "L_CP2", "Buổi 9 Coding phải khớp chính xác cột CP2");

      // Cross-lesson mismatch must fail closed
      const mismatchRes = resolveTargetMatrixColumn(csaCols, "VT-CSA04-HB", 5, "L_HW1");
      assert.equal(mismatchRes.column, null);
      assert.ok(mismatchRes.mismatchError?.includes("không khớp"));

      // Canonical session numbers for Coding vs Robotics
      assert.equal(getCanonicalCheckpointSessionNumber(1, "VT-CSA04-HB"), 5);
      assert.equal(getCanonicalCheckpointSessionNumber(2, "VT-CSA04-HB"), 9);
      assert.equal(getCanonicalCheckpointSessionNumber(1, "VT-ROB09-PA"), 4);
      assert.equal(getCanonicalCheckpointSessionNumber(2, "VT-ROB09-PA"), 8);

      // Short labels (preserve "HW 5" for "Bài tập nâng cao cuối khóa")
      assert.equal(getHomeworkColumnShortLabel("Bài kiểm tra định kỳ lần 1 - CP1", 5), "CP 1");
      assert.equal(getHomeworkColumnShortLabel("Bài kiểm tra định kỳ lần 2 - CP2", 9), "CP 2");
      assert.equal(getHomeworkColumnShortLabel("Bài tập nâng cao cuối khóa", 5), "HW 5");
      console.log("  -> PASS [CPG-01].");
    }

    // =========================================================================
    // [CPG-02] Multi-File Presigned Download, Deterministic ZIP & Dataset-Only PARSE_ERROR
    // =========================================================================
    console.log("\n[CPG-02] Kiểm thử tải đa tệp Presigned URL, gói ZIP tất định & khóa an toàn [MISSING_CODE_FILE]...");
    {
      const testClass = "TEST_CPG_DL01";
      const testSession = "TEST_CPG_DL01_SESS_05";
      const cpLessonId = "LESSON_CP1_TEST";

      // Deterministic zip hash check regardless of input order
      const zipA = buildDeterministicSubmissionZipBuffer([
        { entryName: "b.ipynb", buffer: Buffer.from('{"cells":[]}', "utf8") },
        { entryName: "a.csv", buffer: Buffer.from("Make,Price\nBMW,$22000\n", "utf8") },
      ]);
      const zipB = buildDeterministicSubmissionZipBuffer([
        { entryName: "a.csv", buffer: Buffer.from("Make,Price\nBMW,$22000\n", "utf8") },
        { entryName: "b.ipynb", buffer: Buffer.from('{"cells":[]}', "utf8") },
      ]);
      assert.equal(
        crypto.createHash("sha256").update(zipA).digest("hex"),
        crypto.createHash("sha256").update(zipB).digest("hex"),
        "Gói ZIP đa tệp phải có SHA-256 hoàn toàn tất định không phụ thuộc thứ tự tệp"
      );

      // Attachment classifier check
      const dsOnly = classifySubmissionAttachments(["lms/1795323000003-car-sales-data.csv"]);
      assert.equal(dsOnly.isDatasetOnlyMistake, true);
      const multiValid = classifySubmissionAttachments([
        "lms/1795323000001-car-sales-data.csv",
        "lms/1795323000002-MinhNhat_CP1.ipynb",
      ]);
      assert.equal(multiValid.isDatasetOnlyMistake, false);

      // Seed students & score_matrix_cache (2 submitted: 1 multi-file, 1 dataset-only; 1 absent)
      studentRepo.upsert({ classId: testClass, studentId: "STU_MULTI", fullName: "Phan Công Minh Nhật", isActive: 1 });
      studentRepo.upsert({ classId: testClass, studentId: "STU_CSV_ONLY", fullName: "Bùi Doãn Cường", isActive: 1 });
      studentRepo.upsert({ classId: testClass, studentId: "STU_ABSENT", fullName: "Trần Vĩnh Triều", isActive: 1 });

      scoreMatrixRepo.save(testClass, {
        success: true,
        classId: testClass,
        classCode: testClass,
        lmsClassId: "a50974d277215cf5af3499fc",
        scrapedAt: new Date().toISOString(),
        summary: {
          totalStudents: 3,
          totalColumns: 1,
          gradedCells: 0,
          submittedUngradedCells: 2,
          notSubmittedCells: 1,
          redoCells: 0,
          zeroScoreCells: 0,
        },
        columns: [
          {
            colIndex: 0,
            columnId: cpLessonId,
            lessonId: cpLessonId,
            title: "Bài kiểm tra định kỳ lần 1 - CP1",
            sessionNumber: 5,
            lessonType: "CHECKPOINT",
          },
        ],
        rows: [
          {
            studentId: "STU_MULTI",
            studentUid: "UID_MULTI",
            fullName: "Phan Công Minh Nhật",
            isActive: true,
            averageScore: null,
            gradedCount: 0,
            submittedUngradedCount: 1,
            notSubmittedCount: 0,
            redoCount: 0,
            cells: {
              [cpLessonId]: {
                columnId: cpLessonId,
                lessonId: cpLessonId,
                sessionNumber: 5,
                status: "SUBMITTED_UNGRADED",
                score: null,
                quizScore: 90,
                maxScore: 100,
                submissionId: "SUB_MULTI_01",
                attachments: [
                  "lms/1795323000001-car-sales-data.csv",
                  "lms/1795323000002-MinhNhat_CP1.ipynb",
                ],
                rawText: "Submitted(1/1)",
              },
            },
          },
          {
            studentId: "STU_CSV_ONLY",
            studentUid: "UID_CSV_ONLY",
            fullName: "Bùi Doãn Cường",
            isActive: true,
            averageScore: null,
            gradedCount: 0,
            submittedUngradedCount: 1,
            notSubmittedCount: 0,
            redoCount: 0,
            cells: {
              [cpLessonId]: {
                columnId: cpLessonId,
                lessonId: cpLessonId,
                sessionNumber: 5,
                status: "SUBMITTED_UNGRADED",
                score: null,
                quizScore: 50,
                maxScore: 100,
                submissionId: "SUB_CSV_ONLY_02",
                attachments: ["lms/1795323000003-car-sales-data.csv"],
                rawText: "Submitted(1/1)",
              },
            },
          },
          {
            studentId: "STU_ABSENT",
            studentUid: "UID_ABSENT",
            fullName: "Trần Vĩnh Triều",
            isActive: true,
            averageScore: null,
            gradedCount: 0,
            submittedUngradedCount: 0,
            notSubmittedCount: 1,
            redoCount: 0,
            cells: {
              [cpLessonId]: {
                columnId: cpLessonId,
                lessonId: cpLessonId,
                sessionNumber: 5,
                status: "NOT_SUBMITTED",
                score: null,
                quizScore: null,
                maxScore: 100,
                submissionId: null,
                attachments: [],
                rawText: "Not submitted",
              },
            },
          },
        ],
      });

      // Verify GET /api/homework-grader/submissions BEFORE downloading already separates absent & pre-flags dataset-only
      const preSubRes = await submissionsGET(
        new Request(
          `http://127.0.0.1:3000/api/homework-grader/submissions?classId=${testClass}&sessionId=${testSession}`,
          { headers: { host: "127.0.0.1:3000" } }
        )
      );
      assert.equal(preSubRes.status, 200);
      const preSubJson = await preSubRes.json();
      assert.equal(preSubJson.data.absentOrUnsubmittedStudents.length, 1);
      assert.equal(preSubJson.data.absentOrUnsubmittedStudents[0].fullName, "Trần Vĩnh Triều");
      const preCsvItem = preSubJson.data.submissions.find((s: any) => s.submissionId === "SUB_CSV_ONLY_02");
      assert.equal(preCsvItem.parseStatus, "PARSE_ERROR");
      assert.ok(preCsvItem.parseErrorReason.includes("[MISSING_CODE_FILE]"));

      // Stub fetch for MindX presigned API + S3 download
      const sampleIpynb = JSON.stringify({
        cells: [
          {
            cell_type: "code",
            source: ["import pandas as pd\ndf = pd.read_csv('car-sales-data.csv')\nprint(df['Make'].tolist())"],
            outputs: [],
          },
        ],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
      });
      const sampleCsv = 'Make,Colour,Odometer,Doors,Price\nBMW,Black,11179,5,"$22,000"\n';

      const origFetch = globalThis.fetch;
      globalThis.fetch = (async (input: any) => {
        const u = String(input?.url || input);
        if (u.includes("resources.mindx.edu.vn/api/v1/get-presigned-url")) {
          const key = new URL(u).searchParams.get("key") || "";
          return new Response(
            JSON.stringify({
              success: true,
              url: `https://s3-mock.mindx.local/download/${encodeURIComponent(key)}`,
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (u.startsWith("https://s3-mock.mindx.local/download/")) {
          if (u.endsWith(".ipynb")) {
            return new Response(sampleIpynb, { status: 200 });
          }
          return new Response(sampleCsv, { status: 200 });
        }
        throw new Error(`Unexpected fetch URL: ${u}`);
      }) as any;

      try {
        const dlRes = await SubmissionDownloader.downloadLessonSubmissions({
          classId: testClass,
          classCode: testClass,
          sessionId: testSession,
          sessionNumber: 5,
          forceScrapeMatrix: false,
        });
        assert.equal(dlRes.success, true);
        assert.equal(dlRes.downloadedCount, 2);
        assert.equal(dlRes.parsedCount, 1, "Chỉ Minh Nhật (có .ipynb) được PARSED");
        assert.equal(dlRes.parseErrorCount, 1, "Bùi Doãn Cường (chỉ nộp .csv) phải bị gắn cờ PARSE_ERROR");

        const dbMulti = homeworkSubmissionRepo.findBySubmissionId("SUB_MULTI_01")!;
        assert.equal(dbMulti.parseStatus, "PARSED");
        assert.ok(dbMulti.localFilePath, "dbMulti.localFilePath phải tồn tại");
        assert.ok(dbMulti.localFilePath.endsWith(".zip"), "Bài nộp đa tệp phải đóng gói thành .zip tất định");
        assert.equal(fs.existsSync(dbMulti.localFilePath), true);

        // [F08] Verify Sandbox Python executes multi-file bundle with non-hex submissionId ("SUB_MULTI_01")
        const multiPyRes = await runIsolatedPythonSubmissionVerification({
          localFilePath: dbMulti.localFilePath,
          submissionId: "SUB_MULTI_01",
          rubricId: "CSA_SESSION_05",
        });
        assert.equal(multiPyRes.executed, true, "F08: Phải chạy được Python Sandbox trên gói _bundle.zip có submissionId chứa dấu '_'");
        assert.ok(multiPyRes.summaryText.includes("BMW"));

        const dbCsvOnly = homeworkSubmissionRepo.findBySubmissionId("SUB_CSV_ONLY_02")!;
        assert.equal(dbCsvOnly.parseStatus, "PARSE_ERROR");
        assert.equal(dbCsvOnly.decision, "GRADE");
        assert.ok(dbCsvOnly.parseErrorReason?.includes("[MISSING_CODE_FILE]"));

        // Verify /approve rejects dataset-only PARSE_ERROR (Iron Rule 5)
        const rejectApprove = await approvePOST(
          new Request("http://127.0.0.1:3000/api/homework-grader/approve", {
            method: "POST",
            headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
            body: JSON.stringify({
              classId: testClass,
              sessionId: testSession,
              studentId: "STU_CSV_ONLY",
              submissionId: "SUB_CSV_ONLY_02",
              fileHash: dbCsvOnly.fileHash,
              feedbackHtml: "<p>Test</p>",
              decision: "GRADE",
              teacherOverrideScore: 0,
              criteriaGrades: [],
            }),
          })
        );
        assert.equal(rejectApprove.status, 400, "Cấm tuyệt đối duyệt chấm 0đ cho bài PARSE_ERROR");
      } finally {
        globalThis.fetch = origFetch;
      }

      // Verify Robotics classes are cleanly blocked on download-and-grade & save-lms
      const robDlRes = await downloadAndGradePOST(
        new Request("http://127.0.0.1:3000/api/homework-grader/download-and-grade", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({
            classId: "VT-ROB09-PA",
            classCode: "VT-ROB09-PA",
            sessionId: "VT-ROB09-PA_SESS_04",
          }),
        })
      );
      assert.equal(robDlRes.status, 400, "Lớp Robotics phải bị chặn sạch ở download-and-grade");

      const robSaveRes = await saveLmsPOST(
        new Request("http://127.0.0.1:3000/api/homework-grader/save-lms", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({
            classId: "VT-ROB09-PA",
            classCode: "VT-ROB09-PA",
            sessionId: "VT-ROB09-PA_SESS_04",
          }),
        })
      );
      assert.equal(robSaveRes.status, 400, "Lớp Robotics phải bị chặn sạch ở save-lms");
      console.log("  -> PASS [CPG-02].");
    }

    // =========================================================================
    // [CPG-03] Isolated Python 3.12 Sandbox Verifier (Audit Hook + Stale Output)
    // =========================================================================
    console.log("\n[CPG-03] Kiểm thử Sandbox Python 3.12 cô lập (sys.addaudithook + phát hiện output .ipynb cũ)...");
    {
      const pyTestDir = path.join(tempRoot, "py-verify-tests");
      fs.mkdirSync(pyTestDir, { recursive: true });

      // 3a. Clean CSA_SESSION_05 notebook solving Q1, Q2, Q3 against staged car-sales-data.csv
      const goodNbPath = path.join(pyTestDir, "good_cp1.ipynb");
      fs.writeFileSync(
        goodNbPath,
        JSON.stringify({
          cells: [
            {
              cell_type: "code",
              source: [
                "import pandas as pd\n",
                "df = pd.read_csv('car-sales-data.csv').dropna(subset=['Make', 'Price'])\n",
                "df['Price'] = df['Price'].replace('[\\$,]', '', regex=True).astype(float)\n",
                "print('Q1_MAX:', df.loc[df['Price'].idxmax(), 'Make'], df['Price'].max())\n",
                "valid_km = df.dropna(subset=['Odometer']).copy()\n",
                "valid_km['ppk'] = valid_km['Price'] / valid_km['Odometer']\n",
                "print('Q2_CHEAPEST:', valid_km.loc[valid_km['ppk'].idxmin(), 'Make'])\n",
                "avg_by_make = df.groupby('Make')['Price'].mean()\n",
                "print('Q3_TOP_AVG:', avg_by_make.idxmax())\n",
              ],
              outputs: [],
            },
          ],
          metadata: {},
          nbformat: 4,
          nbformat_minor: 5,
        }),
        "utf8"
      );

      const goodPyRes = await runIsolatedPythonSubmissionVerification({
        localFilePath: goodNbPath,
        rubricId: "CSA_SESSION_05",
      });
      assert.equal(goodPyRes.executed, true, "Sandbox Python 3.12 phải chạy thành công notebook chuẩn");
      assert.ok(goodPyRes.summaryText.includes("Q1_MAX: BMW 22000.0"));
      assert.ok(goodPyRes.summaryText.includes("Q2_CHEAPEST: Nissan"));
      assert.ok(goodPyRes.summaryText.includes("Q3_TOP_AVG: BMW"));

      // 3b. Stale .ipynb output (saved output says BMW $22,000, but actual code sorts raw string -> $9,700!)
      const staleNbPath = path.join(pyTestDir, "stale_khoa_cp1.ipynb");
      fs.writeFileSync(
        staleNbPath,
        JSON.stringify({
          cells: [
            {
              cell_type: "code",
              source: [
                "import pandas as pd\n",
                "df = pd.read_csv('car-sales-data.csv').dropna(subset=['Price'])\n",
                "print(df['Price'].max())\n",
              ],
              outputs: [
                {
                  output_type: "stream",
                  name: "stdout",
                  text: ["BMW $22,000\n"],
                },
              ],
            },
          ],
          metadata: {},
          nbformat: 4,
          nbformat_minor: 5,
        }),
        "utf8"
      );

      const stalePyRes = await runIsolatedPythonSubmissionVerification({
        localFilePath: staleNbPath,
        rubricId: "CSA_SESSION_05",
      });
      assert.equal(stalePyRes.executed, true);
      assert.equal(
        stalePyRes.cells.filter((c) => c.hasStaleMismatch).length,
        1,
        "Phải phát hiện đúng 1 cell có output lưu cũ lệch với code thật"
      );
      assert.ok(stalePyRes.summaryText.includes("$9,700"));
      assert.ok(stalePyRes.summaryText.includes("LỆCH VỚI OUTPUT LƯU CŨ"));

      // 3c. Security Audit Hook: block network, subprocess, outside-sandbox file read, secret env leak, and input() hang
      process.env.GEMINI_API_KEY = "FAKE_SECRET_FOR_AUDIT_TEST_DO_NOT_LEAK";
      const hostilePyPath = path.join(pyTestDir, "hostile.py");
      const outsideTarget = path.resolve(process.cwd(), "AGENTS.md").replace(/\\/g, "\\\\");
      fs.writeFileSync(
        hostilePyPath,
        [
          "import os",
          "secret_keys = [k for k in os.environ.keys() if 'GEMINI' in k.upper() or 'PASS' in k.upper() or 'TOKEN' in k.upper()]",
          "print('SECRET_ENV_COUNT=', len(secret_keys))",
          "ans = input('Prompt that must not hang: ')",
          "print('INPUT_RETURNED=', repr(ans))",
          "try:",
          "    import socket",
          "    socket.create_connection(('8.8.8.8', 53), timeout=1)",
          "    print('NET_ALLOWED')",
          "except Exception as e:",
          "    print('NET_BLOCKED:', type(e).__name__)",
          "try:",
          "    import subprocess",
          "    subprocess.Popen(['cmd', '/c', 'echo pwn'])",
          "    print('PROC_ALLOWED')",
          "except Exception as e:",
          "    print('PROC_BLOCKED:', type(e).__name__)",
          "try:",
          `    open('${outsideTarget}', 'r', encoding='utf-8').read(32)`,
          "    print('READ_OUTSIDE_ALLOWED')",
          "except Exception as e:",
          "    print('READ_OUTSIDE_BLOCKED:', type(e).__name__)",
        ].join("\n"),
        "utf8"
      );

      const hostileRes = await runIsolatedPythonSubmissionVerification({
        localFilePath: hostilePyPath,
      });
      delete process.env.GEMINI_API_KEY;
      assert.equal(hostileRes.executed, true);
      assert.ok(hostileRes.summaryText.includes("SECRET_ENV_COUNT= 0"), "Cấm lộ biến môi trường nhạy cảm vào Python Sandbox");
      assert.ok(hostileRes.summaryText.includes("NET_BLOCKED: PermissionError"), "Phải chặn kết nối mạng socket");
      assert.ok(hostileRes.summaryText.includes("PROC_BLOCKED: PermissionError"), "Phải chặn tạo tiến trình con subprocess");
      assert.ok(hostileRes.summaryText.includes("READ_OUTSIDE_BLOCKED: PermissionError"), "Phải chặn đọc tệp ngoài thư mục tạm Sandbox");
      assert.ok(!hostileRes.summaryText.includes("_ALLOWED"));
      console.log("  -> PASS [CPG-03].");
    }

    // =========================================================================
    // [CPG-04] Rubric AI Route Security, Integer Sum 100 & Checkpoint Approval Guards
    // =========================================================================
    console.log("\n[CPG-04] Kiểm thử bảo mật API Rubric-AI, chuẩn hóa số nguyên 100đ & chặn REDO/số lẻ Checkpoint...");
    {
      // Non-local origin must be blocked (403)
      const blockedRes = await rubricAiPOST(
        new Request("http://127.0.0.1:3000/api/homework-grader/rubric-ai", {
          method: "POST",
          headers: {
            host: "127.0.0.1:3000",
            origin: "https://evil.example.com",
            "content-type": "application/json",
          },
          body: JSON.stringify({ mode: "save", classCode: "VT-CSA04-HB", sessionNumber: 5 }),
        })
      );
      assert.equal(blockedRes.status, 403);

      // Integer normalization to exact 100
      const norm3 = normalizeCriteriaMaxPointsTo100([
        { criterionId: "C1", name: "A", maxPoints: 30, description: "", expectedSnippetOrConcept: "" },
        { criterionId: "C2", name: "B", maxPoints: 30, description: "", expectedSnippetOrConcept: "" },
        { criterionId: "C3", name: "C", maxPoints: 30, description: "", expectedSnippetOrConcept: "" },
      ]);
      const sum3 = norm3.reduce((s, c) => s + c.maxPoints, 0);
      assert.equal(sum3, 100);
      assert.ok(norm3.every((c) => Number.isInteger(c.maxPoints) && c.maxPoints > 0));

      // Load pre-seeded CSA_SESSION_05 rubric via GET
      const getRubricRes = await rubricAiGET(
        new Request(
          "http://127.0.0.1:3000/api/homework-grader/rubric-ai?classCode=VT-CSA04-HB&sessionNumber=5",
          { headers: { host: "127.0.0.1:3000" } }
        )
      );
      assert.equal(getRubricRes.status, 200);
      const getRubricJson = await getRubricRes.json();
      assert.equal(getRubricJson.data.rubric.rubricId, "CSA_SESSION_05");
      assert.equal(getRubricJson.data.rubric.maxTotalScore, 100);
      assert.ok(getRubricJson.data.datasetFiles.includes("car-sales-data.csv"));

      // Save manual rubric + reference dataset for JSA_SESSION_05
      const saveManualRes = await rubricAiPOST(
        new Request("http://127.0.0.1:3000/api/homework-grader/rubric-ai", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({
            mode: "save",
            classCode: "VT-JSA15-HB",
            sessionNumber: 5,
            assignmentTitle: "Checkpoint 1 JSA",
            assignmentPrompt: "Fetch API & render cards",
            criteria: [
              { criterionId: "C1", name: "Fetch JSON", maxPoints: 50, description: "d1", expectedSnippetOrConcept: "fetch" },
              { criterionId: "C2", name: "Render DOM", maxPoints: 50, description: "d2", expectedSnippetOrConcept: "innerHTML" },
            ],
            datasetFile: {
              fileName: "products.json",
              base64Data: Buffer.from('[{"id":1,"name":"Book"}]', "utf8").toString("base64"),
            },
          }),
        })
      );
      assert.equal(saveManualRes.status, 200);
      const saveManualJson = await saveManualRes.json();
      assert.equal(saveManualJson.data.rubric.rubricId, "JSA_SESSION_05");
      assert.ok(saveManualJson.data.datasetFiles.includes("products.json"));

      // Checkpoint session (_SESS_05) MUST reject decision="REDO" and decimal teacherOverrideScore on /approve
      homeworkSubmissionRepo.upsert({
        classId: "VT-JSA15-HB",
        sessionId: "VT-JSA15-HB_SESS_05",
        studentId: "STU_JSA_1",
        submissionId: "SUB_JSA_REDO_TEST",
        originalFileName: "app.js",
        localFilePath: "",
        fileHash: "hash-jsa-01",
        parseStatus: "PARSED",
        parseErrorReason: null,
        criteriaGradesJson: JSON.stringify([
          { criterionId: "C1", criterionName: "Fetch", earnedPoints: 40, maxPoints: 50, evidenceSnippet: "fetch()", deductionReason: "thiếu catch" },
          { criterionId: "C2", criterionName: "DOM", earnedPoints: 40, maxPoints: 50, evidenceSnippet: "append", deductionReason: "thiếu css" },
        ]),
        calculatedScore: 80,
        teacherOverrideScore: null,
        decision: "REDO",
        feedbackHtml: "<p>Cần sửa lại</p>",
        contentHash: "",
        status: "WAITING_APPROVAL",
        verifiedAt: null,
        errorMessage: null,
      });

      const redoApproveRes = await approvePOST(
        new Request("http://127.0.0.1:3000/api/homework-grader/approve", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({
            classId: "VT-JSA15-HB",
            sessionId: "VT-JSA15-HB_SESS_05",
            studentId: "STU_JSA_1",
            submissionId: "SUB_JSA_REDO_TEST",
            fileHash: "hash-jsa-01",
            feedbackHtml: "<p>Cần sửa lại</p>",
            decision: "REDO",
            teacherOverrideScore: null,
            criteriaGrades: [
              { criterionId: "C1", criterionName: "Fetch", earnedPoints: 40, maxPoints: 50, evidenceSnippet: "fetch()", deductionReason: "thiếu catch" },
              { criterionId: "C2", criterionName: "DOM", earnedPoints: 40, maxPoints: 50, evidenceSnippet: "append", deductionReason: "thiếu css" },
            ],
          }),
        })
      );
      assert.equal(redoApproveRes.status, 400, "Checkpoint Buổi 5 phải từ chối duyệt REDO vì LMS khóa radio REDO");
      console.log("  -> PASS [CPG-04].");
    }

    // =========================================================================
    // [CPG-05] Real MindX LMS #tabpanel-3 Headless Chromium Simulation
    // =========================================================================
    console.log("\n[CPG-05] Kiểm thử đẩy điểm số nguyên + ReactQuill + Read-after-Write trên DOM thật #tabpanel-3...");
    const browser = await chromium.launch({ headless: true });
    const bm = BrowserManager.getInstance() as any;
    const origGetPage = bm.getPage;
    const origEnsureAuth = authService.ensureAuthenticated;
    const origOpenDrawer = LmsHelpers.openClassDrawer;
    const origSwitchTab = LmsHelpers.switchDrawerTab;

    try {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      let interceptedPayloads: any[] = [];
      await page.route("https://lms.mindx.edu.vn/**", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><html><body></body></html>",
        });
      });
      await page.route("https://lms-api.mindx.edu.vn/**", async (route) => {
        const req = route.request();
        const body = req.postDataJSON?.() || {};
        interceptedPayloads.push(body);
        if (body.operationName === "MarkStudentSubmission") {
          const p = body.variables?.payload || {};
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                studentHomework: {
                  markStudentSubmission: {
                    id: p.id,
                    score: Number(p.score),
                    note: p.note,
                    status: "MARKED",
                    category: "PRACTICE_TASK1",
                    classId: "a50974d277215cf5af3499fc",
                    lessonId: "6abc8813a481fe8e33addd5a",
                    studentUid: "6682d944ae7508001ce0e92f",
                  },
                },
              },
            }),
          });
          return;
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      });

      bm.getPage = async () => page;
      authService.ensureAuthenticated = async () => true as any;
      LmsHelpers.openClassDrawer = async () => ({} as any);
      LmsHelpers.switchDrawerTab = async () => {};

      const simClass = "TEST_CPG_LMS05";
      const simSession = "TEST_CPG_LMS05_SESS_05";
      const simStuId = "649e5cac57c2e02eb157b877"; // CRM ID (different from studentUid, matching real LMS!)
      const simUid = "6682d944ae7508001ce0e92f";
      const simSubId = "69c92a556a45b2b922668101";
      const simLessonId = "6abc8813a481fe8e33addd5a";

      studentRepo.upsert({
        classId: simClass,
        studentId: simStuId,
        fullName: "Trần Hoàng Thiên",
        isActive: 1,
      });

      scoreMatrixRepo.save(simClass, {
        success: true,
        classId: simClass,
        classCode: simClass,
        lmsClassId: "a50974d277215cf5af3499fc",
        scrapedAt: new Date().toISOString(),
        summary: {
          totalStudents: 1,
          totalColumns: 2,
          gradedCells: 1,
          submittedUngradedCells: 1,
          notSubmittedCells: 0,
          redoCells: 0,
          zeroScoreCells: 0,
        },
        columns: [
          {
            colIndex: 0,
            columnId: "L_HW1",
            lessonId: "L_HW1",
            title: "Homework 1",
            sessionNumber: 1,
            lessonType: "REVIEW_AND_PRACTICE",
          },
          {
            colIndex: 1,
            columnId: simLessonId,
            lessonId: simLessonId,
            title: "Bài kiểm tra định kỳ lần 1 - CP1",
            sessionNumber: 5,
            lessonType: "CHECKPOINT",
          },
        ],
        rows: [
          {
            studentId: simStuId,
            studentUid: simUid,
            fullName: "Trần Hoàng Thiên",
            isActive: true,
            averageScore: 90,
            gradedCount: 1,
            submittedUngradedCount: 1,
            notSubmittedCount: 0,
            redoCount: 0,
            cells: {
              L_HW1: {
                columnId: "L_HW1",
                lessonId: "L_HW1",
                sessionNumber: 1,
                status: "GRADED",
                score: 90,
                quizScore: 100,
                maxScore: 100,
                submissionId: "SUB_HW1_THIEN",
                attachments: [],
                rawText: "90/100",
              },
              [simLessonId]: {
                columnId: simLessonId,
                lessonId: simLessonId,
                sessionNumber: 5,
                status: "SUBMITTED_UNGRADED",
                score: null,
                quizScore: 90,
                maxScore: 100,
                submissionId: simSubId,
                attachments: ["lms/1795323429624-CSA04_thien_Checkpoint1.ipynb"],
                rawText: "Submitted(1/1)",
              },
            },
          },
        ],
      });

      const approvedFeedback =
        "<p>Bài làm nắm được hướng phân tích dữ liệu!</p><ul><li><strong>Câu 1:</strong> Tìm đúng BMW $22,000 (kiểm tra x &lt; 10 và y &gt; 5 hoặc thẻ &lt;div&gt;).</li><li><strong>Cần cải thiện:</strong> Chạy lại tất cả cell trước khi nộp bài.</li></ul>";
      const draftRec = {
        classId: simClass,
        sessionId: simSession,
        studentId: simStuId,
        submissionId: simSubId,
        originalFileName: "CSA04_thien_Checkpoint1.ipynb",
        localFilePath: "",
        fileHash: "cp1-thien-hash",
        parseStatus: "PARSED" as const,
        parseErrorReason: null,
        criteriaGradesJson: "[]",
        calculatedScore: 68,
        teacherOverrideScore: null,
        decision: "GRADE" as const,
        feedbackHtml: approvedFeedback,
        contentHash: "",
        status: "APPROVED" as const,
        verifiedAt: null,
        errorMessage: null,
      };
      draftRec.contentHash = computeHomeworkContentHash(draftRec);
      homeworkSubmissionRepo.upsert(draftRec);

      await page.goto("https://lms.mindx.edu.vn/admin/classes");
      await page.setContent(`
        <div aria-labelledby="class-detail" class="MuiDrawer-paperAnchorRight">
          <div id="tabpanel-3">
            <div class="lms-grid-root">
              <div class="lms-student-row">
                <div class="startCell">
                  <div class="studentStartCell">
                    <div>Trần Hoàng Thiên</div>
                    <svg data-testid="ExpandMoreIcon"></svg>
                    <svg data-testid="ExpandLessIcon" class="hidden"></svg>
                  </div>
                </div>
                <div class="submissionCell" id="cell-hw1">Marked(1/1)</div>
                <div class="submissionCell" id="cell-cp1">Submitted(1/1)</div>
              </div>
            </div>
          </div>
        </div>
        <div id="mui-dialog-host"></div>
        <script>
          (() => {
            window.cpState = {
              expanded: false,
              status: 'SUBMITTED',
              score: 0,
              noteHtml: '',
            };

            function renderCp1Cell() {
              const cell = document.getElementById('cell-cp1');
              if (!window.cpState.expanded) {
                cell.textContent = window.cpState.status === 'MARKED' ? 'Marked(1/1)' : 'Submitted(1/1)';
                return;
              }
              const scoreText = window.cpState.status === 'MARKED' ? (window.cpState.score + '/100') : '--/100';
              const btnLabel = window.cpState.status === 'MARKED' ? 'Update' : 'Mark';
              cell.innerHTML =
                '<div class="expandCell"><div class="submissionItem">' +
                '<h6>Practice task (No 1)</h6>' +
                '<h5 class="score">' + scoreText + '</h5>' +
                '<div class="mui-btn-wrapper"><button type="button" id="cp-open-modal-btn">' + btnLabel + '</button></div>' +
                '</div></div>';
              document.getElementById('cp-open-modal-btn').onclick = (ev) => {
                ev.stopPropagation();
                openMarkModal();
              };
            }

            function closeMarkModal() {
              document.getElementById('mui-dialog-host').innerHTML = '';
            }

            function openMarkModal() {
              const host = document.getElementById('mui-dialog-host');
              host.innerHTML =
                '<div class="MuiDialog-root">' +
                '  <div role="dialog" aria-labelledby="alert-dialog-title" class="MuiDialog-paper">' +
                '    <div id="alert-dialog-title">${simClass}-Lesson 8-Trần Hoàng Thiên-Practice task 1</div>' +
                '    <div>Submit on time</div>' +
                '    <div>Submission</div>' +
                '    <div>1795323429624-CSA04_thien_Checkpoint1.ipynb</div>' +
                '    <div>' +
                '      <label><input type="radio" name="act" value="MARK" checked /> Mark Submission</label>' +
                '      <label><input type="radio" name="act" value="REDO" disabled /> Request redo submission</label>' +
                '    </div>' +
                '    <input type="text" placeholder="Input score" class="MuiOutlinedInput-input" id="lms-score-in" />' +
                '    <div class="ql-container"><div class="ql-editor" contenteditable="true" id="lms-quill"></div></div>' +
                '    <div>' +
                '      <button type="button" id="lms-exit-btn">Exit</button>' +
                '      <button type="button" id="lms-save-btn">Save</button>' +
                '    </div>' +
                '  </div>' +
                '</div>';

              const scoreIn = document.getElementById('lms-score-in');
              scoreIn.value = String(window.cpState.score || 0);
              const quill = document.getElementById('lms-quill');
              quill.innerHTML = window.cpState.noteHtml || '';

              document.getElementById('lms-exit-btn').onclick = closeMarkModal;
              document.getElementById('lms-save-btn').onclick = async () => {
                const rawScore = scoreIn.value;
                const numScore = Number(rawScore);
                if (!Number.isInteger(numScore) || numScore < 0 || numScore > 100) {
                  return;
                }
                const currentNoteHtml = quill.innerHTML;
                const res = await fetch('https://lms-api.mindx.edu.vn/', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    operationName: 'MarkStudentSubmission',
                    query: 'mutation MarkStudentSubmission($payload: MarkStudentSubmissionCommand!) { studentHomework { markStudentSubmission(payload: $payload) { id score status note } } }',
                    variables: {
                      payload: {
                        id: '${simSubId}',
                        score: String(rawScore),
                        note: currentNoteHtml,
                      },
                    },
                  }),
                });
                if (res.ok) {
                  window.cpState.status = 'MARKED';
                  window.cpState.score = numScore;
                  window.cpState.noteHtml = currentNoteHtml;
                  closeMarkModal();
                  renderCp1Cell();
                }
              };
            }

            document.getElementById('cell-cp1').onclick = () => {
              window.cpState.expanded = true;
              // Simulate real MUI React swapping ExpandMoreIcon -> ExpandLessIcon (removes ExpandMoreIcon from DOM!)
              const moreSvg = document.querySelector('svg[data-testid="ExpandMoreIcon"]');
              if (moreSvg) moreSvg.remove();
              const lessSvg = document.querySelector('svg[data-testid="ExpandLessIcon"]');
              if (lessSvg) lessSvg.classList.remove('hidden');
              renderCp1Cell();
            };

            document.addEventListener('keydown', (e) => {
              if (e.key === 'Escape') closeMarkModal();
            });
          })();
        </script>
      `);

      const gradeRes = await HomeworkGradeWorker.saveApprovedGrades({
        classId: simClass,
        classCode: simClass,
        sessionId: simSession,
        lessonId: simLessonId,
      });

      assert.equal(gradeRes.failedCount, 0, `Lỗi không mong đợi: ${JSON.stringify(gradeRes.results)}`);
      assert.equal(gradeRes.savedCount, 1);
      assert.equal(gradeRes.verifiedCount, 1);
      assert.equal(interceptedPayloads.length, 1);
      assert.equal(interceptedPayloads[0].variables.payload.id, simSubId);
      assert.equal(interceptedPayloads[0].variables.payload.score, "68");
      assert.ok(interceptedPayloads[0].variables.payload.note.includes("<strong>Câu 1:</strong>"));

      const postDb = homeworkSubmissionRepo.findBySubmissionId(simSubId)!;
      assert.equal(postDb.status, "VERIFIED");
      assert.ok(postDb.verifiedAt);

      await ctx.close();
      console.log("  -> PASS [CPG-05].");
    } finally {
      bm.getPage = origGetPage;
      authService.ensureAuthenticated = origEnsureAuth;
      LmsHelpers.openClassDrawer = origOpenDrawer;
      LmsHelpers.switchDrawerTab = origSwitchTab;
      await browser.close();
    }

    // =========================================================================
    // [CPG-06] Round 1 Audit Remediations (F01..F15 Security, SSRF, PII & Edge Cases)
    // =========================================================================
    console.log("\n[CPG-06] Kiểm thử hồi quy toàn bộ 15 mục kiểm toán bảo mật & logic (F01 .. F15)...");
    {
      const {
        detectStaleCellOutputMismatch,
        resolveRubricDatasetFiles,
      } = await import("../src/lib/file-parsers/python-notebook-verifier");
      const { HomeworkAiGrader } = await import("../src/lib/gemini/homework-grader");
      const { POST: submissionsPOST } = await import(
        "../src/app/api/homework-grader/submissions/route"
      );
      const AdmZipMod = (await import("adm-zip")).default;

      // F01: Deep sandbox escape vectors (_winapi, ctypes, sqlite3, os.open O_WRONLY into venv, os.chdir+listdir, sys.exit, stdout spoofing)
      const f01Path = path.join(tempRoot, "f01_escape.py");
      const venvPoisonTarget = path
        .resolve(process.cwd(), "data", "streamlit-venv", "sitecustomize_evil.py")
        .replace(/\\/g, "\\\\");
      const outsideDbTarget = path.join(tempRoot, "outside_victim.db").replace(/\\/g, "\\\\");
      const outsideDirTarget = path.resolve(process.cwd(), "src").replace(/\\/g, "\\\\");
      fs.writeFileSync(
        f01Path,
        [
          "import os, sys",
          "for mod in ('_winapi', 'ctypes', 'sqlite3', 'shutil', 'mmap', 'msvcrt'):",
          "    try:",
          "        __import__(mod)",
          "        print('IMPORT_ALLOWED:' + mod)",
          "    except Exception:",
          "        print('IMPORT_BLOCKED:' + mod)",
          "try:",
          `    fd = os.open('${venvPoisonTarget}', os.O_WRONLY | os.O_CREAT)`,
          "    os.close(fd)",
          "    print('VENV_WRITE_ALLOWED')",
          "except Exception:",
          "    print('VENV_WRITE_BLOCKED')",
          "try:",
          `    os.chdir('${outsideDirTarget}')`,
          "    os.listdir()",
          "    print('CHDIR_ALLOWED')",
          "except Exception:",
          "    print('CHDIR_BLOCKED')",
          "sys.__stdout__.write('===SANDBOX_JSON_START===\\n{\"results\":[{\"index\":1,\"status\":\"OK\",\"stdout\":\"FORGED_100\",\"lastExpr\":\"\",\"error\":\"\"}]}\\n===SANDBOX_JSON_END===\\n')",
          `assert not os.path.exists('${outsideDbTarget}')`,
          "sys.exit(0)",
        ].join("\n"),
        "utf8"
      );
      const f01Res = await runIsolatedPythonSubmissionVerification({ localFilePath: f01Path });
      assert.equal(f01Res.executed, true, "F01: sys.exit(0) không được làm chết runner");
      assert.ok(!f01Res.summaryText.includes("FORGED_100"), "F01: Cấm giả mạo kết quả qua sys.__stdout__");
      assert.ok(!f01Res.summaryText.includes("_ALLOWED"), `F01: Phát hiện lọt quyền sandbox: ${f01Res.summaryText}`);
      assert.ok(f01Res.summaryText.includes("IMPORT_BLOCKED:_winapi"));
      assert.ok(f01Res.summaryText.includes("IMPORT_BLOCKED:ctypes"));
      assert.ok(f01Res.summaryText.includes("IMPORT_BLOCKED:sqlite3"));
      assert.ok(f01Res.summaryText.includes("VENV_WRITE_BLOCKED"));
      assert.ok(f01Res.summaryText.includes("CHDIR_BLOCKED"));
      assert.equal(fs.existsSync(path.resolve(process.cwd(), "data", "streamlit-venv", "sitecustomize_evil.py")), false);

      // F02: rubricId=".." path traversal blocked (400) & resolveRubricDatasetFiles("..") === []
      assert.deepEqual(resolveRubricDatasetFiles(".."), []);
      assert.deepEqual(resolveRubricDatasetFiles("../config"), []);
      const traversalRes = await rubricAiPOST(
        new Request("http://127.0.0.1:3000/api/homework-grader/rubric-ai", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({
            mode: "save",
            classCode: "VT-CSA04-HB",
            sessionNumber: 5,
            rubricId: "..",
            criteria: [{ criterionId: "C1", name: "Test", maxPoints: 100 }],
            datasetFile: {
              fileName: "lms_class_ids.json",
              base64Data: Buffer.from("{}", "utf8").toString("base64"),
            },
          }),
        })
      );
      assert.equal(traversalRes.status, 400, "F02: rubricId='..' phải bị chặn HTTP 400");

      // F12: Manual rubric save with sum !== 100 or <= 0 points must return 400 (never silent mutation or 500)
      const badSumRes = await rubricAiPOST(
        new Request("http://127.0.0.1:3000/api/homework-grader/rubric-ai", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({
            mode: "save",
            classCode: "VT-CSA04-HB",
            sessionNumber: 9,
            criteria: [{ criterionId: "C1", name: "Câu 1", maxPoints: 60 }],
          }),
        })
      );
      assert.equal(badSumRes.status, 400, "F12: Barem thủ công tổng khác 100 phải trả HTTP 400");

      // F06: Redirect SSRF to 127.0.0.1 blocked & >25MB stream without Content-Length aborted
      const origFetchF06 = globalThis.fetch;
      globalThis.fetch = (async (input: any) => {
        const u = String(input?.url || input);
        if (u.includes("get-presigned-url")) {
          return new Response(
            JSON.stringify({ success: true, url: "https://s3-mock.mindx.local/redir-ssrf" }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (u === "https://s3-mock.mindx.local/redir-ssrf") {
          return new Response(null, {
            status: 302,
            headers: { location: "https://127.0.0.1:3000/api/secret" },
          });
        }
        throw new Error("SSRF target must never be fetched: " + u);
      }) as any;
      try {
        const ssrfBuf = await (SubmissionDownloader as any).downloadViaPresignedUrl(
          null,
          "lms/evil.py"
        );
        assert.equal(ssrfBuf, null, "F06: Redirect 302 về 127.0.0.1 phải bị chặn hoàn toàn");
      } finally {
        globalThis.fetch = origFetchF06;
      }

      // F07: PII scrubber hides underscore-delimited first name in filename + phone number
      const scrubber = HomeworkAiGrader.buildNameScrubber(
        "VT-CSA04-HB",
        "Trần Hoàng Thiên",
        "STUDENT_01",
        [{ studentId: "P2", fullName: "Phan Công Minh Nhật" }]
      );
      const scrubbedSample = scrubber(
        "=== FILE: CSA04_thien_Checkpoint1.ipynb ===\n# Liên hệ SĐT: 0912345678 - bài của MinhNhat_CP1.ipynb"
      );
      assert.ok(!scrubbedSample.toLowerCase().includes("thien"), `F07: Tên trong tên tệp chưa ẩn: ${scrubbedSample}`);
      assert.ok(!scrubbedSample.includes("0912345678"), "F07: SĐT học viên phải bị che");

      // F11: POST /api/homework-grader/submissions rejects Robotics & Checkpoint REDO / decimal override
      const robPostSub = await submissionsPOST(
        new Request("http://127.0.0.1:3000/api/homework-grader/submissions", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({
            classId: "VT-ROB09-PA",
            sessionId: "VT-ROB09-PA_SESS_04",
            studentId: "S1",
            submissionId: "SUB_R1",
          }),
        })
      );
      assert.equal(robPostSub.status, 400);

      const decPostSub = await submissionsPOST(
        new Request("http://127.0.0.1:3000/api/homework-grader/submissions", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({
            classId: "VT-CSA04-HB",
            sessionId: "VT-CSA04-HB_SESS_05",
            studentId: "S1",
            submissionId: "SUB_DEC1",
            teacherOverrideScore: 85.5,
          }),
        })
      );
      assert.equal(decPostSub.status, 400);

      // F13: Stale .ipynb output edge cases (empty live output, short substring "2" vs "22000", live ERROR vs saved OK)
      assert.equal(
        detectStaleCellOutputMismatch({
          savedOutput: "BMW $22,000",
          liveStdout: "",
          liveLastExpr: "",
          liveError: "",
          liveStatus: "OK",
        }),
        true,
        "F13: Output lưu cũ có dữ liệu nhưng code mới không in gì phải báo lệch"
      );
      assert.equal(
        detectStaleCellOutputMismatch({
          savedOutput: "2",
          liveStdout: "22000",
          liveLastExpr: "",
          liveError: "",
          liveStatus: "OK",
        }),
        true,
        "F13: Chuỗi ngắn '2' nằm trong '22000' phải báo lệch"
      );
      assert.equal(
        detectStaleCellOutputMismatch({
          savedOutput: "BMW",
          liveStdout: "",
          liveLastExpr: "",
          liveError: "NameError: BMW is not defined",
          liveStatus: "ERROR",
        }),
        true,
        "F13: Output cũ bình thường nhưng code mới báo lỗi Runtime phải báo lệch"
      );

      // F15: "Bài tập về nhà 5 - Ôn tập CP1" NOT dedicated checkpoint; "Bài kiểm tra lần 1" -> "CP 1"; zip with only .csv -> [MISSING_CODE_FILE]
      assert.equal(
        isDedicatedCheckpointColumn({
          columnId: "HW5_REV",
          title: "Bài tập về nhà 5 - Ôn tập CP1",
          lessonType: "REVIEW_AND_PRACTICE",
        }),
        false
      );
      assert.equal(getHomeworkColumnShortLabel("Bài kiểm tra lần 1", 5), "CP 1");

      const csvOnlyZip = new AdmZipMod();
      csvOnlyZip.addFile("car-sales-data.csv", Buffer.from("Make,Price\nBMW,$22000\n", "utf8"));
      const zipEntries = csvOnlyZip.getEntries().map((e) => e.entryName);
      assert.equal(classifySubmissionAttachments(zipEntries).isDatasetOnlyMistake, true);

      // R2-F01: os.mkdir / os.makedirs outside sandbox & tempfile/urllib/mmap after pandas pre-warm must be blocked
      const r2PyPath = path.join(tempRoot, "r2_f01_mkdir.py");
      const r2OutsideDir = path.join(tempRoot, "escaped_mkdir_target").replace(/\\/g, "\\\\");
      fs.writeFileSync(
        r2PyPath,
        [
          "import os, pandas as pd",
          "for m in ('tempfile', 'mmap', 'urllib', 'urllib.request'):",
          "    try:",
          "        __import__(m)",
          "        print('R2_MOD_ALLOWED:' + m)",
          "    except Exception:",
          "        print('R2_MOD_BLOCKED:' + m)",
          "try:",
          `    os.mkdir('${r2OutsideDir}')`,
          "    print('R2_MKDIR_ALLOWED')",
          "except Exception:",
          "    print('R2_MKDIR_BLOCKED')",
        ].join("\n"),
        "utf8"
      );
      const r2PyRes = await runIsolatedPythonSubmissionVerification({ localFilePath: r2PyPath });
      assert.equal(r2PyRes.executed, true);
      assert.ok(!r2PyRes.summaryText.includes("_ALLOWED"), `R2-F01 failed: ${r2PyRes.summaryText}`);
      assert.ok(r2PyRes.summaryText.includes("R2_MKDIR_BLOCKED"));
      assert.equal(fs.existsSync(path.join(tempRoot, "escaped_mkdir_target")), false);

      // R2-F03: Invalid rubric (sum != 100 or duplicate criterionId) must NOT write orphan datasetFile to disk
      const orphanRes = await rubricAiPOST(
        new Request("http://127.0.0.1:3000/api/homework-grader/rubric-ai", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({
            mode: "save",
            classCode: "VT-CSA04-HB",
            sessionNumber: 9,
            criteria: [{ criterionId: "C1", name: "Bad Sum", maxPoints: 50 }],
            datasetFile: {
              fileName: "orphan_should_not_exist.csv",
              base64Data: Buffer.from("a,b\n1,2\n", "utf8").toString("base64"),
            },
          }),
        })
      );
      assert.equal(orphanRes.status, 400);
      assert.equal(
        fs.existsSync(
          path.join(tempConfigDir, "checkpoint-datasets", "CSA_SESSION_09", "orphan_should_not_exist.csv")
        ),
        false,
        "R2-F03: Không được ghi dataset mồ côi ra đĩa khi Barem trả HTTP 400"
      );

      const dupCritRes = await rubricAiPOST(
        new Request("http://127.0.0.1:3000/api/homework-grader/rubric-ai", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
          body: JSON.stringify({
            mode: "save",
            classCode: "VT-CSA04-HB",
            sessionNumber: 9,
            criteria: [
              { criterionId: "CRIT_01", name: "Câu 1", maxPoints: 50 },
              { criterionId: "CRIT_01", name: "Câu 2", maxPoints: 50 },
            ],
          }),
        })
      );
      assert.equal(dupCritRes.status, 400, "R2-F03: Trùng criterionId phải bị từ chối HTTP 400");

      console.log("  -> PASS [CPG-06].");
    }

    console.log("\n🎉 TẤT CẢ 6 NHÓM KIỂM THỬ CHẤM BÀI CHECKPOINT v3.8.6 ([CPG-01] .. [CPG-06]) ĐỀU PASS 100%!");
  } finally {
    closeDb();
    cleanupTempSubmissionsForPrefix("TEST_CPG_");
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error("❌ Kiểm thử v3.8.6 thất bại:", err);
  process.exit(1);
});
