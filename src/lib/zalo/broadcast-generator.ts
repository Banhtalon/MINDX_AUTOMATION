import {
  getZaloTemplates,
  renderZaloBroadcast,
  findLessonInSyllabus,
} from "../db/json-config";
import {
  formatShortZaloName,
  addDaysToDdMmYyyyDetailed,
  buildCourseKeyNotes,
  buildBtvnPart2,
  buildAutoZaloBroadcastText,
  DEFAULT_STANDARD_ZALO_TEMPLATE,
} from "./zalo-summary";
import { formatCellForExport as _preloadExportFormatter } from "../report-card/export-cell-formatter";

void _preloadExportFormatter;

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
  public static formatShortStudentName(fullName: string): string {
    return formatShortZaloName(fullName);
  }

  public static addDaysToDdMmYyyy(
    dateStr?: string,
    daysToAdd = 7
  ): { dateFormatted: string; weekdayLabel: string; fullLabel: string } | null {
    return addDaysToDdMmYyyyDetailed(dateStr, daysToAdd);
  }

  public static buildCourseKeyNotes(
    classCode: string,
    keyKnowledge?: string[]
  ): string[] {
    return buildCourseKeyNotes(classCode, keyKnowledge);
  }

  public static buildBtvnPart2(unsubmittedRawNames: string[]): string {
    return buildBtvnPart2(unsubmittedRawNames);
  }

  /**
   * Generates standard Zalo broadcast announcement for the entire class.
   * Delegates to the unified `zalo-summary` engine while preserving template variable compatibility.
   */
  public static generate(options: ZaloBroadcastOptions): ZaloBroadcastResult {
    const templates = getZaloTemplates();
    const templateId = options.templateId || "standard_session_broadcast";
    const template = templates.find((t) => t.id === templateId) || templates[0];

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
        : buildCourseKeyNotes(options.classCode, rawKnowledgeList);
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

    const plus7 = addDaysToDdMmYyyyDetailed(options.sessionDate, 7);

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

    const part2Text = options.hasBtvnImage
      ? buildBtvnPart2(options.btvnUnsubmittedNames || [])
      : "";

    const isDefaultStandardTemplate =
      (!options.templateId || options.templateId === "standard_session_broadcast") &&
      (!template || template.template === DEFAULT_STANDARD_ZALO_TEMPLATE);

    const renderedText = isDefaultStandardTemplate
      ? buildAutoZaloBroadcastText({
          classCode: options.classCode,
          sessionNumber: options.sessionNumber,
          sessionDate: options.sessionDate || "chưa xác nhận ngày học",
          attendanceCountOverride: variables.attendanceCount,
          generalFeedbackOverride: variables.generalFeedback,
          currentTopic: lessonTopic,
          currentKeyKnowledge: rawKnowledgeList,
          currentHomeworkBrief: rawCustomHw,
          keyNotesOverride: rawKeyNotesList,
          nextSessionTimeOverride: variables.nextSessionTime,
          nextSessionTopicOverride: nextSessionTopic,
          homeworkDeadlineOverride: variables.homeworkDeadline,
          part2Text,
        })
      : part2Text
      ? `${renderZaloBroadcast(template.id, variables)}\n\n${part2Text}`
      : renderZaloBroadcast(template.id, variables);

    return {
      templateId: template.id,
      templateName: template.name,
      renderedText,
      variables,
    };
  }
}
