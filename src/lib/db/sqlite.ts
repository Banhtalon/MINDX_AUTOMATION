import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertPathAllowed } from "../security/path-allowlist";

let dbInstance: Database.Database | null = null;

/**
 * Calculates SHA-256 hash of a text string or Buffer.
 * Used for content integrity verification and drift detection.
 */
export function calculateSha256(content: string | Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Compares current content against previously saved contentHash.
 * Returns true if matching (no drift), false if content was edited after approval.
 */
export function verifyContentIntegrity(content: string, expectedHash?: string | null): boolean {
  if (!expectedHash) return false;
  return calculateSha256(content) === expectedHash;
}

/**
 * Returns the SQLite Database instance, initializing tables if needed.
 */
export function getDb(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dataDir = assertPathAllowed(path.resolve(process.cwd(), "data"));
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const customDbPath = process.env.MINDX_DB_PATH?.trim();
  const dbPath = customDbPath
    ? assertPathAllowed(path.resolve(process.cwd(), customDbPath))
    : assertPathAllowed(path.join(dataDir, "mindx_bot.db"));
  const db = new Database(dbPath);

  // Performance & safety pragmas
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  initSchema(db);

  dbInstance = db;
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore close errors
    }
    dbInstance = null;
  }
}

/**
 * Creates tables and indexes if they do not exist.
 */
function initSchema(db: Database.Database) {
  db.exec(`
    -- 1. classes_sessions
    CREATE TABLE IF NOT EXISTS classes_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      classId TEXT NOT NULL,
      className TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      sessionNumber INTEGER NOT NULL,
      topic TEXT DEFAULT '',
      date TEXT DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE(classId, sessionId)
    );
    CREATE INDEX IF NOT EXISTS idx_classes_sessions_class_session ON classes_sessions(classId, sessionId);

    -- 2. students
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId TEXT NOT NULL,
      classId TEXT NOT NULL,
      fullName TEXT NOT NULL,
      isActive INTEGER NOT NULL DEFAULT 1,
      avatarUrl TEXT DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE(classId, studentId)
    );
    CREATE INDEX IF NOT EXISTS idx_students_class ON students(classId);

    -- 3. session_feedbacks
    CREATE TABLE IF NOT EXISTS session_feedbacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      classId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      studentId TEXT NOT NULL,
      attendanceStatus TEXT NOT NULL DEFAULT 'UNKNOWN',
      quickTagsJson TEXT DEFAULT '[]',
      teacherNote TEXT DEFAULT '',
      strengths TEXT DEFAULT '',
      improvements TEXT DEFAULT '',
      actionPlan TEXT DEFAULT '',
      finalText TEXT DEFAULT '',
      contentHash TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'DRAFT',
      verifiedAt TEXT DEFAULT NULL,
      errorMessage TEXT DEFAULT NULL,
      versionMetaJson TEXT DEFAULT '{}',
      createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE(classId, sessionId, studentId)
    );
    CREATE INDEX IF NOT EXISTS idx_session_feedbacks_lookup ON session_feedbacks(classId, sessionId, studentId);

    -- 4. homework_submissions
    CREATE TABLE IF NOT EXISTS homework_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      classId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      studentId TEXT NOT NULL,
      submissionId TEXT NOT NULL UNIQUE,
      originalFileName TEXT DEFAULT '',
      localFilePath TEXT DEFAULT '',
      fileHash TEXT DEFAULT '',
      parseStatus TEXT NOT NULL DEFAULT 'PENDING',
      parseErrorReason TEXT DEFAULT NULL,
      criteriaGradesJson TEXT DEFAULT '[]',
      calculatedScore INTEGER DEFAULT 0,
      teacherOverrideScore INTEGER DEFAULT NULL,
      decision TEXT NOT NULL DEFAULT 'GRADE',
      feedbackHtml TEXT DEFAULT '',
      contentHash TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING',
      verifiedAt TEXT DEFAULT NULL,
      errorMessage TEXT DEFAULT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_homework_submissions_lookup ON homework_submissions(classId, sessionId, studentId);
    CREATE INDEX IF NOT EXISTS idx_homework_submissions_subId ON homework_submissions(submissionId);

    -- 5. spck_uploads
    CREATE TABLE IF NOT EXISTS spck_uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      classId TEXT NOT NULL,
      studentId TEXT NOT NULL,
      localFolderPath TEXT DEFAULT '',
      matchScore REAL DEFAULT 0.0,
      isConfirmedByTeacher INTEGER NOT NULL DEFAULT 0,
      projectTitle TEXT DEFAULT '',
      thumbnailPath TEXT DEFAULT '',
      screenshotsJson TEXT DEFAULT '[]',
      attachmentsJson TEXT DEFAULT '[]',
      youtubeUrlsJson TEXT DEFAULT '[]',
      relatedLinksJson TEXT DEFAULT '[]',
      teacherComment TEXT DEFAULT '',
      contentHash TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'DRAFT',
      verifiedAt TEXT DEFAULT NULL,
      errorMessage TEXT DEFAULT NULL,
      draftSeq INTEGER NOT NULL DEFAULT 0,
      sessionResultsJson TEXT DEFAULT '{}',
      baseProjectTitle TEXT DEFAULT '',
      hasLegacyUnknownSessionHistory INTEGER NOT NULL DEFAULT 0,
      legacyHistoryMetaJson TEXT DEFAULT '{}',
      historyCorrupted INTEGER NOT NULL DEFAULT 0,
      historyCorruptedReason TEXT DEFAULT NULL,
      approvedSessionNumber INTEGER DEFAULT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE(classId, studentId)
    );
    CREATE INDEX IF NOT EXISTS idx_spck_uploads_lookup ON spck_uploads(classId, studentId);

    -- 5b. spck_session_submissions (v2.7.0 per-session draft, approval & submission snapshot)
    CREATE TABLE IF NOT EXISTS spck_session_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      classId TEXT NOT NULL,
      studentId TEXT NOT NULL,
      sessionNumber INTEGER NOT NULL,
      stageNumber INTEGER NOT NULL DEFAULT 1,
      localFolderPath TEXT DEFAULT '',
      isConfirmedByTeacher INTEGER NOT NULL DEFAULT 0,
      projectTitle TEXT DEFAULT '',
      thumbnailPath TEXT DEFAULT '',
      screenshotsJson TEXT DEFAULT '[]',
      attachmentsJson TEXT DEFAULT '[]',
      youtubeUrlsJson TEXT DEFAULT '[]',
      relatedLinksJson TEXT DEFAULT '[]',
      teacherComment TEXT DEFAULT '',
      teacherNote TEXT DEFAULT '',
      quickTagsJson TEXT DEFAULT '[]',
      draftVersion INTEGER NOT NULL DEFAULT 1,
      isDraftInitialized INTEGER NOT NULL DEFAULT 1,
      draftStatus TEXT NOT NULL DEFAULT 'DRAFT',
      approvedContentHash TEXT DEFAULT '',
      approvedSnapshotJson TEXT DEFAULT '{}',
      approvedAt TEXT DEFAULT NULL,
      lastAttemptStatus TEXT DEFAULT NULL,
      lastAttemptHash TEXT DEFAULT '',
      lastAttemptAt TEXT DEFAULT NULL,
      lastErrorMessage TEXT DEFAULT NULL,
      lastVerifiedHash TEXT DEFAULT '',
      lastVerifiedAt TEXT DEFAULT NULL,
      lastVerifiedLmsWorkId TEXT DEFAULT NULL,
      lastVerifiedSnapshotJson TEXT DEFAULT '{}',
      missingLegacySnapshot INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE(classId, studentId, sessionNumber)
    );
    CREATE INDEX IF NOT EXISTS idx_spck_session_submissions_lookup
      ON spck_session_submissions(classId, studentId, sessionNumber);

    -- 5c. spck_session14_evaluations (v2.9.0 Session 14 Course Final Evaluation & Demo Score)
    CREATE TABLE IF NOT EXISTS spck_session14_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      classId TEXT NOT NULL,
      studentId TEXT NOT NULL,
      competencyJson TEXT DEFAULT '{}',
      competencyTotalScore REAL DEFAULT 0.0,
      demoScoresJson TEXT DEFAULT '{}',
      demoTotalScore REAL DEFAULT 0.0,
      demoSourcePath TEXT DEFAULT '',
      demoJudgeNote TEXT DEFAULT '',
      learnedFromMindx TEXT DEFAULT '',
      suggestionsFromMindx TEXT DEFAULT '',
      futureDirection TEXT DEFAULT '',
      awardRanking TEXT DEFAULT '',
      quickTagsJson TEXT DEFAULT '[]',
      teacherNote TEXT DEFAULT '',
      draftVersion INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      contentHash TEXT DEFAULT '',
      verifiedAt TEXT DEFAULT NULL,
      errorMessage TEXT DEFAULT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE(classId, studentId)
    );
    CREATE INDEX IF NOT EXISTS idx_spck_session14_evaluations_lookup
      ON spck_session14_evaluations(classId, studentId);

    -- 6. job_logs
    CREATE TABLE IF NOT EXISTS job_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jobId TEXT NOT NULL,
      jobType TEXT NOT NULL,
      classId TEXT DEFAULT NULL,
      sessionId TEXT DEFAULT NULL,
      studentId TEXT DEFAULT NULL,
      submissionId TEXT DEFAULT NULL,
      level TEXT NOT NULL DEFAULT 'INFO',
      message TEXT NOT NULL,
      detailsJson TEXT DEFAULT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_job_logs_job ON job_logs(jobId, timestamp);

    -- 7. score_matrix_cache
    CREATE TABLE IF NOT EXISTS score_matrix_cache (
      classId TEXT PRIMARY KEY,
      matrixJson TEXT NOT NULL DEFAULT '{}',
      updatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    -- 8. homework_submission_meta
    CREATE TABLE IF NOT EXISTS homework_submission_meta (
      submissionId TEXT PRIMARY KEY,
      gradedFileHash TEXT NOT NULL DEFAULT '',
      draftSeq INTEGER NOT NULL DEFAULT 0,
      fieldSeqJson TEXT NOT NULL DEFAULT '{}'
    );

    -- 9. teaching_final_projects (v3.2.0 Teaching Final Project & 5-Task Timeline)
    CREATE TABLE IF NOT EXISTS teaching_final_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      classId TEXT NOT NULL UNIQUE,
      teachingProjectId INTEGER DEFAULT NULL,
      projectName TEXT NOT NULL DEFAULT '',
      startDate TEXT NOT NULL DEFAULT '',
      endDate TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      tasksJson TEXT NOT NULL DEFAULT '[]',
      studentsJson TEXT NOT NULL DEFAULT '[]',
      progressJson TEXT NOT NULL DEFAULT '{}',
      draftVersion INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      contentHash TEXT NOT NULL DEFAULT '',
      verifiedAt TEXT DEFAULT NULL,
      verifiedSnapshotJson TEXT DEFAULT '{}',
      errorMessage TEXT DEFAULT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_teaching_final_projects_class ON teaching_final_projects(classId);

    -- 10. class_report_cards (v3.3.0 Teaching Report Card Snapshot & Manual Overrides)
    CREATE TABLE IF NOT EXISTS class_report_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      classId TEXT NOT NULL UNIQUE,
      classCode TEXT NOT NULL DEFAULT '',
      lmsSnapshotJson TEXT NOT NULL DEFAULT '{}',
      manualOverridesJson TEXT NOT NULL DEFAULT '{}',
      selectedBtvnSessionsJson TEXT NOT NULL DEFAULT '[]',
      draftVersion INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      contentHash TEXT NOT NULL DEFAULT '',
      teachingSyncStatus TEXT NOT NULL DEFAULT 'NOT_SYNCED',
      teachingSyncedAt TEXT DEFAULT NULL,
      teachingVerifiedSnapshotJson TEXT NOT NULL DEFAULT '{}',
      errorMessage TEXT DEFAULT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_class_report_cards_class ON class_report_cards(classId);
  `);

  try {
    const cols = db.prepare(`PRAGMA table_info(session_feedbacks)`).all() as Array<{ name: string }>;
    if (cols.length > 0 && !cols.some((c) => c.name === "versionMetaJson")) {
      db.exec(`ALTER TABLE session_feedbacks ADD COLUMN versionMetaJson TEXT DEFAULT '{}'`);
    }
  } catch {}

  try {
    const spckCols = db.prepare(`PRAGMA table_info(spck_uploads)`).all() as Array<{ name: string }>;
    if (spckCols.length > 0 && !spckCols.some((c) => c.name === "draftSeq")) {
      db.exec(`ALTER TABLE spck_uploads ADD COLUMN draftSeq INTEGER NOT NULL DEFAULT 0`);
    }
    if (spckCols.length > 0 && !spckCols.some((c) => c.name === "sessionResultsJson")) {
      db.exec(`ALTER TABLE spck_uploads ADD COLUMN sessionResultsJson TEXT DEFAULT '{}'`);
    }
    if (spckCols.length > 0 && !spckCols.some((c) => c.name === "baseProjectTitle")) {
      db.exec(`ALTER TABLE spck_uploads ADD COLUMN baseProjectTitle TEXT DEFAULT ''`);
    }
    if (spckCols.length > 0 && !spckCols.some((c) => c.name === "hasLegacyUnknownSessionHistory")) {
      db.exec(`ALTER TABLE spck_uploads ADD COLUMN hasLegacyUnknownSessionHistory INTEGER NOT NULL DEFAULT 0`);
    }
    if (spckCols.length > 0 && !spckCols.some((c) => c.name === "legacyHistoryMetaJson")) {
      db.exec(`ALTER TABLE spck_uploads ADD COLUMN legacyHistoryMetaJson TEXT DEFAULT '{}'`);
    }
    if (spckCols.length > 0 && !spckCols.some((c) => c.name === "historyCorrupted")) {
      db.exec(`ALTER TABLE spck_uploads ADD COLUMN historyCorrupted INTEGER NOT NULL DEFAULT 0`);
    }
    if (spckCols.length > 0 && !spckCols.some((c) => c.name === "historyCorruptedReason")) {
      db.exec(`ALTER TABLE spck_uploads ADD COLUMN historyCorruptedReason TEXT DEFAULT NULL`);
    }
    if (spckCols.length > 0 && !spckCols.some((c) => c.name === "approvedSessionNumber")) {
      db.exec(`ALTER TABLE spck_uploads ADD COLUMN approvedSessionNumber INTEGER DEFAULT NULL`);
    }
    migrateSpckSessionSubmissions(db);
  } catch {}

  try {
    const s14Cols = db.prepare(`PRAGMA table_info(spck_session14_evaluations)`).all() as Array<{ name: string }>;
    if (s14Cols.length > 0 && !s14Cols.some((c) => c.name === "awardRanking")) {
      db.exec(`ALTER TABLE spck_session14_evaluations ADD COLUMN awardRanking TEXT DEFAULT ''`);
    }
  } catch {}
}

// ==========================================
// REPOSITORIES / DATA ACCESS HELPERS
// ==========================================

export interface ClassSessionRecord {
  id?: number;
  classId: string;
  className: string;
  sessionId: string;
  sessionNumber: number;
  topic?: string;
  date?: string;
}

export const classSessionRepo = {
  upsert(record: ClassSessionRecord) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO classes_sessions (classId, className, sessionId, sessionNumber, topic, date, updatedAt)
      VALUES (@classId, @className, @sessionId, @sessionNumber, @topic, @date, datetime('now', 'localtime'))
      ON CONFLICT(classId, sessionId) DO UPDATE SET
        className = excluded.className,
        sessionNumber = excluded.sessionNumber,
        topic = excluded.topic,
        date = excluded.date,
        updatedAt = datetime('now', 'localtime')
    `);
    return stmt.run({
      classId: record.classId,
      className: record.className,
      sessionId: record.sessionId,
      sessionNumber: record.sessionNumber,
      topic: record.topic ?? "",
      date: record.date ?? "",
    });
  },

  findByClass(classId: string): ClassSessionRecord[] {
    const db = getDb();
    return db
      .prepare(`SELECT * FROM classes_sessions WHERE classId = ? ORDER BY sessionNumber ASC`)
      .all(classId) as ClassSessionRecord[];
  },
};

export interface StudentRecord {
  id?: number;
  studentId: string;
  classId: string;
  fullName: string;
  isActive: number;
  avatarUrl?: string;
}

export const studentRepo = {
  upsert(record: StudentRecord) {
    const db = getDb();
    const existing = db
      .prepare(`SELECT fullName FROM students WHERE classId = ? AND studentId = ?`)
      .get(record.classId, record.studentId) as { fullName: string } | undefined;

    if (existing && /^STU_/i.test(record.studentId)) {
      const norm = (s: string) =>
        s
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[đĐ]/g, "d")
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim();
      if (norm(existing.fullName) !== norm(record.fullName)) {
        throw new Error(
          `[studentRepo] Chặn gán lại mã định danh tạm thời '${record.studentId}' của học viên '${existing.fullName}' sang học viên khác ('${record.fullName}') trong lớp ${record.classId}.`
        );
      }
    }

    const stmt = db.prepare(`
      INSERT INTO students (studentId, classId, fullName, isActive, avatarUrl, updatedAt)
      VALUES (@studentId, @classId, @fullName, @isActive, @avatarUrl, datetime('now', 'localtime'))
      ON CONFLICT(classId, studentId) DO UPDATE SET
        fullName = excluded.fullName,
        isActive = excluded.isActive,
        avatarUrl = excluded.avatarUrl,
        updatedAt = datetime('now', 'localtime')
    `);
    return stmt.run({
      studentId: record.studentId,
      classId: record.classId,
      fullName: record.fullName,
      isActive: record.isActive ?? 1,
      avatarUrl: record.avatarUrl ?? "",
    });
  },

  findByClass(classId: string, onlyActive = true): StudentRecord[] {
    const db = getDb();
    const query = onlyActive
      ? `SELECT * FROM students WHERE classId = ? AND isActive = 1 ORDER BY fullName ASC`
      : `SELECT * FROM students WHERE classId = ? ORDER BY fullName ASC`;
    return db.prepare(query).all(classId) as StudentRecord[];
  },

  findOne(studentId: string, classId?: string): StudentRecord | undefined {
    const normalizedClassId = typeof classId === "string" ? classId.trim().toUpperCase() : "";
    const normalizedStudentId = typeof studentId === "string" ? studentId.trim() : "";
    if (!normalizedClassId || !normalizedStudentId) {
      return undefined;
    }
    const db = getDb();
    return db
      .prepare(`SELECT * FROM students WHERE classId = ? AND studentId = ?`)
      .get(normalizedClassId, normalizedStudentId) as StudentRecord | undefined;
  },
};

export interface FieldVersionMeta {
  ver: number;
  cid: string;
  rev: number;
}

export interface FeedbackVersionMeta {
  rowVer: number;
  fields: Record<string, FieldVersionMeta>;
}

export function parseFeedbackVersionMeta(raw?: string | null): FeedbackVersionMeta {
  if (!raw || typeof raw !== "string") {
    return { rowVer: 0, fields: {} };
  }
  try {
    const parsed = JSON.parse(raw);
    const rowVer =
      typeof parsed?.rowVer === "number" && Number.isFinite(parsed.rowVer) ? parsed.rowVer : 0;
    const fields =
      parsed?.fields && typeof parsed.fields === "object" && !Array.isArray(parsed.fields)
        ? { ...parsed.fields }
        : {};
    return { rowVer, fields };
  } catch {
    return { rowVer: 0, fields: {} };
  }
}

export interface SessionFeedbackRecord {
  id?: number;
  classId: string;
  sessionId: string;
  studentId: string;
  attendanceStatus?: "PRESENT" | "ABSENT" | "EXCUSED" | "LATE" | "UNKNOWN";
  quickTagsJson?: string;
  teacherNote?: string;
  strengths?: string;
  improvements?: string;
  actionPlan?: string;
  finalText?: string;
  contentHash?: string;
  status: "INSUFFICIENT_INFO" | "DRAFT" | "APPROVED" | "SAVING" | "VERIFIED" | "FAILED";
  verifiedAt?: string | null;
  errorMessage?: string | null;
  versionMetaJson?: string;
}

export const sessionFeedbackRepo = {
  upsert(record: SessionFeedbackRecord) {
    const db = getDb();

    // Check for content modification on previously APPROVED / VERIFIED records
    const existing = db
      .prepare(
        `SELECT status, contentHash, finalText, attendanceStatus, versionMetaJson FROM session_feedbacks WHERE classId = ? AND sessionId = ? AND studentId = ?`
      )
      .get(record.classId, record.sessionId, record.studentId) as
      | {
          status: string;
          contentHash: string;
          finalText: string;
          attendanceStatus: string;
          versionMetaJson?: string;
        }
      | undefined;

    let targetStatus = record.status || "DRAFT";
    let targetHash = record.contentHash ?? "";

    if (existing) {
      const textChanged = (record.finalText ?? "") !== existing.finalText;
      if (textChanged) {
        const newHash = calculateSha256(record.finalText ?? "");
        // If text was modified after approval, demote back to DRAFT unless explicitly re-approved with new hash
        if (targetStatus === "APPROVED" || targetStatus === "VERIFIED") {
          if (record.contentHash !== newHash) {
            targetStatus = "DRAFT";
            targetHash = newHash;
          }
        }
      }
    }

    let targetVersionMetaJson = record.versionMetaJson;
    if (targetVersionMetaJson === undefined) {
      const prevMeta = parseFeedbackVersionMeta(existing?.versionMetaJson);
      targetVersionMetaJson = JSON.stringify({
        rowVer: (prevMeta.rowVer || 0) + 1,
        fields: {},
      });
    }

    const stmt = db.prepare(`
      INSERT INTO session_feedbacks (
        classId, sessionId, studentId, attendanceStatus,
        quickTagsJson, teacherNote, strengths, improvements, actionPlan,
        finalText, contentHash, status, verifiedAt, errorMessage, versionMetaJson, updatedAt
      )
      VALUES (
        @classId, @sessionId, @studentId, @attendanceStatus,
        @quickTagsJson, @teacherNote, @strengths, @improvements, @actionPlan,
        @finalText, @contentHash, @status, @verifiedAt, @errorMessage, @versionMetaJson, datetime('now', 'localtime')
      )
      ON CONFLICT(classId, sessionId, studentId) DO UPDATE SET
        attendanceStatus = excluded.attendanceStatus,
        quickTagsJson = excluded.quickTagsJson,
        teacherNote = excluded.teacherNote,
        strengths = excluded.strengths,
        improvements = excluded.improvements,
        actionPlan = excluded.actionPlan,
        finalText = excluded.finalText,
        contentHash = excluded.contentHash,
        status = excluded.status,
        verifiedAt = excluded.verifiedAt,
        errorMessage = excluded.errorMessage,
        versionMetaJson = excluded.versionMetaJson,
        updatedAt = datetime('now', 'localtime')
    `);
    return stmt.run({
      classId: record.classId,
      sessionId: record.sessionId,
      studentId: record.studentId,
      attendanceStatus: record.attendanceStatus || existing?.attendanceStatus || "UNKNOWN",
      quickTagsJson: record.quickTagsJson ?? "[]",
      teacherNote: record.teacherNote ?? "",
      strengths: record.strengths ?? "",
      improvements: record.improvements ?? "",
      actionPlan: record.actionPlan ?? "",
      finalText: record.finalText ?? "",
      contentHash: targetHash,
      status: targetStatus,
      verifiedAt: record.verifiedAt ?? null,
      errorMessage: record.errorMessage ?? null,
      versionMetaJson: targetVersionMetaJson,
    });
  },

  approveConditional(params: {
    classId: string;
    sessionId: string;
    studentId: string;
    attendanceStatus: "PRESENT" | "LATE";
    finalText: string;
    contentHash: string;
    expectedRowVer?: number | null;
    clientInstanceId?: string;
    clientRev?: number;
  }): { approved: boolean; conflict?: boolean; reason?: string; versionMeta?: FeedbackVersionMeta } {
    const db = getDb();
    const runTx = () => {
      const existing = db
        .prepare(
          `SELECT status, contentHash, finalText, attendanceStatus, quickTagsJson, teacherNote, strengths, improvements, actionPlan, versionMetaJson
           FROM session_feedbacks
           WHERE classId = ? AND sessionId = ? AND studentId = ?`
        )
        .get(params.classId, params.sessionId, params.studentId) as
        | (SessionFeedbackRecord & { versionMetaJson?: string })
        | undefined;

      const meta = parseFeedbackVersionMeta(existing?.versionMetaJson);
      const hasExpectedRowVer =
        typeof params.expectedRowVer === "number" &&
        Number.isFinite(params.expectedRowVer) &&
        params.expectedRowVer > 0;
      const hasClientRev =
        typeof params.clientRev === "number" && Number.isFinite(params.clientRev) && params.clientRev > 0;
      const hasClientCid = Boolean(params.clientInstanceId && params.clientInstanceId.trim());

      if (existing) {
        if (hasExpectedRowVer && meta.rowVer !== params.expectedRowVer) {
          return { approved: false, conflict: true, reason: "ROW_VERSION_CONFLICT", versionMeta: meta };
        }
        if (hasClientCid || hasClientRev) {
          for (const fEntry of Object.values(meta.fields)) {
            if (!fEntry) continue;
            if (hasClientCid && fEntry.cid === params.clientInstanceId && fEntry.rev > (params.clientRev || 0)) {
              return { approved: false, conflict: true, reason: "NEWER_CLIENT_EDIT", versionMeta: meta };
            }
            if (hasClientCid && fEntry.cid && fEntry.cid !== params.clientInstanceId && fEntry.ver > 0) {
              if (!hasExpectedRowVer || meta.rowVer !== params.expectedRowVer) {
                return { approved: false, conflict: true, reason: "OTHER_CLIENT_EDIT", versionMeta: meta };
              }
            }
          }
        }
        const finalTextEditedByUiClient = Boolean(
          meta.fields?.finalText && meta.fields.finalText.cid && meta.fields.finalText.rev > 0
        );
        if (
          (hasExpectedRowVer || hasClientCid || hasClientRev || finalTextEditedByUiClient) &&
          (existing.finalText || "").trim() !== params.finalText.trim()
        ) {
          return { approved: false, conflict: true, reason: "FINAL_TEXT_DRIFT", versionMeta: meta };
        }
      }

      const nextMeta: FeedbackVersionMeta = {
        rowVer: (meta.rowVer || 0) + 1,
        fields: { ...meta.fields },
      };
      const nextVersionMetaJson = JSON.stringify(nextMeta);

      if (existing) {
        const res = db
          .prepare(`
            UPDATE session_feedbacks
            SET attendanceStatus = @attendanceStatus,
                finalText = @finalText,
                contentHash = @contentHash,
                status = 'APPROVED',
                errorMessage = NULL,
                versionMetaJson = @versionMetaJson,
                updatedAt = datetime('now', 'localtime')
            WHERE classId = @classId
              AND sessionId = @sessionId
              AND studentId = @studentId
              AND COALESCE(versionMetaJson, '') = @expectedVersionMetaJson
              AND COALESCE(finalText, '') = @expectedExistingFinalText
          `)
          .run({
            classId: params.classId,
            sessionId: params.sessionId,
            studentId: params.studentId,
            attendanceStatus: params.attendanceStatus,
            finalText: params.finalText,
            contentHash: params.contentHash,
            versionMetaJson: nextVersionMetaJson,
            expectedVersionMetaJson: existing.versionMetaJson ?? "",
            expectedExistingFinalText: existing.finalText ?? "",
          });
        if (res.changes === 0) {
          return { approved: false, conflict: true, reason: "ATOMIC_CAS_FAILED", versionMeta: meta };
        }
      } else {
        db.prepare(`
          INSERT INTO session_feedbacks (
            classId, sessionId, studentId, attendanceStatus,
            quickTagsJson, teacherNote, strengths, improvements, actionPlan,
            finalText, contentHash, status, verifiedAt, errorMessage, versionMetaJson, updatedAt
          )
          VALUES (
            @classId, @sessionId, @studentId, @attendanceStatus,
            '[]', '', '', '', '',
            @finalText, @contentHash, 'APPROVED', NULL, NULL, @versionMetaJson, datetime('now', 'localtime')
          )
        `).run({
          classId: params.classId,
          sessionId: params.sessionId,
          studentId: params.studentId,
          attendanceStatus: params.attendanceStatus,
          finalText: params.finalText,
          contentHash: params.contentHash,
          versionMetaJson: nextVersionMetaJson,
        });
      }

      return { approved: true, versionMeta: nextMeta };
    };

    if (typeof (db as any).transaction === "function") {
      return (db as any).transaction(runTx)();
    }
    return runTx();
  },

  findBySession(classId: string, sessionId: string): SessionFeedbackRecord[] {
    const db = getDb();
    return db
      .prepare(`SELECT * FROM session_feedbacks WHERE classId = ? AND sessionId = ?`)
      .all(classId, sessionId) as SessionFeedbackRecord[];
  },

  findByClass(classId: string): SessionFeedbackRecord[] {
    const db = getDb();
    return db
      .prepare(`SELECT * FROM session_feedbacks WHERE classId = ? ORDER BY id ASC`)
      .all(classId) as SessionFeedbackRecord[];
  },

  findOne(classId: string, sessionId: string, studentId: string): SessionFeedbackRecord | undefined {
    const db = getDb();
    return db
      .prepare(`SELECT * FROM session_feedbacks WHERE classId = ? AND sessionId = ? AND studentId = ?`)
      .get(classId, sessionId, studentId) as SessionFeedbackRecord | undefined;
  },

  updateStatus(
    classId: string,
    sessionId: string,
    studentId: string,
    status: SessionFeedbackRecord["status"],
    verifiedAt?: string | null,
    errorMessage?: string | null,
    expectedContentHash?: string | null
  ) {
    const db = getDb();
    if (expectedContentHash !== undefined && expectedContentHash !== null) {
      return db
        .prepare(`
          UPDATE session_feedbacks
          SET status = ?, verifiedAt = ?, errorMessage = ?, updatedAt = datetime('now', 'localtime')
          WHERE classId = ? AND sessionId = ? AND studentId = ? AND contentHash = ?
        `)
        .run(
          status,
          verifiedAt ?? null,
          errorMessage ?? null,
          classId,
          sessionId,
          studentId,
          expectedContentHash
        );
    }
    return db
      .prepare(`
        UPDATE session_feedbacks
        SET status = ?, verifiedAt = ?, errorMessage = ?, updatedAt = datetime('now', 'localtime')
        WHERE classId = ? AND sessionId = ? AND studentId = ?
      `)
      .run(status, verifiedAt ?? null, errorMessage ?? null, classId, sessionId, studentId);
  },

  markVerified(classId: string, sessionId: string, studentId: string, expectedContentHash?: string | null) {
    const db = getDb();
    if (expectedContentHash !== undefined && expectedContentHash !== null) {
      return db
        .prepare(`
          UPDATE session_feedbacks
          SET status = 'VERIFIED', verifiedAt = datetime('now', 'localtime'), errorMessage = NULL, updatedAt = datetime('now', 'localtime')
          WHERE classId = ? AND sessionId = ? AND studentId = ? AND contentHash = ?
        `)
        .run(classId, sessionId, studentId, expectedContentHash);
    }
    return db
      .prepare(`
        UPDATE session_feedbacks
        SET status = 'VERIFIED', verifiedAt = datetime('now', 'localtime'), errorMessage = NULL, updatedAt = datetime('now', 'localtime')
        WHERE classId = ? AND sessionId = ? AND studentId = ?
      `)
      .run(classId, sessionId, studentId);
  },
};

export interface HomeworkSubmissionRecord {
  id?: number;
  classId: string;
  sessionId: string;
  studentId: string;
  submissionId: string;
  originalFileName?: string;
  localFilePath?: string;
  fileHash?: string;
  parseStatus: "PENDING" | "PARSED" | "PARSE_ERROR";
  parseErrorReason?: string | null;
  criteriaGradesJson?: string;
  calculatedScore?: number;
  teacherOverrideScore?: number | null;
  decision: "GRADE" | "REDO";
  feedbackHtml?: string;
  contentHash?: string;
  status: "PENDING" | "ANALYZING" | "WAITING_APPROVAL" | "APPROVED" | "SAVING" | "VERIFIED" | "FAILED";
  verifiedAt?: string | null;
  errorMessage?: string | null;
}

export function computeHomeworkContentHash(record: {
  submissionId: string;
  studentId: string;
  classId: string;
  sessionId: string;
  fileHash?: string | null;
  decision?: "GRADE" | "REDO" | string;
  calculatedScore?: number | null;
  teacherOverrideScore?: number | null;
  criteriaGradesJson?: string | null;
  feedbackHtml?: string | null;
}): string {
  const effectiveScore =
    typeof record.teacherOverrideScore === "number" && Number.isFinite(record.teacherOverrideScore)
      ? record.teacherOverrideScore
      : Number(record.calculatedScore ?? 0);
  const canonical = JSON.stringify({
    submissionId: String(record.submissionId || "").trim(),
    studentId: String(record.studentId || "").trim(),
    classId: String(record.classId || "").trim().toUpperCase(),
    sessionId: String(record.sessionId || "").trim(),
    fileHash: String(record.fileHash ?? ""),
    decision: record.decision === "REDO" ? "REDO" : "GRADE",
    effectiveScore,
    criteriaGradesJson: String(record.criteriaGradesJson ?? "[]"),
    feedbackHtml: String(record.feedbackHtml ?? ""),
  });
  return calculateSha256(canonical);
}

export function verifyHomeworkContentIntegrity(record: HomeworkSubmissionRecord): boolean {
  if (!record || !record.contentHash) return false;
  const compositeHash = computeHomeworkContentHash(record);
  return record.contentHash === compositeHash;
}

function attachGradedFileHash(
  row: HomeworkSubmissionRecord | undefined
): HomeworkSubmissionRecord | undefined {
  if (!row) return row;
  const db = getDb();
  const meta = db
    .prepare(
      `SELECT gradedFileHash, draftSeq, fieldSeqJson FROM homework_submission_meta WHERE submissionId = ?`
    )
    .get(row.submissionId) as
    | { gradedFileHash: string; draftSeq: number; fieldSeqJson: string }
    | undefined;
  const gHash = meta ? meta.gradedFileHash : row.fileHash ?? "";
  const dSeq = meta?.draftSeq ?? 0;
  const fSeqJson = meta?.fieldSeqJson ?? "{}";
  Object.defineProperty(row, "_gradedFileHash", {
    value: gHash,
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(row, "_draftSeq", {
    value: dSeq,
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(row, "_fieldSeqJson", {
    value: fSeqJson,
    enumerable: false,
    configurable: true,
  });
  if (dSeq > 0) {
    (row as any).draftSeq = dSeq;
  }
  return row;
}

export const homeworkSubmissionRepo = {
  upsert(record: HomeworkSubmissionRecord) {
    const db = getDb();

    // Strict ID integrity check: prevent reassigning submissionId to a different student, class, or session
    const existing = db
      .prepare(
        `SELECT studentId, classId, sessionId, status, contentHash, feedbackHtml, decision, calculatedScore, teacherOverrideScore, criteriaGradesJson, fileHash, parseStatus FROM homework_submissions WHERE submissionId = ?`
      )
      .get(record.submissionId) as
      | {
          studentId: string;
          classId: string;
          sessionId: string;
          status: string;
          contentHash: string;
          feedbackHtml: string;
          decision: string;
          calculatedScore: number;
          teacherOverrideScore: number | null;
          criteriaGradesJson: string;
          fileHash: string;
          parseStatus: string;
        }
      | undefined;

    if (existing) {
      if (
        existing.studentId !== record.studentId ||
        existing.classId !== record.classId ||
        existing.sessionId !== record.sessionId
      ) {
        throw new Error(
          `[Integrity Violation] Không thể thay đổi liên kết submissionId '${record.submissionId}' (thuộc student='${existing.studentId}', class='${existing.classId}', session='${existing.sessionId}') sang (student='${record.studentId}', class='${record.classId}', session='${record.sessionId}').`
        );
      }
    }

    let targetStatus = record.status || "PENDING";
    let targetHash = record.contentHash ?? "";
    let targetVerifiedAt = record.verifiedAt ?? null;

    if (existing && (existing.status === "APPROVED" || existing.status === "VERIFIED")) {
      const feedbackChanged = (record.feedbackHtml ?? "") !== (existing.feedbackHtml ?? "");
      const scoreChanged = (record.calculatedScore ?? 0) !== (existing.calculatedScore ?? 0);
      const overrideChanged =
        (record.teacherOverrideScore ?? null) !== (existing.teacherOverrideScore ?? null);
      const decisionChanged = (record.decision || "GRADE") !== (existing.decision || "GRADE");
      const criteriaChanged =
        (record.criteriaGradesJson ?? "[]") !== (existing.criteriaGradesJson ?? "[]");
      const fileChanged = (record.fileHash ?? "") !== (existing.fileHash ?? "");
      const parseChanged = (record.parseStatus || "PENDING") !== (existing.parseStatus || "PENDING");

      const anyContentChanged =
        feedbackChanged ||
        scoreChanged ||
        overrideChanged ||
        decisionChanged ||
        criteriaChanged ||
        fileChanged ||
        parseChanged;

      const compositeHash = computeHomeworkContentHash(record);
      if (anyContentChanged && (record.contentHash !== compositeHash || record.contentHash === existing.contentHash)) {
        targetStatus = "WAITING_APPROVAL";
        targetHash = "";
        targetVerifiedAt = null;
      }
    }

    if (targetStatus === "APPROVED" || targetStatus === "VERIFIED") {
      const compositeHash = computeHomeworkContentHash(record);
      if (targetHash !== compositeHash) {
        targetStatus = "WAITING_APPROVAL";
        targetHash = "";
        targetVerifiedAt = null;
      }
    }

    const existingMeta = db
      .prepare(
        `SELECT gradedFileHash, draftSeq, fieldSeqJson FROM homework_submission_meta WHERE submissionId = ?`
      )
      .get(record.submissionId) as
      | { gradedFileHash: string; draftSeq: number; fieldSeqJson: string }
      | undefined;

    let nextGradedFileHash = existingMeta?.gradedFileHash ?? "";
    if (!existing) {
      nextGradedFileHash = String(record.fileHash ?? "");
    } else if (
      (record as any)._freshlyGraded ||
      (record as any)._freshlyReviewed ||
      targetStatus === "APPROVED" ||
      targetStatus === "VERIFIED"
    ) {
      nextGradedFileHash = String(record.fileHash ?? "");
    } else if (!existingMeta) {
      nextGradedFileHash = String(existing.fileHash ?? "");
    }

    const nextDraftSeq =
      typeof (record as any)._draftSeq === "number"
        ? (record as any)._draftSeq
        : existingMeta?.draftSeq ?? 0;
    const nextFieldSeqJson =
      typeof (record as any)._fieldSeqJson === "string"
        ? (record as any)._fieldSeqJson
        : existingMeta?.fieldSeqJson ?? "{}";

    const stmt = db.prepare(`
      INSERT INTO homework_submissions (
        classId, sessionId, studentId, submissionId, originalFileName,
        localFilePath, fileHash, parseStatus, parseErrorReason,
        criteriaGradesJson, calculatedScore, teacherOverrideScore,
        decision, feedbackHtml, contentHash, status, verifiedAt, errorMessage, updatedAt
      )
      VALUES (
        @classId, @sessionId, @studentId, @submissionId, @originalFileName,
        @localFilePath, @fileHash, @parseStatus, @parseErrorReason,
        @criteriaGradesJson, @calculatedScore, @teacherOverrideScore,
        @decision, @feedbackHtml, @contentHash, @status, @verifiedAt, @errorMessage, datetime('now', 'localtime')
      )
      ON CONFLICT(submissionId) DO UPDATE SET
        originalFileName = excluded.originalFileName,
        localFilePath = excluded.localFilePath,
        fileHash = excluded.fileHash,
        parseStatus = excluded.parseStatus,
        parseErrorReason = excluded.parseErrorReason,
        criteriaGradesJson = excluded.criteriaGradesJson,
        calculatedScore = excluded.calculatedScore,
        teacherOverrideScore = excluded.teacherOverrideScore,
        decision = excluded.decision,
        feedbackHtml = excluded.feedbackHtml,
        contentHash = excluded.contentHash,
        status = excluded.status,
        verifiedAt = excluded.verifiedAt,
        errorMessage = excluded.errorMessage,
        updatedAt = datetime('now', 'localtime')
    `);
    const metaStmt = db.prepare(`
      INSERT INTO homework_submission_meta (submissionId, gradedFileHash, draftSeq, fieldSeqJson)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(submissionId) DO UPDATE SET
        gradedFileHash = excluded.gradedFileHash,
        draftSeq = excluded.draftSeq,
        fieldSeqJson = excluded.fieldSeqJson
    `);
    const runAtomicUpsert = db.transaction(() => {
      const res = stmt.run({
        classId: record.classId,
        sessionId: record.sessionId,
        studentId: record.studentId,
        submissionId: record.submissionId,
        originalFileName: record.originalFileName ?? "",
        localFilePath: record.localFilePath ?? "",
        fileHash: record.fileHash ?? "",
        parseStatus: record.parseStatus || "PENDING",
        parseErrorReason: record.parseErrorReason ?? null,
        criteriaGradesJson: record.criteriaGradesJson ?? "[]",
        calculatedScore: record.calculatedScore ?? 0,
        teacherOverrideScore: record.teacherOverrideScore ?? null,
        decision: record.decision || "GRADE",
        feedbackHtml: record.feedbackHtml ?? "",
        contentHash: targetHash,
        status: targetStatus,
        verifiedAt: targetVerifiedAt,
        errorMessage: record.errorMessage ?? null,
      });
      metaStmt.run(record.submissionId, nextGradedFileHash, nextDraftSeq, nextFieldSeqJson);
      return res;
    });
    return runAtomicUpsert();
  },

  findBySession(classId: string, sessionId: string): HomeworkSubmissionRecord[] {
    const db = getDb();
    const rows = db
      .prepare(`SELECT * FROM homework_submissions WHERE classId = ? AND sessionId = ?`)
      .all(classId, sessionId) as HomeworkSubmissionRecord[];
    return rows.map((r) => attachGradedFileHash(r)!);
  },

  findBySubmissionId(submissionId: string): HomeworkSubmissionRecord | undefined {
    const db = getDb();
    const row = db
      .prepare(`SELECT * FROM homework_submissions WHERE submissionId = ?`)
      .get(submissionId) as HomeworkSubmissionRecord | undefined;
    return attachGradedFileHash(row);
  },

  markVerified(submissionId: string, expectedContentHash?: string) {
    const db = getDb();
    const current = db
      .prepare(`SELECT * FROM homework_submissions WHERE submissionId = ?`)
      .get(submissionId) as HomeworkSubmissionRecord | undefined;

    if (
      !current ||
      (current.status !== "APPROVED" && current.status !== "FAILED") ||
      !verifyHomeworkContentIntegrity(current) ||
      (expectedContentHash !== undefined && current.contentHash !== expectedContentHash)
    ) {
      return { changes: 0, lastInsertRowid: 0 };
    }

    return db
      .prepare(`
        UPDATE homework_submissions
        SET status = 'VERIFIED', verifiedAt = datetime('now', 'localtime'), errorMessage = NULL, updatedAt = datetime('now', 'localtime')
        WHERE submissionId = ? AND (status = 'APPROVED' OR status = 'FAILED') AND contentHash = ?
      `)
      .run(submissionId, current.contentHash);
  },
};

export type SpckSessionSlotNumber = 12 | 13 | 14;
export type SpckSessionNumber = SpckSessionSlotNumber;
export type SpckStageNumber = 1 | 2;
export type SpckStageCode = "GĐ1" | "GĐ2";

export interface SpckStageInfo {
  sessionNumber: SpckSessionSlotNumber;
  stageNumber: SpckStageNumber;
  stageCode: SpckStageCode;
  stageLabel: string;
  fullBadgeLabel: string;
  titleSuffix: string;
}

export function isValidSpckSessionSlot(raw: unknown): raw is SpckSessionSlotNumber {
  const num = typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim()) : raw;
  return typeof num === "number" && Number.isInteger(num) && (num === 12 || num === 13 || num === 14);
}

export function parseSpckSessionSlotStrict(raw: unknown, contextLabel = "SPCK"): SpckSessionSlotNumber {
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) {
    throw new Error(`[${contextLabel}] Thiếu thông tin buổi nộp SPCK (sessionNumber bắt buộc là 12, 13 hoặc 14).`);
  }
  const num = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof num !== "number" || !Number.isInteger(num) || (num !== 12 && num !== 13 && num !== 14)) {
    throw new Error(
      `[${contextLabel}] Buổi nộp SPCK không hợp lệ (${String(raw)}). Chỉ chấp nhận buổi 12, 13 hoặc 14.`
    );
  }
  return num as SpckSessionSlotNumber;
}

export function getSpckStageInfo(rawSessionNumber: unknown, contextLabel = "SPCK"): SpckStageInfo {
  const sessionNumber = parseSpckSessionSlotStrict(rawSessionNumber, contextLabel);
  if (sessionNumber === 12 || sessionNumber === 13) {
    return {
      sessionNumber,
      stageNumber: 1,
      stageCode: "GĐ1",
      stageLabel: "Giai đoạn 1",
      fullBadgeLabel: `Buổi ${sessionNumber} — Giai đoạn 1`,
      titleSuffix: ` — Buổi ${sessionNumber} (GĐ1)`,
    };
  }
  return {
    sessionNumber: 14,
    stageNumber: 2,
    stageCode: "GĐ2",
    stageLabel: "Tổng kết cuối khóa",
    fullBadgeLabel: "Buổi 14 — Tổng kết cuối khóa",
    titleSuffix: "",
  };
}

export function assertClassHasSpckSession(
  classId: string,
  rawSessionNumber: unknown,
  contextLabel = "SPCK"
): SpckStageInfo {
  const stageInfo = getSpckStageInfo(rawSessionNumber, contextLabel);
  const normalizedClassId = String(classId || "").trim().toUpperCase();
  if (!normalizedClassId) {
    throw new Error(`[${contextLabel}] Thiếu mã lớp (classId).`);
  }
  const classSessions = classSessionRepo.findByClass(normalizedClassId);
  if (
    classSessions.length > 0 &&
    !classSessions.some((s) => Number(s.sessionNumber) === stageInfo.sessionNumber)
  ) {
    throw new Error(
      `[${contextLabel}] Lớp ${normalizedClassId} chưa có Buổi ${stageInfo.sessionNumber} trong danh sách buổi học đã đồng bộ.`
    );
  }
  return stageInfo;
}

const SPCK_SESSION_SUFFIX_REGEX =
  /\s*(?:(?:—|–|-|\|)\s*Buổi(?:\s+số)?\s*(?:12|13|14)(?:\s*\((?:GĐ\s*[12]|Giai\s+đoạn\s*[12])\))?|\((?:GĐ\s*2|Giai\s+đoạn\s*2)\)|(?:—|–|-|\|)\s*(?:GĐ\s*2|Giai\s+đoạn\s*2))\s*$/i;
const FORBIDDEN_STAGE2_TITLE_REGEX = /\b(?:giai\s*đoạn\s*2|gđ\s*2)\b/i;

export function stripSpckSessionSuffix(rawTitle?: string | null): string {
  let current = String(rawTitle ?? "").replace(/\s+/g, " ").trim();
  while (SPCK_SESSION_SUFFIX_REGEX.test(current)) {
    current = current.replace(SPCK_SESSION_SUFFIX_REGEX, "").trim();
  }
  current = current
    .replace(/\s*(?:—|–|-|\|)?\s*\(?(?:GĐ\s*2|Giai\s+đoạn\s*2)\)?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return current;
}

export function formatSpckSessionTitle(
  rawOrBaseTitle: string | null | undefined,
  rawSessionNumber: unknown,
  fallbackStudentName?: string | null
): string {
  const stageInfo = getSpckStageInfo(rawSessionNumber, "formatSpckSessionTitle");
  const stripped = stripSpckSessionSuffix(rawOrBaseTitle);
  const fallbackBase =
    fallbackStudentName && String(fallbackStudentName).trim()
      ? `SPCK ${String(fallbackStudentName).replace(/\s+/g, " ").trim()}`
      : "Sản phẩm cuối khóa";
  const base = stripped || fallbackBase;
  return `${base}${stageInfo.titleSuffix}`;
}

export function isDefaultSpckProductTitle(
  title?: string | null,
  studentFullName?: string | null
): boolean {
  const base = stripSpckSessionSuffix(title);
  if (!base) return true;
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const normBase = norm(base);
  if (
    !normBase ||
    normBase === "spck" ||
    normBase === "san pham cuoi khoa" ||
    normBase === "du an cuoi khoa"
  ) {
    return true;
  }
  if (studentFullName && String(studentFullName).trim()) {
    const normStu = norm(studentFullName);
    if (
      normStu &&
      (normBase === normStu ||
        normBase === `spck ${normStu}` ||
        normBase === `san pham cuoi khoa ${normStu}` ||
        normBase === `du an ${normStu}`)
    ) {
      return true;
    }
  }
  // Also detect generic "SPCK <2-5 capitalized words>" with no separator or topic
  if (/^spck\s+[a-z]+(?:\s+[a-z]+){1,4}$/i.test(normBase) && !/[-:–—|]/.test(base)) {
    return true;
  }
  return false;
}

export function validateSpckTitleLength(
  fullTitle?: string | null,
  expectedSessionNumber?: SpckSessionSlotNumber
): {
  valid: boolean;
  length: number;
  maxLength: 100;
  baseTitle: string;
  hasValidSuffix: boolean;
  isDefaultProductTitle?: boolean;
  reason?: string;
} {
  const trimmed = String(fullTitle ?? "").replace(/\s+/g, " ").trim();
  const length = trimmed.length;
  const baseTitle = stripSpckSessionSuffix(trimmed);

  if (length === 0) {
    return {
      valid: false,
      length: 0,
      maxLength: 100,
      baseTitle: "",
      hasValidSuffix: false,
      reason: "Tiêu đề dự án đang để trống.",
    };
  }
  if (!baseTitle) {
    return {
      valid: false,
      length,
      maxLength: 100,
      baseTitle: "",
      hasValidSuffix: false,
      reason: "Tiêu đề thiếu tên sản phẩm gốc trước hậu tố buổi/giai đoạn.",
    };
  }
  if (FORBIDDEN_STAGE2_TITLE_REGEX.test(trimmed)) {
    return {
      valid: false,
      length,
      maxLength: 100,
      baseTitle,
      hasValidSuffix: false,
      reason: "Tiêu đề dự án không được ghi 'Giai đoạn 2' hoặc 'GĐ2'.",
    };
  }

  let hasValidSuffix = true;
  if (expectedSessionNumber !== undefined && isValidSpckSessionSlot(expectedSessionNumber)) {
    const expectedSuffix = getSpckStageInfo(expectedSessionNumber).titleSuffix.trim();
    if (expectedSuffix) {
      hasValidSuffix = trimmed.endsWith(expectedSuffix);
      if (!hasValidSuffix) {
        return {
          valid: false,
          length,
          maxLength: 100,
          baseTitle,
          hasValidSuffix: false,
          reason: `Tiêu đề phải kết thúc bằng hậu tố giai đoạn "${expectedSuffix}".`,
        };
      }
    } else {
      hasValidSuffix = !SPCK_SESSION_SUFFIX_REGEX.test(trimmed);
      if (!hasValidSuffix) {
        return {
          valid: false,
          length,
          maxLength: 100,
          baseTitle,
          hasValidSuffix: false,
          reason: "Tiêu đề dự án Buổi 14 không được gắn hậu tố Giai đoạn 2.",
        };
      }
    }
  }

  if (length > 100) {
    return {
      valid: false,
      length,
      maxLength: 100,
      baseTitle,
      hasValidSuffix,
      reason: `Tiêu đề đầy đủ vượt quá 100 ký tự (${length}/100). Vui lòng rút gọn tên sản phẩm (không tự động cắt tên).`,
    };
  }

  return {
    valid: true,
    length,
    maxLength: 100,
    baseTitle,
    hasValidSuffix,
  };
}

export interface SpckSessionSubmissionResult {
  sessionNumber: SpckSessionSlotNumber;
  status: "VERIFIED" | "FAILED";
  submittedContentHash: string;
  verifiedAt?: string | null;
  lastVerifiedContentHash?: string | null;
  lastVerifiedAt?: string | null;
  lmsWorkId?: string | null;
  updatedAt: string;
  errorMessage?: string | null;
}

export type SpckSessionResultsMap = Partial<
  Record<"12" | "13" | "14", SpckSessionSubmissionResult>
>;

export interface SpckSessionResultsInspection {
  valid: boolean;
  corruptedReason: string | null;
  entries: SpckSessionResultsMap;
}

export function inspectSpckSessionResultsRaw(raw?: string | null): SpckSessionResultsInspection {
  if (raw === undefined || raw === null) {
    return { valid: true, corruptedReason: null, entries: {} };
  }
  if (typeof raw !== "string") {
    return {
      valid: false,
      corruptedReason: "Dữ liệu lịch sử buổi nộp không phải chuỗi JSON.",
      entries: {},
    };
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "{}") {
    return { valid: true, corruptedReason: null, entries: {} };
  }
  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err: any) {
    return {
      valid: false,
      corruptedReason: `JSON lịch sử buổi nộp bị lỗi cú pháp: ${err?.message || "Invalid JSON"}`,
      entries: {},
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      valid: false,
      corruptedReason: "Cấu trúc lịch sử buổi nộp không phải đối tượng hợp lệ.",
      entries: {},
    };
  }

  const out: SpckSessionResultsMap = {};
  let corruptedReason: string | null = null;
  const allowedKeys = new Set(["12", "13", "14"]);

  for (const key of Object.keys(parsed)) {
    if (!allowedKeys.has(key)) {
      corruptedReason = `Lịch sử chứa mã buổi không hợp lệ: "${key}".`;
      continue;
    }
    const entry = parsed[key];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      corruptedReason = `Bản ghi lịch sử buổi ${key} không phải object hợp lệ.`;
      continue;
    }
    if (entry.status !== "VERIFIED" && entry.status !== "FAILED") {
      corruptedReason = `Trạng thái lịch sử buổi ${key} không hợp lệ: "${String(entry.status)}".`;
      continue;
    }
    const subHash = String(entry.submittedContentHash || "").trim();
    const verHash = String(entry.lastVerifiedContentHash || "").trim();
    const verAt = String(entry.verifiedAt || entry.lastVerifiedAt || "").trim();
    if (entry.status === "VERIFIED" && !subHash && !verHash && !verAt) {
      corruptedReason = `Bản ghi VERIFIED buổi ${key} thiếu cả mã băm và thời gian xác nhận.`;
      continue;
    }
    const slotKey = key as "12" | "13" | "14";
    out[slotKey] = {
      sessionNumber: Number(key) as SpckSessionSlotNumber,
      status: entry.status,
      submittedContentHash: subHash,
      verifiedAt: entry.verifiedAt ?? null,
      lastVerifiedContentHash: entry.lastVerifiedContentHash ?? (entry.status === "VERIFIED" ? subHash : null),
      lastVerifiedAt: entry.lastVerifiedAt ?? (entry.status === "VERIFIED" ? entry.verifiedAt ?? null : null),
      lmsWorkId: entry.lmsWorkId ?? null,
      updatedAt: String(entry.updatedAt || entry.verifiedAt || ""),
      errorMessage: entry.errorMessage ?? null,
    };
  }

  return {
    valid: corruptedReason === null,
    corruptedReason,
    entries: out,
  };
}

export function parseSpckSessionResults(raw?: string | null): SpckSessionResultsMap {
  return inspectSpckSessionResultsRaw(raw).entries;
}

export interface SpckUploadRecord {
  id?: number;
  classId: string;
  studentId: string;
  localFolderPath?: string;
  matchScore?: number;
  isConfirmedByTeacher: number;
  projectTitle?: string;
  baseProjectTitle?: string;
  thumbnailPath?: string;
  screenshotsJson?: string;
  attachmentsJson?: string;
  youtubeUrlsJson?: string;
  relatedLinksJson?: string;
  teacherComment?: string;
  contentHash?: string;
  status: "INSUFFICIENT_INFO" | "DRAFT" | "WAITING_APPROVAL" | "APPROVED" | "SAVING" | "VERIFIED" | "FAILED";
  verifiedAt?: string | null;
  errorMessage?: string | null;
  draftSeq?: number;
  sessionResultsJson?: string;
  hasLegacyUnknownSessionHistory?: number;
  legacyHistoryMetaJson?: string;
  historyCorrupted?: number;
  historyCorruptedReason?: string | null;
  approvedSessionNumber?: number | null;
}

export interface SpckSubmissionSnapshot {
  classId: string;
  studentId: string;
  sessionNumber: SpckSessionSlotNumber;
  stageNumber: SpckStageNumber;
  stageCode: SpckStageCode;
  localFolderPath: string;
  projectTitle: string;
  thumbnailPath: string;
  thumbnailByteSha256: string;
  screenshots: Array<{ path: string; byteSha256: string }>;
  attachments: Array<{ path: string; byteSha256: string }>;
  youtubeUrls: string[];
  relatedLinks: Array<{ name: string; url: string }>;
  teacherComment: string;
  teacherNote?: string;
  quickTags?: string[];
  contentHash: string;
  capturedAt: string;
  lmsWorkId?: string | null;
  missingSnapshot?: boolean;
  note?: string;
}

export interface SpckSessionSubmissionRecord {
  id?: number;
  classId: string;
  studentId: string;
  sessionNumber: SpckSessionSlotNumber;
  stageNumber: SpckStageNumber;
  localFolderPath: string;
  isConfirmedByTeacher: number;
  projectTitle: string;
  thumbnailPath: string;
  screenshotsJson: string;
  attachmentsJson: string;
  youtubeUrlsJson: string;
  relatedLinksJson: string;
  teacherComment: string;
  teacherNote: string;
  quickTagsJson: string;
  draftVersion: number;
  isDraftInitialized: number;
  draftStatus: "INSUFFICIENT_INFO" | "DRAFT" | "WAITING_APPROVAL" | "APPROVED" | "SAVING" | "VERIFIED" | "FAILED";
  approvedContentHash: string;
  approvedSnapshotJson: string;
  approvedAt: string | null;
  lastAttemptStatus: "VERIFIED" | "FAILED" | null;
  lastAttemptHash: string;
  lastAttemptAt: string | null;
  lastErrorMessage: string | null;
  lastVerifiedHash: string;
  lastVerifiedAt: string | null;
  lastVerifiedLmsWorkId: string | null;
  lastVerifiedSnapshotJson: string;
  missingLegacySnapshot: number;
  createdAt?: string;
  updatedAt?: string;
}

export function canonicalizeSpckFolderPath(rawPath?: string | null): string {
  const trimmed = String(rawPath ?? "").trim();
  if (!trimmed) return "";
  const safe = assertPathAllowed(trimmed);
  try {
    if (fs.existsSync(safe)) {
      return fs.realpathSync(safe);
    }
  } catch {
    // Fallback to resolved safe path if realpath fails
  }
  return path.resolve(safe);
}

export function normalizeSpckFolderKey(rawPath?: string | null): string {
  const trimmed = String(rawPath ?? "").trim();
  if (!trimmed) return "";
  try {
    return canonicalizeSpckFolderPath(trimmed)
      .replace(/\\/g, "/")
      .replace(/\/+$/, "")
      .toLowerCase();
  } catch {
    return path
      .resolve(trimmed)
      .replace(/\\/g, "/")
      .replace(/\/+$/, "")
      .toLowerCase();
  }
}

function parseSpckPathArraySafe(raw?: string | null): string[] {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function parseSpckRelatedLinksArraySafe(raw?: string | null): Array<{ name: string; url: string }> {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const url = String((item as any).url ?? "").trim();
        const name = String((item as any).name ?? url).trim();
        return url ? { name: name || url, url } : null;
      })
      .filter((x): x is { name: string; url: string } => Boolean(x));
  } catch {
    return [];
  }
}

export function computeSafeFileByteDigest(filePath?: string | null): string {
  const trimmed = String(filePath ?? "").trim();
  if (!trimmed) return "";
  try {
    const safe = assertPathAllowed(trimmed);
    if (fs.existsSync(safe) && fs.statSync(safe).isFile()) {
      return calculateSha256(fs.readFileSync(safe));
    }
    return "MISSING";
  } catch {
    return "DISALLOWED";
  }
}

export function computeSpckContentHash(record: {
  classId: string;
  studentId: string;
  localFolderPath?: string | null;
  isConfirmedByTeacher?: number | boolean | null;
  projectTitle?: string | null;
  thumbnailPath?: string | null;
  screenshotsJson?: string | null;
  attachmentsJson?: string | null;
  youtubeUrlsJson?: string | null;
  relatedLinksJson?: string | null;
  teacherComment?: string | null;
}): string {
  const screenshotPaths = parseSpckPathArraySafe(record.screenshotsJson);
  const attachmentPaths = parseSpckPathArraySafe(record.attachmentsJson);

  const canonical = JSON.stringify({
    classId: String(record.classId || "").trim().toUpperCase(),
    studentId: String(record.studentId || "").trim(),
    localFolderPath: normalizeSpckFolderKey(record.localFolderPath),
    isConfirmedByTeacher: record.isConfirmedByTeacher ? 1 : 0,
    projectTitle: String(record.projectTitle ?? "").trim(),
    thumbnailPath: String(record.thumbnailPath ?? "").trim(),
    thumbnailByteSha256: computeSafeFileByteDigest(record.thumbnailPath),
    screenshotsJson: String(record.screenshotsJson ?? "[]"),
    screenshotByteSha256s: screenshotPaths.map((p) => computeSafeFileByteDigest(p)),
    attachmentsJson: String(record.attachmentsJson ?? "[]"),
    attachmentByteSha256s: attachmentPaths.map((p) => computeSafeFileByteDigest(p)),
    youtubeUrlsJson: String(record.youtubeUrlsJson ?? "[]"),
    relatedLinksJson: String(record.relatedLinksJson ?? "[]"),
    teacherComment: String(record.teacherComment ?? ""),
  });
  return calculateSha256(canonical);
}

export function computeSpckSessionContentHash(
  record: {
    classId: string;
    studentId: string;
    localFolderPath?: string | null;
    isConfirmedByTeacher?: number | boolean | null;
    projectTitle?: string | null;
    thumbnailPath?: string | null;
    screenshotsJson?: string | null;
    attachmentsJson?: string | null;
    youtubeUrlsJson?: string | null;
    relatedLinksJson?: string | null;
    teacherComment?: string | null;
  },
  sessionNumber: SpckSessionSlotNumber
): string {
  const stageInfo = getSpckStageInfo(sessionNumber, "computeSpckSessionContentHash");
  const rawTitle = String(record.projectTitle ?? "").trim();
  const effectiveTitle = rawTitle.endsWith(stageInfo.titleSuffix.trim())
    ? rawTitle
    : formatSpckSessionTitle(rawTitle, stageInfo.sessionNumber);

  return computeSpckContentHash({
    ...record,
    projectTitle: effectiveTitle,
  });
}

export function verifySpckContentIntegrity(record: SpckUploadRecord | undefined): boolean {
  if (!record || !record.contentHash) return false;
  if (Number(record.isConfirmedByTeacher) !== 1) return false;
  const expected = computeSpckContentHash(record);
  return record.contentHash === expected;
}

export function verifySpckSessionIntegrity(
  sessionRow: SpckSessionSubmissionRecord | undefined,
  expectedSessionNumber?: SpckSessionSlotNumber
): boolean {
  if (!sessionRow || !sessionRow.approvedContentHash) return false;
  if (Number(sessionRow.isConfirmedByTeacher) !== 1) return false;
  if (
    expectedSessionNumber !== undefined &&
    Number(sessionRow.sessionNumber) !== Number(expectedSessionNumber)
  ) {
    return false;
  }
  const expected = computeSpckSessionContentHash(sessionRow, sessionRow.sessionNumber);
  const rawExpected = computeSpckContentHash(sessionRow);
  return (
    sessionRow.approvedContentHash === expected ||
    sessionRow.approvedContentHash === rawExpected
  );
}

export function buildSpckSubmissionSnapshot(
  record: {
    classId: string;
    studentId: string;
    localFolderPath?: string | null;
    projectTitle?: string | null;
    thumbnailPath?: string | null;
    screenshotsJson?: string | null;
    attachmentsJson?: string | null;
    youtubeUrlsJson?: string | null;
    relatedLinksJson?: string | null;
    teacherComment?: string | null;
    teacherNote?: string | null;
    quickTagsJson?: string | null;
  },
  sessionNumber: SpckSessionSlotNumber,
  contentHash: string,
  capturedAt: string,
  lmsWorkId?: string | null
): SpckSubmissionSnapshot {
  const stageInfo = getSpckStageInfo(sessionNumber, "buildSpckSubmissionSnapshot");
  const screenshotPaths = parseSpckPathArraySafe(record.screenshotsJson);
  const attachmentPaths = parseSpckPathArraySafe(record.attachmentsJson);
  const youtubeUrls = parseSpckPathArraySafe(record.youtubeUrlsJson);
  const relatedLinks = parseSpckRelatedLinksArraySafe(record.relatedLinksJson);
  const quickTags = parseSpckPathArraySafe(record.quickTagsJson);
  const thumbPath = String(record.thumbnailPath ?? "").trim();

  return {
    classId: String(record.classId || "").trim().toUpperCase(),
    studentId: String(record.studentId || "").trim(),
    sessionNumber: stageInfo.sessionNumber,
    stageNumber: stageInfo.stageNumber,
    stageCode: stageInfo.stageCode,
    localFolderPath: String(record.localFolderPath ?? "").trim(),
    projectTitle: String(record.projectTitle ?? "").trim(),
    thumbnailPath: thumbPath,
    thumbnailByteSha256: computeSafeFileByteDigest(thumbPath),
    screenshots: screenshotPaths.map((p) => ({
      path: p,
      byteSha256: computeSafeFileByteDigest(p),
    })),
    attachments: attachmentPaths.map((p) => ({
      path: p,
      byteSha256: computeSafeFileByteDigest(p),
    })),
    youtubeUrls,
    relatedLinks,
    teacherComment: String(record.teacherComment ?? ""),
    teacherNote: String(record.teacherNote ?? ""),
    quickTags,
    contentHash,
    capturedAt,
    lmsWorkId: lmsWorkId ?? null,
    missingSnapshot: false,
  };
}

export function parseSpckSubmissionSnapshot(rawJson?: string | null): SpckSubmissionSnapshot | null {
  if (!rawJson || typeof rawJson !== "string") return null;
  const trimmed = rawJson.trim();
  if (!trimmed || trimmed === "{}") return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as SpckSubmissionSnapshot;
  } catch {
    return null;
  }
}

export function checkSpckSnapshotFileDrift(snapshot: SpckSubmissionSnapshot | null): {
  hasFileDrift: boolean;
  driftedFiles: string[];
} {
  if (!snapshot || snapshot.missingSnapshot) {
    return { hasFileDrift: false, driftedFiles: [] };
  }
  const driftedFiles: string[] = [];

  if (snapshot.thumbnailPath && snapshot.thumbnailByteSha256) {
    const currentDigest = computeSafeFileByteDigest(snapshot.thumbnailPath);
    if (currentDigest !== snapshot.thumbnailByteSha256) {
      driftedFiles.push(path.basename(snapshot.thumbnailPath) || snapshot.thumbnailPath);
    }
  }

  for (const item of Array.isArray(snapshot.screenshots) ? snapshot.screenshots : []) {
    if (item?.path && item?.byteSha256) {
      const currentDigest = computeSafeFileByteDigest(item.path);
      if (currentDigest !== item.byteSha256) {
        driftedFiles.push(path.basename(item.path) || item.path);
      }
    }
  }

  for (const item of Array.isArray(snapshot.attachments) ? snapshot.attachments : []) {
    if (item?.path && item?.byteSha256) {
      const currentDigest = computeSafeFileByteDigest(item.path);
      if (currentDigest !== item.byteSha256) {
        driftedFiles.push(path.basename(item.path) || item.path);
      }
    }
  }

  return {
    hasFileDrift: driftedFiles.length > 0,
    driftedFiles: Array.from(new Set(driftedFiles)),
  };
}

export function migrateSpckSessionSubmissions(customDb?: Database.Database): {
  migratedSessionRows: number;
  legacyUnknownRows: number;
  corruptedRows: number;
} {
  const db = customDb || getDb();
  let migratedSessionRows = 0;
  let legacyUnknownRows = 0;
  let corruptedRows = 0;

  const rows = db.prepare(`SELECT * FROM spck_uploads`).all() as Array<
    SpckUploadRecord & { createdAt?: string; updatedAt?: string }
  >;

  for (const row of rows) {
    const baseTitle = stripSpckSessionSuffix(row.baseProjectTitle || row.projectTitle || "");
    if (baseTitle && (!row.baseProjectTitle || !row.baseProjectTitle.trim())) {
      db.prepare(`UPDATE spck_uploads SET baseProjectTitle = ? WHERE classId = ? AND studentId = ?`).run(
        baseTitle,
        row.classId,
        row.studentId
      );
    }

    const inspection = inspectSpckSessionResultsRaw(row.sessionResultsJson);

    if (!inspection.valid) {
      corruptedRows++;
      db.prepare(
        `UPDATE spck_uploads
         SET historyCorrupted = 1,
             historyCorruptedReason = ?
         WHERE classId = ? AND studentId = ?`
      ).run(inspection.corruptedReason, row.classId, row.studentId);
    }

    const entryKeys = Object.keys(inspection.entries) as Array<"12" | "13" | "14">;
    if (entryKeys.length > 0) {
      for (const key of entryKeys) {
        const entry = inspection.entries[key]!;
        const sessionNum = Number(key) as SpckSessionSlotNumber;
        const stageInfo = getSpckStageInfo(sessionNum);
        const existingSession = db
          .prepare(
            `SELECT * FROM spck_session_submissions WHERE classId = ? AND studentId = ? AND sessionNumber = ?`
          )
          .get(row.classId, row.studentId, sessionNum) as SpckSessionSubmissionRecord | undefined;

        const verHash =
          entry.status === "VERIFIED"
            ? entry.submittedContentHash || entry.lastVerifiedContentHash || row.contentHash || ""
            : entry.lastVerifiedContentHash || "";
        const verAt =
          entry.status === "VERIFIED"
            ? entry.verifiedAt || entry.lastVerifiedAt || row.verifiedAt || entry.updatedAt || null
            : entry.lastVerifiedAt || entry.verifiedAt || null;

        if (!existingSession) {
          const hasVer = Boolean(verHash || verAt);
          const legacySnap = hasVer
            ? JSON.stringify({
                classId: row.classId,
                studentId: row.studentId,
                sessionNumber: sessionNum,
                stageNumber: stageInfo.stageNumber,
                stageCode: stageInfo.stageCode,
                contentHash: verHash,
                capturedAt: verAt || entry.updatedAt || "",
                missingSnapshot: true,
                note: "Thiếu bản lưu nội dung cũ (dữ liệu chuyển đổi chỉ có mã kiểm tra và thời gian xác nhận).",
              })
            : "{}";

          const formattedTitle = formatSpckSessionTitle(
            baseTitle || row.projectTitle,
            sessionNum
          );

          db.prepare(
            `INSERT INTO spck_session_submissions (
              classId, studentId, sessionNumber, stageNumber, localFolderPath,
              isConfirmedByTeacher, projectTitle, thumbnailPath, screenshotsJson,
              attachmentsJson, youtubeUrlsJson, relatedLinksJson, teacherComment,
              teacherNote, quickTagsJson, draftVersion, isDraftInitialized,
              draftStatus, approvedContentHash, approvedSnapshotJson, approvedAt,
              lastAttemptStatus, lastAttemptHash, lastAttemptAt, lastErrorMessage,
              lastVerifiedHash, lastVerifiedAt, lastVerifiedLmsWorkId,
              lastVerifiedSnapshotJson, missingLegacySnapshot, updatedAt
            ) VALUES (
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?,
              ?, ?, ?, ?,
              '', '[]', 1, 1,
              ?, '', '{}', NULL,
              ?, ?, ?, ?,
              ?, ?, ?,
              ?, ?, ?
            )`
          ).run(
            row.classId,
            row.studentId,
            sessionNum,
            stageInfo.stageNumber,
            row.localFolderPath || "",
            row.isConfirmedByTeacher ?? 0,
            formattedTitle,
            row.thumbnailPath || "",
            row.screenshotsJson || "[]",
            row.attachmentsJson || "[]",
            row.youtubeUrlsJson || "[]",
            row.relatedLinksJson || "[]",
            row.teacherComment || "",
            entry.status === "VERIFIED" ? "VERIFIED" : "FAILED",
            entry.status,
            entry.submittedContentHash || "",
            entry.updatedAt || verAt || null,
            entry.errorMessage ?? null,
            verHash,
            verAt,
            entry.lmsWorkId ?? null,
            legacySnap,
            hasVer ? 1 : 0,
            entry.updatedAt || verAt || new Date().toISOString()
          );
          migratedSessionRows++;
        } else if (!existingSession.lastAttemptStatus && entry.status) {
          const hasVer = Boolean(verHash || verAt);
          const legacySnap =
            hasVer && (!existingSession.lastVerifiedSnapshotJson || existingSession.lastVerifiedSnapshotJson === "{}")
              ? JSON.stringify({
                  classId: row.classId,
                  studentId: row.studentId,
                  sessionNumber: sessionNum,
                  stageNumber: stageInfo.stageNumber,
                  stageCode: stageInfo.stageCode,
                  contentHash: verHash,
                  capturedAt: verAt || entry.updatedAt || "",
                  missingSnapshot: true,
                  note: "Thiếu bản lưu nội dung cũ (dữ liệu chuyển đổi chỉ có mã kiểm tra và thời gian xác nhận).",
                })
              : existingSession.lastVerifiedSnapshotJson || "{}";

          db.prepare(
            `UPDATE spck_session_submissions
             SET lastAttemptStatus = ?,
                 lastAttemptHash = ?,
                 lastAttemptAt = ?,
                 lastErrorMessage = ?,
                 lastVerifiedHash = COALESCE(NULLIF(lastVerifiedHash, ''), ?),
                 lastVerifiedAt = COALESCE(lastVerifiedAt, ?),
                 lastVerifiedSnapshotJson = ?,
                 missingLegacySnapshot = CASE WHEN missingLegacySnapshot = 1 OR ? = 1 THEN 1 ELSE 0 END
             WHERE classId = ? AND studentId = ? AND sessionNumber = ?`
          ).run(
            entry.status,
            entry.submittedContentHash || "",
            entry.updatedAt || verAt || null,
            entry.errorMessage ?? null,
            verHash,
            verAt,
            legacySnap,
            hasVer && (!existingSession.lastVerifiedSnapshotJson || existingSession.lastVerifiedSnapshotJson === "{}") ? 1 : 0,
            row.classId,
            row.studentId,
            sessionNum
          );
          migratedSessionRows++;
        }
      }
    } else if (
      inspection.valid &&
      (row.status === "VERIFIED" || (row.verifiedAt && String(row.verifiedAt).trim() !== ""))
    ) {
      // Legacy record verified without session breakdown -> mark hasLegacyUnknownSessionHistory = 1 permanently
      const sessionRowsCount = (
        db
          .prepare(
            `SELECT COUNT(*) AS cnt FROM spck_session_submissions WHERE classId = ? AND studentId = ? AND lastAttemptStatus IS NOT NULL`
          )
          .get(row.classId, row.studentId) as { cnt: number }
      ).cnt;

      if (sessionRowsCount === 0) {
        const legacyMeta = JSON.stringify({
          legacyVerifiedAt: row.verifiedAt || row.updatedAt || null,
          legacyContentHash: row.contentHash || "",
          missingSnapshot: true,
          note: "Thiếu bản lưu nội dung cũ (bản ghi từ phiên bản trước không ghi nhận cụ thể buổi 12, 13 hay 14).",
        });
        db.prepare(
          `UPDATE spck_uploads
           SET hasLegacyUnknownSessionHistory = 1,
               legacyHistoryMetaJson = CASE WHEN legacyHistoryMetaJson IS NULL OR legacyHistoryMetaJson = '' OR legacyHistoryMetaJson = '{}' THEN ? ELSE legacyHistoryMetaJson END
           WHERE classId = ? AND studentId = ?`
        ).run(legacyMeta, row.classId, row.studentId);
        legacyUnknownRows++;
      }
    }
  }

  return { migratedSessionRows, legacyUnknownRows, corruptedRows };
}

function mergeSessionResultsPreservingHistory(
  existingRaw: string | null | undefined,
  incomingRaw: string | null | undefined,
  classId: string,
  studentId: string,
  db: Database.Database
): {
  mergedJson: string;
  historyCorrupted: number;
  historyCorruptedReason: string | null;
} {
  const existingInsp = inspectSpckSessionResultsRaw(existingRaw);
  const incomingInsp =
    incomingRaw !== undefined && incomingRaw !== null
      ? inspectSpckSessionResultsRaw(incomingRaw)
      : { valid: true, corruptedReason: null, entries: {} as SpckSessionResultsMap };

  if (!existingInsp.valid) {
    return {
      mergedJson: String(existingRaw || "{}"),
      historyCorrupted: 1,
      historyCorruptedReason: existingInsp.corruptedReason,
    };
  }
  if (!incomingInsp.valid) {
    return {
      mergedJson: String(incomingRaw || "{}"),
      historyCorrupted: 1,
      historyCorruptedReason: incomingInsp.corruptedReason,
    };
  }

  // Merge: start from existing entries, overlay incoming entries (never deleting existing keys if incoming is "{}" from a stale read!),
  // and overlay any authoritative rows from spck_session_submissions.
  const merged: SpckSessionResultsMap = { ...existingInsp.entries };
  for (const key of ["12", "13", "14"] as const) {
    const inc = incomingInsp.entries[key];
    if (inc) {
      const prev = merged[key];
      if (!prev) {
        merged[key] = inc;
      } else {
        // Preserve lastVerified* if prev was VERIFIED
        merged[key] = {
          ...inc,
          lastVerifiedContentHash:
            inc.lastVerifiedContentHash ||
            (prev.status === "VERIFIED" ? prev.submittedContentHash : prev.lastVerifiedContentHash) ||
            null,
          lastVerifiedAt:
            inc.lastVerifiedAt ||
            (prev.status === "VERIFIED" ? prev.verifiedAt : prev.lastVerifiedAt) ||
            null,
        };
      }
    }
  }

  try {
    const sessionRows = db
      .prepare(
        `SELECT sessionNumber, lastAttemptStatus, lastAttemptHash, lastAttemptAt, lastErrorMessage, lastVerifiedHash, lastVerifiedAt, lastVerifiedLmsWorkId
         FROM spck_session_submissions
         WHERE classId = ? AND studentId = ? AND lastAttemptStatus IS NOT NULL`
      )
      .all(classId, studentId) as Array<{
      sessionNumber: number;
      lastAttemptStatus: "VERIFIED" | "FAILED" | null;
      lastAttemptHash: string;
      lastAttemptAt: string | null;
      lastErrorMessage: string | null;
      lastVerifiedHash: string;
      lastVerifiedAt: string | null;
      lastVerifiedLmsWorkId: string | null;
    }>;

    for (const sr of sessionRows) {
      if ((sr.sessionNumber === 12 || sr.sessionNumber === 13 || sr.sessionNumber === 14) && sr.lastAttemptStatus) {
        const key = String(sr.sessionNumber) as "12" | "13" | "14";
        merged[key] = {
          sessionNumber: sr.sessionNumber as SpckSessionSlotNumber,
          status: sr.lastAttemptStatus,
          submittedContentHash: sr.lastAttemptHash || sr.lastVerifiedHash || "",
          verifiedAt: sr.lastAttemptStatus === "VERIFIED" ? sr.lastVerifiedAt : sr.lastVerifiedAt ?? null,
          lastVerifiedContentHash: sr.lastVerifiedHash || null,
          lastVerifiedAt: sr.lastVerifiedAt || null,
          lmsWorkId: sr.lastVerifiedLmsWorkId || null,
          updatedAt: sr.lastAttemptAt || sr.lastVerifiedAt || "",
          errorMessage: sr.lastAttemptStatus === "FAILED" ? sr.lastErrorMessage : null,
        };
      }
    }
  } catch {}

  return {
    mergedJson: JSON.stringify(merged),
    historyCorrupted: 0,
    historyCorruptedReason: null,
  };
}

export const spckUploadRepo = {
  upsert(record: SpckUploadRecord) {
    const db = getDb();
    const existing = db
      .prepare(
        `SELECT localFolderPath, isConfirmedByTeacher, projectTitle, baseProjectTitle, thumbnailPath, screenshotsJson, attachmentsJson, youtubeUrlsJson, relatedLinksJson, teacherComment, contentHash, status, verifiedAt, draftSeq, sessionResultsJson, hasLegacyUnknownSessionHistory, legacyHistoryMetaJson, historyCorrupted, historyCorruptedReason, approvedSessionNumber FROM spck_uploads WHERE classId = ? AND studentId = ?`
      )
      .get(record.classId, record.studentId) as
      | {
          localFolderPath: string;
          isConfirmedByTeacher: number;
          projectTitle: string;
          baseProjectTitle?: string;
          thumbnailPath: string;
          screenshotsJson: string;
          attachmentsJson: string;
          youtubeUrlsJson: string;
          relatedLinksJson: string;
          teacherComment: string;
          contentHash: string;
          status: string;
          verifiedAt: string | null;
          draftSeq?: number;
          sessionResultsJson?: string;
          hasLegacyUnknownSessionHistory?: number;
          legacyHistoryMetaJson?: string;
          historyCorrupted?: number;
          historyCorruptedReason?: string | null;
          approvedSessionNumber?: number | null;
        }
      | undefined;

    let targetStatus = record.status || "DRAFT";
    let targetHash = record.contentHash ?? "";
    let targetVerifiedAt = record.verifiedAt ?? null;
    let targetApprovedSessionNumber =
      record.approvedSessionNumber !== undefined
        ? record.approvedSessionNumber
        : existing?.approvedSessionNumber ?? null;

    if (existing && (existing.status === "APPROVED" || existing.status === "VERIFIED")) {
      const folderChanged =
        normalizeSpckFolderKey(record.localFolderPath) !==
        normalizeSpckFolderKey(existing.localFolderPath);
      const confirmedChanged =
        (record.isConfirmedByTeacher ?? 0) !== (existing.isConfirmedByTeacher ?? 0);
      const titleChanged = (record.projectTitle ?? "") !== (existing.projectTitle ?? "");
      const thumbChanged = (record.thumbnailPath ?? "") !== (existing.thumbnailPath ?? "");
      const screenshotsChanged =
        (record.screenshotsJson ?? "[]") !== (existing.screenshotsJson ?? "[]");
      const attachmentsChanged =
        (record.attachmentsJson ?? "[]") !== (existing.attachmentsJson ?? "[]");
      const youtubeChanged =
        (record.youtubeUrlsJson ?? "[]") !== (existing.youtubeUrlsJson ?? "[]");
      const linksChanged =
        (record.relatedLinksJson ?? "[]") !== (existing.relatedLinksJson ?? "[]");
      const commentChanged = (record.teacherComment ?? "") !== (existing.teacherComment ?? "");

      const anyChanged =
        folderChanged ||
        confirmedChanged ||
        titleChanged ||
        thumbChanged ||
        screenshotsChanged ||
        attachmentsChanged ||
        youtubeChanged ||
        linksChanged ||
        commentChanged;

      const compositeHash = computeSpckContentHash(record);
      if (anyChanged && (record.contentHash !== compositeHash || record.contentHash === existing.contentHash)) {
        targetStatus = "WAITING_APPROVAL";
        targetHash = "";
        targetVerifiedAt = null;
        targetApprovedSessionNumber = null;
      }
    }

    if (targetStatus === "APPROVED" || targetStatus === "VERIFIED") {
      const compositeHash = computeSpckContentHash(record);
      if (Number(record.isConfirmedByTeacher) !== 1 || targetHash !== compositeHash) {
        targetStatus = "WAITING_APPROVAL";
        targetHash = "";
        targetVerifiedAt = null;
        targetApprovedSessionNumber = null;
      }
    }

    const nextDraftSeq =
      typeof record.draftSeq === "number" && Number.isFinite(record.draftSeq)
        ? Math.max(record.draftSeq, existing?.draftSeq ?? 0)
        : existing?.draftSeq ?? 0;

    // Merge sessionResultsJson so a slow background job holding stale `existing.sessionResultsJson = "{}"`
    // NEVER erases newly verified/failed session results!
    const mergedHistory = mergeSessionResultsPreservingHistory(
      existing?.sessionResultsJson,
      record.sessionResultsJson,
      record.classId,
      record.studentId,
      db
    );
    const nextSessionResultsJson = mergedHistory.mergedJson;

    const nextHistoryCorrupted =
      record.historyCorrupted !== undefined
        ? record.historyCorrupted
        : existing?.historyCorrupted || mergedHistory.historyCorrupted || 0;
    const nextHistoryCorruptedReason =
      record.historyCorruptedReason !== undefined
        ? record.historyCorruptedReason
        : existing?.historyCorruptedReason || mergedHistory.historyCorruptedReason || null;

    // Detect legacy unknown-session VERIFIED record and preserve flag across edits & Session 14 submissions (T08)
    let nextHasLegacyUnknown =
      record.hasLegacyUnknownSessionHistory !== undefined
        ? record.hasLegacyUnknownSessionHistory
        : existing?.hasLegacyUnknownSessionHistory ?? 0;
    let nextLegacyMetaJson =
      record.legacyHistoryMetaJson && record.legacyHistoryMetaJson !== "{}"
        ? record.legacyHistoryMetaJson
        : existing?.legacyHistoryMetaJson ?? "{}";

    if (
      !nextHasLegacyUnknown &&
      nextHistoryCorrupted === 0 &&
      (targetStatus === "VERIFIED" || (targetVerifiedAt && String(targetVerifiedAt).trim() !== "")) &&
      Object.keys(parseSpckSessionResults(nextSessionResultsJson)).length === 0
    ) {
      nextHasLegacyUnknown = 1;
      if (!nextLegacyMetaJson || nextLegacyMetaJson === "{}") {
        nextLegacyMetaJson = JSON.stringify({
          legacyVerifiedAt: targetVerifiedAt || new Date().toISOString(),
          legacyContentHash: targetHash || "",
          missingSnapshot: true,
          note: "Thiếu bản lưu nội dung cũ (bản ghi từ phiên bản trước không ghi nhận cụ thể buổi 12, 13 hay 14).",
        });
      }
    }

    const computedBaseTitle =
      stripSpckSessionSuffix(record.baseProjectTitle || record.projectTitle || "") ||
      stripSpckSessionSuffix(existing?.baseProjectTitle || existing?.projectTitle || "");

    const stmt = db.prepare(`
      INSERT INTO spck_uploads (
        classId, studentId, localFolderPath, matchScore, isConfirmedByTeacher,
        projectTitle, baseProjectTitle, thumbnailPath, screenshotsJson, attachmentsJson,
        youtubeUrlsJson, relatedLinksJson, teacherComment, contentHash,
        status, verifiedAt, errorMessage, draftSeq, sessionResultsJson,
        hasLegacyUnknownSessionHistory, legacyHistoryMetaJson,
        historyCorrupted, historyCorruptedReason, approvedSessionNumber, updatedAt
      )
      VALUES (
        @classId, @studentId, @localFolderPath, @matchScore, @isConfirmedByTeacher,
        @projectTitle, @baseProjectTitle, @thumbnailPath, @screenshotsJson, @attachmentsJson,
        @youtubeUrlsJson, @relatedLinksJson, @teacherComment, @contentHash,
        @status, @verifiedAt, @errorMessage, @draftSeq, @sessionResultsJson,
        @hasLegacyUnknownSessionHistory, @legacyHistoryMetaJson,
        @historyCorrupted, @historyCorruptedReason, @approvedSessionNumber, datetime('now', 'localtime')
      )
      ON CONFLICT(classId, studentId) DO UPDATE SET
        localFolderPath = excluded.localFolderPath,
        matchScore = excluded.matchScore,
        isConfirmedByTeacher = excluded.isConfirmedByTeacher,
        projectTitle = excluded.projectTitle,
        baseProjectTitle = excluded.baseProjectTitle,
        thumbnailPath = excluded.thumbnailPath,
        screenshotsJson = excluded.screenshotsJson,
        attachmentsJson = excluded.attachmentsJson,
        youtubeUrlsJson = excluded.youtubeUrlsJson,
        relatedLinksJson = excluded.relatedLinksJson,
        teacherComment = excluded.teacherComment,
        contentHash = excluded.contentHash,
        status = excluded.status,
        verifiedAt = excluded.verifiedAt,
        errorMessage = excluded.errorMessage,
        draftSeq = excluded.draftSeq,
        sessionResultsJson = excluded.sessionResultsJson,
        hasLegacyUnknownSessionHistory = excluded.hasLegacyUnknownSessionHistory,
        legacyHistoryMetaJson = excluded.legacyHistoryMetaJson,
        historyCorrupted = excluded.historyCorrupted,
        historyCorruptedReason = excluded.historyCorruptedReason,
        approvedSessionNumber = excluded.approvedSessionNumber,
        updatedAt = datetime('now', 'localtime')
    `);
    const res = stmt.run({
      classId: record.classId,
      studentId: record.studentId,
      localFolderPath: record.localFolderPath ?? "",
      matchScore: record.matchScore ?? 0.0,
      isConfirmedByTeacher: record.isConfirmedByTeacher ?? 0,
      projectTitle: record.projectTitle ?? "",
      baseProjectTitle: computedBaseTitle,
      thumbnailPath: record.thumbnailPath ?? "",
      screenshotsJson: record.screenshotsJson ?? "[]",
      attachmentsJson: record.attachmentsJson ?? "[]",
      youtubeUrlsJson: record.youtubeUrlsJson ?? "[]",
      relatedLinksJson: record.relatedLinksJson ?? "[]",
      teacherComment: record.teacherComment ?? "",
      contentHash: targetHash,
      status: targetStatus,
      verifiedAt: targetVerifiedAt,
      errorMessage: record.errorMessage ?? null,
      draftSeq: nextDraftSeq,
      sessionResultsJson: nextSessionResultsJson,
      hasLegacyUnknownSessionHistory: nextHasLegacyUnknown,
      legacyHistoryMetaJson: nextLegacyMetaJson,
      historyCorrupted: nextHistoryCorrupted,
      historyCorruptedReason: nextHistoryCorruptedReason,
      approvedSessionNumber: targetApprovedSessionNumber,
    });

    return res;
  },

  /**
   * Safe shared-resource updater for background tools (capture-screenshots, upload-drive, deploy-web, student-portal, scan).
   * Updates only shared resource columns in spck_uploads, verifies folder binding (T16), and NEVER overwrites
   * session submission history or edited session comments/titles (T01, T07).
   */
  updateSharedResources(
    paramsOrClassId:
      | string
      | {
          classId: string;
          studentId: string;
          expectedFolderPath?: string;
          localFolderPath?: string;
          matchScore?: number;
          isConfirmedByTeacher?: number;
          baseProjectTitle?: string;
          thumbnailPath?: string;
          screenshotsJson?: string;
          attachmentsJson?: string;
          youtubeUrlsJson?: string;
          relatedLinksJson?: string;
          syncSessionNumber?: SpckSessionSlotNumber;
        },
    studentIdArg?: string,
    patchArg?: {
      localFolderPath?: string;
      matchScore?: number;
      isConfirmedByTeacher?: number;
      baseProjectTitle?: string;
      thumbnailPath?: string;
      screenshotsJson?: string;
      attachmentsJson?: string;
      youtubeUrlsJson?: string;
      relatedLinksJson?: string;
      syncSessionNumber?: SpckSessionSlotNumber;
    },
    expectedFolderPathArg?: string
  ): { updated: boolean; reason?: string; record?: SpckUploadRecord } {
    const params =
      typeof paramsOrClassId === "string"
        ? {
            classId: paramsOrClassId,
            studentId: String(studentIdArg || ""),
            expectedFolderPath: expectedFolderPathArg,
            ...(patchArg || {}),
          }
        : paramsOrClassId;
    const existing = this.findOne(params.classId, params.studentId);
    if (!existing) {
      return { updated: false, reason: "Không tìm thấy bản ghi SPCK của học viên." };
    }
    if (
      params.expectedFolderPath !== undefined &&
      normalizeSpckFolderKey(params.expectedFolderPath) !==
        normalizeSpckFolderKey(existing.localFolderPath)
    ) {
      return {
        updated: false,
        reason: "Thư mục dự án của học viên đã thay đổi trong lúc tác vụ nền đang chạy (chặn ghi đè chéo học viên).",
      };
    }

    const nextThumb = params.thumbnailPath !== undefined ? params.thumbnailPath : existing.thumbnailPath;
    const nextScreens = params.screenshotsJson !== undefined ? params.screenshotsJson : existing.screenshotsJson;
    const nextAttach = params.attachmentsJson !== undefined ? params.attachmentsJson : existing.attachmentsJson;
    const nextYt = params.youtubeUrlsJson !== undefined ? params.youtubeUrlsJson : existing.youtubeUrlsJson;
    const nextLinks = params.relatedLinksJson !== undefined ? params.relatedLinksJson : existing.relatedLinksJson;
    const nextFolder = params.localFolderPath !== undefined ? params.localFolderPath : existing.localFolderPath;
    const nextConfirmed =
      params.isConfirmedByTeacher !== undefined ? params.isConfirmedByTeacher : existing.isConfirmedByTeacher;
    const nextBaseTitle =
      params.baseProjectTitle !== undefined
        ? stripSpckSessionSuffix(params.baseProjectTitle)
        : existing.baseProjectTitle || stripSpckSessionSuffix(existing.projectTitle);
    const nextMatchScore = params.matchScore !== undefined ? params.matchScore : existing.matchScore;

    const db = getDb();
    const sessionRowsMap = spckSessionRepo.findByStudent(params.classId, params.studentId);
    const hasAnyApprovedSessionRow = Object.values(sessionRowsMap).some(
      (r) => r && (r.draftStatus === "APPROVED" || r.draftStatus === "VERIFIED")
    );

    if (hasAnyApprovedSessionRow) {
      // Update only shared resource pool columns so existing per-session approvals remain untouched until teacher explicitly clicks "Dùng tài nguyên mới nhất"
      db.prepare(
        `UPDATE spck_uploads
         SET localFolderPath = ?,
             matchScore = ?,
             isConfirmedByTeacher = ?,
             baseProjectTitle = ?,
             thumbnailPath = ?,
             screenshotsJson = ?,
             attachmentsJson = ?,
             youtubeUrlsJson = ?,
             relatedLinksJson = ?,
             draftSeq = COALESCE(draftSeq, 0) + 1,
             updatedAt = datetime('now', 'localtime')
         WHERE classId = ? AND studentId = ?`
      ).run(
        nextFolder ?? "",
        nextMatchScore ?? 0.0,
        nextConfirmed ?? 0,
        nextBaseTitle ?? "",
        nextThumb ?? "",
        nextScreens ?? "[]",
        nextAttach ?? "[]",
        nextYt ?? "[]",
        nextLinks ?? "[]",
        params.classId,
        params.studentId
      );
    } else {
      this.upsert({
        ...existing,
        localFolderPath: nextFolder,
        matchScore: nextMatchScore,
        isConfirmedByTeacher: nextConfirmed,
        baseProjectTitle: nextBaseTitle,
        thumbnailPath: nextThumb,
        screenshotsJson: nextScreens,
        attachmentsJson: nextAttach,
        youtubeUrlsJson: nextYt,
        relatedLinksJson: nextLinks,
      });
    }

    if (params.syncSessionNumber && isValidSpckSessionSlot(params.syncSessionNumber)) {
      for (const slotNum of [12, 13, 14] as const) {
        const sessRow = spckSessionRepo.findOne(
          params.classId,
          params.studentId,
          slotNum
        );
        if (!sessRow || sessRow.lastVerifiedAt || sessRow.draftStatus === "APPROVED") {
          continue;
        }
        const isTargetSlot = slotNum === params.syncSessionNumber;
        const hasMissingThumbOnDisk =
          Boolean(sessRow.thumbnailPath) && !fs.existsSync(sessRow.thumbnailPath);
        if (isTargetSlot || hasMissingThumbOnDisk) {
          spckSessionRepo.syncLatestSharedResourcesToSessionDraft(
            params.classId,
            params.studentId,
            slotNum
          );
        }
      }
    }

    return {
      updated: true,
      record: this.findOne(params.classId, params.studentId),
    };
  },

  deleteOne(classId: string, studentId: string) {
    const db = getDb();
    db.prepare(`DELETE FROM spck_session_submissions WHERE classId = ? AND studentId = ?`).run(
      classId,
      studentId
    );
    return db
      .prepare(`DELETE FROM spck_uploads WHERE classId = ? AND studentId = ?`)
      .run(classId, studentId);
  },

  findByClass(classId: string): SpckUploadRecord[] {
    const db = getDb();
    return db
      .prepare(`SELECT * FROM spck_uploads WHERE classId = ? ORDER BY studentId ASC`)
      .all(classId) as SpckUploadRecord[];
  },

  findOne(classId: string, studentId: string): SpckUploadRecord | undefined {
    const db = getDb();
    return db
      .prepare(`SELECT * FROM spck_uploads WHERE classId = ? AND studentId = ?`)
      .get(classId, studentId) as SpckUploadRecord | undefined;
  },

  markVerified(
    classId: string,
    studentId: string,
    expectedContentHash?: string,
    sessionNumber?: number,
    lmsWorkId?: string | null
  ) {
    const db = getDb();
    const current = db
      .prepare(`SELECT * FROM spck_uploads WHERE classId = ? AND studentId = ?`)
      .get(classId, studentId) as SpckUploadRecord | undefined;

    const slot =
      sessionNumber !== undefined && isValidSpckSessionSlot(sessionNumber)
        ? (Number(sessionNumber) as SpckSessionSlotNumber)
        : undefined;
    const sessRow = slot ? spckSessionRepo.findOne(classId, studentId, slot) : undefined;

    const isSessionRowValid =
      Boolean(
        slot &&
          sessRow &&
          (sessRow.draftStatus === "APPROVED" ||
            sessRow.draftStatus === "SAVING" ||
            sessRow.draftStatus === "FAILED") &&
          verifySpckSessionIntegrity(sessRow, slot) &&
          (expectedContentHash === undefined ||
            sessRow.approvedContentHash === expectedContentHash ||
            computeSpckContentHash(sessRow) === expectedContentHash)
      );

    const isLegacyCurrentValid =
      Boolean(
        current &&
          (current.status === "APPROVED" ||
            current.status === "SAVING" ||
            current.status === "FAILED") &&
          verifySpckContentIntegrity(current) &&
          (expectedContentHash === undefined || current.contentHash === expectedContentHash)
      );

    if (!current || (!isSessionRowValid && !isLegacyCurrentValid)) {
      return { changes: 0, lastInsertRowid: 0 };
    }

    const nowRow = db
      .prepare(`SELECT datetime('now', 'localtime') AS nowStr`)
      .get() as { nowStr: string };
    const nowStr = nowRow?.nowStr || new Date().toISOString();

    const verifiedHash =
      expectedContentHash ||
      (isSessionRowValid ? sessRow!.approvedContentHash : current.contentHash) ||
      "";

    let nextSessionResultsJson = current.sessionResultsJson || "{}";
    if (slot) {
      const sessKey = String(slot) as "12" | "13" | "14";
      const parsedMap = parseSpckSessionResults(current.sessionResultsJson);
      parsedMap[sessKey] = {
        sessionNumber: slot,
        status: "VERIFIED",
        submittedContentHash: verifiedHash,
        verifiedAt: nowStr,
        lastVerifiedContentHash: verifiedHash,
        lastVerifiedAt: nowStr,
        lmsWorkId: lmsWorkId ?? null,
        updatedAt: nowStr,
        errorMessage: null,
      };
      nextSessionResultsJson = JSON.stringify(parsedMap);

      const sourceUploadForSnapshot: SpckUploadRecord = isSessionRowValid
        ? {
            ...current,
            localFolderPath: sessRow!.localFolderPath || current.localFolderPath,
            isConfirmedByTeacher:
              sessRow!.isConfirmedByTeacher ?? current.isConfirmedByTeacher,
            projectTitle: sessRow!.projectTitle || current.projectTitle,
            thumbnailPath: sessRow!.thumbnailPath || current.thumbnailPath,
            screenshotsJson: sessRow!.screenshotsJson || current.screenshotsJson,
            attachmentsJson: sessRow!.attachmentsJson || current.attachmentsJson,
            youtubeUrlsJson: sessRow!.youtubeUrlsJson || current.youtubeUrlsJson,
            relatedLinksJson: sessRow!.relatedLinksJson || current.relatedLinksJson,
            teacherComment: sessRow!.teacherComment || current.teacherComment,
            contentHash: verifiedHash,
          }
        : current;

      spckSessionRepo.markSessionVerifiedFromUpload(
        classId,
        studentId,
        slot,
        sourceUploadForSnapshot,
        nowStr,
        lmsWorkId ?? null
      );
    }

    if (isLegacyCurrentValid || !slot || current.approvedSessionNumber === slot) {
      return db
        .prepare(`
          UPDATE spck_uploads
          SET status = 'VERIFIED',
              verifiedAt = ?,
              errorMessage = NULL,
              sessionResultsJson = ?,
              updatedAt = ?
          WHERE classId = ? AND studentId = ?
        `)
        .run(nowStr, nextSessionResultsJson, nowStr, classId, studentId);
    }

    return db
      .prepare(`
        UPDATE spck_uploads
        SET sessionResultsJson = ?,
            updatedAt = ?
        WHERE classId = ? AND studentId = ?
      `)
      .run(nextSessionResultsJson, nowStr, classId, studentId);
  },

  recordSessionFailure(
    classId: string,
    studentId: string,
    sessionNumber: number | undefined,
    attemptedContentHash: string,
    errorMessage: string
  ) {
    const db = getDb();
    const current = db
      .prepare(`SELECT * FROM spck_uploads WHERE classId = ? AND studentId = ?`)
      .get(classId, studentId) as SpckUploadRecord | undefined;

    const slot =
      sessionNumber !== undefined && isValidSpckSessionSlot(sessionNumber)
        ? (Number(sessionNumber) as SpckSessionSlotNumber)
        : undefined;
    const sessRow = slot ? spckSessionRepo.findOne(classId, studentId, slot) : undefined;
    const isSessionMatch = Boolean(
      slot && sessRow && sessRow.approvedContentHash === attemptedContentHash
    );
    const isCurrentMatch = Boolean(current && current.contentHash === attemptedContentHash);

    if (!current || (!isSessionMatch && !isCurrentMatch)) {
      return { changes: 0, lastInsertRowid: 0 };
    }

    const nowRow = db
      .prepare(`SELECT datetime('now', 'localtime') AS nowStr`)
      .get() as { nowStr: string };
    const nowStr = nowRow?.nowStr || new Date().toISOString();

    let nextSessionResultsJson = current.sessionResultsJson || "{}";
    if (slot) {
      const sessKey = String(slot) as "12" | "13" | "14";
      const parsedMap = parseSpckSessionResults(current.sessionResultsJson);
      const prev = parsedMap[sessKey];
      parsedMap[sessKey] = {
        sessionNumber: slot,
        status: "FAILED",
        submittedContentHash: attemptedContentHash,
        verifiedAt: prev?.status === "VERIFIED" ? prev.verifiedAt : prev?.lastVerifiedAt ?? null,
        lastVerifiedContentHash:
          prev?.status === "VERIFIED"
            ? prev.submittedContentHash
            : prev?.lastVerifiedContentHash ?? null,
        lastVerifiedAt:
          prev?.status === "VERIFIED" ? prev.verifiedAt : prev?.lastVerifiedAt ?? null,
        lmsWorkId: prev?.lmsWorkId ?? null,
        updatedAt: nowStr,
        errorMessage,
      };
      nextSessionResultsJson = JSON.stringify(parsedMap);

      spckSessionRepo.recordSessionFailedFromUpload(
        classId,
        studentId,
        slot,
        attemptedContentHash,
        errorMessage,
        nowStr
      );
    }

    if (isCurrentMatch || !slot || current.approvedSessionNumber === slot) {
      return db
        .prepare(`
          UPDATE spck_uploads
          SET status = 'FAILED',
              errorMessage = ?,
              sessionResultsJson = ?,
              updatedAt = ?
          WHERE classId = ? AND studentId = ?
        `)
        .run(errorMessage, nextSessionResultsJson, nowStr, classId, studentId);
    }

    return db
      .prepare(`
        UPDATE spck_uploads
        SET sessionResultsJson = ?,
            updatedAt = ?
        WHERE classId = ? AND studentId = ?
      `)
      .run(nextSessionResultsJson, nowStr, classId, studentId);
  },
};

export interface SpckSessionHistoryCellSummary {
  sessionNumber: SpckSessionSlotNumber;
  stageNumber: SpckStageNumber;
  stageCode: SpckStageCode;
  displayState:
    | "VERIFIED"
    | "VERIFIED_WITH_UNSUBMITTED_EDITS"
    | "VERIFIED_FILE_DRIFT"
    | "FAILED_AFTER_VERIFIED"
    | "FAILED"
    | "UNKNOWN_LEGACY"
    | "CORRUPTED"
    | "NOT_SUBMITTED";
  badgeLabel: string;
  draftStatus: SpckSessionSubmissionRecord["draftStatus"];
  draftVersion: number;
  isDraftInitialized: boolean;
  hasUnsubmittedChanges: boolean;
  hasNewerSharedResources: boolean;
  hasFileDriftAfterVerified: boolean;
  driftedFiles: string[];
  lastAttemptStatus: "VERIFIED" | "FAILED" | null;
  lastAttemptAt: string | null;
  lastErrorMessage: string | null;
  lastVerifiedHash: string | null;
  lastVerifiedAt: string | null;
  lastVerifiedLmsWorkId: string | null;
  lastVerifiedSnapshot: SpckSubmissionSnapshot | null;
  missingLegacySnapshot: boolean;
}

export const spckSessionRepo = {
  findOne(
    classId: string,
    studentId: string,
    rawSessionNumber: unknown
  ): SpckSessionSubmissionRecord | undefined {
    const sessionNumber = parseSpckSessionSlotStrict(rawSessionNumber, "spckSessionRepo.findOne");
    const db = getDb();
    return db
      .prepare(
        `SELECT * FROM spck_session_submissions WHERE classId = ? AND studentId = ? AND sessionNumber = ?`
      )
      .get(classId, studentId, sessionNumber) as SpckSessionSubmissionRecord | undefined;
  },

  findByStudent(
    classId: string,
    studentId: string
  ): Partial<Record<"12" | "13" | "14", SpckSessionSubmissionRecord>> {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM spck_session_submissions WHERE classId = ? AND studentId = ? ORDER BY sessionNumber ASC`
      )
      .all(classId, studentId) as SpckSessionSubmissionRecord[];
    const map: Partial<Record<"12" | "13" | "14", SpckSessionSubmissionRecord>> = {};
    for (const r of rows) {
      if (r.sessionNumber === 12 || r.sessionNumber === 13 || r.sessionNumber === 14) {
        map[String(r.sessionNumber) as "12" | "13" | "14"] = r;
      }
    }
    return map;
  },

  getOrInitSessionDraft(
    classId: string,
    studentId: string,
    rawSessionNumber: unknown,
    fallbackStudentName?: string | null
  ): SpckSessionSubmissionRecord {
    const stageInfo = getSpckStageInfo(rawSessionNumber, "spckSessionRepo.getOrInitSessionDraft");
    const existing = this.findOne(classId, studentId, stageInfo.sessionNumber);
    if (existing) {
      return existing;
    }

    const db = getDb();
    const shared = spckUploadRepo.findOne(classId, studentId);
    const student =
      fallbackStudentName ||
      (
        db
          .prepare(`SELECT fullName FROM students WHERE classId = ? AND studentId = ?`)
          .get(classId, studentId) as { fullName?: string } | undefined
      )?.fullName ||
      "";

    const baseTitle = stripSpckSessionSuffix(shared?.baseProjectTitle || shared?.projectTitle || "");
    const formattedTitle = formatSpckSessionTitle(
      baseTitle,
      stageInfo.sessionNumber,
      student
    );

    // Check if there is a previous session (e.g., Session 12 when initializing Session 13, or Session 13/12 when initializing Session 14)
    // to inherit shared resources while keeping comment empty for the new session.
    const folderPath = shared?.localFolderPath || "";
    const isConfirmed = shared?.isConfirmedByTeacher ?? 0;
    const thumbPath = shared?.thumbnailPath || "";
    const screensJson = shared?.screenshotsJson || "[]";
    const attachJson = shared?.attachmentsJson || "[]";
    const ytJson = shared?.youtubeUrlsJson || "[]";
    const linksJson = shared?.relatedLinksJson || "[]";

    // Only reuse shared.teacherComment if no session rows exist at all and shared.teacherComment was already saved before v2.7.0
    const anyExistingSessions = Object.keys(this.findByStudent(classId, studentId)).length > 0;
    const initialComment = !anyExistingSessions && shared?.teacherComment ? shared.teacherComment : "";

    db.prepare(
      `INSERT INTO spck_session_submissions (
        classId, studentId, sessionNumber, stageNumber, localFolderPath,
        isConfirmedByTeacher, projectTitle, thumbnailPath, screenshotsJson,
        attachmentsJson, youtubeUrlsJson, relatedLinksJson, teacherComment,
        teacherNote, quickTagsJson, draftVersion, isDraftInitialized,
        draftStatus, approvedContentHash, approvedSnapshotJson, approvedAt,
        lastAttemptStatus, lastAttemptHash, lastAttemptAt, lastErrorMessage,
        lastVerifiedHash, lastVerifiedAt, lastVerifiedLmsWorkId,
        lastVerifiedSnapshotJson, missingLegacySnapshot, updatedAt
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        '', '[]', 1, 1,
        ?, '', '{}', NULL,
        NULL, '', NULL, NULL,
        '', NULL, NULL,
        '{}', 0, datetime('now', 'localtime')
      )
      ON CONFLICT(classId, studentId, sessionNumber) DO NOTHING`
    ).run(
      classId,
      studentId,
      stageInfo.sessionNumber,
      stageInfo.stageNumber,
      folderPath,
      isConfirmed,
      formattedTitle,
      thumbPath,
      screensJson,
      attachJson,
      ytJson,
      linksJson,
      initialComment,
      initialComment ? "WAITING_APPROVAL" : "DRAFT"
    );

    return this.findOne(classId, studentId, stageInfo.sessionNumber)!;
  },

  hasNewerSharedResources(
    shared: SpckUploadRecord | undefined,
    sessionRow: SpckSessionSubmissionRecord | undefined
  ): boolean {
    if (!shared || !sessionRow) return false;
    if (
      normalizeSpckFolderKey(shared.localFolderPath) !==
      normalizeSpckFolderKey(sessionRow.localFolderPath)
    ) {
      return Boolean(shared.localFolderPath && shared.localFolderPath.trim());
    }
    if ((shared.thumbnailPath || "") !== (sessionRow.thumbnailPath || "")) return true;
    if ((shared.screenshotsJson || "[]") !== (sessionRow.screenshotsJson || "[]")) return true;
    if ((shared.attachmentsJson || "[]") !== (sessionRow.attachmentsJson || "[]")) return true;
    if ((shared.youtubeUrlsJson || "[]") !== (sessionRow.youtubeUrlsJson || "[]")) return true;
    if ((shared.relatedLinksJson || "[]") !== (sessionRow.relatedLinksJson || "[]")) return true;
    return false;
  },

  syncLatestSharedResourcesToSessionDraft(
    classId: string,
    studentId: string,
    rawSessionNumber: unknown,
    expectedVersion?: number
  ): {
    success: boolean;
    conflict?: boolean;
    currentVersion?: number;
    record: SpckSessionSubmissionRecord;
  } {
    const stageInfo = getSpckStageInfo(
      rawSessionNumber,
      "spckSessionRepo.syncLatestSharedResourcesToSessionDraft"
    );
    const current = this.getOrInitSessionDraft(classId, studentId, stageInfo.sessionNumber);
    if (
      expectedVersion !== undefined &&
      Number.isFinite(expectedVersion) &&
      Number(expectedVersion) !== current.draftVersion
    ) {
      return {
        success: false,
        conflict: true,
        currentVersion: current.draftVersion,
        record: current,
      };
    }

    const shared = spckUploadRepo.findOne(classId, studentId);
    if (!shared) {
      return { success: true, record: current };
    }

    const baseTitle =
      stripSpckSessionSuffix(current.projectTitle) ||
      stripSpckSessionSuffix(shared.baseProjectTitle || shared.projectTitle);
    const nextTitle = formatSpckSessionTitle(baseTitle, stageInfo.sessionNumber);

    return this.saveSessionDraft({
      classId,
      studentId,
      sessionNumber: stageInfo.sessionNumber,
      localFolderPath: shared.localFolderPath ?? current.localFolderPath,
      isConfirmedByTeacher: shared.isConfirmedByTeacher ?? current.isConfirmedByTeacher,
      projectTitle: nextTitle,
      thumbnailPath: shared.thumbnailPath ?? current.thumbnailPath,
      screenshotsJson: shared.screenshotsJson ?? current.screenshotsJson,
      attachmentsJson: shared.attachmentsJson ?? current.attachmentsJson,
      youtubeUrlsJson: shared.youtubeUrlsJson ?? current.youtubeUrlsJson,
      relatedLinksJson: shared.relatedLinksJson ?? current.relatedLinksJson,
      teacherComment: current.teacherComment,
      teacherNote: current.teacherNote,
      quickTagsJson: current.quickTagsJson,
      updateSharedPool: false,
    });
  },

  saveSessionDraft(params: {
    classId: string;
    studentId: string;
    sessionNumber: unknown;
    expectedVersion?: number;
    localFolderPath?: string;
    isConfirmedByTeacher?: number;
    projectTitle?: string;
    thumbnailPath?: string;
    screenshotsJson?: string;
    attachmentsJson?: string;
    youtubeUrlsJson?: string;
    relatedLinksJson?: string;
    teacherComment?: string;
    teacherNote?: string;
    quickTagsJson?: string;
    draftStatus?: SpckSessionSubmissionRecord["draftStatus"];
    updateSharedPool?: boolean;
  }): {
    success: boolean;
    conflict?: boolean;
    currentVersion?: number;
    record: SpckSessionSubmissionRecord;
  } {
    const stageInfo = getSpckStageInfo(params.sessionNumber, "spckSessionRepo.saveSessionDraft");
    const db = getDb();
    const current = this.getOrInitSessionDraft(
      params.classId,
      params.studentId,
      stageInfo.sessionNumber
    );

    if (
      params.expectedVersion !== undefined &&
      Number.isFinite(params.expectedVersion) &&
      Number(params.expectedVersion) !== current.draftVersion
    ) {
      return {
        success: false,
        conflict: true,
        currentVersion: current.draftVersion,
        record: current,
      };
    }

    const nextFolder =
      params.localFolderPath !== undefined ? params.localFolderPath : current.localFolderPath;
    const nextConfirmed =
      params.isConfirmedByTeacher !== undefined
        ? params.isConfirmedByTeacher
        : current.isConfirmedByTeacher;

    const studentRow = db
      .prepare(`SELECT fullName FROM students WHERE classId = ? AND studentId = ?`)
      .get(params.classId, params.studentId) as { fullName?: string } | undefined;

    const rawTitleInput =
      params.projectTitle !== undefined ? params.projectTitle : current.projectTitle;
    const nextTitle = formatSpckSessionTitle(
      rawTitleInput,
      stageInfo.sessionNumber,
      studentRow?.fullName
    );
    const nextBaseTitle = stripSpckSessionSuffix(nextTitle);

    const nextThumb =
      params.thumbnailPath !== undefined ? params.thumbnailPath : current.thumbnailPath;
    const nextScreens =
      params.screenshotsJson !== undefined ? params.screenshotsJson : current.screenshotsJson;
    const nextAttach =
      params.attachmentsJson !== undefined ? params.attachmentsJson : current.attachmentsJson;
    const nextYt =
      params.youtubeUrlsJson !== undefined ? params.youtubeUrlsJson : current.youtubeUrlsJson;
    const nextLinks =
      params.relatedLinksJson !== undefined ? params.relatedLinksJson : current.relatedLinksJson;
    const nextComment =
      params.teacherComment !== undefined ? params.teacherComment : current.teacherComment;
    const nextNote =
      params.teacherNote !== undefined ? params.teacherNote : current.teacherNote;
    const nextTags =
      params.quickTagsJson !== undefined ? params.quickTagsJson : current.quickTagsJson;

    const candidateHash = computeSpckSessionContentHash(
      {
        classId: params.classId,
        studentId: params.studentId,
        localFolderPath: nextFolder,
        isConfirmedByTeacher: nextConfirmed,
        projectTitle: nextTitle,
        thumbnailPath: nextThumb,
        screenshotsJson: nextScreens,
        attachmentsJson: nextAttach,
        youtubeUrlsJson: nextYt,
        relatedLinksJson: nextLinks,
        teacherComment: nextComment,
      },
      stageInfo.sessionNumber
    );

    const contentChangedFromApproved =
      Boolean(current.approvedContentHash) && current.approvedContentHash !== candidateHash;
    const contentChangedFromCurrent =
      normalizeSpckFolderKey(nextFolder) !== normalizeSpckFolderKey(current.localFolderPath) ||
      nextConfirmed !== current.isConfirmedByTeacher ||
      nextTitle !== current.projectTitle ||
      nextThumb !== current.thumbnailPath ||
      nextScreens !== current.screenshotsJson ||
      nextAttach !== current.attachmentsJson ||
      nextYt !== current.youtubeUrlsJson ||
      nextLinks !== current.relatedLinksJson ||
      nextComment !== current.teacherComment ||
      nextNote !== current.teacherNote ||
      nextTags !== current.quickTagsJson;

    let nextDraftStatus = params.draftStatus || current.draftStatus || "WAITING_APPROVAL";
    let nextApprovedHash = current.approvedContentHash || "";
    let nextApprovedSnapshot = current.approvedSnapshotJson || "{}";
    let nextApprovedAt = current.approvedAt || null;

    if (contentChangedFromApproved || contentChangedFromCurrent) {
      if (nextApprovedHash && contentChangedFromApproved) {
        nextDraftStatus = "WAITING_APPROVAL";
        nextApprovedHash = "";
        nextApprovedSnapshot = "{}";
        nextApprovedAt = null;
      } else if (nextDraftStatus === "VERIFIED" || nextDraftStatus === "APPROVED") {
        nextDraftStatus = "WAITING_APPROVAL";
      } else if (nextDraftStatus === "DRAFT" && nextComment.trim()) {
        nextDraftStatus = "WAITING_APPROVAL";
      }
    }

    const nextVersion = contentChangedFromCurrent ? current.draftVersion + 1 : current.draftVersion;

    db.prepare(
      `UPDATE spck_session_submissions
       SET stageNumber = ?,
           localFolderPath = ?,
           isConfirmedByTeacher = ?,
           projectTitle = ?,
           thumbnailPath = ?,
           screenshotsJson = ?,
           attachmentsJson = ?,
           youtubeUrlsJson = ?,
           relatedLinksJson = ?,
           teacherComment = ?,
           teacherNote = ?,
           quickTagsJson = ?,
           draftVersion = ?,
           isDraftInitialized = 1,
           draftStatus = ?,
           approvedContentHash = ?,
           approvedSnapshotJson = ?,
           approvedAt = ?,
           updatedAt = datetime('now', 'localtime')
       WHERE classId = ? AND studentId = ? AND sessionNumber = ?`
    ).run(
      stageInfo.stageNumber,
      nextFolder,
      nextConfirmed,
      nextTitle,
      nextThumb,
      nextScreens,
      nextAttach,
      nextYt,
      nextLinks,
      nextComment,
      nextNote,
      nextTags,
      nextVersion,
      nextDraftStatus,
      nextApprovedHash,
      nextApprovedSnapshot,
      nextApprovedAt,
      params.classId,
      params.studentId,
      stageInfo.sessionNumber
    );

    if (params.updateSharedPool !== false) {
      const shared = spckUploadRepo.findOne(params.classId, params.studentId);
      const sharedThumb =
        params.thumbnailPath !== undefined
          ? nextThumb
          : shared?.thumbnailPath || nextThumb;
      const sharedScreens =
        params.screenshotsJson !== undefined
          ? nextScreens
          : shared?.screenshotsJson || nextScreens;
      const sharedAttach =
        params.attachmentsJson !== undefined
          ? nextAttach
          : shared?.attachmentsJson || nextAttach;
      const sharedYt =
        params.youtubeUrlsJson !== undefined
          ? nextYt
          : shared?.youtubeUrlsJson || nextYt;
      const sharedLinks =
        params.relatedLinksJson !== undefined
          ? nextLinks
          : shared?.relatedLinksJson || nextLinks;

      spckUploadRepo.upsert({
        classId: params.classId,
        studentId: params.studentId,
        localFolderPath: nextFolder,
        matchScore: shared?.matchScore ?? 1.0,
        isConfirmedByTeacher: nextConfirmed,
        projectTitle: nextTitle,
        baseProjectTitle: nextBaseTitle,
        thumbnailPath: sharedThumb,
        screenshotsJson: sharedScreens,
        attachmentsJson: sharedAttach,
        youtubeUrlsJson: sharedYt,
        relatedLinksJson: sharedLinks,
        teacherComment: nextComment,
        contentHash: nextApprovedHash
          ? computeSpckContentHash({
              classId: params.classId,
              studentId: params.studentId,
              localFolderPath: nextFolder,
              isConfirmedByTeacher: nextConfirmed,
              projectTitle: nextTitle,
              thumbnailPath: nextThumb,
              screenshotsJson: nextScreens,
              attachmentsJson: nextAttach,
              youtubeUrlsJson: nextYt,
              relatedLinksJson: nextLinks,
              teacherComment: nextComment,
            })
          : "",
        status: nextDraftStatus,
        draftSeq: (shared?.draftSeq ?? 0) + 1,
        approvedSessionNumber: nextApprovedHash ? stageInfo.sessionNumber : null,
      });
    }

    return {
      success: true,
      record: this.findOne(params.classId, params.studentId, stageInfo.sessionNumber)!,
    };
  },

  approveSessionDraft(
    classId: string,
    studentId: string,
    rawSessionNumber: unknown,
    expectedVersion?: number
  ): {
    success: boolean;
    conflict?: boolean;
    reason?: string;
    record: SpckSessionSubmissionRecord;
  } {
    const stageInfo = getSpckStageInfo(rawSessionNumber, "spckSessionRepo.approveSessionDraft");
    const db = getDb();
    const current = this.getOrInitSessionDraft(classId, studentId, stageInfo.sessionNumber);

    if (
      expectedVersion !== undefined &&
      Number.isFinite(expectedVersion) &&
      Number(expectedVersion) !== current.draftVersion
    ) {
      return {
        success: false,
        conflict: true,
        reason: `Phiên bản bản nháp đã thay đổi (expected=${expectedVersion}, actual=${current.draftVersion}).`,
        record: current,
      };
    }

    const formattedTitle = formatSpckSessionTitle(current.projectTitle, stageInfo.sessionNumber);
    const titleCheck = validateSpckTitleLength(formattedTitle, stageInfo.sessionNumber);
    if (!titleCheck.valid) {
      return {
        success: false,
        reason: titleCheck.reason || "Tiêu đề dự án không hợp lệ.",
        record: current,
      };
    }

    if (Number(current.isConfirmedByTeacher) !== 1) {
      return {
        success: false,
        reason: "Chưa xác nhận gán đúng học viên.",
        record: current,
      };
    }

    if (!String(current.thumbnailPath || "").trim()) {
      return {
        success: false,
        reason: "Thiếu ảnh đại diện sản phẩm (Thumbnail*).",
        record: current,
      };
    }

    if (!String(current.teacherComment || "").trim()) {
      return {
        success: false,
        reason: "Thiếu bình luận của giáo viên (Bình luận*).",
        record: current,
      };
    }

    const nowRow = db
      .prepare(`SELECT datetime('now', 'localtime') AS nowStr`)
      .get() as { nowStr: string };
    const nowStr = nowRow?.nowStr || new Date().toISOString();

    const updatedRecordForHash = {
      ...current,
      projectTitle: formattedTitle,
    };
    const approvedSessionHash = computeSpckSessionContentHash(
      updatedRecordForHash,
      stageInfo.sessionNumber
    );
    const snapshot = buildSpckSubmissionSnapshot(
      updatedRecordForHash,
      stageInfo.sessionNumber,
      approvedSessionHash,
      nowStr
    );

    db.prepare(
      `UPDATE spck_session_submissions
       SET projectTitle = ?,
           draftStatus = 'APPROVED',
           approvedContentHash = ?,
           approvedSnapshotJson = ?,
           approvedAt = ?,
           updatedAt = ?
       WHERE classId = ? AND studentId = ? AND sessionNumber = ?`
    ).run(
      formattedTitle,
      approvedSessionHash,
      JSON.stringify(snapshot),
      nowStr,
      nowStr,
      classId,
      studentId,
      stageInfo.sessionNumber
    );

    // Mirror active approved session onto spck_uploads for uploader & legacy compatibility
    const shared = spckUploadRepo.findOne(classId, studentId);
    const legacyHash = computeSpckContentHash({
      classId,
      studentId,
      localFolderPath: current.localFolderPath,
      isConfirmedByTeacher: current.isConfirmedByTeacher,
      projectTitle: formattedTitle,
      thumbnailPath: current.thumbnailPath,
      screenshotsJson: current.screenshotsJson,
      attachmentsJson: current.attachmentsJson,
      youtubeUrlsJson: current.youtubeUrlsJson,
      relatedLinksJson: current.relatedLinksJson,
      teacherComment: current.teacherComment,
    });
    spckUploadRepo.upsert({
      ...(shared || {
        classId,
        studentId,
        matchScore: 1.0,
      }),
      localFolderPath: current.localFolderPath,
      isConfirmedByTeacher: current.isConfirmedByTeacher,
      projectTitle: formattedTitle,
      baseProjectTitle: stripSpckSessionSuffix(formattedTitle),
      thumbnailPath: current.thumbnailPath,
      screenshotsJson: current.screenshotsJson,
      attachmentsJson: current.attachmentsJson,
      youtubeUrlsJson: current.youtubeUrlsJson,
      relatedLinksJson: current.relatedLinksJson,
      teacherComment: current.teacherComment,
      contentHash: legacyHash,
      status: "APPROVED",
      errorMessage: null,
      approvedSessionNumber: stageInfo.sessionNumber,
    });

    return {
      success: true,
      record: this.findOne(classId, studentId, stageInfo.sessionNumber)!,
    };
  },

  markSessionVerifiedFromUpload(
    classId: string,
    studentId: string,
    sessionNumber: SpckSessionSlotNumber,
    uploadRecord: SpckUploadRecord,
    nowStr: string,
    lmsWorkId?: string | null
  ) {
    const db = getDb();
    const current = this.getOrInitSessionDraft(classId, studentId, sessionNumber);
    const sourceRecord = {
      classId,
      studentId,
      localFolderPath: uploadRecord.localFolderPath || current.localFolderPath,
      isConfirmedByTeacher: uploadRecord.isConfirmedByTeacher ?? current.isConfirmedByTeacher,
      projectTitle: uploadRecord.projectTitle || current.projectTitle,
      thumbnailPath: uploadRecord.thumbnailPath || current.thumbnailPath,
      screenshotsJson: uploadRecord.screenshotsJson || current.screenshotsJson,
      attachmentsJson: uploadRecord.attachmentsJson || current.attachmentsJson,
      youtubeUrlsJson: uploadRecord.youtubeUrlsJson || current.youtubeUrlsJson,
      relatedLinksJson: uploadRecord.relatedLinksJson || current.relatedLinksJson,
      teacherComment: uploadRecord.teacherComment || current.teacherComment,
      teacherNote: current.teacherNote,
      quickTagsJson: current.quickTagsJson,
    };
    const sessionHash =
      uploadRecord.contentHash ||
      current.approvedContentHash ||
      computeSpckSessionContentHash(sourceRecord, sessionNumber);
    const snapshot = buildSpckSubmissionSnapshot(
      sourceRecord,
      sessionNumber,
      sessionHash,
      nowStr,
      lmsWorkId
    );

    db.prepare(
      `UPDATE spck_session_submissions
       SET projectTitle = ?,
           thumbnailPath = ?,
           screenshotsJson = ?,
           attachmentsJson = ?,
           youtubeUrlsJson = ?,
           relatedLinksJson = ?,
           teacherComment = ?,
           draftStatus = 'VERIFIED',
           approvedContentHash = ?,
           lastAttemptStatus = 'VERIFIED',
           lastAttemptHash = ?,
           lastAttemptAt = ?,
           lastErrorMessage = NULL,
           lastVerifiedHash = ?,
           lastVerifiedAt = ?,
           lastVerifiedLmsWorkId = ?,
           lastVerifiedSnapshotJson = ?,
           missingLegacySnapshot = 0,
           updatedAt = ?
       WHERE classId = ? AND studentId = ? AND sessionNumber = ?`
    ).run(
      sourceRecord.projectTitle,
      sourceRecord.thumbnailPath,
      sourceRecord.screenshotsJson,
      sourceRecord.attachmentsJson,
      sourceRecord.youtubeUrlsJson,
      sourceRecord.relatedLinksJson,
      sourceRecord.teacherComment,
      sessionHash,
      sessionHash,
      nowStr,
      sessionHash,
      nowStr,
      lmsWorkId ?? null,
      JSON.stringify(snapshot),
      nowStr,
      classId,
      studentId,
      sessionNumber
    );
  },

  recordSessionFailedFromUpload(
    classId: string,
    studentId: string,
    sessionNumber: SpckSessionSlotNumber,
    attemptedHash: string,
    errorMessage: string,
    nowStr: string
  ) {
    const db = getDb();
    const current = this.getOrInitSessionDraft(classId, studentId, sessionNumber);
    const sessionAttemptHash =
      current.approvedContentHash ||
      attemptedHash ||
      computeSpckSessionContentHash(current, sessionNumber);

    // Note: lastVerifiedHash, lastVerifiedAt, lastVerifiedLmsWorkId, lastVerifiedSnapshotJson, missingLegacySnapshot
    // are intentionally NOT overwritten so prior successful submission proof is preserved!
    db.prepare(
      `UPDATE spck_session_submissions
       SET draftStatus = 'FAILED',
           lastAttemptStatus = 'FAILED',
           lastAttemptHash = ?,
           lastAttemptAt = ?,
           lastErrorMessage = ?,
           updatedAt = ?
       WHERE classId = ? AND studentId = ? AND sessionNumber = ?`
    ).run(
      sessionAttemptHash,
      nowStr,
      errorMessage,
      nowStr,
      classId,
      studentId,
      sessionNumber
    );
  },

  clearSessionSubmissionHistory(
    classId: string,
    studentId: string,
    rawSessionNumber: unknown
  ) {
    const stageInfo = getSpckStageInfo(
      rawSessionNumber,
      "spckSessionRepo.clearSessionSubmissionHistory"
    );
    const db = getDb();
    db.prepare(
      `UPDATE spck_session_submissions
       SET draftStatus = 'WAITING_APPROVAL',
           approvedContentHash = '',
           approvedSnapshotJson = '{}',
           approvedAt = NULL,
           lastAttemptStatus = NULL,
           lastAttemptHash = '',
           lastAttemptAt = NULL,
           lastErrorMessage = NULL,
           lastVerifiedHash = '',
           lastVerifiedAt = NULL,
           lastVerifiedLmsWorkId = NULL,
           lastVerifiedSnapshotJson = '{}',
           missingLegacySnapshot = 0,
           updatedAt = datetime('now', 'localtime')
       WHERE classId = ? AND studentId = ? AND sessionNumber = ?`
    ).run(classId, studentId, stageInfo.sessionNumber);

    const shared = spckUploadRepo.findOne(classId, studentId);
    if (shared) {
      const sessionMap = parseSpckSessionResults(shared.sessionResultsJson);
      delete sessionMap[String(stageInfo.sessionNumber) as "12" | "13" | "14"];
      db.prepare(
        `UPDATE spck_uploads
         SET status = 'WAITING_APPROVAL',
             contentHash = '',
             verifiedAt = NULL,
             errorMessage = NULL,
             sessionResultsJson = ?,
             approvedSessionNumber = CASE WHEN approvedSessionNumber = ? THEN NULL ELSE approvedSessionNumber END,
             updatedAt = datetime('now', 'localtime')
         WHERE classId = ? AND studentId = ?`
      ).run(
        JSON.stringify(sessionMap),
        stageInfo.sessionNumber,
        classId,
        studentId
      );
    }
  },

  buildStudentSessionHistorySummary(
    classId: string,
    studentId: string
  ): {
    historyCorrupted: boolean;
    historyCorruptedReason: string | null;
    hasLegacyUnknownSessionHistory: boolean;
    legacyHistoryMeta: Record<string, any> | null;
    sessions: Record<"12" | "13" | "14", SpckSessionHistoryCellSummary>;
  } {
    const shared = spckUploadRepo.findOne(classId, studentId);
    const sessionRowsMap = this.findByStudent(classId, studentId);
    const legacyResultsMap = parseSpckSessionResults(shared?.sessionResultsJson);
    const rawInspection = inspectSpckSessionResultsRaw(shared?.sessionResultsJson);

    const historyCorrupted =
      Boolean(shared?.historyCorrupted) || !rawInspection.valid;
    const historyCorruptedReason =
      shared?.historyCorruptedReason || rawInspection.corruptedReason || null;

    const hasLegacyUnknownSessionHistory = Boolean(shared?.hasLegacyUnknownSessionHistory);
    let legacyHistoryMeta: Record<string, any> | null = null;
    if (shared?.legacyHistoryMetaJson && shared.legacyHistoryMetaJson !== "{}") {
      try {
        legacyHistoryMeta = JSON.parse(shared.legacyHistoryMetaJson);
      } catch {}
    }

    const sessions = {} as Record<"12" | "13" | "14", SpckSessionHistoryCellSummary>;

    for (const slot of [12, 13, 14] as const) {
      const key = String(slot) as "12" | "13" | "14";
      const stageInfo = getSpckStageInfo(slot);
      const sRow = sessionRowsMap[key];
      const legEntry = legacyResultsMap[key];

      const lastAttemptStatus = sRow?.lastAttemptStatus || legEntry?.status || null;
      const lastAttemptAt = sRow?.lastAttemptAt || legEntry?.updatedAt || null;
      const lastErrorMessage = sRow?.lastErrorMessage || legEntry?.errorMessage || null;
      const lastVerifiedHash =
        sRow?.lastVerifiedHash || legEntry?.lastVerifiedContentHash || (legEntry?.status === "VERIFIED" ? legEntry.submittedContentHash : "") || null;
      const lastVerifiedAt =
        sRow?.lastVerifiedAt || legEntry?.lastVerifiedAt || (legEntry?.status === "VERIFIED" ? legEntry.verifiedAt : null) || null;
      const lastVerifiedLmsWorkId = sRow?.lastVerifiedLmsWorkId || legEntry?.lmsWorkId || null;
      const missingLegacySnapshot = Boolean(sRow?.missingLegacySnapshot) || Boolean(lastVerifiedAt && !sRow?.lastVerifiedSnapshotJson);

      const snapshot = parseSpckSubmissionSnapshot(sRow?.lastVerifiedSnapshotJson);
      const driftCheck = checkSpckSnapshotFileDrift(snapshot);

      let currentSessionHash = "";
      let currentRawHash = "";
      if (sRow) {
        currentSessionHash = computeSpckSessionContentHash(sRow, slot);
        currentRawHash = computeSpckContentHash(sRow);
      }
      const hashChangedFromVerified = Boolean(
        lastVerifiedHash &&
          sRow &&
          sRow.lastAttemptHash &&
          currentSessionHash !== sRow.lastVerifiedHash &&
          currentRawHash !== sRow.lastVerifiedHash
      );
      const hasUnsubmittedChanges = Boolean(
        lastVerifiedHash &&
          sRow &&
          (hashChangedFromVerified ||
            sRow.draftStatus === "WAITING_APPROVAL" ||
            sRow.draftStatus === "DRAFT")
      );

      const newerShared = this.hasNewerSharedResources(shared, sRow);

      let displayState: SpckSessionHistoryCellSummary["displayState"] = "NOT_SUBMITTED";
      let badgeLabel = "Chưa nộp";

      if (historyCorrupted && !lastAttemptStatus && !lastVerifiedAt) {
        displayState = "CORRUPTED";
        badgeLabel = "Cần kiểm tra";
      } else if (lastAttemptStatus === "FAILED" && lastVerifiedAt) {
        displayState = "FAILED_AFTER_VERIFIED";
        badgeLabel = `Lỗi nộp lại (đã nộp ${lastVerifiedAt.slice(0, 10)})`;
      } else if (lastAttemptStatus === "FAILED") {
        displayState = "FAILED";
        badgeLabel = "Lỗi";
      } else if (lastVerifiedAt || lastAttemptStatus === "VERIFIED") {
        if (driftCheck.hasFileDrift) {
          displayState = "VERIFIED_FILE_DRIFT";
          badgeLabel = "Đã nộp (tệp gốc đã đổi)";
        } else if (hasUnsubmittedChanges) {
          displayState = "VERIFIED_WITH_UNSUBMITTED_EDITS";
          badgeLabel = "Đã nộp (có bản sửa mới)";
        } else {
          displayState = "VERIFIED";
          badgeLabel = "Đã nộp";
        }
      } else if (hasLegacyUnknownSessionHistory) {
        displayState = "UNKNOWN_LEGACY";
        badgeLabel = "Chưa xác định";
      }

      sessions[key] = {
        sessionNumber: slot,
        stageNumber: stageInfo.stageNumber,
        stageCode: stageInfo.stageCode,
        displayState,
        badgeLabel,
        draftStatus: sRow?.draftStatus || "DRAFT",
        draftVersion: sRow?.draftVersion ?? 0,
        isDraftInitialized: Boolean(sRow?.isDraftInitialized),
        hasUnsubmittedChanges,
        hasNewerSharedResources: newerShared,
        hasFileDriftAfterVerified: driftCheck.hasFileDrift,
        driftedFiles: driftCheck.driftedFiles,
        lastAttemptStatus,
        lastAttemptAt,
        lastErrorMessage,
        lastVerifiedHash,
        lastVerifiedAt,
        lastVerifiedLmsWorkId,
        lastVerifiedSnapshot: snapshot,
        missingLegacySnapshot,
      };
    }

    return {
      historyCorrupted,
      historyCorruptedReason,
      hasLegacyUnknownSessionHistory,
      legacyHistoryMeta,
      sessions,
    };
  },
};

export interface JobLogRecord {
  id?: number;
  jobId: string;
  jobType: string;
  classId?: string | null;
  sessionId?: string | null;
  studentId?: string | null;
  submissionId?: string | null;
  level: "DEBUG" | "INFO" | "WARN" | "ERROR" | "SUCCESS";
  message: string;
  detailsJson?: string | null;
  timestamp?: string;
}

export const jobLogRepo = {
  add(record: JobLogRecord) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO job_logs (jobId, jobType, classId, sessionId, studentId, submissionId, level, message, detailsJson, timestamp)
      VALUES (@jobId, @jobType, @classId, @sessionId, @studentId, @submissionId, @level, @message, @detailsJson, datetime('now', 'localtime'))
    `);
    return stmt.run({
      jobId: record.jobId,
      jobType: record.jobType,
      classId: record.classId ?? null,
      sessionId: record.sessionId ?? null,
      studentId: record.studentId ?? null,
      submissionId: record.submissionId ?? null,
      level: record.level || "INFO",
      message: record.message,
      detailsJson: record.detailsJson ?? null,
    });
  },

  findByJob(jobId: string): JobLogRecord[] {
    const db = getDb();
    return db
      .prepare(`SELECT * FROM job_logs WHERE jobId = ? ORDER BY id ASC`)
      .all(jobId) as JobLogRecord[];
  },

  getRecentLogs(limit = 100): JobLogRecord[] {
    const db = getDb();
    return db
      .prepare(`SELECT * FROM job_logs ORDER BY id DESC LIMIT ?`)
      .all(limit) as JobLogRecord[];
  },
};

export const scoreMatrixRepo = {
  save(classId: string, matrixData: any) {
    const normalizedId = classId.trim().toUpperCase();
    if (!normalizedId) {
      throw new Error("[scoreMatrixRepo] classId không được để trống.");
    }
    if (
      !matrixData ||
      typeof matrixData !== "object" ||
      matrixData.success !== true ||
      !Array.isArray(matrixData.columns) ||
      matrixData.columns.length === 0 ||
      !Array.isArray(matrixData.rows) ||
      matrixData.rows.length === 0
    ) {
      throw new Error(
        `[scoreMatrixRepo] Từ chối lưu ma trận điểm rỗng, chưa thành công (success !== true) hoặc không hợp lệ cho lớp ${normalizedId} để bảo vệ cache hiện có.`
      );
    }
    if (
      matrixData.classId &&
      String(matrixData.classId).trim().toUpperCase() !== normalizedId
    ) {
      throw new Error(
        `[scoreMatrixRepo] Xung đột mã lớp khi lưu bảng điểm: expected=${normalizedId}, actual=${matrixData.classId}`
      );
    }

    const colIds = new Set<string>();
    for (const col of matrixData.columns) {
      const cid = String(col?.columnId || "").trim();
      if (!cid || colIds.has(cid)) {
        throw new Error(
          `[scoreMatrixRepo] Cột bài tập thiếu columnId hoặc bị trùng lặp ('${cid}') trong lớp ${normalizedId}.`
        );
      }
      colIds.add(cid);
    }

    const validCellStatuses = new Set([
      "GRADED",
      "SUBMITTED_UNGRADED",
      "NOT_SUBMITTED",
      "REDO_REQUESTED",
    ]);

    const rowStudentIds = new Set<string>();
    for (const row of matrixData.rows) {
      const sid = String(row?.studentId || "").trim();
      if (!sid || rowStudentIds.has(sid)) {
        throw new Error(
          `[scoreMatrixRepo] Dòng học viên thiếu studentId hoặc bị trùng lặp ('${sid}') trong lớp ${normalizedId}.`
        );
      }
      rowStudentIds.add(sid);

      if (!row.cells || typeof row.cells !== "object" || Array.isArray(row.cells)) {
        throw new Error(
          `[scoreMatrixRepo] Học viên '${sid}' thiếu danh sách ô điểm (cells) trong lớp ${normalizedId}.`
        );
      }

      for (const cellKey of Object.keys(row.cells)) {
        if (!colIds.has(cellKey)) {
          throw new Error(
            `[scoreMatrixRepo] Học viên '${sid}' chứa ô điểm có mã cột lạ '${cellKey}' không nằm trong danh sách cột của lớp ${normalizedId}.`
          );
        }
      }

      for (const cid of colIds) {
        const cell = row.cells[cid];
        if (!cell || typeof cell !== "object" || !validCellStatuses.has(String(cell.status))) {
          throw new Error(
            `[scoreMatrixRepo] Học viên '${sid}' có trạng thái ô điểm không hợp lệ ('${cell?.status}') tại cột '${cid}' trong lớp ${normalizedId}.`
          );
        }
        if (typeof cell.columnId !== "string" || cell.columnId.trim() !== cid) {
          throw new Error(
            `[scoreMatrixRepo] Ô điểm của học viên '${sid}' tại cột '${cid}' thiếu hoặc sai lệch columnId ('${cell.columnId}').`
          );
        }
        if (
          typeof cell.maxScore !== "number" ||
          !Number.isFinite(cell.maxScore) ||
          cell.maxScore <= 0 ||
          cell.maxScore > 100
        ) {
          throw new Error(
            `[scoreMatrixRepo] Ô điểm của học viên '${sid}' tại cột '${cid}' thiếu hoặc có maxScore không hợp lệ (${cell.maxScore}).`
          );
        }
        const maxScore = cell.maxScore;

        if (!("score" in cell) || cell.score === undefined) {
          throw new Error(
            `[scoreMatrixRepo] Ô điểm của học viên '${sid}' tại cột '${cid}' thiếu trường bắt buộc 'score'.`
          );
        }

        if (cell.status === "GRADED") {
          if (
            typeof cell.score !== "number" ||
            !Number.isFinite(cell.score) ||
            cell.score < 0 ||
            cell.score > maxScore
          ) {
            throw new Error(
              `[scoreMatrixRepo] Ô điểm GRADED của học viên '${sid}' tại cột '${cid}' có điểm số không hợp lệ (score=${cell.score}, maxScore=${maxScore}).`
            );
          }
        } else if (cell.status === "SUBMITTED_UNGRADED" || cell.status === "NOT_SUBMITTED") {
          if (cell.score !== null) {
            throw new Error(
              `[scoreMatrixRepo] Ô điểm '${cell.status}' của học viên '${sid}' tại cột '${cid}' bắt buộc có score=null (actual=${cell.score}).`
            );
          }
        } else if (cell.status === "REDO_REQUESTED") {
          if (
            cell.score !== null &&
            (typeof cell.score !== "number" ||
              !Number.isFinite(cell.score) ||
              cell.score < 0 ||
              cell.score > maxScore)
          ) {
            throw new Error(
              `[scoreMatrixRepo] Ô điểm REDO_REQUESTED của học viên '${sid}' tại cột '${cid}' có điểm số không hợp lệ (score=${cell.score}).`
            );
          }
        }

        if (
          cell.quizScore !== null &&
          cell.quizScore !== undefined &&
          (typeof cell.quizScore !== "number" ||
            !Number.isFinite(cell.quizScore) ||
            cell.quizScore < 0 ||
            cell.quizScore > 100)
        ) {
          throw new Error(
            `[scoreMatrixRepo] Ô điểm của học viên '${sid}' tại cột '${cid}' có điểm Quiz không hợp lệ (quizScore=${cell.quizScore}).`
          );
        }
      }
    }

    const db = getDb();
    return db
      .prepare(`
        INSERT INTO score_matrix_cache (classId, matrixJson, updatedAt)
        VALUES (?, ?, datetime('now', 'localtime'))
        ON CONFLICT(classId) DO UPDATE SET
          matrixJson = excluded.matrixJson,
          updatedAt = datetime('now', 'localtime')
      `)
      .run(normalizedId, JSON.stringify(matrixData));
  },

  findByClass(classId: string): { matrix: any; updatedAt: string } | null {
    const normalizedId = classId.trim().toUpperCase();
    if (!normalizedId) return null;
    const db = getDb();
    const row = db
      .prepare(`SELECT matrixJson, updatedAt FROM score_matrix_cache WHERE classId = ?`)
      .get(normalizedId) as { matrixJson: string; updatedAt: string } | undefined;

    if (!row) return null;
    try {
      return {
        matrix: JSON.parse(row.matrixJson),
        updatedAt: row.updatedAt,
      };
    } catch {
      return null;
    }
  },
};

export interface SpckSession14CompetencyScores {
  knowledgeInClass: number;      // [ĐNL] Kiến thức học viên đã được học tại lớp (1..5)
  knowledgeSelfStudy: number;    // [ĐNL] Kiến thức học viên tự học (1..5)
  skillCommunication: number;    // [ĐNL] Kỹ năng giao tiếp, hợp tác (1..5)
  skillComputerUse: number;      // [ĐNL] Kỹ năng sử dụng máy tính (1..5)
  skillProblemSolving: number;   // [ĐNL] Kỹ năng giải quyết vấn đề (1..5)
  skillCreativity: number;       // [ĐNL] Tư duy sáng tạo (1..5)
  skillComputational: number;    // [ĐNL] Tư duy máy tính (1..5)
  attitudeHomework: number;      // [ĐNL] Thái độ luyện tập về nhà (1..5)
  attitudeInClass: number;       // [ĐNL] Thái độ học tập trên lớp (1..5)
}

export interface SpckSession14DemoScores {
  algorithm: number;             // Tư duy máy tính, tư duy thuật toán (max 1.5)
  creativity: number;            // Tư duy sáng tạo (max 1.0)
  communication: number;         // Kỹ năng giao tiếp, hợp tác (max 0.5)
  problemSolving: number;        // Giải quyết vấn đề (max 1.0)
  computerSkills: number;        // Kỹ năng sử dụng máy tính (max 1.0)
}

export interface SpckSession14EvaluationRecord {
  id?: number;
  classId: string;
  studentId: string;
  competencyJson: string;
  competencyTotalScore: number;
  demoScoresJson: string;
  demoTotalScore: number;
  demoSourcePath: string;
  demoJudgeNote: string;
  learnedFromMindx: string;
  suggestionsFromMindx: string;
  futureDirection: string;
  awardRanking?: string;
  quickTagsJson: string;
  teacherNote: string;
  draftVersion: number;
  status: "DRAFT" | "WAITING_APPROVAL" | "APPROVED" | "VERIFIED" | "FAILED";
  contentHash: string;
  verifiedAt?: string | null;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export const DEFAULT_SESSION14_COMPETENCY_SCORES: SpckSession14CompetencyScores = {
  knowledgeInClass: 4,
  knowledgeSelfStudy: 4,
  skillCommunication: 4,
  skillComputerUse: 4,
  skillProblemSolving: 4,
  skillCreativity: 4,
  skillComputational: 4,
  attitudeHomework: 4,
  attitudeInClass: 4,
};

export const DEFAULT_SESSION14_DEMO_SCORES: SpckSession14DemoScores = {
  algorithm: 0,
  creativity: 0,
  communication: 0,
  problemSolving: 0,
  computerSkills: 0,
};

export const SESSION14_COMPETENCY_KEYS: Array<keyof SpckSession14CompetencyScores> = [
  "knowledgeInClass",
  "knowledgeSelfStudy",
  "skillCommunication",
  "skillComputerUse",
  "skillProblemSolving",
  "skillCreativity",
  "skillComputational",
  "attitudeHomework",
  "attitudeInClass",
];

export const SESSION14_DEMO_LIMITS: Record<keyof SpckSession14DemoScores, number> = {
  algorithm: 1.5,
  creativity: 1.0,
  communication: 0.5,
  problemSolving: 1.0,
  computerSkills: 1.0,
};

export const SESSION14_DEMO_LIMITS_ROBOTICS: Record<keyof SpckSession14DemoScores, number> = {
  creativity: 1.25,
  communication: 0.75,
  problemSolving: 1.0,
  computerSkills: 0.5,
  algorithm: 1.0,
};

export function isRoboticsClassCode(classId?: string | null): boolean {
  const s = String(classId || "").trim().toUpperCase();
  if (!s) return false;
  return /(?:^|[-_\s])(ROB|ROBO|ROBOT|ROBOTICS|PREB|PREA|PREI|ARM|ARMA|ARMB|ARMI|SEM|SEMA|SEMB|SEMI|EV3|VEX|SPIKE|WEDO|ARDUINO)[A-Z0-9]*\b/i.test(
    s
  );
}

export function parseSession14CompetencyScores(
  raw?: string | Partial<SpckSession14CompetencyScores> | null
): SpckSession14CompetencyScores {
  let obj: any = {};
  if (typeof raw === "string" && raw.trim()) {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = {};
    }
  } else if (raw && typeof raw === "object") {
    obj = raw;
  }

  const clampRating = (val: unknown, fallback = 4): number => {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    const rounded = Math.round(n);
    if (rounded < 1) return 1;
    if (rounded > 5) return 5;
    return rounded;
  };

  return {
    knowledgeInClass: clampRating(obj.knowledgeInClass, DEFAULT_SESSION14_COMPETENCY_SCORES.knowledgeInClass),
    knowledgeSelfStudy: clampRating(obj.knowledgeSelfStudy, DEFAULT_SESSION14_COMPETENCY_SCORES.knowledgeSelfStudy),
    skillCommunication: clampRating(obj.skillCommunication, DEFAULT_SESSION14_COMPETENCY_SCORES.skillCommunication),
    skillComputerUse: clampRating(obj.skillComputerUse, DEFAULT_SESSION14_COMPETENCY_SCORES.skillComputerUse),
    skillProblemSolving: clampRating(obj.skillProblemSolving, DEFAULT_SESSION14_COMPETENCY_SCORES.skillProblemSolving),
    skillCreativity: clampRating(obj.skillCreativity, DEFAULT_SESSION14_COMPETENCY_SCORES.skillCreativity),
    skillComputational: clampRating(obj.skillComputational, DEFAULT_SESSION14_COMPETENCY_SCORES.skillComputational),
    attitudeHomework: clampRating(obj.attitudeHomework, DEFAULT_SESSION14_COMPETENCY_SCORES.attitudeHomework),
    attitudeInClass: clampRating(obj.attitudeInClass, DEFAULT_SESSION14_COMPETENCY_SCORES.attitudeInClass),
  };
}

export function calculateCompetencyAverageScore(
  scores: SpckSession14CompetencyScores
): number {
  const sum = SESSION14_COMPETENCY_KEYS.reduce(
    (acc, key) => acc + (Number(scores[key]) || 0),
    0
  );
  return Math.round((sum / 9) * 100) / 100;
}

export function parseSession14DemoScores(
  raw?: string | Partial<SpckSession14DemoScores> | null,
  classId?: string | null
): SpckSession14DemoScores {
  let obj: any = {};
  if (typeof raw === "string" && raw.trim()) {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = {};
    }
  } else if (raw && typeof raw === "object") {
    obj = raw;
  }

  const limits = isRoboticsClassCode(classId)
    ? SESSION14_DEMO_LIMITS_ROBOTICS
    : SESSION14_DEMO_LIMITS;

  const normalizeScore = (val: unknown, max: number): number => {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) return 0;
    const clamped = Math.min(n, max);
    return Math.round(clamped * 100) / 100;
  };

  return {
    algorithm: normalizeScore(obj.algorithm, limits.algorithm),
    creativity: normalizeScore(obj.creativity, limits.creativity),
    communication: normalizeScore(obj.communication, limits.communication),
    problemSolving: normalizeScore(obj.problemSolving, limits.problemSolving),
    computerSkills: normalizeScore(obj.computerSkills, limits.computerSkills),
  };
}

export function calculateDemoTotalScore(scores: SpckSession14DemoScores): number {
  const sum =
    (Number(scores.algorithm) || 0) +
    (Number(scores.creativity) || 0) +
    (Number(scores.communication) || 0) +
    (Number(scores.problemSolving) || 0) +
    (Number(scores.computerSkills) || 0);
  return Math.round(sum * 100) / 100;
}

export function formatSession14ScoreText(score: number): string {
  const rounded = Math.round((Number(score) || 0) * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(Number(rounded.toFixed(2)));
}

export function syncSession14LetterScoreLines(
  letterText: string,
  demoTotalScore: number,
  competencyTotalScore: number
): string {
  if (!letterText || !letterText.trim()) return letterText;
  const demoStr = formatSession14ScoreText(demoTotalScore);
  const compStr = formatSession14ScoreText(competencyTotalScore);
  let updated = letterText.replace(
    /^([ \t]*(?:(?:[-*•+]|\d+[.)])[ \t]+)*(?:[*_`~ \t]*Điểm[*_`~ \t]+Demo)[*_`~ \t]*:[*_`~ \t]*).*$/gim,
    `$1${demoStr} điểm`
  );
  updated = updated.replace(
    /^([ \t]*(?:(?:[-*•+]|\d+[.)])[ \t]+)*(?:[*_`~ \t]*Điểm[*_`~ \t]+Năng[*_`~ \t]+lực)[*_`~ \t]*:[*_`~ \t]*).*$/gim,
    `$1${compStr} điểm`
  );
  return updated;
}

export function verifySession14LetterScoreConsistency(
  letterText: string,
  demoTotalScore: number,
  competencyTotalScore: number
): { ok: boolean; reason?: string } {
  if (!letterText || !letterText.trim()) {
    return {
      ok: false,
      reason: "Thư Learned From Mindx đang trống.",
    };
  }
  const lines = letterText.split(/\r?\n/);
  let foundDemo = false;
  let foundComp = false;
  for (const rawLine of lines) {
    const cleanLine = rawLine
      .replace(/[*_`~]/g, "")
      .replace(/^[ \t]*(?:(?:[-•+]|\d+[.)])[ \t]+)*/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (/^Điểm Demo\b/i.test(cleanLine)) {
      foundDemo = true;
      const m = cleanLine.match(/^Điểm Demo[ \t]*:[ \t]*([+-]?[0-9]+(?:[.,][0-9]+)?)/i);
      if (!m) {
        return {
          ok: false,
          reason: `Dòng Điểm Demo trong thư ("${rawLine.trim()}") không có giá trị số hợp lệ.`,
        };
      }
      const parsedDemo = Number(m[1].replace(",", "."));
      if (!Number.isFinite(parsedDemo) || Math.abs(parsedDemo - demoTotalScore) > 0.01) {
        return {
          ok: false,
          reason: `Điểm Demo trong thư (${m[1]}) không khớp với tổng điểm Demo hiện tại (${formatSession14ScoreText(demoTotalScore)}).`,
        };
      }
    }
    if (/^Điểm Năng lực\b/i.test(cleanLine)) {
      foundComp = true;
      const m = cleanLine.match(/^Điểm Năng lực[ \t]*:[ \t]*([+-]?[0-9]+(?:[.,][0-9]+)?)/i);
      if (!m) {
        return {
          ok: false,
          reason: `Dòng Điểm Năng lực trong thư ("${rawLine.trim()}") không có giá trị số hợp lệ.`,
        };
      }
      const parsedComp = Number(m[1].replace(",", "."));
      if (!Number.isFinite(parsedComp) || Math.abs(parsedComp - competencyTotalScore) > 0.01) {
        return {
          ok: false,
          reason: `Điểm Năng lực trong thư (${m[1]}) không khớp với Điểm Năng lực hiện tại (${formatSession14ScoreText(competencyTotalScore)}).`,
        };
      }
    }
  }
  if (!foundDemo || !foundComp) {
    return {
      ok: false,
      reason: "Thư Learned From Mindx thiếu dòng 'Điểm Demo:' hoặc 'Điểm Năng lực:'.",
    };
  }
  return { ok: true };
}

export function computeSession14EvalHash(record: {
  classId: string;
  studentId: string;
  competencyJson?: string;
  competencyTotalScore?: number;
  demoScoresJson?: string;
  demoTotalScore?: number;
  learnedFromMindx?: string;
  suggestionsFromMindx?: string;
  futureDirection?: string;
  awardRanking?: string;
}): string {
  const comp = parseSession14CompetencyScores(record.competencyJson);
  const compTotal = calculateCompetencyAverageScore(comp);
  const demo = parseSession14DemoScores(record.demoScoresJson, record.classId);
  const demoTotal = calculateDemoTotalScore(demo);
  const cleanAward = String(record.awardRanking || "").trim();
  const payload = JSON.stringify({
    v: "SESSION14_EVAL_V290",
    classId: String(record.classId || "").trim().toUpperCase(),
    studentId: String(record.studentId || "").trim(),
    competency: comp,
    competencyTotalScore: compTotal,
    demoScores: demo,
    demoTotalScore: demoTotal,
    learnedFromMindx: String(record.learnedFromMindx || "").trim(),
    suggestionsFromMindx: String(record.suggestionsFromMindx || "").trim(),
    futureDirection: String(record.futureDirection || "").trim(),
    ...(cleanAward ? { awardRanking: cleanAward } : {}),
  });
  return calculateSha256(payload);
}

export function verifySession14EvalIntegrity(
  record?: SpckSession14EvaluationRecord | null
): boolean {
  if (!record || !record.contentHash) return false;
  return computeSession14EvalHash(record) === record.contentHash;
}

export const session14EvalRepo = {
  findOne(classId: string, studentId: string): SpckSession14EvaluationRecord | undefined {
    const db = getDb();
    return db
      .prepare(
        `SELECT * FROM spck_session14_evaluations WHERE classId = ? AND studentId = ?`
      )
      .get(classId.trim().toUpperCase(), studentId.trim()) as
      | SpckSession14EvaluationRecord
      | undefined;
  },

  findByClass(classId: string): SpckSession14EvaluationRecord[] {
    const db = getDb();
    return db
      .prepare(
        `SELECT * FROM spck_session14_evaluations WHERE classId = ? ORDER BY id ASC`
      )
      .all(classId.trim().toUpperCase()) as SpckSession14EvaluationRecord[];
  },

  getOrInit(classId: string, studentId: string): SpckSession14EvaluationRecord {
    const normalizedClassId = classId.trim().toUpperCase();
    const normalizedStudentId = studentId.trim();
    const existing = this.findOne(normalizedClassId, normalizedStudentId);
    if (existing) {
      return existing;
    }

    const db = getDb();
    const defaultComp = DEFAULT_SESSION14_COMPETENCY_SCORES;
    const defaultCompTotal = calculateCompetencyAverageScore(defaultComp);
    const defaultDemo = DEFAULT_SESSION14_DEMO_SCORES;
    const defaultDemoTotal = calculateDemoTotalScore(defaultDemo);

    db.prepare(
      `INSERT INTO spck_session14_evaluations (
        classId, studentId, competencyJson, competencyTotalScore,
        demoScoresJson, demoTotalScore, demoSourcePath, demoJudgeNote,
        learnedFromMindx, suggestionsFromMindx, futureDirection,
        quickTagsJson, teacherNote, draftVersion, status, contentHash
      ) VALUES (?, ?, ?, ?, ?, ?, '', '', '', '', '', '[]', '', 1, 'DRAFT', '')`
    ).run(
      normalizedClassId,
      normalizedStudentId,
      JSON.stringify(defaultComp),
      defaultCompTotal,
      JSON.stringify(defaultDemo),
      defaultDemoTotal
    );

    return this.findOne(normalizedClassId, normalizedStudentId)!;
  },

  saveDraft(params: {
    classId: string;
    studentId: string;
    expectedVersion?: number;
    competencyScores?: Partial<SpckSession14CompetencyScores> | string;
    demoScores?: Partial<SpckSession14DemoScores> | string;
    demoSourcePath?: string;
    demoJudgeNote?: string;
    learnedFromMindx?: string;
    suggestionsFromMindx?: string;
    futureDirection?: string;
    awardRanking?: string;
    quickTags?: string[] | string;
    teacherNote?: string;
  }): {
    success: boolean;
    conflict?: boolean;
    currentVersion?: number;
    record: SpckSession14EvaluationRecord;
  } {
    const normalizedClassId = params.classId.trim().toUpperCase();
    const normalizedStudentId = params.studentId.trim();
    const current = this.getOrInit(normalizedClassId, normalizedStudentId);

    if (
      params.expectedVersion !== undefined &&
      Number.isFinite(params.expectedVersion) &&
      Number(params.expectedVersion) !== current.draftVersion
    ) {
      return {
        success: false,
        conflict: true,
        currentVersion: current.draftVersion,
        record: current,
      };
    }

    const currentComp = parseSession14CompetencyScores(current.competencyJson);
    const nextComp =
      params.competencyScores !== undefined
        ? parseSession14CompetencyScores(
            typeof params.competencyScores === "string"
              ? params.competencyScores
              : { ...currentComp, ...params.competencyScores }
          )
        : currentComp;
    const nextCompJson = JSON.stringify(nextComp);
    const nextCompTotal = calculateCompetencyAverageScore(nextComp);

    const currentDemo = parseSession14DemoScores(current.demoScoresJson, normalizedClassId);
    const nextDemo =
      params.demoScores !== undefined
        ? parseSession14DemoScores(
            typeof params.demoScores === "string"
              ? params.demoScores
              : { ...currentDemo, ...params.demoScores },
            normalizedClassId
          )
        : currentDemo;
    const nextDemoJson = JSON.stringify(nextDemo);
    const nextDemoTotal = calculateDemoTotalScore(nextDemo);

    const nextSourcePath =
      params.demoSourcePath !== undefined ? params.demoSourcePath : current.demoSourcePath;
    const nextJudgeNote =
      params.demoJudgeNote !== undefined ? params.demoJudgeNote : current.demoJudgeNote;
    const rawLearned =
      params.learnedFromMindx !== undefined
        ? params.learnedFromMindx
        : current.learnedFromMindx;
    const shouldAutoSyncLetterScores =
      params.learnedFromMindx === undefined ||
      params.demoScores !== undefined ||
      params.competencyScores !== undefined;
    const nextLearned = shouldAutoSyncLetterScores
      ? syncSession14LetterScoreLines(rawLearned, nextDemoTotal, nextCompTotal)
      : rawLearned;
    const nextSuggestions =
      params.suggestionsFromMindx !== undefined
        ? params.suggestionsFromMindx
        : current.suggestionsFromMindx;
    const nextFuture =
      params.futureDirection !== undefined ? params.futureDirection : current.futureDirection;
    const nextAwardRanking =
      params.awardRanking !== undefined ? params.awardRanking : current.awardRanking || "";
    const nextTagsJson =
      params.quickTags !== undefined
        ? typeof params.quickTags === "string"
          ? params.quickTags
          : JSON.stringify(params.quickTags)
        : current.quickTagsJson;
    const nextNote =
      params.teacherNote !== undefined ? params.teacherNote : current.teacherNote;

    const candidateHash = computeSession14EvalHash({
      classId: normalizedClassId,
      studentId: normalizedStudentId,
      competencyJson: nextCompJson,
      competencyTotalScore: nextCompTotal,
      demoScoresJson: nextDemoJson,
      demoTotalScore: nextDemoTotal,
      learnedFromMindx: nextLearned,
      suggestionsFromMindx: nextSuggestions,
      futureDirection: nextFuture,
      awardRanking: nextAwardRanking,
    });

    const contentChangedFromApproved =
      Boolean(current.contentHash) && current.contentHash !== candidateHash;
    const contentChangedFromCurrent =
      nextCompJson !== current.competencyJson ||
      nextDemoJson !== current.demoScoresJson ||
      nextSourcePath !== current.demoSourcePath ||
      nextJudgeNote !== current.demoJudgeNote ||
      nextLearned !== current.learnedFromMindx ||
      nextSuggestions !== current.suggestionsFromMindx ||
      nextFuture !== current.futureDirection ||
      nextAwardRanking !== (current.awardRanking || "") ||
      nextTagsJson !== current.quickTagsJson ||
      nextNote !== current.teacherNote;

    let nextStatus = current.status;
    let nextHash = current.contentHash;
    let nextVerifiedAt = current.verifiedAt ?? null;

    if (contentChangedFromApproved || contentChangedFromCurrent) {
      const hasAnyText = Boolean(
        nextLearned.trim() ||
          nextSuggestions.trim() ||
          nextFuture.trim() ||
          nextAwardRanking.trim() ||
          nextDemoTotal > 0
      );
      if (current.status === "APPROVED" || current.status === "VERIFIED") {
        nextStatus = "WAITING_APPROVAL";
        nextHash = "";
      } else if (current.status === "DRAFT" && hasAnyText) {
        nextStatus = "WAITING_APPROVAL";
      } else if (current.status === "FAILED") {
        nextStatus = "WAITING_APPROVAL";
      }
    }

    const nextVersion = contentChangedFromCurrent
      ? current.draftVersion + 1
      : current.draftVersion;

    const db = getDb();
    db.prepare(
      `UPDATE spck_session14_evaluations
       SET competencyJson = ?,
           competencyTotalScore = ?,
           demoScoresJson = ?,
           demoTotalScore = ?,
           demoSourcePath = ?,
           demoJudgeNote = ?,
           learnedFromMindx = ?,
           suggestionsFromMindx = ?,
           futureDirection = ?,
           awardRanking = ?,
           quickTagsJson = ?,
           teacherNote = ?,
           draftVersion = ?,
           status = ?,
           contentHash = ?,
           verifiedAt = ?,
           errorMessage = NULL,
           updatedAt = datetime('now', 'localtime')
       WHERE classId = ? AND studentId = ?`
    ).run(
      nextCompJson,
      nextCompTotal,
      nextDemoJson,
      nextDemoTotal,
      nextSourcePath,
      nextJudgeNote,
      nextLearned,
      nextSuggestions,
      nextFuture,
      nextAwardRanking,
      nextTagsJson,
      nextNote,
      nextVersion,
      nextStatus,
      nextHash,
      nextVerifiedAt,
      normalizedClassId,
      normalizedStudentId
    );

    return {
      success: true,
      record: this.findOne(normalizedClassId, normalizedStudentId)!,
    };
  },

  approveDraft(
    classId: string,
    studentId: string,
    expectedVersion?: number
  ): {
    success: boolean;
    conflict?: boolean;
    currentVersion?: number;
    error?: string;
    record: SpckSession14EvaluationRecord;
  } {
    const normalizedClassId = classId.trim().toUpperCase();
    const normalizedStudentId = studentId.trim();
    const current = this.getOrInit(normalizedClassId, normalizedStudentId);

    if (
      expectedVersion !== undefined &&
      Number.isFinite(expectedVersion) &&
      Number(expectedVersion) !== current.draftVersion
    ) {
      return {
        success: false,
        conflict: true,
        currentVersion: current.draftVersion,
        error: `Bản nháp đánh giá Buổi 14 của học viên ${normalizedStudentId} đã thay đổi (version=${current.draftVersion}).`,
        record: current,
      };
    }

    if (!current.learnedFromMindx.trim()) {
      return {
        success: false,
        error: `Thiếu nội dung "Learned From Mindx" cho học viên ${normalizedStudentId}.`,
        record: current,
      };
    }
    if (!current.suggestionsFromMindx.trim()) {
      return {
        success: false,
        error: `Thiếu nội dung "Suggestions From Mindx" cho học viên ${normalizedStudentId}.`,
        record: current,
      };
    }
    if (!current.futureDirection.trim()) {
      return {
        success: false,
        error: `Thiếu nội dung "Future Direction" cho học viên ${normalizedStudentId}.`,
        record: current,
      };
    }

    const comp = parseSession14CompetencyScores(current.competencyJson);
    const compTotal = calculateCompetencyAverageScore(comp);
    const demo = parseSession14DemoScores(current.demoScoresJson, normalizedClassId);
    const demoTotal = calculateDemoTotalScore(demo);

    const scoreConsistency = verifySession14LetterScoreConsistency(
      current.learnedFromMindx,
      demoTotal,
      compTotal
    );
    if (!scoreConsistency.ok) {
      return {
        success: false,
        error: scoreConsistency.reason,
        record: current,
      };
    }

    const hash = computeSession14EvalHash({
      classId: normalizedClassId,
      studentId: normalizedStudentId,
      competencyJson: JSON.stringify(comp),
      competencyTotalScore: compTotal,
      demoScoresJson: JSON.stringify(demo),
      demoTotalScore: demoTotal,
      learnedFromMindx: current.learnedFromMindx,
      suggestionsFromMindx: current.suggestionsFromMindx,
      futureDirection: current.futureDirection,
      awardRanking: current.awardRanking,
    });

    const db = getDb();
    db.prepare(
      `UPDATE spck_session14_evaluations
       SET competencyJson = ?,
           competencyTotalScore = ?,
           demoScoresJson = ?,
           demoTotalScore = ?,
           status = 'APPROVED',
           contentHash = ?,
           errorMessage = NULL,
           updatedAt = datetime('now', 'localtime')
       WHERE classId = ? AND studentId = ?`
    ).run(
      JSON.stringify(comp),
      compTotal,
      JSON.stringify(demo),
      demoTotal,
      hash,
      normalizedClassId,
      normalizedStudentId
    );

    return {
      success: true,
      record: this.findOne(normalizedClassId, normalizedStudentId)!,
    };
  },

  markVerified(
    classId: string,
    studentId: string,
    expectedHash: string
  ): SpckSession14EvaluationRecord {
    const normalizedClassId = classId.trim().toUpperCase();
    const normalizedStudentId = studentId.trim();
    const current = this.getOrInit(normalizedClassId, normalizedStudentId);
    const currentHash = computeSession14EvalHash(current);

    if (!expectedHash || currentHash !== expectedHash) {
      throw new Error(
        `[session14EvalRepo.markVerified] Sai lệch mã băm nội dung Buổi 14 của học viên ${normalizedStudentId}. Đã chặn đánh dấu VERIFIED.`
      );
    }

    const db = getDb();
    db.prepare(
      `UPDATE spck_session14_evaluations
       SET status = 'VERIFIED',
           contentHash = ?,
           verifiedAt = datetime('now', 'localtime'),
           errorMessage = NULL,
           updatedAt = datetime('now', 'localtime')
       WHERE classId = ? AND studentId = ?`
    ).run(expectedHash, normalizedClassId, normalizedStudentId);

    return this.findOne(normalizedClassId, normalizedStudentId)!;
  },

  markFailed(
    classId: string,
    studentId: string,
    errorMessage: string
  ): SpckSession14EvaluationRecord {
    const normalizedClassId = classId.trim().toUpperCase();
    const normalizedStudentId = studentId.trim();
    this.getOrInit(normalizedClassId, normalizedStudentId);
    const db = getDb();
    db.prepare(
      `UPDATE spck_session14_evaluations
       SET status = 'FAILED',
           errorMessage = ?,
           updatedAt = datetime('now', 'localtime')
       WHERE classId = ? AND studentId = ?`
    ).run(errorMessage, normalizedClassId, normalizedStudentId);
    return this.findOne(normalizedClassId, normalizedStudentId)!;
  },

  demoteToWaitingApproval(
    classId: string,
    studentId: string,
    reason: string
  ): SpckSession14EvaluationRecord {
    const normalizedClassId = classId.trim().toUpperCase();
    const normalizedStudentId = studentId.trim();
    this.getOrInit(normalizedClassId, normalizedStudentId);
    const db = getDb();
    db.prepare(
      `UPDATE spck_session14_evaluations
       SET status = 'WAITING_APPROVAL',
           contentHash = '',
           errorMessage = ?,
           updatedAt = datetime('now', 'localtime')
       WHERE classId = ? AND studentId = ?`
    ).run(reason, normalizedClassId, normalizedStudentId);
    return this.findOne(normalizedClassId, normalizedStudentId)!;
  },
};

// ==========================================
// 9. TEACHING FINAL PROJECTS (v3.2.0)
// ==========================================

export interface TeachingStudentItem {
  id: number;
  studentName: string;
  classCode: string;
  status: string;
}

export interface TeachingProjectTaskItem {
  slotIndex: number;
  taskId?: number | null;
  taskName: string;
  description: string;
  weightPercent: number;
  deadline: string;
  assignedStudentIds: number[];
}

export type TeachingProjectStatus =
  | "DRAFT"
  | "WAITING_APPROVAL"
  | "APPROVED"
  | "SAVING"
  | "VERIFIED"
  | "FAILED";

export interface TeachingFinalProjectRecord {
  id?: number;
  classId: string;
  teachingProjectId?: number | null;
  projectName: string;
  startDate: string;
  endDate: string;
  description: string;
  tasksJson: string;
  studentsJson: string;
  progressJson: string;
  draftVersion: number;
  status: TeachingProjectStatus;
  contentHash: string;
  verifiedAt?: string | null;
  verifiedSnapshotJson?: string;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Validates that a date string is a real calendar date in YYYY-MM-DD format (and not 0000-00-00).
 */
export function isValidIsoDateYmd(rawDate?: string | null): boolean {
  const s = String(rawDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s === "0000-00-00") return false;
  const [yStr, mStr, dStr] = s.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isInteger(y) || y < 2020 || y > 2100) return false;
  if (!Number.isInteger(m) || m < 1 || m > 12) return false;
  if (!Number.isInteger(d) || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Normalizes a date string (`DD/MM/YYYY`, `DD-MM-YYYY`, or `YYYY-MM-DD`) into `YYYY-MM-DD`, or returns `""` if invalid.
 */
export function normalizeDateToIsoYmd(rawDate?: string | null): string {
  const s = String(rawDate || "").trim();
  if (!s || s === "0000-00-00") return "";
  if (isValidIsoDateYmd(s)) return s;

  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    const first = Number(dmy[1]);
    const second = Number(dmy[2]);
    const thirdRaw = dmy[3];
    if (dmy[1].length === 4 || first > 31) {
      const candidate = `${String(first).padStart(4, "0")}-${String(second).padStart(2, "0")}-${String(Number(thirdRaw)).padStart(2, "0")}`;
      return isValidIsoDateYmd(candidate) ? candidate : "";
    }
    const year = thirdRaw.length === 2 ? 2000 + Number(thirdRaw) : Number(thirdRaw);
    const candidate = `${String(year).padStart(4, "0")}-${String(second).padStart(2, "0")}-${String(first).padStart(2, "0")}`;
    return isValidIsoDateYmd(candidate) ? candidate : "";
  }
  return "";
}

/**
 * Builds the default project name for Teaching (`SPCK - <ShortClassCode>`).
 * Example: `VT-C4K-GA38` -> `SPCK - GA38`, `VT-JSB16` -> `SPCK - JSB16`.
 */
export function buildDefaultTeachingProjectName(
  classCode: string,
  useFullCode: boolean = false
): string {
  const clean = String(classCode || "").trim().toUpperCase();
  if (!clean) return "SPCK";
  if (useFullCode) return `SPCK - ${clean}`;
  const shortCode = clean
    .replace(/^[A-Z]{2,4}-(?:C4K-|ROB-)?/i, "")
    .trim();
  return `SPCK - ${shortCode || clean}`;
}

export function normalizeAssignedStudentIds(raw: unknown): number[] {
  let arr: unknown[] = [];
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      arr = [];
    }
  }
  const set = new Set<number>();
  for (const item of arr) {
    const n = Number(item);
    if (Number.isInteger(n) && n > 0) {
      set.add(n);
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

export function normalizeTeachingProjectTasks(
  rawTasks: unknown,
  fallbackEndDate?: string,
  fallbackStudentIds?: number[]
): TeachingProjectTaskItem[] {
  let list: any[] = [];
  if (Array.isArray(rawTasks)) {
    list = rawTasks;
  } else if (typeof rawTasks === "string" && rawTasks.trim()) {
    try {
      const parsed = JSON.parse(rawTasks);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }

  const validFallbackDeadline = normalizeDateToIsoYmd(fallbackEndDate);
  const defaultStudents = normalizeAssignedStudentIds(fallbackStudentIds || []);

  return list.map((item, idx) => {
    const rawTaskId = item?.taskId ?? item?.id ?? null;
    const numTaskId =
      rawTaskId !== null && rawTaskId !== undefined && String(rawTaskId).trim() !== ""
        ? Number(rawTaskId)
        : null;
    const taskId =
      numTaskId !== null && Number.isInteger(numTaskId) && numTaskId > 0
        ? numTaskId
        : null;

    const hasExplicitWeight =
      item?.weightPercent !== undefined || item?.weight_percent !== undefined;
    const rawWeight = Number(item?.weightPercent ?? item?.weight_percent);
    const weightPercent = hasExplicitWeight
      ? Number.isFinite(rawWeight)
        ? rawWeight
        : 0
      : 20;

    const hasExplicitDeadline =
      item?.deadline !== undefined && item?.deadline !== null;
    const deadline = hasExplicitDeadline
      ? normalizeDateToIsoYmd(item.deadline)
      : validFallbackDeadline || "";

    const hasExplicitAssigned =
      item?.assignedStudentIds !== undefined || item?.assigned_students !== undefined;
    const rawAssigned =
      item?.assignedStudentIds !== undefined
        ? item.assignedStudentIds
        : item?.assigned_students;
    const assignedStudentIds = hasExplicitAssigned
      ? normalizeAssignedStudentIds(rawAssigned)
      : defaultStudents;

    return {
      slotIndex: idx + 1,
      taskId,
      taskName: String(item?.taskName ?? item?.task_name ?? "")
        .replace(/\r\n/g, "\n")
        .trim(),
      description: String(item?.description ?? "")
        .replace(/\r\n/g, "\n")
        .trim(),
      weightPercent,
      deadline,
      assignedStudentIds,
    };
  });
}

export function computeTeachingProjectHash(input: {
  classId: string;
  projectName: string;
  startDate: string;
  endDate: string;
  description?: string;
  tasks?: TeachingProjectTaskItem[] | string;
}): string {
  const normalizedClassId = String(input.classId || "").trim().toUpperCase();
  const tasks = normalizeTeachingProjectTasks(input.tasks);
  const canonical = {
    classId: normalizedClassId,
    projectName: String(input.projectName || "").trim(),
    startDate: normalizeDateToIsoYmd(input.startDate),
    endDate: normalizeDateToIsoYmd(input.endDate),
    description: String(input.description || "")
      .replace(/\r\n/g, "\n")
      .trim(),
    tasks: tasks.map((t, idx) => ({
      slotIndex: idx + 1,
      taskName: String(t.taskName || "").trim(),
      description: String(t.description || "")
        .replace(/\r\n/g, "\n")
        .trim(),
      weightPercent: Number(t.weightPercent) || 0,
      deadline: normalizeDateToIsoYmd(t.deadline),
      assignedStudentIds: normalizeAssignedStudentIds(t.assignedStudentIds),
    })),
  };
  return calculateSha256(JSON.stringify(canonical));
}

export function validateTeachingProjectForApproval(input: {
  classId: string;
  projectName: string;
  startDate: string;
  endDate: string;
  description?: string;
  tasks?: TeachingProjectTaskItem[] | string;
}): { ok: boolean; reason?: string; normalizedTasks: TeachingProjectTaskItem[] } {
  const projectName = String(input.projectName || "").trim();
  if (!projectName) {
    return {
      ok: false,
      reason: "Tên dự án không được để trống (ví dụ: SPCK - GA38).",
      normalizedTasks: [],
    };
  }

  const startDate = normalizeDateToIsoYmd(input.startDate);
  const endDate = normalizeDateToIsoYmd(input.endDate);
  if (!startDate) {
    return {
      ok: false,
      reason: "Ngày bắt đầu dự án không hợp lệ (cần định dạng YYYY-MM-DD).",
      normalizedTasks: [],
    };
  }
  if (!endDate) {
    return {
      ok: false,
      reason: "Ngày kết thúc dự án không hợp lệ (cần định dạng YYYY-MM-DD).",
      normalizedTasks: [],
    };
  }
  if (startDate > endDate) {
    return {
      ok: false,
      reason: `Ngày bắt đầu (${startDate}) không được lớn hơn Ngày kết thúc (${endDate}).`,
      normalizedTasks: [],
    };
  }

  // Strict validation without fallback deadline or fallback student roster
  const tasks = normalizeTeachingProjectTasks(input.tasks);
  if (tasks.length !== 5) {
    return {
      ok: false,
      reason: `Theo quy tắc bắt buộc phải có đúng 5 phần công việc (hiện có ${tasks.length} phần).`,
      normalizedTasks: tasks,
    };
  }

  let totalWeight = 0;
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const num = i + 1;
    if (!t.taskName.trim()) {
      return {
        ok: false,
        reason: `Phần công việc thứ ${num} chưa có tên công việc (Phần chung).`,
        normalizedTasks: tasks,
      };
    }
    if (!t.description.trim()) {
      return {
        ok: false,
        reason: `Phần công việc thứ ${num} ("${t.taskName}") chưa có Mô tả công việc chi tiết.`,
        normalizedTasks: tasks,
      };
    }
    if (!Number.isInteger(t.weightPercent) || t.weightPercent < 1 || t.weightPercent > 100) {
      return {
        ok: false,
        reason: `Phần công việc thứ ${num} có tỷ trọng không hợp lệ (${t.weightPercent}%).`,
        normalizedTasks: tasks,
      };
    }
    if (!isValidIsoDateYmd(t.deadline)) {
      return {
        ok: false,
        reason: `Phần công việc thứ ${num} chưa có ngày Deadline hợp lệ (không được để 0000-00-00).`,
        normalizedTasks: tasks,
      };
    }
    if (!t.assignedStudentIds || t.assignedStudentIds.length === 0) {
      return {
        ok: false,
        reason: `Phần công việc thứ ${num} chưa được giao cho học sinh nào.`,
        normalizedTasks: tasks,
      };
    }
    totalWeight += t.weightPercent;
  }

  if (totalWeight !== 100) {
    return {
      ok: false,
      reason: `Tổng tỷ trọng của 5 phần công việc phải bằng đúng 100% (hiện tại là ${totalWeight}%).`,
      normalizedTasks: tasks,
    };
  }

  return { ok: true, normalizedTasks: tasks };
}

export const teachingProjectRepo = {
  findOne(classId: string): TeachingFinalProjectRecord | undefined {
    const db = getDb();
    const normalizedClassId = String(classId || "").trim().toUpperCase();
    return db
      .prepare(`SELECT * FROM teaching_final_projects WHERE classId = ?`)
      .get(normalizedClassId) as TeachingFinalProjectRecord | undefined;
  },

  parseTasks(record?: TeachingFinalProjectRecord | null): TeachingProjectTaskItem[] {
    if (!record || !record.tasksJson) return [];
    return normalizeTeachingProjectTasks(record.tasksJson);
  },

  getOrInit(
    classId: string,
    defaults?: Partial<{
      teachingProjectId: number | null;
      projectName: string;
      startDate: string;
      endDate: string;
      description: string;
      tasks: TeachingProjectTaskItem[];
      students: TeachingStudentItem[];
      progress: Record<string, number>;
    }>
  ): TeachingFinalProjectRecord {
    const normalizedClassId = String(classId || "").trim().toUpperCase();
    const existing = this.findOne(normalizedClassId);
    if (existing) return existing;

    const db = getDb();
    const projectName =
      defaults?.projectName?.trim() || buildDefaultTeachingProjectName(normalizedClassId);
    const startDate = normalizeDateToIsoYmd(defaults?.startDate);
    const endDate = normalizeDateToIsoYmd(defaults?.endDate);
    const description = String(defaults?.description || "").trim();
    const students = Array.isArray(defaults?.students) ? defaults!.students : [];
    const studentIds = students.map((s) => s.id);
    const tasks = normalizeTeachingProjectTasks(defaults?.tasks || [], endDate, studentIds);
    const progress = defaults?.progress || {};

    db.prepare(
      `INSERT INTO teaching_final_projects (
        classId, teachingProjectId, projectName, startDate, endDate, description,
        tasksJson, studentsJson, progressJson, draftVersion, status, contentHash,
        createdAt, updatedAt
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, 1, 'DRAFT', '',
        datetime('now', 'localtime'), datetime('now', 'localtime')
      )`
    ).run(
      normalizedClassId,
      defaults?.teachingProjectId ?? null,
      projectName,
      startDate,
      endDate,
      description,
      JSON.stringify(tasks),
      JSON.stringify(students),
      JSON.stringify(progress)
    );

    return this.findOne(normalizedClassId)!;
  },

  syncRemoteMetadata(input: {
    classId: string;
    teachingProjectId?: number | null;
    students?: TeachingStudentItem[];
    progress?: Record<string, number>;
  }): TeachingFinalProjectRecord {
    const normalizedClassId = String(input.classId || "").trim().toUpperCase();
    const current = this.getOrInit(normalizedClassId);
    const nextProjectId =
      input.teachingProjectId !== undefined
        ? input.teachingProjectId
        : current.teachingProjectId ?? null;
    const nextStudentsJson =
      input.students !== undefined
        ? JSON.stringify(input.students)
        : current.studentsJson;
    const nextProgressJson =
      input.progress !== undefined
        ? JSON.stringify(input.progress)
        : current.progressJson;

    const db = getDb();
    db.prepare(
      `UPDATE teaching_final_projects
       SET teachingProjectId = ?,
           studentsJson = ?,
           progressJson = ?,
           updatedAt = datetime('now', 'localtime')
       WHERE classId = ?`
    ).run(nextProjectId, nextStudentsJson, nextProgressJson, normalizedClassId);

    return this.findOne(normalizedClassId)!;
  },

  saveDraft(input: {
    classId: string;
    teachingProjectId?: number | null;
    projectName?: string;
    startDate?: string;
    endDate?: string;
    description?: string;
    tasks?: TeachingProjectTaskItem[];
    students?: TeachingStudentItem[];
    progress?: Record<string, number>;
    expectedVersion?: number;
  }): {
    success: boolean;
    conflict?: boolean;
    currentVersion?: number;
    downgradedFromApproved?: boolean;
    error?: string;
    record: TeachingFinalProjectRecord;
  } {
    const normalizedClassId = String(input.classId || "").trim().toUpperCase();
    const current = this.getOrInit(normalizedClassId);

    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== null &&
      Number(input.expectedVersion) !== Number(current.draftVersion)
    ) {
      return {
        success: false,
        conflict: true,
        currentVersion: current.draftVersion,
        error: `Dữ liệu dự án lớp ${normalizedClassId} đã thay đổi ở phiên bản mới hơn (v${current.draftVersion}). Vui lòng tải lại trước khi lưu.`,
        record: current,
      };
    }

    const nextTeachingProjectId =
      input.teachingProjectId !== undefined
        ? input.teachingProjectId
        : current.teachingProjectId ?? null;
    const nextProjectName =
      input.projectName !== undefined
        ? String(input.projectName).trim()
        : current.projectName;
    const nextStartDate =
      input.startDate !== undefined
        ? normalizeDateToIsoYmd(input.startDate)
        : current.startDate;
    const nextEndDate =
      input.endDate !== undefined
        ? normalizeDateToIsoYmd(input.endDate)
        : current.endDate;
    const nextDescription =
      input.description !== undefined
        ? String(input.description).replace(/\r\n/g, "\n").trim()
        : current.description;

    let nextStudents: TeachingStudentItem[] = [];
    if (input.students !== undefined) {
      nextStudents = input.students;
    } else {
      try {
        nextStudents = JSON.parse(current.studentsJson || "[]");
      } catch {
        nextStudents = [];
      }
    }

    const nextTasks =
      input.tasks !== undefined
        ? normalizeTeachingProjectTasks(input.tasks)
        : normalizeTeachingProjectTasks(current.tasksJson);

    let nextProgress: Record<string, number> = {};
    if (input.progress !== undefined) {
      nextProgress = input.progress;
    } else {
      try {
        nextProgress = JSON.parse(current.progressJson || "{}");
      } catch {
        nextProgress = {};
      }
    }

    const oldHash = computeTeachingProjectHash({
      classId: normalizedClassId,
      projectName: current.projectName,
      startDate: current.startDate,
      endDate: current.endDate,
      description: current.description,
      tasks: current.tasksJson,
    });

    const newHash = computeTeachingProjectHash({
      classId: normalizedClassId,
      projectName: nextProjectName,
      startDate: nextStartDate,
      endDate: nextEndDate,
      description: nextDescription,
      tasks: nextTasks,
    });

    const contentChanged = newHash !== oldHash;
    let nextStatus: TeachingProjectStatus = current.status;
    let nextContentHash = current.contentHash;
    let downgradedFromApproved = false;

    if (current.status === "APPROVED" || current.status === "VERIFIED") {
      if (!current.contentHash || newHash !== current.contentHash) {
        nextStatus = "WAITING_APPROVAL";
        nextContentHash = "";
        downgradedFromApproved = true;
      }
    } else if (current.status === "FAILED" || current.status === "SAVING") {
      nextStatus = "WAITING_APPROVAL";
      nextContentHash = "";
    } else if (contentChanged && current.status === "DRAFT") {
      nextStatus = "WAITING_APPROVAL";
    }

    const nextVersion = contentChanged || downgradedFromApproved
      ? current.draftVersion + 1
      : current.draftVersion;

    const db = getDb();
    db.prepare(
      `UPDATE teaching_final_projects
       SET teachingProjectId = ?,
           projectName = ?,
           startDate = ?,
           endDate = ?,
           description = ?,
           tasksJson = ?,
           studentsJson = ?,
           progressJson = ?,
           draftVersion = ?,
           status = ?,
           contentHash = ?,
           errorMessage = CASE WHEN ? = 1 THEN 'Nội dung đã chỉnh sửa sau khi duyệt, cần bấm Duyệt lại.' ELSE errorMessage END,
           updatedAt = datetime('now', 'localtime')
       WHERE classId = ?`
    ).run(
      nextTeachingProjectId,
      nextProjectName,
      nextStartDate,
      nextEndDate,
      nextDescription,
      JSON.stringify(nextTasks),
      JSON.stringify(nextStudents),
      JSON.stringify(nextProgress),
      nextVersion,
      nextStatus,
      nextContentHash,
      downgradedFromApproved ? 1 : 0,
      normalizedClassId
    );

    return {
      success: true,
      downgradedFromApproved,
      record: this.findOne(normalizedClassId)!,
    };
  },

  approveDraft(
    classId: string,
    expectedVersion?: number
  ): {
    success: boolean;
    conflict?: boolean;
    currentVersion?: number;
    error?: string;
    record: TeachingFinalProjectRecord;
  } {
    const normalizedClassId = String(classId || "").trim().toUpperCase();
    const current = this.getOrInit(normalizedClassId);

    if (
      expectedVersion !== undefined &&
      expectedVersion !== null &&
      Number(expectedVersion) !== Number(current.draftVersion)
    ) {
      return {
        success: false,
        conflict: true,
        currentVersion: current.draftVersion,
        error: `Bản nháp dự án lớp ${normalizedClassId} đã thay đổi (v${current.draftVersion}). Vui lòng kiểm tra lại trước khi Duyệt.`,
        record: current,
      };
    }

    const validation = validateTeachingProjectForApproval({
      classId: normalizedClassId,
      projectName: current.projectName,
      startDate: current.startDate,
      endDate: current.endDate,
      description: current.description,
      tasks: current.tasksJson,
    });

    if (!validation.ok) {
      return {
        success: false,
        error: validation.reason,
        record: current,
      };
    }

    const hash = computeTeachingProjectHash({
      classId: normalizedClassId,
      projectName: current.projectName,
      startDate: current.startDate,
      endDate: current.endDate,
      description: current.description,
      tasks: validation.normalizedTasks,
    });

    const db = getDb();
    db.prepare(
      `UPDATE teaching_final_projects
       SET tasksJson = ?,
           status = 'APPROVED',
           contentHash = ?,
           errorMessage = NULL,
           updatedAt = datetime('now', 'localtime')
       WHERE classId = ?`
    ).run(JSON.stringify(validation.normalizedTasks), hash, normalizedClassId);

    return {
      success: true,
      record: this.findOne(normalizedClassId)!,
    };
  },

  markSaving(classId: string, expectedHash: string): TeachingFinalProjectRecord {
    const normalizedClassId = String(classId || "").trim().toUpperCase();
    const current = this.getOrInit(normalizedClassId);
    const liveHash = computeTeachingProjectHash({
      classId: normalizedClassId,
      projectName: current.projectName,
      startDate: current.startDate,
      endDate: current.endDate,
      description: current.description,
      tasks: current.tasksJson,
    });

    if (!expectedHash || liveHash !== expectedHash || current.contentHash !== expectedHash) {
      this.demoteToWaitingApproval(
        normalizedClassId,
        "Nội dung dự án đã thay đổi so với bản đã duyệt. Vui lòng bấm Duyệt lại."
      );
      throw new Error(
        `[teachingProjectRepo.markSaving] Sai lệch contentHash của lớp ${normalizedClassId}. Đã chặn đẩy lên Teaching.`
      );
    }

    const db = getDb();
    db.prepare(
      `UPDATE teaching_final_projects
       SET status = 'SAVING',
           errorMessage = NULL,
           updatedAt = datetime('now', 'localtime')
       WHERE classId = ?`
    ).run(normalizedClassId);

    return this.findOne(normalizedClassId)!;
  },

  markVerified(
    classId: string,
    expectedHash: string,
    verifiedMeta: {
      teachingProjectId: number;
      verifiedProject?: {
        projectName: string;
        startDate: string;
        endDate: string;
        description?: string;
      };
      verifiedTasks: TeachingProjectTaskItem[];
      verifiedSnapshot?: unknown;
    }
  ): TeachingFinalProjectRecord {
    const normalizedClassId = String(classId || "").trim().toUpperCase();
    const current = this.getOrInit(normalizedClassId);
    const currentHash = computeTeachingProjectHash({
      classId: normalizedClassId,
      projectName: current.projectName,
      startDate: current.startDate,
      endDate: current.endDate,
      description: current.description,
      tasks: current.tasksJson,
    });

    const verifiedProj = verifiedMeta.verifiedProject;
    const verifiedHash = computeTeachingProjectHash({
      classId: normalizedClassId,
      projectName: verifiedProj ? verifiedProj.projectName : current.projectName,
      startDate: verifiedProj ? verifiedProj.startDate : current.startDate,
      endDate: verifiedProj ? verifiedProj.endDate : current.endDate,
      description:
        verifiedProj && verifiedProj.description !== undefined
          ? verifiedProj.description
          : current.description,
      tasks: verifiedMeta.verifiedTasks,
    });

    if (!expectedHash || currentHash !== expectedHash || verifiedHash !== expectedHash) {
      this.demoteToWaitingApproval(
        normalizedClassId,
        "Nội dung dự án bị thay đổi hoặc không khớp với dữ liệu đối chiếu từ Teaching."
      );
      throw new Error(
        `[teachingProjectRepo.markVerified] Sai lệch mã băm nội dung dự án lớp ${normalizedClassId}. Đã chặn đánh dấu VERIFIED.`
      );
    }

    const db = getDb();
    db.prepare(
      `UPDATE teaching_final_projects
       SET teachingProjectId = ?,
           tasksJson = ?,
           status = 'VERIFIED',
           contentHash = ?,
           verifiedAt = datetime('now', 'localtime'),
           verifiedSnapshotJson = ?,
           errorMessage = NULL,
           updatedAt = datetime('now', 'localtime')
       WHERE classId = ?`
    ).run(
      verifiedMeta.teachingProjectId,
      JSON.stringify(verifiedMeta.verifiedTasks),
      expectedHash,
      JSON.stringify(verifiedMeta.verifiedSnapshot ?? {}),
      normalizedClassId
    );

    return this.findOne(normalizedClassId)!;
  },

  markFailed(classId: string, errorMessage: string): TeachingFinalProjectRecord {
    const normalizedClassId = String(classId || "").trim().toUpperCase();
    this.getOrInit(normalizedClassId);
    const db = getDb();
    db.prepare(
      `UPDATE teaching_final_projects
       SET status = 'FAILED',
           errorMessage = ?,
           updatedAt = datetime('now', 'localtime')
       WHERE classId = ?`
    ).run(errorMessage, normalizedClassId);
    return this.findOne(normalizedClassId)!;
  },

  demoteToWaitingApproval(classId: string, reason: string): TeachingFinalProjectRecord {
    const normalizedClassId = String(classId || "").trim().toUpperCase();
    this.getOrInit(normalizedClassId);
    const db = getDb();
    db.prepare(
      `UPDATE teaching_final_projects
       SET status = 'WAITING_APPROVAL',
           contentHash = '',
           errorMessage = ?,
           updatedAt = datetime('now', 'localtime')
       WHERE classId = ?`
    ).run(reason, normalizedClassId);
    return this.findOne(normalizedClassId)!;
  },

  updateProgressSnapshot(
    classId: string,
    progressMap: Record<string, number>
  ): TeachingFinalProjectRecord {
    const normalizedClassId = String(classId || "").trim().toUpperCase();
    this.getOrInit(normalizedClassId);
    const db = getDb();
    db.prepare(
      `UPDATE teaching_final_projects
       SET progressJson = ?,
           updatedAt = datetime('now', 'localtime')
       WHERE classId = ?`
    ).run(JSON.stringify(progressMap || {}), normalizedClassId);
    return this.findOne(normalizedClassId)!;
  },
};

// ============================================================================
// 10. CLASS REPORT CARDS REPOSITORY (v3.3.0 Teaching Report Card & Overrides)
// ============================================================================

import {
  computeClassReportCard,
  isValidOverrideFieldKey,
  makeOverrideKey,
  normalizeScoreToScale5,
  round2,
  type ClassReportCardLmsSnapshot,
  type ManualScoreOverrideEntry,
  type ManualScoreOverrideMap,
} from "../report-card/report-card-calculator";

export type ReportCardApprovalStatus =
  | "DRAFT"
  | "WAITING_APPROVAL"
  | "APPROVED"
  | "SAVING"
  | "VERIFIED"
  | "FAILED";

export type TeachingReportCardSyncStatus =
  | "NOT_SYNCED"
  | "SYNCING"
  | "VERIFIED"
  | "OUT_OF_SYNC"
  | "FAILED";

export interface ClassReportCardRecord {
  id: number;
  classId: string;
  classCode: string;
  lmsSnapshotJson: string;
  manualOverridesJson: string;
  selectedBtvnSessionsJson: string;
  draftVersion: number;
  status: ReportCardApprovalStatus;
  contentHash: string;
  teachingSyncStatus: TeachingReportCardSyncStatus;
  teachingSyncedAt: string | null;
  teachingVerifiedSnapshotJson: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export function parseReportCardLmsSnapshot(
  rawJson: string | null | undefined,
  fallbackClassId = ""
): ClassReportCardLmsSnapshot | null {
  if (!rawJson || !rawJson.trim() || rawJson.trim() === "{}") return null;
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (!Array.isArray(parsed.students)) return null;
    const normClassId = String(parsed.classId || fallbackClassId || "")
      .trim()
      .toUpperCase();
    return {
      classId: normClassId,
      classCode: String(parsed.classCode || normClassId).trim().toUpperCase(),
      lmsClassId: parsed.lmsClassId ? String(parsed.lmsClassId) : undefined,
      isRobotics: Boolean(parsed.isRobotics ?? isRoboticsClassCode(normClassId)),
      btvnSessions: Array.isArray(parsed.btvnSessions) ? parsed.btvnSessions : [],
      students: parsed.students,
      scrapedAt: String(parsed.scrapedAt || ""),
    };
  } catch {
    return null;
  }
}

export function parseManualOverridesMap(
  rawJson: string | null | undefined
): ManualScoreOverrideMap {
  if (!rawJson || !rawJson.trim()) return {};
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: ManualScoreOverrideMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      const entry = v as Record<string, unknown>;
      const studentId = String(entry.studentId || "").trim();
      const fieldKey = String(entry.fieldKey || "").trim();
      if (!studentId || !isValidOverrideFieldKey(fieldKey)) continue;
      const isStageField = !/^btvn_(\d+)_(theory|practice)$/.test(fieldKey);
      const normScore =
        entry.normScore === null
          ? null
          : typeof entry.normScore === "number" &&
            Number.isFinite(entry.normScore) &&
            entry.normScore >= 0 &&
            entry.normScore <= 5
          ? round2(entry.normScore)
          : undefined;
      if (normScore === undefined) continue;

      const maxScore = isStageField
        ? 5
        : typeof entry.maxScore === "number" &&
          Number.isFinite(entry.maxScore) &&
          entry.maxScore > 0
        ? entry.maxScore
        : undefined;

      let rawScore: number | null | undefined = undefined;
      if (normScore === null) {
        rawScore = null;
      } else if (
        typeof entry.rawScore === "number" &&
        Number.isFinite(entry.rawScore) &&
        entry.rawScore >= 0
      ) {
        const effMax = maxScore ?? (isStageField ? 5 : 100);
        if (entry.rawScore <= effMax) {
          const checkNorm =
            effMax === 5
              ? round2(entry.rawScore)
              : normalizeScoreToScale5(entry.rawScore, effMax);
          if (checkNorm === normScore) {
            rawScore = round2(entry.rawScore);
          }
        }
      }

      out[k] = {
        studentId,
        fieldKey,
        normScore,
        rawScore,
        maxScore,
        note: typeof entry.note === "string" ? entry.note : undefined,
        updatedAt: String(entry.updatedAt || ""),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Computes canonical SHA-256 contentHash over all effective report card metadata and scores
 * (merging LMS snapshot + teacher manual overrides) for Data Integrity & Drift Detection.
 */
export function computeReportCardContentHash(
  snapshot: ClassReportCardLmsSnapshot | null,
  overrides: ManualScoreOverrideMap
): string {
  if (!snapshot || !Array.isArray(snapshot.students) || snapshot.students.length === 0) {
    return "";
  }
  const computed = computeClassReportCard(snapshot, overrides, {
    includeInactiveStudents: false,
  });
  const canonicalPayload = {
    classId: computed.classId.trim().toUpperCase(),
    classCode: computed.classCode.trim().toUpperCase(),
    isRobotics: computed.isRobotics,
    btvnSessions: computed.isRobotics
      ? []
      : computed.btvnSessions.map((s) => ({
          sessionNumber: s.sessionNumber,
          title: String(s.title || "").trim(),
          hasTheory: Boolean(s.hasTheory),
          hasPractice: Boolean(s.hasPractice),
          practiceTaskCount: s.practiceTaskCount ?? (s.hasPractice ? 1 : 0),
          maxTheoryScore: s.maxTheoryScore ?? 100,
          maxPracticeScore: s.maxPracticeScore ?? 100,
        })),
    students: computed.students.map((stu) => ({
      studentId: stu.studentId,
      studentUid: stu.studentUid ?? "",
      fullName: stu.fullName.trim(),
      btvn: computed.isRobotics
        ? {}
        : Object.fromEntries(
            computed.btvnSessions.map((s) => {
              const cell = stu.btvnCells[s.sessionNumber];
              return [
                String(s.sessionNumber),
                {
                  theoryRaw: cell?.theoryRaw ?? null,
                  theoryMax: cell?.theoryMax ?? 100,
                  theoryNorm: cell?.theoryNorm ?? null,
                  isTheoryOverridden: cell?.isTheoryOverridden ?? false,
                  theoryNote: cell?.theoryNote ?? "",
                  practiceRaw: cell?.practiceRaw ?? null,
                  practiceMax: cell?.practiceMax ?? 100,
                  practiceNorm: cell?.practiceNorm ?? null,
                  isPracticeOverridden: cell?.isPracticeOverridden ?? false,
                  practiceTask1Raw: cell?.practiceTask1Raw ?? null,
                  practiceTask2Raw: cell?.practiceTask2Raw ?? null,
                  practiceNote: cell?.practiceNote ?? "",
                },
              ];
            })
          ),
      submittedCount: stu.submittedCount,
      totalAssignedItems: stu.totalAssignedItems,
      btvnAvgNorm: stu.btvnAvgNorm,
      btvnAvgRaw: stu.btvnAvgRaw,
      cp1: {
        lt: stu.cp1.theory.value,
        ltNote: stu.cp1.theory.note ?? "",
        th: stu.cp1.practice.value,
        thNote: stu.cp1.practice.note ?? "",
        nl: stu.cp1.competency.value,
        nlNote: stu.cp1.competency.note ?? "",
        total: stu.cp1.total,
        chartAvg: stu.cp1.chartAvg,
      },
      cp2: {
        lt: stu.cp2.theory.value,
        ltNote: stu.cp2.theory.note ?? "",
        th: stu.cp2.practice.value,
        thNote: stu.cp2.practice.note ?? "",
        nl: stu.cp2.competency.value,
        nlNote: stu.cp2.competency.note ?? "",
        total: stu.cp2.total,
        chartAvg: stu.cp2.chartAvg,
      },
      final: {
        sp: stu.final.product.value,
        spNote: stu.final.product.note ?? "",
        nl: stu.final.competency.value,
        nlNote: stu.final.competency.note ?? "",
        total: stu.final.total,
        chartAvg: stu.final.chartAvg,
      },
      tbck: stu.tbck,
      xepLoai: stu.xepLoai,
      hang: stu.hang,
      rankCode: stu.rankCode,
      hasMissingOrZeroComponent: stu.hasMissingOrZeroComponent,
    })),
  };
  return calculateSha256(JSON.stringify(canonicalPayload));
}

function computeNextApprovalAndSyncState(
  current: ClassReportCardRecord,
  newHash: string
): {
  nextStatus: ReportCardApprovalStatus;
  nextSyncStatus: TeachingReportCardSyncStatus;
  nextContentHash: string;
} {
  let nextStatus: ReportCardApprovalStatus = current.status;
  let nextSyncStatus: TeachingReportCardSyncStatus = current.teachingSyncStatus;
  let nextContentHash = current.contentHash;

  const hasExistingApprovalOrSync =
    Boolean(current.contentHash) ||
    current.status === "APPROVED" ||
    current.status === "VERIFIED" ||
    current.status === "FAILED";

  if (hasExistingApprovalOrSync && newHash !== current.contentHash) {
    nextStatus = "WAITING_APPROVAL";
    nextContentHash = "";
    if (current.teachingSyncStatus === "VERIFIED") {
      nextSyncStatus = "OUT_OF_SYNC";
    } else if (current.teachingSyncStatus === "SYNCING") {
      nextSyncStatus = "FAILED";
    }
  }

  return { nextStatus, nextSyncStatus, nextContentHash };
}

export const reportCardRepo = {
  findOne(classId: string): ClassReportCardRecord | undefined {
    const normalizedClassId = String(classId || "").trim().toUpperCase();
    if (!normalizedClassId) return undefined;
    const db = getDb();
    return db
      .prepare(`SELECT * FROM class_report_cards WHERE classId = ?`)
      .get(normalizedClassId) as ClassReportCardRecord | undefined;
  },

  getOrInit(classId: string): ClassReportCardRecord {
    const normalizedClassId = String(classId || "").trim().toUpperCase();
    if (!normalizedClassId) {
      throw new Error("Thiếu mã lớp (classId) khi khởi tạo Phiếu Điểm Tổng Kết.");
    }
    const existing = this.findOne(normalizedClassId);
    if (existing) return existing;

    const db = getDb();
    db.prepare(
      `INSERT INTO class_report_cards (
        classId, classCode, lmsSnapshotJson, manualOverridesJson, selectedBtvnSessionsJson,
        draftVersion, status, contentHash, teachingSyncStatus
      ) VALUES (?, ?, '{}', '{}', '[]', 1, 'DRAFT', '', 'NOT_SYNCED')
      ON CONFLICT(classId) DO NOTHING`
    ).run(normalizedClassId, normalizedClassId);

    return this.findOne(normalizedClassId)!;
  },

  /**
   * Saves a fresh LMS snapshot while strictly preserving all teacher manual overrides (`manualOverridesJson`).
   * Validates snapshot class identity and automatically detects drift against previously approved/verified contentHash.
   */
  saveLmsSnapshot(
    classId: string,
    snapshot: ClassReportCardLmsSnapshot
  ): ClassReportCardRecord {
    const normalizedClassId = String(classId || "").trim().toUpperCase();
    if (!normalizedClassId) {
      throw new Error("Thiếu mã lớp (classId) khi lưu dữ liệu điểm LMS.");
    }
    if (!snapshot || typeof snapshot !== "object") {
      throw new Error("Dữ liệu snapshot LMS không hợp lệ.");
    }

    const snapClassId = String(snapshot.classId || "").trim().toUpperCase();
    const snapClassCode = String(snapshot.classCode || "").trim().toUpperCase();
    if (snapClassId && snapClassId !== normalizedClassId) {
      throw new Error(
        `[reportCardRepo.saveLmsSnapshot] Sai lệch mã lớp: tham số classId='${normalizedClassId}' nhưng snapshot.classId='${snapClassId}'.`
      );
    }
    if (snapClassCode && snapClassCode !== normalizedClassId) {
      throw new Error(
        `[reportCardRepo.saveLmsSnapshot] Sai lệch mã lớp: tham số classId='${normalizedClassId}' nhưng snapshot.classCode='${snapClassCode}'.`
      );
    }

    const db = getDb();
    const tx = db.transaction(() => {
      const current = this.getOrInit(normalizedClassId);
      if (current.status === "SAVING" || current.teachingSyncStatus === "SYNCING") {
        throw new Error(
          `[reportCardRepo.saveLmsSnapshot] Phiếu điểm lớp ${normalizedClassId} đang đồng bộ lên Teaching (SAVING). Không thể ghi đè snapshot lúc này.`
        );
      }

      const existingOverrides = parseManualOverridesMap(current.manualOverridesJson);

      const cleanSnapshot: ClassReportCardLmsSnapshot = {
        ...snapshot,
        classId: normalizedClassId,
        classCode: normalizedClassId,
        isRobotics: Boolean(snapshot.isRobotics ?? isRoboticsClassCode(normalizedClassId)),
      };

      let selectedSessions: number[] = [];
      try {
        const parsedSel = JSON.parse(current.selectedBtvnSessionsJson || "[]");
        if (Array.isArray(parsedSel) && parsedSel.length > 0) {
          const validSet = new Set(cleanSnapshot.btvnSessions.map((s) => s.sessionNumber));
          selectedSessions = parsedSel
            .map((n) => Number(n))
            .filter((n) => Number.isInteger(n) && validSet.has(n));
        }
      } catch {
        selectedSessions = [];
      }
      if (selectedSessions.length === 0) {
        selectedSessions = cleanSnapshot.btvnSessions.map((s) => s.sessionNumber);
      }

      const newHash = computeReportCardContentHash(cleanSnapshot, existingOverrides);
      const { nextStatus, nextSyncStatus, nextContentHash } =
        computeNextApprovalAndSyncState(current, newHash);

      db.prepare(
        `UPDATE class_report_cards
         SET classCode = ?,
             lmsSnapshotJson = ?,
             selectedBtvnSessionsJson = ?,
             draftVersion = draftVersion + 1,
             status = ?,
             contentHash = ?,
             teachingSyncStatus = ?,
             errorMessage = NULL,
             updatedAt = datetime('now', 'localtime')
         WHERE classId = ?`
      ).run(
        cleanSnapshot.classCode,
        JSON.stringify(cleanSnapshot),
        JSON.stringify(selectedSessions),
        nextStatus,
        nextContentHash,
        nextSyncStatus,
        normalizedClassId
      );
    });

    tx();
    return this.findOne(normalizedClassId)!;
  },

  /**
   * Saves or updates a single manual score override (or batch of overrides) with atomic optimistic locking
   * and strict raw/norm/max score validation.
   */
  saveManualOverrides(params: {
    classId: string;
    expectedVersion?: number;
    updates: Array<{
      studentId: string;
      fieldKey: string;
      normScore: number | null;
      rawScore?: number | null;
      maxScore?: number;
      note?: string;
    }>;
  }): {
    success: boolean;
    conflict?: boolean;
    currentVersion?: number;
    error?: string;
    record: ClassReportCardRecord;
  } {
    const normalizedClassId = String(params.classId || "").trim().toUpperCase();
    if (!normalizedClassId) {
      throw new Error("Thiếu mã lớp (classId).");
    }

    const db = getDb();
    const tx = db.transaction(
      (): {
        success: boolean;
        conflict?: boolean;
        currentVersion?: number;
        error?: string;
        record: ClassReportCardRecord;
      } => {
        const current = this.getOrInit(normalizedClassId);

        if (current.status === "SAVING" || current.teachingSyncStatus === "SYNCING") {
          return {
            success: false,
            conflict: true,
            currentVersion: current.draftVersion,
            error: `Phiếu điểm lớp ${normalizedClassId} đang đồng bộ lên Teaching (SAVING). Vui lòng chờ hoàn tất trước khi chỉnh sửa.`,
            record: current,
          };
        }

        if (
          params.expectedVersion === undefined ||
          params.expectedVersion === null ||
          !Number.isInteger(Number(params.expectedVersion)) ||
          Number(params.expectedVersion) < 1
        ) {
          return {
            success: false,
            currentVersion: current.draftVersion,
            error: "Thiếu phiên bản dữ liệu hợp lệ (expectedVersion).",
            record: current,
          };
        }

        const expectedVer = Number(params.expectedVersion);
        if (expectedVer !== Number(current.draftVersion)) {
          return {
            success: false,
            conflict: true,
            currentVersion: current.draftVersion,
            error: `Dữ liệu phiếu điểm lớp ${normalizedClassId} đã thay đổi ở phiên khác (v${current.draftVersion}). Vui lòng tải lại trước khi lưu.`,
            record: current,
          };
        }

        if (!Array.isArray(params.updates) || params.updates.length === 0) {
          return {
            success: false,
            currentVersion: current.draftVersion,
            error: "Danh sách ô điểm cần cập nhật trống.",
            record: current,
          };
        }

        const snapshot = parseReportCardLmsSnapshot(current.lmsSnapshotJson, normalizedClassId);
        const validStudentIds = new Set(
          (snapshot?.students || []).map((s) => String(s.studentId || "").trim())
        );
        for (const st of studentRepo.findByClass(normalizedClassId, false)) {
          validStudentIds.add(st.studentId);
        }

        const overrides = parseManualOverridesMap(current.manualOverridesJson);
        const nowIso = new Date().toISOString();

        for (const item of params.updates) {
          const studentId = String(item.studentId || "").trim();
          const fieldKey = String(item.fieldKey || "").trim();
          if (!studentId) {
            return {
              success: false,
              currentVersion: current.draftVersion,
              error: "Thiếu mã học viên (studentId) khi cập nhật điểm.",
              record: current,
            };
          }
          if (validStudentIds.size > 0 && !validStudentIds.has(studentId)) {
            return {
              success: false,
              currentVersion: current.draftVersion,
              error: `Học viên '${studentId}' không thuộc danh sách lớp ${normalizedClassId}.`,
              record: current,
            };
          }
          if (!isValidOverrideFieldKey(fieldKey)) {
            return {
              success: false,
              currentVersion: current.draftVersion,
              error: `Trường điểm '${fieldKey}' không hợp lệ.`,
              record: current,
            };
          }

          const btvnMatch = /^btvn_(\d+)_(theory|practice)$/.exec(fieldKey);
          const isStageField = !btvnMatch;

          let effectiveMaxScore = 5;
          if (isStageField) {
            if (
              item.maxScore !== undefined &&
              item.maxScore !== null &&
              (typeof item.maxScore !== "number" ||
                !Number.isFinite(item.maxScore) ||
                item.maxScore !== 5)
            ) {
              return {
                success: false,
                currentVersion: current.draftVersion,
                error: `Trường điểm giai đoạn '${fieldKey}' chỉ sử dụng thang điểm tối đa là 5 (nhận được maxScore=${item.maxScore}).`,
                record: current,
              };
            }
          } else {
            const sessionNum = Number(btvnMatch![1]);
            const kind = btvnMatch![2] as "theory" | "practice";
            if (item.maxScore !== undefined) {
              if (
                item.maxScore === null ||
                typeof item.maxScore !== "number" ||
                !Number.isFinite(item.maxScore) ||
                item.maxScore <= 0
              ) {
                return {
                  success: false,
                  currentVersion: current.draftVersion,
                  error: `Thang điểm tối đa (maxScore) của '${fieldKey}' không hợp lệ (${item.maxScore}).`,
                  record: current,
                };
              }
              effectiveMaxScore = item.maxScore;
            } else {
              const stuSnap = (snapshot?.students || []).find(
                (s) => String(s.studentId || "").trim() === studentId
              );
              const cellSnap = stuSnap?.btvnScores?.[sessionNum];
              const sessMeta = (snapshot?.btvnSessions || []).find(
                (s) => s.sessionNumber === sessionNum
              );
              const fallbackMax =
                kind === "theory"
                  ? cellSnap?.theoryMax ?? sessMeta?.maxTheoryScore ?? 100
                  : cellSnap?.practiceMax ?? sessMeta?.maxPracticeScore ?? 100;
              effectiveMaxScore =
                typeof fallbackMax === "number" && Number.isFinite(fallbackMax) && fallbackMax > 0
                  ? fallbackMax
                  : 100;
            }
          }

          let normalizedNorm: number | null = null;
          let normalizedRaw: number | null = null;

          if (item.normScore === null) {
            if (item.rawScore !== undefined && item.rawScore !== null) {
              return {
                success: false,
                currentVersion: current.draftVersion,
                error: `Không thể truyền điểm gốc (rawScore=${item.rawScore}) khi điểm quy đổi (normScore) là null cho '${fieldKey}'.`,
                record: current,
              };
            }
            normalizedNorm = null;
            normalizedRaw = null;
          } else {
            if (
              typeof item.normScore !== "number" ||
              !Number.isFinite(item.normScore) ||
              item.normScore < 0 ||
              item.normScore > 5
            ) {
              return {
                success: false,
                currentVersion: current.draftVersion,
                error: `Điểm quy đổi thang 5 của '${fieldKey}' (${item.normScore}) không hợp lệ (yêu cầu từ 0 đến 5).`,
                record: current,
              };
            }
            normalizedNorm = round2(item.normScore);

            if (item.rawScore !== undefined) {
              if (
                item.rawScore === null ||
                typeof item.rawScore !== "number" ||
                !Number.isFinite(item.rawScore) ||
                item.rawScore < 0 ||
                item.rawScore > effectiveMaxScore
              ) {
                return {
                  success: false,
                  currentVersion: current.draftVersion,
                  error: `Điểm gốc (rawScore=${item.rawScore}) của '${fieldKey}' không hợp lệ (yêu cầu trong khoảng 0 đến ${effectiveMaxScore}).`,
                  record: current,
                };
              }
              const expectedNormFromRaw =
                effectiveMaxScore === 5
                  ? round2(item.rawScore)
                  : normalizeScoreToScale5(item.rawScore, effectiveMaxScore);
              if (expectedNormFromRaw !== normalizedNorm) {
                return {
                  success: false,
                  currentVersion: current.draftVersion,
                  error: `Điểm gốc (${item.rawScore}/${effectiveMaxScore} -> ${expectedNormFromRaw}) mâu thuẫn với điểm thang 5 (${normalizedNorm}) ở '${fieldKey}'.`,
                  record: current,
                };
              }
              normalizedRaw = round2(item.rawScore);
            } else {
              normalizedRaw =
                effectiveMaxScore === 5
                  ? normalizedNorm
                  : round2((normalizedNorm / 5) * effectiveMaxScore);
            }
          }

          const key = makeOverrideKey(studentId, fieldKey);
          overrides[key] = {
            studentId,
            fieldKey,
            normScore: normalizedNorm,
            rawScore: normalizedRaw,
            maxScore: effectiveMaxScore,
            note: typeof item.note === "string" ? item.note : undefined,
            updatedAt: nowIso,
          };
        }

        const newHash = computeReportCardContentHash(snapshot, overrides);
        const { nextStatus, nextSyncStatus, nextContentHash } =
          computeNextApprovalAndSyncState(current, newHash);

        const info = db
          .prepare(
            `UPDATE class_report_cards
             SET manualOverridesJson = ?,
                 draftVersion = draftVersion + 1,
                 status = ?,
                 contentHash = ?,
                 teachingSyncStatus = ?,
                 errorMessage = NULL,
                 updatedAt = datetime('now', 'localtime')
             WHERE classId = ? AND draftVersion = ?`
          )
          .run(
            JSON.stringify(overrides),
            nextStatus,
            nextContentHash,
            nextSyncStatus,
            normalizedClassId,
            expectedVer
          );

        if (info.changes !== 1) {
          const latest = this.getOrInit(normalizedClassId);
          return {
            success: false,
            conflict: true,
            currentVersion: latest.draftVersion,
            error: `Dữ liệu phiếu điểm lớp ${normalizedClassId} đã thay đổi đồng thời (v${latest.draftVersion}). Vui lòng tải lại.`,
            record: latest,
          };
        }

        return {
          success: true,
          record: this.findOne(normalizedClassId)!,
        };
      }
    );

    return tx();
  },

  /**
   * Restores overridden cells back to original LMS values with atomic optimistic locking.
   * If `studentId` and `fieldKey` are given, restores that single cell.
   * If only `studentId` is given, restores all cells for that student.
   * If `studentId === "*"`, restores all cells for the entire class.
   */
  restoreLmsValues(params: {
    classId: string;
    expectedVersion?: number;
    studentId: string;
    fieldKey?: string;
  }): {
    success: boolean;
    conflict?: boolean;
    currentVersion?: number;
    error?: string;
    record: ClassReportCardRecord;
  } {
    const normalizedClassId = String(params.classId || "").trim().toUpperCase();
    if (!normalizedClassId) {
      throw new Error("Thiếu mã lớp (classId).");
    }

    const db = getDb();
    const tx = db.transaction(
      (): {
        success: boolean;
        conflict?: boolean;
        currentVersion?: number;
        error?: string;
        record: ClassReportCardRecord;
      } => {
        const current = this.getOrInit(normalizedClassId);

        if (current.status === "SAVING" || current.teachingSyncStatus === "SYNCING") {
          return {
            success: false,
            conflict: true,
            currentVersion: current.draftVersion,
            error: `Phiếu điểm lớp ${normalizedClassId} đang đồng bộ lên Teaching (SAVING). Không thể khôi phục điểm lúc này.`,
            record: current,
          };
        }

        if (
          params.expectedVersion === undefined ||
          params.expectedVersion === null ||
          !Number.isInteger(Number(params.expectedVersion)) ||
          Number(params.expectedVersion) < 1
        ) {
          return {
            success: false,
            currentVersion: current.draftVersion,
            error: "Thiếu phiên bản dữ liệu hợp lệ (expectedVersion).",
            record: current,
          };
        }

        const expectedVer = Number(params.expectedVersion);
        if (expectedVer !== Number(current.draftVersion)) {
          return {
            success: false,
            conflict: true,
            currentVersion: current.draftVersion,
            error: `Dữ liệu phiếu điểm lớp ${normalizedClassId} đã thay đổi (v${current.draftVersion}). Vui lòng tải lại.`,
            record: current,
          };
        }

        const overrides = parseManualOverridesMap(current.manualOverridesJson);
        const stuId = String(params.studentId || "").trim();
        const fKey = params.fieldKey ? String(params.fieldKey).trim() : undefined;

        if (stuId === "*") {
          for (const k of Object.keys(overrides)) {
            delete overrides[k];
          }
        } else if (fKey) {
          delete overrides[makeOverrideKey(stuId, fKey)];
        } else {
          for (const [k, v] of Object.entries(overrides)) {
            if (v.studentId === stuId) {
              delete overrides[k];
            }
          }
        }

        const snapshot = parseReportCardLmsSnapshot(current.lmsSnapshotJson, normalizedClassId);
        const newHash = computeReportCardContentHash(snapshot, overrides);
        const { nextStatus, nextSyncStatus, nextContentHash } =
          computeNextApprovalAndSyncState(current, newHash);

        const info = db
          .prepare(
            `UPDATE class_report_cards
             SET manualOverridesJson = ?,
                 draftVersion = draftVersion + 1,
                 status = ?,
                 contentHash = ?,
                 teachingSyncStatus = ?,
                 errorMessage = NULL,
                 updatedAt = datetime('now', 'localtime')
             WHERE classId = ? AND draftVersion = ?`
          )
          .run(
            JSON.stringify(overrides),
            nextStatus,
            nextContentHash,
            nextSyncStatus,
            normalizedClassId,
            expectedVer
          );

        if (info.changes !== 1) {
          const latest = this.getOrInit(normalizedClassId);
          return {
            success: false,
            conflict: true,
            currentVersion: latest.draftVersion,
            error: `Dữ liệu phiếu điểm lớp ${normalizedClassId} đã thay đổi đồng thời (v${latest.draftVersion}). Vui lòng tải lại.`,
            record: latest,
          };
        }

        return {
          success: true,
          record: this.findOne(normalizedClassId)!,
        };
      }
    );

    return tx();
  },

  approveReportCard(
    classId: string,
    expectedVersion: number
  ): {
    success: boolean;
    conflict?: boolean;
    currentVersion?: number;
    error?: string;
    record: ClassReportCardRecord;
  } {
    const normalizedClassId = String(classId || "").trim().toUpperCase();
    if (!normalizedClassId) {
      throw new Error("Thiếu mã lớp (classId).");
    }

    const db = getDb();
    const tx = db.transaction(
      (): {
        success: boolean;
        conflict?: boolean;
        currentVersion?: number;
        error?: string;
        record: ClassReportCardRecord;
      } => {
        const current = this.getOrInit(normalizedClassId);

        if (current.status === "SAVING" || current.teachingSyncStatus === "SYNCING") {
          return {
            success: false,
            conflict: true,
            currentVersion: current.draftVersion,
            error: `Phiếu điểm lớp ${normalizedClassId} đang đồng bộ lên Teaching (SAVING). Vui lòng chờ hoàn tất.`,
            record: current,
          };
        }

        if (
          expectedVersion === undefined ||
          expectedVersion === null ||
          !Number.isInteger(Number(expectedVersion)) ||
          Number(expectedVersion) < 1
        ) {
          return {
            success: false,
            currentVersion: current.draftVersion,
            error: "Thiếu phiên bản dữ liệu hợp lệ (expectedVersion) khi duyệt phiếu điểm.",
            record: current,
          };
        }

        const expectedVer = Number(expectedVersion);
        if (expectedVer !== Number(current.draftVersion)) {
          return {
            success: false,
            conflict: true,
            currentVersion: current.draftVersion,
            error: `Bản nháp phiếu điểm lớp ${normalizedClassId} đã thay đổi (v${current.draftVersion}). Vui lòng kiểm tra lại trước khi Duyệt.`,
            record: current,
          };
        }

        const snapshot = parseReportCardLmsSnapshot(current.lmsSnapshotJson, normalizedClassId);
        if (!snapshot || !Array.isArray(snapshot.students) || snapshot.students.length === 0) {
          return {
            success: false,
            currentVersion: current.draftVersion,
            error: `Lớp ${normalizedClassId} chưa có dữ liệu bảng điểm để duyệt.`,
            record: current,
          };
        }

        const overrides = parseManualOverridesMap(current.manualOverridesJson);
        const hash = computeReportCardContentHash(snapshot, overrides);

        const info = db
          .prepare(
            `UPDATE class_report_cards
             SET status = 'APPROVED',
                 contentHash = ?,
                 errorMessage = NULL,
                 updatedAt = datetime('now', 'localtime')
             WHERE classId = ? AND draftVersion = ?`
          )
          .run(hash, normalizedClassId, expectedVer);

        if (info.changes !== 1) {
          const latest = this.getOrInit(normalizedClassId);
          return {
            success: false,
            conflict: true,
            currentVersion: latest.draftVersion,
            error: `Bản nháp phiếu điểm lớp ${normalizedClassId} đã thay đổi đồng thời (v${latest.draftVersion}). Vui lòng kiểm tra lại trước khi Duyệt.`,
            record: latest,
          };
        }

        return {
          success: true,
          record: this.findOne(normalizedClassId)!,
        };
      }
    );

    return tx();
  },

  markSyncingTeaching(
    classId: string,
    expectedHash: string,
    expectedVersion?: number
  ): ClassReportCardRecord {
    const normalizedClassId = String(classId || "").trim().toUpperCase();
    const db = getDb();
    const tx = db.transaction(
      (): { ok: true; record: ClassReportCardRecord } | { ok: false; errorMsg: string } => {
        const current = this.getOrInit(normalizedClassId);
        if (
          expectedVersion !== undefined &&
          current.draftVersion !== expectedVersion
        ) {
          return {
            ok: false,
            errorMsg: `[reportCardRepo.markSyncingTeaching] Phiên bản phiếu điểm lớp ${normalizedClassId} đã thay đổi (v${current.draftVersion} !== v${expectedVersion}).`,
          };
        }
        const snapshot = parseReportCardLmsSnapshot(current.lmsSnapshotJson, normalizedClassId);
        const overrides = parseManualOverridesMap(current.manualOverridesJson);
        const liveHash = computeReportCardContentHash(snapshot, overrides);

        if (
          !expectedHash ||
          liveHash !== expectedHash ||
          current.contentHash !== expectedHash ||
          (current.status !== "APPROVED" &&
            current.status !== "VERIFIED" &&
            current.status !== "FAILED")
        ) {
          const nextSyncStatus: TeachingReportCardSyncStatus =
            current.teachingSyncStatus === "VERIFIED"
              ? "OUT_OF_SYNC"
              : current.teachingSyncStatus === "SYNCING"
              ? "FAILED"
              : current.teachingSyncStatus;
          db.prepare(
            `UPDATE class_report_cards
             SET status = 'WAITING_APPROVAL',
                 contentHash = '',
                 teachingSyncStatus = ?,
                 errorMessage = ?,
                 updatedAt = datetime('now', 'localtime')
             WHERE classId = ?`
          ).run(
            nextSyncStatus,
            "Nội dung phiếu điểm đã thay đổi hoặc chưa được duyệt. Vui lòng kiểm tra và bấm Duyệt lại.",
            normalizedClassId
          );
          return {
            ok: false,
            errorMsg: `[reportCardRepo.markSyncingTeaching] Sai lệch contentHash hoặc trạng thái duyệt của lớp ${normalizedClassId}. Đã chặn đẩy lên Teaching.`,
          };
        }

        db.prepare(
          `UPDATE class_report_cards
           SET status = 'SAVING',
               teachingSyncStatus = 'SYNCING',
               errorMessage = NULL,
               updatedAt = datetime('now', 'localtime')
           WHERE classId = ?`
        ).run(normalizedClassId);

        return { ok: true, record: this.findOne(normalizedClassId)! };
      }
    );

    const res = tx();
    if (!res.ok) {
      throw new Error(res.errorMsg);
    }
    return res.record;
  },

  markTeachingVerified(
    classId: string,
    expectedHash: string,
    verifiedSnapshot: unknown,
    expectedVersion?: number
  ): ClassReportCardRecord {
    const normalizedClassId = String(classId || "").trim().toUpperCase();
    const db = getDb();
    const tx = db.transaction(
      (): { ok: true; record: ClassReportCardRecord } | { ok: false; errorMsg: string } => {
        const current = this.getOrInit(normalizedClassId);
        const snapshot = parseReportCardLmsSnapshot(current.lmsSnapshotJson, normalizedClassId);
        const overrides = parseManualOverridesMap(current.manualOverridesJson);
        const liveHash = computeReportCardContentHash(snapshot, overrides);

        if (!expectedHash || liveHash !== expectedHash || current.contentHash !== expectedHash) {
          const nextSyncStatus: TeachingReportCardSyncStatus =
            current.teachingSyncStatus === "VERIFIED" ? "OUT_OF_SYNC" : "FAILED";
          db.prepare(
            `UPDATE class_report_cards
             SET status = 'WAITING_APPROVAL',
                 contentHash = '',
                 teachingSyncStatus = ?,
                 errorMessage = ?,
                 updatedAt = datetime('now', 'localtime')
             WHERE classId = ?`
          ).run(
            nextSyncStatus,
            "Nội dung phiếu điểm đã thay đổi trong quá trình đồng bộ Teaching. Vui lòng kiểm tra và bấm Duyệt lại.",
            normalizedClassId
          );
          return {
            ok: false,
            errorMsg: `[reportCardRepo.markTeachingVerified] Sai lệch contentHash của lớp ${normalizedClassId} khi xác nhận đồng bộ Teaching.`,
          };
        }

        if (
          expectedVersion !== undefined &&
          current.draftVersion !== expectedVersion
        ) {
          return {
            ok: false,
            errorMsg: `[reportCardRepo.markTeachingVerified] Phiên bản phiếu điểm lớp ${normalizedClassId} đã thay đổi trong khi đồng bộ (v${current.draftVersion} !== v${expectedVersion}).`,
          };
        }

        if (
          current.status !== "SAVING" ||
          current.teachingSyncStatus !== "SYNCING"
        ) {
          return {
            ok: false,
            errorMsg: `[reportCardRepo.markTeachingVerified] Trạng thái lớp ${normalizedClassId} không còn ở SAVING/SYNCING (status=${current.status}, sync=${current.teachingSyncStatus}). Chặn ghi đè VERIFIED.`,
          };
        }

        const updateRes = db.prepare(
          `UPDATE class_report_cards
           SET status = 'VERIFIED',
               teachingSyncStatus = 'VERIFIED',
               teachingSyncedAt = datetime('now', 'localtime'),
               teachingVerifiedSnapshotJson = ?,
               errorMessage = NULL,
               updatedAt = datetime('now', 'localtime')
           WHERE classId = ? AND status = 'SAVING' AND teachingSyncStatus = 'SYNCING'`
        ).run(JSON.stringify(verifiedSnapshot ?? {}), normalizedClassId);

        if (updateRes.changes !== 1) {
          return {
            ok: false,
            errorMsg: `[reportCardRepo.markTeachingVerified] Không thể cập nhật VERIFIED do trạng thái SAVING/SYNCING của lớp ${normalizedClassId} đã thay đổi.`,
          };
        }

        return { ok: true, record: this.findOne(normalizedClassId)! };
      }
    );

    const res = tx();
    if (!res.ok) {
      throw new Error(res.errorMsg);
    }
    return res.record;
  },

  markTeachingSyncFailed(classId: string, errorMessage: string): ClassReportCardRecord {
    const normalizedClassId = String(classId || "").trim().toUpperCase();
    const db = getDb();
    const tx = db.transaction(() => {
      const current = this.getOrInit(normalizedClassId);
      const snapshot = parseReportCardLmsSnapshot(current.lmsSnapshotJson, normalizedClassId);
      const overrides = parseManualOverridesMap(current.manualOverridesJson);
      const liveHash = computeReportCardContentHash(snapshot, overrides);
      const hashStillMatches = Boolean(current.contentHash) && liveHash === current.contentHash;

      db.prepare(
        `UPDATE class_report_cards
         SET status = ?,
             contentHash = ?,
             teachingSyncStatus = 'FAILED',
             errorMessage = ?,
             updatedAt = datetime('now', 'localtime')
         WHERE classId = ?`
      ).run(
        hashStillMatches ? "FAILED" : "WAITING_APPROVAL",
        hashStillMatches ? current.contentHash : "",
        errorMessage,
        normalizedClassId
      );

      return this.findOne(normalizedClassId)!;
    });

    return tx();
  },
};


