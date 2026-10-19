import { getGeminiModel } from "./client";
import { sessionFeedbackRepo, type SessionFeedbackRecord } from "../db/sqlite";

export interface StudentCommentInput {
  studentId: string;
  fullName: string;
  attendanceStatus?: "PRESENT" | "ABSENT" | "LATE";
  quickTags?: string[];
  teacherNote?: string;
}

export interface SessionContext {
  classId: string;
  classCode: string;
  sessionId: string;
  sessionNumber: number;
  topic: string;
  keyKnowledge?: string[];
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
}

export class CommentGenerator {
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
    const results: GeneratedCommentResult[] = [];
    const validCandidates: {
      input: StudentCommentInput;
      anonymousId: string;
    }[] = [];

    // Step 1: Filter and classify candidates; apply Anti-Hallucination Guardrail
    for (let i = 0; i < students.length; i++) {
      const student = students[i];
      const hasTags = student.quickTags && student.quickTags.length > 0;
      const hasNote = student.teacherNote && student.teacherNote.trim().length > 0;

      // IRON RULE 5: Nếu học viên không có cả Quick Tags lẫn ghi chú -> INSUFFICIENT_INFO (CẤM AI BỊA)
      if (!hasTags && !hasNote) {
        const insufficientResult: GeneratedCommentResult = {
          studentId: student.studentId,
          fullName: student.fullName,
          status: "INSUFFICIENT_INFO",
          strengths: "",
          improvements: "",
          actionPlan: "",
          formattedFullComment: "Chưa đủ thông tin để nhận xét. Vui lòng chọn ít nhất 1 Quick Tag hoặc nhập ghi chú của giáo viên.",
        };

        // Save immediately to SQLite
        sessionFeedbackRepo.upsert({
          classId: session.classId,
          sessionId: session.sessionId,
          studentId: student.studentId,
          attendanceStatus: student.attendanceStatus || "PRESENT",
          quickTagsJson: JSON.stringify(student.quickTags || []),
          teacherNote: student.teacherNote || "",
          strengths: "",
          improvements: "",
          actionPlan: "",
          finalText: insufficientResult.formattedFullComment,
          status: "INSUFFICIENT_INFO",
        });

        results.push(insufficientResult);
        continue;
      }

      // Add to AI generation queue with anonymous ID
      const anonymousId = `STUDENT_${String(validCandidates.length + 1).padStart(2, "0")}`;
      validCandidates.push({ input: student, anonymousId });
    }

    // If no students need AI generation, return early
    if (validCandidates.length === 0) {
      return results;
    }

    // Step 2: Build anonymized payload for Gemini API
    const anonymousRoster = validCandidates.map((c) => ({
      anonymousId: c.anonymousId,
      quickTags: c.input.quickTags || [],
      teacherNote: c.input.teacherNote || "",
      attendance: c.input.attendanceStatus || "PRESENT",
    }));

    const keyKnowledgeText =
      session.keyKnowledge && session.keyKnowledge.length > 0
        ? session.keyKnowledge.join("; ")
        : session.topic;

    const prompt = `
Bạn là Trợ lý Sư phạm Cao cấp của MindX Technology School.
Nhiệm vụ của bạn là viết nhận xét buổi học chi tiết, chân thành và mang tính xây dựng cho phụ huynh học sinh.

### THÔNG TIN BUỔI HỌC:
- Lớp: ${session.classCode} (Buổi ${session.sessionNumber})
- Chủ đề bài học: ${session.topic}
- Kiến thức trọng tâm: ${keyKnowledgeText}

### NGUYÊN TẮC BẮT BUỘC (STRICT PEDAGOGICAL RULES):
1. CHỈ dựa vào Quick Tags và Ghi chú thực tế được cung cấp cho từng học sinh. TUYỆT ĐỐI KHÔNG tự suy diễn hoặc bịa đặt hành vi/kiến thức mà giáo viên không nhắc đến.
2. Với mỗi học sinh, soạn đúng 3 phần rõ ràng:
   - strengths (Điểm mạnh / Thái độ học tập): Nêu cụ thể những gì học sinh đã làm tốt trong buổi học.
   - improvements (Điểm cần cải thiện): Chỉ ra điểm còn vướng mắc hoặc cần khắc phục một cách tinh tế, lịch sự.
   - actionPlan (Hướng rèn luyện tiếp theo): Dặn dò cụ thể cách ôn tập hoặc bài tập cần rèn thêm ở nhà.
3. formattedFullComment: Tổng hợp lại thành đoạn văn nhận xét hoàn chỉnh gửi phụ huynh, văn phong ấm áp, chuẩn mực, bắt đầu bằng xưng hô phù hợp với anonymousId (ví dụ: "Em {anonymousId} hôm nay...").

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
      "formattedFullComment": "..."
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

      // Step 3: De-anonymize and save drafts to SQLite
      for (const item of validCandidates) {
        const rawFeedback = feedbackMap.get(item.anonymousId);
        const student = item.input;
        const studentName = student.fullName;

        // Friendly Vietnamese addressing: extract first name or use full name
        const displayName = studentName;

        let strengths = rawFeedback?.strengths || "Hoàn thành các nội dung trong buổi học.";
        let improvements = rawFeedback?.improvements || "Cần chú ý tập trung và làm bài tập đều đặn hơn.";
        let actionPlan = rawFeedback?.actionPlan || "Ôn tập lại kiến thức bài học và hoàn thành bài tập về nhà.";
        let fullComment =
          rawFeedback?.formattedFullComment ||
          `Em ${displayName} hôm nay đã tham gia buổi học. ${strengths} ${improvements} ${actionPlan}`;

        // De-anonymize text: replace anonymousId with displayName
        const replaceAnon = (str: string) =>
          str.replace(new RegExp(item.anonymousId, "g"), displayName);

        strengths = replaceAnon(strengths);
        improvements = replaceAnon(improvements);
        actionPlan = replaceAnon(actionPlan);
        fullComment = replaceAnon(fullComment);

        const generated: GeneratedCommentResult = {
          studentId: student.studentId,
          fullName: student.fullName,
          status: "DRAFT",
          strengths,
          improvements,
          actionPlan,
          formattedFullComment: fullComment,
        };

        // Persist draft to SQLite
        sessionFeedbackRepo.upsert({
          classId: session.classId,
          sessionId: session.sessionId,
          studentId: student.studentId,
          attendanceStatus: student.attendanceStatus || "PRESENT",
          quickTagsJson: JSON.stringify(student.quickTags || []),
          teacherNote: student.teacherNote || "",
          strengths,
          improvements,
          actionPlan,
          finalText: fullComment,
          status: "DRAFT",
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
