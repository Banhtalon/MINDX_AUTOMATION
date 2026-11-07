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

import { spawnSync } from "node:child_process";
import zlib from "node:zlib";

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

function normalizeViaPyQtFallback(buf: Buffer, fit: SpckImageFitMode): Buffer | null {
  try {
    const pyScript = `
import sys, base64
from PyQt6.QtGui import QImage, QPainter, QColor
from PyQt6.QtCore import Qt, QBuffer, QIODevice, QByteArray, QRect

raw = base64.b64decode(sys.stdin.read())
img = QImage.fromData(raw)
if img.isNull() or img.width() <= 0 or img.height() <= 0:
    sys.exit(2)

W, H = ${LMS_IMAGE_WIDTH}, ${LMS_IMAGE_HEIGHT}
fit = "${fit}"
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
 * Normalizes a batch of images into PNG buffers of exactly `960×540`.
 * Returns `null` for any job whose source image cannot be decoded (caller keeps the original).
 */
export async function normalizeImagesToLms16x9(
  jobs: NormalizeImageJob[]
): Promise<Array<Buffer | null>> {
  return normalizeImagesToLms16x9Sync(jobs);
}
