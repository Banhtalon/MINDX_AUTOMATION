/**
 * MINDX AUTOMATION BOT - VIETNAMESE NAME NORMALIZATION & SAFE FOLDER-TO-STUDENT-ID MATCHING
 * Phase 6 (TASK-6.1): Suggests mappings between local SPCK subfolders and LMS studentId records.
 * Enforces mandatory manual confirmation whenever a class has duplicate names, collisions, or matchScore < 1.0.
 */

export interface StudentCandidate {
  studentId: string;
  fullName: string;
  isActive?: number;
}

export interface LocalStudentFolderInput {
  folderName: string;
  folderPath: string;
}

export interface RankedCandidateMatch {
  studentId: string;
  fullName: string;
  matchScore: number;
}

export interface FolderStudentMatchResult {
  folderName: string;
  folderPath: string;
  normalizedFolderName: string;
  suggestedStudentId: string;
  suggestedStudentName: string;
  matchScore: number;
  hasDuplicateNameInClass: boolean;
  hasFolderCollision: boolean;
  hasTiedCandidates: boolean;
  requiresManualConfirmation: boolean;
  autoConfirmed: boolean;
  warningReasons: string[];
  candidates: RankedCandidateMatch[];
}

/**
 * Strips Vietnamese diacritics, converts đ/Đ -> d, lowercases, and normalizes whitespace.
 */
export function stripVietnameseDiacritics(input: string): string {
  if (!input || typeof input !== "string") return "";
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

/**
 * Normalizes a person/folder name into canonical ASCII tokens separated by single spaces.
 */
export function normalizeVietnameseName(input: string): string {
  const ascii = stripVietnameseDiacritics(input);
  return ascii
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts candidate name variants from a folder name.
 * E.g. "01_Ngo_Khoi_Nguyen" -> exact normalized "01 ngo khoi nguyen", stripped prefix "ngo khoi nguyen".
 */
export function extractFolderNameVariants(folderName: string): {
  strictNormalized: string;
  cleanedVariant: string;
} {
  const strictNormalized = normalizeVietnameseName(folderName);
  const cleanedVariant = strictNormalized
    .replace(/^(?:spck|bai\s*cuoi\s*khoa|final\s*project|project|hs|hv|st|stu)\s+/i, "")
    .replace(/^\d{1,3}\s+/, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    strictNormalized,
    cleanedVariant: cleanedVariant || strictNormalized,
  };
}

/**
 * Computes Levenshtein edit distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

/**
 * Computes similarity score in [0.0, 1.0] between a local folder name and a student's fullName.
 * Returns 1.0 ONLY when the strict normalized folder name equals the normalized student fullName.
 * Any cleaned/partial/fuzzy match is strictly capped at <= 0.95 so teacher confirmation is enforced.
 */
export function calculateNameSimilarity(folderName: string, studentFullName: string): number {
  const normStudent = normalizeVietnameseName(studentFullName);
  const { strictNormalized, cleanedVariant } = extractFolderNameVariants(folderName);

  if (!normStudent || !strictNormalized) {
    return 0;
  }

  // 100% Exact Normalized Match
  if (strictNormalized === normStudent) {
    return 1.0;
  }

  // Cleaned prefix match (e.g., "01_Ngo Khoi Nguyen" vs "Ngô Khôi Nguyên") -> high confidence (0.95) but still < 1.0
  if (cleanedVariant === normStudent) {
    return 0.95;
  }

  const folderTokens = cleanedVariant.split(" ").filter(Boolean);
  const studentTokens = normStudent.split(" ").filter(Boolean);

  if (folderTokens.length === 0 || studentTokens.length === 0) {
    return 0;
  }

  // Check if all student tokens appear in order inside folderTokens
  let matchedStudentTokens = 0;
  for (const st of studentTokens) {
    if (folderTokens.includes(st)) {
      matchedStudentTokens++;
    }
  }

  const studentGivenName = studentTokens[studentTokens.length - 1];
  const folderLastToken = folderTokens[folderTokens.length - 1];
  const givenNameMatches =
    studentGivenName === folderLastToken || folderTokens.includes(studentGivenName);

  const tokenRecall = matchedStudentTokens / studentTokens.length;
  const tokenPrecision = matchedStudentTokens / folderTokens.length;
  const tokenF1 =
    tokenRecall + tokenPrecision > 0
      ? (2 * tokenRecall * tokenPrecision) / (tokenRecall + tokenPrecision)
      : 0;

  const maxLen = Math.max(cleanedVariant.length, normStudent.length);
  const editSimilarity =
    maxLen > 0 ? 1 - levenshteinDistance(cleanedVariant, normStudent) / maxLen : 0;

  let combined = tokenF1 * 0.65 + editSimilarity * 0.35;
  if (givenNameMatches && matchedStudentTokens >= Math.min(2, studentTokens.length)) {
    combined = Math.max(combined, 0.75 * tokenRecall + 0.2 * editSimilarity);
  } else if (!givenNameMatches) {
    combined *= 0.6;
  }

  const rounded = Math.round(Math.min(0.94, Math.max(0, combined)) * 100) / 100;
  return rounded;
}

/**
 * Matches a list of local SPCK subfolders against a class's LMS students.
 * Enforces mandatory manual confirmation on duplicate names, collisions, ties, or matchScore < 1.0.
 */
export function matchFoldersToStudents(
  folders: LocalStudentFolderInput[],
  students: StudentCandidate[]
): FolderStudentMatchResult[] {
  // 1. Detect duplicate normalized fullNames or duplicate given names within the class
  const normNameCount = new Map<string, number>();
  const givenNameCount = new Map<string, number>();

  for (const stu of students) {
    const norm = normalizeVietnameseName(stu.fullName);
    if (!norm) continue;
    normNameCount.set(norm, (normNameCount.get(norm) || 0) + 1);
    const tokens = norm.split(" ").filter(Boolean);
    const given = tokens[tokens.length - 1] || "";
    if (given) {
      givenNameCount.set(given, (givenNameCount.get(given) || 0) + 1);
    }
  }

  // 2. Score each folder against all students
  const preliminary = folders.map((folder) => {
    const normalizedFolderName = normalizeVietnameseName(folder.folderName);
    const ranked: RankedCandidateMatch[] = students
      .map((stu) => ({
        studentId: stu.studentId,
        fullName: stu.fullName,
        matchScore: calculateNameSimilarity(folder.folderName, stu.fullName),
      }))
      .sort((a, b) => {
        if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
        return a.studentId.localeCompare(b.studentId);
      });

    const top = ranked[0];
    const second = ranked[1];
    const hasAcceptableSuggestion = Boolean(top && top.matchScore >= 0.4);
    const suggestedStudentId = hasAcceptableSuggestion ? top.studentId : "";
    const suggestedStudentName = hasAcceptableSuggestion ? top.fullName : "";
    const matchScore = hasAcceptableSuggestion ? top.matchScore : 0;

    const hasTiedCandidates = Boolean(
      hasAcceptableSuggestion &&
        second &&
        Math.abs(top.matchScore - second.matchScore) < 0.001 &&
        top.matchScore > 0
    );

    const suggestedNorm = suggestedStudentName ? normalizeVietnameseName(suggestedStudentName) : "";
    const suggestedTokens = suggestedNorm ? suggestedNorm.split(" ").filter(Boolean) : [];
    const suggestedGiven = suggestedTokens[suggestedTokens.length - 1] || "";

    // Duplicate full name in class (or duplicate given name when folder only has 1-2 tokens)
    const hasDuplicateFullName = Boolean(
      suggestedNorm && (normNameCount.get(suggestedNorm) || 0) > 1
    );
    const folderTokenCount = normalizedFolderName.split(" ").filter(Boolean).length;
    const hasDuplicateShortName = Boolean(
      folderTokenCount <= 2 && suggestedGiven && (givenNameCount.get(suggestedGiven) || 0) > 1
    );
    const hasDuplicateNameInClass = hasDuplicateFullName || hasDuplicateShortName;

    return {
      folder,
      normalizedFolderName,
      ranked,
      suggestedStudentId,
      suggestedStudentName,
      matchScore,
      hasTiedCandidates,
      hasDuplicateNameInClass,
    };
  });

  // 3. Detect folder collisions (two or more folders pointing to the same suggestedStudentId)
  const suggestedIdCount = new Map<string, number>();
  for (const item of preliminary) {
    if (item.suggestedStudentId) {
      suggestedIdCount.set(
        item.suggestedStudentId,
        (suggestedIdCount.get(item.suggestedStudentId) || 0) + 1
      );
    }
  }

  // 4. Build final results with explicit warning reasons and confirmation locks
  return preliminary.map((item) => {
    const hasFolderCollision = Boolean(
      item.suggestedStudentId && (suggestedIdCount.get(item.suggestedStudentId) || 0) > 1
    );

    const warningReasons: string[] = [];
    if (!item.suggestedStudentId) {
      warningReasons.push(
        "Không tìm thấy học viên khớp tên đủ tin cậy (< 40%). Bắt buộc chọn studentId thủ công."
      );
    } else if (item.matchScore < 1.0) {
      warningReasons.push(
        `Độ khớp tên đạt ${Math.round(item.matchScore * 100)}% (< 100%). Bắt buộc giáo viên xác nhận studentId.`
      );
    }

    if (item.hasDuplicateNameInClass) {
      warningReasons.push(
        `Lớp có học viên trùng tên với '${item.suggestedStudentName}'. Bắt buộc kiểm tra và xác nhận đúng mã studentId.`
      );
    }

    if (item.hasTiedCandidates) {
      warningReasons.push(
        "Có nhiều học viên đạt cùng điểm tương đồng tên cao nhất. Bắt buộc chọn xác nhận đúng studentId."
      );
    }

    if (hasFolderCollision) {
      warningReasons.push(
        `Có nhiều thư mục con cùng khớp vào học viên '${item.suggestedStudentName}' (${item.suggestedStudentId}). Bắt buộc phân định thủ công.`
      );
    }

    const requiresManualConfirmation =
      !item.suggestedStudentId ||
      item.matchScore < 1.0 ||
      item.hasDuplicateNameInClass ||
      item.hasTiedCandidates ||
      hasFolderCollision;

    const autoConfirmed =
      Boolean(item.suggestedStudentId) &&
      item.matchScore === 1.0 &&
      !requiresManualConfirmation;

    return {
      folderName: item.folder.folderName,
      folderPath: item.folder.folderPath,
      normalizedFolderName: item.normalizedFolderName,
      suggestedStudentId: item.suggestedStudentId,
      suggestedStudentName: item.suggestedStudentName,
      matchScore: item.matchScore,
      hasDuplicateNameInClass: item.hasDuplicateNameInClass,
      hasFolderCollision,
      hasTiedCandidates: item.hasTiedCandidates,
      requiresManualConfirmation,
      autoConfirmed,
      warningReasons,
      candidates: item.ranked,
    };
  });
}
