/**
 * MINDX AUTOMATION BOT - SPCK IMAGE NORMALIZER (LMS 16:9 SAFE SIZE)
 * Normalizes captured App/Web screenshots and YouTube presentation frames into
 * the LMS-safe 16:9 size `960×540` so the MindX LMS image viewer (≈ 960px wide)
 * always shows the whole image without cropping the left/right edges or showing
 * a horizontal scrollbar.
 *
 * - `contain`: keeps the WHOLE source image visible (used for PyQt App windows of any ratio),
 *   centered on a softly darkened backdrop copy of itself instead of hard black bars.
 * - `cover`: fills the 16:9 frame and center-crops overflow (used for YouTube frames that
 *   are 4:3 letterboxed, e.g. `sd1.jpg` / `hq1.jpg`).
 *
 * Implemented purely in-memory in Node.js (`node:zlib`) for standard PNGs with an offline
 * local `PyQt6.QtGui.QImage` fallback for JPEG/WEBP/GIF — never spawns a Playwright
 * `Browser` or `BrowserContext`, strictly honoring the single-BrowserContext rule.
 */

import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import zlib from "node:zlib";
import { taskQueue } from "@/lib/queue/task-queue";

export const LMS_IMAGE_WIDTH = 960;
export const LMS_IMAGE_HEIGHT = 540;

export type SpckImageFitMode = "contain" | "cover";

export interface NormalizeImageJob {
  buffer: Buffer;
  mimeType?: string;
  fit: SpckImageFitMode;
}

export function isSupportedImageMagic(buf: Buffer): boolean {
  if (!buf || buf.length < 12) return false;
  // PNG
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return true;
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return true;
  }
  // WEBP
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return true;
  }
  // GIF
  const gifHeader = buf.toString("ascii", 0, 6);
  if (gifHeader === "GIF87a" || gifHeader === "GIF89a") {
    return true;
  }
  return false;
}

export function detectImageMimeType(buf: Buffer, fallback = "image/png"): string {
  if (!buf || buf.length < 12) return fallback;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
  return fallback;
}

interface DecodedRgbImage {
  width: number;
  height: number;
  rgb: Uint8Array; // width * height * 3 (R, G, B)
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodeStandardPngToRgb(buf: Buffer): DecodedRgbImage | null {
  if (!buf || buf.length < 33) return null;
  if (
    buf[0] !== 0x89 ||
    buf[1] !== 0x50 ||
    buf[2] !== 0x4e ||
    buf[3] !== 0x47 ||
    buf[4] !== 0x0d ||
    buf[5] !== 0x0a ||
    buf[6] !== 0x1a ||
    buf[7] !== 0x0a
  ) {
    return null;
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatParts: Buffer[] = [];

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buf.length) return null;

    if (type === "IHDR") {
      if (length < 13) return null;
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
      interlace = buf[dataStart + 12];
    } else if (type === "IDAT") {
      idatParts.push(buf.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  if (
    width <= 0 ||
    height <= 0 ||
    width > 8192 ||
    height > 8192 ||
    bitDepth !== 8 ||
    interlace !== 0 ||
    (colorType !== 2 && colorType !== 6) ||
    idatParts.length === 0
  ) {
    return null;
  }

  const bpp = colorType === 2 ? 3 : 4;
  const stride = width * bpp;
  const expectedRawLen = height * (1 + stride);
  let inflated: Buffer;
  try {
    inflated = zlib.inflateSync(Buffer.concat(idatParts));
  } catch {
    return null;
  }
  if (inflated.length < expectedRawLen) return null;

  const rgb = new Uint8Array(width * height * 3);
  let prevScanline = new Uint8Array(stride);
  let currScanline = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + stride);
    const filterType = inflated[rowStart];
    const srcRow = rowStart + 1;

    for (let i = 0; i < stride; i++) {
      const rawByte = inflated[srcRow + i];
      const a = i >= bpp ? currScanline[i - bpp] : 0;
      const b = y > 0 ? prevScanline[i] : 0;
      const c = i >= bpp && y > 0 ? prevScanline[i - bpp] : 0;

      let val = rawByte;
      if (filterType === 1) {
        val = (rawByte + a) & 0xff;
      } else if (filterType === 2) {
        val = (rawByte + b) & 0xff;
      } else if (filterType === 3) {
        val = (rawByte + ((a + b) >> 1)) & 0xff;
      } else if (filterType === 4) {
        val = (rawByte + paethPredictor(a, b, c)) & 0xff;
      } else if (filterType !== 0) {
        return null;
      }
      currScanline[i] = val;
    }

    const dstRowOffset = y * width * 3;
    if (bpp === 3) {
      rgb.set(currScanline, dstRowOffset);
    } else {
      for (let x = 0; x < width; x++) {
        const sIdx = x * 4;
        const dIdx = dstRowOffset + x * 3;
        const alpha = currScanline[sIdx + 3] / 255;
        // Composite over dark slate (#0f172a -> R:15, G:23, B:42)
        rgb[dIdx] = Math.round(currScanline[sIdx] * alpha + 15 * (1 - alpha));
        rgb[dIdx + 1] = Math.round(currScanline[sIdx + 1] * alpha + 23 * (1 - alpha));
        rgb[dIdx + 2] = Math.round(currScanline[sIdx + 2] * alpha + 42 * (1 - alpha));
      }
    }

    const tmp = prevScanline;
    prevScanline = currScanline;
    currScanline = tmp;
  }

  return { width, height, rgb };
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodeRgbToPng(width: number, height: number, rgb: Uint8Array): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowBytes = 1 + width * 3;
  const raw = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const rawRowStart = y * rowBytes;
    raw[rawRowStart] = 0; // Filter None
    const srcStart = y * width * 3;
    raw.set(rgb.subarray(srcStart, srcStart + width * 3), rawRowStart + 1);
  }

  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    sig,
    makePngChunk("IHDR", ihdr),
    makePngChunk("IDAT", idat),
    makePngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function renderNormalizedRgbToLms16x9(src: DecodedRgbImage, fit: SpckImageFitMode): Buffer {
  const W = LMS_IMAGE_WIDTH;
  const H = LMS_IMAGE_HEIGHT;
  const out = new Uint8Array(W * H * 3);

  // Fill background: for `contain`, fill with darkened cover sample; for `cover`, draw cover directly
  const coverScale = Math.max(W / src.width, H / src.height);
  const coverW = Math.max(1, Math.round(src.width * coverScale));
  const coverH = Math.max(1, Math.round(src.height * coverScale));
  const coverOffX = Math.floor((W - coverW) / 2);
  const coverOffY = Math.floor((H - coverH) / 2);

  for (let y = 0; y < H; y++) {
    const sy = Math.min(
      src.height - 1,
      Math.max(0, Math.floor(((y - coverOffY) * src.height) / coverH))
    );
    for (let x = 0; x < W; x++) {
      const sx = Math.min(
        src.width - 1,
        Math.max(0, Math.floor(((x - coverOffX) * src.width) / coverW))
      );
      const sIdx = (sy * src.width + sx) * 3;
      const dIdx = (y * W + x) * 3;
      if (fit === "cover") {
        out[dIdx] = src.rgb[sIdx];
        out[dIdx + 1] = src.rgb[sIdx + 1];
        out[dIdx + 2] = src.rgb[sIdx + 2];
      } else {
        // Darkened backdrop (#0f172a blend)
        out[dIdx] = Math.round(src.rgb[sIdx] * 0.45 + 8);
        out[dIdx + 1] = Math.round(src.rgb[sIdx + 1] * 0.45 + 12);
        out[dIdx + 2] = Math.round(src.rgb[sIdx + 2] * 0.45 + 22);
      }
    }
  }

  if (fit === "contain") {
    const containScale = Math.min(W / src.width, H / src.height);
    const drawW = Math.max(1, Math.round(src.width * containScale));
    const drawH = Math.max(1, Math.round(src.height * containScale));
    const offX = Math.floor((W - drawW) / 2);
    const offY = Math.floor((H - drawH) / 2);

    for (let dy = 0; dy < drawH; dy++) {
      const ty = offY + dy;
      if (ty < 0 || ty >= H) continue;
      const sy = Math.min(src.height - 1, Math.max(0, Math.floor((dy * src.height) / drawH)));
      for (let dx = 0; dx < drawW; dx++) {
        const tx = offX + dx;
        if (tx < 0 || tx >= W) continue;
        const sx = Math.min(src.width - 1, Math.max(0, Math.floor((dx * src.width) / drawW)));
        const sIdx = (sy * src.width + sx) * 3;
        const dIdx = (ty * W + tx) * 3;
        out[dIdx] = src.rgb[sIdx];
        out[dIdx + 1] = src.rgb[sIdx + 1];
        out[dIdx + 2] = src.rgb[sIdx + 2];
      }
    }
  }

  return encodeRgbToPng(W, H, out);
}

function buildPyQtNormalizeScript(fit: SpckImageFitMode): string {
  const safeFit = fit === "cover" ? "cover" : "contain";
  return `
import sys, base64
from PyQt6.QtGui import QImage, QPainter, QColor
from PyQt6.QtCore import Qt, QBuffer, QIODevice, QByteArray, QRect

raw = base64.b64decode(sys.stdin.read())
img = QImage.fromData(raw)
if img.isNull() or img.width() <= 0 or img.height() <= 0:
    sys.exit(2)

W, H = ${LMS_IMAGE_WIDTH}, ${LMS_IMAGE_HEIGHT}
fit = "${safeFit}"
canvas = QImage(W, H, QImage.Format.Format_RGB32)
canvas.fill(QColor(15, 23, 42))
painter = QPainter(canvas)
painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, True)

if fit == "cover":
    scaled = img.scaled(W, H, Qt.AspectRatioMode.KeepAspectRatioByExpanding, Qt.TransformationMode.SmoothTransformation)
    ox = (W - scaled.width()) // 2
    oy = (H - scaled.height()) // 2
    painter.drawImage(ox, oy, scaled)
else:
    bg = img.scaled(W // 8, H // 8, Qt.AspectRatioMode.KeepAspectRatioByExpanding, Qt.TransformationMode.SmoothTransformation)
    bg = bg.scaled(W, H, Qt.AspectRatioMode.IgnoreAspectRatio, Qt.TransformationMode.SmoothTransformation)
    painter.setOpacity(0.45)
    painter.drawImage(0, 0, bg)
    painter.setOpacity(1.0)
    fg = img.scaled(W, H, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
    ox = (W - fg.width()) // 2
    oy = (H - fg.height()) // 2
    painter.drawImage(ox, oy, fg)

painter.end()
ba = QByteArray()
qbuf = QBuffer(ba)
qbuf.open(QIODevice.OpenModeFlag.WriteOnly)
canvas.save(qbuf, "PNG")
sys.stdout.write(base64.b64encode(bytes(ba)).decode("ascii"))
`;
}

function normalizeViaPyQtFallback(buf: Buffer, fit: SpckImageFitMode): Buffer | null {
  try {
    const pyScript = buildPyQtNormalizeScript(fit);
    const res = spawnSync("python", ["-c", pyScript], {
      input: buf.toString("base64"),
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    });
    if (res.status !== 0 || !res.stdout) return null;
    const outBuf = Buffer.from(res.stdout.trim(), "base64");
    return outBuf.length > 32 ? outBuf : null;
  } catch {
    return null;
  }
}

async function normalizeViaPyQtFallbackAsync(
  buf: Buffer,
  fit: SpckImageFitMode,
  timeoutMs = 10_000
): Promise<Buffer | null> {
  if (taskQueue.getStatus().isStopped) {
    return null;
  }

  return new Promise<Buffer | null>((resolve) => {
    let settled = false;
    let aborted = false;
    const stdoutChunks: Buffer[] = [];
    const pyScript = buildPyQtNormalizeScript(fit);

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("python", ["-c", pyScript], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      resolve(null);
      return;
    }

    const terminateChildTree = () => {
      if (aborted) return;
      aborted = true;
      try {
        child.kill("SIGKILL");
      } catch {}
      if (process.platform === "win32" && child.pid) {
        try {
          const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          });
          killer.unref();
        } catch {}
      }
    };

    const finish = (val: Buffer | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearInterval(stopPollTimer);
      resolve(val);
    };

    const timeoutTimer = setTimeout(() => {
      terminateChildTree();
      finish(null);
    }, timeoutMs);

    const stopPollTimer = setInterval(() => {
      if (taskQueue.getStatus().isStopped) {
        terminateChildTree();
        finish(null);
      }
    }, 200);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr?.on("data", () => {
      // Drain stderr to prevent pipe backpressure
    });
    child.on("error", () => {
      finish(null);
    });
    child.on("close", (code) => {
      if (aborted || code !== 0) {
        finish(null);
        return;
      }
      try {
        const b64 = Buffer.concat(stdoutChunks).toString("utf8").trim();
        if (!b64) {
          finish(null);
          return;
        }
        const outBuf = Buffer.from(b64, "base64");
        finish(outBuf.length > 32 ? outBuf : null);
      } catch {
        finish(null);
      }
    });

    try {
      child.stdin?.on("error", () => {});
      child.stdin?.end(buf.toString("base64"));
    } catch {
      terminateChildTree();
      finish(null);
    }
  });
}

/**
 * Synchronously normalizes a batch of images into PNG buffers of exactly `960×540`.
 * Returns `null` for any job whose source image cannot be decoded (caller keeps the original).
 */
export function normalizeImagesToLms16x9Sync(
  jobs: NormalizeImageJob[]
): Array<Buffer | null> {
  if (jobs.length === 0) return [];
  const results: Array<Buffer | null> = jobs.map(() => null);

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    try {
      if (!job?.buffer || job.buffer.length === 0) continue;
      if (!isSupportedImageMagic(job.buffer)) continue;

      const decodedPng = decodeStandardPngToRgb(job.buffer);
      if (decodedPng) {
        results[i] = renderNormalizedRgbToLms16x9(decodedPng, job.fit);
        continue;
      }

      results[i] = normalizeViaPyQtFallback(job.buffer, job.fit);
    } catch {
      results[i] = null;
    }
  }

  return results;
}

/**
 * Non-blocking async batch image normalizer (`960×540` PNG).
 * Never calls `spawnSync` — uses pure-Node zlib for standard PNGs and async `spawn` for JPEG/WEBP/GIF.
 */
export async function normalizeImagesToLms16x9(
  jobs: NormalizeImageJob[]
): Promise<Array<Buffer | null>> {
  if (jobs.length === 0) return [];
  const results: Array<Buffer | null> = jobs.map(() => null);

  for (let i = 0; i < jobs.length; i++) {
    if (taskQueue.getStatus().isStopped) break;
    const job = jobs[i];
    try {
      if (!job?.buffer || job.buffer.length === 0) continue;
      if (!isSupportedImageMagic(job.buffer)) continue;

      const decodedPng = decodeStandardPngToRgb(job.buffer);
      if (decodedPng) {
        results[i] = renderNormalizedRgbToLms16x9(decodedPng, job.fit);
        await new Promise<void>((r) => setImmediate(r));
        continue;
      }

      results[i] = await normalizeViaPyQtFallbackAsync(job.buffer, job.fit);
    } catch {
      results[i] = null;
    }
  }

  return results;
}

function computeScaledRgbColorRichness(rgb: Uint8Array, width: number, height: number): number {
  if (width <= 0 || height <= 0 || rgb.length < width * height * 3) return 18;
  const buckets = new Set<string>();
  const sx = Math.max(1, Math.floor(width / 40));
  const sy = Math.max(1, Math.floor(height / 40));
  for (let y = 0; y < height; y += sy) {
    for (let x = 0; x < width; x += sx) {
      const idx = (y * width + x) * 3;
      buckets.add(`${rgb[idx] >> 4},${rgb[idx + 1] >> 4},${rgb[idx + 2] >> 4}`);
    }
  }
  return Math.max(18, Math.min(140, buckets.size * 2));
}

/**
 * Pure-Node fallback to slice and downscale a raw headless Chromium/Edge PNG screenshot
 * into LMS-safe 960x540 (16:9) PNG buffers when PyQt6 is blocked or unavailable.
 */
export function sliceBrowserTallPngToLms16x9Frames(params: {
  rawPngBuffer: Buffer;
  layoutWidth: number;
  layoutHeight: number;
  maxExtraSections: number;
}): { frames: Buffer[]; richness: number[] } | null {
  const decoded = decodeStandardPngToRgb(params.rawPngBuffer);
  const LW = params.layoutWidth;
  const LH = params.layoutHeight;
  if (!decoded || decoded.width < LW || decoded.height < LH) {
    return null;
  }

  const fh = decoded.height;
  const fw = decoded.width;
  const rgb = decoded.rgb;
  const sampleXs: number[] = [];
  for (let x = 20; x < LW - 20; x += 40) {
    sampleXs.push(x);
  }
  if (sampleXs.length === 0) {
    sampleXs.push(Math.min(LW - 1, 0));
  }

  const getPixel = (x: number, y: number): [number, number, number] => {
    const idx = (y * fw + x) * 3;
    return [rgb[idx], rgb[idx + 1], rgb[idx + 2]];
  };

  const botY = fh - 1;
  const botRow = sampleXs.map((x) => getPixel(x, botY));
  let botSpread = 0;
  for (const c of botRow) {
    const d =
      Math.abs(c[0] - botRow[0][0]) +
      Math.abs(c[1] - botRow[0][1]) +
      Math.abs(c[2] - botRow[0][2]);
    if (d > botSpread) botSpread = d;
  }

  let docH = fh;
  if (botSpread <= 24) {
    docH = LH;
    for (let y = fh - 2; y >= LH; y -= 4) {
      let diff = false;
      for (let i = 0; i < sampleXs.length; i++) {
        const c = getPixel(sampleXs[i], y);
        const br = botRow[i];
        if (
          Math.abs(c[0] - br[0]) +
            Math.abs(c[1] - br[1]) +
            Math.abs(c[2] - br[2]) >
          15
        ) {
          diff = true;
          break;
        }
      }
      if (diff) {
        docH = Math.min(fh, y + 64);
        break;
      }
    }
  }

  let totalSlices = 1;
  const maxExtra = Math.max(0, Math.floor(params.maxExtraSections));
  if (maxExtra > 0 && docH >= Math.floor(LH * 1.25)) {
    totalSlices = Math.min(
      1 + maxExtra,
      Math.max(1, Math.floor((docH + Math.floor(LH * 0.7) - 1) / LH))
    );
  }

  const W = LMS_IMAGE_WIDTH;
  const H = LMS_IMAGE_HEIGHT;
  const frames: Buffer[] = [];
  const richness: number[] = [];
  let lastYOff = -9999;

  for (let sIdx = 0; sIdx < totalSlices; sIdx++) {
    const yOff = sIdx === 0 ? 0 : Math.min(sIdx * LH, Math.max(0, docH - LH));
    if (sIdx > 0 && yOff - lastYOff < Math.floor(LH * 0.35)) {
      break;
    }
    lastYOff = yOff;

    const outRgb = new Uint8Array(W * H * 3);
    for (let dy = 0; dy < H; dy++) {
      const sy = Math.min(
        fh - 1,
        Math.max(0, yOff + Math.floor((dy * LH) / H))
      );
      for (let dx = 0; dx < W; dx++) {
        const sx = Math.min(fw - 1, Math.max(0, Math.floor((dx * LW) / W)));
        const sIdxPx = (sy * fw + sx) * 3;
        const dIdxPx = (dy * W + dx) * 3;
        outRgb[dIdxPx] = rgb[sIdxPx];
        outRgb[dIdxPx + 1] = rgb[sIdxPx + 1];
        outRgb[dIdxPx + 2] = rgb[sIdxPx + 2];
      }
    }

    frames.push(encodeRgbToPng(W, H, outRgb));
    richness.push(computeScaledRgbColorRichness(outRgb, W, H));
  }

  return { frames, richness };
}

/**
 * Pure-Node deterministic 960x540 fallback card when offline audit mode runs on hosts
 * where PyQt6 is blocked or unavailable, ensuring zero external network/browser dependencies
 * while preserving unique MD5 hashes per distinct HTML content.
 */
export function renderSyntheticOfflineHtmlCardPng(seedText: string): {
  frame: Buffer;
  richness: number;
} {
  const W = LMS_IMAGE_WIDTH;
  const H = LMS_IMAGE_HEIGHT;
  const rgb = new Uint8Array(W * H * 3);
  const digest = crypto.createHash("sha256").update(String(seedText || "")).digest();

  const accentR = 40 + (digest[0] % 160);
  const accentG = 60 + (digest[1] % 160);
  const accentB = 90 + (digest[2] % 160);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 3;
      if (y < 64) {
        // Accent header bar
        rgb[idx] = accentR;
        rgb[idx + 1] = accentG;
        rgb[idx + 2] = accentB;
      } else if (x >= 48 && x <= W - 48 && y >= 104 && y <= H - 48) {
        // Inner content card with deterministic color tiles
        const tileX = Math.floor((x - 48) / 144);
        const tileY = Math.floor((y - 104) / 96);
        const byteVal = digest[(tileX * 5 + tileY) % digest.length];
        if ((x - 48) % 144 > 12 && (y - 104) % 96 > 12) {
          rgb[idx] = 24 + (byteVal % 55);
          rgb[idx + 1] = 36 + (digest[(byteVal + 3) % digest.length] % 65);
          rgb[idx + 2] = 58 + (digest[(byteVal + 7) % digest.length] % 85);
        } else {
          rgb[idx] = 17;
          rgb[idx + 1] = 24;
          rgb[idx + 2] = 39;
        }
      } else {
        // Background #0f172a
        rgb[idx] = 15;
        rgb[idx + 1] = 23;
        rgb[idx + 2] = 42;
      }
    }
  }

  return {
    frame: encodeRgbToPng(W, H, rgb),
    richness: computeScaledRgbColorRichness(rgb, W, H),
  };
}
