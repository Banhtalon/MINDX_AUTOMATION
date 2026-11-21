import { NextResponse } from "next/server";
import { demoDayRepo, type DemoDayStudentOverride } from "@/lib/db/sqlite";
import {
  parseDemoEntryOption,
  reconcileDemoOrder,
  shuffleDemoStudentOrder,
} from "@/lib/demo-day/demo-day-helpers";
import {
  DemoDayClassNotFoundError,
  inspectClassDemoDayState,
  resolveStudentDemoLaunchTargets,
} from "@/lib/demo-day/demo-day-inspector";
import { resolveSafeStudentFile } from "@/lib/demo-day/demo-day-launcher";
import { validateSpckRelatedUrl } from "@/lib/local-files/spck-scanner";
import {
  parseJsonPlainObjectBody,
  validateLocalRequest,
} from "@/lib/security/local-guard";

function parseExistingOverrides(rawJson?: string): Record<string, DemoDayStudentOverride> {
  if (!rawJson) return {};
  try {
    const parsed = JSON.parse(rawJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, DemoDayStudentOverride>;
    }
  } catch {}
  return {};
}

function parseExistingOrder(rawJson?: string, fallback: string[] = []): string[] {
  if (!rawJson) return fallback;
  try {
    const parsed = JSON.parse(rawJson);
    if (Array.isArray(parsed)) {
      return parsed.map((x) => String(x || "").trim()).filter(Boolean);
    }
  } catch {}
  return fallback;
}

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  const parsedBody = await parseJsonPlainObjectBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const body = parsedBody.body;
    const classId = String(body.classId || "").trim().toUpperCase();

    if (!/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(classId)) {
      return NextResponse.json(
        { success: false, error: "Thiếu hoặc sai định dạng mã lớp (classId)." },
        { status: 400 }
      );
    }

    let expectedRowVer: number | undefined;
    if (
      Object.prototype.hasOwnProperty.call(body, "expectedRowVer") &&
      body.expectedRowVer !== undefined
    ) {
      if (
        typeof body.expectedRowVer !== "number" ||
        !Number.isSafeInteger(body.expectedRowVer) ||
        body.expectedRowVer < 1
      ) {
        return NextResponse.json(
          { success: false, error: "expectedRowVer phải là số nguyên dương (>= 1)." },
          { status: 400 }
        );
      }
      expectedRowVer = body.expectedRowVer;
    }

    const targets = await resolveStudentDemoLaunchTargets(classId);
    const targetMap = new Map(targets.map((t) => [t.studentId, t]));
    const rosterIds = targets.map((t) => t.studentId);

    const existing = demoDayRepo.findByClass(classId);
    const overrides = parseExistingOverrides(existing?.overridesJson);

    let nextOrder: string[] | undefined = Array.isArray(body.order)
      ? body.order.map((x) => String(x || "").trim()).filter(Boolean)
      : undefined;
    let nextCurrentStudentId: string | undefined =
      typeof body.currentStudentId === "string"
        ? body.currentStudentId.trim()
        : undefined;
    let nextCompletedIds: string[] | undefined = Array.isArray(body.completedStudentIds)
      ? body.completedStudentIds.map((x) => String(x || "").trim()).filter(Boolean)
      : undefined;

    if (body.studentOverride !== undefined) {
      if (
        !body.studentOverride ||
        typeof body.studentOverride !== "object" ||
        Array.isArray(body.studentOverride)
      ) {
        return NextResponse.json(
          { success: false, error: "Dữ liệu studentOverride không hợp lệ." },
          { status: 400 }
        );
      }

      const ov = body.studentOverride as Record<string, unknown>;
      const studentId = String(ov.studentId || "").trim();
      const target = targetMap.get(studentId);
      if (!studentId || !target) {
        return NextResponse.json(
          { success: false, error: "Không tìm thấy học sinh trong lớp." },
          { status: 404 }
        );
      }

      const currentOv: DemoDayStudentOverride = { ...(overrides[studentId] || {}) };

      if (ov.slideUrl !== undefined) {
        const rawUrl = String(ov.slideUrl ?? "").trim();
        if (!rawUrl) {
          delete currentOv.slideUrl;
        } else {
          const check = validateSpckRelatedUrl(rawUrl);
          if (!check.valid || !check.normalizedUrl) {
            return NextResponse.json(
              { success: false, error: check.reason || "Link Canva / Slide không hợp lệ." },
              { status: 400 }
            );
          }
          currentOv.slideUrl = check.normalizedUrl;
          delete currentOv.slideRelPath;
        }
      }

      if (ov.slideRelPath !== undefined) {
        const rawRel = String(ov.slideRelPath ?? "").trim();
        if (!rawRel) {
          delete currentOv.slideRelPath;
        } else {
          try {
            resolveSafeStudentFile(target.studentRootDir, rawRel);
          } catch (err: unknown) {
            return NextResponse.json(
              {
                success: false,
                error: err instanceof Error ? err.message : "Tệp Slide không hợp lệ.",
              },
              { status: 403 }
            );
          }
          currentOv.slideRelPath = rawRel;
          delete currentOv.slideUrl;
        }
      }

      if (ov.productEntryValue !== undefined) {
        const rawOpt = String(ov.productEntryValue ?? "").trim();
        if (!rawOpt) {
          delete currentOv.productRelPath;
          delete currentOv.productLiveUrl;
        } else {
          const parsed = parseDemoEntryOption(rawOpt);
          if (!parsed) {
            return NextResponse.json(
              { success: false, error: "Lựa chọn file sản phẩm không hợp lệ." },
              { status: 400 }
            );
          }
          if (parsed.type === "file") {
            try {
              resolveSafeStudentFile(target.studentRootDir, parsed.target);
            } catch (err: unknown) {
              return NextResponse.json(
                {
                  success: false,
                  error:
                    err instanceof Error
                      ? err.message
                      : "Tệp sản phẩm nằm ngoài thư mục học sinh.",
                },
                { status: 403 }
              );
            }
            currentOv.productRelPath = parsed.target;
            delete currentOv.productLiveUrl;
          } else {
            const check = validateSpckRelatedUrl(parsed.target);
            if (!check.valid || !check.normalizedUrl) {
              return NextResponse.json(
                { success: false, error: check.reason || "Link sản phẩm không hợp lệ." },
                { status: 400 }
              );
            }
            currentOv.productLiveUrl = check.normalizedUrl;
            delete currentOv.productRelPath;
          }
        }
      }

      if (ov.customTitle !== undefined) {
        const title = String(ov.customTitle ?? "").trim();
        if (!title) delete currentOv.customTitle;
        else currentOv.customTitle = title.slice(0, 120);
      }

      if (ov.excluded !== undefined) {
        if (Boolean(ov.excluded)) currentOv.excluded = true;
        else delete currentOv.excluded;
      }

      if (Object.keys(currentOv).length > 0) {
        overrides[studentId] = currentOv;
      } else {
        delete overrides[studentId];
      }

      const prevOrder = nextOrder || parseExistingOrder(existing?.orderJson, rosterIds);
      nextOrder = reconcileDemoOrder(prevOrder, rosterIds, overrides);

      if (ov.excluded === true && (nextCurrentStudentId || existing?.currentStudentId) === studentId) {
        const firstPresent = nextOrder.find((id) => !overrides[id]?.excluded);
        nextCurrentStudentId = firstPresent || nextOrder[0] || "";
      }
    }

    if (body.shuffleRandom === true) {
      const presentIds = rosterIds.filter((id) => !overrides[id]?.excluded);
      const excludedIds = rosterIds.filter((id) => Boolean(overrides[id]?.excluded));
      nextOrder = shuffleDemoStudentOrder(presentIds, excludedIds);
      nextCurrentStudentId = nextOrder[0] || "";
      nextCompletedIds = [];
    } else if (nextOrder) {
      nextOrder = reconcileDemoOrder(nextOrder, rosterIds, overrides);
    }

    const saveRes = demoDayRepo.upsert({
      classId,
      ...(nextOrder !== undefined ? { order: nextOrder } : {}),
      ...(nextCurrentStudentId !== undefined
        ? { currentStudentId: nextCurrentStudentId }
        : {}),
      ...(nextCompletedIds !== undefined
        ? { completedStudentIds: nextCompletedIds }
        : {}),
      overrides,
      ...(expectedRowVer !== undefined ? { expectedRowVer } : {}),
    });

    const data = await inspectClassDemoDayState(classId);

    if (saveRes.staleIgnored) {
      return NextResponse.json(
        {
          success: false,
          staleIgnored: true,
          rowVer: saveRes.record.rowVer,
          error: "Dữ liệu vừa được cập nhật ở nơi khác, hệ thống đã tải lại bản mới nhất.",
          data,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      staleIgnored: false,
      rowVer: saveRes.record.rowVer,
      data,
    });
  } catch (err: unknown) {
    if (err instanceof DemoDayClassNotFoundError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 404 }
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Không thể lưu trạng thái Thi Demo.",
      },
      { status: 500 }
    );
  }
}
