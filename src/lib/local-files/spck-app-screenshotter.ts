/**
 * MINDX AUTOMATION BOT - SPCK APP INTERFACE SCREENSHOTTER & AI THUMBNAIL SELECTOR
 * 1. Automatically opens/renders student SPCK applications:
 *    - PyQt6 / Python GUI apps (`.ui` files rendered offscreen via PyQt6 with automatic asset path repair)
 *    - Web apps (`.html` files rendered via Playwright)
 *    and saves real interface screenshots into `<studentFolder>/_spck_app_shots/`.
 * 2. Uses Gemini Vision (`gemini-3.5-flash-lite`) + visual richness heuristics to select the
 *    SINGLE BEST APP SCREENSHOT as `thumbnailPath` ("Ảnh thumbnail *" - top box).
 * 3. Places all REMAINING captured app screenshots (plus any Owner-uploaded images) into
 *    `screenshotsJson` ("Tải hình ảnh lên" - bottom box, max 10 images).
 */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";
import {
  getDb,
  spckUploadRepo,
  type SpckSessionSlotNumber,
} from "../db/sqlite";
import { getGeminiModel } from "../gemini/client";
import { assertPathAllowed } from "../security/path-allowlist";
import {
  DEFAULT_SPCK_THUMBNAIL_PATH,
  MAX_SPCK_SCREENSHOTS,
  findOwnerProvidedRootPhotos,
} from "./spck-scanner";
import {
  LMS_IMAGE_HEIGHT,
  LMS_IMAGE_WIDTH,
  normalizeImagesToLms16x9,
} from "./spck-image-normalizer";

export const APP_SCREENSHOTS_SUBDIR = "_spck_app_shots";
export const OWNER_UPLOADS_SUBDIR = "_spck_owner_uploads";
export const YOUTUBE_FRAMES_SUBDIR = "_spck_youtube_frames";

/** Desktop CSS layout size used to render student websites before downscaling to 960×540. */
const WEB_LAYOUT_WIDTH = 1440;
const WEB_LAYOUT_HEIGHT = 810;

export interface CapturedScreenItem {
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

export interface StudentAppCaptureResult {
  studentId: string;
  folderPath: string;
  capturedCount: number;
  thumbnailPath: string;
  /** Where the Thumbnail came from (Owner photos always win over auto screenshots). */
  thumbnailSource?: "OWNER_UPLOAD" | "OWNER_ROOT_PHOTO" | "APP_SCREENSHOT" | "DEFAULT_LOGO";
  galleryScreenshots: string[];
  aiSelectedReason?: string;
  ownerUploadedImages: string[];
  /** Photos the Owner placed directly in the student's root folder (not used by the student's code). */
  ownerRootPhotos?: string[];
  error?: string;
}

const PYTHON_PYQT6_CAPTURE_SCRIPT = `
import os
import re
import sys
import json
import hashlib
import tempfile
import xml.etree.ElementTree as ET

from PyQt6 import QtWidgets, QtCore, QtGui, uic

IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.webp', '.svg', '.bmp', '.gif'}
GENERIC_STEMS = {
    'images', 'image', 'img', 'pic', 'picture', 'photo', 'untitled', 'unnamed',
    'download', 'downloads', 'tải xuống', 'tai xuong', 'r', '1', '2', '3', '4'
}

def is_generic_stem(stem):
    s = re.sub(r'\\s*\\(\\d+\\)\\s*$', '', stem.strip().lower())
    if s in GENERIC_STEMS:
        return True
    if re.match(r'^(images?|img|pic|untitled|screenshot|ảnh chụp màn hình|anh chup man hinh)\\d*$', s):
        return True
    return False

def build_image_index(root_dir):
    by_rel = {}
    by_base = {}
    by_stem = {}
    if not os.path.isdir(root_dir):
        return {'by_rel': by_rel, 'by_base': by_base, 'by_stem': by_stem}
    for cur_root, dirs, files in os.walk(root_dir):
        dirs[:] = [
            d for d in dirs
            if not d.startswith('.')
            and d not in ('__pycache__', 'node_modules', '_spck_app_shots', '_spck_owner_uploads', '_synth_assets')
        ]
        for f in files:
            ext = os.path.splitext(f)[1].lower()
            if ext in IMAGE_EXTS:
                full = os.path.abspath(os.path.join(cur_root, f)).replace('\\\\', '/')
                rel = os.path.relpath(full, root_dir).replace('\\\\', '/').lower()
                by_rel[rel] = full
                base = f.lower()
                stem = os.path.splitext(base)[0]
                if base not in by_base:
                    by_base[base] = full
                if stem not in by_stem:
                    by_stem[stem] = full
    return {'by_rel': by_rel, 'by_base': by_base, 'by_stem': by_stem}

def lookup_in_index(raw_ref, ui_dir, root_dir, idx):
    ref = (raw_ref or '').strip().strip('"').strip("'")
    if not ref or ref.startswith('data:') or ref.startswith('http:') or ref.startswith('https:'):
        return None
    clean = re.sub(r'^:/+[^/]*/', '', ref)
    for cand in (
        os.path.abspath(os.path.join(ui_dir, ref)),
        os.path.abspath(os.path.join(root_dir, ref)),
        os.path.abspath(os.path.join(root_dir, clean)),
    ):
        if os.path.isfile(cand):
            return cand.replace('\\\\', '/')
    rel_norm = clean.replace('\\\\', '/').lstrip('./').lower()
    if rel_norm in idx['by_rel']:
        return idx['by_rel'][rel_norm]
    base = os.path.basename(clean.replace('\\\\', '/')).lower()
    if base in idx['by_base']:
        return idx['by_base'][base]
    stem = os.path.splitext(base)[0]
    if stem and stem in idx['by_stem']:
        return idx['by_stem'][stem]
    return None

def build_class_recovery_index(student_dir):
    abs_student = os.path.abspath(student_dir)
    class_dir = os.path.dirname(abs_student)
    sibling_widget_map = {}
    class_by_base = {}
    class_by_stem = {}
    if not os.path.isdir(class_dir):
        return {
            'sibling_widget_map': sibling_widget_map,
            'by_base': class_by_base,
            'by_stem': class_by_stem,
        }

    for entry in sorted(os.listdir(class_dir)):
        sib_dir = os.path.join(class_dir, entry)
        if not os.path.isdir(sib_dir) or os.path.abspath(sib_dir) == abs_student:
            continue
        if entry.startswith('.') or entry.startswith('_spck'):
            continue
        sib_idx = build_image_index(sib_dir)
        for b, full in sib_idx['by_base'].items():
            if b not in class_by_base:
                class_by_base[b] = full
        for s, full in sib_idx['by_stem'].items():
            if s not in class_by_stem:
                class_by_stem[s] = full

        # Index sibling .ui widget -> resolved image mappings
        for cur_root, dirs, files in os.walk(sib_dir):
            dirs[:] = [
                d for d in dirs
                if not d.startswith('.')
                and d not in ('__pycache__', 'node_modules', '_spck_app_shots', '_spck_owner_uploads', '_synth_assets')
            ]
            for f in files:
                if not f.lower().endswith('.ui'):
                    continue
                ui_file_lower = f.lower()
                ui_full = os.path.join(cur_root, f)
                ui_dir = os.path.dirname(ui_full)
                try:
                    root = ET.parse(ui_full).getroot()
                    sib_w_names = {w.attrib.get('name', '') for w in root.iter('widget') if w.attrib.get('name')}
                    for w in root.iter('widget'):
                        wname = w.attrib.get('name', '')
                        if not wname:
                            continue
                        sw, sh = 160, 120
                        geom = w.find("./property[@name='geometry']/rect")
                        if geom is not None:
                            try:
                                sw = int(geom.findtext('width') or 160)
                                sh = int(geom.findtext('height') or 120)
                            except Exception:
                                pass
                        for prop in w.findall('./property'):
                            pname = prop.attrib.get('name', '')
                            if pname == 'pixmap':
                                px = prop.find('pixmap')
                                if px is not None and px.text:
                                    found = lookup_in_index(px.text, ui_dir, sib_dir, sib_idx)
                                    if found:
                                        sibling_widget_map.setdefault((ui_file_lower, wname, 'pixmap'), []).append({
                                            'path': found,
                                            'width': sw,
                                            'height': sh,
                                            'widget_names': sib_w_names,
                                        })
                            elif pname == 'icon':
                                ic = prop.find('iconset/normaloff')
                                if ic is not None and ic.text:
                                    found = lookup_in_index(ic.text, ui_dir, sib_dir, sib_idx)
                                    if found:
                                        sibling_widget_map.setdefault((ui_file_lower, wname, 'icon'), []).append({
                                            'path': found,
                                            'width': sw,
                                            'height': sh,
                                            'widget_names': sib_w_names,
                                        })
                except Exception:
                    pass

    return {
        'sibling_widget_map': sibling_widget_map,
        'by_base': class_by_base,
        'by_stem': class_by_stem,
    }

def synthesize_missing_asset(raw_ref, ui_file_lower, wname, prop_kind, width, height, ui_text_blob, synth_dir):
    os.makedirs(synth_dir, exist_ok=True)
    key = f"{ui_file_lower}:{wname}:{prop_kind}:{width}x{height}:{raw_ref}"
    digest = hashlib.md5(key.encode('utf-8', errors='ignore')).hexdigest()[:10]
    out_path = os.path.join(synth_dir, f"synth_{wname}_{digest}.png").replace('\\\\', '/')
    if os.path.isfile(out_path):
        return out_path

    w = max(32, min(int(width or 120), 1200))
    h = max(32, min(int(height or 120), 900))
    ref_lower = (raw_ref or '').lower()
    blob_lower = (ui_text_blob or '').lower()

    # Case 1: Small icon or button iconset
    if prop_kind == 'icon' or (w <= 120 and h <= 120):
        sz = max(64, min(w, h))
        pix = QtGui.QPixmap(sz, sz)
        pix.fill(QtCore.Qt.GlobalColor.transparent)
        p = QtGui.QPainter(pix)
        p.setRenderHint(QtGui.QPainter.RenderHint.Antialiasing, True)
        pen = QtGui.QPen(QtGui.QColor(30, 41, 59), max(3, sz // 12))
        pen.setCapStyle(QtCore.Qt.PenCapStyle.RoundCap)
        pen.setJoinStyle(QtCore.Qt.PenJoinStyle.RoundJoin)
        p.setPen(pen)

        m = sz // 6
        if 'book' in ref_lower:
            p.setBrush(QtGui.QColor(59, 130, 246, 40))
            p.drawRoundedRect(m, m, sz - 2 * m, sz - 2 * m, 6, 6)
            p.drawLine(sz // 2, m, sz // 2, sz - m)
            p.drawLine(m + 6, m + 12, sz // 2 - 4, m + 12)
            p.drawLine(m + 6, m + 22, sz // 2 - 4, m + 22)
        elif 'pen' in ref_lower or 'edit' in ref_lower:
            p.setBrush(QtGui.QColor(16, 185, 129, 40))
            poly = QtGui.QPolygon([
                QtCore.QPoint(m, sz - m),
                QtCore.QPoint(m + 14, sz - m - 4),
                QtCore.QPoint(sz - m, m + 10),
                QtCore.QPoint(sz - m - 10, m),
                QtCore.QPoint(m + 4, sz - m - 14),
            ])
            p.drawPolygon(poly)
        elif 'house' in ref_lower or 'home' in ref_lower:
            p.setBrush(QtGui.QColor(99, 102, 241, 40))
            roof = QtGui.QPolygon([
                QtCore.QPoint(sz // 2, m),
                QtCore.QPoint(sz - m, sz // 2),
                QtCore.QPoint(m, sz // 2),
            ])
            p.drawPolygon(roof)
            p.drawRect(m + 8, sz // 2, sz - 2 * (m + 8), sz // 2 - m)
        elif 'user' in ref_lower or 'avatar' in ref_lower:
            p.setBrush(QtGui.QColor(139, 92, 246, 40))
            p.drawEllipse(sz // 2 - sz // 6, m, sz // 3, sz // 3)
            p.drawArc(m, sz // 2, sz - 2 * m, sz // 2, 0, 180 * 16)
        else:
            p.setBrush(QtGui.QColor(59, 130, 246, 50))
            p.drawRoundedRect(m, m, sz - 2 * m, sz - 2 * m, 10, 10)
            p.drawEllipse(sz // 3, sz // 3, sz // 3, sz // 3)
        p.end()
        pix.save(out_path, 'PNG')
        return out_path

    # Case 2: Large Background / World Map / Banner
    pix = QtGui.QPixmap(w, h)
    p = QtGui.QPainter(pix)
    p.setRenderHint(QtGui.QPainter.RenderHint.Antialiasing, True)

    is_world_map = any(k in blob_lower for k in ('north america', 'south america', 'africa', 'asian', 'europe'))
    is_history = 'history' in ref_lower or 'history' in blob_lower or 'atlas' in blob_lower
    is_math = 'math' in ref_lower or 'bình phương' in blob_lower or 'lập phương' in blob_lower
    is_ocean = 'ocean' in blob_lower or 'deep sea' in blob_lower

    grad = QtGui.QLinearGradient(0, 0, w, h)
    if is_world_map:
        grad.setColorAt(0.0, QtGui.QColor(14, 116, 144))
        grad.setColorAt(0.5, QtGui.QColor(3, 105, 161))
        grad.setColorAt(1.0, QtGui.QColor(15, 23, 42))
    elif is_history:
        grad.setColorAt(0.0, QtGui.QColor(30, 27, 75))
        grad.setColorAt(0.5, QtGui.QColor(49, 46, 129))
        grad.setColorAt(1.0, QtGui.QColor(15, 23, 42))
    elif is_math:
        grad.setColorAt(0.0, QtGui.QColor(30, 58, 138))
        grad.setColorAt(1.0, QtGui.QColor(29, 78, 216))
    elif is_ocean:
        grad.setColorAt(0.0, QtGui.QColor(2, 132, 199))
        grad.setColorAt(1.0, QtGui.QColor(12, 74, 110))
    else:
        grad.setColorAt(0.0, QtGui.QColor(30, 41, 59))
        grad.setColorAt(0.5, QtGui.QColor(51, 65, 85))
        grad.setColorAt(1.0, QtGui.QColor(15, 23, 42))
    p.fillRect(0, 0, w, h, QtGui.QBrush(grad))

    # Subtle grid lines
    grid_pen = QtGui.QPen(QtGui.QColor(255, 255, 255, 22), 1)
    p.setPen(grid_pen)
    step = max(40, min(w, h) // 8)
    for gx in range(0, w, step):
        p.drawLine(gx, 0, gx, h)
    for gy in range(0, h, step):
        p.drawLine(0, gy, w, gy)

    if is_world_map:
        # Draw stylized continent landmasses matching typical button positions
        p.setPen(QtGui.QPen(QtGui.QColor(134, 239, 172, 110), 2))
        p.setBrush(QtGui.QColor(34, 197, 94, 85))
        # North America (top-left)
        p.drawEllipse(int(w * 0.10), int(h * 0.14), int(w * 0.24), int(h * 0.22))
        # South America (bottom-left)
        p.drawEllipse(int(w * 0.22), int(h * 0.42), int(w * 0.16), int(h * 0.28))
        # Africa (center)
        p.drawEllipse(int(w * 0.43), int(h * 0.28), int(w * 0.18), int(h * 0.26))
        # Asia / Eurasia (top-right)
        p.drawEllipse(int(w * 0.58), int(h * 0.12), int(w * 0.30), int(h * 0.28))
    else:
        # Decorative glowing circles
        p.setPen(QtGui.QPen(QtGui.QColor(255, 255, 255, 35), 2))
        p.setBrush(QtGui.QColor(255, 255, 255, 18))
        p.drawEllipse(int(w * 0.65), int(h * 0.12), int(min(w, h) * 0.45), int(min(w, h) * 0.45))
        p.drawEllipse(int(w * 0.08), int(h * 0.55), int(min(w, h) * 0.32), int(min(w, h) * 0.32))

    p.end()
    pix.save(out_path, 'PNG')
    return out_path

def resolve_widget_asset(raw_ref, ui_file_lower, wname, prop_kind, width, height, cur_w_names, ui_dir, root_dir, local_idx, class_idx, ui_text_blob, synth_dir):
    ref = (raw_ref or '').strip().strip('"').strip("'")
    if not ref or ref.startswith('data:') or ref.startswith('http:') or ref.startswith('https:'):
        return raw_ref

    # Layer 1: Local student folder (exact relative, basename, or stem)
    found_local = lookup_in_index(ref, ui_dir, root_dir, local_idx)
    if found_local:
        return found_local

    # Layer 2: Sibling UI Widget Map (same .ui filename + same widget name + compatible geometry & widget set)
    sib_map = class_idx.get('sibling_widget_map', {})
    candidates = sib_map.get((ui_file_lower, wname, prop_kind), [])
    for cand in candidates:
        dw = abs(int(width or 160) - int(cand.get('width', 160)))
        dh = abs(int(height or 120) - int(cand.get('height', 120)))
        common_widgets = len(cur_w_names.intersection(cand.get('widget_names', set())))
        if dw <= 60 and dh <= 60 and common_widgets >= 4:
            return cand['path']

    # Layer 3: Descriptive filename match in class folder or user Downloads
    clean = re.sub(r'^:/+[^/]*/', '', ref)
    base = os.path.basename(clean.replace('\\\\', '/')).lower()
    stem = os.path.splitext(base)[0]
    downloads_dir = os.path.join(os.path.expanduser('~'), 'Downloads')
    dl_cand = os.path.join(downloads_dir, os.path.basename(clean.replace('\\\\', '/')))
    if os.path.isfile(dl_cand):
        return os.path.abspath(dl_cand).replace('\\\\', '/')

    if not is_generic_stem(stem):
        if base in class_idx.get('by_base', {}):
            return class_idx['by_base'][base]
        if stem in class_idx.get('by_stem', {}):
            return class_idx['by_stem'][stem]

    # Layer 4: Synthesize contextual illustration / icon / banner PNG
    return synthesize_missing_asset(ref, ui_file_lower, wname, prop_kind, width, height, ui_text_blob, synth_dir)

def patch_ui_xml(xml_text, ui_abs, root_dir, local_idx, class_idx, synth_dir):
    ui_dir = os.path.dirname(ui_abs)
    ui_file_lower = os.path.basename(ui_abs).lower()
    try:
        tree = ET.fromstring(xml_text)
        cur_w_names = {w.attrib.get('name', '') for w in tree.iter('widget') if w.attrib.get('name')}
        # Collect text blob for context
        texts = []
        for s in tree.iter('string'):
            if s.text and len(s.text.strip()) < 80:
                texts.append(s.text.strip())
        ui_text_blob = ' '.join(texts)

        for w in tree.iter('widget'):
            wname = w.attrib.get('name', '')
            width, height = 160, 120
            geom = w.find("./property[@name='geometry']/rect")
            if geom is not None:
                try:
                    width = int(geom.findtext('width') or 160)
                    height = int(geom.findtext('height') or 120)
                except Exception:
                    pass

            for prop in w.findall('./property'):
                pname = prop.attrib.get('name', '')
                if pname == 'pixmap':
                    px = prop.find('pixmap')
                    if px is not None and px.text and px.text.strip():
                        px.text = resolve_widget_asset(
                            px.text, ui_file_lower, wname, 'pixmap', width, height, cur_w_names,
                            ui_dir, root_dir, local_idx, class_idx, ui_text_blob, synth_dir
                        )
                elif pname == 'icon':
                    ic_set = prop.find('iconset')
                    if ic_set is not None:
                        for tag_name in ('normaloff', 'normalon', 'activeoff', 'activeon'):
                            el = ic_set.find(tag_name)
                            if el is not None and el.text and el.text.strip():
                                el.text = resolve_widget_asset(
                                    el.text, ui_file_lower, wname, 'icon', 64, 64, cur_w_names,
                                    ui_dir, root_dir, local_idx, class_idx, ui_text_blob, synth_dir
                                )
                elif pname == 'styleSheet':
                    st = prop.find('string')
                    if st is not None and st.text and 'url(' in st.text:
                        def repl_url(match):
                            inner = match.group(1)
                            resolved = resolve_widget_asset(
                                inner, ui_file_lower, wname, 'pixmap', width, height, cur_w_names,
                                ui_dir, root_dir, local_idx, class_idx, ui_text_blob, synth_dir
                            )
                            return f"url({resolved})"
                        st.text = re.sub(r'url\\(([^)]+)\\)', repl_url, st.text)

        return ET.tostring(tree, encoding='unicode')
    except Exception:
        return xml_text

def compute_color_richness(qimg):
    if qimg.isNull() or qimg.width() <= 0 or qimg.height() <= 0:
        return 0
    buckets = set()
    step_x = max(1, qimg.width() // 40)
    step_y = max(1, qimg.height() // 40)
    for y in range(0, qimg.height(), step_y):
        for x in range(0, qimg.width(), step_x):
            c = qimg.pixelColor(x, y)
            buckets.add((c.red() // 16, c.green() // 16, c.blue() // 16))
    return len(buckets)

def save_pixmap_with_hash(pix, out_dir, prefix_name):
    tmp_path = os.path.join(out_dir, f"__tmp_{prefix_name}.png")
    pix.save(tmp_path, 'PNG')
    with open(tmp_path, 'rb') as bf:
        h6 = hashlib.md5(bf.read()).hexdigest()[:6]
    final_name = f"{prefix_name}_{h6}.png"
    final_path = os.path.join(out_dir, final_name)
    if os.path.exists(final_path):
        try:
            os.remove(tmp_path)
        except Exception:
            pass
    else:
        os.replace(tmp_path, final_path)
    return final_path

def main():
    if hasattr(sys.stdin, 'reconfigure'):
        sys.stdin.reconfigure(encoding='utf-8')
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    payload = json.loads(sys.stdin.buffer.read().decode('utf-8'))
    student_dir = payload['studentDir']
    ui_files = payload['uiFiles']
    out_dir = payload['outDir']
    max_shots = int(payload.get('maxShots', 11))

    os.makedirs(out_dir, exist_ok=True)
    synth_dir = os.path.join(out_dir, '_synth_assets')
    local_idx = build_image_index(student_dir)
    class_idx = build_class_recovery_index(student_dir)

    app = QtWidgets.QApplication(sys.argv)
    results = []

    os.chdir(student_dir)

    for idx, rel_ui in enumerate(ui_files):
        if len(results) >= max_shots:
            break
        ui_abs = os.path.abspath(os.path.join(student_dir, rel_ui))
        if not os.path.isfile(ui_abs):
            continue
        ui_dir = os.path.dirname(ui_abs)
        base_stem = os.path.splitext(os.path.basename(ui_abs))[0]
        safe_stem = re.sub(r'[^a-zA-Z0-9_-]+', '_', base_stem).strip('_') or f"screen_{idx+1}"

        tmp_ui_path = None
        try:
            with open(ui_abs, 'r', encoding='utf-8', errors='ignore') as f:
                raw_xml = f.read()
            patched_xml = patch_ui_xml(raw_xml, ui_abs, student_dir, local_idx, class_idx, synth_dir)
            fd, tmp_ui_path = tempfile.mkstemp(suffix='.ui', dir=ui_dir)
            with os.fdopen(fd, 'w', encoding='utf-8') as tf:
                tf.write(patched_xml)

            w = uic.loadUi(tmp_ui_path)
            w.setAttribute(QtCore.Qt.WidgetAttribute.WA_DontShowOnScreen, True)
            if w.width() < 200 or w.height() < 150:
                w.resize(max(w.width(), 800), max(w.height(), 550))
            w.show()
            app.processEvents()

            pix = w.grab()
            if not pix.isNull() and pix.width() >= 100 and pix.height() >= 100:
                out_path = save_pixmap_with_hash(pix, out_dir, f"app_{len(results)+1:02d}_{safe_stem}")
                qimg = pix.toImage()
                richness = compute_color_richness(qimg)
                widget_count = len(w.findChildren(QtWidgets.QWidget))
                lower_name = base_stem.lower()
                is_auth = any(k in lower_name for k in ('login', 'register', 'signup', 'sign_up', 'sign in', 'signin', 'dangnhap', 'dangky'))
                is_main = any(k in lower_name for k in ('main', 'home', 'menu', 'trang_1', 'trang1', 'chonpet', 'planets', 'danhsach', 'diary'))
                score = richness * 3 + min(widget_count, 60) * 2 + (150 if is_main else 0) - (600 if is_auth else 0)
                results.append({
                    'filePath': out_path,
                    'screenName': base_stem,
                    'sourceFile': rel_ui,
                    'width': pix.width(),
                    'height': pix.height(),
                    'widgetCount': widget_count,
                    'colorRichness': richness,
                    'isAuthScreen': is_auth,
                    'heuristicScore': score
                })

                # If this .ui has a QStackedWidget with multiple pages and total ui_files <= 4, also capture pages
                if len(ui_files) <= 4:
                    stacks = w.findChildren(QtWidgets.QStackedWidget)
                    for st in stacks:
                        if st.count() > 1:
                            for p_idx in range(1, min(st.count(), 5)):
                                if len(results) >= max_shots:
                                    break
                                st.setCurrentIndex(p_idx)
                                app.processEvents()
                                pix_p = w.grab()
                                if not pix_p.isNull():
                                    out_p_path = save_pixmap_with_hash(pix_p, out_dir, f"app_{len(results)+1:02d}_{safe_stem}_p{p_idx+1}")
                                    qimg_p = pix_p.toImage()
                                    rich_p = compute_color_richness(qimg_p)
                                    results.append({
                                        'filePath': out_p_path,
                                        'screenName': f"{base_stem}_page{p_idx+1}",
                                        'sourceFile': rel_ui,
                                        'width': pix_p.width(),
                                        'height': pix_p.height(),
                                        'widgetCount': widget_count,
                                        'colorRichness': rich_p,
                                        'isAuthScreen': False,
                                        'heuristicScore': rich_p * 3 + min(widget_count, 60) * 2
                                    })
            w.close()
        except Exception as e:
            pass
        finally:
            if tmp_ui_path and os.path.exists(tmp_ui_path):
                try:
                    os.remove(tmp_ui_path)
                except Exception:
                    pass

    print("JSON_CAPTURE_RESULT:" + json.dumps(results, ensure_ascii=True))

if __name__ == '__main__':
    main()
`;

function findProjectUiFiles(studentDir: string): string[] {
  const found: Array<{ relPath: string; priority: number }> = [];

  const walk = (currentDir: string, depth: number) => {
    if (depth > 3) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (
        entry.name.startsWith(".") ||
        entry.name === "__pycache__" ||
        entry.name === "node_modules" ||
        entry.name === APP_SCREENSHOTS_SUBDIR ||
        entry.name === OWNER_UPLOADS_SUBDIR ||
        entry.name === YOUTUBE_FRAMES_SUBDIR
      ) {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".ui")) {
        const relPath = path.relative(studentDir, fullPath);
        const lower = entry.name.toLowerCase();
        if (lower === "untitled.ui") continue;

        let priority = 50;
        if (/(main|home|menu|chonpet|planets|danhsach|diary|trang_1|trang1)/i.test(lower)) {
          priority = 10;
        } else if (/(login|register|signup|sign_up|sign in|signin)/i.test(lower)) {
          priority = 90;
        } else if (depth === 0 || /^gui[\\/][^\\/]+\.ui$/i.test(relPath)) {
          priority = 30;
        } else {
          priority = 60;
        }
        found.push({ relPath, priority });
      }
    }
  };

  walk(studentDir, 0);
  found.sort((a, b) => a.priority - b.priority || a.relPath.localeCompare(b.relPath));
  return found.map((f) => f.relPath);
}

const DRAFT_OR_BACKUP_DIR_REGEX = /^(draf|draft|drafts|backup|backups|old|temp|tmp|archive)$/i;

/**
 * Finds all Website `.html` / `.htm` files in a student's project folder,
 * prioritizing main entry pages (`index.html`, `home.html`), then feature pages,
 * and placing login/register pages last. Automatically skips `draf`/`draft`/`backup`
 * subfolders when primary `.html` files exist outside draft folders.
 */
function findProjectHtmlFiles(studentDir: string): string[] {
  const found: Array<{ relPath: string; priority: number; inDraftDir: boolean }> = [];

  const walk = (currentDir: string, depth: number, inDraftDir: boolean) => {
    if (depth > 3) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (
        entry.name.startsWith(".") ||
        entry.name === "__pycache__" ||
        entry.name === "node_modules" ||
        entry.name === ".venv" ||
        entry.name === "venv" ||
        entry.name === "dist" ||
        entry.name === "build" ||
        entry.name === APP_SCREENSHOTS_SUBDIR ||
        entry.name === OWNER_UPLOADS_SUBDIR ||
        entry.name === YOUTUBE_FRAMES_SUBDIR
      ) {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        const nextInDraft = inDraftDir || DRAFT_OR_BACKUP_DIR_REGEX.test(entry.name);
        walk(fullPath, depth + 1, nextInDraft);
      } else if (entry.isFile() && /\.html?$/i.test(entry.name)) {
        const relPath = path.relative(studentDir, fullPath);
        const lower = entry.name.toLowerCase();
        const stem = path.basename(lower, path.extname(lower));

        let priority = 50;
        if (/^(index|home|main|trang[_-]?chu|default)$/i.test(stem)) {
          priority = depth === 0 ? 10 : 18;
        } else if (
          /(login|auth|register|signup|sign[_-]?up|sign[_-]?in|dang[_-]?nhap|dang[_-]?ky)/i.test(
            stem
          )
        ) {
          priority = 90;
        } else if (depth === 0) {
          priority = 30;
        } else {
          priority = 55;
        }
        found.push({ relPath, priority, inDraftDir });
      }
    }
  };

  walk(studentDir, 0, false);
  const nonDraft = found.filter((f) => !f.inDraftDir);
  const activeList = nonDraft.length > 0 ? nonDraft : found;
  activeList.sort(
    (a, b) =>
      a.priority - b.priority ||
      a.relPath.localeCompare(b.relPath, "en", { numeric: true })
  );
  return activeList.map((f) => f.relPath);
}

/**
 * Fits every captured PyQt App window (any size / aspect ratio) completely inside the LMS-safe
 * 960×540 (16:9) frame (contain mode on a soft blurred backdrop) so no button or edge of the App
 * is cut off by the MindX LMS viewer. The normalized file gets a NEW content-hash name, and the raw
 * window capture is removed only if it is not referenced by any saved/verified session snapshot
 * (protects file-drift detection on already submitted files).
 */
async function normalizeCapturedAppWindowsToLms(
  items: CapturedScreenItem[],
  outDir: string,
  referencedFiles: Set<string>
): Promise<CapturedScreenItem[]> {
  if (items.length === 0) return items;
  let normalized: Array<Buffer | null> = [];
  try {
    normalized = await normalizeImagesToLms16x9(
      items.map((it) => ({ buffer: fs.readFileSync(it.filePath), fit: "contain" as const }))
    );
  } catch {
    return items;
  }

  const out: CapturedScreenItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const buf = normalized[i];
    if (!buf) {
      out.push(item);
      continue;
    }
    const rawBase = path.basename(item.filePath, ".png");
    const prefix = rawBase.replace(/_[0-9a-f]{6}$/i, "");
    const hash6 = crypto.createHash("md5").update(buf).digest("hex").slice(0, 6);
    const finalPath = path.join(outDir, `${prefix}_${hash6}.png`);
    try {
      if (!fs.existsSync(finalPath)) {
        fs.writeFileSync(finalPath, buf);
      }
      if (
        !samePathLoose(finalPath, item.filePath) &&
        !referencedFiles.has(path.basename(item.filePath))
      ) {
        fs.unlinkSync(item.filePath);
      }
      out.push({
        ...item,
        filePath: finalPath,
        width: LMS_IMAGE_WIDTH,
        height: LMS_IMAGE_HEIGHT,
      });
    } catch {
      out.push(item);
    }
  }
  return out;
}

function samePathLoose(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

const STATIC_MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".jfif": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

/**
 * Resolves a URL pathname requested by the local website preview server to a REAL file inside the
 * student's folder. Rejects (403) traversal outside the folder, symlinks / junctions whose real target
 * is outside the student's real folder (V272-F09), and anything outside the Path Allowlist.
 */
export function resolveSafeStaticFile(
  studentRoot: string,
  urlPathname: string
): { ok: true; filePath: string } | { ok: false; status: 403 | 404 } {
  let safeRoot: string;
  try {
    safeRoot = path.resolve(assertPathAllowed(studentRoot));
  } catch {
    return { ok: false, status: 403 };
  }
  let realSafeRoot = safeRoot;
  try {
    realSafeRoot = fs.realpathSync(safeRoot);
  } catch {
    // keep resolved path
  }
  let decodedPathname = "/";
  try {
    decodedPathname = decodeURIComponent(urlPathname || "/");
  } catch {
    decodedPathname = urlPathname || "/";
  }
  const relativeReq = decodedPathname.replace(/^\/+/, "");
  const candidatePath = path.resolve(safeRoot, relativeReq || "index.html");
  const rootWithSep = safeRoot.endsWith(path.sep) ? safeRoot : safeRoot + path.sep;
  if (
    candidatePath.toLowerCase() !== safeRoot.toLowerCase() &&
    !candidatePath.toLowerCase().startsWith(rootWithSep.toLowerCase())
  ) {
    return { ok: false, status: 403 };
  }
  let targetFile = candidatePath;
  try {
    if (fs.existsSync(targetFile) && fs.statSync(targetFile).isDirectory()) {
      targetFile = path.join(targetFile, "index.html");
    }
    if (!fs.existsSync(targetFile) || !fs.statSync(targetFile).isFile()) {
      return { ok: false, status: 404 };
    }
    const realTarget = fs.realpathSync(targetFile);
    const realRootWithSep = realSafeRoot.endsWith(path.sep) ? realSafeRoot : realSafeRoot + path.sep;
    const realLower = realTarget.toLowerCase();
    if (
      realLower !== realSafeRoot.toLowerCase() &&
      !realLower.startsWith(realRootWithSep.toLowerCase())
    ) {
      return { ok: false, status: 403 };
    }
    assertPathAllowed(realTarget);
    return { ok: true, filePath: realTarget };
  } catch {
    return { ok: false, status: 403 };
  }
}

/**
 * Renders a student's Website `.html` files inside an isolated local HTTP server + headless Chromium
 * using a desktop layout of 1440×810 CSS px, but outputs LMS-safe 960×540 (16:9) pixels so the
 * MindX LMS viewer never crops the left/right edges. Forces scroll-reveal / fade-in animations
 * (`data-aos`, `animation-timeline: view()`, `fadeIn`...) to their final visible state,
 * captures multi-page and multi-section screenshots into `<outDir>/app_NN_<name>_<hash6>.png`,
 * and computes visual richness & widget metrics for AI Thumbnail selection.
 */
async function captureHtmlWebScreenshots(params: {
  studentDir: string;
  htmlFiles: string[];
  outDir: string;
  maxShots: number;
}): Promise<CapturedScreenItem[]> {
  const { studentDir, htmlFiles, outDir, maxShots } = params;
  const safeRoot = path.resolve(assertPathAllowed(studentDir));
  const results: CapturedScreenItem[] = [];
  const seenHashes = new Set<string>();

  const server = http.createServer((req, res) => {
    try {
      const reqUrl = new URL(req.url || "/", "http://127.0.0.1");
      const resolved = resolveSafeStaticFile(safeRoot, reqUrl.pathname);
      if (!resolved.ok) {
        res.writeHead(resolved.status);
        res.end(resolved.status === 403 ? "Forbidden" : "Not Found");
        return;
      }
      const ext = path.extname(resolved.filePath).toLowerCase();
      const contentType = STATIC_MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      });
      res.end(fs.readFileSync(resolved.filePath));
    } catch {
      res.writeHead(500);
      res.end("Internal Error");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  const savePngWithHash = (
    pngBuf: Buffer,
    prefixName: string
  ): { filePath: string; hash6: string } => {
    const hash6 = crypto.createHash("md5").update(pngBuf).digest("hex").slice(0, 6);
    const finalName = `${prefixName}_${hash6}.png`;
    const finalPath = path.join(outDir, finalName);
    fs.writeFileSync(finalPath, pngBuf);
    return { filePath: finalPath, hash6 };
  };

  try {
    browser = await chromium.launch({ headless: true });
    // Render the page at a desktop layout width (1440×810 CSS px) so the student's design does not
    // collapse into a mobile layout, but output pixels at the LMS-safe 960×540 (deviceScaleFactor 2/3)
    // so the MindX LMS viewer never crops the left/right edges or shows a horizontal scrollbar.
    const context = await browser.newContext({
      viewport: { width: WEB_LAYOUT_WIDTH, height: WEB_LAYOUT_HEIGHT },
      deviceScaleFactor: LMS_IMAGE_WIDTH / WEB_LAYOUT_WIDTH,
    });
    const page = await context.newPage();

    const takeLmsSafeScreenshot = async (): Promise<Buffer> => {
      const raw = await page.screenshot({
        type: "png",
        fullPage: false,
        animations: "disabled",
      });
      return Buffer.from(raw);
    };

    // Forces any scroll-reveal / fade-in element that is inside the viewport (or the whole page)
    // to its final visible state so screenshots never show empty black sections.
    const forceRevealVisibleContent = async () => {
      await page
        .evaluate(() => {
          const revealRe = /(reveal|fade|aos|animate|appear|scroll|show|slide|zoom|wow)/i;
          const all = Array.from(document.querySelectorAll<HTMLElement>("body *"));
          for (const el of all) {
            const cls = typeof el.className === "string" ? el.className : "";
            const style = window.getComputedStyle(el);
            const hidden =
              style.opacity === "0" ||
              (style.visibility === "hidden" && revealRe.test(cls));
            if (!hidden) continue;
            if (!revealRe.test(cls) && !el.hasAttribute("data-aos")) continue;
            el.style.setProperty("opacity", "1", "important");
            el.style.setProperty("visibility", "visible", "important");
            el.style.setProperty("transform", "none", "important");
            el.style.setProperty("filter", "none", "important");
          }
        })
        .catch(() => undefined);
    };

    for (let idx = 0; idx < htmlFiles.length; idx++) {
      if (results.length >= maxShots) break;
      const relHtml = htmlFiles[idx];
      const relPosix = relHtml
        .split(path.sep)
        .map((seg) => encodeURIComponent(seg))
        .join("/");
      const pageUrl = `http://127.0.0.1:${port}/${relPosix}`;

      const baseStem = path.basename(relHtml, path.extname(relHtml));
      const safeStem =
        baseStem.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") ||
        `web_${idx + 1}`;
      const lowerStem = baseStem.toLowerCase();
      const isAuth =
        /(login|auth|register|signup|sign[_-]?up|sign[_-]?in|dang[_-]?nhap|dang[_-]?ky)/i.test(
          lowerStem
        );
      const isMain = /^(index|home|main|trang[_-]?chu|default)$/i.test(lowerStem);

      try {
        await page
          .goto(pageUrl, { waitUntil: "load", timeout: 10_000 })
          .catch(() => undefined);

        // Force scroll-reveal animations (AOS, animation-timeline: view(), fadeIn...) to their final
        // visible state immediately and disable smooth scroll so nothing is captured half-faded.
        await page
          .addStyleTag({
            content: `
              html, body { scroll-behavior: auto !important; }
              *, *::before, *::after {
                animation-duration: 0.001s !important;
                animation-delay: 0s !important;
                animation-iteration-count: 1 !important;
                animation-timeline: auto !important;
                transition-duration: 0s !important;
                transition-delay: 0s !important;
              }
              [data-aos], .aos-init, .aos-animate {
                opacity: 1 !important;
                transform: none !important;
                visibility: visible !important;
                transition: none !important;
              }
            `,
          })
          .catch(() => undefined);

        // Wait up to 2.2s for images & web fonts to finish loading
        await page
          .evaluate(async () => {
            const imgs = Array.from(document.querySelectorAll("img"));
            for (const img of imgs) {
              if (img.loading === "lazy") img.loading = "eager";
            }
            const waitImgs = Promise.all(
              imgs.map((img) =>
                img.complete
                  ? Promise.resolve()
                  : new Promise<void>((res) => {
                      img.addEventListener("load", () => res(), { once: true });
                      img.addEventListener("error", () => res(), { once: true });
                    })
              )
            );
            const waitFonts =
              document.fonts && document.fonts.ready
                ? document.fonts.ready.then(() => undefined).catch(() => undefined)
                : Promise.resolve();
            await Promise.race([
              Promise.all([waitImgs, waitFonts]),
              new Promise<void>((res) => setTimeout(res, 2200)),
            ]);
            window.scrollTo(0, 0);
          })
          .catch(() => undefined);

        await page.waitForTimeout(250);
        await forceRevealVisibleContent();

        const measureViewportMetrics = async () => {
          return await page
            .evaluate(() => {
              const vh = window.innerHeight || 810;
              const scrollHeight = Math.max(
                document.body ? document.body.scrollHeight : 0,
                document.documentElement ? document.documentElement.scrollHeight : 0,
                vh
              );
              const selectors =
                "button, a, input, select, textarea, img, video, canvas, svg, .card, section, article, nav, header, footer, table, form, h1, h2, h3";
              const allNodes = Array.from(document.querySelectorAll(selectors));
              let visibleWidgets = 0;
              let visibleImages = 0;
              const colorSet = new Set<string>();

              for (const el of allNodes) {
                const rect = el.getBoundingClientRect();
                if (rect.width <= 2 || rect.height <= 2) continue;
                if (rect.bottom < 0 || rect.top > vh) continue;
                visibleWidgets++;
                if (el.tagName === "IMG") visibleImages++;
                const style = window.getComputedStyle(el);
                if (style.backgroundColor && style.backgroundColor !== "rgba(0, 0, 0, 0)") {
                  colorSet.add(style.backgroundColor);
                }
                if (style.color) {
                  colorSet.add(style.color);
                }
                if (style.backgroundImage && style.backgroundImage !== "none") {
                  colorSet.add(style.backgroundImage.slice(0, 48));
                }
              }

              const textLen = (document.body?.innerText || "").trim().length;
              const richness = Math.min(
                140,
                colorSet.size * 5 + visibleImages * 12 + Math.min(30, Math.floor(textLen / 80))
              );
              return {
                scrollHeight,
                widgetCount: Math.max(1, visibleWidgets),
                colorRichness: Math.max(12, richness),
                textLen,
              };
            })
            .catch(() => ({
              scrollHeight: 810,
              widgetCount: 15,
              colorRichness: 45,
              textLen: 100,
            }));
        };

        const topMetrics = await measureViewportMetrics();
        const topPng = await takeLmsSafeScreenshot();
        const topSaved = savePngWithHash(
          topPng,
          `app_${String(results.length + 1).padStart(2, "0")}_${safeStem}`
        );
        seenHashes.add(topSaved.hash6);

        const topScore =
          topMetrics.colorRichness * 3 +
          Math.min(topMetrics.widgetCount, 60) * 2 +
          (isMain ? 180 : 0) -
          (isAuth ? 600 : 0);

        results.push({
          filePath: topSaved.filePath,
          screenName: baseStem,
          sourceFile: relHtml,
          width: LMS_IMAGE_WIDTH,
          height: LMS_IMAGE_HEIGHT,
          widgetCount: topMetrics.widgetCount,
          colorRichness: topMetrics.colorRichness,
          isAuthScreen: isAuth,
          heuristicScore: topScore,
        });

        // If this is a long multi-section page and the student has <= 4 HTML files, also capture scrolled 16:9 sections
        if (!isAuth && htmlFiles.length <= 4 && topMetrics.scrollHeight >= 1300) {
          const maxExtraSections =
            htmlFiles.length === 1 ? 3 : htmlFiles.length <= 3 && isMain ? 2 : isMain ? 1 : 0;
          const maxScrollY = Math.max(0, topMetrics.scrollHeight - WEB_LAYOUT_HEIGHT);

          for (let sIdx = 1; sIdx <= maxExtraSections; sIdx++) {
            if (results.length >= maxShots) break;
            const targetY = Math.min(sIdx * 740, maxScrollY);
            if (targetY < 350) break;

            await page
              .evaluate((y) => window.scrollTo(0, y), targetY)
              .catch(() => undefined);
            await page.waitForTimeout(250);
            await forceRevealVisibleContent();

            const secMetrics = await measureViewportMetrics();
            const secPng = await takeLmsSafeScreenshot();
            const secHash6 = crypto
              .createHash("md5")
              .update(secPng)
              .digest("hex")
              .slice(0, 6);
            if (seenHashes.has(secHash6)) continue;

            const secSaved = savePngWithHash(
              secPng,
              `app_${String(results.length + 1).padStart(2, "0")}_${safeStem}_sec${sIdx + 1}`
            );
            seenHashes.add(secSaved.hash6);

            results.push({
              filePath: secSaved.filePath,
              screenName: `${baseStem}_section${sIdx + 1}`,
              sourceFile: relHtml,
              width: LMS_IMAGE_WIDTH,
              height: LMS_IMAGE_HEIGHT,
              widgetCount: secMetrics.widgetCount,
              colorRichness: secMetrics.colorRichness,
              isAuthScreen: false,
              heuristicScore:
                secMetrics.colorRichness * 3 +
                Math.min(secMetrics.widgetCount, 60) * 2 +
                (isMain ? 60 : 0),
            });

            if (targetY >= maxScrollY) break;
          }
        }
      } catch {
        // Ignore single broken HTML page and continue with next
      }
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return results;
}

/**
 * Lists any images explicitly uploaded by the Owner into `<studentDir>/_spck_owner_uploads/`.
 */
export function listOwnerUploadedImages(studentDir: string): string[] {
  const safeStudentDir = assertPathAllowed(studentDir);
  const ownerDir = path.join(safeStudentDir, OWNER_UPLOADS_SUBDIR);
  if (!fs.existsSync(ownerDir) || !fs.statSync(ownerDir).isDirectory()) {
    return [];
  }
  const exts = new Set([".png", ".jpg", ".jpeg", ".webp"]);
  return fs
    .readdirSync(ownerDir)
    .filter((f) => exts.has(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .map((f) => path.join(ownerDir, f));
}

/**
 * Lists already-captured app screenshots inside `<studentDir>/_spck_app_shots/`.
 */
export function listCapturedAppScreenshots(studentDir: string): string[] {
  const safeStudentDir = assertPathAllowed(studentDir);
  const shotsDir = path.join(safeStudentDir, APP_SCREENSHOTS_SUBDIR);
  if (!fs.existsSync(shotsDir) || !fs.statSync(shotsDir).isDirectory()) {
    return [];
  }
  const exts = new Set([".png", ".jpg", ".jpeg", ".webp"]);
  const rawFiles = fs
    .readdirSync(shotsDir)
    .filter((f) => exts.has(path.extname(f).toLowerCase()));
  const bySlotKey = new Map<string, { name: string; mtimeMs: number }>();
  for (const f of rawFiles) {
    const slotMatch = f.match(/^(app_\d+_.*?)_[0-9a-f]{6}\.png$/i);
    const slotKey = slotMatch ? slotMatch[1].toLowerCase() : f.toLowerCase();
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(path.join(shotsDir, f)).mtimeMs;
    } catch {
      mtimeMs = 0;
    }
    const prev = bySlotKey.get(slotKey);
    if (!prev || mtimeMs > prev.mtimeMs || (mtimeMs === prev.mtimeMs && f > prev.name)) {
      bySlotKey.set(slotKey, { name: f, mtimeMs });
    }
  }
  return Array.from(bySlotKey.values())
    .map((v) => v.name)
    .sort((a, b) => a.localeCompare(b))
    .map((f) => path.join(shotsDir, f));
}

/**
 * Uses Gemini Vision (`gemini-3.5-flash-lite`) to evaluate the captured app screenshots
 * and select the single best, most visually appealing screenshot for the SPCK Thumbnail.
 * Falls back to the highest heuristic-scored screenshot if offline.
 */
async function selectBestScreenshotWithAi(
  capturedItems: CapturedScreenItem[]
): Promise<{ bestItem: CapturedScreenItem; reason: string }> {
  if (capturedItems.length === 0) {
    throw new Error("Không có ảnh chụp giao diện nào để chọn Thumbnail.");
  }
  if (capturedItems.length === 1) {
    return {
      bestItem: capturedItems[0],
      reason: "Màn hình giao diện duy nhất của ứng dụng.",
    };
  }

  // Prefer non-auth screens (main/feature screens) over login/register screens for Thumbnail
  const nonAuthItems = capturedItems.filter((item) => !item.isAuthScreen);
  const pool = nonAuthItems.length > 0 ? nonAuthItems : capturedItems;

  // Sort candidates by heuristicScore descending (main screens & colorful layouts first)
  const sorted = [...pool].sort((a, b) => b.heuristicScore - a.heuristicScore);
  const topCandidates = sorted.slice(0, 6);

  try {
    const mediaParts: Array<{ inlineData: { data: string; mimeType: string } }> = [];
    const candidateLines: string[] = [];

    topCandidates.forEach((item, idx) => {
      const screenId = `SCREEN_0${idx + 1}`;
      const buf = fs.readFileSync(item.filePath);
      mediaParts.push({
        inlineData: {
          data: buf.toString("base64"),
          mimeType: "image/png",
        },
      });
      candidateLines.push(
        `- ${screenId}: Kích thước ${item.width}x${item.height}, Số thành phần giao diện: ${item.widgetCount}, Độ phong phú màu sắc: ${item.colorRichness}, Loại màn hình: ${
          item.isAuthScreen ? "Đăng nhập/Đăng ký" : "Màn hình chức năng/Trang chính"
        }`
      );
    });

    const model = getGeminiModel(undefined, 0.1);
    const promptText =
      `Bạn là Giám khảo Thiết kế Giao diện (UI/UX) cho Sản phẩm Cuối khóa tại MindX. Nhiệm vụ của bạn là quan sát các hình chụp giao diện ứng dụng thực tế và chọn ra 1 hình ĐẸP NHẤT, bố cục rõ ràng, màu sắc bắt mắt, thể hiện được màn hình chính hoặc tính năng nổi bật nhất của ứng dụng để làm Ảnh bìa (Thumbnail). Luôn ưu tiên màn hình trang chủ/chức năng chính hơn màn hình đăng nhập/đăng ký đơn giản.\n\n` +
      `Danh sách các hình chụp giao diện ứng dụng (theo đúng thứ tự ảnh đính kèm):\n${candidateLines.join(
        "\n"
      )}\n\nHãy trả về JSON dạng {"bestScreenId": "SCREEN_01", "reason": "..."} chọn 1 màn hình từ SCREEN_01..SCREEN_0${
        topCandidates.length
      } đẹp nhất để làm Ảnh bìa (Thumbnail).`;

    const resp = await model.generateContent([promptText, ...mediaParts]);
    const rawText = resp.response.text();
    const aiRes = JSON.parse(rawText) as {
      bestScreenId?: string;
      reason?: string;
    };

    const matchIdx =
      Number(String(aiRes?.bestScreenId || "").replace(/[^0-9]/g, "")) - 1;
    if (matchIdx >= 0 && matchIdx < topCandidates.length) {
      return {
        bestItem: topCandidates[matchIdx],
        reason: aiRes.reason || "AI đánh giá bố cục và màu sắc nổi bật nhất.",
      };
    }
  } catch {
    // Fallback to deterministic visual heuristic
  }

  return {
    bestItem: sorted[0],
    reason:
      "Tự động chọn màn hình chính có độ phong phú màu sắc và bố cục giao diện cao nhất.",
  };
}

/**
 * Captures app interface screenshots for a single student's project folder,
 * runs AI evaluation to pick the best screenshot as Thumbnail, and places the
 * remaining screenshots (plus any Owner-uploaded images) into the bottom gallery (`screenshotsJson`).
 */
export async function captureStudentAppScreenshots(params: {
  studentId: string;
  folderPath: string;
  useAiVision?: boolean;
  /** Existing YouTube presentation frames (`_spck_youtube_frames`) that must stay in the gallery. */
  preservedFrames?: string[];
}): Promise<StudentAppCaptureResult> {
  const { studentId, folderPath, useAiVision = true } = params;
  const safeFolderPath = assertPathAllowed(folderPath);

  if (!fs.existsSync(safeFolderPath) || !fs.statSync(safeFolderPath).isDirectory()) {
    throw new Error(`Thư mục dự án của học viên không tồn tại: ${safeFolderPath}`);
  }

  const outDir = path.join(safeFolderPath, APP_SCREENSHOTS_SUBDIR);
  const ownerImages = listOwnerUploadedImages(safeFolderPath);

  // Clean only unreferenced previous auto-captured shots; only frozen (APPROVED / SUBMITTED_PENDING_VERIFY / VERIFIED)
  // session snapshots lock old app_*.png files on disk, so unapproved DRAFT / WAITING_APPROVAL rows do not accumulate duplicates.
  const referencedFiles = new Set<string>();
  if (fs.existsSync(outDir)) {
    try {
      const db = getDb();
      const sessRows = db
        .prepare(
          `SELECT draftStatus, thumbnailPath, screenshotsJson, approvedSnapshotJson, lastVerifiedSnapshotJson
           FROM spck_session_submissions WHERE studentId = ?`
        )
        .all(studentId) as Array<Record<string, string | null>>;
      const protectedChunks: string[] = [];
      for (const sRow of sessRows) {
        if (sRow.approvedSnapshotJson) protectedChunks.push(sRow.approvedSnapshotJson);
        if (sRow.lastVerifiedSnapshotJson) protectedChunks.push(sRow.lastVerifiedSnapshotJson);
        if (
          sRow.draftStatus === "APPROVED" ||
          sRow.draftStatus === "SUBMITTED_PENDING_VERIFY" ||
          sRow.draftStatus === "VERIFIED"
        ) {
          if (sRow.thumbnailPath) protectedChunks.push(sRow.thumbnailPath);
          if (sRow.screenshotsJson) protectedChunks.push(sRow.screenshotsJson);
        }
      }
      const blob = protectedChunks.join("\n").toLowerCase();
      for (const f of fs.readdirSync(outDir)) {
        if (blob.includes(f.toLowerCase())) {
          referencedFiles.add(f);
        }
      }
    } catch {
      // ignore
    }
    for (const f of fs.readdirSync(outDir)) {
      if (f.startsWith("app_") && f.endsWith(".png") && !referencedFiles.has(f)) {
        try {
          fs.unlinkSync(path.join(outDir, f));
        } catch {
          // ignore
        }
      }
    }
  } else {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const uiFiles = findProjectUiFiles(safeFolderPath);
  const htmlFiles = uiFiles.length === 0 ? findProjectHtmlFiles(safeFolderPath) : [];
  // Photos the Owner placed directly in the student's root folder (not used by the student's code)
  const ownerRootPhotos = findOwnerProvidedRootPhotos(safeFolderPath);
  let capturedItems: CapturedScreenItem[] = [];

  if (uiFiles.length > 0) {
    // Capture screens without silently slicing over-limit UI lists
    const payload = JSON.stringify({
      studentDir: safeFolderPath,
      uiFiles,
      outDir,
      maxShots: Math.max(uiFiles.length, MAX_SPCK_SCREENSHOTS + 5),
    });

    const proc = spawnSync("python", ["-c", PYTHON_PYQT6_CAPTURE_SCRIPT], {
      input: payload,
      encoding: "utf-8",
      timeout: 30_000,
      windowsHide: true,
    });

    const stdout = String(proc.stdout || "");
    const markerIdx = stdout.indexOf("JSON_CAPTURE_RESULT:");
    if (markerIdx !== -1) {
      const jsonText = stdout.slice(markerIdx + "JSON_CAPTURE_RESULT:".length).trim();
      try {
        const parsed = JSON.parse(jsonText);
        if (Array.isArray(parsed)) {
          capturedItems = parsed.filter(
            (item: CapturedScreenItem) => item?.filePath && fs.existsSync(item.filePath)
          );
        }
      } catch {
        // ignore JSON parse error
      }
    }

    // Fit every App window (any size / ratio) completely inside the LMS-safe 960×540 (16:9) frame,
    // so no button or edge of the App is cut off when the LMS viewer shows the image.
    capturedItems = await normalizeCapturedAppWindowsToLms(capturedItems, outDir, referencedFiles);
  } else if (htmlFiles.length > 0) {
    const maxHtmlShots = Math.max(
      1,
      MAX_SPCK_SCREENSHOTS +
        1 -
        Math.min(ownerImages.length, MAX_SPCK_SCREENSHOTS) -
        Math.min(ownerRootPhotos.length, 2)
    );
    capturedItems = await captureHtmlWebScreenshots({
      studentDir: safeFolderPath,
      htmlFiles,
      outDir,
      maxShots: maxHtmlShots,
    });
  }

  // Select the best app screenshot via AI Vision (or heuristic fallback)
  let bestAppShotPath = "";
  let aiReason = "";
  if (capturedItems.length > 0) {
    if (useAiVision) {
      const selected = await selectBestScreenshotWithAi(capturedItems);
      bestAppShotPath = selected.bestItem.filePath;
      aiReason = selected.reason;
    } else {
      const sorted = [...capturedItems].sort(
        (a, b) => b.heuristicScore - a.heuristicScore
      );
      bestAppShotPath = sorted[0].filePath;
      aiReason =
        "Tự động chọn màn hình chính có độ phong phú màu sắc và bố cục giao diện cao nhất.";
    }
  }

  /**
   * Thumbnail & Gallery Rule (v2.7.2 — Owner photos first):
   * - Top box (`thumbnailPath`):
   *   1. Owner thumbnail uploaded via the bot (`_spck_owner_uploads/thumb_*`).
   *   2. Any other Owner-uploaded image (`_spck_owner_uploads/*`).
   *   3. Photo placed by the Owner directly in the student's root folder that is NOT used by the
   *      student's code (e.g. `Demo.png`, presentation photo, cover image).
   *   4. Best App/Web screenshot selected by AI (`bestAppShotPath`) — only when no Owner photo exists.
   *   5. MindX default logo.
   * - Bottom box (`galleryScreenshots` — max 10 images):
   *   1. All remaining Owner photos (never silently dropped; error if they alone exceed 10).
   *   2. Auto-captured App/Web screenshots (best screen first, then by visual score) filling the
   *      remaining slots up to the LMS limit of 10.
   */
  const samePath = (a: string, b: string) =>
    path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  const explicitOwnerThumb = ownerImages.find((p) =>
    /^thumb_/i.test(path.basename(p))
  );
  const ownerThumbCandidate =
    explicitOwnerThumb || ownerImages[0] || ownerRootPhotos[0] || "";

  let finalThumbnailPath = DEFAULT_SPCK_THUMBNAIL_PATH;
  let thumbnailSource: StudentAppCaptureResult["thumbnailSource"] = "DEFAULT_LOGO";
  if (ownerThumbCandidate) {
    finalThumbnailPath = ownerThumbCandidate;
    thumbnailSource = ownerImages.some((p) => samePath(p, ownerThumbCandidate))
      ? "OWNER_UPLOAD"
      : "OWNER_ROOT_PHOTO";
  } else if (bestAppShotPath) {
    finalThumbnailPath = bestAppShotPath;
    thumbnailSource = "APP_SCREENSHOT";
  }

  const galleryCandidates: string[] = [];
  const pushUnique = (p: string) => {
    if (!p || samePath(p, finalThumbnailPath)) return;
    if (galleryCandidates.some((g) => samePath(g, p))) return;
    galleryCandidates.push(p);
  };

  // 1. Owner content first (uploads + root photos) plus existing YouTube presentation frames
  //    (Robotics) — never silently dropped
  for (const ownerImg of [...ownerImages, ...ownerRootPhotos, ...(params.preservedFrames || [])]) {
    pushUnique(ownerImg);
  }
  if (galleryCandidates.length > MAX_SPCK_SCREENSHOTS) {
    throw new Error(
      `Số lượng hình ảnh do Owner cung cấp (${galleryCandidates.length}/${MAX_SPCK_SCREENSHOTS} ảnh) vượt giới hạn tối đa ${MAX_SPCK_SCREENSHOTS} ảnh bổ sung của LMS. Không tự động cắt bớt ảnh của Owner; vui lòng chỉ giữ tối đa ${MAX_SPCK_SCREENSHOTS} ảnh.`
    );
  }

  // 2. Auto-captured screenshots: AI best screen first, then by visual score, up to the LMS limit
  const orderedCapturedPaths = [...capturedItems]
    .sort((a, b) => b.heuristicScore - a.heuristicScore)
    .map((c) => c.filePath);
  if (bestAppShotPath) {
    const idx = orderedCapturedPaths.indexOf(bestAppShotPath);
    if (idx > 0) {
      orderedCapturedPaths.splice(idx, 1);
      orderedCapturedPaths.unshift(bestAppShotPath);
    }
  }
  let droppedAutoShots = 0;
  for (const shotPath of orderedCapturedPaths) {
    if (samePath(shotPath, finalThumbnailPath)) continue;
    if (galleryCandidates.length >= MAX_SPCK_SCREENSHOTS) {
      droppedAutoShots++;
      continue;
    }
    pushUnique(shotPath);
  }
  // Edge case: if there was only 1 captured screenshot total and 0 other images, keep it in gallery too so the bottom box isn't empty
  if (galleryCandidates.length === 0 && bestAppShotPath) {
    galleryCandidates.push(bestAppShotPath);
  }

  const galleryScreenshots = [...galleryCandidates];
  // Remove any newly-captured or leftover `app_*.png` files in `_spck_app_shots` that were dropped
  // due to the 10-image LMS cap and are not referenced by any frozen session snapshot.
  if (fs.existsSync(outDir)) {
    const activeChosenPaths = new Set(
      [finalThumbnailPath, ...galleryScreenshots]
        .filter(Boolean)
        .map((p) => path.resolve(p).toLowerCase())
    );
    for (const f of fs.readdirSync(outDir)) {
      if (!f.startsWith("app_") || !f.endsWith(".png")) continue;
      if (referencedFiles.has(f)) continue;
      const fullShotPath = path.resolve(outDir, f).toLowerCase();
      if (!activeChosenPaths.has(fullShotPath)) {
        try {
          fs.unlinkSync(path.join(outDir, f));
        } catch {
          // ignore
        }
      }
    }
  }
  const reasonParts = [
    thumbnailSource === "OWNER_UPLOAD"
      ? "Ảnh đại diện: ảnh do Owner tải lên."
      : thumbnailSource === "OWNER_ROOT_PHOTO"
      ? `Ảnh đại diện: ảnh Owner để sẵn trong thư mục (${path.basename(finalThumbnailPath)}).`
      : thumbnailSource === "APP_SCREENSHOT"
      ? `Ảnh đại diện: ảnh giao diện đẹp nhất. ${aiReason}`.trim()
      : "Ảnh đại diện: Logo MindX mặc định.",
  ];
  if (droppedAutoShots > 0) {
    reasonParts.push(
      `Đã bỏ bớt ${droppedAutoShots} ảnh chụp tự động ít nổi bật để không vượt giới hạn ${MAX_SPCK_SCREENSHOTS} ảnh của LMS.`
    );
  }

  return {
    studentId,
    folderPath: safeFolderPath,
    capturedCount: capturedItems.length,
    thumbnailPath: finalThumbnailPath,
    thumbnailSource,
    galleryScreenshots,
    aiSelectedReason: reasonParts.join(" "),
    ownerUploadedImages: ownerImages,
    ownerRootPhotos,
  };
}

/**
 * Captures app/web screenshots for an entire class (or selected `studentIds`),
 * updates `thumbnailPath` and `screenshotsJson` in SQLite `spck_uploads` (and syncs
 * into the active unverified/unapproved session draft when `sessionNumber` is provided),
 * and returns the batch summary.
 */
export async function captureClassAppScreenshotsAndSelectThumbnails(params: {
  classId: string;
  studentIds?: string[];
  useAiVision?: boolean;
  sessionNumber?: SpckSessionSlotNumber;
}): Promise<{
  classId: string;
  totalProcessed: number;
  totalScreenshotsCaptured: number;
  results: StudentAppCaptureResult[];
}> {
  const normalizedClassId = String(params.classId || "").trim().toUpperCase();
  const rows = spckUploadRepo.findByClass(normalizedClassId);
  const targetRows =
    params.studentIds && params.studentIds.length > 0
      ? rows.filter((r) => params.studentIds!.includes(r.studentId))
      : rows.filter((r) => Boolean(r.localFolderPath));

  const results: StudentAppCaptureResult[] = [];
  let totalScreenshotsCaptured = 0;

  for (const row of targetRows) {
    if (!row.localFolderPath) continue;
    try {
      let preservedFrames: string[] = [];
      try {
        const parsed = JSON.parse(row.screenshotsJson || "[]");
        if (Array.isArray(parsed)) {
          preservedFrames = parsed
            .map((p: unknown) => String(p || ""))
            .filter(
              (p) =>
                new RegExp(`[\\\\/]${YOUTUBE_FRAMES_SUBDIR}[\\\\/]`, "i").test(p) && fs.existsSync(p)
            );
        }
      } catch {
        preservedFrames = [];
      }
      const cap = await captureStudentAppScreenshots({
        studentId: row.studentId,
        folderPath: row.localFolderPath,
        useAiVision: params.useAiVision ?? true,
        preservedFrames,
      });
      totalScreenshotsCaptured += cap.capturedCount;
      results.push(cap);

      // Only overwrite shared resources if we actually captured app/web screenshots or have Owner photos
      if (
        cap.capturedCount > 0 ||
        cap.ownerUploadedImages.length > 0 ||
        (cap.ownerRootPhotos || []).length > 0
      ) {
        spckUploadRepo.updateSharedResources({
          classId: normalizedClassId,
          studentId: row.studentId,
          expectedFolderPath: row.localFolderPath,
          thumbnailPath: cap.thumbnailPath,
          screenshotsJson: JSON.stringify(cap.galleryScreenshots),
          syncSessionNumber: params.sessionNumber,
        });
      }
    } catch (err) {
      results.push({
        studentId: row.studentId,
        folderPath: row.localFolderPath,
        capturedCount: 0,
        thumbnailPath: row.thumbnailPath || DEFAULT_SPCK_THUMBNAIL_PATH,
        galleryScreenshots: [],
        ownerUploadedImages: [],
        ownerRootPhotos: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    classId: normalizedClassId,
    totalProcessed: results.length,
    totalScreenshotsCaptured,
    results,
  };
}
