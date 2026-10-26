export interface CodeParseResult {
  success: boolean;
  subjectType: "PYTHON" | "JUPYTER" | "PYQT6" | "WEB" | "SQL" | "TEXT";
  extractedText: string;
  summary: {
    fileName: string;
    extension: string;
    lineCount: number;
    functions: string[];
    classes: string[];
    signalsAndSlots?: string[];
    htmlTags?: string[];
    notebookCells?: number;
  };
  errorReason?: string;
}

/**
 * Checks whether a buffer appears to be binary/corrupted rather than valid UTF-8 text.
 */
export function isCorruptedBinaryBuffer(buf: Buffer): boolean {
  if (buf.length === 0) return true;
  const checkLen = Math.min(buf.length, 8192);
  let nullBytes = 0;
  for (let i = 0; i < checkLen; i++) {
    if (buf[i] === 0x00) {
      nullBytes++;
    }
  }
  if (nullBytes > 0) return true;

  const decoded = buf.toString("utf8");
  // Excessive replacement characters (\uFFFD) indicate invalid UTF-8 encoding
  const replacementCount = (decoded.match(/\uFFFD/g) || []).length;
  if (replacementCount > 5 && replacementCount / Math.max(1, decoded.length) > 0.02) {
    return true;
  }
  return false;
}

/**
 * Parses source code files:
 * - Python (.py)
 * - Jupyter Notebook (.ipynb)
 * - PyQt6 Designer XML (.ui) & Qt Style Sheet (.qss)
 * - Web & Plain code (.html, .css, .js, .ts, .jsx, .tsx, .sql, .txt, .json)
 */
export function parseCodeBuffer(
  buffer: Buffer,
  fileName: string,
  extension: string
): CodeParseResult {
  const ext = extension.toLowerCase();

  if (buffer.length === 0) {
    return {
      success: false,
      subjectType: "TEXT",
      extractedText: "",
      summary: { fileName, extension: ext, lineCount: 0, functions: [], classes: [] },
      errorReason: `File '${fileName}' rỗng (0 byte), không có mã nguồn để chấm.`,
    };
  }

  if (isCorruptedBinaryBuffer(buffer)) {
    return {
      success: false,
      subjectType: "TEXT",
      extractedText: "",
      summary: { fileName, extension: ext, lineCount: 0, functions: [], classes: [] },
      errorReason: `File '${fileName}' bị hỏng hoặc chứa dữ liệu nhị phân không thể đọc dưới dạng văn bản UTF-8.`,
    };
  }

  const rawText = buffer.toString("utf8").replace(/^\uFEFF/, "");
  if (rawText.trim().length === 0) {
    return {
      success: false,
      subjectType: "TEXT",
      extractedText: "",
      summary: { fileName, extension: ext, lineCount: 0, functions: [], classes: [] },
      errorReason: `File '${fileName}' chỉ chứa khoảng trắng, không có nội dung bài làm.`,
    };
  }

  // 1. Jupyter Notebook (.ipynb)
  if (ext === ".ipynb") {
    try {
      const nb = JSON.parse(rawText);
      if (!nb || !Array.isArray(nb.cells)) {
        return {
          success: false,
          subjectType: "JUPYTER",
          extractedText: "",
          summary: { fileName, extension: ext, lineCount: 0, functions: [], classes: [] },
          errorReason: `File Jupyter Notebook '${fileName}' không hợp lệ (thiếu mảng 'cells' trong JSON).`,
        };
      }

      const sections: string[] = [];
      const functions: string[] = [];
      const classes: string[] = [];
      let totalCodeLines = 0;

      nb.cells.forEach((cell: any, idx: number) => {
        const cellType = String(cell?.cell_type || "unknown");
        const sourceLines = Array.isArray(cell?.source)
          ? cell.source.join("")
          : String(cell?.source || "");

        if (cellType === "code") {
          const lines = sourceLines.split(/\r?\n/);
          totalCodeLines += lines.length;
          for (const line of lines) {
            const fnMatch = line.match(/^\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
            if (fnMatch) functions.push(fnMatch[1]);
            const clsMatch = line.match(/^\s*class\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
            if (clsMatch) classes.push(clsMatch[1]);
          }

          const outputTexts: string[] = [];
          if (Array.isArray(cell?.outputs)) {
            for (const out of cell.outputs) {
              if (out?.text) {
                outputTexts.push(Array.isArray(out.text) ? out.text.join("") : String(out.text));
              } else if (out?.data?.["text/plain"]) {
                const plain = out.data["text/plain"];
                outputTexts.push(Array.isArray(plain) ? plain.join("") : String(plain));
              } else if (out?.ename || out?.evalue) {
                outputTexts.push(`[Runtime Error] ${out.ename || ""}: ${out.evalue || ""}`);
              }
            }
          }

          sections.push(
            `--- [Cell #${idx + 1} - CODE] ---\n${sourceLines.trim() || "(Trống)"}${
              outputTexts.length > 0
                ? `\n--- [Cell #${idx + 1} - OUTPUT] ---\n${outputTexts.join("\n").trim()}`
                : ""
            }`
          );
        } else if (cellType === "markdown" && sourceLines.trim()) {
          sections.push(`--- [Cell #${idx + 1} - MARKDOWN] ---\n${sourceLines.trim()}`);
        }
      });

      if (sections.length === 0) {
        return {
          success: false,
          subjectType: "JUPYTER",
          extractedText: "",
          summary: { fileName, extension: ext, lineCount: 0, functions: [], classes: [] },
          errorReason: `File Jupyter Notebook '${fileName}' không có bất kỳ cell code hoặc nội dung nào.`,
        };
      }

      const header = [
        `=== JUPYTER NOTEBOOK: ${fileName} ===`,
        `Tổng số cell: ${nb.cells.length} | Tổng dòng code: ${totalCodeLines}`,
        functions.length > 0 ? `Hàm (def): ${functions.join(", ")}` : null,
        classes.length > 0 ? `Lớp (class): ${classes.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      return {
        success: true,
        subjectType: "JUPYTER",
        extractedText: `${header}\n\n${sections.join("\n\n")}`,
        summary: {
          fileName,
          extension: ext,
          lineCount: totalCodeLines,
          functions,
          classes,
          notebookCells: nb.cells.length,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        subjectType: "JUPYTER",
        extractedText: "",
        summary: { fileName, extension: ext, lineCount: 0, functions: [], classes: [] },
        errorReason: `Không thể đọc JSON của Jupyter Notebook '${fileName}': ${err?.message || "JSON hỏng"}`,
      };
    }
  }

  // 2. PyQt6 UI XML (.ui)
  if (ext === ".ui") {
    const trimmed = rawText.trim();
    if (!trimmed.includes("<ui") || !trimmed.includes("</ui>") || !trimmed.includes("<widget")) {
      return {
        success: false,
        subjectType: "PYQT6",
        extractedText: "",
        summary: { fileName, extension: ext, lineCount: 0, functions: [], classes: [] },
        errorReason: `File giao diện PyQt6 '${fileName}' không đúng định dạng XML (<ui>...<widget>...</ui>).`,
      };
    }

    const lines = rawText.split(/\r?\n/);
    const widgetMatches = Array.from(
      rawText.matchAll(/<widget\s+class="([^"]+)"\s+name="([^"]+)"/g)
    ).map((m) => `${m[2]} (${m[1]})`);
    const connectionMatches = Array.from(
      rawText.matchAll(/<signal>([^<]+)<\/signal>[\s\S]*?<slot>([^<]+)<\/slot>/g)
    ).map((m) => `${m[1]} -> ${m[2]}`);

    const header = [
      `=== PYQT6 DESIGNER UI: ${fileName} ===`,
      `Số dòng XML: ${lines.length}`,
      `Danh sách Widgets (${widgetMatches.length}): ${widgetMatches.join(", ") || "Không có"}`,
      connectionMatches.length > 0
        ? `Kết nối Signal/Slot trong UI: ${connectionMatches.join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      success: true,
      subjectType: "PYQT6",
      extractedText: `${header}\n\n${rawText}`,
      summary: {
        fileName,
        extension: ext,
        lineCount: lines.length,
        functions: [],
        classes: widgetMatches,
        signalsAndSlots: connectionMatches,
      },
    };
  }

  // 3. Python (.py) or Qt Style Sheet (.qss)
  if (ext === ".py" || ext === ".qss") {
    const lines = rawText.split(/\r?\n/);
    const functions: string[] = [];
    const classes: string[] = [];
    const signalsAndSlots: string[] = [];

    for (const line of lines) {
      const fnMatch = line.match(/^\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
      if (fnMatch) functions.push(fnMatch[1]);
      const clsMatch = line.match(/^\s*class\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (clsMatch) classes.push(clsMatch[1]);
      if (/\.connect\s*\(|pyqtSignal|loadUi\s*\(/i.test(line)) {
        signalsAndSlots.push(line.trim());
      }
    }

    const isPyQt =
      ext === ".qss" ||
      /PyQt6|PyQt5|PySide6|QMainWindow|QApplication|QWidget|loadUi/i.test(rawText);

    const numberedCode = lines
      .map((line, i) => `${String(i + 1).padStart(3, " ")} | ${line}`)
      .join("\n");

    const header = [
      `=== ${isPyQt ? "PYQT6 / PYTHON" : "PYTHON SOURCE"}: ${fileName} ===`,
      `Số dòng: ${lines.length}`,
      functions.length > 0 ? `Hàm (def): ${functions.join(", ")}` : null,
      classes.length > 0 ? `Lớp (class): ${classes.join(", ")}` : null,
      signalsAndSlots.length > 0
        ? `Signal/Slot & UI Loader: ${signalsAndSlots.slice(0, 15).join(" ; ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      success: true,
      subjectType: isPyQt ? "PYQT6" : "PYTHON",
      extractedText: `${header}\n\n${numberedCode}`,
      summary: {
        fileName,
        extension: ext,
        lineCount: lines.length,
        functions,
        classes,
        signalsAndSlots,
      },
    };
  }

  // 4. Web (.html, .css, .js, .ts, .jsx, .tsx)
  if ([".html", ".htm", ".css", ".js", ".ts", ".jsx", ".tsx"].includes(ext)) {
    const lines = rawText.split(/\r?\n/);
    const functions: string[] = [];
    const htmlTags: string[] = [];

    if (ext === ".html" || ext === ".htm") {
      const tagMatches = Array.from(rawText.matchAll(/<\s*([a-zA-Z][a-zA-Z0-9-]*)\b/g)).map((m) =>
        m[1].toLowerCase()
      );
      const uniqueTags = Array.from(new Set(tagMatches));
      htmlTags.push(...uniqueTags);
    }

    if ([".js", ".ts", ".jsx", ".tsx", ".html", ".htm"].includes(ext)) {
      for (const line of lines) {
        const fnDecl = line.match(
          /(?:function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)|const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)/
        );
        if (fnDecl) {
          functions.push(fnDecl[1] || fnDecl[2]);
        }
      }
    }

    const numberedCode = lines
      .map((line, i) => `${String(i + 1).padStart(3, " ")} | ${line}`)
      .join("\n");

    const header = [
      `=== WEB SOURCE (${ext.toUpperCase()}): ${fileName} ===`,
      `Số dòng: ${lines.length}`,
      htmlTags.length > 0 ? `Thẻ HTML sử dụng: ${htmlTags.join(", ")}` : null,
      functions.length > 0 ? `Hàm JS/TS: ${functions.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      success: true,
      subjectType: "WEB",
      extractedText: `${header}\n\n${numberedCode}`,
      summary: {
        fileName,
        extension: ext,
        lineCount: lines.length,
        functions,
        classes: [],
        htmlTags,
      },
    };
  }

  // 5. SQL / Plain Text / Other code (.sql, .txt, .json, .md)
  const lines = rawText.split(/\r?\n/);
  const numberedCode = lines
    .map((line, i) => `${String(i + 1).padStart(3, " ")} | ${line}`)
    .join("\n");

  return {
    success: true,
    subjectType: ext === ".sql" ? "SQL" : "TEXT",
    extractedText: `=== FILE (${ext.toUpperCase()}): ${fileName} (${lines.length} dòng) ===\n\n${numberedCode}`,
    summary: {
      fileName,
      extension: ext,
      lineCount: lines.length,
      functions: [],
      classes: [],
    },
  };
}
