import AdmZip from "adm-zip";
import path from "node:path";
import { parseCodeBuffer } from "./code-reader";

export const ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES = 50 * 1024 * 1024; // 50 MB
export const ZIP_MAX_SINGLE_FILE_BYTES = 15 * 1024 * 1024; // 15 MB per single file
export const ZIP_MAX_FILE_COUNT = 600;
export const ZIP_MAX_DIRECTORY_DEPTH = 10;
export const ZIP_MAX_COMPRESSION_RATIO = 200; // Guard against extreme compression ratio bombs

const IGNORED_PATH_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
  "__macosx",
  "dist",
  "build",
]);

const IGNORED_FILE_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

const READABLE_CODE_EXTENSIONS = new Set([
  ".py",
  ".ipynb",
  ".ui",
  ".qss",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".ts",
  ".jsx",
  ".tsx",
  ".sql",
  ".txt",
  ".text",
  ".json",
  ".md",
  ".csv",
  ".xml",
  ".gml",
  ".yy",
  ".ino",
  ".hex",
  ".ldr",
  ".mpd",
  ".vex",
  ".vexblocks",
  ".iqblocks",
  ".v5python",
  ".v5blocks",
]);

const ROBOTICS_BINARY_ARTIFACT_EXTENSIONS = new Set([
  ".ev3",
  ".llsp",
  ".llsp3",
  ".io",
  ".lxf",
  ".mblock",
  ".uf2",
  ".stl",
  ".obj",
]);

export interface SafeZipEntry {
  entryName: string;
  normalizedPath: string;
  extension: string;
  uncompressedSize: number;
  getData: () => Buffer;
}

export interface SafeZipInspectionResult {
  valid: boolean;
  entries: SafeZipEntry[];
  skippedIgnoredCount: number;
  totalUncompressedBytes: number;
  errorReason?: string;
}

/**
 * Inspects a ZIP archive buffer (for .zip, .sb3, .yyz) with strict security guards:
 * - Path traversal detection (`..`, absolute paths, Windows drive prefixes)
 * - Directory depth limit (max 10 levels)
 * - Total file count limit (max 600 active files)
 * - Total uncompressed size limit (max 50 MB) + suspicious compression ratio check
 * - Filters out `node_modules/`, `.git/`, `__pycache__/`, etc.
 */
export function inspectZipArchiveSafely(
  zipBuffer: Buffer,
  archiveName: string,
  options?: {
    maxTotalBytes?: number;
    maxFiles?: number;
    maxDepth?: number;
  }
): SafeZipInspectionResult {
  const maxTotalBytes = options?.maxTotalBytes ?? ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES;
  const maxFiles = options?.maxFiles ?? ZIP_MAX_FILE_COUNT;
  const maxDepth = options?.maxDepth ?? ZIP_MAX_DIRECTORY_DEPTH;

  if (!zipBuffer || zipBuffer.length < 4) {
    return {
      valid: false,
      entries: [],
      skippedIgnoredCount: 0,
      totalUncompressedBytes: 0,
      errorReason: `File nén '${archiveName}' rỗng hoặc quá ngắn.`,
    };
  }

  // Verify PK\x03\x04 or PK\x05\x06 ZIP magic header
  if (zipBuffer[0] !== 0x50 || zipBuffer[1] !== 0x4b) {
    return {
      valid: false,
      entries: [],
      skippedIgnoredCount: 0,
      totalUncompressedBytes: 0,
      errorReason: `File '${archiveName}' không đúng định dạng chữ ký ZIP hợp lệ (thiếu PK header).`,
    };
  }

  let zip: AdmZip;
  let rawEntries: AdmZip.IZipEntry[];
  try {
    zip = new AdmZip(zipBuffer);
    rawEntries = zip.getEntries();
  } catch (err: any) {
    return {
      valid: false,
      entries: [],
      skippedIgnoredCount: 0,
      totalUncompressedBytes: 0,
      errorReason: `File nén '${archiveName}' bị hỏng, không thể giải nén: ${err?.message || "Corrupted archive"}`,
    };
  }

  const safeEntries: SafeZipEntry[] = [];
  let skippedIgnoredCount = 0;
  let runningDeclaredBytes = 0;
  let runningActualDecompressedBytes = 0;

  for (const entry of rawEntries) {
    const rawName = String(entry.entryName || "");
    const unified = rawName.replace(/\\/g, "/");

    // 1. Strict Path Traversal & Absolute Path Guard (must check BEFORE skipping or extracting)
    if (
      unified.startsWith("/") ||
      /^[a-zA-Z]:/.test(unified) ||
      unified.includes("\0") ||
      /(^|\/)\.\.(\/|$)/.test(unified)
    ) {
      return {
        valid: false,
        entries: [],
        skippedIgnoredCount,
        totalUncompressedBytes: runningDeclaredBytes,
        errorReason: `[Security / Path Traversal] Phát hiện đường dẫn không an toàn '${rawName}' trong file nén '${archiveName}'.`,
      };
    }

    const parts = unified.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    // 2. Skip ignored directories (node_modules, .git, __pycache__, etc.)
    const hasIgnoredDir = parts.some((seg) => IGNORED_PATH_SEGMENTS.has(seg.toLowerCase()));
    const baseNameLower = parts[parts.length - 1].toLowerCase();
    if (hasIgnoredDir || IGNORED_FILE_NAMES.has(baseNameLower)) {
      skippedIgnoredCount++;
      continue;
    }

    // 3. Check directory depth
    if (parts.length > maxDepth) {
      return {
        valid: false,
        entries: [],
        skippedIgnoredCount,
        totalUncompressedBytes: runningDeclaredBytes,
        errorReason: `[Zip Bomb Protection] File nén '${archiveName}' vượt quá độ sâu thư mục cho phép (${parts.length} > ${maxDepth} cấp) tại '${unified}'.`,
      };
    }

    if (entry.isDirectory) {
      continue;
    }

    // 4. Check file count limit
    if (safeEntries.length + 1 > maxFiles) {
      return {
        valid: false,
        entries: [],
        skippedIgnoredCount,
        totalUncompressedBytes: runningDeclaredBytes,
        errorReason: `[Zip Bomb Protection] File nén '${archiveName}' chứa quá nhiều file (${safeEntries.length + 1} > giới hạn ${maxFiles} file).`,
      };
    }

    // 5. Check declared uncompressed size & compression ratio
    const declaredSize = Number(entry.header?.size ?? 0);
    const compressedSize = Number(entry.header?.compressedSize ?? 0);

    if (declaredSize < 0 || declaredSize > ZIP_MAX_SINGLE_FILE_BYTES) {
      return {
        valid: false,
        entries: [],
        skippedIgnoredCount,
        totalUncompressedBytes: runningDeclaredBytes,
        errorReason: `[Zip Bomb Protection] File '${unified}' trong '${archiveName}' có dung lượng giải nén (${Math.round(declaredSize / 1024 / 1024)}MB) vượt ngưỡng an toàn cho 1 file.`,
      };
    }

    if (
      compressedSize > 0 &&
      declaredSize > 5 * 1024 * 1024 &&
      declaredSize / compressedSize > ZIP_MAX_COMPRESSION_RATIO
    ) {
      return {
        valid: false,
        entries: [],
        skippedIgnoredCount,
        totalUncompressedBytes: runningDeclaredBytes,
        errorReason: `[Zip Bomb Protection] Phát hiện tỷ lệ nén bất thường (${Math.round(declaredSize / compressedSize)}:1) tại '${unified}' trong '${archiveName}'.`,
      };
    }

    runningDeclaredBytes += declaredSize;
    if (runningDeclaredBytes > maxTotalBytes) {
      return {
        valid: false,
        entries: [],
        skippedIgnoredCount,
        totalUncompressedBytes: runningDeclaredBytes,
        errorReason: `[Zip Bomb Protection] Tổng dung lượng giải nén của '${archiveName}' vượt giới hạn an toàn 50MB.`,
      };
    }

    const ext = path.extname(parts[parts.length - 1]).toLowerCase();
    safeEntries.push({
      entryName: rawName,
      normalizedPath: parts.join("/"),
      extension: ext,
      uncompressedSize: declaredSize,
      getData: () => {
        const data = entry.getData();
        if (data.length > ZIP_MAX_SINGLE_FILE_BYTES) {
          throw new Error(
            `[Zip Bomb Protection] File '${unified}' giải nén thực tế (${Math.round(
              data.length / 1024 / 1024
            )}MB) vượt quá giới hạn an toàn cho 1 file.`
          );
        }
        runningActualDecompressedBytes += data.length;
        if (runningActualDecompressedBytes > maxTotalBytes) {
          throw new Error(
            `[Zip Bomb Protection] Tổng dung lượng giải nén thực tế của '${archiveName}' vượt quá giới hạn 50MB.`
          );
        }
        return data;
      },
    });
  }

  return {
    valid: true,
    entries: safeEntries,
    skippedIgnoredCount,
    totalUncompressedBytes: runningDeclaredBytes,
  };
}

export interface ArchiveParseResult {
  success: boolean;
  subjectType: "WEB" | "PYTHON" | "PYQT6" | "ARCHIVE";
  extractedText: string;
  summary: {
    archiveName: string;
    totalFiles: number;
    parsedCodeFiles: number;
    skippedIgnoredCount: number;
    totalUncompressedBytes: number;
    fileTree: string[];
  };
  errorReason?: string;
}

/**
 * Safely parses a `.zip` submission in memory without writing untrusted files to disk.
 * Combines project tree structure and readable source files (.html, .css, .js, .py, .ui, .qss, etc.).
 */
export function parseZipArchiveBuffer(
  zipBuffer: Buffer,
  archiveName: string
): ArchiveParseResult {
  const inspection = inspectZipArchiveSafely(zipBuffer, archiveName);
  if (!inspection.valid) {
    return {
      success: false,
      subjectType: "ARCHIVE",
      extractedText: "",
      summary: {
        archiveName,
        totalFiles: 0,
        parsedCodeFiles: 0,
        skippedIgnoredCount: inspection.skippedIgnoredCount,
        totalUncompressedBytes: inspection.totalUncompressedBytes,
        fileTree: [],
      },
      errorReason: inspection.errorReason,
    };
  }

  if (inspection.entries.length === 0) {
    return {
      success: false,
      subjectType: "ARCHIVE",
      extractedText: "",
      summary: {
        archiveName,
        totalFiles: 0,
        parsedCodeFiles: 0,
        skippedIgnoredCount: inspection.skippedIgnoredCount,
        totalUncompressedBytes: 0,
        fileTree: [],
      },
      errorReason: `File nén '${archiveName}' không chứa bất kỳ file bài làm nào (sau khi lọc bỏ thư mục thừa).`,
    };
  }

  const fileTree = inspection.entries.map(
    (e) => `${e.normalizedPath} (${e.uncompressedSize} bytes)`
  );

  const codeSections: string[] = [];
  let actualUncompressedBytes = 0;
  let parsedCodeFiles = 0;
  let hasWebFiles = false;
  let hasPyQtFiles = false;
  let hasPythonFiles = false;

  for (const entry of inspection.entries) {
    let dataBuf: Buffer;
    try {
      dataBuf = entry.getData();
    } catch (err: any) {
      return {
        success: false,
        subjectType: "ARCHIVE",
        extractedText: "",
        summary: {
          archiveName,
          totalFiles: inspection.entries.length,
          parsedCodeFiles,
          skippedIgnoredCount: inspection.skippedIgnoredCount,
          totalUncompressedBytes: actualUncompressedBytes,
          fileTree,
        },
        errorReason: `Không thể giải nén file '${entry.normalizedPath}' bên trong '${archiveName}': ${err?.message || "Decompression error"}`,
      };
    }

    actualUncompressedBytes += dataBuf.length;
    if (actualUncompressedBytes > ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES) {
      return {
        success: false,
        subjectType: "ARCHIVE",
        extractedText: "",
        summary: {
          archiveName,
          totalFiles: inspection.entries.length,
          parsedCodeFiles,
          skippedIgnoredCount: inspection.skippedIgnoredCount,
          totalUncompressedBytes: actualUncompressedBytes,
          fileTree,
        },
        errorReason: `[Zip Bomb Protection] Tổng dung lượng thực tế sau khi giải nén của '${archiveName}' vượt quá giới hạn 50MB.`,
      };
    }

    if (READABLE_CODE_EXTENSIONS.has(entry.extension)) {
      const codeRes = parseCodeBuffer(dataBuf, entry.normalizedPath, entry.extension);
      if (!codeRes.success) {
        return {
          success: false,
          subjectType: "ARCHIVE",
          extractedText: "",
          summary: {
            archiveName,
            totalFiles: inspection.entries.length,
            parsedCodeFiles,
            skippedIgnoredCount: inspection.skippedIgnoredCount,
            totalUncompressedBytes: actualUncompressedBytes,
            fileTree,
          },
          errorReason: `File mã nguồn '${entry.normalizedPath}' bên trong gói nén '${archiveName}' bị hỏng hoặc không đọc được: ${
            codeRes.errorReason || "Corrupted source file"
          }`,
        };
      }
      parsedCodeFiles++;
      codeSections.push(codeRes.extractedText);
      if (codeRes.subjectType === "WEB") hasWebFiles = true;
      if (codeRes.subjectType === "PYQT6") hasPyQtFiles = true;
      if (codeRes.subjectType === "PYTHON" || codeRes.subjectType === "JUPYTER") {
        hasPythonFiles = true;
      }
    } else if (entry.extension === ".docx") {
      const docxRes = parseDocxBufferSafely(dataBuf, entry.normalizedPath);
      if (!docxRes.success) {
        if (/Security|Zip Bomb|hỏng|Corrupted|giải nén/i.test(docxRes.errorReason || "")) {
          return {
            success: false,
            subjectType: "ARCHIVE",
            extractedText: "",
            summary: {
              archiveName,
              totalFiles: inspection.entries.length,
              parsedCodeFiles,
              skippedIgnoredCount: inspection.skippedIgnoredCount,
              totalUncompressedBytes: actualUncompressedBytes,
              fileTree,
            },
            errorReason: docxRes.errorReason,
          };
        }
      } else {
        parsedCodeFiles++;
        codeSections.push(docxRes.extractedText);
      }
    } else if (ROBOTICS_BINARY_ARTIFACT_EXTENSIONS.has(entry.extension) && dataBuf.length > 0) {
      parsedCodeFiles++;
      codeSections.push(
        `=== ROBOTICS / 3D ARTIFACT (${entry.extension.toUpperCase()}): ${entry.normalizedPath} (${dataBuf.length} bytes) ===`
      );
    }
  }

  if (parsedCodeFiles === 0) {
    return {
      success: false,
      subjectType: "ARCHIVE",
      extractedText: "",
      summary: {
        archiveName,
        totalFiles: inspection.entries.length,
        parsedCodeFiles: 0,
        skippedIgnoredCount: inspection.skippedIgnoredCount,
        totalUncompressedBytes: actualUncompressedBytes,
        fileTree,
      },
      errorReason: `File nén '${archiveName}' không chứa mã nguồn đọc được (.py, .html, .css, .js, .ui, .ipynb...). Danh sách file: ${fileTree.slice(0, 10).join(", ")}`,
    };
  }

  const detectedSubject = hasPyQtFiles
    ? "PYQT6"
    : hasWebFiles
    ? "WEB"
    : hasPythonFiles
    ? "PYTHON"
    : "ARCHIVE";

  const header = [
    `=== PROJECT ARCHIVE (.ZIP): ${archiveName} ===`,
    `Tổng số file hợp lệ: ${inspection.entries.length} (Đã đọc ${parsedCodeFiles} file mã nguồn, bỏ qua ${inspection.skippedIgnoredCount} file rác/thư viện)`,
    `Tổng dung lượng giải nén: ${(actualUncompressedBytes / 1024).toFixed(1)} KB`,
    `Cây thư mục dự án:\n${fileTree.map((f) => `  - ${f}`).join("\n")}`,
  ].join("\n");

  return {
    success: true,
    subjectType: detectedSubject,
    extractedText: `${header}\n\n${codeSections.join("\n\n")}`,
    summary: {
      archiveName,
      totalFiles: inspection.entries.length,
      parsedCodeFiles,
      skippedIgnoredCount: inspection.skippedIgnoredCount,
      totalUncompressedBytes: actualUncompressedBytes,
      fileTree,
    },
  };
}

export interface DocxParseResult {
  success: boolean;
  subjectType: "DOCUMENT";
  extractedText: string;
  summary: {
    fileName: string;
    totalEntries: number;
    xmlPartsRead: string[];
    totalUncompressedBytes: number;
    characterCount: number;
  };
  errorReason?: string;
}

function decodeXmlEntities(raw: string): string {
  return String(raw || "").replace(
    /&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g,
    (full, entity: string) => {
      switch (entity) {
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "amp":
          return "&";
        case "quot":
          return '"';
        case "apos":
          return "'";
        default: {
          if (entity.startsWith("#x") || entity.startsWith("#X")) {
            const cp = parseInt(entity.slice(2), 16);
            if (Number.isInteger(cp) && cp >= 0x09 && cp <= 0x10ffff) {
              try {
                return String.fromCodePoint(cp);
              } catch {
                return full;
              }
            }
            return "";
          }
          if (entity.startsWith("#")) {
            const cp = parseInt(entity.slice(1), 10);
            if (Number.isInteger(cp) && cp >= 0x09 && cp <= 0x10ffff) {
              try {
                return String.fromCodePoint(cp);
              } catch {
                return full;
              }
            }
            return "";
          }
          return full;
        }
      }
    }
  );
}

function extractTextFromWordXml(xmlText: string): string {
  const tokenRegex =
    /<w:t(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\/>|<w:t(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?>([\s\S]*?)<\/w:t>|<w:(?:br|cr)(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?>|<w:tab(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?>|<\/w:p>/gi;
  const chunks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(xmlText)) !== null) {
    const token = match[0];
    if (match[1] !== undefined) {
      chunks.push(decodeXmlEntities(match[1]));
    } else if (/^<w:tab\b/i.test(token)) {
      chunks.push("\t");
    } else if (/^<(?:w:(?:br|cr)\b|\/w:p>)/i.test(token)) {
      chunks.push("\n");
    }
  }
  return chunks
    .join("")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ ]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Safely parses an OOXML `.docx` buffer in memory using `inspectZipArchiveSafely`
 * (enforcing zip-slip, compression ratio, depth, count, and size limits),
 * extracting clean text from `word/document.xml` (and optional headers/footers).
 */
export function parseDocxBufferSafely(
  buffer: Buffer,
  fileName: string
): DocxParseResult {
  const emptySummary = (
    totalEntries = 0,
    xmlPartsRead: string[] = [],
    totalUncompressedBytes = 0,
    characterCount = 0
  ) => ({
    fileName,
    totalEntries,
    xmlPartsRead,
    totalUncompressedBytes,
    characterCount,
  });

  const inspection = inspectZipArchiveSafely(buffer, fileName);
  if (!inspection.valid) {
    return {
      success: false,
      subjectType: "DOCUMENT",
      extractedText: "",
      summary: emptySummary(0, [], inspection.totalUncompressedBytes, 0),
      errorReason: inspection.errorReason,
    };
  }

  const byLowerPath = new Map<string, SafeZipEntry>();
  const headerEntries: SafeZipEntry[] = [];
  const footerEntries: SafeZipEntry[] = [];

  for (const entry of inspection.entries) {
    const lower = entry.normalizedPath.toLowerCase();
    byLowerPath.set(lower, entry);
    if (/^word\/header\d*\.xml$/i.test(lower)) {
      headerEntries.push(entry);
    } else if (/^word\/footer\d*\.xml$/i.test(lower)) {
      footerEntries.push(entry);
    }
  }

  const documentEntry = byLowerPath.get("word/document.xml");
  if (!documentEntry) {
    return {
      success: false,
      subjectType: "DOCUMENT",
      extractedText: "",
      summary: emptySummary(
        inspection.entries.length,
        [],
        inspection.totalUncompressedBytes,
        0
      ),
      errorReason: `File Word '${fileName}' thiếu phần nội dung 'word/document.xml' hợp lệ.`,
    };
  }

  headerEntries.sort((a, b) => a.normalizedPath.localeCompare(b.normalizedPath));
  footerEntries.sort((a, b) => a.normalizedPath.localeCompare(b.normalizedPath));

  const targetEntries = [...headerEntries, documentEntry, ...footerEntries];
  const xmlPartsRead: string[] = [];
  const extractedSections: string[] = [];
  let actualUncompressedBytes = 0;

  for (const entry of targetEntries) {
    let xmlBuf: Buffer;
    try {
      xmlBuf = entry.getData();
    } catch (err: any) {
      return {
        success: false,
        subjectType: "DOCUMENT",
        extractedText: "",
        summary: emptySummary(
          inspection.entries.length,
          xmlPartsRead,
          actualUncompressedBytes,
          0
        ),
        errorReason: `Không thể giải nén '${entry.normalizedPath}' trong '${fileName}': ${
          err?.message || "Decompression error"
        }`,
      };
    }

    actualUncompressedBytes += xmlBuf.length;
    if (actualUncompressedBytes > ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES) {
      return {
        success: false,
        subjectType: "DOCUMENT",
        extractedText: "",
        summary: emptySummary(
          inspection.entries.length,
          xmlPartsRead,
          actualUncompressedBytes,
          0
        ),
        errorReason: `[Zip Bomb Protection] Tổng dung lượng giải nén thực tế của '${fileName}' vượt quá giới hạn 50MB.`,
      };
    }

    if (xmlBuf.includes(0x00)) {
      return {
        success: false,
        subjectType: "DOCUMENT",
        extractedText: "",
        summary: emptySummary(
          inspection.entries.length,
          xmlPartsRead,
          actualUncompressedBytes,
          0
        ),
        errorReason: `File Word '${fileName}' chứa dữ liệu nhị phân hỏng trong '${entry.normalizedPath}'.`,
      };
    }

    const xmlText = xmlBuf.toString("utf8").replace(/^\uFEFF/, "");
    if (!xmlText.trim() || !xmlText.includes("<")) {
      if (entry === documentEntry) {
        return {
          success: false,
          subjectType: "DOCUMENT",
          extractedText: "",
          summary: emptySummary(
            inspection.entries.length,
            xmlPartsRead,
            actualUncompressedBytes,
            0
          ),
          errorReason: `Nội dung 'word/document.xml' trong '${fileName}' bị hỏng hoặc rỗng.`,
        };
      }
      continue;
    }

    xmlPartsRead.push(entry.normalizedPath);
    const partText = extractTextFromWordXml(xmlText);
    if (partText) {
      extractedSections.push(partText);
    }
  }

  const combinedText = extractedSections.join("\n\n").trim();
  if (!combinedText) {
    return {
      success: false,
      subjectType: "DOCUMENT",
      extractedText: "",
      summary: emptySummary(
        inspection.entries.length,
        xmlPartsRead,
        actualUncompressedBytes,
        0
      ),
      errorReason: `File Word '${fileName}' không chứa nội dung văn bản (rỗng chữ).`,
    };
  }

  return {
    success: true,
    subjectType: "DOCUMENT",
    extractedText: `=== WORD DOCUMENT (.DOCX): ${fileName} ===\n\n${combinedText}`,
    summary: emptySummary(
      inspection.entries.length,
      xmlPartsRead,
      actualUncompressedBytes,
      combinedText.length
    ),
  };
}
