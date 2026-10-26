import {
  inspectZipArchiveSafely,
  ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES,
} from "./archive-reader";
import { isCorruptedBinaryBuffer } from "./code-reader";

export interface GameParseResult {
  success: boolean;
  subjectType: "SCRATCH" | "GAMEMAKER";
  extractedText: string;
  summary: {
    fileName: string;
    engine: "SCRATCH_SB3" | "GAMEMAKER_YYZ" | "GAMEMAKER_GML" | "GAMEMAKER_YY";
    sprites: string[];
    objectsOrTargets: string[];
    variables: string[];
    events: string[];
    blocksOrScriptsCount: number;
    opcodesUsed?: string[];
  };
  errorReason?: string;
}

/**
 * Recursively formats a Scratch 3.0 block input expression (preserving nested operands, with depth & cycle guards).
 */
function formatScratchInputExpression(
  inputSpec: unknown,
  blocksMap: Record<string, any>,
  exprVisited = new Set<string>(),
  depth = 0
): string {
  if (depth > 12) {
    return "(...)";
  }
  if (!Array.isArray(inputSpec) || inputSpec.length < 2) {
    return JSON.stringify(inputSpec ?? null);
  }
  const inner = inputSpec[1];
  if (Array.isArray(inner) && inner.length >= 2) {
    return JSON.stringify(inner[1]);
  }
  if (typeof inner === "string") {
    if (!blocksMap || !blocksMap[inner]) {
      return JSON.stringify(inner);
    }
    if (exprVisited.has(inner)) {
      return `(cycle:${inner})`;
    }
    const nextVisited = new Set(exprVisited);
    nextVisited.add(inner);

    const innerBlk = blocksMap[inner];
    if (!innerBlk || typeof innerBlk !== "object" || Array.isArray(innerBlk)) {
      return JSON.stringify(inner);
    }
    const innerOp = String(innerBlk.opcode || inner);
    const detailParts: string[] = [];

    if (innerBlk.fields && typeof innerBlk.fields === "object") {
      for (const [fKey, fVal] of Object.entries(innerBlk.fields)) {
        const val = Array.isArray(fVal) ? fVal[0] : fVal;
        if (val !== undefined && val !== null) {
          detailParts.push(`${fKey}="${String(val)}"`);
        }
      }
    }

    if (innerBlk.inputs && typeof innerBlk.inputs === "object") {
      for (const [subKey, subVal] of Object.entries(innerBlk.inputs)) {
        if (subKey === "SUBSTACK" || subKey === "SUBSTACK2") continue;
        detailParts.push(
          `${subKey}=${formatScratchInputExpression(subVal, blocksMap, nextVisited, depth + 1)}`
        );
      }
    }

    return `(${innerOp}${detailParts.length > 0 ? ` ${detailParts.join(", ")}` : ""})`;
  }
  return JSON.stringify(inner ?? null);
}

/**
 * Formats a Scratch 3.0 block tree starting from a top-level/hat block into readable pseudo-code.
 */
function formatScratchBlockChain(
  startBlockId: string,
  blocksMap: Record<string, any>,
  visited = new Set<string>(),
  indent = "    "
): string[] {
  const lines: string[] = [];
  let currentId: string | null = startBlockId;
  let guard = 0;

  while (currentId && blocksMap[currentId] && !visited.has(currentId) && guard < 200) {
    visited.add(currentId);
    guard++;
    const blk: any = blocksMap[currentId];
    if (!blk || typeof blk !== "object" || Array.isArray(blk)) break;

    const opcode = String(blk.opcode || "unknown_block");

    // Extract field values (e.g., KEY_OPTION, BROADCAST_OPTION, VARIABLE)
    const fieldSummaries: string[] = [];
    if (blk.fields && typeof blk.fields === "object") {
      for (const [fKey, fVal] of Object.entries(blk.fields)) {
        const val = Array.isArray(fVal) ? fVal[0] : fVal;
        if (val !== undefined && val !== null) {
          fieldSummaries.push(`${fKey}="${String(val)}"`);
        }
      }
    }

    // Extract literal or nested input expressions
    const inputSummaries: string[] = [];
    let substackId: string | null = null;
    let substack2Id: string | null = null;

    if (blk.inputs && typeof blk.inputs === "object") {
      for (const [iKey, iVal] of Object.entries(blk.inputs)) {
        if (iKey === "SUBSTACK" && Array.isArray(iVal)) {
          substackId = typeof iVal[1] === "string" ? iVal[1] : null;
          continue;
        }
        if (iKey === "SUBSTACK2" && Array.isArray(iVal)) {
          substack2Id = typeof iVal[1] === "string" ? iVal[1] : null;
          continue;
        }
        if (Array.isArray(iVal)) {
          inputSummaries.push(
            `${iKey}=${formatScratchInputExpression(iVal, blocksMap, new Set([currentId]), 0)}`
          );
        }
      }
    }

    const argsText = [...fieldSummaries, ...inputSummaries].join(", ");
    lines.push(`${indent}[${opcode}]${argsText ? ` (${argsText})` : ""}`);

    if (substackId) {
      lines.push(`${indent}  DO:`);
      lines.push(
        ...formatScratchBlockChain(substackId, blocksMap, visited, indent + "    ")
      );
    }
    if (substack2Id) {
      lines.push(`${indent}  ELSE:`);
      lines.push(
        ...formatScratchBlockChain(substack2Id, blocksMap, visited, indent + "    ")
      );
    }

    currentId = typeof blk.next === "string" ? blk.next : null;
  }

  return lines;
}

/**
 * Parses a Scratch 3.0 (.sb3) archive buffer by extracting and analyzing `project.json`.
 */
export function parseScratchSb3Buffer(
  sb3Buffer: Buffer,
  fileName: string
): GameParseResult {
  const inspection = inspectZipArchiveSafely(sb3Buffer, fileName, {
    maxTotalBytes: ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES,
    maxFiles: 500,
    maxDepth: 10,
  });

  if (!inspection.valid) {
    return {
      success: false,
      subjectType: "SCRATCH",
      extractedText: "",
      summary: {
        fileName,
        engine: "SCRATCH_SB3",
        sprites: [],
        objectsOrTargets: [],
        variables: [],
        events: [],
        blocksOrScriptsCount: 0,
      },
      errorReason: inspection.errorReason,
    };
  }

  const projectJsonEntry = inspection.entries.find(
    (e) => e.normalizedPath.toLowerCase() === "project.json" || e.normalizedPath.toLowerCase().endsWith("/project.json")
  );

  if (!projectJsonEntry) {
    return {
      success: false,
      subjectType: "SCRATCH",
      extractedText: "",
      summary: {
        fileName,
        engine: "SCRATCH_SB3",
        sprites: [],
        objectsOrTargets: [],
        variables: [],
        events: [],
        blocksOrScriptsCount: 0,
      },
      errorReason: `File Scratch '${fileName}' không hợp lệ: Không tìm thấy 'project.json' bên trong gói .sb3.`,
    };
  }

  let projectObj: any;
  try {
    const rawJson = projectJsonEntry.getData().toString("utf8");
    projectObj = JSON.parse(rawJson);
  } catch (err: any) {
    return {
      success: false,
      subjectType: "SCRATCH",
      extractedText: "",
      summary: {
        fileName,
        engine: "SCRATCH_SB3",
        sprites: [],
        objectsOrTargets: [],
        variables: [],
        events: [],
        blocksOrScriptsCount: 0,
      },
      errorReason: `Không thể phân tích 'project.json' trong '${fileName}': ${err?.message || "Invalid JSON"}`,
    };
  }

  if (!projectObj || !Array.isArray(projectObj.targets)) {
    return {
      success: false,
      subjectType: "SCRATCH",
      extractedText: "",
      summary: {
        fileName,
        engine: "SCRATCH_SB3",
        sprites: [],
        objectsOrTargets: [],
        variables: [],
        events: [],
        blocksOrScriptsCount: 0,
      },
      errorReason: `Cấu trúc 'project.json' trong '${fileName}' bị lỗi (thiếu mảng 'targets').`,
    };
  }

  const sprites: string[] = [];
  const targetsSummary: string[] = [];
  const allVariables: string[] = [];
  const allEvents: string[] = [];
  const opcodeSet = new Set<string>();
  let totalBlocks = 0;

  for (const target of projectObj.targets) {
    const targetName = String(target?.name || "Unnamed");
    const isStage = Boolean(target?.isStage);
    if (!isStage) {
      sprites.push(targetName);
    }

    const varsMap = target?.variables && typeof target.variables === "object" ? target.variables : {};
    const listsMap = target?.lists && typeof target.lists === "object" ? target.lists : {};
    const broadcastsMap =
      target?.broadcasts && typeof target.broadcasts === "object" ? target.broadcasts : {};
    const blocksMap = target?.blocks && typeof target.blocks === "object" ? target.blocks : {};

    const targetVars: string[] = [];
    for (const vVal of Object.values(varsMap)) {
      if (Array.isArray(vVal) && vVal.length >= 2) {
        const desc = `${vVal[0]} = ${JSON.stringify(vVal[1])}`;
        targetVars.push(desc);
        allVariables.push(`${targetName}.${vVal[0]}`);
      }
    }
    for (const lVal of Object.values(listsMap)) {
      if (Array.isArray(lVal) && lVal.length >= 1) {
        targetVars.push(`List[${lVal[0]}]`);
        allVariables.push(`${targetName}.List[${lVal[0]}]`);
      }
    }

    const targetBroadcasts = Object.values(broadcastsMap).map((b) => String(b));
    const blockIds = Object.keys(blocksMap);
    const topLevelIds: string[] = [];

    for (const bId of blockIds) {
      const blk = blocksMap[bId];
      if (blk && typeof blk === "object" && !Array.isArray(blk)) {
        totalBlocks++;
        const op = String(blk.opcode || "");
        if (op) opcodeSet.add(op);
        if (blk.topLevel || op.startsWith("event_") || op === "control_start_as_clone" || op === "procedures_definition") {
          topLevelIds.push(bId);
          if (op) allEvents.push(`${targetName}:${op}`);
        }
      }
    }

    const visited = new Set<string>();
    const scriptChains: string[] = [];
    for (const topId of topLevelIds) {
      if (!visited.has(topId)) {
        const chainLines = formatScratchBlockChain(topId, blocksMap, visited, "    ");
        if (chainLines.length > 0) {
          scriptChains.push(chainLines.join("\n"));
        }
      }
    }

    const costumesCount = Array.isArray(target?.costumes) ? target.costumes.length : 0;
    const soundsCount = Array.isArray(target?.sounds) ? target.sounds.length : 0;

    targetsSummary.push(
      [
        `--- ${isStage ? "STAGE (Sân khấu)" : `SPRITE (Nhân vật): ${targetName}`} ---`,
        !isStage
          ? `  Vị trí: (x=${target.x ?? 0}, y=${target.y ?? 0}), size=${target.size ?? 100}%, direction=${target.direction ?? 90}, visible=${target.visible ?? true}`
          : null,
        `  Trang phục (Costumes): ${costumesCount} | Âm thanh (Sounds): ${soundsCount}`,
        targetVars.length > 0 ? `  Biến số / Danh sách: ${targetVars.join(", ")}` : null,
        targetBroadcasts.length > 0 ? `  Thông điệp (Broadcasts): ${targetBroadcasts.join(", ")}` : null,
        `  Số khối lệnh (Blocks): ${blockIds.length}`,
        scriptChains.length > 0
          ? `  Cấu trúc kịch bản (Scripts):\n${scriptChains.join("\n\n")}`
          : `  (Không có kịch bản khối lệnh nào trong ${targetName})`,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  const opcodesUsed = Array.from(opcodeSet).sort();

  const header = [
    `=== SCRATCH 3.0 PROJECT (.SB3): ${fileName} ===`,
    `Tổng số nhân vật (Sprites): ${sprites.length} (${sprites.join(", ") || "Không có"})`,
    `Tổng số khối lệnh (Blocks): ${totalBlocks}`,
    `Biến số (Variables): ${allVariables.join(", ") || "Không có"}`,
    `Sự kiện (Events): ${allEvents.join(", ") || "Không có"}`,
    `Danh sách Opcode đã dùng (${opcodesUsed.length}): ${opcodesUsed.join(", ") || "Không có"}`,
  ].join("\n");

  return {
    success: true,
    subjectType: "SCRATCH",
    extractedText: `${header}\n\n${targetsSummary.join("\n\n")}`,
    summary: {
      fileName,
      engine: "SCRATCH_SB3",
      sprites,
      objectsOrTargets: projectObj.targets.map((t: any) => String(t?.name || "Unnamed")),
      variables: allVariables,
      events: allEvents,
      blocksOrScriptsCount: totalBlocks,
      opcodesUsed,
    },
  };
}

/**
 * Safely parses GameMaker's relaxed JSON (.yy / .yyp) which often contains trailing commas.
 */
function parseGameMakerJsonRelaxed(rawText: string): any {
  const cleaned = rawText
    .replace(/^\uFEFF/, "")
    .replace(/,\s*([\]}])/g, "$1");
  return JSON.parse(cleaned);
}

const GM_EVENT_TYPE_MAP: Record<number, string> = {
  0: "Create",
  1: "Destroy",
  2: "Alarm",
  3: "Step",
  4: "Collision",
  5: "Keyboard",
  6: "Mouse",
  7: "Other",
  8: "Draw",
  9: "KeyPress",
  10: "KeyRelease",
  12: "CleanUp",
  13: "Gesture",
};

/**
 * Parses GameMaker files:
 * - `.yyz` exported project archive (ZIP containing .yyp, .yy, .gml)
 * - `.gml` standalone GameMaker Language script
 * - `.yy` standalone GameMaker object/resource metadata
 */
export function parseGameMakerBuffer(
  buffer: Buffer,
  fileName: string,
  extension: string
): GameParseResult {
  const ext = extension.toLowerCase();

  // 1. Standalone .gml script
  if (ext === ".gml") {
    if (buffer.length === 0 || isCorruptedBinaryBuffer(buffer)) {
      return {
        success: false,
        subjectType: "GAMEMAKER",
        extractedText: "",
        summary: {
          fileName,
          engine: "GAMEMAKER_GML",
          sprites: [],
          objectsOrTargets: [],
          variables: [],
          events: [],
          blocksOrScriptsCount: 0,
        },
        errorReason: `File GML '${fileName}' rỗng hoặc bị hỏng định dạng văn bản.`,
      };
    }

    const rawCode = buffer.toString("utf8").replace(/^\uFEFF/, "");
    const lines = rawCode.split(/\r?\n/);
    const numbered = lines
      .map((l, i) => `${String(i + 1).padStart(3, " ")} | ${l}`)
      .join("\n");

    return {
      success: true,
      subjectType: "GAMEMAKER",
      extractedText: `=== GAMEMAKER SCRIPT (.GML): ${fileName} (${lines.length} dòng) ===\n\n${numbered}`,
      summary: {
        fileName,
        engine: "GAMEMAKER_GML",
        sprites: [],
        objectsOrTargets: [],
        variables: [],
        events: [fileName],
        blocksOrScriptsCount: 1,
      },
    };
  }

  // 2. Standalone .yy metadata file
  if (ext === ".yy") {
    if (buffer.length === 0 || isCorruptedBinaryBuffer(buffer)) {
      return {
        success: false,
        subjectType: "GAMEMAKER",
        extractedText: "",
        summary: {
          fileName,
          engine: "GAMEMAKER_YY",
          sprites: [],
          objectsOrTargets: [],
          variables: [],
          events: [],
          blocksOrScriptsCount: 0,
        },
        errorReason: `File cấu hình GameMaker '${fileName}' rỗng hoặc bị hỏng.`,
      };
    }

    const rawText = buffer.toString("utf8");
    try {
      const yyObj = parseGameMakerJsonRelaxed(rawText);
      const objName = String(yyObj?.name || yyObj?.$GMObject || fileName);
      const events: string[] = [];
      if (Array.isArray(yyObj?.eventList)) {
        for (const ev of yyObj.eventList) {
          const evType = GM_EVENT_TYPE_MAP[Number(ev?.eventType)] || `EventType_${ev?.eventType}`;
          const evNum = ev?.eventNum ?? 0;
          const colId = ev?.collisionObjectId?.name ? ` (${ev.collisionObjectId.name})` : "";
          events.push(`${evType}_${evNum}${colId}`);
        }
      }

      return {
        success: true,
        subjectType: "GAMEMAKER",
        extractedText: [
          `=== GAMEMAKER RESOURCE (.YY): ${fileName} ===`,
          `Tên đối tượng: ${objName}`,
          events.length > 0 ? `Danh sách sự kiện (Events): ${events.join(", ")}` : null,
          `\nNội dung chi tiết:\n${rawText}`,
        ]
          .filter(Boolean)
          .join("\n"),
        summary: {
          fileName,
          engine: "GAMEMAKER_YY",
          sprites: [],
          objectsOrTargets: [objName],
          variables: [],
          events,
          blocksOrScriptsCount: events.length,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        subjectType: "GAMEMAKER",
        extractedText: "",
        summary: {
          fileName,
          engine: "GAMEMAKER_YY",
          sprites: [],
          objectsOrTargets: [],
          variables: [],
          events: [],
          blocksOrScriptsCount: 0,
        },
        errorReason: `File GameMaker .yy '${fileName}' không đúng cấu trúc JSON: ${err?.message || "Invalid YY JSON"}`,
      };
    }
  }

  // 3. GameMaker Project Archive (.yyz)
  // Check if student accidentally uploaded a RAR archive renamed to .yyz
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x61 &&
    buffer[2] === 0x72 &&
    buffer[3] === 0x21
  ) {
    return {
      success: false,
      subjectType: "GAMEMAKER",
      extractedText: "",
      summary: {
        fileName,
        engine: "GAMEMAKER_YYZ",
        sprites: [],
        objectsOrTargets: [],
        variables: [],
        events: [],
        blocksOrScriptsCount: 0,
      },
      errorReason: `File '${fileName}' thực chất là file nén WinRAR (.rar) được đổi đuôi sang .yyz, không phải gói Export YYZ chuẩn của GameMaker.`,
    };
  }

  const inspection = inspectZipArchiveSafely(buffer, fileName, {
    maxTotalBytes: ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES,
    maxFiles: 500,
    maxDepth: 12,
  });

  if (!inspection.valid) {
    return {
      success: false,
      subjectType: "GAMEMAKER",
      extractedText: "",
      summary: {
        fileName,
        engine: "GAMEMAKER_YYZ",
        sprites: [],
        objectsOrTargets: [],
        variables: [],
        events: [],
        blocksOrScriptsCount: 0,
      },
      errorReason: inspection.errorReason,
    };
  }

  const sprites: string[] = [];
  const objects: string[] = [];
  const rooms: string[] = [];
  const events: string[] = [];
  const gmlSections: string[] = [];
  const objectSummaries: string[] = [];
  const roomSummaries: string[] = [];
  let actualUncompressedBytes = 0;

  for (const entry of inspection.entries) {
    let dataBuf: Buffer;
    try {
      dataBuf = entry.getData();
    } catch (err: any) {
      return {
        success: false,
        subjectType: "GAMEMAKER",
        extractedText: "",
        summary: {
          fileName,
          engine: "GAMEMAKER_YYZ",
          sprites: [],
          objectsOrTargets: [],
          variables: [],
          events: [],
          blocksOrScriptsCount: 0,
        },
        errorReason: `Không thể giải nén '${entry.normalizedPath}' trong '${fileName}': ${err?.message || "Corrupted entry"}`,
      };
    }

    actualUncompressedBytes += dataBuf.length;
    if (actualUncompressedBytes > ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES) {
      return {
        success: false,
        subjectType: "GAMEMAKER",
        extractedText: "",
        summary: {
          fileName,
          engine: "GAMEMAKER_YYZ",
          sprites: [],
          objectsOrTargets: [],
          variables: [],
          events: [],
          blocksOrScriptsCount: 0,
        },
        errorReason: `[Zip Bomb Protection] Tổng dung lượng giải nén thực tế của '${fileName}' vượt quá 50MB.`,
      };
    }

    const normLower = entry.normalizedPath.toLowerCase();

    if (entry.extension === ".gml") {
      if (dataBuf.length === 0 || isCorruptedBinaryBuffer(dataBuf)) {
        return {
          success: false,
          subjectType: "GAMEMAKER",
          extractedText: "",
          summary: {
            fileName,
            engine: "GAMEMAKER_YYZ",
            sprites: [],
            objectsOrTargets: [],
            variables: [],
            events: [],
            blocksOrScriptsCount: 0,
          },
          errorReason: `File GML '${entry.normalizedPath}' trong gói '${fileName}' rỗng hoặc bị hỏng định dạng mã nguồn.`,
        };
      }
      const codeText = dataBuf.toString("utf8").replace(/^\uFEFF/, "").trim();
      events.push(entry.normalizedPath);
      gmlSections.push(
        `--- [GML SCRIPT: ${entry.normalizedPath}] ---\n${codeText || "(Trống)"}`
      );
    } else if (entry.extension === ".yy" || entry.extension === ".yyp") {
      if (dataBuf.length === 0 || isCorruptedBinaryBuffer(dataBuf)) {
        return {
          success: false,
          subjectType: "GAMEMAKER",
          extractedText: "",
          summary: {
            fileName,
            engine: "GAMEMAKER_YYZ",
            sprites: [],
            objectsOrTargets: [],
            variables: [],
            events: [],
            blocksOrScriptsCount: 0,
          },
          errorReason: `File tài nguyên GameMaker '${entry.normalizedPath}' trong gói '${fileName}' rỗng hoặc bị hỏng định dạng dữ liệu.`,
        };
      }
      let yy: any;
      try {
        yy = parseGameMakerJsonRelaxed(dataBuf.toString("utf8"));
      } catch (err: any) {
        return {
          success: false,
          subjectType: "GAMEMAKER",
          extractedText: "",
          summary: {
            fileName,
            engine: "GAMEMAKER_YYZ",
            sprites: [],
            objectsOrTargets: [],
            variables: [],
            events: [],
            blocksOrScriptsCount: 0,
          },
          errorReason: `File tài nguyên GameMaker '${entry.normalizedPath}' trong gói '${fileName}' bị lỗi cấu trúc JSON: ${
            err?.message || "Invalid YY JSON"
          }`,
        };
      }
      if (entry.extension === ".yy") {
        const resName = String(yy?.name || entry.normalizedPath);
        if (normLower.startsWith("sprites/") || yy?.resourceType === "GMSprite" || yy?.$GMSprite) {
          sprites.push(resName);
        } else if (
          normLower.startsWith("objects/") ||
          yy?.resourceType === "GMObject" ||
          yy?.$GMObject
        ) {
          objects.push(resName);
          const spriteRef = yy?.spriteId?.name || "Không gắn Sprite";
          const solid = Boolean(yy?.solid);
          const visible = yy?.visible !== false;
          const objEvents: string[] = [];
          if (Array.isArray(yy?.eventList)) {
            for (const ev of yy.eventList) {
              const evType =
                GM_EVENT_TYPE_MAP[Number(ev?.eventType)] || `EventType_${ev?.eventType}`;
              const evNum = ev?.eventNum ?? 0;
              const colName = ev?.collisionObjectId?.name
                ? ` -> va chạm với ${ev.collisionObjectId.name}`
                : "";
              const evLabel = `${resName}:${evType}_${evNum}${colName}`;
              objEvents.push(evLabel);
              events.push(evLabel);
            }
          }
          objectSummaries.push(
            `  • Object '${resName}' (Sprite: ${spriteRef}, Visible: ${visible}, Solid: ${solid}) | Events (${objEvents.length}): ${
              objEvents.join(", ") || "Chưa có sự kiện"
            }`
          );
        } else if (normLower.startsWith("rooms/") || yy?.resourceType === "GMRoom" || yy?.$GMRoom) {
          rooms.push(resName);
          const layers = Array.isArray(yy?.layers) ? yy.layers : [];
          const instanceNames: string[] = [];
          for (const layer of layers) {
            if (Array.isArray(layer?.instances)) {
              for (const inst of layer.instances) {
                const objIdName = inst?.objectId?.name || inst?.name || "instance";
                instanceNames.push(objIdName);
              }
            }
          }
          roomSummaries.push(
            `  • Room '${resName}' (${layers.length} layers, ${instanceNames.length} instances đặt trong màn chơi: ${
              Array.from(new Set(instanceNames)).join(", ") || "Trống"
            })`
          );
        }
      }
    }
  }

  if (
    gmlSections.length === 0 &&
    objects.length === 0 &&
    sprites.length === 0 &&
    rooms.length === 0
  ) {
    return {
      success: false,
      subjectType: "GAMEMAKER",
      extractedText: "",
      summary: {
        fileName,
        engine: "GAMEMAKER_YYZ",
        sprites: [],
        objectsOrTargets: [],
        variables: [],
        events: [],
        blocksOrScriptsCount: 0,
      },
      errorReason: `Gói GameMaker '${fileName}' không chứa tài nguyên hợp lệ (không có Object, Sprite, Room hay mã GML nào).`,
    };
  }

  const header = [
    `=== GAMEMAKER PROJECT (.YYZ): ${fileName} ===`,
    `Tổng số Sprites (${sprites.length}): ${sprites.join(", ") || "Không có"}`,
    `Tổng số Objects (${objects.length}): ${objects.join(", ") || "Không có"}`,
    `Tổng số Rooms (${rooms.length}): ${rooms.join(", ") || "Không có"}`,
    `Tổng số file code .GML: ${gmlSections.length}`,
    objectSummaries.length > 0
      ? `\n--- CẤU TRÚC OBJECTS & EVENTS ---\n${objectSummaries.join("\n")}`
      : null,
    roomSummaries.length > 0
      ? `\n--- CẤU TRÚC ROOMS (MÀN CHƠI) ---\n${roomSummaries.join("\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const fullText =
    gmlSections.length > 0
      ? `${header}\n\n--- MÃ NGUỒN CHI TIẾT (.GML) ---\n\n${gmlSections.join("\n\n")}`
      : `${header}\n\n(Dự án sử dụng cấu hình Drag & Drop / Resource Editor, không có file script .gml rời)`;

  return {
    success: true,
    subjectType: "GAMEMAKER",
    extractedText: fullText,
    summary: {
      fileName,
      engine: "GAMEMAKER_YYZ",
      sprites,
      objectsOrTargets: objects,
      variables: [],
      events: Array.from(new Set(events)),
      blocksOrScriptsCount: gmlSections.length || events.length,
    },
  };
}
