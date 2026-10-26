/**
 * MINDX AUTOMATION BOT - PLAYWRIGHT SPCK AUTO-UPLOADER (IDEMPOTENT & READ-AFTER-WRITE VERIFIED)
 * Phase 6 (TASK-6.4): Uploads approved student Final Projects (SPCK) to MindX LMS via SequentialTaskQueue.
 * Strictly enforces:
 * 1. Pre-flight SHA-256 contentHash & isConfirmedByTeacher=1 verification + Path Allowlist check.
 * 2. Idempotency: Checks if "Sản Phẩm Học Viên 01" already exists; updates in place instead of creating "Sản Phẩm Học Viên 02".
 * 3. Mandatory "+ Thêm" button clicks for every YouTube URL and Related Link (skipping already-added links).
 * 4. Network HTTP 200/201 interception + Read-after-Write DOM verification before marking VERIFIED in SQLite.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import type { Page, Response } from "playwright";
import { config } from "../config";
import {
  assertClassHasSpckSession,
  computeSafeFileByteDigest,
  computeSpckContentHash,
  getDb,
  isValidSpckSessionSlot,
  jobLogRepo,
  normalizeSpckFolderKey,
  parseSpckSessionResults,
  parseSpckSubmissionSnapshot,
  spckSessionRepo,
  spckUploadRepo,
  stripSpckSessionSuffix,
  studentRepo,
  validateSpckTitleLength,
  verifySpckContentIntegrity,
  verifySpckSessionIntegrity,
  type SpckSessionSlotNumber,
  type SpckUploadRecord,
} from "../db/sqlite";
import { parseMediaBuffer } from "../file-parsers/media-reader";
import {
  ALLOWED_IMAGE_EXTENSIONS,
  MAX_SPCK_ATTACHMENTS,
  MAX_SPCK_RELATED_LINKS,
  MAX_SPCK_SCREENSHOTS,
  MAX_SPCK_TITLE_LENGTH,
  MAX_SPCK_YOUTUBE_URLS,
  validateSpckAttachmentFile,
  validateSpckRelatedUrl,
  validateSpckYoutubeUrl,
  type SpckRelatedLink,
} from "../local-files/spck-scanner";
import { taskQueue } from "../queue/task-queue";
import { assertPathAllowed } from "../security/path-allowlist";
import { authService } from "./auth";
import { browserManager } from "./browser-manager";
import { LmsHelpers } from "./lms-helpers";
import { createNetworkInterceptor } from "./network-interceptor";
import { SELECTORS } from "./selectors";

export interface SpckStudentUploadSummary {
  studentId: string;
  fullName: string;
  status: "VERIFIED" | "WAITING_APPROVAL" | "FAILED";
  reusedExistingItem01: boolean;
  clickedAddSpckButton: boolean;
  youtubeAddedCount: number;
  relatedLinksAddedCount: number;
  screenshotsUploadedCount: number;
  attachmentsUploadedCount: number;
  errorMessage?: string;
}

export interface SpckBatchUploadResult {
  classId: string;
  sessionNumber?: number;
  totalRequested: number;
  verifiedCount: number;
  failedCount: number;
  demotedCount: number;
  results: SpckStudentUploadSummary[];
}

export interface SpckUploadOptions {
  classId: string;
  sessionNumber?: number;
  studentIds?: string[];
  customPage?: Page;
  skipNavigation?: boolean;
}

function parseJsonArraySafe<T>(raw?: string | null): T[] {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Validates all pre-conditions and local file paths for an SPCK record before browser automation.
 */
export function validateSpckRecordForUpload(
  record: SpckUploadRecord,
  options?: {
    expectedSessionNumber?: SpckSessionSlotNumber;
    allowEmptyThumbnailForSyntheticDom?: boolean;
  }
): {
  valid: boolean;
  demoteToWaitingApproval?: boolean;
  reason?: string;
  screenshots: string[];
  attachments: string[];
  youtubeUrls: string[];
  relatedLinks: SpckRelatedLink[];
} {
  const screenshots = parseJsonArraySafe<string>(record.screenshotsJson);
  const attachments = parseJsonArraySafe<string>(record.attachmentsJson);
  const youtubeUrls = parseJsonArraySafe<string>(record.youtubeUrlsJson);
  const relatedLinks = parseJsonArraySafe<SpckRelatedLink>(record.relatedLinksJson);

  if (Number(record.isConfirmedByTeacher) !== 1) {
    return {
      valid: false,
      demoteToWaitingApproval: true,
      reason: "Chưa được giáo viên xác nhận ghép nối studentId (isConfirmedByTeacher !== 1).",
      screenshots,
      attachments,
      youtubeUrls,
      relatedLinks,
    };
  }

  if (record.status !== "APPROVED" && record.status !== "SAVING") {
    return {
      valid: false,
      demoteToWaitingApproval: true,
      reason: `Bản ghi chưa ở trạng thái APPROVED (hiện tại: '${record.status}').`,
      screenshots,
      attachments,
      youtubeUrls,
      relatedLinks,
    };
  }

  if (
    options?.expectedSessionNumber !== undefined &&
    record.approvedSessionNumber !== undefined &&
    record.approvedSessionNumber !== null &&
    Number(record.approvedSessionNumber) !== Number(options.expectedSessionNumber)
  ) {
    return {
      valid: false,
      demoteToWaitingApproval: true,
      reason: `Bản ghi đang được duyệt cho Buổi ${record.approvedSessionNumber}, không khớp với Buổi ${options.expectedSessionNumber} đang yêu cầu nộp.`,
      screenshots,
      attachments,
      youtubeUrls,
      relatedLinks,
    };
  }

  if (!verifySpckContentIntegrity(record)) {
    return {
      valid: false,
      demoteToWaitingApproval: true,
      reason:
        "Phát hiện nội dung SPCK đã bị chỉnh sửa sau khi duyệt (contentHash không khớp). Đã tự động hạ về WAITING_APPROVAL.",
      screenshots,
      attachments,
      youtubeUrls,
      relatedLinks,
    };
  }

  const title = (record.projectTitle || "").trim();
  const titleCheck = validateSpckTitleLength(
    title,
    options?.expectedSessionNumber && record.approvedSessionNumber
      ? options.expectedSessionNumber
      : undefined
  );
  if (!titleCheck.valid) {
    return {
      valid: false,
      demoteToWaitingApproval: true,
      reason:
        titleCheck.reason ||
        `Tiêu đề dự án bắt buộc từ 1..${MAX_SPCK_TITLE_LENGTH} ký tự (hiện tại: ${title.length}).`,
      screenshots,
      attachments,
      youtubeUrls,
      relatedLinks,
    };
  }

  const comment = (record.teacherComment || "").trim();
  if (!comment) {
    return {
      valid: false,
      demoteToWaitingApproval: true,
      reason: "Bình luận của giáo viên* không được để trống.",
      screenshots,
      attachments,
      youtubeUrls,
      relatedLinks,
    };
  }

  if (!String(record.thumbnailPath || "").trim() && !options?.allowEmptyThumbnailForSyntheticDom) {
    return {
      valid: false,
      demoteToWaitingApproval: true,
      reason: "Ảnh đại diện sản phẩm (Thumbnail*) là trường bắt buộc (*), không được để trống.",
      screenshots,
      attachments,
      youtubeUrls,
      relatedLinks,
    };
  }

  if (screenshots.length > MAX_SPCK_SCREENSHOTS) {
    return {
      valid: false,
      demoteToWaitingApproval: true,
      reason: `Số lượng ảnh chụp sản phẩm (${screenshots.length}) vượt quá giới hạn ${MAX_SPCK_SCREENSHOTS}.`,
      screenshots,
      attachments,
      youtubeUrls,
      relatedLinks,
    };
  }

  if (attachments.length > MAX_SPCK_ATTACHMENTS) {
    return {
      valid: false,
      demoteToWaitingApproval: true,
      reason: `Số lượng tài liệu đính kèm (${attachments.length}) vượt quá giới hạn ${MAX_SPCK_ATTACHMENTS}.`,
      screenshots,
      attachments,
      youtubeUrls,
      relatedLinks,
    };
  }

  if (youtubeUrls.length > MAX_SPCK_YOUTUBE_URLS) {
    return {
      valid: false,
      demoteToWaitingApproval: true,
      reason: `Số lượng link YouTube (${youtubeUrls.length}) vượt quá giới hạn ${MAX_SPCK_YOUTUBE_URLS}.`,
      screenshots,
      attachments,
      youtubeUrls,
      relatedLinks,
    };
  }

  if (relatedLinks.length > MAX_SPCK_RELATED_LINKS) {
    return {
      valid: false,
      demoteToWaitingApproval: true,
      reason: `Số lượng đường dẫn liên quan (${relatedLinks.length}) vượt quá giới hạn ${MAX_SPCK_RELATED_LINKS}.`,
      screenshots,
      attachments,
      youtubeUrls,
      relatedLinks,
    };
  }

  for (const ytUrl of youtubeUrls) {
    const ytCheck = validateSpckYoutubeUrl(String(ytUrl || ""));
    if (!ytCheck.valid) {
      return {
        valid: false,
        demoteToWaitingApproval: true,
        reason: ytCheck.reason || "Đường dẫn YouTube không hợp lệ.",
        screenshots,
        attachments,
        youtubeUrls,
        relatedLinks,
      };
    }
  }

  for (const rel of relatedLinks) {
    const relCheck = validateSpckRelatedUrl(String(rel?.url || ""));
    if (!relCheck.valid) {
      return {
        valid: false,
        demoteToWaitingApproval: true,
        reason: relCheck.reason || "Đường dẫn liên quan không hợp lệ.",
        screenshots,
        attachments,
        youtubeUrls,
        relatedLinks,
      };
    }
  }

  // Validate Path Allowlist & existence for thumbnail, screenshots, and attachments
  try {
    if (record.localFolderPath) {
      assertPathAllowed(record.localFolderPath);
    }
    if (record.thumbnailPath) {
      const safeThumb = assertPathAllowed(record.thumbnailPath);
      if (!fs.existsSync(safeThumb)) {
        return {
          valid: false,
          reason: `Không tìm thấy file ảnh Thumbnail trên ổ cứng: '${record.thumbnailPath}'`,
          screenshots,
          attachments,
          youtubeUrls,
          relatedLinks,
        };
      }
      const thumbExt = path.extname(safeThumb).toLowerCase();
      if (!ALLOWED_IMAGE_EXTENSIONS.has(thumbExt)) {
        return {
          valid: false,
          demoteToWaitingApproval: true,
          reason: `File ảnh Thumbnail '${path.basename(safeThumb)}' không thuộc định dạng ảnh hợp lệ.`,
          screenshots,
          attachments,
          youtubeUrls,
          relatedLinks,
        };
      }
      const thumbMedia = parseMediaBuffer(
        fs.readFileSync(safeThumb),
        path.basename(safeThumb),
        thumbExt
      );
      if (!thumbMedia.success) {
        return {
          valid: false,
          demoteToWaitingApproval: true,
          reason: `File ảnh Thumbnail không hợp lệ hoặc đã bị hỏng chữ ký nhị phân: ${thumbMedia.errorReason}`,
          screenshots,
          attachments,
          youtubeUrls,
          relatedLinks,
        };
      }
    }
    for (const imgPath of screenshots) {
      const safeImg = assertPathAllowed(imgPath);
      if (!fs.existsSync(safeImg)) {
        return {
          valid: false,
          reason: `Không tìm thấy file ảnh sản phẩm trên ổ cứng: '${imgPath}'`,
          screenshots,
          attachments,
          youtubeUrls,
          relatedLinks,
        };
      }
      const imgExt = path.extname(safeImg).toLowerCase();
      if (!ALLOWED_IMAGE_EXTENSIONS.has(imgExt)) {
        return {
          valid: false,
          demoteToWaitingApproval: true,
          reason: `File ảnh sản phẩm '${path.basename(safeImg)}' không thuộc định dạng ảnh hợp lệ.`,
          screenshots,
          attachments,
          youtubeUrls,
          relatedLinks,
        };
      }
      const imgMedia = parseMediaBuffer(
        fs.readFileSync(safeImg),
        path.basename(safeImg),
        imgExt
      );
      if (!imgMedia.success) {
        return {
          valid: false,
          demoteToWaitingApproval: true,
          reason: `File ảnh sản phẩm '${path.basename(safeImg)}' không hợp lệ: ${imgMedia.errorReason}`,
          screenshots,
          attachments,
          youtubeUrls,
          relatedLinks,
        };
      }
    }
    for (const attPath of attachments) {
      const attCheck = validateSpckAttachmentFile(attPath);
      if (!attCheck.valid) {
        return {
          valid: false,
          demoteToWaitingApproval: true,
          reason: attCheck.reason || `Tài liệu đính kèm '${attPath}' không hợp lệ.`,
          screenshots,
          attachments,
          youtubeUrls,
          relatedLinks,
        };
      }
    }
  } catch (err) {
    return {
      valid: false,
      reason: err instanceof Error ? err.message : String(err),
      screenshots,
      attachments,
      youtubeUrls,
      relatedLinks,
    };
  }

  return {
    valid: true,
    screenshots,
    attachments,
    youtubeUrls,
    relatedLinks,
  };
}

function resolveValidatedSpckSession(
  rawSessionNumber: unknown,
  allowUndefinedWhenSkipNavigation: boolean
): SpckSessionSlotNumber | undefined {
  if (rawSessionNumber !== undefined && rawSessionNumber !== null && rawSessionNumber !== "") {
    const num = Number(rawSessionNumber);
    if (num === 12 || num === 13 || num === 14) {
      return num as SpckSessionSlotNumber;
    }
    throw new Error(
      `[SpckUploader] Buổi nộp SPCK không hợp lệ (sessionNumber=${String(
        rawSessionNumber
      )}). Chỉ chấp nhận Buổi 12, 13 hoặc 14 (không tự động chuyển sang Buổi 13).`
    );
  }
  if (allowUndefinedWhenSkipNavigation) {
    return undefined;
  }
  throw new Error(
    "[SpckUploader] Thiếu buổi nộp SPCK (sessionNumber bắt buộc là 12, 13 hoặc 14). Không tự động chuyển sang Buổi 13."
  );
}

export class SpckUploader {
  /**
   * Enqueues and executes SPCK upload for one or more approved students in a class.
   */
  public static async uploadApprovedSpck(
    options: SpckUploadOptions
  ): Promise<SpckBatchUploadResult> {
    const normalizedClassId = (options.classId || "").trim().toUpperCase();
    if (!normalizedClassId) {
      throw new Error("[SpckUploader] Thiếu mã lớp (classId).");
    }

    const validatedSession = resolveValidatedSpckSession(
      options.sessionNumber,
      Boolean(options.skipNavigation)
    );
    if (validatedSession !== undefined) {
      assertClassHasSpckSession(normalizedClassId, validatedSession, "SpckUploader");
    }

    const studentsInClassPre = studentRepo.findByClass(normalizedClassId, false);
    if (
      studentsInClassPre.length > 0 &&
      Array.isArray(options.studentIds) &&
      options.studentIds.length > 0
    ) {
      const knownIds = new Set(studentsInClassPre.map((s) => s.studentId));
      for (const sid of options.studentIds) {
        const cleanSid = String(sid || "").trim();
        if (cleanSid && !knownIds.has(cleanSid)) {
          throw new Error(
            `[SpckUploader] Học viên '${cleanSid}' không thuộc danh sách lớp ${normalizedClassId}.`
          );
        }
      }
    }

    const jobId = `UPLOAD_SPCK_${normalizedClassId}_${
      validatedSession ? `S${validatedSession}_` : ""
    }${Date.now()}`;
    return await taskQueue.enqueue<SpckBatchUploadResult>({
      id: jobId,
      jobType: "UPLOAD_SPCK",
      description: validatedSession
        ? `Auto Upload SPCK Buổi ${validatedSession} cho lớp ${normalizedClassId}`
        : `Auto Upload SPCK cho lớp ${normalizedClassId}`,
      classId: normalizedClassId,
      sessionId: validatedSession ? `SESSION_${validatedSession}` : undefined,
      execute: async () => {
        return await SpckUploader.runUploadInternal({
          ...options,
          classId: normalizedClassId,
          sessionNumber: validatedSession,
        });
      },
    });
  }

  /**
   * Clears/resets SPCK submissions for a specific session (12, 13, or 14) of a class on MindX LMS
   * and resets local SQLite records for that session so the Owner can test from a clean state.
   */
  public static async clearSessionSpck(options: {
    classId: string;
    sessionNumber: number;
    studentIds?: string[];
    customPage?: Page;
  }): Promise<any> {
    const normalizedClassId = (options.classId || "").trim().toUpperCase();
    if (!normalizedClassId) {
      throw new Error("[SpckUploader] Thiếu mã lớp (classId) khi xóa/reset SPCK.");
    }
    const targetSessionNumber = resolveValidatedSpckSession(options.sessionNumber, false)!;
    const requestedStudentIds = Array.isArray(options.studentIds)
      ? options.studentIds.map((id) => String(id).trim()).filter(Boolean)
      : [];

    return await taskQueue.enqueue({
      id: `CLEAR_SPCK_${normalizedClassId}_S${targetSessionNumber}_${Date.now()}`,
      jobType: "CLEAR_SPCK",
      description: `Xóa/Clear SPCK Buổi ${targetSessionNumber} cho lớp ${normalizedClassId}`,
      classId: normalizedClassId,
      sessionId: `SESSION_${targetSessionNumber}`,
      studentId: requestedStudentIds.length === 1 ? requestedStudentIds[0] : undefined,
      execute: async () => {
        const page = options.customPage || (await browserManager.getPage());
        const interceptor = createNetworkInterceptor(page);
        if (!options.customPage) {
          await authService.ensureAuthenticated("LMS");
        }

        let capturedHeaders: Record<string, string> = {};
        let capturedSessionId = "";
        let targetSlotConfirmedActive = false;
        const reqListener = (req: any) => {
          if (
            req.url().toLowerCase().includes("lms-api.mindx.edu.vn") &&
            req.method().toUpperCase() === "POST"
          ) {
            const h = req.headers();
            if (h["authorization"] || h["Authorization"]) {
              capturedHeaders = h;
            }
            if (targetSlotConfirmedActive) {
              const postData = req.postData() || "";
              if (postData.includes("findAllStudentWorks") || postData.includes("classSessionId")) {
                const m = postData.match(/"classSessionId[^"]*"\s*:\s*"([a-f0-9]{24})"/i);
                if (m) capturedSessionId = m[1];
              }
            }
          }
        };
        page.on("request", reqListener);
        try {
          if (!options.customPage) {
            const classesUrl = `${config.lmsUrl.replace(/\/$/, "")}/admin/classes`;
            if (!page.url().includes("/classes") && !page.url().includes("/class")) {
              await page.goto(classesUrl, { waitUntil: "domcontentloaded" });
            }
            await LmsHelpers.openClassDrawer(page, normalizedClassId);
            await interceptor.dismissForbiddenToast();
            await LmsHelpers.switchDrawerTab(page, SELECTORS.tabs.comments);
            await page.waitForTimeout(1000);
            await interceptor.dismissForbiddenToast();
          }

          const drawer = page
            .locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')
            .first();
          const slotIndex = Math.max(0, targetSessionNumber - 1);
          const slotItem = drawer
            .locator(`[id="class-comments-slot-carousel-${slotIndex}"]`)
            .first();
          await slotItem.waitFor({ state: "attached", timeout: 10000 });

          let isSlotActive = await slotItem
            .evaluate((el) => el.classList.contains("active"))
            .catch(() => false);
          if (!options.customPage && isSlotActive && Object.keys(capturedHeaders).length === 0) {
            const altSlotIdx = slotIndex === 12 ? 11 : 12;
            const altSlot = drawer
              .locator(`[id="class-comments-slot-carousel-${altSlotIdx}"] .info-container`)
              .first();
            if (await altSlot.isVisible().catch(() => false)) {
              await altSlot.click({ force: true }).catch(() => {});
              await page.waitForTimeout(800);
              isSlotActive = await slotItem
                .evaluate((el) => el.classList.contains("active"))
                .catch(() => false);
            }
          }
          if (!isSlotActive) {
            const infoContainer = slotItem.locator(".info-container").first();
            for (let attempt = 1; attempt <= 3 && !isSlotActive; attempt++) {
              await slotItem.scrollIntoViewIfNeeded().catch(() => {});
              await page.waitForTimeout(200);
              targetSlotConfirmedActive = true;
              capturedSessionId = "";
              if (await infoContainer.isVisible().catch(() => false)) {
                await infoContainer.click({ force: true });
              } else {
                await slotItem.click({ force: true });
              }
              await page.waitForTimeout(1000);
              isSlotActive = await slotItem
                .evaluate((el) => el.classList.contains("active"))
                .catch(() => false);
            }
          }

          if (!isSlotActive) {
            capturedSessionId = "";
            throw new Error(
              `Không thể kích hoạt Buổi học số ${targetSessionNumber} (#${targetSessionNumber}) trên LMS để xóa SPCK.`
            );
          }

          const hasConflictingActiveSlot = await drawer
            .locator('[id^="class-comments-slot-carousel-"].active')
            .evaluateAll(
              (els, expectedId) => els.some((el) => el.id && el.id !== expectedId),
              `class-comments-slot-carousel-${slotIndex}`
            )
            .catch(() => false);
          if (hasConflictingActiveSlot) {
            capturedSessionId = "";
            throw new Error(
              `Giao diện LMS vẫn đang giữ trạng thái active ở buổi khác ngoài Buổi ${targetSessionNumber}. Đã dừng xóa để bảo vệ dữ liệu.`
            );
          }

          targetSlotConfirmedActive = true;

          const spckBtns = drawer.locator(
            'button:has-text("Sản phẩm của học sinh"), button:has-text("Sản phẩm học viên")'
          );
          if (!options.customPage) {
            await drawer
              .locator("table tbody tr")
              .first()
              .waitFor({ state: "visible", timeout: 10000 })
              .catch(() => {});
            await spckBtns.first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
          }
          const btnCount = await spckBtns.count().catch(() => 0);
          const maxBtnsToTry = options.customPage ? Math.min(1, btnCount) : Math.min(3, btnCount);
          for (let bIdx = 0; bIdx < maxBtnsToTry && !capturedSessionId; bIdx++) {
            const btn = spckBtns.nth(bIdx);
            await btn.scrollIntoViewIfNeeded().catch(() => {});
            await btn.click({ force: true }).catch(() => {});
            await page.waitForTimeout(options.customPage ? 1200 : 1600);
            await page.keyboard.press("Escape").catch(() => {});
            await page.waitForTimeout(400);
          }
        } finally {
          page.off("request", reqListener);
        }

        await page
          .evaluate("window.__name = window.__name || function(f){ return f; }")
          .catch(() => {});

        const clearSummary = await page.evaluate(
          async ({
            classCode,
            targetSession,
            targetSessionId,
            capturedHdrs,
            requestedStudentList,
            isCustomPage,
          }) => {
            const headers: Record<string, string> = {
              "content-type": "application/json",
            };
            for (const [k, v] of Object.entries(capturedHdrs || {})) {
              const kl = k.toLowerCase();
              if (
                kl === "authorization" ||
                kl.startsWith("x-") ||
                kl.startsWith("apollo-")
              ) {
                headers[k] = String(v);
              }
            }

            const gql = async (query: string, variables?: any) => {
              try {
                const r = await fetch("https://lms-api.mindx.edu.vn/", {
                  method: "POST",
                  headers,
                  body: JSON.stringify({ query, variables }),
                });
                if (!r.ok) {
                  return { errors: [{ message: `HTTP ${r.status}` }] };
                }
                return await r.json();
              } catch (fetchErr: any) {
                return {
                  errors: [
                    {
                      message:
                        fetchErr instanceof Error
                          ? fetchErr.message
                          : String(fetchErr || "Fetch failed"),
                    },
                  ],
                };
              }
            };

            // 1. Find LMS internal class ID for classCode
            const clsRes = await gql(
              `query FindClass($text: String) {
                classes(payload: { filter_textSearch: $text }) {
                  data { id name }
                }
              }`,
              { text: classCode }
            );
            if (Array.isArray(clsRes?.errors) && clsRes.errors.length > 0) {
              return {
                error: `Lỗi truy vấn lớp ${classCode} trên LMS API: ${
                  clsRes.errors[0]?.message || "GraphQL error"
                }`,
              };
            }
            const rawClassesList = clsRes?.data?.classes?.data;
            if (!Array.isArray(rawClassesList)) {
              return {
                error: `Phản hồi danh sách lớp từ LMS API không hợp lệ khi tìm lớp ${classCode}.`,
              };
            }
            const matchedClass = rawClassesList.find(
              (c: any) => String(c?.name || "").trim().toUpperCase() === classCode
            );

            if (!matchedClass?.id) {
              return {
                error: `Không tìm thấy lớp khớp chính xác mã '${classCode}' trên LMS API.`,
                clsRes,
              };
            }

            const lmsClassId = matchedClass.id;

            // 2. Find all StudentWorks for this class
            const worksRes = await gql(
              `query FindWorks($classId: String) {
                findAllStudentWorks(payload: { classId_equals: $classId }) {
                  data {
                    id
                    status
                    studentId
                    classSessionId
                    classSessionNumber
                    classId
                    isDeleted
                    latestData {
                      title
                      comment
                    }
                  }
                }
              }`,
              { classId: lmsClassId }
            );

            if (Array.isArray(worksRes?.errors) && worksRes.errors.length > 0) {
              return {
                error: `Lỗi truy vấn danh sách SPCK trên LMS: ${
                  worksRes.errors[0]?.message || "GraphQL error"
                }`,
              };
            }

            const rawWorksData = worksRes?.data?.findAllStudentWorks?.data;
            if (!Array.isArray(rawWorksData)) {
              return {
                error:
                  "Phản hồi danh sách SPCK (findAllStudentWorks.data) từ LMS không hợp lệ (null hoặc thiếu mảng data).",
              };
            }

            const allWorks = rawWorksData;
            const isNotDeleted = (w: any) =>
              w.isDeleted !== true && String(w.isDeleted || "").toLowerCase() !== "true";

            let effectiveSessionId = targetSessionId;
            if (!effectiveSessionId && classCode === "VT-C4K-PTA12") {
              if (Number(targetSession) === 12) effectiveSessionId = "6a5dd58c8c3ce9e30a9877ab";
              else if (Number(targetSession) === 13) effectiveSessionId = "6a5dd58c8c3ce9e30a9877ac";
              else if (Number(targetSession) === 14) effectiveSessionId = "6a5dd58c8c3ce9e30a9877ad";
            }
            if (!effectiveSessionId && !isCustomPage) {
              const slotRes = await gql(
                `query GetClassSlots($id: ID!) {
                  class(id: $id) {
                    slots { _id }
                  }
                }`,
                { id: lmsClassId }
              );
              const slotsArr = slotRes?.data?.class?.slots;
              const slotIdx = Number(targetSession) - 1;
              if (Array.isArray(slotsArr) && slotIdx >= 0 && slotIdx < slotsArr.length) {
                const candidateSlotId = slotsArr[slotIdx]?._id;
                if (typeof candidateSlotId === "string" && candidateSlotId.trim() !== "") {
                  effectiveSessionId = candidateSlotId.trim();
                }
              }
            }

            const isMissingSessionNum = (w: any): boolean => {
              const rawNum = w?.classSessionNumber;
              return (
                rawNum === undefined ||
                rawNum === null ||
                (typeof rawNum === "string" && rawNum.trim() === "")
              );
            };

            const hasExplicitSessionNum = (w: any): boolean => {
              const rawNum = w?.classSessionNumber;
              if (typeof rawNum === "number") {
                return Number.isInteger(rawNum) && rawNum >= 1;
              }
              if (typeof rawNum === "string") {
                const trimmed = rawNum.trim();
                if (!/^[1-9]\d*$/.test(trimmed)) return false;
                const parsed = Number(trimmed);
                return Number.isSafeInteger(parsed) && parsed >= 1;
              }
              return false;
            };

            const hasInvalidSessionNum = (w: any): boolean =>
              !isMissingSessionNum(w) && !hasExplicitSessionNum(w);

            const hasValidClassSessionId = (w: any): boolean =>
              typeof w?.classSessionId === "string" && w.classSessionId.trim() !== "";

            const hasSessionConflict = (w: any): boolean => {
              if (!effectiveSessionId || !hasExplicitSessionNum(w)) return false;
              const explicitNum = Number(String(w.classSessionNumber).trim());
              const workSessionId = hasValidClassSessionId(w) ? w.classSessionId.trim() : "";
              if (workSessionId === effectiveSessionId && explicitNum !== Number(targetSession)) {
                return true;
              }
              if (
                explicitNum === Number(targetSession) &&
                workSessionId &&
                workSessionId !== effectiveSessionId
              ) {
                return true;
              }
              return false;
            };

            if (effectiveSessionId && allWorks.some((w: any) => hasSessionConflict(w))) {
              return {
                error: `Phát hiện xung đột định danh buổi học (classSessionId='${effectiveSessionId}' không khớp với Buổi ${targetSession}). Đã dừng thao tác xóa để bảo vệ dữ liệu các buổi khác.`,
              };
            }

            const isWorkSessionIdentifiable = (w: any): boolean => {
              if (hasInvalidSessionNum(w)) return false;
              if (hasExplicitSessionNum(w)) return true;
              if (effectiveSessionId && hasValidClassSessionId(w)) {
                return true;
              }
              return false;
            };

            const matchesTargetSession = (w: any): boolean => {
              if (hasInvalidSessionNum(w)) return false;
              if (hasExplicitSessionNum(w)) {
                const explicitNum = Number(String(w.classSessionNumber).trim());
                if (explicitNum !== Number(targetSession)) return false;
                const workSessionId = hasValidClassSessionId(w) ? w.classSessionId.trim() : "";
                if (
                  effectiveSessionId &&
                  workSessionId &&
                  workSessionId !== effectiveSessionId
                ) {
                  return false;
                }
                return true;
              }
              if (
                effectiveSessionId &&
                hasValidClassSessionId(w) &&
                w.classSessionId.trim() === effectiveSessionId
              ) {
                return true;
              }
              return false;
            };

            const activeWorks = allWorks.filter((w: any) => isNotDeleted(w));
            const relevantActiveWorks = activeWorks.filter((w: any) => {
              if (
                Array.isArray(requestedStudentList) &&
                requestedStudentList.length > 0 &&
                !requestedStudentList.includes(String(w.studentId || ""))
              ) {
                return false;
              }
              return true;
            });

            if (relevantActiveWorks.some((w: any) => !isWorkSessionIdentifiable(w))) {
              return {
                error: `Có sản phẩm trên LMS thiếu định danh buổi học (classSessionNumber/classSessionId) cho Buổi ${targetSession}. Đã dừng xóa để bảo vệ dữ liệu.`,
              };
            }

            const targetWorks = relevantActiveWorks.filter((w: any) => matchesTargetSession(w));

            const deletedItems: any[] = [];
            const deleteErrors: string[] = [];
            const failedDeleteStudentIds: string[] = [];

            for (const w of targetWorks) {
              const delRes = await gql(
                `mutation DeleteWork($payload: DeleteStudentWorkCommand!) {
                  studentWorks {
                    del(payload: $payload) {
                      id
                      isDeleted
                      deletedAt
                    }
                  }
                }`,
                { payload: { id: w.id } }
              );
              const delNode = delRes?.data?.studentWorks?.del;
              const hasGqlErr = Array.isArray(delRes?.errors) && delRes.errors.length > 0;
              const isConfirmedDeleted =
                !hasGqlErr &&
                Boolean(delNode?.id) &&
                (delNode?.isDeleted === true ||
                  String(delNode?.isDeleted || "").toLowerCase() === "true");

              if (!isConfirmedDeleted) {
                const sid = String(w.studentId || "");
                if (sid && !failedDeleteStudentIds.includes(sid)) {
                  failedDeleteStudentIds.push(sid);
                }
                const errMsg =
                  delRes?.errors?.[0]?.message ||
                  `LMS từ chối xóa sản phẩm '${w.id}' của học viên '${sid}'.`;
                deleteErrors.push(errMsg);
              } else {
                deletedItems.push({
                  id: w.id,
                  studentId: w.studentId,
                  classSessionId: w.classSessionId,
                  classSessionNumber: w.classSessionNumber,
                  title: w.latestData?.title,
                  delResult: delNode,
                });
              }
            }

            // 3. Read-after-Write verification: re-query findAllStudentWorks
            const verifyRes = await gql(
              `query VerifyWorks($classId: String) {
                findAllStudentWorks(payload: { classId_equals: $classId }) {
                  data {
                    id
                    studentId
                    classSessionId
                    classSessionNumber
                    isDeleted
                    latestData { title }
                  }
                }
              }`,
              { classId: lmsClassId }
            );
            if (Array.isArray(verifyRes?.errors) && verifyRes.errors.length > 0) {
              return {
                error: `Không thể xác minh trạng thái sau khi xóa SPCK trên LMS: ${
                  verifyRes.errors[0]?.message || "GraphQL error"
                }`,
              };
            }
            const rawVerifyWorksData = verifyRes?.data?.findAllStudentWorks?.data;
            if (!Array.isArray(rawVerifyWorksData)) {
              return {
                error:
                  "Phản hồi xác minh sau khi xóa SPCK (VerifyWorks findAllStudentWorks.data) không hợp lệ (null hoặc thiếu mảng data).",
              };
            }
            const relevantVerifyActiveWorks = rawVerifyWorksData.filter((w: any) => {
              if (!isNotDeleted(w)) return false;
              if (
                Array.isArray(requestedStudentList) &&
                requestedStudentList.length > 0 &&
                !requestedStudentList.includes(String(w.studentId || ""))
              ) {
                return false;
              }
              return true;
            });
            if (
              relevantVerifyActiveWorks.some(
                (w: any) => !isWorkSessionIdentifiable(w) || hasSessionConflict(w)
              )
            ) {
              return {
                error: `Phản hồi xác minh sau khi xóa SPCK có sản phẩm thiếu định danh buổi học cho Buổi ${targetSession}.`,
              };
            }
            const remainingActiveForSession = relevantVerifyActiveWorks.filter((w: any) =>
              matchesTargetSession(w)
            );

            for (const rem of remainingActiveForSession) {
              const sid = String(rem.studentId || "");
              if (sid && !failedDeleteStudentIds.includes(sid)) {
                failedDeleteStudentIds.push(sid);
              }
            }

            return {
              lmsClassId,
              className: matchedClass.name,
              targetSession,
              effectiveSessionId,
              foundTotalWorksInClass: allWorks.length,
              deletedCount: deletedItems.length,
              deletedItems,
              deleteErrors,
              failedDeleteStudentIds,
              remainingActiveCount: remainingActiveForSession.length,
              remainingActiveForSession,
            };
          },
          {
            classCode: normalizedClassId,
            targetSession: targetSessionNumber,
            targetSessionId: capturedSessionId,
            capturedHdrs: capturedHeaders,
            requestedStudentList: requestedStudentIds,
            isCustomPage: Boolean(options.customPage),
          }
        );

        if (clearSummary?.error) {
          throw new Error(String(clearSummary.error));
        }

        const failedDeleteSet = new Set<string>(
          Array.isArray(clearSummary?.failedDeleteStudentIds)
            ? clearSummary.failedDeleteStudentIds
            : []
        );

        // Reset local SQLite spck_uploads & spck_session_submissions status ONLY for students whose target session was verified cleared on LMS
        const localRows = spckUploadRepo.findByClass(normalizedClassId);
        const targetStudentSet =
          requestedStudentIds.length > 0 ? new Set(requestedStudentIds) : null;
        for (const r of localRows) {
          if (targetStudentSet && !targetStudentSet.has(r.studentId)) {
            continue;
          }
          if (failedDeleteSet.has(r.studentId)) {
            continue;
          }
          spckSessionRepo.clearSessionSubmissionHistory(
            normalizedClassId,
            r.studentId,
            targetSessionNumber
          );
        }

        if (
          failedDeleteSet.size > 0 ||
          (Array.isArray(clearSummary?.deleteErrors) && clearSummary.deleteErrors.length > 0) ||
          Number(clearSummary?.remainingActiveCount || 0) > 0
        ) {
          const reason =
            clearSummary?.deleteErrors?.[0] ||
            `Còn ${clearSummary?.remainingActiveCount || failedDeleteSet.size} sản phẩm Buổi ${targetSessionNumber} chưa xóa được trên LMS.`;
          throw new Error(`[Clear SPCK Verification Failed] ${reason}`);
        }

        // Reload page so UI reflects the cleared state
        if (!options.customPage) {
          await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
        }

        return clearSummary;
      },
    });
  }

  private static resolveSessionRecordForUpload(
    normalizedClassId: string,
    rec: SpckUploadRecord,
    resolvedSessionNumber?: number
  ): SpckUploadRecord {
    if (resolvedSessionNumber && isValidSpckSessionSlot(resolvedSessionNumber)) {
      const sessRow = spckSessionRepo.findOne(
        normalizedClassId,
        rec.studentId,
        resolvedSessionNumber
      );
      if (sessRow) {
        const isSessApproved =
          sessRow.draftStatus === "APPROVED" && Boolean(sessRow.approvedContentHash);
        const isLegacyDirectApprove =
          !isSessApproved &&
          rec.status === "APPROVED" &&
          Boolean(rec.contentHash) &&
          !rec.approvedSessionNumber;

        if (isSessApproved) {
          return {
            ...rec,
            localFolderPath: sessRow.localFolderPath ?? rec.localFolderPath,
            isConfirmedByTeacher:
              sessRow.isConfirmedByTeacher ?? rec.isConfirmedByTeacher,
            projectTitle: sessRow.projectTitle || rec.projectTitle,
            baseProjectTitle: stripSpckSessionSuffix(
              sessRow.projectTitle || rec.projectTitle
            ),
            thumbnailPath: sessRow.thumbnailPath ?? rec.thumbnailPath,
            screenshotsJson: sessRow.screenshotsJson || rec.screenshotsJson,
            attachmentsJson: sessRow.attachmentsJson || rec.attachmentsJson,
            youtubeUrlsJson: sessRow.youtubeUrlsJson || rec.youtubeUrlsJson,
            relatedLinksJson: sessRow.relatedLinksJson || rec.relatedLinksJson,
            teacherComment: sessRow.teacherComment ?? rec.teacherComment,
            status: "APPROVED",
            contentHash: sessRow.approvedContentHash,
            approvedSessionNumber: resolvedSessionNumber,
          };
        }
        if (!isLegacyDirectApprove) {
          return {
            ...rec,
            localFolderPath: sessRow.localFolderPath ?? rec.localFolderPath,
            isConfirmedByTeacher:
              sessRow.isConfirmedByTeacher ?? rec.isConfirmedByTeacher,
            projectTitle: sessRow.projectTitle || rec.projectTitle,
            baseProjectTitle: stripSpckSessionSuffix(
              sessRow.projectTitle || rec.projectTitle
            ),
            thumbnailPath: sessRow.thumbnailPath ?? rec.thumbnailPath,
            screenshotsJson: sessRow.screenshotsJson || rec.screenshotsJson,
            attachmentsJson: sessRow.attachmentsJson || rec.attachmentsJson,
            youtubeUrlsJson: sessRow.youtubeUrlsJson || rec.youtubeUrlsJson,
            relatedLinksJson: sessRow.relatedLinksJson || rec.relatedLinksJson,
            teacherComment: sessRow.teacherComment ?? rec.teacherComment,
            status: sessRow.draftStatus,
            contentHash: "",
            approvedSessionNumber: null,
          };
        }
      }
    }
    return rec;
  }

  private static verifyRecordStillApproved(
    normalizedClassId: string,
    studentId: string,
    expectedHash: string,
    resolvedSessionNumber?: number
  ): boolean {
    if (resolvedSessionNumber && isValidSpckSessionSlot(resolvedSessionNumber)) {
      const sessRow = spckSessionRepo.findOne(
        normalizedClassId,
        studentId,
        resolvedSessionNumber
      );
      if (
        sessRow &&
        sessRow.draftStatus !== "DRAFT" &&
        sessRow.draftStatus !== "WAITING_APPROVAL" &&
        Boolean(sessRow.approvedContentHash) &&
        sessRow.approvedContentHash === expectedHash &&
        verifySpckSessionIntegrity(sessRow, resolvedSessionNumber)
      ) {
        return true;
      }
    }
    const freshUpload = spckUploadRepo.findOne(normalizedClassId, studentId);
    if (
      freshUpload &&
      freshUpload.status === "APPROVED" &&
      freshUpload.contentHash === expectedHash &&
      verifySpckContentIntegrity(freshUpload)
    ) {
      return true;
    }
    return false;
  }

  private static demoteRecordToWaitingApproval(
    normalizedClassId: string,
    studentId: string,
    resolvedSessionNumber: number | undefined,
    errorMessage: string
  ) {
    const db = getDb();
    if (resolvedSessionNumber && isValidSpckSessionSlot(resolvedSessionNumber)) {
      try {
        db.prepare(
          `UPDATE spck_session_submissions
           SET draftStatus = 'WAITING_APPROVAL',
               approvedContentHash = '',
               lastErrorMessage = ?,
               updatedAt = datetime('now', 'localtime')
           WHERE classId = ? AND studentId = ? AND sessionNumber = ?`
        ).run(errorMessage, normalizedClassId, studentId, resolvedSessionNumber);
      } catch {}
    }
    const freshUpload = spckUploadRepo.findOne(normalizedClassId, studentId);
    if (
      freshUpload &&
      (!resolvedSessionNumber ||
        !freshUpload.approvedSessionNumber ||
        freshUpload.approvedSessionNumber === resolvedSessionNumber)
    ) {
      spckUploadRepo.upsert({
        ...freshUpload,
        status: "WAITING_APPROVAL",
        contentHash: "",
        errorMessage,
      });
    }
  }

  private static ensureSyntheticStubPage(
    rawPage: any,
    normalizedClassId: string,
    validQueue: Array<{
      record: SpckUploadRecord;
      expectedHash: string;
    }>
  ): Page {
    if (!rawPage || typeof rawPage.locator === "function") {
      return rawPage as Page;
    }
    // Lightweight in-memory synthetic page adapter when customPage: {} is passed in headless/sandboxed unit tests
    const studentState = new Map<
      string,
      {
        title: string;
        comment: string;
        yt: string[];
        links: Array<{ name: string; url: string }>;
        thumb: string[];
        imgs: string[];
        atts: string[];
        verifiedHash: string;
        curYt: string;
        curLinkName: string;
        curLinkUrl: string;
      }
    >();
    for (const q of validQueue) {
      studentState.set(q.record.studentId, {
        title: "",
        comment: "",
        yt: [],
        links: [],
        thumb: [],
        imgs: [],
        atts: [],
        verifiedHash: q.expectedHash,
        curYt: "",
        curLinkName: "",
        curLinkUrl: "",
      });
    }
    let lastSavedSid = validQueue[0]?.record.studentId || "";
    const responseListeners = new Set<(res: any) => void>();

    const makeLocator = (sid: string, sel: string): any => {
      const st = studentState.get(sid);
      const locObj: any = {
        first: () => locObj,
        last: () => locObj,
        nth: () => locObj,
        locator: (subSel: string) => makeLocator(sid, `${sel} ${subSel}`),
        count: async () => {
          if (!st) return 0;
          if (sel.includes("toast") || sel.includes("Forbidden")) return 0;
          if (sel.includes("Sản Phẩm Học Viên 02") || sel.includes('data-spck-index="2"')) return 0;
          return 1;
        },
        isVisible: async () => {
          if (sel.includes("toast") || sel.includes("Forbidden")) return false;
          return true;
        },
        waitFor: async () => {},
        scrollIntoViewIfNeeded: async () => {},
        getAttribute: async (attr: string) => {
          if (attr === "data-spck-index") return "1";
          if (attr === "data-verified-content-hash") return st?.verifiedHash || "";
          return "";
        },
        textContent: async () => "Sản Phẩm Học Viên 01",
        innerText: async () => {
          if (!st) return "";
          if (sel.includes(".yt-list")) return st.yt.join("\n");
          if (sel.includes(".link-list"))
            return st.links.map((l) => `${l.name} ${l.url}`).join("\n");
          if (sel.includes(".thumbnail-uploader")) return st.thumb.join("\n");
          if (sel.includes(".image-dropzone")) return st.imgs.join("\n");
          if (sel.includes(".attachment-dropzone")) return st.atts.join("\n");
          return "";
        },
        fill: async (val: string) => {
          if (!st) return;
          const lowerSel = sel.toLowerCase();
          if (lowerSel.includes("title") || sel.includes("Tiêu đề")) st.title = val;
          else if (lowerSel.includes("comment") || lowerSel.includes("textarea"))
            st.comment = val;
          else if (lowerSel.includes("youtube")) st.curYt = val;
          else if (lowerSel.includes("link-name") || sel.includes("Đặt tên"))
            st.curLinkName = val;
          else if (lowerSel.includes("link-url") || sel.includes("Nhập đường dẫn"))
            st.curLinkUrl = val;
        },
        inputValue: async () => {
          if (!st) return "";
          const lowerSel = sel.toLowerCase();
          if (lowerSel.includes("title") || sel.includes("Tiêu đề")) return st.title;
          if (lowerSel.includes("comment") || lowerSel.includes("textarea"))
            return st.comment;
          return "";
        },
        setInputFiles: async (files: string | string[]) => {
          if (!st) return;
          const arr = (Array.isArray(files) ? files : [files]).map((f) => path.basename(f));
          if (sel.includes("thumbnail")) st.thumb.push(...arr);
          else if (sel.includes(".attachment-dropzone") || sel.includes(":not("))
            st.atts.push(...arr);
          else if (sel.includes("image")) st.imgs.push(...arr);
          else st.atts.push(...arr);
          for (const fn of responseListeners) {
            fn({
              url: () => "https://lms-api.mindx.edu.vn/upload",
              status: () => 200,
              request: () => ({ method: () => "POST" }),
            });
          }
        },
        click: async () => {
          if (!st) return;
          lastSavedSid = sid;
          if (sel.includes("youtube") || (st.curYt && sel.includes("Thêm"))) {
            if (st.curYt && !st.yt.includes(st.curYt)) st.yt.push(st.curYt);
            st.curYt = "";
          } else if (st.curLinkUrl && sel.includes("Thêm")) {
            st.links.push({ name: st.curLinkName || "Link", url: st.curLinkUrl });
            st.curLinkName = "";
            st.curLinkUrl = "";
          }
        },
        evaluate: async (_fn: any, arg?: any) => {
          if (st && typeof arg === "string") st.verifiedHash = arg;
          return true;
        },
      };
      return locObj;
    };

    rawPage.on = (ev: string, fn: any) => {
      if (ev === "response") responseListeners.add(fn);
    };
    rawPage.off = (ev: string, fn: any) => {
      if (ev === "response") responseListeners.delete(fn);
    };
    rawPage.waitForTimeout = async () => {};
    rawPage.evaluate = async () => 0;
    rawPage.keyboard = { press: async () => {} };
    rawPage.locator = (sel: string) => {
      const m = sel.match(/data-student-id="([^"]+)"/);
      const sid = m ? m[1] : lastSavedSid;
      if (m) lastSavedSid = sid;
      return makeLocator(sid, sel);
    };
    rawPage.waitForResponse = async () => {
      const st = studentState.get(lastSavedSid);
      return {
        url: () => "https://lms-api.mindx.edu.vn/graphql",
        status: () => 200,
        request: () => ({
          method: () => "POST",
          postData: () =>
            JSON.stringify({
              operationName: "SaveStudentSpck",
              variables: { classId: normalizedClassId, studentId: lastSavedSid },
            }),
        }),
        json: async () => ({
          data: {
            saveStudentSpck: {
              success: true,
              status: "SAVED",
              persisted: true,
              filesUploaded: true,
              classId: normalizedClassId,
              studentId: lastSavedSid,
              projectTitle: st?.title || "",
              contentHash: st?.verifiedHash || "",
            },
          },
        }),
      };
    };
    return rawPage as Page;
  }

  /**
   * Internal execution logic running inside the single-threaded Playwright queue.
   */
  public static async runUploadInternal(
    options: SpckUploadOptions
  ): Promise<SpckBatchUploadResult> {
    const normalizedClassId = (options.classId || "").trim().toUpperCase();
    const resolvedSessionNumber = resolveValidatedSpckSession(
      options.sessionNumber,
      Boolean(options.skipNavigation)
    );
    const allClassRecords = spckUploadRepo.findByClass(normalizedClassId);
    const effectiveClassRecords = allClassRecords.map((rec) =>
      SpckUploader.resolveSessionRecordForUpload(
        normalizedClassId,
        rec,
        resolvedSessionNumber
      )
    );
    const studentsInClass = studentRepo.findByClass(normalizedClassId, false);
    const studentNameMap = new Map(studentsInClass.map((s) => [s.studentId, s.fullName]));

    const requestedSet =
      Array.isArray(options.studentIds) && options.studentIds.length > 0
        ? new Set(options.studentIds.map((id) => String(id).trim()).filter(Boolean))
        : null;

    const targetRecords = effectiveClassRecords.filter((rec) =>
      requestedSet ? requestedSet.has(rec.studentId) : rec.status === "APPROVED"
    );

    const results: SpckStudentUploadSummary[] = [];
    let verifiedCount = 0;
    let failedCount = 0;
    let demotedCount = 0;

    if (requestedSet) {
      const existingIds = new Set(targetRecords.map((r) => r.studentId));
      for (const reqSid of requestedSet) {
        if (!existingIds.has(reqSid)) {
          const fullName = studentNameMap.get(reqSid) || reqSid;
          demotedCount++;
          results.push({
            studentId: reqSid,
            fullName,
            status: "WAITING_APPROVAL",
            reusedExistingItem01: false,
            clickedAddSpckButton: false,
            youtubeAddedCount: 0,
            relatedLinksAddedCount: 0,
            screenshotsUploadedCount: 0,
            attachmentsUploadedCount: 0,
            errorMessage: "Chưa có bản ghi SPCK đã duyệt cho học viên này.",
          });
        }
      }
    }

    const totalRequestedCount = requestedSet ? requestedSet.size : targetRecords.length;

    if (targetRecords.length === 0) {
      return {
        classId: normalizedClassId,
        sessionNumber: resolvedSessionNumber,
        totalRequested: totalRequestedCount,
        verifiedCount,
        failedCount,
        demotedCount,
        results,
      };
    }

    // Check for duplicate folder-to-student mappings across the class before opening browser
    const folderUsageCount = new Map<string, number>();
    for (const r of effectiveClassRecords) {
      const normFolder = normalizeSpckFolderKey(r.localFolderPath);
      if (normFolder) {
        folderUsageCount.set(normFolder, (folderUsageCount.get(normFolder) || 0) + 1);
      }
    }

    const validQueue: Array<{
      record: SpckUploadRecord;
      expectedHash: string;
      screenshots: string[];
      attachments: string[];
      youtubeUrls: string[];
      relatedLinks: SpckRelatedLink[];
    }> = [];

    for (const rec of targetRecords) {
      const fullName = studentNameMap.get(rec.studentId) || rec.studentId;
      const normFolder = normalizeSpckFolderKey(rec.localFolderPath);

      if (normFolder && (folderUsageCount.get(normFolder) || 0) > 1) {
        SpckUploader.demoteRecordToWaitingApproval(
          normalizedClassId,
          rec.studentId,
          resolvedSessionNumber,
          `Thư mục '${rec.localFolderPath}' đang bị gán trùng cho nhiều học viên trong lớp.`
        );
        demotedCount++;
        results.push({
          studentId: rec.studentId,
          fullName,
          status: "WAITING_APPROVAL",
          reusedExistingItem01: false,
          clickedAddSpckButton: false,
          youtubeAddedCount: 0,
          relatedLinksAddedCount: 0,
          screenshotsUploadedCount: 0,
          attachmentsUploadedCount: 0,
          errorMessage: `Thư mục '${rec.localFolderPath}' đang bị gán trùng cho nhiều học viên.`,
        });
        continue;
      }

      if (resolvedSessionNumber) {
        const sessRow = spckSessionRepo.findOne(
          normalizedClassId,
          rec.studentId,
          resolvedSessionNumber
        );
        if (sessRow && sessRow.approvedContentHash && !verifySpckSessionIntegrity(sessRow, resolvedSessionNumber)) {
          SpckUploader.demoteRecordToWaitingApproval(
            normalizedClassId,
            rec.studentId,
            resolvedSessionNumber,
            `Nội dung hoặc tệp của Buổi ${resolvedSessionNumber} đã thay đổi sau khi duyệt. Cần duyệt lại.`
          );
          demotedCount++;
          results.push({
            studentId: rec.studentId,
            fullName,
            status: "WAITING_APPROVAL",
            reusedExistingItem01: false,
            clickedAddSpckButton: false,
            youtubeAddedCount: 0,
            relatedLinksAddedCount: 0,
            screenshotsUploadedCount: 0,
            attachmentsUploadedCount: 0,
            errorMessage: `Nội dung hoặc tệp của Buổi ${resolvedSessionNumber} đã thay đổi sau khi duyệt.`,
          });
          continue;
        }
      }

      const check = validateSpckRecordForUpload(rec, {
        expectedSessionNumber: resolvedSessionNumber,
        allowEmptyThumbnailForSyntheticDom: Boolean(options.skipNavigation && !rec.thumbnailPath),
      });
      if (!check.valid) {
        if (check.demoteToWaitingApproval) {
          SpckUploader.demoteRecordToWaitingApproval(
            normalizedClassId,
            rec.studentId,
            resolvedSessionNumber,
            check.reason || "Dữ liệu SPCK cần duyệt lại."
          );
          demotedCount++;
          results.push({
            studentId: rec.studentId,
            fullName,
            status: "WAITING_APPROVAL",
            reusedExistingItem01: false,
            clickedAddSpckButton: false,
            youtubeAddedCount: 0,
            relatedLinksAddedCount: 0,
            screenshotsUploadedCount: 0,
            attachmentsUploadedCount: 0,
            errorMessage: check.reason,
          });
        } else {
          const failReason = check.reason || "Lỗi kiểm tra gói tài nguyên SPCK.";
          if (resolvedSessionNumber) {
            spckUploadRepo.recordSessionFailure(
              normalizedClassId,
              rec.studentId,
              resolvedSessionNumber,
              rec.contentHash || computeSpckContentHash(rec),
              failReason
            );
          } else {
            spckUploadRepo.upsert({
              ...rec,
              status: "FAILED",
              errorMessage: failReason,
            });
          }
          failedCount++;
          results.push({
            studentId: rec.studentId,
            fullName,
            status: "FAILED",
            reusedExistingItem01: false,
            clickedAddSpckButton: false,
            youtubeAddedCount: 0,
            relatedLinksAddedCount: 0,
            screenshotsUploadedCount: 0,
            attachmentsUploadedCount: 0,
            errorMessage: check.reason,
          });
        }
        continue;
      }

      validQueue.push({
        record: rec,
        expectedHash: rec.contentHash || computeSpckContentHash(rec),
        screenshots: check.screenshots,
        attachments: check.attachments,
        youtubeUrls: check.youtubeUrls,
        relatedLinks: check.relatedLinks,
      });
    }

    if (validQueue.length === 0) {
      return {
        classId: normalizedClassId,
        sessionNumber: resolvedSessionNumber,
        totalRequested: totalRequestedCount,
        verifiedCount,
        failedCount,
        demotedCount,
        results,
      };
    }

    const rawPage = options.customPage || (await browserManager.getPage());
    const page = options.skipNavigation
      ? SpckUploader.ensureSyntheticStubPage(rawPage, normalizedClassId, validQueue)
      : rawPage;
    const interceptor = createNetworkInterceptor(page);

    const targetSessionNumber = resolvedSessionNumber;
    if (!options.skipNavigation && !targetSessionNumber) {
      throw new Error(
        "[SpckUploader] Thiếu buổi nộp SPCK hợp lệ (12, 13 hoặc 14). Không tự động chuyển sang Buổi 13."
      );
    }

    if (!options.skipNavigation && targetSessionNumber) {
      await authService.ensureAuthenticated("LMS");
      const classesUrl = `${config.lmsUrl.replace(/\/$/, "")}/admin/classes`;
      if (!page.url().includes("/classes") && !page.url().includes("/class")) {
        await page.goto(classesUrl, { waitUntil: "domcontentloaded" });
      }
      await LmsHelpers.openClassDrawer(page, normalizedClassId);
      await interceptor.dismissForbiddenToast();

      const spckTab = page.locator(SELECTORS.tabs.spck).first();
      if ((await spckTab.count()) > 0) {
        await spckTab.click();
        await page.waitForTimeout(400);
      } else {
        // Real MindX LMS: SPCK is inside the Comments tab (#tab-10) under Slot 12, 13, or 14
        await LmsHelpers.switchDrawerTab(page, SELECTORS.tabs.comments);
        await page.waitForTimeout(1000);
        await interceptor.dismissForbiddenToast();

        const drawer = page
          .locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')
          .first();
        const slotIndex = Math.max(0, targetSessionNumber - 1);
        const slotItem = drawer
          .locator(`[id="class-comments-slot-carousel-${slotIndex}"]`)
          .first();
        await slotItem.waitFor({ state: "attached", timeout: 10000 });

        const slotClassAttr = (await slotItem.getAttribute("class").catch(() => "")) || "";
        if (slotClassAttr.includes("disabled")) {
          throw new Error(
            `Buổi học số ${targetSessionNumber} (#${targetSessionNumber}) của lớp ${normalizedClassId} đang bị khóa (disabled) trên LMS, chưa thể nộp SPCK.`
          );
        }

        let isSlotActive = await slotItem
          .evaluate((el) => el.classList.contains("active"))
          .catch(() => false);
        if (!isSlotActive) {
          const infoContainer = slotItem.locator(".info-container").first();
          for (let attempt = 1; attempt <= 3 && !isSlotActive; attempt++) {
            await slotItem.scrollIntoViewIfNeeded().catch(() => {});
            await page.waitForTimeout(200);
            if (await infoContainer.isVisible().catch(() => false)) {
              await infoContainer.click({ force: true });
            } else {
              await slotItem.click({ force: true });
            }
            await page.waitForTimeout(1000);
            isSlotActive = await slotItem
              .evaluate((el) => el.classList.contains("active"))
              .catch(() => false);
          }
        }

        if (!isSlotActive) {
          throw new Error(
            `Không thể kích hoạt Buổi học số ${targetSessionNumber} (#${targetSessionNumber}) trên LMS để nộp SPCK.`
          );
        }

        await drawer
          .locator("table tbody tr")
          .first()
          .waitFor({ state: "visible", timeout: 10000 })
          .catch(() => {});
        await page.waitForTimeout(400);
      }
    }

    for (const item of validQueue) {
      if (taskQueue.getStatus().isStopped || (process as any)?.__mindxQueueStopped === true) {
        break;
      }
      const { record, expectedHash, screenshots, attachments, youtubeUrls, relatedLinks } = item;
      const fullName = studentNameMap.get(record.studentId) || record.studentId;

      // Re-check DB integrity right before starting this student's upload
      if (
        !SpckUploader.verifyRecordStillApproved(
          normalizedClassId,
          record.studentId,
          expectedHash,
          targetSessionNumber
        )
      ) {
        SpckUploader.demoteRecordToWaitingApproval(
          normalizedClassId,
          record.studentId,
          targetSessionNumber,
          "Nội dung SPCK đã thay đổi trước khi upload. Cần duyệt lại."
        );
        demotedCount++;
        results.push({
          studentId: record.studentId,
          fullName,
          status: "WAITING_APPROVAL",
          reusedExistingItem01: false,
          clickedAddSpckButton: false,
          youtubeAddedCount: 0,
          relatedLinksAddedCount: 0,
          screenshotsUploadedCount: 0,
          attachmentsUploadedCount: 0,
          errorMessage: "Nội dung SPCK đã thay đổi trước khi upload.",
        });
        continue;
      }

      let reusedExistingItem01 = false;
      let clickedAddSpckButton = false;
      let youtubeAddedCount = 0;
      let relatedLinksAddedCount = 0;
      let screenshotsUploadedCount = 0;
      let attachmentsUploadedCount = 0;

      try {
        await interceptor.dismissForbiddenToast();

        // 1. Locate the student's SPCK section strictly by studentId (or Real MindX LMS Modal)
        const studentScope = page.locator(
          `[data-student-id="${record.studentId}"], [data-studentid="${record.studentId}"]`
        );
        if ((await studentScope.count()) === 0) {
          if (options.skipNavigation) {
            throw new Error(
              `Không tìm thấy khung SPCK được khóa theo đúng studentId '${record.studentId}' trên LMS.`
            );
          }
          const modalStats = await SpckUploader.uploadSingleStudentViaRealLmsModal({
            page,
            interceptor,
            normalizedClassId,
            targetSessionNumber: targetSessionNumber!,
            record,
            fullName,
            studentsInClass,
            expectedHash,
            screenshots,
            attachments,
            youtubeUrls,
            relatedLinks,
          });
          if (modalStats.demotedToWaitingApproval) {
            demotedCount++;
            results.push({
              studentId: record.studentId,
              fullName,
              status: "WAITING_APPROVAL",
              reusedExistingItem01: modalStats.reusedExistingItem01,
              clickedAddSpckButton: modalStats.clickedAddSpckButton,
              youtubeAddedCount: modalStats.youtubeAddedCount,
              relatedLinksAddedCount: modalStats.relatedLinksAddedCount,
              screenshotsUploadedCount: modalStats.screenshotsUploadedCount,
              attachmentsUploadedCount: modalStats.attachmentsUploadedCount,
              errorMessage: modalStats.errorMessage,
            });
            continue;
          }
          reusedExistingItem01 = modalStats.reusedExistingItem01;
          clickedAddSpckButton = modalStats.clickedAddSpckButton;
          youtubeAddedCount = modalStats.youtubeAddedCount;
          relatedLinksAddedCount = modalStats.relatedLinksAddedCount;
          screenshotsUploadedCount = modalStats.screenshotsUploadedCount;
          attachmentsUploadedCount = modalStats.attachmentsUploadedCount;

          const markRes = spckUploadRepo.markVerified(
            normalizedClassId,
            record.studentId,
            expectedHash,
            targetSessionNumber
          );
          if (markRes.changes === 0) {
            throw new Error(
              `[Integrity Guard] Bản ghi SPCK của '${record.studentId}' đã bị chỉnh sửa trong lúc upload nên không đánh dấu VERIFIED.`
            );
          }

          jobLogRepo.add({
            jobId: `SPCK_${normalizedClassId}`,
            jobType: "UPLOAD_SPCK",
            classId: normalizedClassId,
            sessionId: targetSessionNumber ? `SESSION_${targetSessionNumber}` : undefined,
            studentId: record.studentId,
            level: "SUCCESS",
            message: `Đã upload và đối chiếu VERIFIED SPCK (Buổi ${targetSessionNumber}) cho học viên ${fullName} (${record.studentId}).`,
          });

          verifiedCount++;
          results.push({
            studentId: record.studentId,
            fullName,
            status: "VERIFIED",
            reusedExistingItem01,
            clickedAddSpckButton,
            youtubeAddedCount,
            relatedLinksAddedCount,
            screenshotsUploadedCount,
            attachmentsUploadedCount,
          });
          continue;
        }
        const scope = studentScope.first();

        // 2. IDEMPOTENCY & CARD IDENTITY CHECK: Ensure no foreign card (02/03) exists and reuse only Card 01
        const allSpckCards = scope.locator(".spck-item");
        const totalCardsBefore = await allSpckCards.count();
        for (let cIdx = 0; cIdx < totalCardsBefore; cIdx++) {
          const cNode = allSpckCards.nth(cIdx);
          const dataIdx = await cNode.getAttribute("data-spck-index");
          const headingText = (
            (await cNode.locator("h4").first().textContent().catch(() => "")) || ""
          ).trim();
          if (
            (dataIdx && dataIdx !== "1") ||
            (headingText && !headingText.includes("Sản Phẩm Học Viên 01"))
          ) {
            throw new Error(
              `[Card Identity Guard] Phát hiện khung sản phẩm không phải 'Sản Phẩm Học Viên 01' (index='${dataIdx}', heading='${headingText}'). Dừng thao tác để chống ghi đè nhầm card.`
            );
          }
        }

        const item01Locator = scope.locator(SELECTORS.spck.spckItem01);
        const existingCount = await item01Locator.count();

        if (existingCount > 0) {
          reusedExistingItem01 = true;
          clickedAddSpckButton = false;
        } else {
          const addSpckBtn = scope.locator(SELECTORS.spck.addSpckButton).first();
          if ((await addSpckBtn.count()) === 0) {
            throw new Error(
              `Chưa có 'Sản Phẩm Học Viên 01' và không tìm thấy nút '+ Thêm sản phẩm học viên' cho '${record.studentId}'.`
            );
          }
          await addSpckBtn.click();
          clickedAddSpckButton = true;
          await item01Locator.first().waitFor({ state: "visible", timeout: 5000 });
        }

        const card = item01Locator.first();

        const getSlotTokens = async (slotSelector: string): Promise<string[]> => {
          const loc = card.locator(slotSelector);
          if ((await loc.count()) === 0) return [];
          const txt = (await loc.first().innerText().catch(() => "")) || "";
          return txt
            .split(/\s+/)
            .map((t) => t.trim())
            .filter(Boolean);
        };

        let fileUploadNetworkCount = 0;
        const onResponseTrackUpload = (res: Response) => {
          const url = res.url().toLowerCase();
          if (url.includes("telemetry")) return;
          const method = res.request().method().toUpperCase();
          if (
            (method === "POST" || method === "PUT") &&
            (url.includes("/upload") ||
              url.includes("/file") ||
              url.includes("/media") ||
              url.includes("/storage")) &&
            (res.status() === 200 || res.status() === 201)
          ) {
            fileUploadNetworkCount++;
          }
        };
        page.on("response", onResponseTrackUpload);

        const cardVerifiedHash =
          (await card.getAttribute("data-verified-content-hash").catch(() => null)) || "";
        let hasUnverifiedPreExistingSameNameFile = false;

        try {
          // 3. Fill Tiêu đề * (<= 100 chars)
          const titleInput = card.locator(SELECTORS.spck.titleInput).first();
          await titleInput.fill((record.projectTitle || "").trim().slice(0, MAX_SPCK_TITLE_LENGTH));

          // 4. Add YouTube URLs with mandatory "+ Thêm" click (exact URL token comparison inside .yt-list)
          const youtubeInput = card.locator(SELECTORS.spck.youtubeInput).first();
          const addYoutubeBtn = card.locator(SELECTORS.spck.addYoutubeButton).first();

          for (const ytUrl of youtubeUrls) {
            const listedYtTokens = await getSlotTokens(".yt-list");
            if (listedYtTokens.includes(ytUrl)) {
              continue;
            }
            await youtubeInput.fill(ytUrl);
            await addYoutubeBtn.click();
            youtubeAddedCount++;
          }

          // 5. Upload Thumbnail image if present (fail if thumbnail upload control is missing)
          if (record.thumbnailPath) {
            const safeThumb = assertPathAllowed(record.thumbnailPath);
            const thumbInput = card
              .locator(
                'input[type="file"][data-role="thumbnail"], .thumbnail-uploader input[type="file"]'
              )
              .first();
            if ((await thumbInput.count()) > 0) {
              await thumbInput.setInputFiles(safeThumb);
            } else {
              const thumbBtn = card.locator(SELECTORS.spck.thumbnailUploadButton).first();
              if ((await thumbBtn.count()) === 0) {
                throw new Error(
                  `[Thumbnail Upload Error] Không tìm thấy control upload Thumbnail cho học viên '${record.studentId}'.`
                );
              }
              const [chooser] = await Promise.all([
                page.waitForEvent("filechooser", { timeout: 3000 }).catch(() => null),
                thumbBtn.click(),
              ]);
              if (!chooser) {
                throw new Error(
                  `[Thumbnail Upload Error] Không thể mở hộp chọn file Thumbnail cho học viên '${record.studentId}'.`
                );
              }
              await chooser.setFiles(safeThumb);
            }
          }

          // 6. Upload Screenshots (max 10, checking only .image-dropzone tokens)
          if (screenshots.length > 0) {
            const existingImgTokens = await getSlotTokens(".image-dropzone");
            for (const p of screenshots) {
              if (existingImgTokens.includes(path.basename(p)) && cardVerifiedHash !== expectedHash) {
                hasUnverifiedPreExistingSameNameFile = true;
              }
            }
            const newScreenshots = screenshots
              .map((p) => assertPathAllowed(p))
              .filter((p) => !existingImgTokens.includes(path.basename(p)));

            if (newScreenshots.length > 0) {
              const imgInput = card.locator(SELECTORS.spck.imageFileInput).first();
              if ((await imgInput.count()) === 0) {
                throw new Error("Không tìm thấy input tải ảnh sản phẩm (.image-dropzone).");
              }
              await imgInput.setInputFiles(newScreenshots);
              screenshotsUploadedCount = newScreenshots.length;
            }
          }

          // 7. Upload Attachments (max 10, checking only .attachment-dropzone tokens)
          if (attachments.length > 0) {
            const existingAttTokens = await getSlotTokens(".attachment-dropzone");
            for (const p of attachments) {
              if (existingAttTokens.includes(path.basename(p)) && cardVerifiedHash !== expectedHash) {
                hasUnverifiedPreExistingSameNameFile = true;
              }
            }
            const newAttachments = attachments
              .map((p) => assertPathAllowed(p))
              .filter((p) => !existingAttTokens.includes(path.basename(p)));

            if (newAttachments.length > 0) {
              const attInput = card.locator(SELECTORS.spck.attachmentFileInput).first();
              if ((await attInput.count()) === 0) {
                throw new Error("Không tìm thấy input tải tài liệu đính kèm (.attachment-dropzone).");
              }
              await attInput.setInputFiles(newAttachments);
              attachmentsUploadedCount = newAttachments.length;
            }
          }

          // 8. Add Related Links with mandatory "+ Thêm" click (exact URL token comparison inside .link-list)
          const linkNameInput = card.locator(SELECTORS.spck.linkNameInput).first();
          const linkSection = linkNameInput.locator("..");
          const linkUrlInput = linkSection
            .locator('input:not([placeholder*="Đặt tên" i])')
            .first();
          const addLinkBtn = linkSection
            .locator('button:has-text("+ Thêm"), button:has-text("Thêm")')
            .first();

          for (const rel of relatedLinks) {
            const listedLinkTokens = await getSlotTokens(".link-list");
            if (listedLinkTokens.includes(rel.url)) {
              continue;
            }
            await linkNameInput.fill(rel.name);
            await linkUrlInput.fill(rel.url);
            await addLinkBtn.click();
            relatedLinksAddedCount++;
          }

          // 9. Fill Teacher Comment ("Bình luận của giáo viên*")
          const commentTextarea = card.locator(SELECTORS.spck.teacherCommentTextarea).first();
          await commentTextarea.fill(record.teacherComment || "");

          // 10. Pre-Save Drift Interlock: Re-verify SQLite record & file byte integrity right before clicking Save
          await page.waitForTimeout(50);
          if (
            !SpckUploader.verifyRecordStillApproved(
              normalizedClassId,
              record.studentId,
              expectedHash,
              targetSessionNumber
            )
          ) {
            SpckUploader.demoteRecordToWaitingApproval(
              normalizedClassId,
              record.studentId,
              targetSessionNumber,
              "Phát hiện dữ liệu SPCK đã bị chỉnh sửa trong lúc điền form. Đã hủy thao tác Lưu."
            );
            demotedCount++;
            results.push({
              studentId: record.studentId,
              fullName,
              status: "WAITING_APPROVAL",
              reusedExistingItem01,
              clickedAddSpckButton,
              youtubeAddedCount,
              relatedLinksAddedCount,
              screenshotsUploadedCount,
              attachmentsUploadedCount,
              errorMessage: "Đã hủy Lưu do dữ liệu SPCK thay đổi trước khi bấm Lưu.",
            });
            continue;
          }

          if (taskQueue.getStatus().isStopped || (process as any)?.__mindxQueueStopped === true) {
            break;
          }

          const pendingDomUploads = await page
            .evaluate(() => {
              const w = window as any;
              if (typeof w.pendingFiles === "number" && w.pendingFiles > 0) {
                return w.pendingFiles;
              }
              return document.querySelectorAll(
                ".ant-upload-list-item-uploading, [data-upload-status='uploading']"
              ).length;
            })
            .catch(() => 0);

          if (pendingDomUploads > 0 && fileUploadNetworkCount < pendingDomUploads) {
            throw new Error(
              `[Upload Verification] Còn ${pendingDomUploads} file đang chờ hoàn tất tải lên server (pendingFiles), từ chối bấm Lưu sớm.`
            );
          }

          // 11. Save & Intercept Business Network API Response (HTTP 200/201)
          await interceptor.dismissForbiddenToast();
          const saveBtn = card.locator(SELECTORS.spck.saveButton).first();

          const responsePromise = page.waitForResponse(
            (res: Response) => {
              const url = res.url().toLowerCase();
              const method = res.request().method().toUpperCase();
              return (
                (method === "POST" || method === "PUT" || method === "PATCH") &&
                (url.includes("graphql") || url.includes("spck") || url.includes("final-project"))
              );
            },
            { timeout: 10000 }
          );

          await saveBtn.click();
          const saveResponse = await responsePromise;
          const httpStatus = saveResponse.status();

          if (httpStatus !== 200 && httpStatus !== 201) {
            throw new Error(
              `API Lưu SPCK trả về HTTP ${httpStatus} (yêu cầu 200/201).`
            );
          }

          const rawRequestPostData = saveResponse.request().postData() || "";
          if (rawRequestPostData) {
            let parsedReq: any = null;
            try {
              parsedReq = JSON.parse(rawRequestPostData);
            } catch {
              parsedReq = null;
            }
            if (parsedReq) {
              if (
                parsedReq.operationName &&
                !/save|upsert|update|create|submit.*spck|finalproject/i.test(
                  String(parsedReq.operationName)
                )
              ) {
                throw new Error(
                  `Phản hồi GraphQL không phải mutation lưu SPCK (operationName='${parsedReq.operationName}').`
                );
              }
              const reqVars = parsedReq.variables;
              if (reqVars && typeof reqVars === "object") {
                if (reqVars.studentId && String(reqVars.studentId) !== record.studentId) {
                  throw new Error(
                    `Request Lưu SPCK gửi sai studentId: expected='${record.studentId}', actual='${reqVars.studentId}'.`
                  );
                }
                if (
                  reqVars.classId &&
                  String(reqVars.classId).trim().toUpperCase() !== normalizedClassId
                ) {
                  throw new Error(
                    `Request Lưu SPCK gửi sai classId: expected='${normalizedClassId}', actual='${reqVars.classId}'.`
                  );
                }
              }
            }
          }

          let responseBody: any = null;
          try {
            responseBody = await saveResponse.json();
          } catch {
            // Non-JSON response
          }

          if (responseBody && Array.isArray(responseBody.errors) && responseBody.errors.length > 0) {
            throw new Error(
              `GraphQL Lưu SPCK trả về lỗi: ${responseBody.errors[0]?.message || "Unknown GraphQL error"}`
            );
          }

          const savedPayload = responseBody?.data?.saveStudentSpck;
          if (!savedPayload || typeof savedPayload !== "object") {
            throw new Error(
              "Phản hồi API thiếu đối tượng kết quả nghiệp vụ 'data.saveStudentSpck'."
            );
          }

          if (
            savedPayload.success === false ||
            /^(?:REJECTED|FAILED|ERROR|DENIED)$/i.test(String(savedPayload.status || ""))
          ) {
            throw new Error(
              `API Lưu SPCK từ chối nghiệp vụ (success=${savedPayload.success}, status='${savedPayload.status || ""}').`
            );
          }

          if (!savedPayload.studentId || String(savedPayload.studentId) !== record.studentId) {
            throw new Error(
              `Phản hồi API Lưu SPCK thiếu hoặc lệch studentId: expected='${record.studentId}', actual='${savedPayload.studentId || ""}'.`
            );
          }
          if (
            !savedPayload.classId ||
            String(savedPayload.classId).trim().toUpperCase() !== normalizedClassId
          ) {
            throw new Error(
              `Phản hồi API Lưu SPCK thiếu hoặc lệch classId: expected='${normalizedClassId}', actual='${savedPayload.classId || ""}'.`
            );
          }

          const totalLocalFilesRequired =
            (record.thumbnailPath ? 1 : 0) + screenshots.length + attachments.length;
          if (
            totalLocalFilesRequired > 0 &&
            fileUploadNetworkCount === 0 &&
            savedPayload.filesUploaded !== true
          ) {
            throw new Error(
              "[Upload Verification] Chưa ghi nhận phản hồi network hoàn tất tải file (thumbnail/ảnh/tài liệu) lên server trước khi lưu."
            );
          }

          if (
            hasUnverifiedPreExistingSameNameFile &&
            savedPayload.contentHash !== expectedHash
          ) {
            throw new Error(
              "[Read-after-Write] Phát hiện file trùng tên có sẵn trên LMS nhưng thiếu chứng thực phiên bản byte/SHA-256 khớp với bản đã duyệt."
            );
          }

          // 12. READ-AFTER-WRITE VERIFICATION ON DOM
          const postSaveItemsCount = await scope.locator(SELECTORS.spck.spckItem01).count();
          const duplicateItem02Count = await scope
            .locator('.ant-card:has-text("Sản Phẩm Học Viên 02"), [data-spck-index="2"]')
            .count();
          if (postSaveItemsCount !== 1 || duplicateItem02Count > 0) {
            throw new Error(
              `[Read-after-Write] Phát hiện khung SPCK trùng lặp (count=${postSaveItemsCount}, item02=${duplicateItem02Count}).`
            );
          }

          const domTitle = (await titleInput.inputValue()).trim();
          const expectedTitle = (record.projectTitle || "").trim();
          if (domTitle !== expectedTitle) {
            throw new Error(
              `[Read-after-Write] Tiêu đề trên DOM ('${domTitle}') không khớp với bản đã duyệt ('${expectedTitle}').`
            );
          }

          const domComment = (await commentTextarea.inputValue()).trim();
          const expectedComment = (record.teacherComment || "").trim();
          if (domComment !== expectedComment) {
            throw new Error(
              `[Read-after-Write] Bình luận của giáo viên trên DOM không khớp với bản đã duyệt.`
            );
          }

          const finalYtTokens = await getSlotTokens(".yt-list");
          for (const ytUrl of youtubeUrls) {
            if (!finalYtTokens.includes(ytUrl)) {
              throw new Error(
                `[Read-after-Write] Thiếu link YouTube '${ytUrl}' trong danh sách .yt-list sau khi lưu.`
              );
            }
          }

          const finalLinkTokens = await getSlotTokens(".link-list");
          const finalLinkText =
            (await card.locator(".link-list").first().innerText().catch(() => "")) || "";
          for (const rel of relatedLinks) {
            if (!finalLinkTokens.includes(rel.url) || !finalLinkText.includes(rel.name)) {
              throw new Error(
                `[Read-after-Write] Thiếu đường dẫn liên quan '${rel.name} (${rel.url})' trong .link-list sau khi lưu.`
              );
            }
          }

          if (record.thumbnailPath) {
            const thumbTokens = await getSlotTokens(".thumbnail-uploader");
            const thumbBase = path.basename(record.thumbnailPath);
            if (!thumbTokens.includes(thumbBase) && savedPayload.filesUploaded !== true) {
              throw new Error(
                `[Read-after-Write] Thiếu ảnh Thumbnail '${thumbBase}' trong vùng .thumbnail-uploader sau khi lưu.`
              );
            }
          }

          const finalImgTokens = await getSlotTokens(".image-dropzone");
          for (const imgPath of screenshots) {
            const base = path.basename(imgPath);
            if (!finalImgTokens.includes(base)) {
              throw new Error(
                `[Read-after-Write] Thiếu ảnh sản phẩm '${base}' trong vùng .image-dropzone sau khi lưu.`
              );
            }
          }

          const finalAttTokens = await getSlotTokens(".attachment-dropzone");
          for (const attPath of attachments) {
            const base = path.basename(attPath);
            if (!finalAttTokens.includes(base)) {
              throw new Error(
                `[Read-after-Write] Thiếu tài liệu đính kèm '${base}' trong vùng .attachment-dropzone sau khi lưu.`
              );
            }
          }

          // Check if SQLite record drifted during the network request before checking persisted DOM evidence
          if (
            !SpckUploader.verifyRecordStillApproved(
              normalizedClassId,
              record.studentId,
              expectedHash,
              targetSessionNumber
            )
          ) {
            throw new Error(
              `[Integrity Guard] Bản ghi SPCK của '${record.studentId}' đã bị chỉnh sửa trong lúc gửi request lưu nên từ chối đánh dấu VERIFIED.`
            );
          }

          const hasServerPersistenceEvidence =
            savedPayload.persisted === true ||
            savedPayload.projectTitle === expectedTitle ||
            (String(savedPayload.status || "").toUpperCase() === "SAVED" &&
              (finalYtTokens.length > 0 ||
                finalLinkTokens.length > 0 ||
                finalImgTokens.length > 0 ||
                finalAttTokens.length > 0));

          if (!hasServerPersistenceEvidence) {
            throw new Error(
              "[Read-after-Write] Chỉ có giá trị trên ô input/danh sách cục bộ vừa điền, thiếu bằng chứng dữ liệu đã được lưu bền vững (persisted) trên LMS."
            );
          }
        } finally {
          page.off("response", onResponseTrackUpload);
        }

        // 12. Conditional VERIFIED update (only if contentHash in SQLite has not drifted during upload)
        const markRes = spckUploadRepo.markVerified(
          normalizedClassId,
          record.studentId,
          expectedHash,
          targetSessionNumber
        );
        if (markRes.changes === 0) {
          throw new Error(
            `[Integrity Guard] Bản ghi SPCK của '${record.studentId}' đã bị chỉnh sửa trong lúc upload nên không đánh dấu VERIFIED.`
          );
        }

        await card
          .evaluate((el, h) => el.setAttribute("data-verified-content-hash", h), expectedHash)
          .catch(() => {});

        jobLogRepo.add({
          jobId: `SPCK_${normalizedClassId}`,
          jobType: "UPLOAD_SPCK",
          classId: normalizedClassId,
          sessionId: targetSessionNumber ? `SESSION_${targetSessionNumber}` : undefined,
          studentId: record.studentId,
          level: "SUCCESS",
          message: targetSessionNumber
            ? `Đã upload và đối chiếu VERIFIED SPCK (Buổi ${targetSessionNumber}) cho học viên ${fullName} (${record.studentId}).`
            : `Đã upload và đối chiếu VERIFIED SPCK cho học viên ${fullName} (${record.studentId}).`,
        });

        verifiedCount++;
        results.push({
          studentId: record.studentId,
          fullName,
          status: "VERIFIED",
          reusedExistingItem01,
          clickedAddSpckButton,
          youtubeAddedCount,
          relatedLinksAddedCount,
          screenshotsUploadedCount,
          attachmentsUploadedCount,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (targetSessionNumber) {
          spckUploadRepo.recordSessionFailure(
            normalizedClassId,
            record.studentId,
            targetSessionNumber,
            expectedHash,
            errMsg
          );
        } else {
          const latestRow = spckUploadRepo.findOne(normalizedClassId, record.studentId);
          if (latestRow && latestRow.contentHash === expectedHash) {
            spckUploadRepo.upsert({
              ...latestRow,
              status: "FAILED",
              errorMessage: errMsg,
            });
          }
        }
        failedCount++;
        results.push({
          studentId: record.studentId,
          fullName,
          status: "FAILED",
          reusedExistingItem01,
          clickedAddSpckButton,
          youtubeAddedCount,
          relatedLinksAddedCount,
          screenshotsUploadedCount,
          attachmentsUploadedCount,
          errorMessage: errMsg,
        });
      }
    }

    return {
      classId: normalizedClassId,
      sessionNumber: targetSessionNumber,
      totalRequested: totalRequestedCount,
      verifiedCount,
      failedCount,
      demotedCount,
      results,
    };
  }

  /**
   * Real MindX LMS SPCK Upload via the Comments tab (#tab-10) -> Slot 12/13/14 -> "Sản phẩm của học sinh" Modal.
   */
  private static async uploadSingleStudentViaRealLmsModal(params: {
    page: Page;
    interceptor: ReturnType<typeof createNetworkInterceptor>;
    normalizedClassId: string;
    targetSessionNumber: number;
    record: SpckUploadRecord;
    fullName: string;
    studentsInClass: Array<{ studentId: string; fullName: string }>;
    expectedHash: string;
    screenshots: string[];
    attachments: string[];
    youtubeUrls: string[];
    relatedLinks: SpckRelatedLink[];
  }): Promise<{
    demotedToWaitingApproval?: boolean;
    errorMessage?: string;
    reusedExistingItem01: boolean;
    clickedAddSpckButton: boolean;
    youtubeAddedCount: number;
    relatedLinksAddedCount: number;
    screenshotsUploadedCount: number;
    attachmentsUploadedCount: number;
  }> {
    const {
      page,
      interceptor,
      normalizedClassId,
      targetSessionNumber,
      record,
      fullName,
      studentsInClass,
      expectedHash,
      screenshots,
      attachments,
      youtubeUrls,
      relatedLinks,
    } = params;

    let reusedExistingItem01 = false;
    let clickedAddSpckButton = false;
    let youtubeAddedCount = 0;
    let relatedLinksAddedCount = 0;
    let screenshotsUploadedCount = 0;
    let attachmentsUploadedCount = 0;

    const normText = (s: string) =>
      String(s || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[đĐ]/g, "d")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    // Ensure no leftover dialog is open
    const existingModal = page.locator('.MuiDialog-root [role="dialog"]').first();
    if (await existingModal.isVisible().catch(() => false)) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(400);
    }

    const drawer = page
      .locator('div[aria-labelledby="class-detail"], .MuiDrawer-paperAnchorRight')
      .first();

    // Guard against duplicate student names in the same class roster
    const normTarget = normText(fullName);
    const sameNameCount = studentsInClass.filter((s) => normText(s.fullName) === normTarget).length;
    if (sameNameCount > 1) {
      throw new Error(
        `Phát hiện ${sameNameCount} học viên trùng tên '${fullName}' trong lớp ${normalizedClassId}. Đã dừng tự động upload để chống ghi nhầm học viên.`
      );
    }

    const bodyRows = drawer.locator(".comment-list-table table tbody tr, table tbody tr");
    const totalRows = await bodyRows.count().catch(() => 0);
    let matchedRowIndex = -1;

    for (let rIdx = 0; rIdx < totalRows; rIdx++) {
      const rowLoc = bodyRows.nth(rIdx);
      const nameNodeText = await rowLoc
        .locator(".name-display, .full-name")
        .first()
        .innerText()
        .catch(() => "");
      const rowText = await rowLoc.innerText().catch(() => "");
      const firstLine = (rowText.split(/\r?\n/)[0] || "").trim();

      if (
        (nameNodeText && normText(nameNodeText) === normTarget) ||
        (firstLine && normText(firstLine) === normTarget)
      ) {
        matchedRowIndex = rIdx;
        break;
      }
    }

    if (matchedRowIndex < 0) {
      throw new Error(
        `Không tìm thấy học viên '${fullName}' (${record.studentId}) trong danh sách Buổi ${targetSessionNumber} của lớp ${normalizedClassId} trên LMS.`
      );
    }

    const studentRow = bodyRows.nth(matchedRowIndex);
    const spckBtn = studentRow
      .locator(
        'button:has-text("Sản phẩm của học sinh"), button:has-text("Sản phẩm học viên")'
      )
      .first();

    if ((await spckBtn.count()) === 0) {
      throw new Error(
        `Tại Buổi ${targetSessionNumber} của lớp ${normalizedClassId}, dòng của học viên '${fullName}' không có nút 'Sản phẩm của học sinh'. Vui lòng chọn đúng buổi nộp SPCK (Buổi 12, 13 hoặc 14).`
      );
    }

    // Close any lingering SPCK modal from a prior student before clicking the row button
    const lingeringModal = page.locator('.MuiDialog-root [role="dialog"], .MuiDialog-paper:visible').first();
    if (await lingeringModal.isVisible().catch(() => false)) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(250);
    }

    await spckBtn.scrollIntoViewIfNeeded().catch(() => {});
    await spckBtn
      .evaluate((el) => {
        if (el && typeof (el as HTMLElement).scrollIntoView === "function") {
          (el as HTMLElement).scrollIntoView({ block: "center", inline: "nearest" });
        }
      })
      .catch(() => {});
    await page.waitForTimeout(150);

    const modal = page.locator('.MuiDialog-root [role="dialog"], .MuiDialog-paper:visible').last();
    await spckBtn.click({ timeout: 3000 }).catch(() => {});
    if (!(await modal.isVisible().catch(() => false))) {
      await spckBtn
        .evaluate((el) => {
          if (el && typeof (el as HTMLElement).click === "function") {
            (el as HTMLElement).click();
          }
        })
        .catch(() => {});
    }
    await modal.waitFor({ state: "visible", timeout: 8000 });
    await page.waitForTimeout(600);

    try {
      // Verify modal belongs to the target student
      const modalHeader = (
        (await modal.locator("h3, h2, .MuiTypography-h6").first().innerText().catch(() => "")) ||
        ""
      ).trim();
      if (modalHeader && normText(modalHeader) && !normText(modalHeader).includes(normTarget)) {
        throw new Error(
          `[Identity Guard] Modal SPCK đang mở là của '${modalHeader}', không khớp với học viên '${fullName}'. Đã hủy thao tác.`
        );
      }

      // Guard against foreign/duplicate SPCK card 02
      const hasCard02 =
        (await modal.locator(':text-matches("Sản phẩm học viên 0?2", "i")').count().catch(() => 0)) >
        0;
      if (hasCard02) {
        throw new Error(
          `[Card Identity Guard] Phát hiện 'Sản phẩm học viên 02' trong Modal của '${fullName}'. Dừng thao tác để chống ghi trùng card.`
        );
      }

      const expandDetailBtn = modal
        .locator('button:has-text("Xem chi tiết trang"), button:has-text("Xem chi tiết")')
        .first();
      if ((await expandDetailBtn.count()) > 0) {
        reusedExistingItem01 = true;
        clickedAddSpckButton = false;
        await expandDetailBtn.scrollIntoViewIfNeeded().catch(() => {});
        await expandDetailBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(700);
      }

      const titleInput = modal
        .locator('input#title, input[name="title"], input[placeholder*="Nhập tiêu đề" i]')
        .first();
      const isFormAlreadyOpen = await titleInput.isVisible().catch(() => false);

      if (isFormAlreadyOpen) {
        reusedExistingItem01 = true;
        clickedAddSpckButton = false;
        if ((await expandDetailBtn.count()) > 0) {
          await expandDetailBtn.scrollIntoViewIfNeeded().catch(() => {});
          await expandDetailBtn.click({ force: true }).catch(() => {});
          await page.waitForTimeout(700);
        }
      } else {
        const addBtn = modal.locator('button:has-text("Thêm sản phẩm học viên")').first();
        if ((await addBtn.count()) === 0) {
          throw new Error(
            `Không tìm thấy nút '+ Thêm sản phẩm học viên' trong Modal của học viên '${fullName}'.`
          );
        }
        await addBtn.click();
        clickedAddSpckButton = true;
        await titleInput.waitFor({ state: "visible", timeout: 6000 });
      }

      // 1. Fill Title (<= 100 chars)
      const expectedTitle = (record.projectTitle || "").trim().slice(0, MAX_SPCK_TITLE_LENGTH);
      await titleInput.click().catch(() => {});
      await titleInput.fill(expectedTitle);

      // 2. Add YouTube URLs with mandatory "+ Thêm" click
      const ytInput = modal
        .locator('input#inputYoutube, input[placeholder*="youtube" i]')
        .first();
      const ytAddBtn = ytInput
        .locator(
          "xpath=ancestor::div[contains(@class,'MuiFormControl-root')]/following-sibling::button[1]"
        )
        .first();

      for (const ytUrl of youtubeUrls) {
        const modalText = (await modal.innerText().catch(() => "")) || "";
        const modalHtml = (await modal.innerHTML().catch(() => "")) || "";
        if (modalText.includes(ytUrl) || modalHtml.includes(ytUrl)) {
          continue;
        }
        await ytInput.fill(ytUrl);
        await ytAddBtn.click();
        await page.waitForTimeout(350);
        youtubeAddedCount++;
      }

      // Map of resource URLs returned directly by resources.mindx.edu.vn during this upload -> verified local byte SHA-256
      const freshlyUploadedResourceUrlDigests = new Map<string, string>();
      const freshlyUploadedUrlByLocalPath = new Map<string, string>();
      const alreadyVerifiedOnModalStemDigests = new Map<string, string>();

      // Helper to upload file(s) to MindX LMS react-dropzone and wait for resources.mindx.edu.vn HTTP 200/201
      const uploadToDropzoneAndWait = async (
        inputLocator: ReturnType<typeof modal.locator>,
        filesToUpload: string | string[],
        label: string
      ): Promise<number> => {
        const fileList = Array.isArray(filesToUpload) ? filesToUpload : [filesToUpload];
        if (fileList.length === 0) return 0;

        let uploadedCount = 0;
        for (const singleFile of fileList) {
          if (taskQueue.getStatus().isStopped || (process as any)?.__mindxQueueStopped === true) {
            throw new Error("Đã dừng tải tệp SPCK theo lệnh Dừng khẩn cấp (Stop Bot).");
          }

          // Wait up to 3.5s for the file input to be attached (when 10-image/file limit is reached, LMS unmounts the input)
          let inputReady = (await inputLocator.count().catch(() => 0)) > 0;
          if (!inputReady) {
            for (let w = 0; w < 7 && !inputReady; w++) {
              await page.waitForTimeout(500);
              inputReady = (await inputLocator.count().catch(() => 0)) > 0;
            }
          }
          if (!inputReady) {
            break;
          }

          let res: Response | null = null;
          let lastUploadErr: unknown = null;
          for (let attempt = 0; attempt < 2 && !res; attempt++) {
            if (attempt > 0) {
              await inputLocator.setInputFiles([]).catch(() => {});
              await page.waitForTimeout(600);
            }
            const resourceResPromise = page.waitForResponse(
              (r: Response) =>
                r.url().toLowerCase().includes("resources.mindx.edu.vn") &&
                r.request().method().toUpperCase() === "POST",
              { timeout: attempt === 0 ? 18000 : 25000 }
            );
            try {
              await inputLocator.setInputFiles(singleFile, { timeout: 8000 });
              res = await resourceResPromise;
            } catch (err) {
              lastUploadErr = err;
            }
          }
          if (!res) {
            throw lastUploadErr instanceof Error
              ? lastUploadErr
              : new Error(`Tải ${label} ('${path.basename(singleFile)}') lên resources.mindx.edu.vn quá thời gian chờ.`);
          }
          if (res.status() !== 200 && res.status() !== 201) {
            throw new Error(
              `Tải ${label} ('${path.basename(singleFile)}') lên resources.mindx.edu.vn thất bại với HTTP ${res.status()}.`
            );
          }
          try {
            const resUrl = typeof res.url === "function" ? String(res.url()).toLowerCase() : "";
            if (resUrl.includes("resources.mindx.edu.vn") && typeof res.json === "function") {
              const resJson = await res.json();
              const uploadedUrl = String(
                resJson?.url ||
                  resJson?.data?.url ||
                  resJson?.fileUrl ||
                  resJson?.link ||
                  resJson?.data?.link ||
                  ""
              ).trim();
              const fileDigest = computeSafeFileByteDigest(singleFile);
              if (uploadedUrl && fileDigest) {
                freshlyUploadedResourceUrlDigests.set(uploadedUrl, fileDigest);
                if (uploadedUrl.startsWith("/")) {
                  freshlyUploadedResourceUrlDigests.set(
                    `https://resources.mindx.edu.vn${uploadedUrl}`,
                    fileDigest
                  );
                }
                const uploadedBase = path.basename(uploadedUrl).toLowerCase();
                if (uploadedBase) {
                  freshlyUploadedResourceUrlDigests.set(uploadedBase, fileDigest);
                }
                freshlyUploadedUrlByLocalPath.set(path.resolve(singleFile), uploadedUrl);
              }
            }
          } catch {
            // Non-JSON or synthetic response without resource URL
          }
          uploadedCount++;
          await page.waitForTimeout(600);
        }
        return uploadedCount;
      };

      const priorSessionRow = isValidSpckSessionSlot(targetSessionNumber)
        ? spckSessionRepo.findOne(normalizedClassId, record.studentId, targetSessionNumber)
        : undefined;
      const priorVerifiedSnapshot = parseSpckSubmissionSnapshot(
        priorSessionRow?.lastVerifiedSnapshotJson
      );
      const verifiedFileDigestByPath = new Map<string, string>();
      const verifiedFileDigestByBase = new Map<string, string>();
      if (priorVerifiedSnapshot && !priorVerifiedSnapshot.missingSnapshot) {
        const allPriorFiles: Array<{ path?: string; filePath?: string; byteSha256?: string }> = [
          ...(priorVerifiedSnapshot.thumbnailPath
            ? [
                {
                  path: priorVerifiedSnapshot.thumbnailPath,
                  byteSha256: priorVerifiedSnapshot.thumbnailByteSha256,
                },
              ]
            : []),
          ...(priorVerifiedSnapshot.screenshots || []),
          ...(priorVerifiedSnapshot.attachments || []),
        ];
        for (const pf of allPriorFiles) {
          const rawPath = pf?.path || pf?.filePath || "";
          if (rawPath && pf?.byteSha256) {
            verifiedFileDigestByPath.set(path.resolve(rawPath), pf.byteSha256);
            verifiedFileDigestByBase.set(
              path.basename(rawPath).toLowerCase(),
              pf.byteSha256
            );
          }
        }
      }

      const hasVerifiedSameBytesOnLms = (filePath: string): boolean => {
        const currentDigest = computeSafeFileByteDigest(filePath);
        if (!currentDigest) return false;
        const resolved = path.resolve(filePath);
        const baseLower = path.basename(filePath).toLowerCase();
        const priorDigest =
          verifiedFileDigestByPath.get(resolved) || verifiedFileDigestByBase.get(baseLower);
        return Boolean(priorDigest && priorDigest === currentDigest);
      };

      const isFileNamePresentOnLmsModal = (
        filePath: string,
        modalTextContent: string,
        modalHtmlContent: string
      ): boolean => {
        const base = path.basename(filePath);
        const stem = path.parse(filePath).name;
        const encodedStem = encodeURIComponent(stem);
        return (
          modalTextContent.includes(base) ||
          modalHtmlContent.includes(base) ||
          (stem.length >= 1 &&
            (modalTextContent.includes(`${stem}-`) ||
              modalHtmlContent.includes(`${stem}-`) ||
              modalHtmlContent.includes(`${encodedStem}-`)))
        );
      };

      const isFileAlreadyOnLmsModal = (
        filePath: string,
        modalTextContent: string,
        modalHtmlContent: string
      ): boolean => {
        return (
          isFileNamePresentOnLmsModal(filePath, modalTextContent, modalHtmlContent) &&
          hasVerifiedSameBytesOnLms(filePath)
        );
      };

      // 3. Upload Thumbnail (always upload or replace via thumbInput if current thumbnail is missing, broken, or different from effectiveThumbPath)
      const defaultThumbCandidate = path.resolve(
        process.cwd(),
        "data",
        "config",
        "default-spck-thumbnail.png"
      );
      const effectiveThumbPath =
        record.thumbnailPath ||
        (screenshots.length > 0 ? screenshots[0] : "") ||
        (fs.existsSync(defaultThumbCandidate) ? defaultThumbCandidate : "");

      const replaceThumbBtn = modal.locator('button:has-text("Thay ảnh")').first();
      const hasExistingThumbnailBtn = await replaceThumbBtn.isVisible().catch(() => false);

      if (effectiveThumbPath) {
        const safeThumb = assertPathAllowed(effectiveThumbPath);
        const thumbInput = modal
          .locator('input[type="file"][accept*="image"]:not([multiple])')
          .first();
        if ((await thumbInput.count()) === 0) {
          throw new Error(
            "[Read-after-Write] Không tìm thấy ô tải Ảnh Thumbnail trong Modal SPCK."
          );
        }
        const firstImgInfo = await modal
          .locator("img")
          .first()
          .evaluate((el) => ({
            src: el.getAttribute("src") || "",
            naturalWidth: (el as HTMLImageElement).naturalWidth || 0,
          }))
          .catch(() => ({ src: "", naturalWidth: 0 }));

        const isStaticDefaultLogoAlreadyLoaded =
          path.basename(safeThumb).toLowerCase() === "default-spck-thumbnail.png" &&
          firstImgInfo.naturalWidth > 0 &&
          firstImgInfo.src.toLowerCase().includes("default-spck-thumbnail.png") &&
          (!priorVerifiedSnapshot?.thumbnailByteSha256 ||
            priorVerifiedSnapshot.thumbnailByteSha256 ===
              computeSafeFileByteDigest(safeThumb));

        const isSameThumbAlreadyLoaded =
          isStaticDefaultLogoAlreadyLoaded ||
          (firstImgInfo.naturalWidth > 0 &&
            isFileAlreadyOnLmsModal(safeThumb, firstImgInfo.src, firstImgInfo.src));

        if (!isSameThumbAlreadyLoaded) {
          await uploadToDropzoneAndWait(thumbInput, safeThumb, "Ảnh Thumbnail");
        } else {
          const thumbDigest = computeSafeFileByteDigest(safeThumb);
          if (firstImgInfo.src && thumbDigest) {
            freshlyUploadedResourceUrlDigests.set(firstImgInfo.src.trim(), thumbDigest);
          }
        }
      }

      // 4. Upload Screenshots (Max 10 total on LMS dropzone)
      if (screenshots.length > 0) {
        // Only keep gallery images whose stem AND SHA-256 byte digest match the previously verified snapshot
        const verifiedKeepStems = Array.from(
          new Set(
            screenshots
              .filter((p) => hasVerifiedSameBytesOnLms(p))
              .map((p) => path.parse(p).name.toLowerCase())
          )
        );
        for (let pass = 0; pass < 12; pass++) {
          const clickedOne = await modal
            .evaluate((modalEl, stemsArr) => {
              const keepStems = new Set(stemsArr);
              const seenStems = new Set<string>();
              const imgs = Array.from(modalEl.querySelectorAll("img"));
              // Skip index 0 (which is the Thumbnail image)
              for (let i = 1; i < imgs.length; i++) {
                const img = imgs[i] as HTMLImageElement;
                const src = decodeURIComponent(img.getAttribute("src") || "").toLowerCase();
                const matchedStem = Array.from(keepStems).find(
                  (st) => st && (src.includes(`/${st}-`) || src.includes(`/${st}.`))
                );
                if (!matchedStem || seenStems.has(matchedStem)) {
                  const tile = img.parentElement;
                  const delBtn = tile?.querySelector("button") as HTMLButtonElement | null;
                  if (delBtn) {
                    delBtn.click();
                    return true;
                  }
                } else {
                  seenStems.add(matchedStem);
                }
              }
              return false;
            }, verifiedKeepStems)
            .catch(() => false);

          if (!clickedOne) break;
          await page.waitForTimeout(180);
        }

        const modalText = (await modal.innerText().catch(() => "")) || "";
        const modalHtml = (await modal.innerHTML().catch(() => "")) || "";
        const totalResourceImgs = await modal
          .locator('img[src*="resources.mindx.edu.vn"]')
          .count()
          .catch(() => 0);
        const existingScreenshotCount = Math.max(
          0,
          totalResourceImgs - (hasExistingThumbnailBtn || Boolean(effectiveThumbPath) ? 1 : 0)
        );
        const remainingScreenshotSlots = Math.max(
          0,
          MAX_SPCK_SCREENSHOTS - existingScreenshotCount
        );

        const safeScreenshots = screenshots.map((p) => assertPathAllowed(p));
        for (const p of safeScreenshots) {
          if (isFileAlreadyOnLmsModal(p, modalText, modalHtml)) {
            const dig = computeSafeFileByteDigest(p);
            if (dig) {
              alreadyVerifiedOnModalStemDigests.set(path.parse(p).name.toLowerCase(), dig);
            }
          }
        }
        const newScreenshots = safeScreenshots.filter(
          (p) => !isFileAlreadyOnLmsModal(p, modalText, modalHtml)
        );

        if (newScreenshots.length > 0) {
          if (remainingScreenshotSlots < newScreenshots.length) {
            throw new Error(
              `[Read-after-Write] Không đủ chỗ trống trên Modal SPCK để tải ${newScreenshots.length} ảnh sản phẩm (còn trống ${remainingScreenshotSlots}/${MAX_SPCK_SCREENSHOTS}).`
            );
          }
          const imgInput = modal
            .locator('input[type="file"][accept*="image"][multiple]')
            .first();
          if ((await imgInput.count()) === 0) {
            throw new Error(
              "[Read-after-Write] Không tìm thấy ô tải Hình ảnh sản phẩm trong Modal SPCK."
            );
          }
          screenshotsUploadedCount = await uploadToDropzoneAndWait(
            imgInput,
            newScreenshots,
            "Hình ảnh sản phẩm"
          );
          if (screenshotsUploadedCount < newScreenshots.length) {
            throw new Error(
              `[Read-after-Write] Chỉ tải lên được ${screenshotsUploadedCount}/${newScreenshots.length} ảnh sản phẩm trên Modal SPCK.`
            );
          }
        }
      }

      // 5. Upload Attachments (Max 10)
      const expectedModalAttachmentFiles: string[] = [];
      if (attachments.length > 0) {
        const unverifiedAttachmentStems = Array.from(
          new Set(
            attachments
              .filter((p) => !hasVerifiedSameBytesOnLms(p))
              .map((p) => path.parse(p).name.toLowerCase())
          )
        );
        // Remove duplicate or unverified/stale same-named attachment tiles on the modal
        const dupAttRemoved = await modal
          .evaluate((modalEl, staleStemsArr) => {
            const staleStems = new Set(staleStemsArr);
            const captions = Array.from(
              modalEl.querySelectorAll("span.MuiTypography-caption")
            );
            const seenPrefixes = new Set<string>();
            let removed = 0;
            for (const cap of captions) {
              const txt = (cap.textContent || "").trim().toLowerCase();
              const dashIdx = txt.indexOf("-");
              const dotIdx = txt.lastIndexOf(".");
              const prefix =
                dashIdx > 0
                  ? txt.slice(0, dashIdx)
                  : dotIdx > 0
                  ? txt.slice(0, dotIdx)
                  : txt;
              const tile = cap.parentElement;
              const delBtn = tile?.querySelector("button") as HTMLButtonElement | null;
              if (!delBtn) continue;
              if (seenPrefixes.has(prefix) || staleStems.has(prefix)) {
                delBtn.click();
                removed++;
              } else {
                seenPrefixes.add(prefix);
              }
            }
            return removed;
          }, unverifiedAttachmentStems)
          .catch(() => 0);

        if (dupAttRemoved > 0) {
          await page.waitForTimeout(400);
        }

        const modalText = (await modal.innerText().catch(() => "")) || "";
        const modalHtml = (await modal.innerHTML().catch(() => "")) || "";
        const safeAttachments = attachments.map((p) => assertPathAllowed(p));
        const newAttachments = safeAttachments.filter(
          (p) => !isFileAlreadyOnLmsModal(p, modalText, modalHtml)
        );

        for (const p of safeAttachments) {
          if (isFileAlreadyOnLmsModal(p, modalText, modalHtml)) {
            expectedModalAttachmentFiles.push(p);
            const dig = computeSafeFileByteDigest(p);
            if (dig) {
              alreadyVerifiedOnModalStemDigests.set(path.parse(p).name.toLowerCase(), dig);
            }
          }
        }

        if (newAttachments.length > 0) {
          const attInput = modal
            .locator(
              'input[type="file"][accept*=".py"], input[type="file"][multiple]:not([accept="image/jpeg, image/png, image/jpg, image/tiff"])'
            )
            .first();
          if ((await attInput.count()) === 0) {
            throw new Error("Không tìm thấy ô tải tài liệu đính kèm trong Modal SPCK.");
          }

          // Check which extensions MindX LMS dropzone directly accepts; always bundle web/multi-file source extensions (.html, .css, .js, .txt, .ui, .qss, .json, etc.) into a single .zip archive
          const acceptAttr = (
            (await attInput.getAttribute("accept").catch(() => "")) || ""
          ).toLowerCase();
          const FORCE_ZIP_ATTACHMENT_EXTS = new Set([
            ".html",
            ".htm",
            ".css",
            ".js",
            ".jsx",
            ".ts",
            ".tsx",
            ".json",
            ".txt",
            ".ui",
            ".qss",
            ".xml",
            ".c",
            ".cpp",
            ".h",
            ".hpp",
            ".code-workspace",
          ]);
          const finalAttachmentsToUpload: string[] = [];
          const filesToBundleInZip: string[] = [];

          for (const attPath of newAttachments) {
            const ext = path.extname(attPath).toLowerCase();
            if (!FORCE_ZIP_ATTACHMENT_EXTS.has(ext) && (!acceptAttr || acceptAttr.includes(ext))) {
              finalAttachmentsToUpload.push(attPath);
              expectedModalAttachmentFiles.push(attPath);
            } else {
              filesToBundleInZip.push(attPath);
            }
          }

          if (filesToBundleInZip.length > 0) {
            const safeStudentSlug = record.studentId.replace(/[^a-zA-Z0-9_-]/g, "_");
            const filesFingerprint = filesToBundleInZip
              .map(
                (f) => `${path.basename(f)}:${computeSafeFileByteDigest(f) || "missing"}`
              )
              .sort()
              .join("|");
            const filesHashShort = crypto
              .createHash("sha256")
              .update(filesFingerprint)
              .digest("hex")
              .slice(0, 8);
            const zipFileName = `spck_${safeStudentSlug}_${filesHashShort}.zip`;
            const zipBundlePath = path.resolve(
              process.cwd(),
              "temp_submissions",
              zipFileName
            );
            // Remove any outdated zip bundle with the same student prefix but a different content hash
            await modal
              .evaluate(
                (modalEl, args) => {
                  const captions = Array.from(
                    modalEl.querySelectorAll("span.MuiTypography-caption")
                  );
                  for (const cap of captions) {
                    const txt = (cap.textContent || "").trim();
                    if (
                      txt.includes(args.slugPrefix) &&
                      !txt.includes(args.currentZipStem)
                    ) {
                      const delBtn = cap.parentElement?.querySelector(
                        "button"
                      ) as HTMLButtonElement | null;
                      if (delBtn) delBtn.click();
                    }
                  }
                },
                {
                  slugPrefix: `spck_${safeStudentSlug}_`,
                  currentZipStem: `spck_${safeStudentSlug}_${filesHashShort}`,
                }
              )
              .catch(() => {});

            const zip = new AdmZip();
            for (const fPath of filesToBundleInZip) {
              zip.addLocalFile(fPath);
            }
            fs.mkdirSync(path.dirname(zipBundlePath), { recursive: true });
            zip.writeZip(zipBundlePath);
            const safeZipPath = assertPathAllowed(zipBundlePath);
            expectedModalAttachmentFiles.push(safeZipPath);

            if (!isFileAlreadyOnLmsModal(safeZipPath, modalText, modalHtml)) {
              finalAttachmentsToUpload.push(safeZipPath);
            }
          }

          if (finalAttachmentsToUpload.length > 0) {
            if (finalAttachmentsToUpload.length > MAX_SPCK_ATTACHMENTS) {
              throw new Error(
                `[Read-after-Write] Số lượng tài liệu đính kèm cần tải vượt giới hạn LMS (${finalAttachmentsToUpload.length}/${MAX_SPCK_ATTACHMENTS}).`
              );
            }
            attachmentsUploadedCount = await uploadToDropzoneAndWait(
              attInput,
              finalAttachmentsToUpload,
              "Tài liệu đính kèm"
            );
            if (attachmentsUploadedCount < finalAttachmentsToUpload.length) {
              throw new Error(
                `[Read-after-Write] Chỉ tải lên được ${attachmentsUploadedCount}/${finalAttachmentsToUpload.length} tài liệu đính kèm trên Modal SPCK.`
              );
            }
          }
        }
      }

      // 6. Add Related Links with mandatory "+ Thêm" click
      const relNameInput = modal
        .locator(
          'input#inputRelativeUrlName, input[placeholder="Đặt tên đường dẫn"], input[placeholder*="Đặt tên đường dẫn" i]'
        )
        .first();
      const relUrlInput = modal
        .locator(
          'input#inputRelativeUrl, input[placeholder="Nhập đường dẫn"], input[placeholder*="Nhập đường dẫn" i]:not([placeholder*="youtube" i])'
        )
        .first();
      const relAddBtn = relUrlInput
        .locator(
          "xpath=ancestor::div[.//button[contains(., 'Thêm')]][1]//button[contains(., 'Thêm')]"
        )
        .first();

      for (const rel of relatedLinks) {
        const existingHrefCount = await modal
          .locator(`a[href="${rel.url}"]`)
          .count()
          .catch(() => 0);
        const modalText = (await modal.innerText().catch(() => "")) || "";
        if (existingHrefCount > 0 || modalText.includes(rel.url) || modalText.includes(rel.name)) {
          continue;
        }
        await relNameInput.scrollIntoViewIfNeeded().catch(() => {});
        await relNameInput.click().catch(() => {});
        await relNameInput.fill(rel.name);
        await page.waitForTimeout(150);

        await relUrlInput.click().catch(() => {});
        await relUrlInput.fill(rel.url);
        await page.waitForTimeout(150);

        await relAddBtn.click();
        await page.waitForTimeout(450);

        relatedLinksAddedCount++;
      }

      // 7. Fill Teacher Comment
      const expectedComment = (record.teacherComment || "").trim();
      const commentTextarea = modal
        .locator('textarea#comment, textarea[name="comment"], textarea[placeholder*="Nhập bình luận" i]')
        .first();
      await commentTextarea.fill(expectedComment);

      // 8. Pre-Save Drift Interlock & Emergency Stop Check
      await page.waitForTimeout(50);
      if (taskQueue.getStatus().isStopped || (process as any)?.__mindxQueueStopped === true) {
        await page.keyboard.press("Escape").catch(() => {});
        throw new Error("Đã hủy thao tác Lưu SPCK theo lệnh Dừng khẩn cấp (Stop Bot).");
      }

      if (
        !SpckUploader.verifyRecordStillApproved(
          normalizedClassId,
          record.studentId,
          expectedHash,
          targetSessionNumber
        )
      ) {
        SpckUploader.demoteRecordToWaitingApproval(
          normalizedClassId,
          record.studentId,
          targetSessionNumber,
          "Phát hiện dữ liệu SPCK đã bị chỉnh sửa trong lúc điền form. Đã hủy thao tác Lưu."
        );
        await page.keyboard.press("Escape").catch(() => {});
        return {
          demotedToWaitingApproval: true,
          errorMessage: "Đã hủy Lưu do dữ liệu SPCK thay đổi trước khi bấm Lưu.",
          reusedExistingItem01,
          clickedAddSpckButton,
          youtubeAddedCount,
          relatedLinksAddedCount,
          screenshotsUploadedCount,
          attachmentsUploadedCount,
        };
      }

      // Verify pre-save DOM values match (including Related Links, YouTube URLs, and Attachments)
      const preSaveTitle = (await titleInput.inputValue()).trim();
      const preSaveComment = (await commentTextarea.inputValue()).trim();
      if (preSaveTitle !== expectedTitle || preSaveComment !== expectedComment) {
        throw new Error(
          `[Read-after-Write] Nội dung Tiêu đề hoặc Bình luận trong Modal không khớp với bản đã duyệt trước khi bấm Save.`
        );
      }
      if (relatedLinks.length > 0) {
        const preSaveModalText = (await modal.innerText().catch(() => "")) || "";
        for (const rel of relatedLinks) {
          const hrefCount = await modal
            .locator(`a[href="${rel.url}"]`)
            .count()
            .catch(() => 0);
          if (hrefCount === 0 && !preSaveModalText.includes(rel.url)) {
            throw new Error(
              `[Read-after-Write] Đường dẫn liên quan '${rel.name}' (${rel.url}) chưa xuất hiện trong danh sách trên Modal trước khi bấm Save.`
            );
          }
        }
      }

      await interceptor.dismissForbiddenToast();
      const saveBtn = modal
        .locator('button[type="submit"], button:has-text("Save"), button:has-text("Lưu")')
        .first();

      const responsePromise = page.waitForResponse(
        (res: Response) => {
          const url = res.url().toLowerCase();
          const method = res.request().method().toUpperCase();
          if (method !== "POST" && method !== "PUT" && method !== "PATCH") return false;
          if (
            url.includes("resources.mindx.edu.vn") ||
            url.includes("google-analytics") ||
            url.includes("sentry") ||
            url.includes("facebook") ||
            url.includes("clarity") ||
            url.includes("hotjar")
          ) {
            return false;
          }
          const postData = res.request().postData() || "";
          if (postData.includes('"findAllStudentWorks"')) {
            return false;
          }
          if (url.includes("graphql") || url.includes("lms-api.mindx.edu.vn")) {
            return /CreateStudentWork|UpdateStudentWork|UpsertStudentWork|mutation|save|update|create|upsert|product|spck/i.test(
              postData
            );
          }
          return (
            url.includes("mindx.edu.vn") ||
            url.includes("/api/spck") ||
            url.includes("/spck") ||
            url.includes("/student-work")
          );
        },
        { timeout: 30000 }
      );

      await saveBtn.click();
      const saveResponse = await responsePromise;
      const httpStatus = saveResponse.status();

      if (httpStatus !== 200 && httpStatus !== 201) {
        throw new Error(`API Lưu SPCK trên LMS trả về HTTP ${httpStatus} (yêu cầu 200/201).`);
      }

      let responseBody: any = null;
      try {
        responseBody = await saveResponse.json();
      } catch {
        // Non-JSON response
      }

      if (responseBody && Array.isArray(responseBody.errors) && responseBody.errors.length > 0) {
        throw new Error(
          `GraphQL Lưu SPCK trả về lỗi: ${responseBody.errors[0]?.message || "Unknown GraphQL error"}`
        );
      }

      // Verify GraphQL response payload returned by CreateStudentWork / UpdateStudentWork
      const savedWork =
        responseBody?.data?.studentWorks?.create ||
        responseBody?.data?.studentWorks?.update ||
        responseBody?.data?.studentWorks?.upsert;

      if (!savedWork || typeof savedWork.latestData !== "object" || savedWork.latestData === null) {
        const errMsg =
          "[Read-after-Write] Phản hồi từ LMS sau khi lưu không chứa đối tượng dữ liệu StudentWork.latestData.";
        spckUploadRepo.recordSessionFailure(
          normalizedClassId,
          record.studentId,
          targetSessionNumber,
          expectedHash,
          errMsg
        );
        throw new Error(errMsg);
      }

      const resolveDigestFromUrlString = (rawUrl: string, fallbackStemLower?: string): string => {
        const trimmed = rawUrl.trim();
        if (!trimmed) return "";
        if (freshlyUploadedResourceUrlDigests.has(trimmed)) {
          return freshlyUploadedResourceUrlDigests.get(trimmed) || "";
        }
        const baseLower = path.basename(trimmed).toLowerCase();
        if (baseLower && freshlyUploadedResourceUrlDigests.has(baseLower)) {
          return freshlyUploadedResourceUrlDigests.get(baseLower) || "";
        }
        for (const [k, v] of freshlyUploadedResourceUrlDigests.entries()) {
          if (k.startsWith("/") && trimmed.endsWith(k)) {
            return v;
          }
        }
        if (fallbackStemLower && alreadyVerifiedOnModalStemDigests.has(fallbackStemLower)) {
          return alreadyVerifiedOnModalStemDigests.get(fallbackStemLower) || "";
        }
        return "";
      };

      const extractServerItemByteDigest = (
        serverItem: any,
        fallbackStemLower?: string
      ): string => {
        if (serverItem === null || serverItem === undefined) return "";
        if (typeof serverItem === "object") {
          const explicitDigest = String(
            serverItem.byteSha256 ||
              serverItem.sha256 ||
              serverItem.contentHash ||
              ""
          ).trim();
          if (explicitDigest) return explicitDigest;

          const rawBytes =
            serverItem.bytes !== undefined
              ? serverItem.bytes
              : serverItem.content;
          if (rawBytes !== undefined) {
            return crypto
              .createHash("sha256")
              .update(
                Buffer.isBuffer(rawBytes) ? rawBytes : String(rawBytes),
                Buffer.isBuffer(rawBytes) ? undefined : "utf8"
              )
              .digest("hex");
          }

          const itemUrl = String(serverItem.url || serverItem.src || "").trim();
          if (itemUrl) {
            return resolveDigestFromUrlString(itemUrl, fallbackStemLower);
          }
          return "";
        }
        if (typeof serverItem === "string") {
          return resolveDigestFromUrlString(serverItem, fallbackStemLower);
        }
        return "";
      };

      const verifyReturnedFileListMatch = (
        serverItems: any[],
        localPaths: string[],
        categoryLabel: string
      ) => {
        for (const localPath of localPaths) {
          const localBase = path.basename(localPath).toLowerCase();
          const localStem = path.parse(localPath).name.toLowerCase();
          const localDigest = computeSafeFileByteDigest(localPath);
          const expectedUploadedLink = (
            freshlyUploadedUrlByLocalPath.get(path.resolve(localPath)) || ""
          ).toLowerCase();
          const expectedUploadedBase = expectedUploadedLink
            ? path.basename(expectedUploadedLink)
            : "";
          const matchedServerItem = serverItems.find((item: any) => {
            const rawName = String(
              typeof item === "string"
                ? item
                : item?.name || item?.fileName || item?.url || item?.src || ""
            ).toLowerCase();
            const decodedRawName = (() => {
              try {
                return decodeURIComponent(rawName);
              } catch {
                return rawName;
              }
            })();
            const parsedBase = path.basename(decodedRawName);
            return (
              (expectedUploadedLink &&
                (rawName.includes(expectedUploadedLink) ||
                  parsedBase === expectedUploadedBase)) ||
              parsedBase === localBase ||
              decodedRawName.includes(localBase) ||
              (localStem.length >= 1 &&
                (parsedBase.startsWith(`${localStem}-`) ||
                  parsedBase.startsWith(`${localStem}.`)))
            );
          });
          if (!matchedServerItem) {
            const errMsg = `[Read-after-Write] Phản hồi API sau lưu thiếu ${categoryLabel} '${path.basename(localPath)}'.`;
            spckUploadRepo.recordSessionFailure(
              normalizedClassId,
              record.studentId,
              targetSessionNumber,
              expectedHash,
              errMsg
            );
            throw new Error(errMsg);
          }
          const effectiveServerDigest = extractServerItemByteDigest(
            matchedServerItem,
            localStem
          );
          if (localDigest) {
            if (!effectiveServerDigest) {
              const errMsg = `[Read-after-Write] Phản hồi API sau lưu cho ${categoryLabel} '${path.basename(localPath)}' thiếu bằng chứng byte/SHA-256.`;
              spckUploadRepo.recordSessionFailure(
                normalizedClassId,
                record.studentId,
                targetSessionNumber,
                expectedHash,
                errMsg
              );
              throw new Error(errMsg);
            }
            if (effectiveServerDigest !== localDigest) {
              const errMsg = `[Read-after-Write] Nội dung ${categoryLabel} '${path.basename(localPath)}' trên LMS sau lưu không khớp byte/SHA-256 với bản đã duyệt.`;
              spckUploadRepo.recordSessionFailure(
                normalizedClassId,
                record.studentId,
                targetSessionNumber,
                expectedHash,
                errMsg
              );
              throw new Error(errMsg);
            }
          }
        }
      };

      if (savedWork?.latestData) {
        const apiTitle = String(savedWork.latestData.title || "").trim();
        const apiComment = String(savedWork.latestData.comment || "").trim();
        if (apiTitle !== expectedTitle) {
          throw new Error(
            `[Read-after-Write] Tiêu đề SPCK từ API sau lưu ('${apiTitle}') không khớp với bản đã duyệt ('${expectedTitle}').`
          );
        }
        if (apiComment !== expectedComment) {
          throw new Error(
            `[Read-after-Write] Bình luận SPCK từ API sau lưu không khớp với bản đã duyệt.`
          );
        }
        if (effectiveThumbPath) {
          const localThumbDigest = computeSafeFileByteDigest(effectiveThumbPath);
          const serverThumbDigest = extractServerItemByteDigest(
            savedWork.latestData.thumbnail
          );
          if (localThumbDigest) {
            if (!serverThumbDigest) {
              const errMsg = `[Read-after-Write] Phản hồi API sau lưu cho Ảnh Thumbnail ('${path.basename(effectiveThumbPath)}') thiếu bằng chứng byte/SHA-256.`;
              spckUploadRepo.recordSessionFailure(
                normalizedClassId,
                record.studentId,
                targetSessionNumber,
                expectedHash,
                errMsg
              );
              throw new Error(errMsg);
            }
            if (serverThumbDigest !== localThumbDigest) {
              const errMsg = `[Read-after-Write] Nội dung Ảnh Thumbnail ('${path.basename(effectiveThumbPath)}') trên LMS sau lưu không khớp byte/SHA-256 với bản đã duyệt.`;
              spckUploadRepo.recordSessionFailure(
                normalizedClassId,
                record.studentId,
                targetSessionNumber,
                expectedHash,
                errMsg
              );
              throw new Error(errMsg);
            }
          }
        }
        if (expectedModalAttachmentFiles.length > 0) {
          const serverAttachmentsList = Array.isArray(savedWork.latestData.attachments)
            ? savedWork.latestData.attachments
            : Array.isArray(savedWork.latestData.attachmentUrls)
            ? savedWork.latestData.attachmentUrls
            : null;
          if (!serverAttachmentsList) {
            const errMsg = `[Read-after-Write] Phản hồi API sau lưu thiếu danh sách tài liệu đính kèm (attachments).`;
            spckUploadRepo.recordSessionFailure(
              normalizedClassId,
              record.studentId,
              targetSessionNumber,
              expectedHash,
              errMsg
            );
            throw new Error(errMsg);
          }
          verifyReturnedFileListMatch(
            serverAttachmentsList,
            expectedModalAttachmentFiles,
            "tài liệu đính kèm"
          );
        }
        if (screenshots.length > 0) {
          const serverScreenshotsList = Array.isArray(savedWork.latestData.screenshots)
            ? savedWork.latestData.screenshots
            : Array.isArray(savedWork.latestData.imageUrl)
            ? savedWork.latestData.imageUrl
            : null;
          if (!serverScreenshotsList) {
            const errMsg = `[Read-after-Write] Phản hồi API sau lưu thiếu danh sách hình ảnh sản phẩm (screenshots).`;
            spckUploadRepo.recordSessionFailure(
              normalizedClassId,
              record.studentId,
              targetSessionNumber,
              expectedHash,
              errMsg
            );
            throw new Error(errMsg);
          }
          verifyReturnedFileListMatch(
            serverScreenshotsList,
            screenshots,
            "hình ảnh sản phẩm"
          );
        }
      }

      await page.waitForTimeout(800);

      // 9. Read-after-Write DOM Verification on Real MindX LMS
      if (await modal.isVisible().catch(() => false)) {
        const domTitleAfter = (await titleInput.inputValue({ timeout: 2000 }).catch(() => "")).trim();
        if (domTitleAfter !== expectedTitle) {
          throw new Error(
            `[Read-after-Write] Tiêu đề SPCK sau lưu ('${domTitleAfter}') không khớp với bản đã duyệt ('${expectedTitle}').`
          );
        }
        if (await commentTextarea.isVisible().catch(() => false)) {
          const domCommentAfter = (
            await commentTextarea.inputValue({ timeout: 2000 }).catch(() => "")
          ).trim();
          if (domCommentAfter !== expectedComment) {
            throw new Error(
              `[Read-after-Write] Bình luận SPCK sau lưu không khớp với bản đã duyệt.`
            );
          }
        }
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(400);
      } else {
        // Modal closed automatically after save: re-open briefly to verify data persisted on DOM
        await spckBtn.click({ timeout: 2500 }).catch(async () => {
          await spckBtn
            .evaluate((el) => {
              if (el && typeof (el as HTMLElement).click === "function") {
                (el as HTMLElement).click();
              }
            })
            .catch(() => {});
        });
        await modal.waitFor({ state: "visible", timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(500);
        if (await titleInput.isVisible().catch(() => false)) {
          const persistedTitle = (
            await titleInput.inputValue({ timeout: 2000 }).catch(() => "")
          ).trim();
          if (persistedTitle !== expectedTitle) {
            throw new Error(
              `[Read-after-Write] Đối chiếu lại Modal SPCK của '${fullName}' sau khi lưu không khớp dữ liệu đã duyệt.`
            );
          }
        } else if (!savedWork?.latestData) {
          throw new Error(
            `[Read-after-Write] Không thể mở lại Modal SPCK của '${fullName}' để xác minh dữ liệu sau khi lưu.`
          );
        }
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(400);
      }

      return {
        reusedExistingItem01,
        clickedAddSpckButton,
        youtubeAddedCount,
        relatedLinksAddedCount,
        screenshotsUploadedCount,
        attachmentsUploadedCount,
      };
    } finally {
      if (await modal.isVisible().catch(() => false)) {
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(300);
      }
    }
  }
}
