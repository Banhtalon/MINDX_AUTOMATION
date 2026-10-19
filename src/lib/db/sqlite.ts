import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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

  const dataDir = path.resolve(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, "mindx_bot.db");
  const db = new Database(dbPath);

  // Performance & safety pragmas
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  initSchema(db);

  dbInstance = db;
  return dbInstance;
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
      attendanceStatus TEXT NOT NULL DEFAULT 'PRESENT',
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
      createdAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE(classId, studentId)
    );
    CREATE INDEX IF NOT EXISTS idx_spck_uploads_lookup ON spck_uploads(classId, studentId);

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
  `);
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

  findOne(studentId: string): StudentRecord | undefined {
    const db = getDb();
    return db.prepare(`SELECT * FROM students WHERE studentId = ?`).get(studentId) as StudentRecord | undefined;
  },
};

export interface SessionFeedbackRecord {
  id?: number;
  classId: string;
  sessionId: string;
  studentId: string;
  attendanceStatus?: "PRESENT" | "ABSENT" | "EXCUSED" | "LATE";
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
}

export const sessionFeedbackRepo = {
  upsert(record: SessionFeedbackRecord) {
    const db = getDb();

    // Check for content modification on previously APPROVED / VERIFIED records
    const existing = db
      .prepare(
        `SELECT status, contentHash, finalText FROM session_feedbacks WHERE classId = ? AND sessionId = ? AND studentId = ?`
      )
      .get(record.classId, record.sessionId, record.studentId) as
      | { status: string; contentHash: string; finalText: string }
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

    const stmt = db.prepare(`
      INSERT INTO session_feedbacks (
        classId, sessionId, studentId, attendanceStatus,
        quickTagsJson, teacherNote, strengths, improvements, actionPlan,
        finalText, contentHash, status, verifiedAt, errorMessage, updatedAt
      )
      VALUES (
        @classId, @sessionId, @studentId, @attendanceStatus,
        @quickTagsJson, @teacherNote, @strengths, @improvements, @actionPlan,
        @finalText, @contentHash, @status, @verifiedAt, @errorMessage, datetime('now', 'localtime')
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
        updatedAt = datetime('now', 'localtime')
    `);
    return stmt.run({
      classId: record.classId,
      sessionId: record.sessionId,
      studentId: record.studentId,
      attendanceStatus: record.attendanceStatus || "PRESENT",
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
    });
  },

  findBySession(classId: string, sessionId: string): SessionFeedbackRecord[] {
    const db = getDb();
    return db
      .prepare(`SELECT * FROM session_feedbacks WHERE classId = ? AND sessionId = ?`)
      .all(classId, sessionId) as SessionFeedbackRecord[];
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
    errorMessage?: string | null
  ) {
    const db = getDb();
    return db
      .prepare(`
        UPDATE session_feedbacks
        SET status = ?, verifiedAt = ?, errorMessage = ?, updatedAt = datetime('now', 'localtime')
        WHERE classId = ? AND sessionId = ? AND studentId = ?
      `)
      .run(status, verifiedAt ?? null, errorMessage ?? null, classId, sessionId, studentId);
  },

  markVerified(classId: string, sessionId: string, studentId: string) {
    const db = getDb();
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

export const homeworkSubmissionRepo = {
  upsert(record: HomeworkSubmissionRecord) {
    const db = getDb();

    // Strict ID integrity check: prevent reassigning submissionId to a different student, class, or session
    const existing = db
      .prepare(
        `SELECT studentId, classId, sessionId, status, contentHash, feedbackHtml FROM homework_submissions WHERE submissionId = ?`
      )
      .get(record.submissionId) as
      | {
          studentId: string;
          classId: string;
          sessionId: string;
          status: string;
          contentHash: string;
          feedbackHtml: string;
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

    if (existing && (existing.status === "APPROVED" || existing.status === "VERIFIED")) {
      const feedbackChanged = (record.feedbackHtml ?? "") !== (existing.feedbackHtml ?? "");
      if (feedbackChanged) {
        const newHash = calculateSha256(record.feedbackHtml ?? "");
        if (record.contentHash !== newHash) {
          targetStatus = "WAITING_APPROVAL";
          targetHash = newHash;
        }
      }
    }

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
    return stmt.run({
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
      verifiedAt: record.verifiedAt ?? null,
      errorMessage: record.errorMessage ?? null,
    });
  },

  findBySession(classId: string, sessionId: string): HomeworkSubmissionRecord[] {
    const db = getDb();
    return db
      .prepare(`SELECT * FROM homework_submissions WHERE classId = ? AND sessionId = ?`)
      .all(classId, sessionId) as HomeworkSubmissionRecord[];
  },

  findBySubmissionId(submissionId: string): HomeworkSubmissionRecord | undefined {
    const db = getDb();
    return db
      .prepare(`SELECT * FROM homework_submissions WHERE submissionId = ?`)
      .get(submissionId) as HomeworkSubmissionRecord | undefined;
  },

  markVerified(submissionId: string) {
    const db = getDb();
    return db
      .prepare(`
        UPDATE homework_submissions
        SET status = 'VERIFIED', verifiedAt = datetime('now', 'localtime'), errorMessage = NULL, updatedAt = datetime('now', 'localtime')
        WHERE submissionId = ?
      `)
      .run(submissionId);
  },
};

export interface SpckUploadRecord {
  id?: number;
  classId: string;
  studentId: string;
  localFolderPath?: string;
  matchScore?: number;
  isConfirmedByTeacher: number;
  projectTitle?: string;
  thumbnailPath?: string;
  screenshotsJson?: string;
  attachmentsJson?: string;
  youtubeUrlsJson?: string;
  relatedLinksJson?: string;
  teacherComment?: string;
  contentHash?: string;
  status: "DRAFT" | "WAITING_APPROVAL" | "APPROVED" | "SAVING" | "VERIFIED" | "FAILED";
  verifiedAt?: string | null;
  errorMessage?: string | null;
}

export const spckUploadRepo = {
  upsert(record: SpckUploadRecord) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO spck_uploads (
        classId, studentId, localFolderPath, matchScore, isConfirmedByTeacher,
        projectTitle, thumbnailPath, screenshotsJson, attachmentsJson,
        youtubeUrlsJson, relatedLinksJson, teacherComment, contentHash,
        status, verifiedAt, errorMessage, updatedAt
      )
      VALUES (
        @classId, @studentId, @localFolderPath, @matchScore, @isConfirmedByTeacher,
        @projectTitle, @thumbnailPath, @screenshotsJson, @attachmentsJson,
        @youtubeUrlsJson, @relatedLinksJson, @teacherComment, @contentHash,
        @status, @verifiedAt, @errorMessage, datetime('now', 'localtime')
      )
      ON CONFLICT(classId, studentId) DO UPDATE SET
        localFolderPath = excluded.localFolderPath,
        matchScore = excluded.matchScore,
        isConfirmedByTeacher = excluded.isConfirmedByTeacher,
        projectTitle = excluded.projectTitle,
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
        updatedAt = datetime('now', 'localtime')
    `);
    return stmt.run({
      classId: record.classId,
      studentId: record.studentId,
      localFolderPath: record.localFolderPath ?? "",
      matchScore: record.matchScore ?? 0.0,
      isConfirmedByTeacher: record.isConfirmedByTeacher ?? 0,
      projectTitle: record.projectTitle ?? "",
      thumbnailPath: record.thumbnailPath ?? "",
      screenshotsJson: record.screenshotsJson ?? "[]",
      attachmentsJson: record.attachmentsJson ?? "[]",
      youtubeUrlsJson: record.youtubeUrlsJson ?? "[]",
      relatedLinksJson: record.relatedLinksJson ?? "[]",
      teacherComment: record.teacherComment ?? "",
      contentHash: record.contentHash ?? "",
      status: record.status || "DRAFT",
      verifiedAt: record.verifiedAt ?? null,
      errorMessage: record.errorMessage ?? null,
    });
  },

  findByClass(classId: string): SpckUploadRecord[] {
    const db = getDb();
    return db
      .prepare(`SELECT * FROM spck_uploads WHERE classId = ?`)
      .all(classId) as SpckUploadRecord[];
  },

  findOne(classId: string, studentId: string): SpckUploadRecord | undefined {
    const db = getDb();
    return db
      .prepare(`SELECT * FROM spck_uploads WHERE classId = ? AND studentId = ?`)
      .get(classId, studentId) as SpckUploadRecord | undefined;
  },

  markVerified(classId: string, studentId: string) {
    const db = getDb();
    return db
      .prepare(`
        UPDATE spck_uploads
        SET status = 'VERIFIED', verifiedAt = datetime('now', 'localtime'), errorMessage = NULL, updatedAt = datetime('now', 'localtime')
        WHERE classId = ? AND studentId = ?
      `)
      .run(classId, studentId);
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
