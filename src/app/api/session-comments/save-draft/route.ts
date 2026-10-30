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

function parseFbaseMap(rawFbaseStr?: string): Record<string, number> {
  const fieldBaseMap: Record<string, number> = {};
  if (!rawFbaseStr) return fieldBaseMap;
  for (const pair of rawFbaseStr.split(",")) {
    const [k, v] = pair.split(":");
    const num = Number(v);
    if (k && Number.isFinite(num) && num >= 0) {
      fieldBaseMap[k.trim()] = num;
    }
  }
  return fieldBaseMap;
}

function saveSingleDraftItem(params: {
  defaultClassId: string;
  defaultSessionId: string;
  item: any;
  defaultClientInstanceId: string;
  defaultClientRev: number;
  defaultBaseRowVer: number | null;
  defaultFieldBaseMap: Record<string, number>;
  defaultExplicitFields: string[];
}): {
  statusHttp: number;
  studentId: string;
  body: Record<string, any>;
} {
  const {
    defaultClassId,
    defaultSessionId,
    item,
    defaultClientInstanceId,
    defaultClientRev,
    defaultBaseRowVer,
    defaultFieldBaseMap,
    defaultExplicitFields,
  } = params;

  const rawClassId = item?.classId ?? defaultClassId;
  const rawSessionId = item?.sessionId ?? defaultSessionId;
  const rawStudentId = item?.studentId;
  const {
    attendanceStatus,
    quickTags,
    teacherNote,
    strengths,
    improvements,
    actionPlan,
    finalText,
    status,
  } = item || {};

  const classId = typeof rawClassId === "string" ? rawClassId.trim().toUpperCase() : "";
  const sessionId = typeof rawSessionId === "string" ? rawSessionId.trim() : "";
  const studentId = typeof rawStudentId === "string" ? rawStudentId.trim() : "";

  if (!classId || !sessionId || !studentId) {
    return {
      statusHttp: 400,
      studentId,
      body: {
        success: false,
        studentId,
        error: "Thiếu classId, sessionId hoặc studentId.",
      },
    };
  }

  const escapedClassId = classId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sessionPrefixRegex = new RegExp(`^${escapedClassId}(?:_SESS_|[^a-zA-Z0-9_-])`, "i");
  if (!sessionPrefixRegex.test(sessionId)) {
    return {
      statusHttp: 400,
      studentId,
      body: {
        success: false,
        studentId,
        error: `Mã buổi học '${sessionId}' không thuộc đúng lớp '${classId}'.`,
      },
    };
  }

  const dbStudent = studentRepo.findOne(studentId, classId);
  if (!dbStudent || dbStudent.classId !== classId || dbStudent.isActive !== 1) {
    return {
      statusHttp: 400,
      studentId,
      body: {
        success: false,
        studentId,
        error: `Học viên '${studentId}' không tồn tại trong lớp '${classId}' hoặc đã nghỉ học.`,
      },
    };
  }

  const validAttendanceStatuses = new Set(["PRESENT", "LATE", "ABSENT", "EXCUSED", "UNKNOWN"]);
  if (attendanceStatus !== undefined && attendanceStatus !== null && attendanceStatus !== "") {
    if (typeof attendanceStatus !== "string" || !validAttendanceStatuses.has(attendanceStatus)) {
      return {
        statusHttp: 400,
        studentId,
        body: {
          success: false,
          studentId,
          error: `Trạng thái điểm danh '${attendanceStatus}' không hợp lệ.`,
        },
      };
    }
  }

  const allowedDraftStatuses = new Set([
    "DRAFT",
    "INSUFFICIENT_INFO",
    "FAILED",
    "WAITING_APPROVAL",
  ]);
  if (status !== undefined && status !== null && typeof status !== "string") {
    return {
      statusHttp: 400,
      studentId,
      body: {
        success: false,
        studentId,
        error: "Trạng thái nháp phải là chuỗi ký tự hợp lệ.",
      },
    };
  }
  const effectiveStatus = status ? String(status).trim().toUpperCase() : "DRAFT";
  if (!allowedDraftStatuses.has(effectiveStatus)) {
    return {
      statusHttp: 400,
      studentId,
      body: {
        success: false,
        studentId,
        error: `Trạng thái nháp '${status}' không hợp lệ.`,
      },
    };
  }

  for (const [fieldName, fieldVal] of [
    ["teacherNote", teacherNote],
    ["strengths", strengths],
    ["improvements", improvements],
    ["actionPlan", actionPlan],
    ["finalText", finalText],
  ] as const) {
    if (fieldVal !== undefined && fieldVal !== null && typeof fieldVal !== "string") {
      return {
        statusHttp: 400,
        studentId,
        body: {
          success: false,
          studentId,
          error: `Trường '${fieldName}' của học viên '${studentId}' phải là chuỗi ký tự hợp lệ.`,
        },
      };
    }
  }

  if (quickTags !== undefined && quickTags !== null) {
    if (!Array.isArray(quickTags) || !quickTags.every((t) => typeof t === "string")) {
      return {
        statusHttp: 400,
        studentId,
        body: {
          success: false,
          studentId,
          error: `Trường 'quickTags' của học viên '${studentId}' phải là mảng chuỗi ký tự hợp lệ.`,
        },
      };
    }
  }

  const existing =
    typeof sessionFeedbackRepo?.findOne === "function"
      ? sessionFeedbackRepo.findOne(classId, sessionId, studentId)
      : undefined;

  const clientInstanceId =
    typeof item?.clientInstanceId === "string" && item.clientInstanceId.trim()
      ? item.clientInstanceId.trim()
      : defaultClientInstanceId;
  const itemParsedRev = Number(item?.clientRevision ?? item?.rev ?? NaN);
  const clientRev =
    Number.isFinite(itemParsedRev) && itemParsedRev > 0 ? itemParsedRev : defaultClientRev;

  const itemParsedBase =
    item?.baseRowVer !== undefined && item?.baseRowVer !== null && item?.baseRowVer !== ""
      ? Number(item.baseRowVer)
      : item?.expectedRowVer !== undefined &&
        item?.expectedRowVer !== null &&
        item?.expectedRowVer !== ""
      ? Number(item.expectedRowVer)
      : NaN;
  const baseRowVer =
    Number.isFinite(itemParsedBase) && itemParsedBase >= 0 ? itemParsedBase : defaultBaseRowVer;

  const fieldBaseMap: Record<string, number> =
    item?.fieldBaseMap && typeof item.fieldBaseMap === "object"
      ? { ...defaultFieldBaseMap, ...item.fieldBaseMap }
      : typeof item?.fbase === "string" && item.fbase
      ? { ...defaultFieldBaseMap, ...parseFbaseMap(item.fbase) }
      : defaultFieldBaseMap;

  const explicitFields: string[] = Array.isArray(item?.explicitFields)
    ? item.explicitFields.map((s: any) => String(s || "").trim()).filter(Boolean)
    : typeof item?.f === "string" && item.f
    ? item.f
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean)
    : defaultExplicitFields;

  const rowScopeKey = `${classId}::${sessionId}::${studentId}`;
  const dbMeta = parseMeta((existing as any)?.versionMetaJson);
  const meta: FeedbackVersionMeta = dbMeta ||
    fallbackMetaByRow.get(rowScopeKey) || { rowVer: 0, fields: {} };

  let anyFieldProvided = false;
  let anyFieldFresh = false;
  const acceptedFields: string[] = [];
  const staleFields: string[] = [];
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
        staleFields.push(field);
        return false;
      }
      meta.fields[field] = {
        ver: cur.ver + 1,
        cid: clientInstanceId,
        rev: clientRev > 0 ? clientRev : cur.rev,
      };
      anyFieldFresh = true;
      acceptedFields.push(field);
      return true;
    }

    // Case 2: Different client instance with explicit field base version from SQLite
    if (fieldBaseVer !== null) {
      if (fieldBaseVer < cur.ver) {
        staleFields.push(field);
        return false;
      }
      meta.fields[field] = {
        ver: cur.ver + 1,
        cid: clientInstanceId || cur.cid || "default",
        rev: clientRev,
      };
      anyFieldFresh = true;
      acceptedFields.push(field);
      return true;
    }

    // Case 3: Different client instance with row base version
    if (baseRowVer !== null && cur.ver > 0 && baseRowVer === 0) {
      staleFields.push(field);
      return false;
    }

    // Case 4: Direct API call with clientRev > 0 and no base version
    if (clientRev > 0) {
      const sameOrUnsetCid = !cur.cid || !clientInstanceId || cur.cid === clientInstanceId;
      if (sameOrUnsetCid && clientRev < cur.rev) {
        staleFields.push(field);
        return false;
      }
      if (!sameOrUnsetCid && cur.ver > 0) {
        staleFields.push(field);
        return false;
      }
      meta.fields[field] = {
        ver: cur.ver + 1,
        cid: clientInstanceId || cur.cid || "default",
        rev: clientRev,
      };
      anyFieldFresh = true;
      acceptedFields.push(field);
      return true;
    }

    // Case 5: Legacy direct call without revision metadata
    meta.fields[field] = {
      ver: cur.ver + 1,
      cid: clientInstanceId || cur.cid || "",
      rev: 0,
    };
    anyFieldFresh = true;
    acceptedFields.push(field);
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
    return {
      statusHttp: 200,
      studentId,
      body: {
        success: true,
        studentId,
        staleIgnored: true,
        acceptedFields,
        staleFields,
        partialStale: false,
        message: "Bỏ qua yêu cầu lưu nháp cũ đến muộn.",
        versionMeta: meta,
      },
    };
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

  return {
    statusHttp: 200,
    studentId,
    body: {
      success: true,
      studentId,
      acceptedFields,
      staleFields,
      ...(staleFields.length > 0 ? { partialStale: true } : {}),
      message: "Đã lưu nháp tức thì vào SQLite.",
      versionMeta: meta,
    },
  };
}

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const body = await req.json();

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

    const defaultClientInstanceId = cidMatch ? cidMatch[1] : headerCid;
    const parsedRev = Number(
      revMatch ? revMatch[1] : headerRev || String(body?.clientRevision || "0")
    );
    const defaultClientRev = Number.isFinite(parsedRev) && parsedRev > 0 ? parsedRev : 0;

    const rawBaseStr = baseMatch ? baseMatch[1] : headerBase;
    const parsedBase = rawBaseStr !== "" ? Number(rawBaseStr) : NaN;
    const defaultBaseRowVer =
      Number.isFinite(parsedBase) && parsedBase >= 0 ? parsedBase : null;

    const rawFbaseStr = fbaseMatch ? decodeURIComponent(fbaseMatch[1]) : headerFbase;
    const defaultFieldBaseMap = parseFbaseMap(rawFbaseStr);

    const rawFieldsStr = fieldsMatch ? decodeURIComponent(fieldsMatch[1]) : headerFields;
    const defaultExplicitFields = rawFieldsStr
      ? rawFieldsStr
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const batchItems: any[] | null = Array.isArray(body?.items)
      ? body.items
      : Array.isArray(body)
      ? body
      : null;

    if (batchItems !== null) {
      if (batchItems.length === 0) {
        return NextResponse.json(
          { success: false, error: "Danh sách học viên cần lưu nháp trống." },
          { status: 400 }
        );
      }

      const defaultClassId = typeof body?.classId === "string" ? body.classId : "";
      const defaultSessionId = typeof body?.sessionId === "string" ? body.sessionId : "";

      const results: Array<Record<string, any>> = [];
      const versionMetaByStudent: Record<string, FeedbackVersionMeta> = {};
      let savedCount = 0;
      let failedCount = 0;
      let staleCount = 0;
      let firstError = "";

      for (const rawItem of batchItems) {
        let itemRes: {
          statusHttp: number;
          studentId: string;
          body: Record<string, any>;
        };
        try {
          itemRes = saveSingleDraftItem({
            defaultClassId,
            defaultSessionId,
            item: rawItem,
            defaultClientInstanceId,
            defaultClientRev,
            defaultBaseRowVer,
            defaultFieldBaseMap,
            defaultExplicitFields,
          });
        } catch (itemErr: any) {
          const fallbackStudentId =
            typeof rawItem?.studentId === "string" ? rawItem.studentId.trim() : "";
          itemRes = {
            statusHttp: 500,
            studentId: fallbackStudentId,
            body: {
              success: false,
              studentId: fallbackStudentId,
              error: itemErr instanceof Error ? itemErr.message : String(itemErr),
            },
          };
        }
        results.push(itemRes.body);
        if (itemRes.studentId && itemRes.body.versionMeta) {
          versionMetaByStudent[itemRes.studentId] = itemRes.body.versionMeta;
        }
        if (itemRes.body.success) {
          savedCount++;
          if (itemRes.body.staleIgnored) {
            staleCount++;
          }
        } else {
          failedCount++;
          if (!firstError && itemRes.body.error) {
            firstError = itemRes.body.error;
          }
        }
      }

      if (batchItems.length === 1) {
        const single = results[0];
        return NextResponse.json(
          {
            ...single,
            batch: true,
            savedCount,
            failedCount,
            staleCount,
            results,
            versionMetaByStudent,
          },
          { status: failedCount === 0 ? 200 : 400 }
        );
      }

      return NextResponse.json(
        {
          success: failedCount === 0,
          batch: true,
          savedCount,
          failedCount,
          staleCount,
          results,
          versionMetaByStudent,
          ...(failedCount > 0
            ? { error: firstError || "Một số học viên không thể lưu nháp." }
            : { message: `Đã lưu nháp hàng loạt cho ${savedCount}/${batchItems.length} học viên.` }),
        },
        { status: failedCount === 0 ? 200 : 400 }
      );
    }

    const singleRes = saveSingleDraftItem({
      defaultClassId: typeof body?.classId === "string" ? body.classId : "",
      defaultSessionId: typeof body?.sessionId === "string" ? body.sessionId : "",
      item: body,
      defaultClientInstanceId,
      defaultClientRev,
      defaultBaseRowVer,
      defaultFieldBaseMap,
      defaultExplicitFields,
    });

    return NextResponse.json(singleRes.body, { status: singleRes.statusHttp });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
