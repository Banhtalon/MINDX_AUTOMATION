/**
 * MINDX AUTOMATION BOT - STUDENT SPCK UPLOAD PORTAL SERVER (DIRECTION 1)
 * Provides an isolated, token-protected HTTP server + automatic Public Internet Tunnel
 * (Cloudflare Quick Tunnel / SSH Tunnel + Classroom LAN IP) so students can select their name,
 * drag-and-drop their Final Project (SPCK) folder or files, and have them automatically:
 *   1. Saved into the teacher's local class SPCK folder (<rootFolderPath>/<StudentFullName>/)
 *   2. Scanned and mapped 100% to their exact `studentId` in SQLite (`spck_uploads`)
 *   3. Uploaded automatically to Google Drive (`CODING - SPCK -> Course -> Class -> Student`)
 *      with the Google Drive folder link attached to `relatedLinksJson` for LMS submission.
 */

import { type ChildProcess, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  canonicalizeSpckFolderPath,
  classSessionRepo,
  jobLogRepo,
  normalizeSpckFolderKey,
  spckUploadRepo,
  studentRepo,
} from "../db/sqlite";
import {
  MAX_SPCK_TITLE_LENGTH,
  sanitizeSpckTitle,
  scanStudentSpckFolder,
  validateSpckRelatedUrl,
  validateSpckYoutubeUrl,
} from "../local-files/spck-scanner";
import {
  DEFAULT_SPCK_DRIVE_FOLDER_URL,
  isCourseExemptFromSpck,
  SpckDriveUploader,
} from "../playwright/spck-drive-uploader";
import {
  assertPathAllowed,
  registerTeacherSelectedDirectory,
} from "../security/path-allowlist";

export interface StudentPortalSubmissionItem {
  studentId: string;
  fullName: string;
  folderName: string;
  folderPath: string;
  projectTitle: string;
  filesCount: number;
  totalBytes: number;
  submittedAt: string;
  driveStatus: "IDLE" | "QUEUED" | "UPLOADING" | "UPLOADED" | "EXEMPT" | "FAILED";
  driveFolderUrl?: string;
  driveError?: string;
}

export interface StudentPortalStatus {
  isRunning: boolean;
  classId: string;
  className: string;
  rootFolderPath: string;
  driveFolderUrl: string;
  autoUploadDrive: boolean;
  sessionToken: string;
  port: number;
  localUrl: string;
  lanUrl: string;
  publicTunnelUrl: string | null;
  primaryShareUrl: string;
  tunnelStatus: "STOPPED" | "STARTING" | "READY" | "LAN_ONLY";
  tunnelProvider: string;
  startedAt: string | null;
  submissions: StudentPortalSubmissionItem[];
}

export interface StartStudentPortalOptions {
  classId: string;
  folderPath?: string;
  driveFolderUrl?: string;
  autoUploadDrive?: boolean;
}

interface IncomingStudentFilePayload {
  relativePath: string;
  base64Data: string;
}

interface IncomingStudentUploadBody {
  studentId: string;
  projectTitle?: string;
  youtubeUrl?: string;
  presentationUrl?: string;
  replaceExisting?: boolean;
  files: IncomingStudentFilePayload[];
}

const MAX_UPLOAD_BODY_BYTES = 180 * 1024 * 1024; // 180 MB JSON payload limit
const MAX_TOTAL_RAW_BYTES = 130 * 1024 * 1024; // 130 MB raw files limit per student submission
const MAX_FILES_PER_SUBMISSION = 250;

const IGNORED_PATH_SEGMENTS = new Set([
  "__pycache__",
  "node_modules",
  ".git",
  ".venv",
  "venv",
  "env",
  ".idea",
  ".vscode",
  "_spck_app_shots",
  "_spck_owner_uploads",
]);

const FORBIDDEN_EXECUTABLE_EXTENSIONS = new Set([
  ".exe",
  ".dll",
  ".bat",
  ".cmd",
  ".ps1",
  ".vbs",
  ".msi",
  ".scr",
  ".com",
  ".pif",
]);

function getLanIpAddress(): string {
  try {
    const interfaces = os.networkInterfaces();
    const candidates: string[] = [];
    for (const name of Object.keys(interfaces)) {
      const netList = interfaces[name] || [];
      for (const net of netList) {
        if (net.family === "IPv4" && !net.internal) {
          if (
            net.address.startsWith("192.168.") ||
            net.address.startsWith("10.") ||
            /^172\.(1[6-9]|2\d|3[0-1])\./.test(net.address)
          ) {
            candidates.unshift(net.address);
          } else {
            candidates.push(net.address);
          }
        }
      }
    }
    return candidates[0] || "127.0.0.1";
  } catch {
    return "127.0.0.1";
  }
}

function sanitizeFolderDisplayName(fullName: string, fallbackId: string): string {
  const cleaned = String(fullName || fallbackId)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "")
    .trim();
  return cleaned || fallbackId;
}

function sanitizeRelativeUploadPath(rawRelPath: string): string | null {
  const normalized = String(rawRelPath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();
  if (!normalized) return null;

  const rawSegments = normalized.split("/").filter(Boolean);
  if (rawSegments.length === 0) return null;

  const safeSegments: string[] = [];
  for (const seg of rawSegments) {
    const trimmed = seg.trim();
    if (!trimmed || trimmed === "." || trimmed === "..") {
      return null;
    }
    if (trimmed.startsWith(".")) {
      return null;
    }
    if (IGNORED_PATH_SEGMENTS.has(trimmed.toLowerCase())) {
      return null;
    }
    const cleanSeg = trimmed
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\.+$/, "")
      .trim();
    if (!cleanSeg) return null;
    safeSegments.push(cleanSeg);
  }

  // Cap subfolder depth to 5 levels
  if (safeSegments.length > 5) {
    const fileName = safeSegments[safeSegments.length - 1];
    return [...safeSegments.slice(0, 4), fileName].join("/");
  }

  const ext = path.extname(safeSegments[safeSegments.length - 1]).toLowerCase();
  if (FORBIDDEN_EXECUTABLE_EXTENSIONS.has(ext)) {
    return null;
  }

  return safeSegments.join("/");
}

/**
 * If all uploaded files share a single top-level directory (from `<input webkitdirectory>`),
 * strips that outer folder prefix so files sit directly inside `<ClassFolder>/<StudentFullName>/`.
 */
function stripCommonTopLevelDirectory(
  items: Array<{ cleanRelPath: string; base64Data: string }>
): Array<{ cleanRelPath: string; base64Data: string }> {
  if (items.length === 0) return items;
  const allHaveSubfolder = items.every((item) => item.cleanRelPath.includes("/"));
  if (!allHaveSubfolder) return items;

  const firstPrefix = items[0].cleanRelPath.split("/")[0];
  const sameTopFolder = items.every(
    (item) => item.cleanRelPath.split("/")[0].toLowerCase() === firstPrefix.toLowerCase()
  );
  if (!sameTopFolder) return items;

  return items.map((item) => ({
    cleanRelPath: item.cleanRelPath.split("/").slice(1).join("/"),
    base64Data: item.base64Data,
  }));
}

function assertInsideDirectory(parentDir: string, targetPath: string): string {
  const resolvedParent = path.resolve(parentDir);
  const resolvedTarget = path.resolve(targetPath);
  const normParent =
    process.platform === "win32" ? resolvedParent.toLowerCase() : resolvedParent;
  const normTarget =
    process.platform === "win32" ? resolvedTarget.toLowerCase() : resolvedTarget;

  if (
    normTarget !== normParent &&
    !normTarget.startsWith(normParent + path.sep.toLowerCase())
  ) {
    throw new Error(
      `[Security Exception] Đường dẫn tệp tải lên thoát khỏi thư mục học viên được cấp phép.`
    );
  }
  return resolvedTarget;
}

class StudentPortalManager {
  private server: http.Server | null = null;
  private tunnelProcess: ChildProcess | null = null;
  private isRunning = false;
  private classId = "";
  private className = "";
  private rootFolderPath = "";
  private driveFolderUrl = DEFAULT_SPCK_DRIVE_FOLDER_URL;
  private autoUploadDrive = true;
  private sessionToken = "";
  private port = 3088;
  private localUrl = "";
  private lanUrl = "";
  private publicTunnelUrl: string | null = null;
  private tunnelStatus: StudentPortalStatus["tunnelStatus"] = "STOPPED";
  private tunnelProvider = "Mạng LAN / Máy Giáo Viên";
  private startedAt: string | null = null;
  private submissions = new Map<string, StudentPortalSubmissionItem>();

  public getStatus(filterClassId?: string): StudentPortalStatus {
    this.syncSubmissionsWithExistingRecords();
    const submissionsList = Array.from(this.submissions.values()).sort((a, b) =>
      b.submittedAt.localeCompare(a.submittedAt)
    );

    const primaryShareUrl =
      this.publicTunnelUrl || this.lanUrl || this.localUrl || "";

    return {
      isRunning:
        this.isRunning &&
        (!filterClassId ||
          !this.classId ||
          this.classId.toUpperCase() === filterClassId.trim().toUpperCase()),
      classId: this.classId,
      className: this.className,
      rootFolderPath: this.rootFolderPath,
      driveFolderUrl: this.driveFolderUrl,
      autoUploadDrive: this.autoUploadDrive,
      sessionToken: this.sessionToken,
      port: this.port,
      localUrl: this.localUrl,
      lanUrl: this.lanUrl,
      publicTunnelUrl: this.publicTunnelUrl,
      primaryShareUrl,
      tunnelStatus: this.isRunning ? this.tunnelStatus : "STOPPED",
      tunnelProvider: this.tunnelProvider,
      startedAt: this.startedAt,
      submissions: submissionsList,
    };
  }

  public setAutoUploadDrive(enabled: boolean, driveFolderUrl?: string): StudentPortalStatus {
    this.autoUploadDrive = Boolean(enabled);
    if (driveFolderUrl && driveFolderUrl.trim()) {
      this.driveFolderUrl = driveFolderUrl.trim();
    }
    return this.getStatus();
  }

  public async startPortal(options: StartStudentPortalOptions): Promise<StudentPortalStatus> {
    const normalizedClassId = String(options.classId || "").trim().toUpperCase();
    if (!normalizedClassId || !/^[A-Z0-9_-]{2,80}$/.test(normalizedClassId)) {
      throw new Error("Mã lớp (classId) không hợp lệ. Vui lòng chọn lớp học trước khi mở cổng nộp bài.");
    }

    const students = studentRepo.findByClass(normalizedClassId, false);
    if (students.length === 0) {
      throw new Error(
        `Chưa có danh sách học viên cho lớp '${normalizedClassId}'. Vui lòng bấm đồng bộ hoặc chọn lớp có học viên trước.`
      );
    }

    // Resolve and register the target class SPCK directory
    let targetRootDir = String(options.folderPath || "").trim();
    if (!targetRootDir) {
      targetRootDir = path.resolve(process.cwd(), "data", "spck", normalizedClassId);
    } else {
      targetRootDir = path.resolve(targetRootDir);
    }

    if (!fs.existsSync(targetRootDir)) {
      fs.mkdirSync(targetRootDir, { recursive: true });
    }
    const safeRootDir = registerTeacherSelectedDirectory(targetRootDir);

    // If portal is already running for the exact same class & folder, return existing status
    if (
      this.isRunning &&
      this.server &&
      this.classId === normalizedClassId &&
      normalizeSpckFolderKey(this.rootFolderPath) === normalizeSpckFolderKey(safeRootDir)
    ) {
      if (options.driveFolderUrl?.trim()) {
        this.driveFolderUrl = options.driveFolderUrl.trim();
      }
      if (typeof options.autoUploadDrive === "boolean") {
        this.autoUploadDrive = options.autoUploadDrive;
      }
      return this.getStatus();
    }

    // Stop any previous portal instance before starting a fresh one
    await this.stopPortal();

    const sessions = classSessionRepo.findByClass(normalizedClassId);
    this.classId = normalizedClassId;
    this.className = sessions[0]?.className || normalizedClassId;
    this.rootFolderPath = safeRootDir;
    this.driveFolderUrl =
      options.driveFolderUrl?.trim() || DEFAULT_SPCK_DRIVE_FOLDER_URL;
    this.autoUploadDrive =
      typeof options.autoUploadDrive === "boolean" ? options.autoUploadDrive : true;
    this.sessionToken = crypto.randomBytes(6).toString("hex");
    this.submissions.clear();
    this.syncSubmissionsWithExistingRecords();

    // Start HTTP Server on an available port (3088..3099)
    this.port = await this.listenOnAvailablePort(3088, 3099);
    const lanIp = getLanIpAddress();
    this.localUrl = `http://127.0.0.1:${this.port}/s/${this.sessionToken}`;
    this.lanUrl = `http://${lanIp}:${this.port}/s/${this.sessionToken}`;
    this.publicTunnelUrl = null;
    this.tunnelStatus = "STARTING";
    this.tunnelProvider = "Đang khởi tạo Link Internet...";
    this.startedAt = new Date().toISOString();
    this.isRunning = true;

    // Launch Public Internet Tunnel in background so startPortal returns fast
    this.startPublicTunnelInBackground(this.port, this.sessionToken).catch(() => {
      if (this.isRunning && !this.publicTunnelUrl) {
        this.tunnelStatus = "LAN_ONLY";
        this.tunnelProvider = "Mạng LAN Phòng Học / Wi-Fi Chung";
      }
    });

    jobLogRepo.add({
      jobId: `PORTAL_${Date.now()}`,
      jobType: "SPCK_STUDENT_PORTAL",
      classId: this.classId,
      level: "INFO",
      message: `[StudentPortal] Đã mở Cổng Thu Bài SPCK cho lớp ${this.classId} tại ${this.lanUrl} (Thư mục đích: ${this.rootFolderPath})`,
    });

    return this.getStatus();
  }

  public async stopPortal(): Promise<void> {
    this.isRunning = false;
    this.tunnelStatus = "STOPPED";
    this.publicTunnelUrl = null;

    if (this.tunnelProcess) {
      try {
        this.tunnelProcess.kill();
      } catch {}
      this.tunnelProcess = null;
    }

    if (this.server) {
      const srv = this.server;
      this.server = null;
      await new Promise<void>((resolve) => {
        try {
          srv.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }
  }

  private syncSubmissionsWithExistingRecords(): void {
    if (!this.classId) return;
    try {
      const students = studentRepo.findByClass(this.classId, false);
      const studentMap = new Map(students.map((s) => [s.studentId, s]));
      const records = spckUploadRepo.findByClass(this.classId);

      for (const rec of records) {
        if (!rec.localFolderPath || !fs.existsSync(rec.localFolderPath)) continue;
        const existingItem = this.submissions.get(rec.studentId);
        const relatedLinks: Array<{ name: string; url: string }> = (() => {
          try {
            return JSON.parse(rec.relatedLinksJson || "[]");
          } catch {
            return [];
          }
        })();
        const driveLinkObj = relatedLinks.find((l) =>
          /drive\.google\.com\/drive\/folders\//i.test(l.url || "")
        );

        if (existingItem) {
          if (driveLinkObj?.url && existingItem.driveStatus !== "UPLOADING") {
            existingItem.driveFolderUrl = driveLinkObj.url;
            existingItem.driveStatus = "UPLOADED";
          }
          continue;
        }

        const stu = studentMap.get(rec.studentId);
        const attachments: string[] = (() => {
          try {
            return JSON.parse(rec.attachmentsJson || "[]");
          } catch {
            return [];
          }
        })();
        const screenshots: string[] = (() => {
          try {
            return JSON.parse(rec.screenshotsJson || "[]");
          } catch {
            return [];
          }
        })();

        this.submissions.set(rec.studentId, {
          studentId: rec.studentId,
          fullName: stu?.fullName || rec.studentId,
          folderName: path.basename(rec.localFolderPath),
          folderPath: rec.localFolderPath,
          projectTitle: rec.projectTitle || `SPCK ${stu?.fullName || rec.studentId}`,
          filesCount: attachments.length + screenshots.length,
          totalBytes: 0,
          submittedAt: (rec as any).updatedAt || new Date().toISOString(),
          driveStatus: driveLinkObj?.url
            ? "UPLOADED"
            : isCourseExemptFromSpck(this.classId)
            ? "EXEMPT"
            : "IDLE",
          driveFolderUrl: driveLinkObj?.url,
        });
      }
    } catch {
      // Ignore sync errors
    }
  }

  private async listenOnAvailablePort(startPort: number, maxPort: number): Promise<number> {
    for (let candidatePort = startPort; candidatePort <= maxPort; candidatePort++) {
      try {
        const srv = http.createServer((req, res) => {
          this.handleHttpRequest(req, res).catch((err) => {
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
              res.end(
                JSON.stringify({
                  success: false,
                  error: err instanceof Error ? err.message : String(err),
                })
              );
            }
          });
        });

        await new Promise<void>((resolve, reject) => {
          srv.once("error", reject);
          srv.listen(candidatePort, "0.0.0.0", () => {
            srv.removeListener("error", reject);
            resolve();
          });
        });

        this.server = srv;
        return candidatePort;
      } catch {
        continue;
      }
    }
    throw new Error(
      `Không tìm thấy cổng mạng trống trong khoảng ${startPort}..${maxPort} để mở Cổng Thu Bài.`
    );
  }

  private async ensureCloudflaredBinary(): Promise<string | null> {
    if (process.platform !== "win32") return "cloudflared";
    const downloadDir = path.resolve(process.cwd(), "data", "downloads");
    const cloudflaredPath = path.join(downloadDir, "cloudflared.exe");
    if (
      fs.existsSync(cloudflaredPath) &&
      fs.statSync(cloudflaredPath).size > 5 * 1024 * 1024
    ) {
      return cloudflaredPath;
    }

    try {
      if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
      }
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(
          "curl.exe",
          [
            "-L",
            "-s",
            "-o",
            cloudflaredPath,
            "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe",
          ],
          { windowsHide: true }
        );
        proc.on("error", reject);
        proc.on("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(`curl exited ${code}`))
        );
      });
      if (
        fs.existsSync(cloudflaredPath) &&
        fs.statSync(cloudflaredPath).size > 5 * 1024 * 1024
      ) {
        return cloudflaredPath;
      }
    } catch {}
    return null;
  }

  private async startPublicTunnelInBackground(port: number, token: string): Promise<void> {
    // 1. Try Cloudflare Quick Tunnel first (auto-downloads cloudflared.exe if missing)
    const cloudflaredPath = await this.ensureCloudflaredBinary();

    if (cloudflaredPath && this.isRunning) {
      const cfUrl = await this.trySpawnTunnelProcess(
        cloudflaredPath,
        [
          "tunnel",
          "--url",
          `http://127.0.0.1:${port}`,
          "--no-autoupdate",
          "--protocol",
          "http2",
        ],
        /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i,
        18000
      );
      if (cfUrl && this.isRunning && this.sessionToken === token) {
        this.publicTunnelUrl = `${cfUrl.replace(/\/+$/, "")}/s/${token}`;
        this.tunnelStatus = "READY";
        this.tunnelProvider = "Cloudflare Internet Tunnel (Toàn cầu)";
        return;
      }
    }

    // 2. Fallback to built-in Windows OpenSSH -> localhost.run (zero-install HTTPS tunnel)
    const sshExe =
      process.platform === "win32"
        ? "C:\\Windows\\System32\\OpenSSH\\ssh.exe"
        : "ssh";
    if (this.isRunning) {
      const lhrUrl = await this.trySpawnTunnelProcess(
        sshExe,
        [
          "-o",
          "StrictHostKeyChecking=no",
          "-o",
          "UserKnownHostsFile=NUL",
          "-o",
          "ServerAliveInterval=30",
          "-R",
          `80:127.0.0.1:${port}`,
          "nokey@localhost.run",
        ],
        /https:\/\/[a-z0-9-]+\.lhr\.life/i,
        12000
      );
      if (lhrUrl && this.isRunning && this.sessionToken === token) {
        this.publicTunnelUrl = `${lhrUrl.replace(/\/+$/, "")}/s/${token}`;
        this.tunnelStatus = "READY";
        this.tunnelProvider = "Internet Tunnel (localhost.run)";
        return;
      }
    }

    if (this.isRunning && this.sessionToken === token && !this.publicTunnelUrl) {
      this.tunnelStatus = "LAN_ONLY";
      this.tunnelProvider = "Mạng LAN Phòng Học / Wi-Fi Chung";
    }
  }

  private trySpawnTunnelProcess(
    command: string,
    args: string[],
    urlRegex: RegExp,
    timeoutMs: number
  ): Promise<string | null> {
    return new Promise((resolve) => {
      let settled = false;
      let proc: ChildProcess | null = null;

      const finish = (matchedUrl: string | null) => {
        if (settled) return;
        settled = true;
        if (!matchedUrl && proc) {
          try {
            proc.kill();
          } catch {}
        }
        resolve(matchedUrl);
      };

      const timer = setTimeout(() => finish(null), timeoutMs);

      try {
        proc = spawn(command, args, {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        this.tunnelProcess = proc;

        const onChunk = (chunk: Buffer) => {
          const text = chunk.toString("utf8");
          const match = text.match(urlRegex);
          if (match && match[0]) {
            clearTimeout(timer);
            finish(match[0]);
          }
        };

        proc.stdout?.on("data", onChunk);
        proc.stderr?.on("data", onChunk);
        proc.on("error", () => {
          clearTimeout(timer);
          finish(null);
        });
        proc.on("exit", () => {
          clearTimeout(timer);
          finish(null);
        });
      } catch {
        clearTimeout(timer);
        finish(null);
      }
    });
  }

  private async handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // Standard security headers for the isolated student portal
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Cache-Control", "no-store, max-age=0");

    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname.replace(/\/+$/, "") || "/";
    const expectedPrefix = `/s/${this.sessionToken}`;

    if (!this.isRunning || !this.sessionToken || !pathname.startsWith(expectedPrefix)) {
      res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>Cổng nộp bài đã đóng</title></head><body style="background:#0f172a;color:#f8fafc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="text-align:center;max-width:460px;padding:24px;border:1px solid #334155;border-radius:16px;background:#1e293b;"><h2>🔒 Đường dẫn nộp bài không hợp lệ hoặc đã đóng</h2><p style="color:#94a3b8;font-size:14px;">Vui lòng xin lại đường dẫn mới nhất từ Thầy giảng viên.</p></div></body></html>`
      );
      return;
    }

    const subRoute = pathname.slice(expectedPrefix.length) || "/";

    // 1. GET /s/<token> -> Render Student Upload HTML Page
    if (req.method === "GET" && subRoute === "/") {
      const html = this.renderStudentPortalHtml();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    // 2. GET /s/<token>/status -> Return class & student list + submission statuses
    if (req.method === "GET" && subRoute === "/status") {
      this.syncSubmissionsWithExistingRecords();
      const students = studentRepo
        .findByClass(this.classId, false)
        .filter((s) => s.isActive !== 0);

      const studentItems = students.map((stu) => {
        const sub = this.submissions.get(stu.studentId);
        return {
          studentId: stu.studentId,
          fullName: stu.fullName,
          hasSubmitted: Boolean(sub),
          projectTitle: sub?.projectTitle || `SPCK ${stu.fullName}`,
          filesCount: sub?.filesCount || 0,
          submittedAt: sub?.submittedAt || null,
          driveStatus: sub?.driveStatus || "IDLE",
          driveFolderUrl: sub?.driveFolderUrl || null,
          driveError: sub?.driveError || null,
        };
      });

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          success: true,
          classId: this.classId,
          className: this.className,
          autoUploadDrive: this.autoUploadDrive,
          students: studentItems,
        })
      );
      return;
    }

    // 3. POST /s/<token>/upload -> Receive Student SPCK files, save locally, scan & trigger Drive Upload
    if (req.method === "POST" && subRoute === "/upload") {
      const rawBody = await this.readRequestBody(req, MAX_UPLOAD_BODY_BYTES);
      let body: IncomingStudentUploadBody;
      try {
        body = JSON.parse(rawBody) as IncomingStudentUploadBody;
      } catch {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: "Dữ liệu tải lên không đúng định dạng JSON." }));
        return;
      }

      const result = await this.processStudentSubmission(body);
      res.writeHead(result.success ? 200 : 400, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(result));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ success: false, error: "Không tìm thấy đường dẫn yêu cầu." }));
  }

  private readRequestBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;

      req.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          req.destroy();
          reject(
            new Error(
              `Tổng dung lượng bài nộp vượt quá giới hạn cho phép (${Math.round(
                maxBytes / (1024 * 1024)
              )} MB).`
            )
          );
          return;
        }
        chunks.push(chunk);
      });

      req.on("end", () => {
        resolve(Buffer.concat(chunks).toString("utf8"));
      });

      req.on("error", (err) => {
        reject(err);
      });
    });
  }

  public async processStudentSubmission(body: IncomingStudentUploadBody): Promise<{
    success: boolean;
    error?: string;
    submission?: StudentPortalSubmissionItem;
  }> {
    if (!this.isRunning || !this.classId || !this.rootFolderPath) {
      return {
        success: false,
        error: "Cổng thu bài hiện đang đóng. Vui lòng báo Thầy mở lại cổng thu bài.",
      };
    }

    const studentId = String(body?.studentId || "").trim();
    if (!studentId) {
      return {
        success: false,
        error: "Vui lòng chọn Họ và Tên của con trong danh sách lớp.",
      };
    }

    const students = studentRepo.findByClass(this.classId, false);
    const student = students.find((s) => s.studentId === studentId);
    if (!student) {
      return {
        success: false,
        error: `Không tìm thấy học viên (${studentId}) trong danh sách lớp ${this.classId}.`,
      };
    }

    const rawFiles = Array.isArray(body?.files) ? body.files : [];
    if (rawFiles.length === 0) {
      return {
        success: false,
        error: "Con chưa chọn file hoặc thư mục sản phẩm nào để nộp.",
      };
    }

    if (rawFiles.length > MAX_FILES_PER_SUBMISSION) {
      return {
        success: false,
        error: `Số lượng file vượt quá giới hạn (${rawFiles.length}/${MAX_FILES_PER_SUBMISSION} file). Vui lòng bỏ các thư mục thư viện phụ hoặc nén thành file .zip.`,
      };
    }

    // Sanitize paths and strip common outer folder if uploaded via folder picker
    const sanitizedEntries: Array<{ cleanRelPath: string; base64Data: string }> = [];
    for (const item of rawFiles) {
      const cleanRelPath = sanitizeRelativeUploadPath(item?.relativePath || "");
      if (!cleanRelPath || !item?.base64Data) continue;
      sanitizedEntries.push({
        cleanRelPath,
        base64Data: String(item.base64Data),
      });
    }

    const normalizedEntries = stripCommonTopLevelDirectory(sanitizedEntries).filter(
      (item) => Boolean(item.cleanRelPath)
    );

    if (normalizedEntries.length === 0) {
      return {
        success: false,
        error: "Không có tệp hợp lệ nào sau khi lọc bỏ các tệp hệ thống/thư mục rỗng.",
      };
    }

    // Prepare student folder inside the allowlisted class SPCK directory
    const safeClassRoot = assertPathAllowed(this.rootFolderPath);
    const existingRecord = spckUploadRepo.findOne(this.classId, student.studentId);

    let studentFolderPath: string;
    if (
      existingRecord?.localFolderPath &&
      fs.existsSync(existingRecord.localFolderPath) &&
      normalizeSpckFolderKey(path.dirname(existingRecord.localFolderPath)) ===
        normalizeSpckFolderKey(safeClassRoot)
    ) {
      studentFolderPath = assertInsideDirectory(safeClassRoot, existingRecord.localFolderPath);
    } else {
      const baseFolderName = sanitizeFolderDisplayName(student.fullName, student.studentId);
      let candidatePath = assertInsideDirectory(
        safeClassRoot,
        path.join(safeClassRoot, baseFolderName)
      );
      // Avoid collision if another student with the exact same fullName already uses this folder
      const otherStudentUsingSameFolder = spckUploadRepo
        .findByClass(this.classId)
        .some(
          (r) =>
            r.studentId !== student.studentId &&
            r.localFolderPath &&
            normalizeSpckFolderKey(r.localFolderPath) ===
              normalizeSpckFolderKey(candidatePath)
        );
      if (otherStudentUsingSameFolder) {
        candidatePath = assertInsideDirectory(
          safeClassRoot,
          path.join(safeClassRoot, `${baseFolderName}_${student.studentId.slice(-4)}`)
        );
      }
      studentFolderPath = candidatePath;
    }

    if (!fs.existsSync(studentFolderPath)) {
      fs.mkdirSync(studentFolderPath, { recursive: true });
    }

    const safeStudentFolder = assertPathAllowed(studentFolderPath);

    // Write uploaded files into the student's folder
    let totalWrittenBytes = 0;
    let writtenFilesCount = 0;

    for (const entry of normalizedEntries) {
      const destFilePath = assertInsideDirectory(
        safeStudentFolder,
        path.join(safeStudentFolder, entry.cleanRelPath)
      );
      assertPathAllowed(destFilePath);

      const base64Clean = entry.base64Data.includes(",")
        ? entry.base64Data.split(",").pop() || ""
        : entry.base64Data;
      const buf = Buffer.from(base64Clean, "base64");
      if (buf.length === 0) continue;

      totalWrittenBytes += buf.length;
      if (totalWrittenBytes > MAX_TOTAL_RAW_BYTES) {
        return {
          success: false,
          error: `Tổng dung lượng file vượt quá giới hạn 130MB. Vui lòng kiểm tra lại.`,
        };
      }

      const parentDir = path.dirname(destFilePath);
      assertInsideDirectory(safeStudentFolder, parentDir);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(destFilePath, buf);
      writtenFilesCount++;
    }

    if (writtenFilesCount === 0) {
      return {
        success: false,
        error: "Các tệp tải lên đều rỗng (0 byte). Vui lòng chọn lại tệp bài làm.",
      };
    }

    // Handle optional projectTitle, youtubeUrl, and presentationUrl -> write/merge into links.txt
    const rawTitle = String(body?.projectTitle || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_SPCK_TITLE_LENGTH);
    const finalTitle = sanitizeSpckTitle(
      rawTitle || existingRecord?.projectTitle || `SPCK ${student.fullName}`,
      student.fullName
    );

    const youtubeInput = String(body?.youtubeUrl || "").trim();
    const presentationInput = String(body?.presentationUrl || "").trim();

    const linksLines: string[] = [`Tiêu đề: ${finalTitle}`];
    if (youtubeInput) {
      const ytCheck = validateSpckYoutubeUrl(youtubeInput);
      if (ytCheck.valid && ytCheck.normalizedUrl) {
        linksLines.push(ytCheck.normalizedUrl);
      }
    }
    if (presentationInput) {
      const relCheck = validateSpckRelatedUrl(presentationInput);
      if (relCheck.valid && relCheck.normalizedUrl) {
        linksLines.push(`Slide / Link thuyết trình (${student.fullName}) | ${relCheck.normalizedUrl}`);
      }
    }

    if (rawTitle || youtubeInput || presentationInput) {
      const linksFilePath = assertInsideDirectory(
        safeStudentFolder,
        path.join(safeStudentFolder, "links.txt")
      );
      fs.writeFileSync(linksFilePath, linksLines.join("\n") + "\n", "utf8");
    }

    // Scan the student's folder and upsert into SQLite `spck_uploads` with 100% confirmed studentId mapping
    const canonicalStudentFolder = canonicalizeSpckFolderPath(safeStudentFolder);
    const packageData = scanStudentSpckFolder(canonicalStudentFolder, student.fullName);

    const parseSafeArray = <T>(raw?: string | null): T[] => {
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };

    const existingLinks = parseSafeArray<{ name: string; url: string }>(
      existingRecord?.relatedLinksJson
    );
    const mergedLinksMap = new Map<string, { name: string; url: string }>();
    for (const l of [...existingLinks, ...(packageData.relatedLinks || [])]) {
      if (l && l.url && !mergedLinksMap.has(l.url)) {
        mergedLinksMap.set(l.url, l);
      }
    }
    const mergedRelatedLinks = Array.from(mergedLinksMap.values()).slice(0, 5);

    const existingYt = parseSafeArray<string>(existingRecord?.youtubeUrlsJson);
    const mergedYoutubeUrls = Array.from(
      new Set([...existingYt, ...(packageData.youtubeUrls || [])])
    ).slice(0, 5);

    spckUploadRepo.upsert({
      classId: this.classId,
      studentId: student.studentId,
      localFolderPath: canonicalStudentFolder,
      matchScore: 1.0,
      isConfirmedByTeacher: 1,
      projectTitle: finalTitle || packageData.projectTitle,
      thumbnailPath: packageData.thumbnailPath,
      screenshotsJson: JSON.stringify(packageData.screenshots),
      attachmentsJson: JSON.stringify(packageData.attachments),
      youtubeUrlsJson: JSON.stringify(mergedYoutubeUrls),
      relatedLinksJson: JSON.stringify(mergedRelatedLinks),
      teacherComment: existingRecord?.teacherComment ?? "",
      // Content changed -> reset contentHash & set status to WAITING_APPROVAL (Rule 4)
      contentHash: "",
      status: "WAITING_APPROVAL",
      verifiedAt: null,
      errorMessage: null,
    });

    const isExempt = isCourseExemptFromSpck(this.classId);
    const shouldQueueDrive = this.autoUploadDrive && !isExempt;

    const submissionItem: StudentPortalSubmissionItem = {
      studentId: student.studentId,
      fullName: student.fullName,
      folderName: path.basename(canonicalStudentFolder),
      folderPath: canonicalStudentFolder,
      projectTitle: finalTitle || packageData.projectTitle,
      filesCount: writtenFilesCount,
      totalBytes: totalWrittenBytes,
      submittedAt: new Date().toISOString(),
      driveStatus: isExempt ? "EXEMPT" : shouldQueueDrive ? "QUEUED" : "IDLE",
    };

    this.submissions.set(student.studentId, submissionItem);

    jobLogRepo.add({
      jobId: `STUDENT_SUBMIT_${Date.now()}`,
      jobType: "SPCK_STUDENT_SUBMIT",
      classId: this.classId,
      studentId: student.studentId,
      level: "INFO",
      message: `[StudentPortal] Học viên ${student.fullName} (${student.studentId}) đã nộp ${writtenFilesCount} file (${Math.round(
        totalWrittenBytes / 1024
      )} KB) vào ${canonicalStudentFolder}.`,
    });

    // Trigger automatic Google Drive upload in background via SequentialTaskQueue
    if (shouldQueueDrive) {
      this.uploadSingleStudentToDriveInBackground(
        this.classId,
        student.studentId,
        this.driveFolderUrl
      ).catch(() => {});
    }

    return {
      success: true,
      submission: submissionItem,
    };
  }

  private async uploadSingleStudentToDriveInBackground(
    classId: string,
    studentId: string,
    driveFolderUrl: string
  ): Promise<void> {
    const sub = this.submissions.get(studentId);
    if (sub) {
      sub.driveStatus = "UPLOADING";
      sub.driveError = undefined;
    }

    try {
      const batchResult = await SpckDriveUploader.uploadClassSpckToGoogleDrive({
        classId,
        driveFolderUrl,
        studentIds: [studentId],
      });

      const stuRes = batchResult.results.find((r) => r.studentId === studentId);
      const currentSub = this.submissions.get(studentId);
      if (currentSub) {
        if (stuRes && stuRes.status === "SUCCESS" && stuRes.driveFolderUrl) {
          currentSub.driveStatus = "UPLOADED";
          currentSub.driveFolderUrl = stuRes.driveFolderUrl;
          currentSub.driveError = undefined;
        } else {
          currentSub.driveStatus = "FAILED";
          currentSub.driveError =
            stuRes?.errorMessage || "Không thể tải lên Google Drive.";
        }
      }
    } catch (err) {
      const currentSub = this.submissions.get(studentId);
      if (currentSub) {
        currentSub.driveStatus = "FAILED";
        currentSub.driveError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  private renderStudentPortalHtml(): string {
    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Nộp Sản Phẩm Cuối Khóa (SPCK) — Lớp ${this.classId}</title>
  <style>
    :root {
      --bg: #090d16;
      --card: #111827;
      --border: #1f2937;
      --mindx: #e11d48;
      --emerald: #10b981;
      --sky: #0284c7;
      --text: #f8fafc;
      --muted: #94a3b8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(circle at top, #1e1b4b 0%, var(--bg) 60%);
      color: var(--text);
      min-height: 100vh;
      padding: 24px 16px 60px;
    }
    .container {
      max-width: 720px;
      margin: 0 auto;
    }
    .header-card {
      background: linear-gradient(135deg, rgba(225,29,72,0.18), rgba(17,24,39,0.95));
      border: 1px solid rgba(225,29,72,0.4);
      border-radius: 18px;
      padding: 22px 24px;
      margin-bottom: 20px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.4);
    }
    .badge {
      display: inline-block;
      background: var(--mindx);
      color: #fff;
      font-weight: 700;
      font-size: 11px;
      padding: 4px 10px;
      border-radius: 999px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    h1 {
      margin: 0 0 6px;
      font-size: 22px;
      line-height: 1.3;
    }
    .sub {
      margin: 0;
      color: #cbd5e1;
      font-size: 13.5px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 22px 24px;
      margin-bottom: 18px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.25);
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 700;
      color: #e2e8f0;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    select, input[type="text"], input[type="url"] {
      width: 100%;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1px solid #334155;
      background: #030712;
      color: #fff;
      font-size: 14.5px;
      outline: none;
      transition: border-color 0.2s;
    }
    select:focus, input:focus {
      border-color: var(--emerald);
    }
    .field-group {
      margin-bottom: 18px;
    }
    .hint {
      font-size: 12px;
      color: var(--muted);
      margin-top: 5px;
    }
    .upload-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-top: 10px;
    }
    @media (max-width: 560px) {
      .upload-grid { grid-template-columns: 1fr; }
    }
    .pick-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 18px 14px;
      border-radius: 12px;
      border: 2px dashed #3b82f6;
      background: rgba(59, 130, 246, 0.08);
      color: #dbeafe;
      cursor: pointer;
      text-align: center;
      transition: all 0.2s;
    }
    .pick-btn:hover {
      background: rgba(59, 130, 246, 0.16);
      border-color: #60a5fa;
    }
    .pick-btn.emerald {
      border-color: #10b981;
      background: rgba(16, 185, 129, 0.08);
      color: #d1fae5;
    }
    .pick-btn.emerald:hover {
      background: rgba(16, 185, 129, 0.16);
      border-color: #34d399;
    }
    .pick-btn strong {
      font-size: 14px;
      margin-top: 6px;
    }
    .pick-btn span {
      font-size: 11.5px;
      color: var(--muted);
      margin-top: 4px;
    }
    .file-list {
      margin-top: 14px;
      max-height: 210px;
      overflow-y: auto;
      background: #030712;
      border: 1px solid #1e293b;
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 12.5px;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    }
    .file-item {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      border-bottom: 1px solid #111827;
      color: #cbd5e1;
    }
    .file-item:last-child { border-bottom: none; }
    .submit-btn {
      width: 100%;
      padding: 15px 20px;
      border-radius: 12px;
      border: none;
      background: linear-gradient(135deg, #10b981, #059669);
      color: #fff;
      font-size: 16px;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 6px 20px rgba(16, 185, 129, 0.35);
      transition: transform 0.15s, opacity 0.2s;
    }
    .submit-btn:hover:not(:disabled) {
      transform: translateY(-1px);
    }
    .submit-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .status-box {
      padding: 16px 18px;
      border-radius: 12px;
      margin-top: 16px;
      font-size: 14px;
      line-height: 1.5;
    }
    .status-box.success {
      background: rgba(16, 185, 129, 0.14);
      border: 1px solid rgba(16, 185, 129, 0.5);
      color: #d1fae5;
    }
    .status-box.warning {
      background: rgba(245, 158, 11, 0.14);
      border: 1px solid rgba(245, 158, 11, 0.5);
      color: #fef3c7;
    }
    .status-box.error {
      background: rgba(244, 63, 94, 0.14);
      border: 1px solid rgba(244, 63, 94, 0.5);
      color: #ffe4e6;
    }
    .progress-bar-wrap {
      width: 100%;
      height: 10px;
      background: #1e293b;
      border-radius: 999px;
      overflow: hidden;
      margin-top: 12px;
      display: none;
    }
    .progress-bar {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #0ea5e9, #10b981);
      transition: width 0.2s;
    }
    .drive-btn {
      display: inline-block;
      margin-top: 10px;
      padding: 8px 14px;
      border-radius: 8px;
      background: #0284c7;
      color: #fff;
      text-decoration: none;
      font-weight: 700;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header-card">
      <span class="badge">MINDX TECH &amp; AI SCHOOL</span>
      <h1>🚀 Cổng Nộp Sản Phẩm Cuối Khóa — Lớp ${this.classId}</h1>
      <p class="sub">Con chọn đúng Họ Tên, tải thư mục hoặc file dự án lên. Hệ thống sẽ tự động lưu bài và đẩy lên Google Drive của lớp!</p>
    </div>

    <div class="card">
      <div class="field-group">
        <label for="studentSelect">1. Chọn Họ và Tên Học Viên *</label>
        <select id="studentSelect">
          <option value="">-- Đang tải danh sách học viên lớp ${this.classId}... --</option>
        </select>
        <div class="hint" id="studentStatusHint">Hãy chọn đúng tên của con trong danh sách lớp.</div>
      </div>

      <div class="field-group">
        <label for="projectTitle">2. Tên Sản Phẩm / Dự Án Cuối Khóa *</label>
        <input type="text" id="projectTitle" maxlength="100" placeholder="VD: Ứng dụng Quản lý Thư viện / Game Không Chiến..." />
        <div class="hint">Tối đa 100 ký tự (Nếu để trống sẽ tự động đặt là SPCK + Họ Tên).</div>
      </div>

      <div class="field-group" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label for="youtubeUrl">3. Link Video YouTube (Nếu có)</label>
          <input type="url" id="youtubeUrl" placeholder="https://www.youtube.com/watch?v=..." />
        </div>
        <div>
          <label for="presentationUrl">4. Link Slide / Canva (Nếu có)</label>
          <input type="url" id="presentationUrl" placeholder="https://www.canva.com/..." />
        </div>
      </div>

      <div class="field-group">
        <label>5. Chọn Thư Mục Dự Án hoặc File Bài Làm *</label>
        <div class="upload-grid">
          <label class="pick-btn emerald">
            <span style="font-size:26px;">📁</span>
            <strong>Chọn Cả Thư Mục Dự Án</strong>
            <span>Dành cho Python, PyQt6 (.ui), Web (.html/.css/.js)... Giữ nguyên các thư mục ảnh/giao diện con!</span>
            <input type="file" id="folderInput" webkitdirectory directory multiple style="display:none;" />
          </label>

          <label class="pick-btn">
            <span style="font-size:26px;">📄</span>
            <strong>Chọn File Lẻ (.zip, .sb3, .yyz, .pptx...)</strong>
            <span>Dành cho Scratch (.sb3), GameMaker (.yyz), file nén .zip, Slide thuyết trình, hình ảnh...</span>
            <input type="file" id="filesInput" multiple style="display:none;" />
          </label>
        </div>

        <div id="selectedSummary" style="display:none;margin-top:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span id="fileCountLabel" style="font-size:13px;font-weight:700;color:#34d399;"></span>
            <button type="button" id="clearFilesBtn" style="background:transparent;border:1px solid #475569;color:#cbd5e1;border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer;">Xóa chọn lại</button>
          </div>
          <div class="file-list" id="fileListBox"></div>
        </div>
      </div>

      <button type="button" id="submitBtn" class="submit-btn" disabled>
        🚀 NỘP SẢN PHẨM CUỐI KHÓA
      </button>

      <div class="progress-bar-wrap" id="progressWrap">
        <div class="progress-bar" id="progressBar"></div>
      </div>

      <div id="statusBox" style="display:none;"></div>
    </div>
  </div>

  <script>
    const IGNORED_DIRS = new Set(['node_modules', '__pycache__', '.git', '.venv', 'venv', 'env', '.idea', '.vscode']);
    const FORBIDDEN_EXTS = new Set(['.exe', '.dll', '.bat', '.cmd', '.ps1', '.vbs', '.msi']);

    const studentSelect = document.getElementById('studentSelect');
    const studentStatusHint = document.getElementById('studentStatusHint');
    const projectTitleInput = document.getElementById('projectTitle');
    const youtubeUrlInput = document.getElementById('youtubeUrl');
    const presentationUrlInput = document.getElementById('presentationUrl');
    const folderInput = document.getElementById('folderInput');
    const filesInput = document.getElementById('filesInput');
    const selectedSummary = document.getElementById('selectedSummary');
    const fileCountLabel = document.getElementById('fileCountLabel');
    const fileListBox = document.getElementById('fileListBox');
    const clearFilesBtn = document.getElementById('clearFilesBtn');
    const submitBtn = document.getElementById('submitBtn');
    const progressWrap = document.getElementById('progressWrap');
    const progressBar = document.getElementById('progressBar');
    const statusBox = document.getElementById('statusBox');

    let studentsData = [];
    let selectedFiles = [];
    let pollTimer = null;

    function escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function formatBytes(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function showStatus(type, html) {
      statusBox.style.display = 'block';
      statusBox.className = 'status-box ' + type;
      statusBox.innerHTML = html;
    }

    function updateSubmitButtonState() {
      submitBtn.disabled = !studentSelect.value || selectedFiles.length === 0;
    }

    async function loadPortalStatus() {
      try {
        const res = await fetch(window.location.pathname.replace(/\\/+$/, '') + '/status');
        const data = await res.json();
        if (!data.success) return;
        studentsData = data.students || [];
        const currentVal = studentSelect.value;

        studentSelect.innerHTML = '<option value="">-- Chọn Họ và Tên của con --</option>';
        for (const s of studentsData) {
          const opt = document.createElement('option');
          opt.value = s.studentId;
          const badge = s.hasSubmitted
            ? (s.driveStatus === 'UPLOADED' ? ' ✅ (Đã nộp & Đã lên Drive)' : ' ✅ (Đã nộp)')
            : '';
          opt.textContent = s.fullName + badge;
          studentSelect.appendChild(opt);
        }
        if (currentVal) {
          studentSelect.value = currentVal;
        }
      } catch (e) {}
    }

    studentSelect.addEventListener('change', () => {
      const stu = studentsData.find(s => s.studentId === studentSelect.value);
      if (stu) {
        if (!projectTitleInput.value.trim() || projectTitleInput.value.startsWith('SPCK ')) {
          projectTitleInput.value = stu.projectTitle || ('SPCK ' + stu.fullName);
        }
        if (stu.hasSubmitted) {
          studentStatusHint.innerHTML = '💡 Con đã nộp trước đó (' + stu.filesCount + ' file). Nếu nộp lại, hệ thống sẽ cập nhật bản mới nhất cho con.';
          studentStatusHint.style.color = '#34d399';
        } else {
          studentStatusHint.textContent = 'Đã chọn học viên: ' + stu.fullName;
          studentStatusHint.style.color = '#94a3b8';
        }
      }
      updateSubmitButtonState();
    });

    function addFilesFromInput(fileList) {
      for (const file of Array.from(fileList || [])) {
        const relPath = (file.webkitRelativePath || file.name || '').replace(/\\\\/g, '/');
        const parts = relPath.split('/').filter(Boolean);
        if (parts.some(p => p.startsWith('.') || IGNORED_DIRS.has(p.toLowerCase()))) {
          continue;
        }
        const ext = ('.' + (parts[parts.length - 1].split('.').pop() || '')).toLowerCase();
        if (FORBIDDEN_EXTS.has(ext)) {
          continue;
        }
        if (file.size === 0) continue;
        selectedFiles.push({ file, relativePath: relPath });
      }
      renderSelectedFiles();
    }

    function renderSelectedFiles() {
      if (selectedFiles.length === 0) {
        selectedSummary.style.display = 'none';
        updateSubmitButtonState();
        return;
      }
      selectedSummary.style.display = 'block';
      const totalBytes = selectedFiles.reduce((acc, item) => acc + item.file.size, 0);
      fileCountLabel.textContent = 'Đã chọn ' + selectedFiles.length + ' file (' + formatBytes(totalBytes) + ')';
      fileListBox.innerHTML = selectedFiles
        .slice(0, 80)
        .map(item => '<div class="file-item"><span>' + escapeHtml(item.relativePath) + '</span><span>' + formatBytes(item.file.size) + '</span></div>')
        .join('') + (selectedFiles.length > 80 ? '<div class="file-item"><span>... và ' + (selectedFiles.length - 80) + ' file khác</span></div>' : '');
      updateSubmitButtonState();
    }

    folderInput.addEventListener('change', (e) => {
      addFilesFromInput(e.target.files);
      folderInput.value = '';
    });

    filesInput.addEventListener('change', (e) => {
      addFilesFromInput(e.target.files);
      filesInput.value = '';
    });

    clearFilesBtn.addEventListener('click', () => {
      selectedFiles = [];
      renderSelectedFiles();
    });

    function readFileAsBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const str = String(reader.result || '');
          const base64 = str.includes(',') ? str.split(',').pop() : str;
          resolve(base64);
        };
        reader.onerror = () => reject(new Error('Không đọc được file: ' + file.name));
        reader.readAsDataURL(file);
      });
    }

    async function pollDriveStatusForStudent(studentId) {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(async () => {
        try {
          const res = await fetch(window.location.pathname.replace(/\\/+$/, '') + '/status');
          const data = await res.json();
          if (!data.success) return;
          const stu = (data.students || []).find(s => s.studentId === studentId);
          if (!stu) return;

          if (stu.driveStatus === 'UPLOADED' && stu.driveFolderUrl) {
            clearInterval(pollTimer);
            const safeDriveUrl = /^https:\/\/drive\.google\.com\//i.test(stu.driveFolderUrl) ? escapeHtml(stu.driveFolderUrl) : '#';
            showStatus(
              'success',
              '<strong>🎉 Nộp bài &amp; Đồng bộ Google Drive hoàn tất!</strong><br/>' +
              'Toàn bộ ' + Number(stu.filesCount || 0) + ' file sản phẩm của <strong>' + escapeHtml(stu.fullName) + '</strong> đã được lưu vào máy Thầy và tải lên Google Drive của lớp.<br/>' +
              '<a class="drive-btn" href="' + safeDriveUrl + '" target="_blank" rel="noreferrer">🔗 Mở Thư Mục Google Drive Của Con</a>'
            );
            loadPortalStatus();
          } else if (stu.driveStatus === 'FAILED') {
            clearInterval(pollTimer);
            showStatus(
              'warning',
              '<strong>✅ Đã lưu bài vào máy Thầy thành công (' + Number(stu.filesCount || 0) + ' file)!</strong><br/>' +
              'Lưu ý: Bước tự động đẩy lên Google Drive cần Thầy kiểm tra lại trên máy chủ (' + escapeHtml(stu.driveError || 'chưa đăng nhập Drive') + '). Bài của con đã an toàn trong máy của Thầy!'
            );
            loadPortalStatus();
          }
        } catch (e) {}
      }, 3000);
    }

    submitBtn.addEventListener('click', async () => {
      const studentId = studentSelect.value;
      if (!studentId || selectedFiles.length === 0) return;

      submitBtn.disabled = true;
      progressWrap.style.display = 'block';
      progressBar.style.width = '10%';
      showStatus('warning', '⏳ Đang chuẩn bị và tải ' + selectedFiles.length + ' file lên hệ thống của Thầy...');

      try {
        const filesPayload = [];
        for (let i = 0; i < selectedFiles.length; i++) {
          const item = selectedFiles[i];
          const base64Data = await readFileAsBase64(item.file);
          filesPayload.push({
            relativePath: item.relativePath,
            base64Data
          });
          const pct = Math.min(65, Math.round(((i + 1) / selectedFiles.length) * 60) + 10);
          progressBar.style.width = pct + '%';
        }

        progressBar.style.width = '80%';
        const uploadUrl = window.location.pathname.replace(/\\/+$/, '') + '/upload';
        const res = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentId,
            projectTitle: projectTitleInput.value.trim(),
            youtubeUrl: youtubeUrlInput.value.trim(),
            presentationUrl: presentationUrlInput.value.trim(),
            files: filesPayload
          })
        });

        const data = await res.json();
        progressBar.style.width = '100%';

        if (!data.success) {
          showStatus('error', '❌ <strong>Lỗi khi nộp bài:</strong> ' + escapeHtml(data.error || 'Không thể tải bài lên.'));
          submitBtn.disabled = false;
          return;
        }

        const sub = data.submission;
        selectedFiles = [];
        renderSelectedFiles();
        await loadPortalStatus();

        if (sub.driveStatus === 'QUEUED' || sub.driveStatus === 'UPLOADING') {
          showStatus(
            'success',
            '<strong>✅ Đã nộp thành công ' + Number(sub.filesCount || 0) + ' file vào máy của Thầy!</strong><br/>' +
            '⏳ Hệ thống đang tự động tạo thư mục <strong>' + escapeHtml(sub.fullName) + '</strong> và tải sản phẩm lên Google Drive của lớp... Con chờ vài giây để nhận Link Drive nhé!'
          );
          pollDriveStatusForStudent(studentId);
        } else {
          showStatus(
            'success',
            '<strong>🎉 Chúc mừng ' + escapeHtml(sub.fullName) + ' đã nộp Sản phẩm cuối khóa thành công!</strong><br/>' +
            'Đã lưu ' + Number(sub.filesCount || 0) + ' file vào thư mục lớp trên máy Thầy.'
          );
        }
      } catch (err) {
        showStatus('error', '❌ <strong>Lỗi kết nối khi nộp bài:</strong> ' + escapeHtml(err.message || String(err)));
        submitBtn.disabled = false;
      }
    });

    loadPortalStatus();
  </script>
</body>
</html>`;
  }
}

const globalForStudentPortal = globalThis as unknown as {
  __mindxStudentPortalManager?: StudentPortalManager;
};

export const studentPortalManager: StudentPortalManager =
  globalForStudentPortal.__mindxStudentPortalManager ||
  (globalForStudentPortal.__mindxStudentPortalManager = new StudentPortalManager());
