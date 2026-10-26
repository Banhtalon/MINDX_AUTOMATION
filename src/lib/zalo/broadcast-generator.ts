import {
  getZaloTemplates,
  renderZaloBroadcast,
  findLessonInSyllabus,
} from "../db/json-config";

export interface ZaloBroadcastOptions {
  classCode: string;
  sessionNumber: number;
  templateId?: string;
  sessionDate?: string;
  attendanceCount?: string;
  generalFeedback?: string;
  topicOverride?: string;
  keyKnowledgeOverride?: string[];
  keyNotesOverride?: string[];
  nextSessionTime?: string;
  nextSessionTopicOverride?: string;
  homeworkBriefOverride?: string;
  courseDriveLink?: string;
  homeworkDeadline?: string;
  teacherName?: string;
  supportContact?: string;
  btvnUnsubmittedNames?: string[];
  hasBtvnImage?: boolean;
}

export interface ZaloBroadcastResult {
  templateId: string;
  templateName: string;
  renderedText: string;
  variables: Record<string, string>;
}

export class ZaloBroadcastGenerator {
  /**
   * Rút gọn họ tên học sinh theo quy tắc Tên đệm + Tên (bỏ họ đầu nếu tên >= 3 chữ).
   * Ví dụ: "Nguyễn Thành Phong" -> "Thành Phong", "Đức Tuấn" -> "Đức Tuấn".
   */
  public static formatShortStudentName(fullName: string): string {
    const words = String(fullName || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (words.length >= 3) {
      return words.slice(1).join(" ");
    }
    return words.join(" ");
  }

  /**
   * Nguyên tắc Tịnh tiến Thời gian: Cộng thêm số ngày (mặc định +7 ngày) từ mốc dd/mm/yyyy
   * và trả về Thứ trong tuần kèm ngày dd/mm/yyyy.
   */
  public static addDaysToDdMmYyyy(
    dateStr?: string,
    daysToAdd = 7
  ): { dateFormatted: string; weekdayLabel: string; fullLabel: string } | null {
    if (!dateStr) return null;
    const m = String(dateStr)
      .trim()
      .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    if (Number.isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + daysToAdd);

    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = String(d.getFullYear());
    const dateFormatted = `${dd}/${mm}/${yyyy}`;

    const weekdays = [
      "Chủ nhật",
      "Thứ Hai",
      "Thứ Ba",
      "Thứ Tư",
      "Thứ Năm",
      "Thứ Sáu",
      "Thứ Bảy",
    ];
    const weekdayLabel = weekdays[d.getDay()] || "";
    return {
      dateFormatted,
      weekdayLabel,
      fullLabel: `${weekdayLabel}, ngày ${dateFormatted}`,
    };
  }

  public static buildCourseKeyNotes(
    classCode: string,
    keyKnowledge?: string[]
  ): string[] {
    const upperCode = (classCode || "").toUpperCase();
    const isGameMakerCourse = /\b(GA|GB|GI)\d*/i.test(upperCode);

    if (isGameMakerCourse) {
      return [
        "- Trình bày được mối liên hệ giữa giao diện, nhân vật và luật chơi trong vòng lặp chơi chính.",
        "- Thực hiện lập trình ổn định các cơ chế điều khiển và chức năng cốt lõi của sản phẩm.",
        "- Thực hiện kiểm thử từng chức năng sau khi hoàn thành để đảm bảo chương trình vận hành mượt mà.",
      ];
    }

    if (keyKnowledge && keyKnowledge.length > 0) {
      const cleanFirst = keyKnowledge[0].replace(/^[-•+]\s*/, "").trim();
      return [
        `- Trình bày được ý nghĩa và vận dụng kiến thức trọng tâm: ${cleanFirst}`,
        "- Thực hiện viết code/xây dựng sản phẩm và kiểm thử từng chức năng để đảm bảo chương trình vận hành ổn định.",
        "- Thực hiện hoàn thiện dự án cá nhân và rèn luyện tư duy giải quyết vấn đề.",
      ];
    }

    return [
      "- Trình bày được các khái niệm và cấu trúc lệnh trọng tâm đã học trong buổi.",
      "- Thực hiện kiểm thử từng chức năng của sản phẩm để đảm bảo chương trình vận hành ổn định.",
      "- Thực hiện phát triển thêm các tính năng mở rộng cho dự án.",
    ];
  }

  /**
   * Xây dựng Phần 2 (Nhận xét tình trạng làm BTVN) - CHỈ xuất khi có tải ảnh BTVN.
   */
  public static buildBtvnPart2(unsubmittedRawNames: string[]): string {
    const shortNames = unsubmittedRawNames
      .map((n) => this.formatShortStudentName(n))
      .filter(Boolean);

    if (shortNames.length === 0) {
      return [
        "Em xin phép cập nhật tình trạng làm bài của các con: Cả lớp đã hoàn thành **100% bài tập về nhà** đầy đủ và đúng hạn, rất đáng khen ngợi!",
        "Phụ huynh tiếp tục khích lệ các con duy trì tinh thần tự giác ôn tập bài cũ để chuẩn bị tốt cho các nội dung học tập ở buổi tiếp theo.",
        "Em xin cảm ơn Quý phụ huynh!",
      ].join("\n");
    }

    return [
      `Em xin phép cập nhật tình trạng làm bài của các con. Những bạn sau **chưa hoàn thành** bài cần bổ sung gấp: *${shortNames.join(", ")}*`,
      "Phụ huynh nhắc nhở các con hoàn thành đầy đủ bài tập và ôn tập bài cũ thật kỹ để củng cố kiến thức, chuẩn bị tốt cho các nội dung học tập ở buổi tiếp theo.",
      "Em xin cảm ơn Quý phụ huynh!",
    ].join("\n");
  }

  /**
   * Generates standard Zalo broadcast announcement for the entire class.
   * Auto-pulls syllabus lesson details based on classCode prefix and sessionNumber.
   */
  public static generate(options: ZaloBroadcastOptions): ZaloBroadcastResult {
    const templates = getZaloTemplates();
    const templateId = options.templateId || "standard_session_broadcast";
    const template = templates.find((t) => t.id === templateId) || templates[0];

    // Try finding syllabus data for current session and next session
    const syllabusLesson = findLessonInSyllabus(options.classCode, options.sessionNumber);
    const nextSyllabusLesson = findLessonInSyllabus(options.classCode, options.sessionNumber + 1);

    const lessonTopic = (
      options.topicOverride ||
      syllabusLesson?.topic ||
      `Buổi ${options.sessionNumber}`
    )
      .replace(/^(?:BÀI|BUỔI)\s+\d+\s*:\s*/i, "")
      .trim()
      .toUpperCase();

    const rawKnowledgeList =
      options.keyKnowledgeOverride && options.keyKnowledgeOverride.length > 0
        ? options.keyKnowledgeOverride
        : syllabusLesson?.keyKnowledge || [
            "Tìm hiểu và thực hành các kiến thức trọng tâm của buổi học.",
          ];
    const keyKnowledgeList = rawKnowledgeList.map((line) => {
      const trimmed = String(line || "").trim();
      return /^[-•*]/.test(trimmed) ? trimmed.replace(/^[•*]\s*/, "- ") : `- ${trimmed}`;
    });
    const keyKnowledgeSummary = keyKnowledgeList.join("\n");

    const rawKeyNotesList =
      options.keyNotesOverride && options.keyNotesOverride.length > 0
        ? options.keyNotesOverride
        : this.buildCourseKeyNotes(options.classCode, rawKnowledgeList);
    const keyNotesList = rawKeyNotesList.map((line) => {
      const trimmed = String(line || "").trim();
      return /^[-•*]/.test(trimmed) ? trimmed.replace(/^[•*]\s*/, "- ") : `- ${trimmed}`;
    });
    const keyNotesSummary = keyNotesList.join("\n");

    const nextSessionNum = options.sessionNumber + 1;
    const nextSessionTopic = (
      options.nextSessionTopicOverride ||
      nextSyllabusLesson?.topic ||
      `NỘI DUNG BUỔI ${nextSessionNum}`
    )
      .replace(/^(?:BÀI|BUỔI)\s+\d+\s*:\s*/i, "")
      .trim()
      .toUpperCase();

    const defaultDeniseHomework = [
      "+ 10 câu hỏi trắc nghiệm.",
      "+ 2 bài thực hành (làm theo yêu cầu đề bài).",
    ].join("\n");

    const rawCustomHw = (options.homeworkBriefOverride || syllabusLesson?.homeworkBrief || "").trim();
    const homeworkBrief = rawCustomHw
      ? `${defaultDeniseHomework}\n+ ${rawCustomHw.replace(/^[+-]\s*/, "")}`
      : defaultDeniseHomework;

    const plus7 = this.addDaysToDdMmYyyy(options.sessionDate, 7);

    const variables: Record<string, string> = {
      className: options.classCode,
      sessionNumber: String(options.sessionNumber),
      sessionDate: options.sessionDate || "chưa xác nhận ngày học",
      attendanceCount:
        options.attendanceCount ||
        "(đi học đầy đủ) ổn định đầu giờ tốt.",
      generalFeedback:
        options.generalFeedback ||
        "Các con nhớ bài tốt, tự giác trong quá trình học và năng nổ phát biểu, xây dựng bài trong buổi học.",
      sessionTopic: lessonTopic,
      lessonTopic,
      keyKnowledge: keyKnowledgeSummary,
      keyKnowledgeSummary,
      keyNotes: keyNotesSummary,
      nextSessionTime:
        options.nextSessionTime ||
        plus7?.fullLabel ||
        "Theo lịch học cố định của lớp (chưa xác nhận ngày cụ thể)",
      nextSessionNumber: String(nextSessionNum),
      nextSessionTopic,
      homeworkSummary: homeworkBrief,
      homeworkBrief,
      courseDriveLink: options.courseDriveLink || "",
      homeworkDeadline:
        options.homeworkDeadline ||
        plus7?.fullLabel ||
        "Trước buổi học kế tiếp",
      teacherName: options.teacherName || "Thầy/Cô MindX",
      supportContact: options.supportContact || "Kênh hỗ trợ lớp học MindX",
    };

    let renderedText = renderZaloBroadcast(template.id, variables);
    if (options.hasBtvnImage) {
      const part2 = this.buildBtvnPart2(options.btvnUnsubmittedNames || []);
      renderedText = `${renderedText}\n\n${part2}`;
    }

    return {
      templateId: template.id,
      templateName: template.name,
      renderedText,
      variables,
    };
  }
}
