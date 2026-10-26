import { NextResponse } from "next/server";
import { validateLocalRequest } from "@/lib/security/local-guard";
import { sessionFeedbackRepo, studentRepo } from "@/lib/db/sqlite";

interface FieldVersionEntry {
  ver: number;
  cid: string;
  rev: number;
}

interface FeedbackVersionMeta {
  rowVer: number;
  fields: Record<string, FieldVersionEntry>;
}

const fallbackMetaByRow = new Map<string, FeedbackVersionMeta>();

function parseMeta(raw?: string | null): FeedbackVersionMeta | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    const rowVer =
      typeof parsed?.rowVer === "number" && Number.isFinite(parsed.rowVer) ? parsed.rowVer : 0;
    const fields: Record<string, FieldVersionEntry> = {};
    if (parsed?.fields && typeof parsed.fields === "object" && !Array.isArray(parsed.fields)) {
      for (const [k, v] of Object.entries(parsed.fields)) {
        const entry = v as any;
        if (entry && typeof entry === "object") {
          fields[k] = {
            ver: typeof entry.ver === "number" && Number.isFinite(entry.ver) ? entry.ver : 0,
            cid: typeof entry.cid === "string" ? entry.cid : "",
            rev: typeof entry.rev === "number" && Number.isFinite(entry.rev) ? entry.rev : 0,
          };
        }
      }
    }
    return { rowVer, fields };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const {
      classId: rawClassId,
      sessionId: rawSessionId,
      studentId: rawStudentId,
      attendanceStatus,
      quickTags,
      teacherNote,
      strengths,
      improvements,
      actionPlan,
      finalText,
      status,
    } = body;
    const classId = typeof rawClassId === "string" ? rawClassId.trim().toUpperCase() : "";
    const sessionId = typeof rawSessionId === "string" ? rawSessionId.trim() : "";
    const studentId = typeof rawStudentId === "string" ? rawStudentId.trim() : "";

    if (!classId || !sessionId || !studentId) {
      return NextResponse.json(
        { success: false, error: "Thiếu classId, sessionId hoặc studentId." },
        { status: 400 }
      );
    }

    const escapedClassId = classId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sessionPrefixRegex = new RegExp(`^${escapedClassId}(?:_SESS_|[^a-zA-Z0-9_-])`, "i");
    if (!sessionPrefixRegex.test(sessionId)) {
      return NextResponse.json(
        {
          success: false,
          error: `Mã buổi học '${sessionId}' không thuộc đúng lớp '${classId}'.`,
        },
        { status: 400 }
      );
    }

    const dbStudent = studentRepo.findOne(studentId, classId);
    if (!dbStudent || dbStudent.classId !== classId || dbStudent.isActive !== 1) {
      return NextResponse.json(
        {
          success: false,
          error: `Học viên '${studentId}' không tồn tại trong lớp '${classId}' hoặc đã nghỉ học.`,
        },
        { status: 400 }
      );
    }

    const validAttendanceStatuses = new Set(["PRESENT", "LATE", "ABSENT", "EXCUSED", "UNKNOWN"]);
    if (attendanceStatus !== undefined && attendanceStatus !== null && attendanceStatus !== "") {
      if (typeof attendanceStatus !== "string" || !validAttendanceStatuses.has(attendanceStatus)) {
        return NextResponse.json(
          { success: false, error: `Trạng thái điểm danh '${attendanceStatus}' không hợp lệ.` },
          { status: 400 }
        );
      }
    }

    const allowedDraftStatuses = new Set([
      "DRAFT",
      "INSUFFICIENT_INFO",
      "FAILED",
      "WAITING_APPROVAL",
    ]);
    const effectiveStatus = status ? String(status).trim().toUpperCase() : "DRAFT";
    if (!allowedDraftStatuses.has(effectiveStatus)) {
      return NextResponse.json(
        { success: false, error: `Trạng thái nháp '${status}' không hợp lệ.` },
        { status: 400 }
      );
    }

    const existing =
      typeof sessionFeedbackRepo?.findOne === "function"
        ? sessionFeedbackRepo.findOne(classId, sessionId, studentId)
        : undefined;

    const rawUrl = typeof req?.url === "string" ? req.url : "";
    const cidMatch = rawUrl.match(/[?&]cid=([a-zA-Z0-9_-]+)/);
    const revMatch = rawUrl.match(/[?&]rev=(\d+)/);
    const baseMatch = rawUrl.match(/[?&]base=(\d+)/);
    const fbaseMatch = rawUrl.match(/[?&]fbase=([^&]+)/);
    const fieldsMatch = rawUrl.match(/[?&]f=([^&]+)/);

    const headerCid =
      typeof req?.headers?.get === "function" ? req.headers.get("x-client-instance") || "" : "";
    const headerRev =
      typeof req?.headers?.get === "function" ? req.headers.get("x-edit-revision") || "" : "";
    const headerBase =
      typeof req?.headers?.get === "function" ? req.headers.get("x-base-revision") || "" : "";
    const headerFbase =
      typeof req?.headers?.get === "function"
        ? req.headers.get("x-field-base-revisions") || ""
        : "";
    const headerFields =
      typeof req?.headers?.get === "function" ? req.headers.get("x-edited-fields") || "" : "";

    const clientInstanceId = cidMatch ? cidMatch[1] : headerCid;
    const parsedRev = Number(
      revMatch ? revMatch[1] : headerRev || String(body?.clientRevision || "0")
    );
    const clientRev = Number.isFinite(parsedRev) && parsedRev > 0 ? parsedRev : 0;

    const rawBaseStr = baseMatch ? baseMatch[1] : headerBase;
    const parsedBase = rawBaseStr !== "" ? Number(rawBaseStr) : NaN;
    const baseRowVer = Number.isFinite(parsedBase) && parsedBase >= 0 ? parsedBase : null;

    const rawFbaseStr = fbaseMatch
      ? decodeURIComponent(fbaseMatch[1])
      : headerFbase;
    const fieldBaseMap: Record<string, number> = {};
    if (rawFbaseStr) {
      for (const pair of rawFbaseStr.split(",")) {
        const [k, v] = pair.split(":");
        const num = Number(v);
        if (k && Number.isFinite(num) && num >= 0) {
          fieldBaseMap[k.trim()] = num;
        }
      }
    }

    const rawFieldsStr = fieldsMatch
      ? decodeURIComponent(fieldsMatch[1])
      : headerFields;
    const explicitFields = rawFieldsStr
      ? rawFieldsStr
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const rowScopeKey = `${classId}::${sessionId}::${studentId}`;
    const dbMeta = parseMeta((existing as any)?.versionMetaJson);
    const meta: FeedbackVersionMeta = dbMeta ||
      fallbackMetaByRow.get(rowScopeKey) || { rowVer: 0, fields: {} };

    let anyFieldProvided = false;
    let anyFieldFresh = false;
    const isFieldFresh = (field: string, value: unknown): boolean => {
      if (value === undefined) return false;
      if (
        field === "finalText" &&
        explicitFields.length > 0 &&
        !explicitFields.includes("finalText") &&
        existing?.finalText
      ) {
        return false;
      }
      anyFieldProvided = true;

      const cur: FieldVersionEntry = meta.fields[field] || { ver: 0, cid: "", rev: 0 };
      const fieldBaseVer: number | null =
        fieldBaseMap[field] !== undefined ? fieldBaseMap[field] : null;

      // Case 1: Same client instance
      if (clientInstanceId && cur.cid === clientInstanceId) {
        if (clientRev > 0 && clientRev < cur.rev) {
          return false;
        }
        meta.fields[field] = {
          ver: cur.ver + 1,
          cid: clientInstanceId,
          rev: clientRev > 0 ? clientRev : cur.rev,
        };
        anyFieldFresh = true;
        return true;
      }

      // Case 2: Different client instance with explicit field base version from SQLite
      if (fieldBaseVer !== null) {
        if (fieldBaseVer < cur.ver) {
          return false;
        }
        meta.fields[field] = {
          ver: cur.ver + 1,
          cid: clientInstanceId || cur.cid || "default",
          rev: clientRev,
        };
        anyFieldFresh = true;
        return true;
      }

      // Case 3: Different client instance with row base version
      if (baseRowVer !== null && cur.ver > 0 && baseRowVer === 0) {
        return false;
      }

      // Case 4: Direct API call with clientRev > 0 and no base version
      if (clientRev > 0) {
        const sameOrUnsetCid = !cur.cid || !clientInstanceId || cur.cid === clientInstanceId;
        if (sameOrUnsetCid && clientRev < cur.rev) {
          return false;
        }
        if (!sameOrUnsetCid && cur.ver > 0) {
          return false;
        }
        meta.fields[field] = {
          ver: cur.ver + 1,
          cid: clientInstanceId || cur.cid || "default",
          rev: clientRev,
        };
        anyFieldFresh = true;
        return true;
      }

      // Case 5: Legacy direct call without revision metadata
      meta.fields[field] = {
        ver: cur.ver + 1,
        cid: clientInstanceId || cur.cid || "",
        rev: 0,
      };
      anyFieldFresh = true;
      return true;
    };

    const freshAttendance = isFieldFresh("attendanceStatus", attendanceStatus);
    const freshQuickTags = isFieldFresh("quickTags", quickTags);
    const freshTeacherNote = isFieldFresh("teacherNote", teacherNote);
    const freshStrengths = isFieldFresh("strengths", strengths);
    const freshImprovements = isFieldFresh("improvements", improvements);
    const freshActionPlan = isFieldFresh("actionPlan", actionPlan);
    const freshFinalText = isFieldFresh("finalText", finalText);

    if (
      (clientRev > 0 || baseRowVer !== null || Object.keys(fieldBaseMap).length > 0) &&
      anyFieldProvided &&
      !anyFieldFresh
    ) {
      return NextResponse.json({
        success: true,
        staleIgnored: true,
        message: "Bỏ qua yêu cầu lưu nháp cũ đến muộn.",
        versionMeta: meta,
      });
    }

    meta.rowVer = (meta.rowVer || 0) + 1;
    fallbackMetaByRow.set(rowScopeKey, meta);

    sessionFeedbackRepo.upsert({
      classId,
      sessionId,
      studentId,
      attendanceStatus: freshAttendance
        ? attendanceStatus || existing?.attendanceStatus || "UNKNOWN"
        : existing?.attendanceStatus || "UNKNOWN",
      quickTagsJson: freshQuickTags
        ? Array.isArray(quickTags)
          ? JSON.stringify(quickTags)
          : quickTags ?? existing?.quickTagsJson ?? "[]"
        : existing?.quickTagsJson ?? "[]",
      teacherNote: freshTeacherNote
        ? teacherNote ?? existing?.teacherNote ?? ""
        : existing?.teacherNote ?? "",
      strengths: freshStrengths
        ? strengths ?? existing?.strengths ?? ""
        : existing?.strengths ?? "",
      improvements: freshImprovements
        ? improvements ?? existing?.improvements ?? ""
        : existing?.improvements ?? "",
      actionPlan: freshActionPlan
        ? actionPlan ?? existing?.actionPlan ?? ""
        : existing?.actionPlan ?? "",
      finalText: freshFinalText
        ? finalText ?? existing?.finalText ?? ""
        : existing?.finalText ?? "",
      status: effectiveStatus as any,
      versionMetaJson: JSON.stringify(meta),
    });

    return NextResponse.json({
      success: true,
      message: "Đã lưu nháp tức thì vào SQLite.",
      versionMeta: meta,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
