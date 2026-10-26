import fs from "node:fs";
import path from "node:path";
import { assertPathAllowed } from "../security/path-allowlist";
import { calculateSha256 } from "../db/sqlite";
import { parseCodeBuffer } from "./code-reader";
import { parseZipArchiveBuffer } from "./archive-reader";
import { parseScratchSb3Buffer, parseGameMakerBuffer } from "./game-reader";
import { parseMediaBuffer, type InlineDataPart } from "./media-reader";

export type { InlineDataPart } from "./media-reader";

export type FileSubjectType =
  | "PYTHON"
  | "JUPYTER"
  | "PYQT6"
  | "WEB"
  | "SQL"
  | "TEXT"
  | "ARCHIVE"
  | "SCRATCH"
  | "GAMEMAKER"
  | "IMAGE"
  | "DOCUMENT"
  | "UNKNOWN";

export interface ParsedSubmissionContent {
  parseStatus: "PARSED" | "PARSE_ERROR";
  subjectType: FileSubjectType;
  fileName: string;
  extension: string;
  fileHash: string;
  byteSize: number;
  extractedText: string;
  inlineDataParts: InlineDataPart[];
  metadata: Record<string, any>;
  parseErrorReason: string | null;
}

const CODE_EXTENSIONS = new Set([
  ".py",
  ".ipynb",
  ".ui",
  ".qss",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".sql",
  ".txt",
  ".json",
  ".md",
]);

const GAMEMAKER_EXTENSIONS = new Set([".yyz", ".gml", ".yy"]);
const MEDIA_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".pdf"]);

/**
 * Parses an in-memory Buffer of a student submission file according to its extension.
 * Enforces safe parsing: any corrupted or unsupported file returns `parseStatus: "PARSE_ERROR"`
 * without auto-scoring 0 or auto-selecting REDO.
 */
export function parseSubmissionBuffer(
  buffer: Buffer,
  rawFileName: string
): ParsedSubmissionContent {
  const fileName = path.basename(String(rawFileName || "unknown"));
  const ext = path.extname(fileName).toLowerCase();
  const fileHash = buffer && buffer.length > 0 ? calculateSha256(buffer) : "";
  const byteSize = buffer ? buffer.length : 0;

  if (!buffer || buffer.length === 0) {
    return {
      parseStatus: "PARSE_ERROR",
      subjectType: "UNKNOWN",
      fileName,
      extension: ext,
      fileHash,
      byteSize: 0,
      extractedText: "",
      inlineDataParts: [],
      metadata: {},
      parseErrorReason: `File bài nộp '${fileName}' rỗng (0 byte), không thể chấm tự động. Vui lòng kiểm tra thủ công.`,
    };
  }

  try {
    // 1. Scratch (.sb3)
    if (ext === ".sb3") {
      const res = parseScratchSb3Buffer(buffer, fileName);
      if (!res.success) {
        return {
          parseStatus: "PARSE_ERROR",
          subjectType: "SCRATCH",
          fileName,
          extension: ext,
          fileHash,
          byteSize,
          extractedText: "",
          inlineDataParts: [],
          metadata: res.summary,
          parseErrorReason:
            res.errorReason || `File Scratch '${fileName}' bị lỗi cấu trúc project.json.`,
        };
      }
      return {
        parseStatus: "PARSED",
        subjectType: "SCRATCH",
        fileName,
        extension: ext,
        fileHash,
        byteSize,
        extractedText: res.extractedText,
        inlineDataParts: [],
        metadata: res.summary,
        parseErrorReason: null,
      };
    }

    // 2. GameMaker (.yyz, .gml, .yy)
    if (GAMEMAKER_EXTENSIONS.has(ext)) {
      const res = parseGameMakerBuffer(buffer, fileName, ext);
      if (!res.success) {
        return {
          parseStatus: "PARSE_ERROR",
          subjectType: "GAMEMAKER",
          fileName,
          extension: ext,
          fileHash,
          byteSize,
          extractedText: "",
          inlineDataParts: [],
          metadata: res.summary,
          parseErrorReason:
            res.errorReason || `File GameMaker '${fileName}' bị hỏng hoặc không đọc được.`,
        };
      }
      return {
        parseStatus: "PARSED",
        subjectType: "GAMEMAKER",
        fileName,
        extension: ext,
        fileHash,
        byteSize,
        extractedText: res.extractedText,
        inlineDataParts: [],
        metadata: res.summary,
        parseErrorReason: null,
      };
    }

    // 3. Safe ZIP Archive (.zip)
    if (ext === ".zip") {
      const res = parseZipArchiveBuffer(buffer, fileName);
      if (!res.success) {
        return {
          parseStatus: "PARSE_ERROR",
          subjectType: "ARCHIVE",
          fileName,
          extension: ext,
          fileHash,
          byteSize,
          extractedText: "",
          inlineDataParts: [],
          metadata: res.summary,
          parseErrorReason:
            res.errorReason || `File nén '${fileName}' không thể giải nén an toàn.`,
        };
      }
      return {
        parseStatus: "PARSED",
        subjectType: res.subjectType,
        fileName,
        extension: ext,
        fileHash,
        byteSize,
        extractedText: res.extractedText,
        inlineDataParts: [],
        metadata: res.summary,
        parseErrorReason: null,
      };
    }

    // 4. Multimodal Images & PDF (.png, .jpg, .jpeg, .webp, .pdf)
    if (MEDIA_EXTENSIONS.has(ext)) {
      const res = parseMediaBuffer(buffer, fileName, ext);
      if (!res.success) {
        return {
          parseStatus: "PARSE_ERROR",
          subjectType: res.subjectType,
          fileName,
          extension: ext,
          fileHash,
          byteSize,
          extractedText: "",
          inlineDataParts: [],
          metadata: res.summary,
          parseErrorReason:
            res.errorReason || `File hình ảnh/tài liệu '${fileName}' bị hỏng định dạng.`,
        };
      }
      return {
        parseStatus: "PARSED",
        subjectType: res.subjectType,
        fileName,
        extension: ext,
        fileHash,
        byteSize,
        extractedText: res.extractedText,
        inlineDataParts: res.inlineDataParts,
        metadata: res.summary,
        parseErrorReason: null,
      };
    }

    // 5. Source Code & Plain Text (.py, .ipynb, .ui, .qss, .html, .css, .js, .sql, .txt)
    if (CODE_EXTENSIONS.has(ext)) {
      const res = parseCodeBuffer(buffer, fileName, ext);
      if (!res.success) {
        return {
          parseStatus: "PARSE_ERROR",
          subjectType: res.subjectType,
          fileName,
          extension: ext,
          fileHash,
          byteSize,
          extractedText: "",
          inlineDataParts: [],
          metadata: res.summary,
          parseErrorReason:
            res.errorReason || `File mã nguồn '${fileName}' bị lỗi định dạng hoặc hỏng dữ liệu.`,
        };
      }
      return {
        parseStatus: "PARSED",
        subjectType: res.subjectType,
        fileName,
        extension: ext,
        fileHash,
        byteSize,
        extractedText: res.extractedText,
        inlineDataParts: [],
        metadata: res.summary,
        parseErrorReason: null,
      };
    }

    // 6. Unsupported file extension (e.g., .rar, .7z, .exe, .docx)
    return {
      parseStatus: "PARSE_ERROR",
      subjectType: "UNKNOWN",
      fileName,
      extension: ext,
      fileHash,
      byteSize,
      extractedText: "",
      inlineDataParts: [],
      metadata: {},
      parseErrorReason: `Định dạng file '${ext || "không rõ"}' của '${fileName}' không được hỗ trợ chấm tự động (Hệ thống hỗ trợ: .py, .ipynb, .ui, .qss, .html, .css, .js, .sql, .txt, .zip, .sb3, .yyz, .gml, .yy, .png, .jpg, .pdf). Giáo viên vui lòng kiểm tra thủ công.`,
    };
  } catch (err: any) {
    return {
      parseStatus: "PARSE_ERROR",
      subjectType: "UNKNOWN",
      fileName,
      extension: ext,
      fileHash,
      byteSize,
      extractedText: "",
      inlineDataParts: [],
      metadata: {},
      parseErrorReason: `Lỗi ngoại lệ khi phân tích file '${fileName}': ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

/**
 * Coordinates safe reading and parsing of a local student submission file on disk.
 * Strictly enforces Path Allowlist (`assertPathAllowed`) before reading from disk.
 */
export function parseSubmissionFile(localFilePath: string): ParsedSubmissionContent {
  // Rule 2: Every disk file read MUST pass through assertPathAllowed
  const safeResolvedPath = assertPathAllowed(localFilePath);
  const fileName = path.basename(safeResolvedPath);
  const ext = path.extname(fileName).toLowerCase();

  if (!fs.existsSync(safeResolvedPath)) {
    return {
      parseStatus: "PARSE_ERROR",
      subjectType: "UNKNOWN",
      fileName,
      extension: ext,
      fileHash: "",
      byteSize: 0,
      extractedText: "",
      inlineDataParts: [],
      metadata: { localFilePath: safeResolvedPath },
      parseErrorReason: `Không tìm thấy file bài nộp trên ổ cứng tại '${safeResolvedPath}'.`,
    };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(safeResolvedPath);
  } catch (err: any) {
    return {
      parseStatus: "PARSE_ERROR",
      subjectType: "UNKNOWN",
      fileName,
      extension: ext,
      fileHash: "",
      byteSize: 0,
      extractedText: "",
      inlineDataParts: [],
      metadata: { localFilePath: safeResolvedPath },
      parseErrorReason: `Không thể đọc thông tin file '${fileName}': ${err?.message || "statSync failed"}`,
    };
  }

  if (!stat.isFile()) {
    return {
      parseStatus: "PARSE_ERROR",
      subjectType: "UNKNOWN",
      fileName,
      extension: ext,
      fileHash: "",
      byteSize: 0,
      extractedText: "",
      inlineDataParts: [],
      metadata: { localFilePath: safeResolvedPath },
      parseErrorReason: `Đường dẫn '${safeResolvedPath}' là thư mục, không phải file bài nộp hợp lệ.`,
    };
  }

  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(safeResolvedPath);
  } catch (err: any) {
    return {
      parseStatus: "PARSE_ERROR",
      subjectType: "UNKNOWN",
      fileName,
      extension: ext,
      fileHash: "",
      byteSize: 0,
      extractedText: "",
      inlineDataParts: [],
      metadata: { localFilePath: safeResolvedPath },
      parseErrorReason: `Không thể đọc dữ liệu file '${fileName}': ${err?.message || "readFileSync failed"}`,
    };
  }

  const parsed = parseSubmissionBuffer(buffer, fileName);
  parsed.metadata = {
    ...parsed.metadata,
    localFilePath: safeResolvedPath,
  };
  return parsed;
}
