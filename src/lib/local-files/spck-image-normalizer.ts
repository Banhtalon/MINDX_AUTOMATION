/**
 * MINDX AUTOMATION BOT - SPCK IMAGE NORMALIZER (LMS 16:9 SAFE SIZE)
 * Normalizes captured App/Web screenshots and YouTube presentation frames into
 * the LMS-safe 16:9 size `960×540` so the MindX LMS image viewer (≈ 960px wide)
 * always shows the whole image without cropping the left/right edges or showing
 * a horizontal scrollbar.
 *
 * - `contain`: keeps the WHOLE source image visible (used for PyQt App windows of any ratio),
 *   centered on a softly blurred copy of itself instead of hard black bars.
 * - `cover`: fills the 16:9 frame and center-crops overflow (used for YouTube frames that
 *   are 4:3 letterboxed, e.g. `sd1.jpg` / `hq1.jpg`).
 *
 * Rendering is done locally in an isolated headless Chromium (no LMS session, no network).
 */

import { chromium } from "playwright";

export const LMS_IMAGE_WIDTH = 960;
export const LMS_IMAGE_HEIGHT = 540;

export type SpckImageFitMode = "contain" | "cover";

export interface NormalizeImageJob {
  buffer: Buffer;
  mimeType?: string;
  fit: SpckImageFitMode;
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

function buildNormalizeHtml(dataUrl: string, fit: SpckImageFitMode): string {
  const W = LMS_IMAGE_WIDTH;
  const H = LMS_IMAGE_HEIGHT;
  const frameCss = `position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#0f172a;`;
  if (fit === "cover") {
    return `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;background:#0f172a;}#frame{${frameCss}}#frame img{width:100%;height:100%;object-fit:cover;object-position:center;display:block;}</style></head><body><div id="frame"><img id="main" src="${dataUrl}"/></div></body></html>`;
  }
  return `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;background:#0f172a;}#frame{${frameCss}}#bg{position:absolute;inset:-40px;width:calc(100% + 80px);height:calc(100% + 80px);object-fit:cover;filter:blur(28px) brightness(0.55);}#main{position:absolute;inset:0;margin:auto;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;display:block;box-shadow:0 0 24px rgba(0,0,0,0.45);}</style></head><body><div id="frame"><img id="bg" src="${dataUrl}"/><img id="main" src="${dataUrl}"/></div></body></html>`;
}

/**
 * Normalizes a batch of images into PNG buffers of exactly `960×540`.
 * Returns `null` for any job whose source image cannot be decoded (caller keeps the original).
 */
export async function normalizeImagesToLms16x9(
  jobs: NormalizeImageJob[]
): Promise<Array<Buffer | null>> {
  if (jobs.length === 0) return [];
  const results: Array<Buffer | null> = jobs.map(() => null);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: LMS_IMAGE_WIDTH, height: LMS_IMAGE_HEIGHT },
      deviceScaleFactor: 1,
      offline: true,
    });
    const page = await context.newPage();
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      try {
        if (!job?.buffer || job.buffer.length === 0) continue;
        const mime = job.mimeType || detectImageMimeType(job.buffer);
        const dataUrl = `data:${mime};base64,${job.buffer.toString("base64")}`;
        await page.setContent(buildNormalizeHtml(dataUrl, job.fit), { waitUntil: "load" });
        const decoded = await page
          .evaluate(async () => {
            const imgs = Array.from(document.querySelectorAll("img"));
            await Promise.all(
              imgs.map((img) => (img.decode ? img.decode().catch(() => undefined) : undefined))
            );
            const main = document.getElementById("main") as HTMLImageElement | null;
            return Boolean(main && main.naturalWidth > 0 && main.naturalHeight > 0);
          })
          .catch(() => false);
        if (!decoded) continue;
        const shot = await page.locator("#frame").screenshot({ type: "png" });
        results[i] = Buffer.from(shot);
      } catch {
        results[i] = null;
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  return results;
}
