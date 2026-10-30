/**
 * MINDX AUTOMATION BOT — SHARED DOMAIN TYPES (v3.4.0 S7.1)
 */

export interface CriterionGradeItem {
  criterionId: string;
  criterionName: string;
  earnedPoints: number;
  maxPoints: number;
  evidenceSnippet: string;
  deductionReason: string;
}

export interface GradingCriterion {
  criterionId: string;
  name: string;
  maxPoints: number;
  description: string;
  expectedSnippetOrConcept: string;
}

export interface GradingRubric {
  rubricId: string;
  courseCode: string;
  sessionNumber: number;
  assignmentTitle: string;
  assignmentPrompt: string;
  maxTotalScore: number;
  criteria: GradingCriterion[];
}

export interface SubmissionRowItem {
  submissionId: string;
  classId: string;
  sessionId: string;
  studentId: string;
  fullName: string;
  isActive?: boolean;
  originalFileName?: string;
  localFilePath?: string;
  fileHash?: string;
  parseStatus: "PENDING" | "PARSED" | "PARSE_ERROR";
  parseErrorReason?: string | null;
  criteriaGrades: CriterionGradeItem[];
  calculatedScore: number;
  teacherOverrideScore?: number | null;
  decision: "GRADE" | "REDO";
  feedbackHtml: string;
  contentHash?: string;
  status:
    | "PENDING"
    | "ANALYZING"
    | "WAITING_APPROVAL"
    | "APPROVED"
    | "SAVING"
    | "VERIFIED"
    | "FAILED";
  verifiedAt?: string | null;
  errorMessage?: string | null;
  codePreview?: string;
  subjectType?: string;
}
