/**
 * MINDX AUTOMATION BOT - GAMEMAKER (.YYZ) & SCRATCH (.SB3) ROOM/STAGE SCREENSHOT RENDERER
 * Renders real 960×540 (16:9) gameplay screenshots directly from student GameMaker (.yyz)
 * and Scratch (.sb3) archives using offscreen PyQt6 (QImage / QPainter), without launching
 * any extra browser context (preserving single-BrowserContext rule S8-02).
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assertPathAllowed } from "../security/path-allowlist";
import { LMS_IMAGE_HEIGHT, LMS_IMAGE_WIDTH } from "./spck-image-normalizer";

export interface CapturedGameScreenItem {
  filePath: string;
  screenName: string;
  sourceFile: string;
  width: number;
  height: number;
  widgetCount: number;
  colorRichness: number;
  isAuthScreen: boolean;
  heuristicScore: number;
}

const SKIP_SUBDIRS = new Set([
  "__pycache__",
  "node_modules",
  ".git",
  ".venv",
  "venv",
  "dist",
  "build",
  "_spck_app_shots",
  "_spck_owner_uploads",
  "_spck_youtube_frames",
]);

const DRAFT_DIR_REGEX = /^(draf|draft|drafts|backup|backups|old|temp|tmp|archive)$/i;

/**
 * Finds GameMaker `.yyz` and Scratch `.sb3` archives inside a student's SPCK folder.
 */
export function findProjectGameFiles(studentDir: string): {
  yyzFiles: string[];
  sb3Files: string[];
} {
  const safeStudentDir = assertPathAllowed(studentDir);
  const yyzFound: Array<{ relPath: string; depth: number; inDraft: boolean }> = [];
  const yypFound: Array<{ relPath: string; depth: number; inDraft: boolean }> = [];
  const sb3Found: Array<{ relPath: string; depth: number; inDraft: boolean }> = [];

  const walk = (currentDir: string, depth: number, inDraft: boolean) => {
    if (depth > 2) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || SKIP_SUBDIRS.has(entry.name.toLowerCase())) {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      let lstat: fs.Stats;
      try {
        lstat = fs.lstatSync(fullPath);
      } catch {
        continue;
      }
      if (lstat.isSymbolicLink()) continue;
      if (lstat.isDirectory()) {
        walk(fullPath, depth + 1, inDraft || DRAFT_DIR_REGEX.test(entry.name));
      } else if (lstat.isFile()) {
        const lower = entry.name.toLowerCase();
        const relPath = path.relative(safeStudentDir, fullPath);
        if (lower.endsWith(".yyz") && !lower.endsWith("_gamemaker.yyz")) {
          yyzFound.push({ relPath, depth, inDraft });
        } else if (lower.endsWith(".yyp")) {
          yypFound.push({ relPath, depth, inDraft });
        } else if (lower.endsWith(".sb3")) {
          sb3Found.push({ relPath, depth, inDraft });
        }
      }
    }
  };

  walk(safeStudentDir, 0, false);

  const pickActive = (list: Array<{ relPath: string; depth: number; inDraft: boolean }>) => {
    const nonDraft = list.filter((item) => !item.inDraft);
    const pool = nonDraft.length > 0 ? nonDraft : list;
    pool.sort(
      (a, b) =>
        a.depth - b.depth ||
        a.relPath.localeCompare(b.relPath, "en", { numeric: true })
    );
    return pool.map((item) => item.relPath);
  };

  const activeYyz = pickActive(yyzFound);
  const activeYyp = pickActive(yypFound);
  return {
    yyzFiles: activeYyz.length > 0 ? activeYyz : activeYyp,
    sb3Files: pickActive(sb3Found),
  };
}

const PYTHON_GAME_ARCHIVE_CAPTURE_SCRIPT = `
import os
import re
import sys
import json
import hashlib
import zipfile

os.environ.setdefault("QT_QPA_FONTDIR", r"C:\\Windows\\Fonts")
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PyQt6.QtWidgets import QApplication
from PyQt6.QtGui import QImage, QPainter, QColor, QTransform
from PyQt6.QtCore import Qt, QRectF, QByteArray, QBuffer, QIODevice

W, H = ${LMS_IMAGE_WIDTH}, ${LMS_IMAGE_HEIGHT}

def parse_yy(raw_text):
    clean = (raw_text or "").lstrip("\\ufeff")
    for _ in range(6):
        next_clean = re.sub(r",\\s*([\\]}])", r"\\1", clean)
        if next_clean == clean:
            break
        clean = next_clean
    return json.loads(clean)

def decode_gm_tiles(tiles_obj):
    if not isinstance(tiles_obj, dict):
        return []
    comp = tiles_obj.get("TileCompressedData")
    if isinstance(comp, list) and len(comp) > 0:
        out = []
        i = 0
        n = len(comp)
        while i < n:
            c = int(comp[i])
            i += 1
            if c < 0:
                cnt = -c
                val = int(comp[i]) if i < n else 0
                i += 1
                out.extend([val] * cnt)
            elif c > 0:
                for _ in range(c):
                    out.append(int(comp[i]) if i < n else 0)
                    i += 1
        return out
    ser = tiles_obj.get("TileSerialiseData")
    if isinstance(ser, list):
        return [int(x) for x in ser]
    return []

def compute_richness(qimg):
    if qimg.isNull() or qimg.width() <= 0 or qimg.height() <= 0:
        return 18
    buckets = set()
    sx = max(1, qimg.width() // 40)
    sy = max(1, qimg.height() // 40)
    for y in range(0, qimg.height(), sy):
        for x in range(0, qimg.width(), sx):
            c = qimg.pixelColor(x, y)
            buckets.add((c.red() // 16, c.green() // 16, c.blue() // 16))
    return max(18, min(140, len(buckets) * 2))

def encode_png_bytes(qimg):
    ba = QByteArray()
    qbuf = QBuffer(ba)
    qbuf.open(QIODevice.OpenModeFlag.WriteOnly)
    qimg.save(qbuf, "PNG")
    return bytes(ba)

MAX_ARCHIVE_ENTRIES = 1500
MAX_SINGLE_ENTRY_BYTES = 15 * 1024 * 1024
MAX_TOTAL_ARCHIVE_BYTES = 80 * 1024 * 1024

class SafeZipReader:
    def __init__(self, zip_path):
        self._zf = zipfile.ZipFile(zip_path, "r")
        infos = self._zf.infolist()
        if len(infos) > MAX_ARCHIVE_ENTRIES:
            self._zf.close()
            raise ValueError("Too many zip entries")
        total_uncomp = sum(max(0, int(getattr(i, "file_size", 0))) for i in infos)
        if total_uncomp > MAX_TOTAL_ARCHIVE_BYTES:
            self._zf.close()
            raise ValueError("Zip uncompressed size exceeds limit")
        self._read_bytes = 0

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self._zf.close()

    def namelist(self):
        return self._zf.namelist()

    def read(self, name):
        info = self._zf.getinfo(name)
        fsize = max(0, int(getattr(info, "file_size", 0)))
        if fsize > MAX_SINGLE_ENTRY_BYTES:
            raise ValueError("Zip entry too large")
        if self._read_bytes + fsize > MAX_TOTAL_ARCHIVE_BYTES:
            raise ValueError("Total zip read bytes exceeded")
        data = self._zf.read(name)
        if len(data) > MAX_SINGLE_ENTRY_BYTES:
            raise ValueError("Zip entry data too large")
        self._read_bytes += len(data)
        return data

class DirArchiveReader:
    def __init__(self, yyp_path):
        self.root = os.path.realpath(os.path.dirname(yyp_path))
        self.root_norm = os.path.normcase(self.root)
        self._names = []
        self._read_bytes = 0
        for cur, dirs, files in os.walk(self.root, followlinks=False):
            dirs[:] = [
                d for d in dirs
                if not d.startswith(".")
                and d not in ("_spck_app_shots", "_spck_owner_uploads", "_spck_youtube_frames", "node_modules", "__pycache__")
                and not os.path.islink(os.path.join(cur, d))
            ]
            for f in files:
                if len(self._names) >= MAX_ARCHIVE_ENTRIES:
                    break
                fp = os.path.join(cur, f)
                if os.path.islink(fp):
                    continue
                try:
                    real_fp = os.path.normcase(os.path.realpath(fp))
                    if os.path.commonpath([real_fp, self.root_norm]) != self.root_norm:
                        continue
                except Exception:
                    continue
                rel = os.path.relpath(fp, self.root).replace("\\\\", "/")
                self._names.append(rel)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def namelist(self):
        return self._names

    def read(self, name):
        cand = os.path.join(self.root, name)
        if os.path.islink(cand):
            raise ValueError("Symlink not allowed")
        full = os.path.realpath(cand)
        if os.path.commonpath([os.path.normcase(full), self.root_norm]) != self.root_norm:
            raise ValueError("Path outside root")
        fsize = os.path.getsize(full)
        if fsize > MAX_SINGLE_ENTRY_BYTES or self._read_bytes + fsize > MAX_TOTAL_ARCHIVE_BYTES:
            raise ValueError("File size exceeds limit")
        with open(full, "rb") as f:
            data = f.read(MAX_SINGLE_ENTRY_BYTES + 1)
        if len(data) > MAX_SINGLE_ENTRY_BYTES:
            raise ValueError("File size exceeds limit")
        self._read_bytes += len(data)
        return data

def open_gm_source(path_str):
    if str(path_str).lower().endswith(".yyp"):
        return DirArchiveReader(path_str)
    return SafeZipReader(path_str)

def render_yyz_archive(yyz_path, rel_source):
    candidates = []
    try:
        with open_gm_source(yyz_path) as z:
            namelist = z.namelist()
            norm_map = {n.replace("\\\\", "/").lower(): n for n in namelist}

            room_order = []
            for n in namelist:
                if n.lower().endswith(".yyp"):
                    try:
                        yyp = parse_yy(z.read(n).decode("utf-8", errors="replace"))
                        for node in yyp.get("RoomOrderNodes") or []:
                            rname = (node.get("roomId") or {}).get("name")
                            if rname:
                                room_order.append(str(rname))
                    except Exception:
                        pass

            sprites = {}
            objects = {}
            tilesets = {}
            rooms = {}

            for n in namelist:
                n_norm = n.replace("\\\\", "/")
                nl = n_norm.lower()
                if not nl.endswith(".yy"):
                    continue
                try:
                    yy = parse_yy(z.read(n).decode("utf-8", errors="replace"))
                except Exception:
                    continue
                if not isinstance(yy, dict):
                    continue
                rtype = str(yy.get("resourceType") or "")
                rname = str(yy.get("name") or yy.get("%Name") or os.path.splitext(os.path.basename(n_norm))[0])

                if nl.startswith("sprites/") or rtype == "GMSprite" or "$GMSprite" in yy:
                    seq = yy.get("sequence") or {}
                    xorig = float(seq.get("xorigin") or 0) if isinstance(seq, dict) else 0.0
                    yorig = float(seq.get("yorigin") or 0) if isinstance(seq, dict) else 0.0
                    frames = yy.get("frames") or []
                    spr_dir = os.path.dirname(n_norm)
                    png_entry = None
                    if isinstance(frames, list) and len(frames) > 0 and isinstance(frames[0], dict):
                        f_guid = frames[0].get("name") or frames[0].get("%Name")
                        if f_guid:
                            cand = f"{spr_dir}/{f_guid}.png".lower()
                            png_entry = norm_map.get(cand)
                    if not png_entry:
                        prefix = spr_dir.lower() + "/"
                        for k_low, orig_name in norm_map.items():
                            if k_low.startswith(prefix) and k_low.endswith(".png") and "/layers/" not in k_low:
                                png_entry = orig_name
                                break
                    if png_entry:
                        try:
                            qimg = QImage.fromData(z.read(png_entry))
                            if not qimg.isNull():
                                sprites[rname] = {
                                    "img": qimg,
                                    "w": qimg.width(),
                                    "h": qimg.height(),
                                    "xorig": xorig,
                                    "yorig": yorig,
                                }
                        except Exception:
                            pass
                elif nl.startswith("objects/") or rtype == "GMObject" or "$GMObject" in yy:
                    spr_id = yy.get("spriteId") or {}
                    spr_name = spr_id.get("name") if isinstance(spr_id, dict) else None
                    objects[rname] = {
                        "sprite": spr_name,
                        "visible": yy.get("visible", True) is not False,
                    }
                elif nl.startswith("tilesets/") or rtype == "GMTileSet" or "$GMTileSet" in yy:
                    spr_id = yy.get("spriteId") or {}
                    spr_name = spr_id.get("name") if isinstance(spr_id, dict) else None
                    tilesets[rname] = {
                        "sprite": spr_name,
                        "tw": max(1, int(yy.get("tileWidth") or 32)),
                        "th": max(1, int(yy.get("tileHeight") or 32)),
                        "xoff": int(yy.get("tilexoff") or 0),
                        "yoff": int(yy.get("tileyoff") or 0),
                        "hsep": int(yy.get("tilehsep") or 0),
                        "vsep": int(yy.get("tilevsep") or 0),
                    }
                elif nl.startswith("rooms/") or rtype == "GMRoom" or "$GMRoom" in yy:
                    rooms[rname] = yy

            ordered_room_names = []
            for rn in room_order:
                if rn in rooms and rn not in ordered_room_names:
                    ordered_room_names.append(rn)
            for rn in sorted(rooms.keys()):
                if rn not in ordered_room_names:
                    ordered_room_names.append(rn)

            for rname in ordered_room_names:
                ryy = rooms[rname]
                rs = ryy.get("roomSettings") or {}
                rw = max(160, min(4096, int(rs.get("Width") or 1366)))
                rh = max(120, min(4096, int(rs.get("Height") or 768)))

                flat_layers = []
                def collect_layers(layer_list):
                    for lyr in layer_list or []:
                        if not isinstance(lyr, dict):
                            continue
                        if lyr.get("visible", True) is False:
                            continue
                        flat_layers.append(lyr)
                        if isinstance(lyr.get("layers"), list):
                            collect_layers(lyr.get("layers"))
                collect_layers(ryy.get("layers") or [])
                flat_layers.sort(key=lambda x: int(x.get("depth") or 0), reverse=True)

                total_non_empty_tiles = 0
                total_valid_instances = 0
                for lyr in flat_layers:
                    lt = str(lyr.get("resourceType") or "")
                    if lt == "GMRTileLayer" or "$GMRTileLayer" in lyr:
                        tdata = decode_gm_tiles(lyr.get("tiles") or {})
                        total_non_empty_tiles += sum(1 for v in tdata if v > 0 and (v & 0x7FFFF) > 0)
                    elif lt == "GMRInstanceLayer" or "$GMRInstanceLayer" in lyr:
                        for inst in lyr.get("instances") or []:
                            oname = (inst.get("objectId") or {}).get("name") if isinstance(inst, dict) else None
                            if oname and oname in objects and objects[oname].get("visible", True) and objects[oname].get("sprite") in sprites:
                                total_valid_instances += 1
                    elif lt == "GMRAssetLayer" or "$GMRAssetLayer" in lyr:
                        for asset in lyr.get("assets") or []:
                            sname = (asset.get("spriteId") or {}).get("name") if isinstance(asset, dict) else None
                            if sname and sname in sprites:
                                total_valid_instances += 1

                canvas = QImage(rw, rh, QImage.Format.Format_ARGB32)
                canvas.fill(QColor(17, 24, 39, 255))
                p = QPainter(canvas)
                p.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, True)

                drawn_elements = 0
                has_bg_sprite = False
                instance_points = []

                for lyr in flat_layers:
                    lt = str(lyr.get("resourceType") or "")
                    lx = float(lyr.get("x") or 0)
                    ly = float(lyr.get("y") or 0)

                    if lt == "GMRBackgroundLayer" or "$GMRBackgroundLayer" in lyr:
                        col = lyr.get("colour")
                        spr_id = lyr.get("spriteId") or {}
                        sname = spr_id.get("name") if isinstance(spr_id, dict) else None
                        if isinstance(col, int) and not sname:
                            r = col & 0xFF
                            g = (col >> 8) & 0xFF
                            b = (col >> 16) & 0xFF
                            a = (col >> 24) & 0xFF
                            if a > 0:
                                p.fillRect(0, 0, rw, rh, QColor(r, g, b, a))
                        if sname and sname in sprites:
                            sp = sprites[sname]
                            simg = sp["img"]
                            sw, sh = sp["w"], sp["h"]
                            stretch = bool(lyr.get("stretch"))
                            htiled = bool(lyr.get("htiled"))
                            vtiled = bool(lyr.get("vtiled"))
                            if not stretch and not htiled and not vtiled and (total_non_empty_tiles > 0 or total_valid_instances > 0):
                                if sw < rw * 0.25 and sh < rh * 0.25:
                                    continue
                            has_bg_sprite = True
                            drawn_elements += 1
                            if stretch or (total_non_empty_tiles == 0 and total_valid_instances == 0 and not htiled and not vtiled):
                                p.drawImage(QRectF(0, 0, rw, rh), simg)
                            elif htiled or vtiled:
                                xs = range(0, rw, max(1, sw)) if htiled else [int(lx)]
                                ys = range(0, rh, max(1, sh)) if vtiled else [int(ly)]
                                for ty in ys:
                                    for tx in xs:
                                        p.drawImage(QRectF(tx, ty, sw, sh), simg)
                            else:
                                p.drawImage(QRectF(lx, ly, sw, sh), simg)

                    elif lt == "GMRTileLayer" or "$GMRTileLayer" in lyr:
                        ts_id = lyr.get("tilesetId") or {}
                        ts_name = ts_id.get("name") if isinstance(ts_id, dict) else None
                        if not ts_name or ts_name not in tilesets:
                            continue
                        ts = tilesets[ts_name]
                        sname = ts["sprite"]
                        if not sname or sname not in sprites:
                            continue
                        simg = sprites[sname]["img"]
                        sw, sh = sprites[sname]["w"], sprites[sname]["h"]
                        tw, th = ts["tw"], ts["th"]
                        xoff, yoff = ts["xoff"], ts["yoff"]
                        hsep, vsep = ts["hsep"], ts["vsep"]
                        cols = max(1, (sw - xoff + hsep) // max(1, tw + hsep))

                        tiles_obj = lyr.get("tiles") or {}
                        gw = int(tiles_obj.get("SerialiseWidth") or 0)
                        gh = int(tiles_obj.get("SerialiseHeight") or 0)
                        tdata = decode_gm_tiles(tiles_obj)
                        if gw <= 0 or gh <= 0 or not tdata:
                            continue

                        for gy in range(gh):
                            row_off = gy * gw
                            if row_off >= len(tdata):
                                break
                            for gx in range(gw):
                                idx_cell = row_off + gx
                                if idx_cell >= len(tdata):
                                    break
                                raw_val = tdata[idx_cell]
                                if raw_val <= 0:
                                    continue
                                tile_idx = raw_val & 0x7FFFF
                                if tile_idx <= 0:
                                    continue
                                col_i = tile_idx % cols
                                row_i = tile_idx // cols
                                sx = xoff + col_i * (tw + hsep)
                                sy = yoff + row_i * (th + vsep)
                                if sx + tw > sw or sy + th > sh:
                                    continue
                                dx = lx + gx * tw
                                dy = ly + gy * th
                                mirror = bool(raw_val & 0x10000000)
                                flip = bool(raw_val & 0x20000000)
                                rot90 = bool(raw_val & 0x40000000)
                                if mirror or flip or rot90:
                                    tile_sub = simg.copy(sx, sy, tw, th)
                                    tr = QTransform()
                                    if mirror or flip:
                                        tr.scale(-1.0 if mirror else 1.0, -1.0 if flip else 1.0)
                                    if rot90:
                                        tr.rotate(90)
                                    tile_sub = tile_sub.transformed(tr)
                                    p.drawImage(QRectF(dx, dy, tw, th), tile_sub)
                                else:
                                    p.drawImage(QRectF(dx, dy, tw, th), simg, QRectF(sx, sy, tw, th))
                                drawn_elements += 1

                    elif lt == "GMRAssetLayer" or "$GMRAssetLayer" in lyr:
                        for asset in lyr.get("assets") or []:
                            if not isinstance(asset, dict) or asset.get("visible", True) is False:
                                continue
                            sname = (asset.get("spriteId") or {}).get("name")
                            if not sname or sname not in sprites:
                                continue
                            sp = sprites[sname]
                            ax = float(asset.get("x") or 0)
                            ay = float(asset.get("y") or 0)
                            scx = float(asset.get("scaleX") if asset.get("scaleX") is not None else 1.0)
                            scy = float(asset.get("scaleY") if asset.get("scaleY") is not None else 1.0)
                            rot = float(asset.get("rotation") or 0.0)
                            p.save()
                            p.translate(lx + ax, ly + ay)
                            if rot != 0:
                                p.rotate(-rot)
                            p.scale(scx, scy)
                            p.drawImage(QRectF(-sp["xorig"], -sp["yorig"], sp["w"], sp["h"]), sp["img"])
                            p.restore()
                            drawn_elements += 1
                            instance_points.append((lx + ax, ly + ay))

                    elif lt == "GMRInstanceLayer" or "$GMRInstanceLayer" in lyr:
                        for inst in lyr.get("instances") or []:
                            if not isinstance(inst, dict):
                                continue
                            oname = (inst.get("objectId") or {}).get("name")
                            if not oname or oname not in objects:
                                continue
                            obj_info = objects[oname]
                            if not obj_info.get("visible", True):
                                continue
                            sname = obj_info.get("sprite")
                            if not sname or sname not in sprites:
                                continue
                            sp = sprites[sname]
                            ix = float(inst.get("x") or 0)
                            iy = float(inst.get("y") or 0)
                            scx = float(inst.get("scaleX") if inst.get("scaleX") is not None else 1.0)
                            scy = float(inst.get("scaleY") if inst.get("scaleY") is not None else 1.0)
                            rot = float(inst.get("rotation") or 0.0)
                            p.save()
                            p.translate(lx + ix, ly + iy)
                            if rot != 0:
                                p.rotate(-rot)
                            p.scale(scx, scy)
                            p.drawImage(QRectF(-sp["xorig"], -sp["yorig"], sp["w"], sp["h"]), sp["img"])
                            p.restore()
                            drawn_elements += 1
                            instance_points.append((lx + ix, ly + iy))

                p.end()
                if drawn_elements == 0 and not has_bg_sprite:
                    continue

                out_img = canvas.scaled(
                    W,
                    H,
                    Qt.AspectRatioMode.IgnoreAspectRatio,
                    Qt.TransformationMode.SmoothTransformation,
                )
                richness = compute_richness(out_img)
                is_menu_or_end = bool(
                    re.search(
                        r"(menu|lose|gameover|game[_-]?over|win|end|start|intro|title)",
                        rname,
                        re.IGNORECASE,
                    )
                )
                is_main_play = (
                    bool(
                        re.search(
                            r"(play|round|level|stage|map|game|room_?1|rm_?1)",
                            rname,
                            re.IGNORECASE,
                        )
                    )
                    and not is_menu_or_end
                )
                is_first_round = bool(re.search(r"(?:round|room|rm|level)[_-]?1\\b", rname, re.IGNORECASE))
                h_score = round(
                    richness * 1.5
                    + min(120.0, drawn_elements * 0.5)
                    + (100.0 if is_main_play else 0.0)
                    + (15.0 if is_first_round else 0.0)
                    - (120.0 if is_menu_or_end else 0.0),
                    2,
                )
                candidates.append({
                    "screenName": rname,
                    "sourceFile": rel_source,
                    "qimg": out_img,
                    "rawCanvas": canvas,
                    "rw": rw,
                    "rh": rh,
                    "instancePoints": instance_points,
                    "widgetCount": min(250, max(1, drawn_elements)),
                    "colorRichness": richness,
                    "isAuthScreen": is_menu_or_end,
                    "heuristicScore": h_score,
                })

            # If the GameMaker archive only has 1 rendered room, also generate a close-up gameplay camera view
            if len(candidates) == 1 and candidates[0]["widgetCount"] > 1:
                c0 = candidates[0]
                raw_c = c0["rawCanvas"]
                rw, rh = c0["rw"], c0["rh"]
                pts = c0["instancePoints"]
                if pts:
                    cx = sum(pt[0] for pt in pts) / len(pts)
                    cy = sum(pt[1] for pt in pts) / len(pts)
                else:
                    cx, cy = rw * 0.5, rh * 0.5
                crop_w = max(160, int(rw * 0.65))
                crop_h = max(90, int(rh * 0.65))
                x0 = max(0, min(rw - crop_w, int(cx - crop_w * 0.5)))
                y0 = max(0, min(rh - crop_h, int(cy - crop_h * 0.5)))
                sub_canvas = raw_c.copy(x0, y0, crop_w, crop_h)
                zoom_img = sub_canvas.scaled(
                    W,
                    H,
                    Qt.AspectRatioMode.IgnoreAspectRatio,
                    Qt.TransformationMode.SmoothTransformation,
                )
                z_rich = compute_richness(zoom_img)
                candidates.append({
                    "screenName": f"{c0['screenName']}_camera",
                    "sourceFile": rel_source,
                    "qimg": zoom_img,
                    "widgetCount": c0["widgetCount"],
                    "colorRichness": z_rich,
                    "isAuthScreen": True,
                    "heuristicScore": round(c0["heuristicScore"] - 50.0, 2),
                })
    except Exception:
        pass
    return candidates

def render_sb3_archive(sb3_path, rel_source):
    candidates = []
    try:
        with SafeZipReader(sb3_path) as z:
            namelist = z.namelist()
            norm_map = {n.replace("\\\\", "/").lower(): n for n in namelist}
            proj_entry = norm_map.get("project.json")
            if not proj_entry:
                for k_low, orig_name in norm_map.items():
                    if k_low.endswith("/project.json"):
                        proj_entry = orig_name
                        break
            if not proj_entry:
                return []
            proj = json.loads(z.read(proj_entry).decode("utf-8", errors="replace"))
            targets = proj.get("targets") or []
            if not isinstance(targets, list) or len(targets) == 0:
                return []

            stage_target = None
            sprite_targets = []
            for t in targets:
                if not isinstance(t, dict):
                    continue
                if t.get("isStage"):
                    stage_target = t
                else:
                    sprite_targets.append(t)

            sprite_targets.sort(key=lambda x: int(x.get("layerOrder") or 1))

            def load_costume_img(costume):
                if not isinstance(costume, dict):
                    return None
                md5ext = costume.get("md5ext")
                if not md5ext and costume.get("assetId") and costume.get("dataFormat"):
                    md5ext = f"{costume.get('assetId')}.{costume.get('dataFormat')}"
                if not md5ext:
                    return None
                entry_name = norm_map.get(str(md5ext).lower())
                if not entry_name:
                    return None
                try:
                    qimg = QImage.fromData(z.read(entry_name))
                    if not qimg.isNull():
                        return qimg
                except Exception:
                    pass
                return None

            stage_costumes = (stage_target.get("costumes") if stage_target else None) or []
            cur_stage_idx = int((stage_target or {}).get("currentCostume") or 0)
            backdrop_indices = []
            if 0 <= cur_stage_idx < len(stage_costumes):
                backdrop_indices.append(cur_stage_idx)
            for idx in range(len(stage_costumes)):
                if idx not in backdrop_indices and len(backdrop_indices) < 3:
                    backdrop_indices.append(idx)
            if not backdrop_indices:
                backdrop_indices = [0]

            for b_order, b_idx in enumerate(backdrop_indices):
                canvas = QImage(W, H, QImage.Format.Format_ARGB32)
                canvas.fill(QColor(17, 24, 39, 255))
                p = QPainter(canvas)
                p.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, True)

                stage_scale = H / 360.0  # 540 / 360 = 1.5
                stage_w = int(round(480.0 * stage_scale))  # 720
                off_x = (W - stage_w) // 2  # 120

                bg_costume = stage_costumes[b_idx] if 0 <= b_idx < len(stage_costumes) else None
                bg_img = load_costume_img(bg_costume)
                if bg_img is not None:
                    # Soft backdrop fill across 16:9 frame + crisp 4:3 stage in center
                    p.save()
                    p.setOpacity(0.32)
                    p.drawImage(QRectF(0, 0, W, H), bg_img)
                    p.restore()
                    p.drawImage(QRectF(off_x, 0, stage_w, H), bg_img)
                else:
                    p.fillRect(off_x, 0, stage_w, H, QColor(255, 255, 255, 255))

                drawn_sprites = 0
                for sp in sprite_targets:
                    if sp.get("visible", True) is False:
                        continue
                    sp_costumes = sp.get("costumes") or []
                    if not sp_costumes:
                        continue
                    c_idx = int(sp.get("currentCostume") or 0)
                    if c_idx < 0 or c_idx >= len(sp_costumes):
                        c_idx = 0
                    c_obj = sp_costumes[c_idx]
                    s_img = load_costume_img(c_obj)
                    if s_img is None:
                        continue
                    bmp_res = max(1.0, float(c_obj.get("bitmapResolution") or 1.0))
                    rcx = float(c_obj.get("rotationCenterX") if c_obj.get("rotationCenterX") is not None else s_img.width() * 0.5)
                    rcy = float(c_obj.get("rotationCenterY") if c_obj.get("rotationCenterY") is not None else s_img.height() * 0.5)
                    sx = float(sp.get("x") or 0.0)
                    sy = float(sp.get("y") or 0.0)
                    size_pct = max(0.05, float(sp.get("size") if sp.get("size") is not None else 100.0) / 100.0)
                    direction = float(sp.get("direction") if sp.get("direction") is not None else 90.0)
                    rot_style = str(sp.get("rotationStyle") or "all around")

                    px = off_x + (240.0 + sx) * stage_scale
                    py = (180.0 - sy) * stage_scale
                    eff_scale = (size_pct / bmp_res) * stage_scale

                    p.save()
                    p.translate(px, py)
                    if rot_style == "all around" and direction != 90.0:
                        p.rotate(direction - 90.0)
                    elif rot_style == "left-right" and direction < 0:
                        p.scale(-1.0, 1.0)
                    p.scale(eff_scale, eff_scale)
                    p.drawImage(QRectF(-rcx, -rcy, s_img.width(), s_img.height()), s_img)
                    p.restore()
                    drawn_sprites += 1

                p.end()
                if drawn_sprites == 0 and bg_img is None:
                    continue
                richness = compute_richness(canvas)
                b_name = str((bg_costume or {}).get("name") or f"stage_{b_order + 1}")
                is_extra = b_order > 0
                candidates.append({
                    "screenName": b_name,
                    "sourceFile": rel_source,
                    "qimg": canvas,
                    "widgetCount": max(1, drawn_sprites + (1 if bg_img is not None else 0)),
                    "colorRichness": richness,
                    "isAuthScreen": is_extra,
                    "heuristicScore": round(richness * 1.5 + drawn_sprites * 12.0 + (80.0 if not is_extra else -40.0), 2),
                })
    except Exception:
        pass
    return candidates

def main():
    raw_in = sys.stdin.buffer.read().decode("utf-8", errors="replace")
    payload = json.loads(raw_in)
    student_dir = payload.get("studentDir") or ""
    yyz_files = payload.get("yyzFiles") or []
    sb3_files = payload.get("sb3Files") or []
    out_dir = payload.get("outDir") or ""
    max_shots = int(payload.get("maxShots") or 10)

    if not student_dir or not out_dir or os.path.islink(out_dir):
        sys.stdout.buffer.write(b"JSON_CAPTURE_RESULT:[]")
        return
    os.makedirs(out_dir, exist_ok=True)
    real_student = os.path.normcase(os.path.realpath(student_dir))
    real_out = os.path.normcase(os.path.realpath(out_dir))
    if os.path.commonpath([real_out, real_student]) != real_student:
        sys.stdout.buffer.write(b"JSON_CAPTURE_RESULT:[]")
        return
    app = QApplication.instance() or QApplication([])

    all_candidates = []
    for rel_yyz in yyz_files:
        full_yyz = os.path.join(student_dir, rel_yyz)
        if not os.path.islink(full_yyz) and os.path.isfile(full_yyz):
            all_candidates.extend(render_yyz_archive(full_yyz, rel_yyz))

    for rel_sb3 in sb3_files:
        full_sb3 = os.path.join(student_dir, rel_sb3)
        if not os.path.islink(full_sb3) and os.path.isfile(full_sb3):
            all_candidates.extend(render_sb3_archive(full_sb3, rel_sb3))

    # Sort so gameplay / main stage screens come first (app_01_ is always the best cover screen)
    all_candidates.sort(
        key=lambda c: (0 if not c.get("isAuthScreen") else 1, -float(c.get("heuristicScore") or 0))
    )

    results = []
    seen_hashes = set()
    for cand in all_candidates:
        if len(results) >= max_shots:
            break
        png_bytes = encode_png_bytes(cand["qimg"])
        if not png_bytes:
            continue
        md5_hex = hashlib.md5(png_bytes).hexdigest()
        if md5_hex in seen_hashes:
            continue
        seen_hashes.add(md5_hex)
        hash6 = md5_hex[:6]
        safe_screen = re.sub(r"[^a-zA-Z0-9_-]+", "_", str(cand["screenName"])).strip("_") or "room"
        idx_num = len(results) + 1
        out_name = f"app_{idx_num:02d}_{safe_screen}_{hash6}.png"
        out_path = os.path.join(out_dir, out_name)
        tmp_path = out_path + ".tmp"
        if os.path.lexists(tmp_path):
            os.unlink(tmp_path)
        if os.path.lexists(out_path) and os.path.islink(out_path):
            os.unlink(out_path)
        with open(tmp_path, "wb") as f:
            f.write(png_bytes)
        os.replace(tmp_path, out_path)
        results.append({
            "filePath": out_path,
            "screenName": str(cand["screenName"]),
            "sourceFile": str(cand["sourceFile"]).replace("\\\\", "/"),
            "width": W,
            "height": H,
            "widgetCount": int(cand["widgetCount"]),
            "colorRichness": int(cand["colorRichness"]),
            "isAuthScreen": bool(cand["isAuthScreen"]),
            "heuristicScore": float(cand["heuristicScore"]),
        })

    out_text = "JSON_CAPTURE_RESULT:" + json.dumps(results)
    sys.stdout.buffer.write(out_text.encode("utf-8"))
    sys.stdout.buffer.flush()

if __name__ == "__main__":
    main()
`;

/**
 * Renders GameMaker `.yyz` rooms and Scratch `.sb3` stages into `960×540` (16:9) PNG screenshots
 * inside `outDir` (`_spck_app_shots/app_NN_<name>_<hash6>.png`).
 */
export function renderGameArchiveScreenshotsSync(params: {
  studentDir: string;
  yyzFiles?: string[];
  sb3Files?: string[];
  outDir: string;
  maxShots?: number;
}): CapturedGameScreenItem[] {
  const safeStudentDir = assertPathAllowed(params.studentDir);
  const safeOutDir = assertPathAllowed(params.outDir);
  const yyzFiles = (params.yyzFiles || []).filter((rel) => {
    try {
      const full = assertPathAllowed(path.join(safeStudentDir, rel));
      return fs.existsSync(full) && fs.statSync(full).isFile();
    } catch {
      return false;
    }
  });
  const sb3Files = (params.sb3Files || []).filter((rel) => {
    try {
      const full = assertPathAllowed(path.join(safeStudentDir, rel));
      return fs.existsSync(full) && fs.statSync(full).isFile();
    } catch {
      return false;
    }
  });

  if (yyzFiles.length === 0 && sb3Files.length === 0) {
    return [];
  }

  fs.mkdirSync(safeOutDir, { recursive: true });
  const payload = JSON.stringify({
    studentDir: safeStudentDir,
    yyzFiles,
    sb3Files,
    outDir: safeOutDir,
    maxShots: params.maxShots ?? 11,
  });

  const runnerBootstrap =
    'import io,json,sys; _d=json.loads(sys.stdin.buffer.read().decode("utf-8")); sys.stdin=io.TextIOWrapper(io.BytesIO(_d["payload"].encode("utf-8")),encoding="utf-8"); exec(_d["script"],{"__name__":"__main__"})';

  const proc = spawnSync("python", ["-c", runnerBootstrap], {
    input: JSON.stringify({
      script: PYTHON_GAME_ARCHIVE_CAPTURE_SCRIPT,
      payload,
    }),
    encoding: "utf-8",
    timeout: 35_000,
    windowsHide: true,
  });

  const stdout = String(proc.stdout || "");
  const markerIdx = stdout.indexOf("JSON_CAPTURE_RESULT:");
  if (markerIdx === -1) {
    return [];
  }

  const jsonText = stdout.slice(markerIdx + "JSON_CAPTURE_RESULT:".length).trim();
  try {
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed)) {
      return parsed.filter((item: CapturedGameScreenItem) => {
        if (!item?.filePath || !fs.existsSync(item.filePath)) return false;
        try {
          if (fs.lstatSync(item.filePath).isSymbolicLink()) return false;
          assertPathAllowed(fs.realpathSync(item.filePath));
          return true;
        } catch {
          return false;
        }
      });
    }
  } catch {
    // ignore JSON parse error
  }
  return [];
}
