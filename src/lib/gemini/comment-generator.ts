import { getGeminiModel } from "./client";
import { sessionFeedbackRepo, studentRepo, type SessionFeedbackRecord } from "../db/sqlite";
import { getCoursesSyllabus, getQuickTags } from "../db/json-config";

export interface StudentCommentInput {
  studentId: string;
  fullName: string;
  isActive?: boolean | number;
  attendanceStatus?: "PRESENT" | "ABSENT" | "LATE" | "UNKNOWN";
  quickTags?: string[];
  teacherNote?: string;
  expectedRowVer?: number | null;
}

export interface SessionContext {
  classId: string;
  classCode: string;
  sessionId: string;
  sessionNumber: number;
  topic: string;
  keyKnowledge?: string[];
  isCheckpointSession?: boolean;
}

export interface GeneratedCommentResult {
  studentId: string;
  fullName: string;
  status: "INSUFFICIENT_INFO" | "DRAFT" | "FAILED";
  strengths: string;
  improvements: string;
  actionPlan: string;
  formattedFullComment: string;
  errorMessage?: string;
  staleIgnored?: boolean;
  versionMeta?: any;
}

interface CandidateSnapshot {
  hadExistingRecord: boolean;
  versionMetaJson: string;
  rowVer: number;
  attendanceStatus: string;
  quickTagsJson: string;
  teacherNote: string;
  strengths: string;
  improvements: string;
  actionPlan: string;
  finalText: string;
  status: string;
  contentHash: string;
}

function parseVersionMetaSafe(raw?: string | null): { rowVer: number; fields: Record<string, any> } {
  if (!raw || typeof raw !== "string") return { rowVer: 0, fields: {} };
  try {
    const parsed = JSON.parse(raw);
    return {
      rowVer: typeof parsed?.rowVer === "number" && Number.isFinite(parsed.rowVer) ? parsed.rowVer : 0,
      fields:
        parsed?.fields && typeof parsed.fields === "object" && !Array.isArray(parsed.fields)
          ? { ...parsed.fields }
          : {},
    };
  } catch {
    return { rowVer: 0, fields: {} };
  }
}

export class CommentGenerator {
  private static latestBatchSeq = 0;
  private static latestStudentCallSeq = new Map<string, number>();
  /**
   * Generates pedagogy-aligned 3-part comments for a list of students in a session.
   * Strictly enforces:
   * 1. Anti-hallucination guardrail: Returns INSUFFICIENT_INFO if no tags and no notes.
   * 2. Anonymization: Anonymizes student names to STUDENT_01, STUDENT_02... before calling Gemini.
   * 3. De-anonymization: Re-maps back to real names.
   * 4. Immediate draft persistence into SQLite.
   */
  public static async generateBatchComments(
    session: SessionContext,
    students: StudentCommentInput[]
  ): Promise<GeneratedCommentResult[]> {
    const normalizedClassId =
      typeof session?.classId === "string" ? session.classId.trim().toUpperCase() : "";
    const normalizedClassCode =
      typeof session?.classCode === "string" && session.classCode.trim()
        ? session.classCode.trim().toUpperCase()
        : normalizedClassId;
    const normalizedSessionId =
      typeof session?.sessionId === "string" ? session.sessionId.trim() : "";

    if (!normalizedClassId || !normalizedSessionId) {
      throw new Error(
        "[CommentGenerator] Thiếu classId hoặc sessionId bắt buộc trước khi sinh nhận xét AI."
      );
    }
    if (normalizedClassId !== normalizedClassCode) {
      throw new Error(
        `[CommentGenerator] Xung đột định danh lớp: classId ('${normalizedClassId}') khác classCode ('${normalizedClassCode}').`
      );
    }

    const escapedClassId = normalizedClassId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sessionPrefixRegex = new RegExp(`^${escapedClassId}(?:_SESS_|[^a-zA-Z0-9_-])`, "i");
    if (!sessionPrefixRegex.test(normalizedSessionId)) {
      throw new Error(
        `[CommentGenerator] Mã buổi học '${normalizedSessionId}' không thuộc đúng lớp '${normalizedClassId}'.`
      );
    }

    const callSeq = ++CommentGenerator.latestBatchSeq;
    const results: GeneratedCommentResult[] = [];
    const validCandidates: {
      input: StudentCommentInput;
      regularQuickTags: string[];
      anonymousId: string;
      scopeKey: string;
      initialSnapshot: CandidateSnapshot;
    }[] = [];

    const rawCategories = typeof getQuickTags === "function" ? getQuickTags() || [] : [];
    const isSession14CategoryObj = (cat: any): boolean => {
      const track = String(cat?.track || "").trim().toLowerCase();
      const key = String(cat?.category || "").trim().toLowerCase();
      const name = String(cat?.categoryName || "").trim().toLowerCase();
      return (
        track === "session14" ||
        track === "spck" ||
        key.startsWith("spck_") ||
        key.includes("session14") ||
        /buổi\s*14|spck/i.test(name)
      );
    };
    const configuredCategories = rawCategories.filter((cat) => !isSession14CategoryObj(cat));
    const session14TagSet = new Set<string>();
    for (const cat of rawCategories) {
      if (!isSession14CategoryObj(cat)) continue;
      for (const t of cat?.tags || []) {
        if (t?.id) session14TagSet.add(String(t.id).trim().toLowerCase());
        if (t?.label) session14TagSet.add(String(t.label).trim().toLowerCase());
      }
    }
    const filterRegularTags = (tags?: string[]): string[] => {
      if (!Array.isArray(tags)) return [];
      return tags
        .map((t) => String(t || "").trim())
        .filter((t) => {
          if (!t) return false;
          const lower = t.toLowerCase();
          if (session14TagSet.has(lower)) return false;
          if (
            /^s14_|slide thuyết trình|phụ thuộc.*vào ai|bố cục.*flexbox|thuyết trình còn nhỏ|sản phẩm chạy mượt/i.test(
              lower
            )
          ) {
            return false;
          }
          return true;
        });
    };

    const captureSnapshot = (
      student: StudentCommentInput,
      regularQuickTags: string[],
      dbRecord?: SessionFeedbackRecord
    ): CandidateSnapshot => {
      const meta = parseVersionMetaSafe(dbRecord?.versionMetaJson);
      return {
        hadExistingRecord: Boolean(dbRecord),
        versionMetaJson: dbRecord?.versionMetaJson ?? "",
        rowVer: meta.rowVer,
        attendanceStatus: dbRecord?.attendanceStatus ?? student.attendanceStatus ?? "PRESENT",
        quickTagsJson: dbRecord?.quickTagsJson ?? JSON.stringify(regularQuickTags),
        teacherNote: dbRecord?.teacherNote ?? (student.teacherNote || ""),
        strengths: dbRecord?.strengths ?? "",
        improvements: dbRecord?.improvements ?? "",
        actionPlan: dbRecord?.actionPlan ?? "",
        finalText: dbRecord?.finalText ?? "",
        status: dbRecord?.status ?? "DRAFT",
        contentHash: dbRecord?.contentHash ?? "",
      };
    };

    // Step 1: Filter and classify candidates; apply Active + Present & Anti-Hallucination Guardrail
    for (let i = 0; i < students.length; i++) {
      const student = students[i];
      if (!student || !student.studentId) continue;

      const dbStudent =
        typeof studentRepo?.findOne === "function"
          ? studentRepo.findOne(student.studentId, normalizedClassId)
          : undefined;
      const isMatchingClass =
        !dbStudent?.classId ||
        String(dbStudent.classId).trim().toUpperCase() === normalizedClassId;
      const isStudentActive =
        student.isActive !== false &&
        student.isActive !== 0 &&
        Boolean(dbStudent && dbStudent.isActive === 1 && isMatchingClass);
      const isConfirmedPresent =
        student.attendanceStatus === "PRESENT" || student.attendanceStatus === "LATE";

      if (!isStudentActive || !isConfirmedPresent) {
        continue;
      }

      const initialDbRecord =
        typeof sessionFeedbackRepo?.findOne === "function"
          ? sessionFeedbackRepo.findOne(normalizedClassId, normalizedSessionId, student.studentId)
          : undefined;
      const curMeta = parseVersionMetaSafe(initialDbRecord?.versionMetaJson);
      const hasExpectedRowVer =
        typeof student.expectedRowVer === "number" &&
        Number.isFinite(student.expectedRowVer) &&
        student.expectedRowVer >= 0;

      // R16-03: Check expectedRowVer BEFORE any write branch (including INSUFFICIENT_INFO)
      if (hasExpectedRowVer && curMeta.rowVer !== student.expectedRowVer) {
        results.push({
          studentId: student.studentId,
          fullName: student.fullName,
          status: ((initialDbRecord?.status as any) || "DRAFT") as any,
          strengths: initialDbRecord?.strengths ?? "",
          improvements: initialDbRecord?.improvements ?? "",
          actionPlan: initialDbRecord?.actionPlan ?? "",
          formattedFullComment: initialDbRecord?.finalText ?? "",
          staleIgnored: true,
          versionMeta: curMeta,
          errorMessage: `Dữ liệu của học viên '${student.fullName}' đã được cập nhật mới hơn (phiên bản ${student.expectedRowVer} -> ${curMeta.rowVer}). Giữ nguyên bản hiện tại.`,
        });
        continue;
      }

      // R17-01: Protect already APPROVED or VERIFIED comments before EVERY AI write branch
      if (
        initialDbRecord &&
        (initialDbRecord.status === "APPROVED" || initialDbRecord.status === "VERIFIED")
      ) {
        results.push({
          studentId: student.studentId,
          fullName: student.fullName,
          status: initialDbRecord.status as any,
          strengths: initialDbRecord.strengths ?? "",
          improvements: initialDbRecord.improvements ?? "",
          actionPlan: initialDbRecord.actionPlan ?? "",
          formattedFullComment: initialDbRecord.finalText ?? "",
          staleIgnored: true,
          versionMeta: curMeta,
        });
        continue;
      }

      const scopeKey = `${normalizedClassId}::${normalizedSessionId}::${student.studentId}`;
      CommentGenerator.latestStudentCallSeq.set(scopeKey, callSeq);

      const regularQuickTags = filterRegularTags(student.quickTags);
      const hasTags = regularQuickTags.length > 0;
      const hasNote = Boolean(student.teacherNote && student.teacherNote.trim().length > 0);

      // IRON RULE 5: Nếu học viên không có cả Quick Tags lẫn ghi chú -> INSUFFICIENT_INFO (CẤM AI BỊA)
      if (!hasTags && !hasNote) {
        const defaultInsufficientNotice =
          "Chưa đủ thông tin để nhận xét. Vui lòng chọn ít nhất 1 Quick Tag hoặc nhập ghi chú của giáo viên.";
        const preservedStrengths = initialDbRecord?.strengths ?? "";
        const preservedImprovements = initialDbRecord?.improvements ?? "";
        const preservedActionPlan = initialDbRecord?.actionPlan ?? "";
        const preservedFinalText =
          initialDbRecord?.finalText && initialDbRecord.finalText.trim().length > 0
            ? initialDbRecord.finalText
            : defaultInsufficientNotice;

        const insufficientResult: GeneratedCommentResult = {
          studentId: student.studentId,
          fullName: student.fullName,
          status: "INSUFFICIENT_INFO",
          strengths: preservedStrengths,
          improvements: preservedImprovements,
          actionPlan: preservedActionPlan,
          formattedFullComment: preservedFinalText,
          errorMessage: defaultInsufficientNotice,
        };

        const nextMeta = {
          rowVer: (curMeta.rowVer || 0) + 1,
          fields: { ...curMeta.fields },
        };

        // Save immediately to SQLite while preserving current DB attendance/tags/note/finalText if present
        sessionFeedbackRepo.upsert({
          classId: normalizedClassId,
          sessionId: normalizedSessionId,
          studentId: student.studentId,
          attendanceStatus:
            (initialDbRecord?.attendanceStatus as any) || student.attendanceStatus || "PRESENT",
          quickTagsJson: initialDbRecord?.quickTagsJson ?? JSON.stringify(regularQuickTags),
          teacherNote: initialDbRecord?.teacherNote ?? (student.teacherNote || ""),
          strengths: preservedStrengths,
          improvements: preservedImprovements,
          actionPlan: preservedActionPlan,
          finalText: preservedFinalText,
          status: "INSUFFICIENT_INFO",
          versionMetaJson: JSON.stringify(nextMeta),
        });

        results.push({ ...insufficientResult, versionMeta: nextMeta });
        continue;
      }

      // Add to AI generation queue with anonymous ID and input version snapshot
      const anonymousId = `STUDENT_${String(validCandidates.length + 1).padStart(2, "0")}`;
      validCandidates.push({
        input: student,
        regularQuickTags,
        anonymousId,
        scopeKey,
        initialSnapshot: captureSnapshot(student, regularQuickTags, initialDbRecord),
      });
    }

    // If no students need AI generation, return early
    if (validCandidates.length === 0) {
      return results;
    }

    // Step 2: Build anonymized payload for Gemini API (strip real student names from teacherNote & quickTags)
    const stripAccents = (s: string) =>
      s
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D");

    const dbClassStudents =
      typeof studentRepo?.findByClass === "function"
        ? studentRepo.findByClass(normalizedClassId, false) || []
        : [];

    const nameReplacements: { variant: string; token: string }[] = [];
    const addNameVariants = (rawFullName: string, token: string) => {
      const cleanName = String(rawFullName || "").replace(/\s+/g, " ").trim();
      if (!cleanName) return;
      const parts = cleanName.split(" ").filter(Boolean);
      const variants = new Set<string>([cleanName, stripAccents(cleanName)]);
      if (parts.length >= 2) {
        const lastTwo = parts.slice(-2).join(" ");
        variants.add(lastTwo);
        variants.add(stripAccents(lastTwo));
      }
      const givenName = parts[parts.length - 1];
      if (givenName && givenName.length >= 2) {
        variants.add(givenName);
        variants.add(stripAccents(givenName));
      }
      for (const v of variants) {
        if (v.length >= 2) {
          nameReplacements.push({ variant: v, token });
        }
      }
    };

    for (const c of validCandidates) {
      addNameVariants(c.input.fullName, c.anonymousId);
      const dbSt = dbClassStudents.find((s) => s.studentId === c.input.studentId);
      if (dbSt && dbSt.fullName) {
        addNameVariants(dbSt.fullName, c.anonymousId);
      }
    }
    for (const s of students) {
      if (!validCandidates.some((c) => c.input.studentId === s.studentId)) {
        addNameVariants(s.fullName, "STUDENT_PEER");
      }
    }
    for (const dbSt of dbClassStudents) {
      if (!validCandidates.some((c) => c.input.studentId === dbSt.studentId)) {
        addNameVariants(dbSt.fullName, "STUDENT_PEER");
      }
    }

    // Sort longest variants first so full names replace before short given names
    nameReplacements.sort((a, b) => b.variant.length - a.variant.length);

    const scrubStudentNames = (rawText: string, selfName: string, selfAnonId: string): string => {
      let text = String(rawText || "");
      if (!text) return "";
      const localList: { variant: string; token: string }[] = [];
      const cleanSelf = String(selfName || "").replace(/\s+/g, " ").trim();
      if (cleanSelf) {
        const parts = cleanSelf.split(" ").filter(Boolean);
        localList.push({ variant: cleanSelf, token: selfAnonId });
        localList.push({ variant: stripAccents(cleanSelf), token: selfAnonId });
        if (parts.length >= 2) {
          const lastTwo = parts.slice(-2).join(" ");
          localList.push({ variant: lastTwo, token: selfAnonId });
          localList.push({ variant: stripAccents(lastTwo), token: selfAnonId });
        }
        const given = parts[parts.length - 1];
        if (given && given.length >= 2) {
          localList.push({ variant: given, token: selfAnonId });
          localList.push({ variant: stripAccents(given), token: selfAnonId });
        }
      }
      const combined = [...localList, ...nameReplacements].sort(
        (a, b) => b.variant.length - a.variant.length
      );
      for (const { variant, token } of combined) {
        const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "giu");
        text = text.replace(re, token);
      }
      return text;
    };

    const isRoboticsClass = /(?:rob|pre[bai]|arm[bai]|semi[bai]|vex)/i.test(normalizedClassCode);

    const resolveTagWithHint = (rawTag: string): string => {
      const cleanTag = String(rawTag || "").trim();
      if (!cleanTag || configuredCategories.length === 0) return cleanTag;
      const cleanLower = cleanTag.toLowerCase();
      let fallbackHint = "";
      let fallbackLabel = cleanTag;
      for (const cat of configuredCategories) {
        const catTrack = String((cat as any)?.track || "").toLowerCase();
        const catKey = String(cat?.category || "").toLowerCase();
        const catName = String(cat?.categoryName || "").toLowerCase();
        const isRobCat =
          catTrack === "robotics" ||
          catKey.includes("robot") ||
          catKey.startsWith("rob_") ||
          /robot|lắp ráp|🤖/i.test(catName);
        const isCodeCat =
          catTrack === "coding" ||
          catKey.includes("coding") ||
          catKey === "execution" ||
          /lập trình|code|💻/i.test(catName);

        for (const t of cat?.tags || []) {
          const tLabel = String(t?.label || "").trim();
          const tId = String(t?.id || "").trim();
          if (
            (tLabel.toLowerCase() === cleanLower || tId.toLowerCase() === cleanLower) &&
            t?.hint
          ) {
            const displayLabel = tLabel || cleanTag;
            if ((isRoboticsClass && isRobCat) || (!isRoboticsClass && isCodeCat)) {
              return `${displayLabel} (Chi tiết: ${t.hint})`;
            }
            if (!fallbackHint) {
              fallbackHint = t.hint;
              fallbackLabel = displayLabel;
            }
          }
        }
      }
      return fallbackHint ? `${fallbackLabel} (Chi tiết: ${fallbackHint})` : cleanTag;
    };

    const tagLookup = new Map<string, any>();
    for (const cat of configuredCategories) {
      for (const t of cat?.tags || []) {
        if (t?.label) tagLookup.set(String(t.label).trim().toLowerCase(), t);
        if (t?.id) tagLookup.set(String(t.id).trim().toLowerCase(), t);
      }
    }

    const classifySkillLevel = (rawTags: string[]): string => {
      const tags = filterRegularTags(rawTags);
      let hasExcellent = false;
      let hasGood = false;
      let hasSlow = false;
      let hasDistracted = false;
      let hasImprove = false;
      let positiveCount = 0;

      for (const raw of tags) {
        const lower = raw.toLowerCase();
        const matched = tagLookup.get(lower);
        const role = String(matched?.role || "").trim().toLowerCase();

        if (role) {
          if (role === "excellent") {
            hasExcellent = true;
            positiveCount++;
          } else if (role === "distracted") {
            hasDistracted = true;
          } else if (role === "slow") {
            hasSlow = true;
          } else if (role === "improve") {
            hasImprove = true;
          } else if (role === "good" || role === "positive") {
            hasGood = true;
            positiveCount++;
          }
          continue;
        }

        if (
          /xuất sắc|giỏi|vận dụng.*sáng tạo|sáng tạo|🌟|💡|lvl_.*xuat_sac|tier_1/i.test(lower)
        ) {
          hasExcellent = true;
          positiveCount++;
          continue;
        }
        if (
          /mất tập trung|xao nhãng|nói chuyện riêng|làm việc riêng|cần tập trung hơn|👀|tier_3/i.test(
            lower
          )
        ) {
          hasDistracted = true;
          continue;
        }
        if (/thao tác.*chậm|cú pháp còn chậm|lúng túng|hay nhầm lệnh|⌨️|🔌|🐛/i.test(lower)) {
          hasImprove = true;
          continue;
        }
        if (
          /tiếp thu chậm|lắp ráp còn chậm|nhầm chốt|cần kèm|trung bình|chưa kịp|🐢|🔩|🛠️|lvl_.*can_kem|tier_4|tier_5/i.test(
            lower
          )
        ) {
          hasSlow = true;
          continue;
        }
        if (
          /tiếp thu tốt|làm bài tập đầy đủ|lắp ráp.*lập trình tốt|hăng hái|phối hợp nhóm|giữ kit tốt|đạt yêu cầu|khá|tốt|tích cực|hiểu bài nhanh|👍|✅|📝|🙋|🤖|🤝|lvl_.*dat|tier_2/i.test(
            lower
          )
        ) {
          hasGood = true;
          positiveCount++;
        }
      }

      if (positiveCount >= 3 && !hasSlow && !hasDistracted && !hasImprove) {
        hasExcellent = true;
      }

      const isNeedSupport = hasSlow || (hasImprove && !hasGood && !hasExcellent);

      if (isNeedSupport && hasDistracted) {
        return "Cấp độ 5 - Trung bình, mất tập trung: Chưa nắm chắc kiến thức cơ bản của buổi học do chưa thực sự tập trung lắng nghe khi thầy giảng giải, cần sự sát sao nhiều hơn để theo kịp tiến độ.";
      }
      if (isNeedSupport) {
        return "Cấp độ 4 - Trung bình: Có sự cố gắng và thái độ hợp tác tốt nhưng tốc độ tiếp thu và thao tác thực hành còn chậm, cần thầy hướng dẫn từng bước để hoàn thành sản phẩm.";
      }
      if (hasDistracted && (hasGood || hasExcellent)) {
        return "Cấp độ 3 - Khá nhưng mất tập trung: Tư duy nhạy bén, hiểu bài nhanh nhưng đôi lúc còn xao nhãng, làm việc riêng hoặc thao tác vội vàng dẫn đến lỗi nhỏ không đáng có.";
      }
      if (hasDistracted) {
        return "Cấp độ 5 - Trung bình, mất tập trung: Chưa nắm chắc kiến thức cơ bản của buổi học do chưa thực sự tập trung lắng nghe khi thầy giảng giải, cần sự sát sao nhiều hơn để theo kịp tiến độ.";
      }
      if (hasExcellent && !hasImprove) {
        return "Cấp độ 1 - Giỏi: Tiếp thu nhanh, nắm vững tư duy thuật toán và công nghệ, chủ động hoàn thành tốt bài tập cơ bản lẫn nâng cao, có sự sáng tạo.";
      }
      return "Cấp độ 2 - Khá: Nắm được kiến thức trọng tâm, thái độ học tập nghiêm túc, hoàn thành đúng yêu cầu bài thực hành nhưng cần thêm thời gian hoặc gợi ý ở các phần mở rộng/tối ưu hóa.";
    };

    const syllabusList =
      typeof getCoursesSyllabus === "function" ? getCoursesSyllabus() || [] : [];
    const matchedCourse = [...syllabusList]
      .sort((a, b) => String(b.courseCode || "").length - String(a.courseCode || "").length)
      .find((c) => {
        const code = String(c?.courseCode || "").trim().toUpperCase();
        return Boolean(code && normalizedClassCode.includes(code));
      });
    const validCourseCheckpoints = Array.isArray(matchedCourse?.checkpointSessions)
      ? matchedCourse.checkpointSessions
          .map((n) => Number(n))
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= 13)
      : [];
    const checkpointNums =
      validCourseCheckpoints.length > 0
        ? Array.from(new Set(validCourseCheckpoints)).sort((a, b) => a - b)
        : isRoboticsClass
        ? [4, 8]
        : [5, 9];
    const isCheckpoint =
      typeof session.isCheckpointSession === "boolean"
        ? session.isCheckpointSession
        : checkpointNums.includes(Number(session.sessionNumber));

    const anonymousRoster = validCandidates.map((c) => ({
      anonymousId: c.anonymousId,
      matchedLevel: classifySkillLevel(c.regularQuickTags),
      quickTags: c.regularQuickTags.map((t) =>
        scrubStudentNames(resolveTagWithHint(t), c.input.fullName, c.anonymousId)
      ),
      teacherNote: scrubStudentNames(
        c.input.teacherNote || "",
        c.input.fullName,
        c.anonymousId
      ),
      attendance: c.input.attendanceStatus || "PRESENT",
    }));

    const sanitizedTopic = scrubStudentNames(session.topic || "", "", "STUDENT_PEER");
    const keyKnowledgeText =
      session.keyKnowledge && session.keyKnowledge.length > 0
        ? session.keyKnowledge
            .map((k) => scrubStudentNames(String(k || ""), "", "STUDENT_PEER"))
            .join("; ")
        : sanitizedTopic;

    const checkpointNotice = isCheckpoint
      ? `\n- Loại buổi học: Buổi Kiểm tra Định kỳ (Checkpoint) — Phần điểm kiểm tra và đánh giá năng lực [ĐNL] do giáo viên chấm riêng trên LMS; bạn chỉ viết phần "Đánh giá chung" 3 gạch đầu dòng bên dưới để tổng kết mức độ nắm kiến thức, kỹ năng thực hành và lời khuyên ôn tập. TUYỆT ĐỐI KHÔNG tự bịa điểm số kiểm tra nếu giáo viên không ghi trong teacherNote.`
      : "";

    const prompt = `
Bạn là Giảng viên Công nghệ & Lập trình tại MindX Technology School (áp dụng kỹ năng chuẩn: nhan-xet-hoc-sinh).
Nhiệm vụ của bạn là soạn nhận xét tình hình học tập của từng học sinh sau buổi học để gửi phụ huynh qua Zalo/LMS, dựa trên Cấp độ học sinh (matchedLevel), Quick Tags và Ghi chú thực tế.

### THÔNG TIN BUỔI HỌC:
- Lớp: ${session.classCode} (Buổi ${session.sessionNumber}) — Hướng chuyên môn: ${isRoboticsClass ? "Lắp ráp & Lập trình Robotics" : "Lập trình & Công nghệ"}${checkpointNotice}
- Chủ đề bài học: ${sanitizedTopic}
- Kiến thức trọng tâm: ${keyKnowledgeText}

### QUY TẮC BẮT BUỘC (SKILL: NHAN-XET-HOC-SINH):
1. **Xác định ngữ cảnh & Cấp độ học sinh:**
   - Lồng ghép trực tiếp chủ đề bài học và kiến thức trọng tâm ở trên vào nhận xét.
   - Bám sát \`matchedLevel\` (1 trong 5 cấp độ: Cấp độ 1 - Giỏi; Cấp độ 2 - Khá; Cấp độ 3 - Khá nhưng mất tập trung; Cấp độ 4 - Trung bình; Cấp độ 5 - Trung bình, mất tập trung) kết hợp với \`quickTags\` và \`teacherNote\` của từng học sinh. TUYỆT ĐỐI KHÔNG tự bịa đặt thông tin trái ngược với thẻ đã chọn.
2. **Xưng hô & Văn phong:**
   - Xưng **"thầy"**, gọi học sinh là **"con"**, gọi phụ huynh là **"ba mẹ"** hoặc **"gia đình"**.
   - **TUYỆT ĐỐI KHÔNG ghi tên học sinh hoặc mã \`STUDENT_XX\` ở đầu nhận xét** (bắt đầu trực tiếp bằng gạch đầu dòng \`- **Điểm mạnh của học viên:**\`). Trong nội dung cũng gọi học sinh là **"con"**, không chèn mã \`STUDENT_XX\`.
   - Văn phong chuyên nghiệp, lịch sự, tích cực, mang tính xây dựng cao.
   - Luôn bắt đầu bằng sự ghi nhận tích cực (ngay cả với Cấp độ 4 và Cấp độ 5). Không dùng từ ngữ phán xét nặng nề (như "yếu kém", "lười biếng", "cá biệt"); thay bằng cụm từ mang tính hỗ trợ (như "cần rèn luyện thêm sự tỉ mỉ", "nếu con tập trung hơn sẽ phát huy rất tốt", "cần thêm thời gian thực hành để quen thao tác").
3. **Cấu trúc 3 gạch đầu dòng kèm in đậm bắt buộc (Độ dài tổng 100 - 250 từ/học sinh):**
   - \`strengths\` (Nội dung phần **Điểm mạnh của học viên**): Nêu rõ kỹ năng đạt được, thái độ tích cực, sự hào hứng hoặc tiến bộ của con dựa trên nội dung bài học. Có **in đậm** (\`**...**\`) các từ khóa kỹ năng, kiến thức hoặc sản phẩm trọng tâm con đã làm được.
   - \`improvements\` (Nội dung phần **Điểm cần cải thiện**): Nêu các vấn đề về kỹ năng thao tác, tư duy logic hoặc sự tập trung một cách khéo léo, nhẹ nhàng. Có **in đậm** (\`**...**\`) các điểm mấu chốt cần lưu ý khắc phục.
   - \`actionPlan\` (Nội dung phần **Lời khuyên**): Gợi ý giải pháp cụ thể, thiết thực để ba mẹ dễ dàng đồng hành, khích lệ và nhắc nhở con ôn tập ở nhà. Có **in đậm** (\`**...**\`) hành động cụ thể gợi ý cho con/ba mẹ.
   - \`formattedFullComment\`: Trình bày trọn vẹn trong 1 khối chuẩn đúng bố cục sau (KHÔNG có dòng tên học sinh ở đầu, ngắt dòng rõ ràng giữa 3 mục):
- **Điểm mạnh của học viên:** {strengths}

- **Điểm cần cải thiện:** {improvements}

- **Lời khuyên:** {actionPlan}

### DANH SÁCH DỮ LIỆU ĐÁNH GIÁ (ANONYMIZED STUDENTS):
${JSON.stringify(anonymousRoster, null, 2)}

### ĐỊNH DẠNG ĐẦU RA BẮT BUỘC:
Trả về duy nhất 1 JSON object chuẩn theo schema sau:
{
  "feedbacks": [
    {
      "anonymousId": "STUDENT_01",
      "strengths": "...",
      "improvements": "...",
      "actionPlan": "...",
      "formattedFullComment": "- **Điểm mạnh của học viên:** ...\\n\\n- **Điểm cần cải thiện:** ...\\n\\n- **Lời khuyên:** ..."
    }
  ]
}
`.trim();

    try {
      const model = getGeminiModel();
      const response = await model.generateContent(prompt);
      const text = response.response.text();
      const parsed = JSON.parse(text) as {
        feedbacks: Array<{
          anonymousId: string;
          strengths: string;
          improvements: string;
          actionPlan: string;
          formattedFullComment: string;
        }>;
      };

      const feedbackMap = new Map<string, (typeof parsed.feedbacks)[0]>();
      if (parsed && Array.isArray(parsed.feedbacks)) {
        for (const fb of parsed.feedbacks) {
          feedbackMap.set(fb.anonymousId, fb);
        }
      }

      // Step 3: De-anonymize and conditionally save drafts to SQLite
      for (const item of validCandidates) {
        const rawFeedback = feedbackMap.get(item.anonymousId);
        const student = item.input;
        const studentName = student.fullName;

        // Friendly Vietnamese addressing: extract first name or use full name
        const displayName = studentName;

        let strengths = (rawFeedback?.strengths || "").trim();
        let improvements = (rawFeedback?.improvements || "").trim();
        let actionPlan = (rawFeedback?.actionPlan || "").trim();
        let fullComment = (rawFeedback?.formattedFullComment || "").trim();

        // R2-11 Guardrail: Never invent fallback pedagogical feedback if AI omitted this student or any required field
        if (!rawFeedback || !strengths || !improvements || !actionPlan || !fullComment) {
          results.push({
            studentId: student.studentId,
            fullName: student.fullName,
            status: "FAILED",
            strengths: "",
            improvements: "",
            actionPlan: "",
            formattedFullComment: "",
            errorMessage: `AI không trả về đủ 3 phần nhận xét cho học viên '${studentName}' (${item.anonymousId}).`,
          });
          continue;
        }

        // De-anonymize text: replace anonymousId with displayName
        const replaceAnon = (str: string) =>
          str.replace(new RegExp(item.anonymousId, "g"), displayName);

        strengths = replaceAnon(strengths);
        improvements = replaceAnon(improvements);
        actionPlan = replaceAnon(actionPlan);
        fullComment = replaceAnon(fullComment);

        // Enforce unified 3-bullet format from skill `nhan-xet-hoc-sinh` in formattedFullComment (WITHOUT student name header)
        const cleanStrengths = strengths
          .replace(/^[-•*]\s*\*\*Điểm mạnh(?: của học viên)?:\*\*\s*/i, "")
          .trim();
        const cleanImprovements = improvements
          .replace(/^[-•*]\s*\*\*Điểm cần cải thiện:\*\*\s*/i, "")
          .trim();
        const cleanActionPlan = actionPlan
          .replace(/^[-•*]\s*\*\*(?:Lời khuyên|Hướng rèn luyện):\*\*\s*/i, "")
          .trim();

        // Strip any leading **[Tên học sinh]** line before the first bullet if AI included one
        fullComment = fullComment.replace(
          /^\s*\*\*[^*\n]+\*\*\s*\r?\n+(?=\s*[-•*]\s*\*\*Điểm mạnh)/i,
          ""
        );

        if (
          typeof getQuickTags === "function" &&
          !fullComment.includes("- **Điểm mạnh của học viên:**")
        ) {
          fullComment = [
            `- **Điểm mạnh của học viên:** ${cleanStrengths}`,
            "",
            `- **Điểm cần cải thiện:** ${cleanImprovements}`,
            "",
            `- **Lời khuyên:** ${cleanActionPlan}`,
          ].join("\n");
        }

        // R15-02 Guardrail: Re-verify student active status, attendance, and version/content snapshot in SQLite
        const latestDbStudent =
          typeof studentRepo?.findOne === "function"
            ? studentRepo.findOne(student.studentId, normalizedClassId)
            : undefined;
        const latestDbRecord =
          typeof sessionFeedbackRepo?.findOne === "function"
            ? sessionFeedbackRepo.findOne(normalizedClassId, normalizedSessionId, student.studentId)
            : undefined;
        const latestMeta = parseVersionMetaSafe(latestDbRecord?.versionMetaJson);
        const snap = item.initialSnapshot;

        const supersededByNewerAiCall =
          (CommentGenerator.latestStudentCallSeq.get(item.scopeKey) || 0) > callSeq;
        const studentBecameInactive = Boolean(latestDbStudent && latestDbStudent.isActive !== 1);
        const expectedRowVerMismatch =
          typeof student.expectedRowVer === "number" &&
          Number.isFinite(student.expectedRowVer) &&
          student.expectedRowVer >= 0 &&
          latestMeta.rowVer !== student.expectedRowVer;

        const recordChangedDuringAi = snap.hadExistingRecord
          ? !latestDbRecord ||
            latestMeta.rowVer !== snap.rowVer ||
            (latestDbRecord.versionMetaJson ?? "") !== snap.versionMetaJson ||
            (latestDbRecord.attendanceStatus ?? "") !== snap.attendanceStatus ||
            (latestDbRecord.quickTagsJson ?? "[]") !== snap.quickTagsJson ||
            (latestDbRecord.teacherNote ?? "") !== snap.teacherNote ||
            (latestDbRecord.strengths ?? "") !== snap.strengths ||
            (latestDbRecord.improvements ?? "") !== snap.improvements ||
            (latestDbRecord.actionPlan ?? "") !== snap.actionPlan ||
            (latestDbRecord.finalText ?? "") !== snap.finalText ||
            (latestDbRecord.status ?? "") !== snap.status ||
            (latestDbRecord.contentHash ?? "") !== snap.contentHash
          : Boolean(latestDbRecord);

        if (
          supersededByNewerAiCall ||
          studentBecameInactive ||
          expectedRowVerMismatch ||
          recordChangedDuringAi
        ) {
          results.push({
            studentId: student.studentId,
            fullName: student.fullName,
            status: ((latestDbRecord?.status as any) || "DRAFT") as any,
            strengths: latestDbRecord?.strengths ?? "",
            improvements: latestDbRecord?.improvements ?? "",
            actionPlan: latestDbRecord?.actionPlan ?? "",
            formattedFullComment: latestDbRecord?.finalText ?? "",
            staleIgnored: true,
            versionMeta: latestMeta,
            errorMessage: `Dữ liệu của học viên '${studentName}' đã được cập nhật trong lúc chờ AI. Giữ nguyên bản chỉnh sửa mới nhất.`,
          });
          continue;
        }

        const nextFields = { ...latestMeta.fields };
        for (const f of ["strengths", "improvements", "actionPlan", "finalText"]) {
          const curF = nextFields[f] || { ver: 0, cid: "", rev: 0 };
          nextFields[f] = {
            ver: (curF.ver || 0) + 1,
            cid: curF.cid || "",
            rev: curF.rev || 0,
          };
        }
        const nextMeta = {
          rowVer: (latestMeta.rowVer || 0) + 1,
          fields: nextFields,
        };

        const generated: GeneratedCommentResult = {
          studentId: student.studentId,
          fullName: student.fullName,
          status: "DRAFT",
          strengths,
          improvements,
          actionPlan,
          formattedFullComment: fullComment,
          versionMeta: nextMeta,
        };

        // Persist draft to SQLite without overwriting existing attendance, quickTags, or teacherNote with stale inputs
        sessionFeedbackRepo.upsert({
          classId: normalizedClassId,
          sessionId: normalizedSessionId,
          studentId: student.studentId,
          attendanceStatus:
            (latestDbRecord?.attendanceStatus as any) || student.attendanceStatus || "PRESENT",
          quickTagsJson:
            latestDbRecord?.quickTagsJson &&
            (latestDbRecord.quickTagsJson.trim() !== "[]" || Boolean(latestMeta.fields?.quickTags))
              ? latestDbRecord.quickTagsJson
              : JSON.stringify(item.regularQuickTags),
          teacherNote: latestDbRecord?.teacherNote ?? (student.teacherNote || ""),
          strengths,
          improvements,
          actionPlan,
          finalText: fullComment,
          status: "DRAFT",
          versionMetaJson: JSON.stringify(nextMeta),
        });

        results.push(generated);
      }
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // If AI call failed, mark valid candidates as FAILED with error message
      for (const item of validCandidates) {
        results.push({
          studentId: item.input.studentId,
          fullName: item.input.fullName,
          status: "FAILED",
          strengths: "",
          improvements: "",
          actionPlan: "",
          formattedFullComment: "",
          errorMessage: errMsg,
        });
      }
    }

    return results;
  }
}
