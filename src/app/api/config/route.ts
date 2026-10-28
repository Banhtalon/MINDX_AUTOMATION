import { NextResponse } from "next/server";
import {
  getCoursesSyllabus,
  getGradingRubrics,
  getQuickTags,
  getZaloTemplates,
  saveCoursesSyllabus,
  saveGradingRubrics,
  saveQuickTags,
  saveZaloTemplates,
  type CourseSession,
  type CourseSyllabus,
  type GradingCriterion,
  type GradingRubric,
  type QuickTag,
  type QuickTagCategory,
  type ZaloTemplate,
} from "@/lib/db/json-config";
import { getDefaultCheckpointSessions } from "@/lib/quick-tags";
import { validateLocalRequest } from "@/lib/security/local-guard";

export const dynamic = "force-dynamic";

let lastServedCoursesSnapshot: CourseSyllabus[] | null = null;
let preWriteCoursesBaseline: CourseSyllabus[] | null = null;
let writesSinceLastGetCourses = 0;

export async function GET(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    const courses = getCoursesSyllabus();
    const rubrics = getGradingRubrics();
    const quickTags = getQuickTags();
    const zaloTemplates = getZaloTemplates();

    lastServedCoursesSnapshot = structuredClone(courses);
    preWriteCoursesBaseline = null;
    writesSinceLastGetCourses = 0;

    return NextResponse.json({
      success: true,
      courses,
      rubrics,
      quickTags,
      zaloTemplates,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const guard = validateLocalRequest(req);
  if (guard) return guard;

  try {
    let rawText = "";
    try {
      rawText = await req.text();
    } catch {
      return NextResponse.json(
        { success: false, error: "Không thể đọc nội dung JSON gửi lên." },
        { status: 400 }
      );
    }

    let body: any;
    try {
      body = JSON.parse(rawText, (_key, value) => {
        if (typeof value === "number" && !Number.isFinite(value)) {
          throw new Error("Giá trị số vượt ngưỡng hữu hạn cho phép (Infinity/NaN).");
        }
        return value;
      });
    } catch (parseErr) {
      return NextResponse.json(
        {
          success: false,
          error:
            parseErr instanceof Error
              ? parseErr.message
              : "Payload JSON không hợp lệ.",
        },
        { status: 400 }
      );
    }

    const section = typeof body?.section === "string" ? body.section.trim() : "";

    if (section === "courses") {
      if (!Array.isArray(body.courses) || body.courses.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: "Danh sách khóa học (courses) phải là mảng và có ít nhất 1 khóa học.",
          },
          { status: 400 }
        );
      }

      const normalizedCourses: CourseSyllabus[] = [];
      const seenCodes = new Set<string>();

      for (const rawCourse of body.courses) {
        if (
          !rawCourse ||
          typeof rawCourse !== "object" ||
          Array.isArray(rawCourse) ||
          typeof rawCourse.courseCode !== "string" ||
          typeof rawCourse.courseName !== "string"
        ) {
          return NextResponse.json(
            {
              success: false,
              error: "Mã khóa học (courseCode) và Tên khóa học (courseName) phải là chuỗi ký tự hợp lệ.",
            },
            { status: 400 }
          );
        }

        const courseCode = rawCourse.courseCode.trim().toUpperCase();
        const courseName = rawCourse.courseName.trim();
        const description =
          typeof rawCourse.description === "string" ? rawCourse.description.trim() : "";

        if (!courseCode || !courseName) {
          return NextResponse.json(
            {
              success: false,
              error: "Mỗi khóa học bắt buộc phải có Mã khóa (courseCode) và Tên khóa (courseName).",
            },
            { status: 400 }
          );
        }

        if (seenCodes.has(courseCode)) {
          return NextResponse.json(
            {
              success: false,
              error: `Mã khóa học '${courseCode}' bị trùng lặp trong danh sách.`,
            },
            { status: 400 }
          );
        }
        seenCodes.add(courseCode);

        if (!Array.isArray(rawCourse.sessions) || rawCourse.sessions.length === 0) {
          return NextResponse.json(
            {
              success: false,
              error: `Khóa học '${courseCode}' phải có danh sách buổi học (sessions) hợp lệ (ít nhất 1 buổi).`,
            },
            { status: 400 }
          );
        }

        const seenSessionNumbers = new Set<number>();
        const sessions: CourseSession[] = [];

        for (const s of rawCourse.sessions) {
          if (!s || typeof s !== "object" || Array.isArray(s)) {
            return NextResponse.json(
              {
                success: false,
                error: `Dữ liệu buổi học trong khóa '${courseCode}' không hợp lệ.`,
              },
              { status: 400 }
            );
          }

          if (
            typeof s.sessionNumber !== "number" ||
            !Number.isInteger(s.sessionNumber) ||
            s.sessionNumber < 1
          ) {
            return NextResponse.json(
              {
                success: false,
                error: `Số thứ tự buổi học (sessionNumber) trong khóa '${courseCode}' phải là số nguyên dương (>= 1).`,
              },
              { status: 400 }
            );
          }

          if (seenSessionNumbers.has(s.sessionNumber)) {
            return NextResponse.json(
              {
                success: false,
                error: `Khóa học '${courseCode}' có số buổi học (sessionNumber=${s.sessionNumber}) bị trùng lặp.`,
              },
              { status: 400 }
            );
          }
          seenSessionNumbers.add(s.sessionNumber);

          if (typeof s.topic !== "string" || !s.topic.trim()) {
            return NextResponse.json(
              {
                success: false,
                error: `Buổi ${s.sessionNumber} của khóa '${courseCode}' bắt buộc phải có chủ đề (topic) không rỗng.`,
              },
              { status: 400 }
            );
          }

          const keyKnowledge = Array.isArray(s.keyKnowledge)
            ? s.keyKnowledge
                .filter((k: unknown) => typeof k === "string")
                .map((k: string) => k.trim())
                .filter(Boolean)
            : typeof s.keyKnowledge === "string"
            ? s.keyKnowledge
                .split(/\r?\n|,/)
                .map((k: string) => k.trim())
                .filter(Boolean)
            : [];

          sessions.push({
            sessionNumber: s.sessionNumber,
            topic: s.topic.trim(),
            keyKnowledge,
            homeworkBrief: typeof s.homeworkBrief === "string" ? s.homeworkBrief.trim() : "",
          });
        }

        sessions.sort((a, b) => a.sessionNumber - b.sessionNumber);

        let checkpointSessions: number[] | undefined;
        if (Array.isArray(rawCourse.checkpointSessions)) {
          const parsedCheckpoints: number[] = (rawCourse.checkpointSessions as unknown[])
            .map((n: unknown) => Number(n))
            .filter((n: number) => Number.isInteger(n) && n >= 1 && n <= 13);
          checkpointSessions = Array.from(new Set<number>(parsedCheckpoints)).sort(
            (a: number, b: number) => a - b
          );
        } else {
          checkpointSessions = getDefaultCheckpointSessions(courseCode);
        }

        normalizedCourses.push({
          courseCode,
          courseName,
          description,
          checkpointSessions,
          sessions,
        });
      }

      const currentStored = getCoursesSyllabus();
      if (writesSinceLastGetCourses === 0) {
        preWriteCoursesBaseline = lastServedCoursesSnapshot ?? structuredClone(currentStored);
      } else if (preWriteCoursesBaseline) {
        for (const inc of normalizedCourses) {
          const base = preWriteCoursesBaseline.find((c) => c.courseCode === inc.courseCode);
          const curr = currentStored.find((c) => c.courseCode === inc.courseCode);
          if (base && curr) {
            const revertedName =
              curr.courseName !== base.courseName && inc.courseName === base.courseName;
            const revertedDesc =
              curr.description !== base.description && inc.description === base.description;
            const revertedSessions =
              JSON.stringify(curr.sessions) !== JSON.stringify(base.sessions) &&
              JSON.stringify(inc.sessions) === JSON.stringify(base.sessions);
            const revertedCheckpoints =
              JSON.stringify(curr.checkpointSessions ?? []) !==
                JSON.stringify(base.checkpointSessions ?? []) &&
              JSON.stringify(inc.checkpointSessions ?? []) ===
                JSON.stringify(base.checkpointSessions ?? []);

            if (revertedName || revertedDesc || revertedSessions || revertedCheckpoints) {
              return NextResponse.json(
                {
                  success: false,
                  error:
                    "Phát hiện xung đột cập nhật đồng thời (409 Conflict): dữ liệu khóa học đã được phiên khác thay đổi. Vui lòng tải lại trước khi lưu.",
                },
                { status: 409 }
              );
            }
          }
        }
      }

      saveCoursesSyllabus(normalizedCourses);
      writesSinceLastGetCourses++;

      return NextResponse.json({
        success: true,
        message: `Đã lưu thành công ${normalizedCourses.length} khóa học vào giáo trình.`,
        courses: getCoursesSyllabus(),
      });
    }

    if (section === "rubrics") {
      if (!Array.isArray(body.rubrics) || body.rubrics.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: "Danh sách Barem (rubrics) phải là mảng và có ít nhất 1 Barem.",
          },
          { status: 400 }
        );
      }

      const normalizedRubrics: GradingRubric[] = [];
      const seenRubricIds = new Set<string>();

      for (const rawRubric of body.rubrics) {
        if (
          !rawRubric ||
          typeof rawRubric !== "object" ||
          Array.isArray(rawRubric) ||
          typeof rawRubric.rubricId !== "string" ||
          typeof rawRubric.courseCode !== "string" ||
          typeof rawRubric.assignmentTitle !== "string"
        ) {
          return NextResponse.json(
            {
              success: false,
              error:
                "Mỗi Barem bắt buộc phải có Mã Barem (rubricId), Mã khóa (courseCode) và Tiêu đề bài tập (assignmentTitle) kiểu chuỗi hợp lệ.",
            },
            { status: 400 }
          );
        }

        if (
          typeof rawRubric.sessionNumber !== "number" ||
          !Number.isInteger(rawRubric.sessionNumber) ||
          rawRubric.sessionNumber < 1
        ) {
          return NextResponse.json(
            {
              success: false,
              error: "Số buổi học (sessionNumber) của Barem phải là số nguyên dương (>= 1).",
            },
            { status: 400 }
          );
        }

        const rubricId = rawRubric.rubricId.trim();
        const courseCode = rawRubric.courseCode.trim().toUpperCase();
        const sessionNumber = rawRubric.sessionNumber;
        const assignmentTitle = rawRubric.assignmentTitle.trim();
        const assignmentPrompt =
          typeof rawRubric.assignmentPrompt === "string" ? rawRubric.assignmentPrompt.trim() : "";

        if (!rubricId || !courseCode || !assignmentTitle) {
          return NextResponse.json(
            {
              success: false,
              error:
                "Mỗi Barem bắt buộc phải có Mã Barem (rubricId), Mã khóa (courseCode) và Tiêu đề bài tập (assignmentTitle).",
            },
            { status: 400 }
          );
        }

        const rubricIdKey = rubricId.toUpperCase();
        if (seenRubricIds.has(rubricIdKey)) {
          return NextResponse.json(
            {
              success: false,
              error: `Mã Barem '${rubricId}' bị trùng lặp.`,
            },
            { status: 400 }
          );
        }
        seenRubricIds.add(rubricIdKey);

        if (!Array.isArray(rawRubric.criteria) || rawRubric.criteria.length === 0) {
          return NextResponse.json(
            {
              success: false,
              error: `Barem '${rubricId}' phải có ít nhất 1 tiêu chí chấm điểm.`,
            },
            { status: 400 }
          );
        }

        const seenCriterionIds = new Set<string>();
        const criteria: GradingCriterion[] = [];

        for (const c of rawRubric.criteria) {
          if (
            !c ||
            typeof c !== "object" ||
            Array.isArray(c) ||
            typeof c.criterionId !== "string" ||
            !c.criterionId.trim() ||
            typeof c.name !== "string" ||
            !c.name.trim()
          ) {
            return NextResponse.json(
              {
                success: false,
                error: `Mỗi tiêu chí trong Barem '${rubricId}' phải có mã tiêu chí (criterionId) và tên tiêu chí (name) không rỗng.`,
              },
              { status: 400 }
            );
          }

          const criterionId = c.criterionId.trim();
          const critKey = criterionId.toUpperCase();
          if (seenCriterionIds.has(critKey)) {
            return NextResponse.json(
              {
                success: false,
                error: `Barem '${rubricId}' có mã tiêu chí '${criterionId}' bị trùng lặp.`,
              },
              { status: 400 }
            );
          }
          seenCriterionIds.add(critKey);

          if (
            typeof c.maxPoints !== "number" ||
            !Number.isFinite(c.maxPoints) ||
            c.maxPoints <= 0
          ) {
            return NextResponse.json(
              {
                success: false,
                error: `Điểm tối đa (maxPoints) của tiêu chí '${criterionId}' trong Barem '${rubricId}' phải là số dương hợp lệ.`,
              },
              { status: 400 }
            );
          }

          const roundedPoints = Math.round(c.maxPoints * 100) / 100;
          if (roundedPoints <= 0) {
            return NextResponse.json(
              {
                success: false,
                error: `Điểm tối đa (maxPoints) của tiêu chí '${criterionId}' quá nhỏ sau khi làm tròn 2 chữ số thập phân.`,
              },
              { status: 400 }
            );
          }

          criteria.push({
            criterionId,
            name: c.name.trim(),
            maxPoints: roundedPoints,
            description: typeof c.description === "string" ? c.description.trim() : "",
            expectedSnippetOrConcept:
              typeof c.expectedSnippetOrConcept === "string"
                ? c.expectedSnippetOrConcept.trim()
                : "",
          });
        }

        // Deterministic total score computed in TypeScript (must match 100-point LMS grading scale)
        const maxTotalScore =
          Math.round(criteria.reduce((sum, c) => sum + c.maxPoints, 0) * 100) / 100;

        if (Math.abs(maxTotalScore - 100) > 0.01) {
          return NextResponse.json(
            {
              success: false,
              error: `Barem '${rubricId}' có tổng điểm tối đa các tiêu chí là ${maxTotalScore}/100, không khớp thang điểm 100 chuẩn của LMS. Vui lòng điều chỉnh tổng điểm các tiêu chí bằng đúng 100 (nếu đang dùng barem cũ thang 10, vui lòng quy đổi nhân 10 sang thang 100).`,
            },
            { status: 400 }
          );
        }

        normalizedRubrics.push({
          rubricId,
          courseCode,
          sessionNumber,
          assignmentTitle,
          assignmentPrompt,
          maxTotalScore,
          criteria,
        });
      }

      saveGradingRubrics(normalizedRubrics);
      return NextResponse.json({
        success: true,
        message: `Đã lưu thành công ${normalizedRubrics.length} Barem chấm điểm.`,
        rubrics: getGradingRubrics(),
      });
    }

    if (section === "quickTags") {
      if (!Array.isArray(body.quickTags) || body.quickTags.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: "Danh sách Quick Tags phải là mảng và có ít nhất 1 nhóm thẻ.",
          },
          { status: 400 }
        );
      }

      const normalizedCategories: QuickTagCategory[] = [];
      const seenCategories = new Set<string>();

      for (const cat of body.quickTags) {
        if (
          !cat ||
          typeof cat !== "object" ||
          Array.isArray(cat) ||
          typeof cat.category !== "string" ||
          !cat.category.trim() ||
          typeof cat.categoryName !== "string" ||
          !cat.categoryName.trim() ||
          !Array.isArray(cat.tags) ||
          cat.tags.length === 0
        ) {
          return NextResponse.json(
            {
              success: false,
              error: "Mỗi nhóm Quick Tags phải có mã nhóm (category), tên nhóm (categoryName) và mảng thẻ (tags) không rỗng.",
            },
            { status: 400 }
          );
        }

        const category = cat.category.trim();
        const categoryKey = category.toLowerCase();
        if (seenCategories.has(categoryKey)) {
          return NextResponse.json(
            {
              success: false,
              error: `Nhóm Quick Tags '${category}' bị trùng lặp.`,
            },
            { status: 400 }
          );
        }
        seenCategories.add(categoryKey);

        const seenTagIds = new Set<string>();
        const tags: QuickTag[] = [];
        for (const t of cat.tags) {
          if (
            !t ||
            typeof t !== "object" ||
            Array.isArray(t) ||
            typeof t.id !== "string" ||
            !t.id.trim() ||
            typeof t.label !== "string" ||
            !t.label.trim()
          ) {
            return NextResponse.json(
              {
                success: false,
                error: `Mỗi thẻ trong nhóm '${category}' phải có mã (id) và nhãn hiển thị (label) không rỗng.`,
              },
              { status: 400 }
            );
          }

          const tagId = t.id.trim();
          const tagKey = tagId.toLowerCase();
          if (seenTagIds.has(tagKey)) {
            return NextResponse.json(
              {
                success: false,
                error: `Mã thẻ Quick Tag '${tagId}' bị trùng lặp.`,
              },
              { status: 400 }
            );
          }
          seenTagIds.add(tagKey);

          const tagObj: QuickTag = {
            id: tagId,
            label: t.label.trim(),
            sentiment:
              t.sentiment === "positive" || t.sentiment === "constructive"
                ? t.sentiment
                : "neutral",
            hint: typeof t.hint === "string" ? t.hint.trim() : "",
          };
          if (typeof t.role === "string" && t.role.trim()) {
            tagObj.role = t.role.trim();
          }
          tags.push(tagObj);
        }

        const catObj: QuickTagCategory = {
          category,
          categoryName: cat.categoryName.trim(),
          tags,
        };
        if (typeof cat.track === "string" && cat.track.trim()) {
          catObj.track = cat.track.trim();
        }
        normalizedCategories.push(catObj);
      }

      saveQuickTags(normalizedCategories);
      return NextResponse.json({
        success: true,
        message: `Đã lưu thành công ${normalizedCategories.length} nhóm thẻ Quick Tags.`,
        quickTags: getQuickTags(),
      });
    }

    if (section === "zaloTemplates") {
      if (!Array.isArray(body.zaloTemplates) || body.zaloTemplates.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: "Danh sách Mẫu Zalo phải là mảng và có ít nhất 1 mẫu thông báo.",
          },
          { status: 400 }
        );
      }

      const normalizedTemplates: ZaloTemplate[] = [];
      const seenTemplateIds = new Set<string>();

      for (const tpl of body.zaloTemplates) {
        if (
          !tpl ||
          typeof tpl !== "object" ||
          Array.isArray(tpl) ||
          typeof tpl.id !== "string" ||
          !tpl.id.trim() ||
          typeof tpl.name !== "string" ||
          !tpl.name.trim() ||
          typeof tpl.template !== "string" ||
          !tpl.template.trim()
        ) {
          return NextResponse.json(
            {
              success: false,
              error: "Mỗi mẫu thông báo Zalo bắt buộc phải có id, tên mẫu (name) và nội dung (template) không rỗng.",
            },
            { status: 400 }
          );
        }

        const id = tpl.id.trim();
        const idKey = id.toLowerCase();
        if (seenTemplateIds.has(idKey)) {
          return NextResponse.json(
            {
              success: false,
              error: `Mã mẫu Zalo '${id}' bị trùng lặp.`,
            },
            { status: 400 }
          );
        }
        seenTemplateIds.add(idKey);

        normalizedTemplates.push({
          id,
          name: tpl.name.trim(),
          template: tpl.template.trim(),
        });
      }

      saveZaloTemplates(normalizedTemplates);
      return NextResponse.json({
        success: true,
        message: `Đã lưu thành công ${normalizedTemplates.length} mẫu thông báo Zalo.`,
        zaloTemplates: getZaloTemplates(),
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: `Phân mục cấu hình không hợp lệ ('${section}'). Cho phép: courses, rubrics, quickTags, zaloTemplates.`,
      },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
