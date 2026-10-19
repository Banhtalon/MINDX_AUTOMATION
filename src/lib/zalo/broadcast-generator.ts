import {
  getZaloTemplates,
  renderZaloBroadcast,
  findLessonInSyllabus,
  type ZaloTemplate,
} from "../db/json-config";

export interface ZaloBroadcastOptions {
  classCode: string;
  sessionNumber: number;
  templateId?: string;
  topicOverride?: string;
  keyKnowledgeOverride?: string[];
  homeworkBriefOverride?: string;
  teacherName?: string;
  supportContact?: string;
}

export interface ZaloBroadcastResult {
  templateId: string;
  templateName: string;
  renderedText: string;
  variables: Record<string, string>;
}

export class ZaloBroadcastGenerator {
  /**
   * Generates standard Zalo broadcast announcement for the entire class.
   * Auto-pulls syllabus lesson details based on classCode prefix and sessionNumber.
   */
  public static generate(options: ZaloBroadcastOptions): ZaloBroadcastResult {
    const templates = getZaloTemplates();
    const templateId = options.templateId || "general_session_summary";
    const template = templates.find((t) => t.id === templateId) || templates[0];

    // Try finding syllabus data for this class
    const syllabusLesson = findLessonInSyllabus(options.classCode, options.sessionNumber);

    const lessonTopic = options.topicOverride || syllabusLesson?.topic || `Buổi ${options.sessionNumber}`;
    const keyKnowledgeList =
      options.keyKnowledgeOverride ||
      syllabusLesson?.keyKnowledge || [
        "Hoàn thành các kiến thức trọng tâm của buổi học",
      ];
    const keyKnowledgeSummary = keyKnowledgeList.map((k: string) => `• ${k}`).join("\n");

    const homeworkBrief =
      options.homeworkBriefOverride ||
      syllabusLesson?.homeworkBrief ||
      "Hoàn thành bài tập về nhà trên hệ thống MindX LMS trước buổi học tiếp theo.";

    const variables: Record<string, string> = {
      className: options.classCode,
      sessionNumber: String(options.sessionNumber),
      sessionTopic: lessonTopic,
      lessonTopic,
      keyKnowledge: keyKnowledgeSummary,
      keyKnowledgeSummary,
      generalFeedback: "Các con đi học đầy đủ, tích cực tham gia thảo luận và hoàn thành bài tập thực hành.",
      homeworkSummary: homeworkBrief,
      homeworkBrief,
      teacherName: options.teacherName || "Thầy/Cô MindX",
      supportContact: options.supportContact || "Kênh hỗ trợ lớp học MindX",
    };

    const renderedText = renderZaloBroadcast(template.id, variables);

    return {
      templateId: template.id,
      templateName: template.name,
      renderedText,
      variables,
    };
  }
}
