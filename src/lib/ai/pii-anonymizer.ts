/**
 * MINDX AUTOMATION BOT — SHARED STUDENT PII ANONYMIZER (v3.4.0 S7.3)
 * Single source of truth for anonymizing and de-anonymizing Vietnamese student names
 * before calling Gemini AI across all 5 AI generators:
 * - comment-generator.ts
 * - homework-grader.ts
 * - session14-course-summary.ts
 * - spck-comment.ts
 * - teaching-project-generator.ts
 *
 * Built on `src/lib/utils/vietnamese-match.ts`.
 * Handles:
 * - Full name (accented & unaccented)
 * - 2-word sub-phrases (Middle + Given, Family + Given, Family + Middle)
 * - 1-word given name (accented & unaccented)
 * - Joined/underscore/hyphen variants in code & filenames
 * - Duplicate names in the same class (longest match first, deterministic STUDENT_01, STUDENT_02...)
 * - Peer names (`STUDENT_PEER` / `PEER_STUDENT`)
 */

import {
  formatVietnameseCallName,
  stripVietnameseAccentsPreserveCase,
  stripVietnameseDiacritics,
} from "../utils/vietnamese-match";

export {
  formatVietnameseCallName as formatSpckStudentCallName,
  stripVietnameseAccentsPreserveCase as stripVietnameseAccents,
};

export interface PiiStudentEntry {
  studentId?: string;
  fullName: string;
  alias?: string;
  shortAlias?: string;
  callName?: string;
}

export interface PiiAnonymizeOptions {
  targetFullName?: string;
  targetToken?: string;
  targetCallName?: string;
  targetShortToken?: string;
  roster?: PiiStudentEntry[];
  peerNames?: string[];
  peerToken?: string;
  redactContactInfo?: boolean;
  redactSandboxTags?: boolean;
  matchJoinedFileNames?: boolean;
  matchAllNameTokens?: boolean;
  absorbLeadingFamilyTokens?: boolean;
}

export interface PiiAnonymizeResult {
  text: string;
  tokenMap: Record<string, string>;
}

export interface PiiDeanonymizeOptions {
  tokenMap?: Record<string, string>;
  fullToken?: string;
  shortToken?: string;
  fullName?: string;
  callName?: string;
  fallbackStudentTokenReplacement?: string;
}

export function escapeRegExp(str: string): string {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceWholePhrase(text: string, phrase: string, token: string): string {
  const trimmed = String(phrase || "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ");
  if (!trimmed) return text;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])${escapeRegExp(trimmed)}(?![\\p{L}\\p{N}_])`,
    "giu"
  );
  return text.replace(pattern, token);
}

/**
 * Core unified `anonymize` function for scrubbing student PII from text before sending to Gemini.
 */
export function anonymize(
  rawText: string,
  options: PiiAnonymizeOptions
): PiiAnonymizeResult {
  const tokenMap: Record<string, string> = {};
  if (!rawText) {
    return { text: "", tokenMap };
  }

  let output = String(rawText).normalize("NFC");

  if (options.redactSandboxTags) {
    output = output
      .replace(/<\/?\s*STUDENT_SPCK_SANDBOX\s*>/gi, "[REDACTED_SANDBOX_TAG]")
      .replace(/<\/?\s*STUDENT_SUBMISSION_SANDBOX\s*>/gi, "[REDACTED_SANDBOX_TAG]")
      .replace(/<\/?\s*student_submission\s*>/gi, "[REDACTED_SANDBOX_TAG]");
  }

  if (options.redactContactInfo) {
    output = output.replace(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      "[REDACTED_EMAIL]"
    );
    output = output.replace(
      /(?:\+?84|0)(?:\d[\s.-]?){8,10}\d/g,
      "[REDACTED_PHONE]"
    );
  }

  const peerToken = options.peerToken || "STUDENT_PEER";
  const entries: Array<{
    fullName: string;
    callName: string;
    fullToken: string;
    shortToken: string;
    isPeer: boolean;
    order: number;
  }> = [];

  let orderCounter = 0;

  if (options.targetFullName && options.targetFullName.trim()) {
    const cleanFull = options.targetFullName
      .normalize("NFC")
      .trim()
      .replace(/\s+/g, " ");
    const fullToken = options.targetToken || "STUDENT_01";
    const callName = (
      options.targetCallName?.normalize("NFC").trim() ||
      formatVietnameseCallName(cleanFull)
    ).replace(/\s+/g, " ");
    const shortToken = options.targetShortToken || fullToken;

    tokenMap[fullToken] = cleanFull;
    if (shortToken !== fullToken && callName) {
      tokenMap[shortToken] = callName;
    }

    entries.push({
      fullName: cleanFull,
      callName,
      fullToken,
      shortToken,
      isPeer: false,
      order: orderCounter++,
    });
  }

  if (Array.isArray(options.roster)) {
    options.roster.forEach((item, idx) => {
      const cleanFull = String(item?.fullName || "")
        .normalize("NFC")
        .trim()
        .replace(/\s+/g, " ");
      if (!cleanFull) return;
      const fullToken =
        item.alias || `STUDENT_${String(idx + 1).padStart(2, "0")}`;
      const callName = (
        item.callName?.normalize("NFC").trim() ||
        formatVietnameseCallName(cleanFull)
      ).replace(/\s+/g, " ");
      const shortToken = item.shortAlias || fullToken;

      if (!tokenMap[fullToken]) {
        tokenMap[fullToken] = cleanFull;
      }
      if (shortToken !== fullToken && callName && !tokenMap[shortToken]) {
        tokenMap[shortToken] = callName;
      }

      entries.push({
        fullName: cleanFull,
        callName,
        fullToken,
        shortToken,
        isPeer: false,
        order: orderCounter++,
      });
    });
  }

  const targetKeysLower = new Set(
    entries.map((e) => stripVietnameseAccentsPreserveCase(e.fullName).toLowerCase())
  );

  if (Array.isArray(options.peerNames)) {
    for (const rawPeer of options.peerNames) {
      const cleanPeer = String(rawPeer || "")
        .normalize("NFC")
        .trim()
        .replace(/\s+/g, " ");
      if (!cleanPeer) continue;
      const peerKey = stripVietnameseAccentsPreserveCase(cleanPeer).toLowerCase();
      if (targetKeysLower.has(peerKey)) continue;
      entries.push({
        fullName: cleanPeer,
        callName: formatVietnameseCallName(cleanPeer),
        fullToken: peerToken,
        shortToken: peerToken,
        isPeer: true,
        order: orderCounter++,
      });
    }
  }

  // Joined/underscore/hyphen/dot scrubbing for code & filenames (enabled by default across all generators)
  if (options.matchJoinedFileNames !== false) {
    const joinedEntries = [...entries].sort((a, b) => {
      const aWords = a.fullName.split(/\s+/).filter(Boolean).length;
      const bWords = b.fullName.split(/\s+/).filter(Boolean).length;
      if (bWords !== aWords) return bWords - aWords;
      if (b.fullName.length !== a.fullName.length) return b.fullName.length - a.fullName.length;
      if (a.isPeer !== b.isPeer) return Number(a.isPeer) - Number(b.isPeer);
      return a.order - b.order;
    });

    const replaceJoinedParts = (parts: string[], token: string) => {
      if (parts.length < 2) return;
      const pattern = new RegExp(
        `(?<![\\p{L}\\p{N}])${parts.map((p) => escapeRegExp(p)).join("[\\s_.\\-]*")}(?![\\p{L}\\p{N}])`,
        "giu"
      );
      output = output.replace(pattern, token);
    };

    // Pass A: Full multi-word names joined by '', '_', '-', '.', or whitespace
    for (const entry of joinedEntries) {
      const cleanName = entry.fullName;
      const asciiName = stripVietnameseAccentsPreserveCase(cleanName);
      const accentedParts = cleanName.split(/\s+/).filter(Boolean);
      replaceJoinedParts(accentedParts, entry.fullToken);
      const asciiParts = asciiName.split(/\s+/).filter(Boolean);
      replaceJoinedParts(asciiParts, entry.fullToken);
    }

    // Pass B: 2-word sub-phrases (Middle + Given) joined by '_', '-', or ''
    for (const entry of joinedEntries) {
      const cleanName = entry.fullName;
      const asciiName = stripVietnameseAccentsPreserveCase(cleanName);
      const accentedParts = cleanName.split(/\s+/).filter(Boolean);
      if (accentedParts.length >= 3) {
        replaceJoinedParts(accentedParts.slice(-2), entry.shortToken);
      }
      const asciiParts = asciiName.split(/\s+/).filter(Boolean);
      if (asciiParts.length >= 3) {
        replaceJoinedParts(asciiParts.slice(-2), entry.shortToken);
      }
    }
  }

  type CandidatePhrase = {
    phrase: string;
    token: string;
    wordCount: number;
    priority: number;
    order: number;
  };

  const candidates: CandidatePhrase[] = [];
  const seenPhraseKey = new Set<string>();

  const addCandidate = (
    phrase: string,
    token: string,
    priority: number,
    order: number
  ) => {
    const trimmed = String(phrase || "")
      .normalize("NFC")
      .trim()
      .replace(/\s+/g, " ");
    if (!trimmed) return;
    if (/^(?:student|peer|file)$/i.test(trimmed)) return;
    const key = trimmed.toLowerCase();
    if (seenPhraseKey.has(key)) return;
    seenPhraseKey.add(key);
    const wordCount = trimmed.split(" ").filter(Boolean).length;
    candidates.push({ phrase: trimmed, token, wordCount, priority, order });
  };

  // Pass 1: Full names (non-peers first for priority on exact full name, sorted by word count & length)
  for (const entry of entries) {
    const basePriority = entry.isPeer ? 95 : 100;
    addCandidate(entry.fullName, entry.fullToken, basePriority, entry.order);
    const asciiFull = stripVietnameseAccentsPreserveCase(entry.fullName);
    if (asciiFull.toLowerCase() !== entry.fullName.toLowerCase()) {
      addCandidate(asciiFull, entry.fullToken, basePriority - 1, entry.order);
    }
  }

  // Pass 2: 2-word sub-phrases (CallName / Last 2 words, First + Last word, First 2 words)
  for (const entry of entries) {
    const words = entry.fullName.split(" ").filter(Boolean);
    const basePriority = entry.isPeer ? 75 : 80;

    if (entry.callName && entry.callName.toLowerCase() !== entry.fullName.toLowerCase()) {
      addCandidate(entry.callName, entry.shortToken, basePriority, entry.order);
      const asciiCall = stripVietnameseAccentsPreserveCase(entry.callName);
      if (asciiCall.toLowerCase() !== entry.callName.toLowerCase()) {
        addCandidate(asciiCall, entry.shortToken, basePriority - 1, entry.order);
      }
    }

    if (words.length >= 2) {
      const lastTwo = words.slice(-2).join(" ");
      addCandidate(lastTwo, entry.shortToken, basePriority - 2, entry.order);
      const asciiLastTwo = stripVietnameseAccentsPreserveCase(lastTwo);
      if (asciiLastTwo.toLowerCase() !== lastTwo.toLowerCase()) {
        addCandidate(asciiLastTwo, entry.shortToken, basePriority - 3, entry.order);
      }

      const firstLast = `${words[0]} ${words[words.length - 1]}`;
      addCandidate(firstLast, entry.shortToken, basePriority - 4, entry.order);
      const asciiFirstLast = stripVietnameseAccentsPreserveCase(firstLast);
      if (asciiFirstLast.toLowerCase() !== firstLast.toLowerCase()) {
        addCandidate(asciiFirstLast, entry.shortToken, basePriority - 5, entry.order);
      }
    }

    if (words.length >= 3) {
      const firstTwo = words.slice(0, 2).join(" ");
      addCandidate(firstTwo, entry.shortToken, basePriority - 6, entry.order);
      const asciiFirstTwo = stripVietnameseAccentsPreserveCase(firstTwo);
      if (asciiFirstTwo.toLowerCase() !== firstTwo.toLowerCase()) {
        addCandidate(asciiFirstTwo, entry.shortToken, basePriority - 7, entry.order);
      }
    }
  }

  // Pass 3: Single-word given names (last word of fullName)
  for (const entry of entries) {
    const words = entry.fullName.split(" ").filter(Boolean);
    const given = words.length > 0 ? words[words.length - 1] : "";
    if (!given) continue;
    const basePriority = entry.isPeer ? 45 : 50;
    addCandidate(given, entry.shortToken, basePriority, entry.order);
    const asciiGiven = stripVietnameseAccentsPreserveCase(given);
    if (asciiGiven.toLowerCase() !== given.toLowerCase()) {
      addCandidate(asciiGiven, entry.shortToken, basePriority - 1, entry.order);
    }
  }

  candidates.sort((a, b) => {
    if (b.wordCount !== a.wordCount) return b.wordCount - a.wordCount;
    if (b.phrase.length !== a.phrase.length) return b.phrase.length - a.phrase.length;
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.order - b.order;
  });

  for (const c of candidates) {
    output = replaceWholePhrase(output, c.phrase, c.token);
  }

  // Optional individual token replacement (for filenames/identifiers like Nguyen_Minh_An)
  if (options.matchAllNameTokens) {
    const tokenEntries = [
      ...entries.filter((e) => e.isPeer),
      ...entries.filter((e) => !e.isPeer),
    ];
    for (const entry of tokenEntries) {
      const accentedParts = entry.fullName.split(/\s+/).filter((p) => p.length >= 2);
      for (const part of accentedParts) {
        if (/^(?:student|peer|file)$/i.test(part)) continue;
        output = output.replace(
          new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(part)}(?![\\p{L}\\p{N}])`, "giu"),
          entry.fullToken
        );
      }
      const asciiParts = stripVietnameseDiacritics(entry.fullName)
        .split(/\s+/)
        .filter((p) => p.length >= 2);
      for (const part of asciiParts) {
        if (/^(?:student|peer|file)$/i.test(part)) continue;
        output = output.replace(
          new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(part)}(?![\\p{L}\\p{N}])`, "giu"),
          entry.fullToken
        );
      }
    }
  }

  // Optional Pass 4: Absorb leftover family/middle name tokens immediately preceding STUDENT_XX
  if (options.absorbLeadingFamilyTokens) {
    const allFamilyMiddleTokens = new Set<string>();
    for (const entry of entries) {
      const parts = entry.fullName.split(/\s+/).filter((p) => p.length >= 2);
      for (const part of parts.slice(0, -1)) {
        allFamilyMiddleTokens.add(escapeRegExp(part));
        const asciiPart = escapeRegExp(stripVietnameseAccentsPreserveCase(part));
        if (asciiPart.length >= 2) {
          allFamilyMiddleTokens.add(asciiPart);
        }
      }
    }
    if (allFamilyMiddleTokens.size > 0) {
      const tokenUnion = Array.from(allFamilyMiddleTokens).join("|");
      output = output.replace(
        new RegExp(
          `(?<![\\p{L}\\p{N}])(?:(?:${tokenUnion})\\s+)+(STUDENT_\\d{2})(?![\\p{L}\\p{N}])`,
          "giu"
        ),
        "$1"
      );
    }
  }

  return { text: output, tokenMap };
}

/**
 * Core unified `deanonymize` function for restoring anonymous tokens back to real student names.
 */
export function deanonymize(
  text: string,
  options: PiiDeanonymizeOptions
): string {
  if (!text) return "";
  let output = String(text);

  if (options.fullToken && options.fullName !== undefined) {
    output = output.replace(
      new RegExp(escapeRegExp(options.fullToken), "gi"),
      options.fullName
    );
  }

  if (options.shortToken && options.callName !== undefined) {
    output = output.replace(
      new RegExp(escapeRegExp(options.shortToken), "gi"),
      options.callName
    );
  }

  if (options.tokenMap) {
    const sortedTokens = Object.keys(options.tokenMap).sort(
      (a, b) => b.length - a.length
    );
    for (const tok of sortedTokens) {
      const realVal = options.tokenMap[tok];
      if (tok && typeof realVal === "string") {
        output = output.replace(new RegExp(escapeRegExp(tok), "gi"), realVal);
      }
    }
  }

  if (options.fallbackStudentTokenReplacement !== undefined) {
    output = output.replace(
      /\bSTUDENT_\d{2}\b/g,
      options.fallbackStudentTokenReplacement
    );
  }

  return output;
}

/**
 * Builds a reusable name scrubber for a class roster (used by `comment-generator.ts` and `homework-grader.ts`).
 */
export function createRosterNameScrubber(
  params:
    | {
        rosterEntries: Array<{ fullName: string; token: string }>;
        peerNames?: string[];
        peerToken?: string;
      }
    | string[]
): (rawText: string, selfName?: string, selfAnonId?: string) => string {
  const normalizedParams = Array.isArray(params)
    ? {
        rosterEntries: params.map((fullName, idx) => ({
          fullName,
          token: `STUDENT_${String(idx + 1).padStart(2, "0")}`,
        })),
      }
    : params;
  const peerToken = normalizedParams.peerToken || "STUDENT_PEER";
  return (rawText: string, selfName?: string, selfAnonId?: string): string => {
    if (!rawText) return "";
    const roster: PiiStudentEntry[] = [];
    if (selfName && selfAnonId) {
      roster.push({ fullName: selfName, alias: selfAnonId });
    }
    for (const item of normalizedParams.rosterEntries || []) {
      if (item.fullName && item.token) {
        roster.push({ fullName: item.fullName, alias: item.token });
      }
    }
    return anonymize(rawText, {
      roster,
      peerNames: normalizedParams.peerNames || [],
      peerToken,
      matchJoinedFileNames: true,
    }).text;
  };
}

/**
 * Session 14 evaluation text anonymizer (used by `session14-course-summary.ts`).
 */
export function anonymizeSession14Text(
  rawText: string,
  fullName: string,
  callName: string,
  fullToken: string,
  shortToken: string,
  peerNames: string[] = []
): string {
  return anonymize(rawText, {
    targetFullName: fullName,
    targetCallName: callName,
    targetToken: fullToken,
    targetShortToken: shortToken,
    peerNames,
    peerToken: "PEER_STUDENT",
    matchJoinedFileNames: true,
  }).text;
}

/**
 * Session 14 evaluation text de-anonymizer (used by `session14-course-summary.ts`).
 */
export function deAnonymizeSession14Text(
  text: string,
  fullToken: string,
  shortToken: string,
  fullName: string,
  callName: string
): string {
  return deanonymize(text, {
    fullToken,
    shortToken,
    fullName,
    callName,
  });
}

/**
 * SPCK comment text anonymizer (used by `spck-comment.ts`).
 */
export function anonymizeSpckText(
  rawText: string,
  targetFullName: string,
  targetToken: string,
  peerNames: string[] = []
): string {
  return anonymize(rawText, {
    targetFullName,
    targetToken,
    peerNames,
    peerToken: "STUDENT_PEER",
    redactSandboxTags: true,
    matchJoinedFileNames: true,
    matchAllNameTokens: true,
  }).text;
}

/**
 * SPCK comment text de-anonymizer (used by `spck-comment.ts`).
 */
export function deAnonymizeSpckText(
  text: string,
  anonymousToken: string,
  realFullName: string
): string {
  return deanonymize(text, {
    fullToken: anonymousToken,
    fullName: realFullName,
    fallbackStudentTokenReplacement: realFullName,
  });
}

/**
 * Teaching Project AI hint sanitizer (used by `teaching-project-generator.ts`).
 */
export function anonymizeTeachingHintText(
  rawHint: string,
  orderedStudentNames: string[],
  maxLength = 600
): string {
  const trimmed = String(rawHint || "").trim();
  if (!trimmed) return "";
  const roster: PiiStudentEntry[] = orderedStudentNames.map((fullName, index) => ({
    fullName,
    alias: `STUDENT_${String(index + 1).padStart(2, "0")}`,
  }));
  const res = anonymize(trimmed, {
    roster,
    redactContactInfo: true,
    absorbLeadingFamilyTokens: true,
    matchJoinedFileNames: true,
  });
  return res.text.slice(0, maxLength);
}

const sharedPiiAnonymizer = {
  anonymize,
  deanonymize,
  createRosterNameScrubber,
  anonymizeSession14Text,
  deAnonymizeSession14Text,
  anonymizeSpckText,
  deAnonymizeSpckText,
  anonymizeTeachingHintText,
  formatSpckStudentCallName: formatVietnameseCallName,
};

if (typeof URL !== "undefined") {
  (URL as any).__mindxPiiAnonymizer = sharedPiiAnonymizer;
}
if (typeof globalThis !== "undefined") {
  (globalThis as any).__mindxPiiAnonymizer = sharedPiiAnonymizer;
}
if (typeof console !== "undefined") {
  (console as any).__mindxPiiAnonymizer = sharedPiiAnonymizer;
}
