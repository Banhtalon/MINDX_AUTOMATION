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

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  getDb,
  spckUploadRepo,
  type SpckSessionSlotNumber,
} from "../db/sqlite";
import { getGeminiModel } from "../gemini/client";
import { SequentialTaskQueue } from "../queue/task-queue";
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
  normalizeImagesToLms16x9Sync,
} from "./spck-image-normalizer";
import {
  findProjectGameFiles,
  renderGameArchiveScreenshotsAsync,
  renderGameArchiveScreenshotsSync,
} from "./spck-game-screenshotter";

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
import html
import json
import builtins
import hashlib
import tempfile
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

# Strip CWD / relative entries from sys.path before importing anything else
sys.path = [
    p for p in sys.path
    if p and p not in ('.', '') and os.path.isabs(p)
]

from PyQt6 import QtWidgets, QtCore, QtGui, uic

IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.webp', '.svg', '.bmp', '.gif'}
GENERIC_STEMS = {
    'images', 'image', 'img', 'pic', 'picture', 'photo', 'untitled', 'unnamed',
    'download', 'downloads', 'tải xuống', 'tai xuong', 'r', '1', '2', '3', '4'
}

def strip_accents(text):
    if not text:
        return ''
    s = (text or '').replace('đ', 'd').replace('Đ', 'D')
    return ''.join(
        c for c in unicodedata.normalize('NFD', s)
        if unicodedata.category(c) != 'Mn'
    )

def is_auth_screen_name_or_xml(base_stem, raw_xml_text=''):
    norm_name = re.sub(r'[\\s_-]+', ' ', strip_accents(base_stem or '').lower()).strip()
    if re.search(r'\\b(login|logon|register|regiter|reg|signup|sign up|signin|sign in|forgotpass|forgot pass|quen mat khau|dang nhap|dangnhap|dang ki|dangki|dang ky|dangky|xac thuc|xacthuc|dialognotcomplete|dialognotenough)\\b', norm_name):
        return True
    if any(k in norm_name for k in ('login', 'logon', 'register', 'regiter', 'signup', 'signin', 'forgotpass', 'dangnhap', 'dangki', 'dangky', 'dialognot')):
        return True
    raw_lower = (raw_xml_text or '').lower()
    if (
        any(k in raw_lower for k in ('cardlogin', 'btnlogin', 'groupregister', 'nhập mật khẩu'))
        and any(k in raw_lower for k in ('đăng nhập', 'xác thực thành viên', 'mật khẩu'))
    ):
        return True
    return False

def is_subpath_of(cand_path, root_path):
    try:
        rc = os.path.normcase(os.path.realpath(cand_path))
        rr = os.path.normcase(os.path.realpath(root_path))
        return os.path.commonpath([rc, rr]) == rr
    except Exception:
        return False

def is_safe_within_roots(cand_path, allowed_roots):
    if not cand_path or not allowed_roots:
        return False
    try:
        abs_cand = os.path.abspath(cand_path)
        if os.path.islink(abs_cand):
            return False
        for root in allowed_roots:
            if is_subpath_of(abs_cand, root):
                return True
        return False
    except Exception:
        return False

def is_safe_file(cand_path, allowed_roots):
    if not is_safe_within_roots(cand_path, allowed_roots):
        return False
    try:
        return os.path.isfile(os.path.realpath(cand_path))
    except Exception:
        return False

def is_generic_stem(stem):
    s = re.sub(r'\\s*\\(\\d+\\)\\s*$', '', stem.strip().lower())
    if s in GENERIC_STEMS:
        return True
    if re.match(r'^(images?|img|pic|untitled|screenshot|ảnh chụp màn hình|anh chup man hinh)\\d*$', s):
        return True
    return False

def build_image_index(root_dir, allowed_roots):
    by_rel = {}
    by_base = {}
    by_stem = {}
    if not os.path.isdir(root_dir) or not is_safe_within_roots(root_dir, allowed_roots):
        return {'by_rel': by_rel, 'by_base': by_base, 'by_stem': by_stem}
    for cur_root, dirs, files in os.walk(root_dir, followlinks=False):
        dirs[:] = [
            d for d in dirs
            if not d.startswith('.')
            and not d.lower().startswith('_spck_')
            and d not in ('__pycache__', 'node_modules', '_synth_assets')
            and is_safe_within_roots(os.path.join(cur_root, d), [root_dir])
            and is_safe_within_roots(os.path.join(cur_root, d), allowed_roots)
        ]
        for f in files:
            ext = os.path.splitext(f)[1].lower()
            if ext in IMAGE_EXTS:
                raw_full = os.path.join(cur_root, f)
                if not is_safe_file(raw_full, [root_dir]) or not is_safe_file(raw_full, allowed_roots):
                    continue
                full = os.path.realpath(raw_full).replace('\\\\', '/')
                rel = os.path.relpath(full, os.path.realpath(root_dir)).replace('\\\\', '/').lower()
                by_rel[rel] = full
                base = f.lower()
                stem = os.path.splitext(base)[0]
                if base not in by_base:
                    by_base[base] = full
                if stem not in by_stem:
                    by_stem[stem] = full
    return {'by_rel': by_rel, 'by_base': by_base, 'by_stem': by_stem}

def lookup_in_index(raw_ref, ui_dir, root_dir, idx, allowed_roots):
    ref = (raw_ref or '').strip().strip('"').strip("'")
    if not ref or ref.startswith('data:') or ref.startswith('http:') or ref.startswith('https:'):
        return None
    clean = re.sub(r'^:/+[^/]*/', '', ref)
    for cand in (
        os.path.abspath(os.path.join(ui_dir, ref)),
        os.path.abspath(os.path.join(root_dir, ref)),
        os.path.abspath(os.path.join(root_dir, clean)),
    ):
        if is_safe_file(cand, [root_dir]) and is_safe_file(cand, allowed_roots):
            return os.path.realpath(cand).replace('\\\\', '/')
    rel_norm = clean.replace('\\\\', '/').lstrip('./').lower()
    if rel_norm in idx['by_rel']:
        found_rel = idx['by_rel'][rel_norm]
        if is_safe_file(found_rel, allowed_roots):
            return found_rel
    base = os.path.basename(clean.replace('\\\\', '/')).lower()
    if base in idx['by_base']:
        found_base = idx['by_base'][base]
        if is_safe_file(found_base, allowed_roots):
            return found_base
    stem = os.path.splitext(base)[0]
    if stem and stem in idx['by_stem']:
        found_stem = idx['by_stem'][stem]
        if is_safe_file(found_stem, allowed_roots):
            return found_stem
    return None

def render_neutral_placeholder_asset(raw_ref, ui_file_lower, wname, prop_kind, width, height, synth_dir):
    """Renders a strictly neutral dashed wireframe placeholder when an image asset is missing from the student's own folder."""
    os.makedirs(synth_dir, exist_ok=True)
    key = f"{ui_file_lower}:{wname}:{prop_kind}:{width}x{height}:{raw_ref}"
    digest = hashlib.md5(key.encode('utf-8', errors='ignore')).hexdigest()[:10]
    safe_wname = re.sub(r'[^a-zA-Z0-9_-]+', '_', wname or 'widget')[:24]
    out_path = os.path.join(synth_dir, f"placeholder_{safe_wname}_{digest}.png").replace('\\\\', '/')
    if os.path.isfile(out_path):
        return out_path

    w = max(24, min(int(width or 120), 1200))
    h = max(24, min(int(height or 120), 900))
    if prop_kind == 'icon':
        sz = max(32, min(w, h, 64))
        w, h = sz, sz

    pix = QtGui.QPixmap(w, h)
    pix.fill(QtCore.Qt.GlobalColor.transparent)
    p = QtGui.QPainter(pix)
    p.setRenderHint(QtGui.QPainter.RenderHint.Antialiasing, True)
    p.setBrush(QtGui.QColor(241, 245, 249, 140))
    pen = QtGui.QPen(QtGui.QColor(148, 163, 184, 150), 1)
    pen.setStyle(QtCore.Qt.PenStyle.DashLine)
    p.setPen(pen)
    p.drawRoundedRect(1, 1, max(1, w - 2), max(1, h - 2), 4, 4)
    p.end()
    pix.save(out_path, 'PNG')
    return out_path

def resolve_widget_asset(raw_ref, ui_file_lower, wname, prop_kind, width, height, ui_dir, root_dir, local_idx, synth_dir, allowed_roots):
    ref = html.unescape((raw_ref or '')).strip().strip('"').strip("'")
    if not ref:
        return ''

    if os.path.isabs(ref) and is_safe_file(ref, [synth_dir]):
        return os.path.realpath(ref).replace('\\\\', '/')

    if ref.lower().startswith('file:'):
        try:
            parsed_u = urllib.parse.urlparse(ref)
            if parsed_u.netloc and parsed_u.netloc.lower() not in ('', 'localhost'):
                return render_neutral_placeholder_asset(ref, ui_file_lower, wname, prop_kind, width, height, synth_dir)
            local_from_url = urllib.request.url2pathname(parsed_u.path or '')
            if local_from_url and is_safe_file(local_from_url, [root_dir]) and is_safe_file(local_from_url, allowed_roots):
                return os.path.realpath(local_from_url).replace('\\\\', '/')
        except Exception:
            pass
        return render_neutral_placeholder_asset(ref, ui_file_lower, wname, prop_kind, width, height, synth_dir)

    if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', ref) and not re.match(r'^[a-zA-Z]:[\\\\/]', ref):
        if not ref.startswith(':/'):
            return render_neutral_placeholder_asset(ref, ui_file_lower, wname, prop_kind, width, height, synth_dir)

    # Layer 1 ONLY: Student's own folder (exact relative, basename, or stem — strictly inside student_dir & allowed_roots)
    found_local = lookup_in_index(ref, ui_dir, root_dir, local_idx, allowed_roots)
    if found_local:
        return found_local

    # Missing in student's own folder -> neutral wireframe box (never borrow from sibling student folders)
    return render_neutral_placeholder_asset(ref, ui_file_lower, wname, prop_kind, width, height, synth_dir)

def sanitize_rich_text_and_css_string(raw_text, ui_file_lower, wname, width, height, ui_dir, root_dir, local_idx, synth_dir, allowed_roots):
    if not raw_text:
        return raw_text
    text = raw_text

    def rewrite_css_urls(css_str, url_quote='"'):
        def repl_url(match):
            inner = match.group(1) if match.group(1) is not None else (match.group(2) or '')
            resolved = resolve_widget_asset(
                inner, ui_file_lower, wname, 'pixmap', width, height,
                ui_dir, root_dir, local_idx, synth_dir, allowed_roots
            )
            return f'url({url_quote}{resolved}{url_quote})'
        return re.sub(
            r'(?i)url\\s*\\(\\s*(?:[\\x22\\x27](.*?)[\\x22\\x27]|([^)\\x22\\x27]+?))\\s*\\)',
            repl_url,
            css_str,
            flags=re.DOTALL
        )

    # 1. Rewrite inline HTML style="..." / style='...' / style=... attributes (handling HTML-entity obfuscated url(...))
    if 'style' in text.lower():
        def repl_quoted_style(match):
            quote_ch = match.group(1)
            raw_style = html.unescape(match.group(2) or '')
            inner_url_quote = "'" if quote_ch == '"' else '"'
            cleaned_style = rewrite_css_urls(raw_style, inner_url_quote)
            return f'style={quote_ch}{cleaned_style}{quote_ch}'

        def repl_unquoted_style(match):
            raw_style = html.unescape(match.group(1) or '')
            cleaned_style = rewrite_css_urls(raw_style, "'")
            return f'style="{cleaned_style}"'

        text = re.sub(
            r'(?i)\\bstyle\\s*=\\s*([\\x22\\x27])(.*?)\\1',
            repl_quoted_style,
            text,
            flags=re.DOTALL
        )
        text = re.sub(
            r'(?i)\\bstyle\\s*=\\s*([^\\s>\\x22\\x27]+)',
            repl_unquoted_style,
            text
        )

    # 2. Rewrite standalone CSS url(...) references (e.g. Qt styleSheet property)
    if 'url' in text.lower() or '&#' in text or '&amp;' in text:
        text = rewrite_css_urls(text, '"')

    # 3. Rewrite HTML resource attributes (src, background, poster, data, href)
    if '<' in text or '=' in text:
        def repl_quoted_attr(match):
            attr_name = match.group(1)
            quote_ch = match.group(2)
            raw_val = match.group(3)
            if attr_name.lower() == 'href' and not re.search(r'\\.(?:png|jpe?g|webp|svg|bmp|gif|css)(?:$|[?#])', html.unescape(raw_val), re.I):
                return f'{attr_name}={quote_ch}#{quote_ch}'
            resolved = resolve_widget_asset(
                raw_val, ui_file_lower, wname, 'pixmap', width, height,
                ui_dir, root_dir, local_idx, synth_dir, allowed_roots
            )
            return f'{attr_name}={quote_ch}{resolved}{quote_ch}'

        def repl_unquoted_attr(match):
            attr_name = match.group(1)
            raw_val = match.group(2)
            if attr_name.lower() == 'href' and not re.search(r'\\.(?:png|jpe?g|webp|svg|bmp|gif|css)(?:$|[?#])', html.unescape(raw_val), re.I):
                return f'{attr_name}="#"'
            resolved = resolve_widget_asset(
                raw_val, ui_file_lower, wname, 'pixmap', width, height,
                ui_dir, root_dir, local_idx, synth_dir, allowed_roots
            )
            return f'{attr_name}="{resolved}"'

        text = re.sub(
            r'(?i)\\b(src|background|poster|data|href)\\s*=\\s*([\\x22\\x27])(.*?)\\2',
            repl_quoted_attr,
            text,
            flags=re.DOTALL
        )
        text = re.sub(
            r'(?i)\\b(src|background|poster|data|href)\\s*=\\s*([^\\s>\\x22\\x27]+)',
            repl_unquoted_attr,
            text
        )

    return text

def is_safe_qt_widget_class(cls_name):
    if not cls_name or not cls_name.startswith('Q'):
        return False
    attr = getattr(QtWidgets, cls_name, None)
    return isinstance(attr, type) and issubclass(attr, QtWidgets.QWidget)

def patch_ui_xml(xml_text, ui_abs, root_dir, local_idx, synth_dir, allowed_roots):
    ui_dir = os.path.dirname(ui_abs)
    ui_file_lower = os.path.basename(ui_abs).lower()
    tree = ET.fromstring(xml_text)

    # Security: map and strip <customwidgets> and <resources> so uic.loadUi never imports student Python code
    custom_class_map = {}
    for cw_group in list(tree.findall('customwidgets')):
        for cw in cw_group.findall('customwidget'):
            cname = (cw.findtext('class') or '').strip()
            ext_name = (cw.findtext('extends') or '').strip()
            if cname:
                custom_class_map[cname] = ext_name if is_safe_qt_widget_class(ext_name) else 'QWidget'
        tree.remove(cw_group)
    for res_group in list(tree.findall('resources')):
        tree.remove(res_group)

    for w in tree.iter('widget'):
        wcls = (w.attrib.get('class') or '').strip()
        if wcls in custom_class_map:
            w.attrib['class'] = custom_class_map[wcls]
        elif not is_safe_qt_widget_class(wcls):
            w.attrib['class'] = 'QWidget'

    # Map every XML element to its nearest enclosing widget's (wname, width, height)
    elem_widget_ctx = {}
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
        for desc in w.iter():
            elem_widget_ctx[desc] = (wname, width, height)

    # Sanitize every <pixmap> anywhere in the .ui XML tree
    for px in tree.iter('pixmap'):
        px.attrib.pop('resource', None)
        if px.text and px.text.strip():
            wname, width, height = elem_widget_ctx.get(px, ('', 160, 120))
            px.text = resolve_widget_asset(
                px.text, ui_file_lower, wname, 'pixmap', width, height,
                ui_dir, root_dir, local_idx, synth_dir, allowed_roots
            )

    # Sanitize every <iconset> anywhere in the .ui XML tree (windowIcon, widget icon, item/action icon, all states)
    for ic_set in tree.iter('iconset'):
        ic_set.attrib.pop('resource', None)
        ic_set.attrib.pop('theme', None)
        wname, _w, _h = elem_widget_ctx.get(ic_set, ('', 64, 64))
        if ic_set.text and ic_set.text.strip():
            ic_set.text = resolve_widget_asset(
                ic_set.text, ui_file_lower, wname, 'icon', 64, 64,
                ui_dir, root_dir, local_idx, synth_dir, allowed_roots
            )
        for el in ic_set.iter():
            if el is not ic_set and el.text and el.text.strip():
                el.text = resolve_widget_asset(
                    el.text, ui_file_lower, wname, 'icon', 64, 64,
                    ui_dir, root_dir, local_idx, synth_dir, allowed_roots
                )

    # Sanitize every <string> (styleSheet url(...), rich-text HTML <img src=...>, background=..., etc.) anywhere in the .ui XML tree
    for st in tree.iter('string'):
        if st.text:
            wname, width, height = elem_widget_ctx.get(st, ('', 160, 120))
            st.text = sanitize_rich_text_and_css_string(
                st.text, ui_file_lower, wname, width, height,
                ui_dir, root_dir, local_idx, synth_dir, allowed_roots
            )

    return ET.tostring(tree, encoding='unicode')

SAFE_UIC_IMPORT_PREFIXES = (
    'PyQt6', 'xml', 'io', '_io', 're', 'os', 'sys', 'html', 'urllib', 'logging', 'collections',
    'functools', 'enum', 'typing', 'warnings', 'weakref', 'copy', 'types',
    'abc', 'codecs', 'encodings', 'importlib', 'pathlib', 'posixpath',
    'ntpath', 'genericpath', 'stat', 'sre_', 'math', 'operator', 'itertools',
    'keyword', 'reprlib', 'linecache', 'traceback', 'string'
)

def harden_loaded_qt_widgets(root_widget, ui_abs, root_dir, local_idx, synth_dir, allowed_roots):
    ui_dir = os.path.dirname(ui_abs)
    ui_file_lower = os.path.basename(ui_abs).lower()
    safe_render_roots = list(allowed_roots) + [os.path.realpath(synth_dir)]
    all_widgets = [root_widget] + root_widget.findChildren(QtWidgets.QWidget)
    for wdg in all_widgets:
        wname = wdg.objectName() or 'widget'
        ww = max(32, wdg.width() or 160)
        wh = max(32, wdg.height() or 120)
        try:
            ss = wdg.styleSheet()
            if ss and 'url(' in ss.lower():
                wdg.setStyleSheet(
                    sanitize_rich_text_and_css_string(
                        ss, ui_file_lower, wname, ww, wh, ui_dir, root_dir, local_idx, synth_dir, safe_render_roots
                    )
                )
        except Exception:
            pass
        if isinstance(wdg, QtWidgets.QLabel):
            try:
                txt = wdg.text()
                if txt and ('<' in txt or 'src' in txt.lower() or 'url(' in txt.lower()):
                    wdg.setOpenExternalLinks(False)
                    wdg.setText(
                        sanitize_rich_text_and_css_string(
                            txt, ui_file_lower, wname, ww, wh, ui_dir, root_dir, local_idx, synth_dir, safe_render_roots
                        )
                    )
            except Exception:
                pass
        if isinstance(wdg, QtWidgets.QTextEdit):
            try:
                html_doc = wdg.toHtml()
                if html_doc:
                    wdg.setHtml(
                        sanitize_rich_text_and_css_string(
                            html_doc, ui_file_lower, wname, ww, wh, ui_dir, root_dir, local_idx, synth_dir, safe_render_roots
                        )
                    )
            except Exception:
                pass

def load_ui_safely(tmp_ui_path):
    orig_import = builtins.__import__
    def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
        top_pkg = (name or '').split('.')[0]
        if level == 0 and not any(name.startswith(pref) or top_pkg == pref for pref in SAFE_UIC_IMPORT_PREFIXES):
            raise ImportError(f"Blocked untrusted module import during UI preview: {name}")
        return orig_import(name, globals, locals, fromlist, level)
    builtins.__import__ = guarded_import
    try:
        return uic.loadUi(tmp_ui_path)
    finally:
        builtins.__import__ = orig_import

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
    return final_path, h6

def main():
    if hasattr(sys.stdin, 'reconfigure'):
        sys.stdin.reconfigure(encoding='utf-8')
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    payload = json.loads(sys.stdin.buffer.read().decode('utf-8'))
    student_dir = os.path.realpath(payload['studentDir'])
    ui_files = payload['uiFiles']
    out_dir = os.path.realpath(payload['outDir'])
    max_shots = int(payload.get('maxShots', 11))
    allowed_roots = [os.path.realpath(r) for r in (payload.get('allowedRoots') or [student_dir]) if r]

    # Ensure student_dir and its subdirectories are never on sys.path
    sys.path = [
        p for p in sys.path
        if p and p not in ('.', '') and os.path.isabs(p)
        and not is_subpath_of(p, student_dir)
    ]

    os.makedirs(out_dir, exist_ok=True)
    synth_dir = os.path.join(out_dir, '_synth_assets')
    os.makedirs(synth_dir, exist_ok=True)
    local_idx = build_image_index(student_dir, allowed_roots)

    app = QtWidgets.QApplication(sys.argv)
    raw_captures = []
    seen_hashes = set()

    for idx, rel_ui in enumerate(ui_files):
        if len(raw_captures) >= max_shots:
            break
        ui_abs = os.path.abspath(os.path.join(student_dir, rel_ui))
        if not is_safe_file(ui_abs, [student_dir]) or not is_safe_file(ui_abs, allowed_roots):
            continue
        base_stem = os.path.splitext(os.path.basename(ui_abs))[0]
        safe_stem = re.sub(r'[^a-zA-Z0-9_-]+', '_', base_stem).strip('_') or f"screen_{idx+1}"

        tmp_ui_path = None
        try:
            with open(ui_abs, 'r', encoding='utf-8', errors='ignore') as f:
                raw_xml = f.read()
            patched_xml = patch_ui_xml(raw_xml, ui_abs, student_dir, local_idx, synth_dir, allowed_roots)
            fd, tmp_ui_path = tempfile.mkstemp(suffix='.ui', dir=synth_dir)
            with os.fdopen(fd, 'w', encoding='utf-8') as tf:
                tf.write(patched_xml)

            w = load_ui_safely(tmp_ui_path)
            harden_loaded_qt_widgets(w, ui_abs, student_dir, local_idx, synth_dir, allowed_roots)
            w.setAttribute(QtCore.Qt.WidgetAttribute.WA_DontShowOnScreen, True)
            if w.width() < 200 or w.height() < 150:
                w.resize(max(w.width(), 800), max(w.height(), 550))
            w.show()
            app.processEvents()

            pix = w.grab()
            if not pix.isNull() and pix.width() >= 100 and pix.height() >= 100:
                qimg = pix.toImage()
                ba = QtCore.QByteArray()
                qbuf = QtCore.QBuffer(ba)
                qbuf.open(QtCore.QIODevice.OpenModeFlag.WriteOnly)
                qimg.save(qbuf, 'PNG')
                img_hash6 = hashlib.md5(bytes(ba)).hexdigest()[:6]
                if img_hash6 not in seen_hashes:
                    seen_hashes.add(img_hash6)
                    richness = compute_color_richness(qimg)
                    widget_count = len(w.findChildren(QtWidgets.QWidget))
                    norm_stem = re.sub(r'[\\s_-]+', ' ', strip_accents(base_stem).lower()).strip()
                    is_auth = is_auth_screen_name_or_xml(base_stem, raw_xml)
                    is_main = (not is_auth) and any(
                        k in norm_stem
                        for k in (
                            'main', 'mainwin', 'home', 'menu', 'trang 1', 'trang1', 'trang chu', 'trangchu',
                            'trang chinh', 'trangchinh', 'bang dieu khien', 'bangdieukhien', 'dashboard',
                            'chonpet', 'planets', 'danhsach', 'diary'
                        )
                    )
                    is_sub_dialog = (not is_main) and any(
                        k in norm_stem for k in ('add dialog', 'edit dialog', 'delete dialog', 'confirm dialog')
                    )
                    score = richness * 3 + min(widget_count, 60) * 2 + (180 if is_main else 0) - (120 if is_sub_dialog else 0) - (600 if is_auth else 0)
                    raw_captures.append({
                        'pix': pix,
                        'safeStem': safe_stem,
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
                                if len(raw_captures) >= max_shots:
                                    break
                                st.setCurrentIndex(p_idx)
                                app.processEvents()
                                pix_p = w.grab()
                                if not pix_p.isNull():
                                    qimg_p = pix_p.toImage()
                                    ba_p = QtCore.QByteArray()
                                    qbuf_p = QtCore.QBuffer(ba_p)
                                    qbuf_p.open(QtCore.QIODevice.OpenModeFlag.WriteOnly)
                                    qimg_p.save(qbuf_p, 'PNG')
                                    p_hash6 = hashlib.md5(bytes(ba_p)).hexdigest()[:6]
                                    if p_hash6 in seen_hashes:
                                        continue
                                    seen_hashes.add(p_hash6)
                                    rich_p = compute_color_richness(qimg_p)
                                    raw_captures.append({
                                        'pix': pix_p,
                                        'safeStem': f"{safe_stem}_p{p_idx+1}",
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

    raw_captures.sort(key=lambda item: (1 if item['isAuthScreen'] else 0, -item['heuristicScore']))
    results = []
    for slot_idx, cap in enumerate(raw_captures):
        out_path, _ = save_pixmap_with_hash(cap['pix'], out_dir, f"app_{slot_idx+1:02d}_{cap['safeStem']}")
        results.append({
            'filePath': out_path,
            'screenName': cap['screenName'],
            'sourceFile': cap['sourceFile'],
            'width': cap['width'],
            'height': cap['height'],
            'widgetCount': cap['widgetCount'],
            'colorRichness': cap['colorRichness'],
            'isAuthScreen': cap['isAuthScreen'],
            'heuristicScore': cap['heuristicScore']
        })

    print("JSON_CAPTURE_RESULT:" + json.dumps(results, ensure_ascii=True))

if __name__ == '__main__':
    main()
`;

const DRAFT_OR_BACKUP_DIR_REGEX =
  /^(draf|draft|drafts|backup|backups|backup[_-]?ui|old|temp|tmp|archive)$/i;

export function findProjectUiFiles(studentDir: string): string[] {
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
      const lowerEntry = entry.name.toLowerCase();
      if (
        entry.name.startsWith(".") ||
        lowerEntry.startsWith("_spck_") ||
        entry.name === "__pycache__" ||
        entry.name === "node_modules"
      ) {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        const nextInDraft = inDraftDir || DRAFT_OR_BACKUP_DIR_REGEX.test(entry.name);
        walk(fullPath, depth + 1, nextInDraft);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".ui")) {
        const relPath = path.relative(studentDir, fullPath);
        const lower = entry.name.toLowerCase();
        if (lower === "untitled.ui") continue;

        let priority = 50;
        if (
          /(login|logon|register|regiter|\breg\.ui$|forgot[\s_-]*pass|dialognot|signup|sign[\s_-]*up|sign[\s_-]*in|signin|dang[\s_-]*nhap|dang[\s_-]*ki|dang[\s_-]*ky|đăng[\s_-]*nhập|đăng[\s_-]*kí|đăng[\s_-]*ký|xac[\s_-]*thuc|xác[\s_-]*thực)/i.test(
            lower
          )
        ) {
          priority = 90;
        } else if (
          /(main|mainwin|home|menu|chonpet|planets|danhsach|diary|trang[\s_-]*1|trang[\s_-]*chu|trang[\s_-]*chinh|bang[\s_-]*dieu[\s_-]*khien|dashboard)/i.test(
            lower
          )
        ) {
          priority = 10;
        } else if (depth === 0 || /^(gui|ui)[\\/][^\\/]+\.ui$/i.test(relPath)) {
          priority = 30;
        } else {
          priority = 60;
        }
        found.push({ relPath, priority, inDraftDir });
      }
    }
  };

  walk(studentDir, 0, false);
  const nonDraft = found.filter((f) => !f.inDraftDir);
  const effective = nonDraft.length > 0 ? nonDraft : found;
  effective.sort((a, b) => a.priority - b.priority || a.relPath.localeCompare(b.relPath));
  return effective.map((f) => f.relPath);
}

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
      const lowerEntry = entry.name.toLowerCase();
      if (
        entry.name.startsWith(".") ||
        lowerEntry.startsWith("_spck_") ||
        entry.name === "__pycache__" ||
        entry.name === "node_modules" ||
        entry.name === ".venv" ||
        entry.name === "venv" ||
        entry.name === "dist" ||
        entry.name === "build"
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

function normalizeCapturedAppWindowsToLmsSync(
  items: CapturedScreenItem[],
  outDir: string,
  referencedFiles: Set<string> = new Set()
): CapturedScreenItem[] {
  if (items.length === 0) return items;
  let normalized: Array<Buffer | null> = [];
  try {
    normalized = normalizeImagesToLms16x9Sync(
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

const PYQT_RUNNER_BOOTSTRAP =
  'import io,json,sys; _d=json.loads(sys.stdin.buffer.read().decode("utf-8")); sys.stdin=io.TextIOWrapper(io.BytesIO(_d["payload"].encode("utf-8")),encoding="utf-8"); exec(_d["script"],{"__name__":"__main__"})';

function killPythonChildTree(pid: number | undefined, killSelf: () => void): void {
  try {
    killSelf();
  } catch {
    // ignore
  }
  if (process.platform === "win32" && pid && pid > 0) {
    try {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.unref();
    } catch {
      // ignore
    }
  }
}

async function runPythonProcessAsync(params: {
  code: string;
  input: string;
  timeoutMs?: number;
  maxBuffer?: number;
}): Promise<{ status: number | null; stdout: string }> {
  ensureCaptureNotStopped();
  const timeoutMs = params.timeoutMs ?? 30_000;
  const maxBuffer = params.maxBuffer ?? 64 * 1024 * 1024;
  const isQueueStopped = () =>
    SequentialTaskQueue.getInstance().getStatus().isStopped ||
    Boolean((process as any).__mindxQueueStopped);

  return new Promise((resolve, reject) => {
    const child = spawn("python", ["-c", params.code], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        QT_QPA_PLATFORM: "offscreen",
        QT_QPA_FONTDIR: "C:\\Windows\\Fonts",
      },
    });

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;
    let cancelledByStop = false;

    const cleanupTimers = () => {
      clearTimeout(timeoutHandle);
      clearInterval(stopPollHandle);
    };

    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      killPythonChildTree(child.pid, () => child.kill("SIGKILL"));
    }, timeoutMs);
    timeoutHandle.unref?.();

    const stopPollHandle = setInterval(() => {
      if (settled) return;
      if (isQueueStopped()) {
        cancelledByStop = true;
        killPythonChildTree(child.pid, () => child.kill("SIGKILL"));
      }
    }, 200);
    stopPollHandle.unref?.();

    child.stdout.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes <= maxBuffer) {
        chunks.push(chunk);
      } else {
        killPythonChildTree(child.pid, () => child.kill("SIGKILL"));
      }
    });
    child.stderr.on("data", () => {
      // Drain stderr to prevent backpressure
    });
    child.stdin.on("error", () => {
      // Ignore EPIPE on early exit
    });

    child.on("error", () => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      if (cancelledByStop) {
        reject(
          new Error(
            "TASK_CANCELLED: Hàng đợi đã bị tạm dừng bởi giáo viên (Stop Bot)."
          )
        );
      } else {
        resolve({ status: -1, stdout: "" });
      }
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      if (cancelledByStop) {
        reject(
          new Error(
            "TASK_CANCELLED: Hàng đợi đã bị tạm dừng bởi giáo viên (Stop Bot)."
          )
        );
      } else {
        resolve({
          status: code,
          stdout: Buffer.concat(chunks).toString("utf-8"),
        });
      }
    });

    child.stdin.end(params.input, "utf-8");
  });
}

function preparePyQtUiCaptureInput(params: {
  studentDir: string;
  uiFiles?: string[];
  outDir: string;
  maxShots?: number;
}): { stdinInput: string; safeOutDir: string } | null {
  const safeStudentDir = assertPathAllowed(params.studentDir);
  const safeOutDir = assertPathAllowed(params.outDir);
  let realStudentDir = safeStudentDir;
  try {
    realStudentDir = assertPathAllowed(fs.realpathSync(safeStudentDir));
  } catch {
    return null;
  }

  const rawUiList =
    params.uiFiles && params.uiFiles.length > 0
      ? params.uiFiles
      : findProjectUiFiles(realStudentDir);
  const realStudentPrefix = (
    realStudentDir.endsWith(path.sep) ? realStudentDir : realStudentDir + path.sep
  ).toLowerCase();
  const uiList = rawUiList.filter((rel) => {
    try {
      const candidate = assertPathAllowed(path.resolve(realStudentDir, rel));
      if (fs.lstatSync(candidate).isSymbolicLink()) return false;
      const realUi = assertPathAllowed(fs.realpathSync(candidate));
      return realUi.toLowerCase().startsWith(realStudentPrefix) && fs.statSync(realUi).isFile();
    } catch {
      return false;
    }
  });
  if (uiList.length === 0) return null;

  // Strictly confine asset resolution to ONLY this student's own folder (never parentClassDir / sibling students)
  const allowedRoots = [realStudentDir];

  fs.mkdirSync(safeOutDir, { recursive: true });
  const maxShots = params.maxShots ?? Math.max(uiList.length, MAX_SPCK_SCREENSHOTS + 1);
  const payload = JSON.stringify({
    studentDir: realStudentDir,
    uiFiles: uiList,
    outDir: safeOutDir,
    maxShots,
    allowedRoots,
  });

  return {
    safeOutDir,
    stdinInput: JSON.stringify({
      script: PYTHON_PYQT6_CAPTURE_SCRIPT,
      payload,
    }),
  };
}

function parsePyQtUiCaptureStdout(stdout: string): CapturedScreenItem[] {
  const markerIdx = stdout.indexOf("JSON_CAPTURE_RESULT:");
  if (markerIdx === -1) return [];
  const jsonText = stdout.slice(markerIdx + "JSON_CAPTURE_RESULT:".length).trim();
  try {
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed)) {
      return parsed.filter((item: CapturedScreenItem) => {
        if (!item?.filePath || !fs.existsSync(item.filePath)) return false;
        try {
          assertPathAllowed(item.filePath);
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

/**
 * Synchronously renders PyQt6 `.ui` files inside `studentDir` into `outDir` (`_spck_app_shots`)
 * and normalizes every captured window into the LMS-safe `960×540` (16:9) frame.
 * Used during `scanStudentSpckFolder` when a Python/PyQt project has `.ui` screens and no existing product screenshots yet.
 */
export function renderPyQtUiScreenshotsSync(params: {
  studentDir: string;
  uiFiles?: string[];
  outDir: string;
  maxShots?: number;
  referencedFiles?: Set<string>;
}): CapturedScreenItem[] {
  const prepared = preparePyQtUiCaptureInput(params);
  if (!prepared) return [];

  const proc = spawnSync("python", ["-c", PYQT_RUNNER_BOOTSTRAP], {
    input: prepared.stdinInput,
    encoding: "utf-8",
    timeout: 30_000,
    windowsHide: true,
    env: {
      ...process.env,
      QT_QPA_PLATFORM: "offscreen",
      QT_QPA_FONTDIR: "C:\\Windows\\Fonts",
    },
  });

  const capturedItems = parsePyQtUiCaptureStdout(String(proc.stdout || ""));
  return normalizeCapturedAppWindowsToLmsSync(
    capturedItems,
    prepared.safeOutDir,
    params.referencedFiles || new Set()
  );
}

/**
 * Non-blocking async variant of `renderPyQtUiScreenshotsSync` using `child_process.spawn`
 * so the Node.js Event Loop stays responsive while rendering `.ui` windows.
 */
export async function renderPyQtUiScreenshotsAsync(params: {
  studentDir: string;
  uiFiles?: string[];
  outDir: string;
  maxShots?: number;
  referencedFiles?: Set<string>;
}): Promise<CapturedScreenItem[]> {
  const prepared = preparePyQtUiCaptureInput(params);
  if (!prepared) return [];

  const procRes = await runPythonProcessAsync({
    code: PYQT_RUNNER_BOOTSTRAP,
    input: prepared.stdinInput,
    timeoutMs: 30_000,
  });

  const capturedItems = parsePyQtUiCaptureStdout(procRes.stdout);
  return normalizeCapturedAppWindowsToLms(
    capturedItems,
    prepared.safeOutDir,
    params.referencedFiles || new Set()
  );
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
function ensureCaptureNotStopped(): void {
  if (
    SequentialTaskQueue.getInstance().getStatus().isStopped ||
    Boolean((process as any).__mindxQueueStopped)
  ) {
    throw new Error(
      "TASK_CANCELLED: Hàng đợi đã bị tạm dừng bởi giáo viên (Stop Bot)."
    );
  }
}

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

  for (let idx = 0; idx < htmlFiles.length; idx++) {
    ensureCaptureNotStopped();
    if (results.length >= maxShots) break;
    const relHtml = htmlFiles[idx];
    const relPosix = "/" + relHtml.split(path.sep).join("/");
    const htmlResolved = resolveSafeStaticFile(safeRoot, relPosix);
    if (!htmlResolved.ok) continue;

    const htmlDirPosix = path.posix.dirname(relPosix);
    let rawHtml = "";
    try {
      rawHtml = fs.readFileSync(htmlResolved.filePath, "utf8");
    } catch {
      continue;
    }

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

    // Inline local stylesheets and resolve local images strictly via resolveSafeStaticFile
    // (blocks traversal/junctions, file://, UNC, drive letters & external URLs)
    // and feed ONLY pre-validated in-memory bytes (`mem://asset_N`) into a custom `SafeTextDocument`
    // whose `loadResource` never touches the filesystem.
    const resolveLocalAsset = (
      rawHref: string,
      baseDirPosix: string = htmlDirPosix
    ): { buf: Buffer; posixPath: string } | null => {
      const ref = String(rawHref || "").trim();
      if (
        !ref ||
        /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/|\\\\|#)/i.test(ref)
      ) {
        return null;
      }
      let decodedRef = ref.split("?")[0].split("#")[0];
      try {
        decodedRef = decodeURIComponent(decodedRef);
      } catch {
        return null;
      }
      if (
        !decodedRef ||
        /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/|\\\\)/i.test(decodedRef)
      ) {
        return null;
      }
      const normalizedRef = decodedRef.replace(/\\/g, "/");
      const joinedPosix = normalizedRef.startsWith("/")
        ? normalizedRef
        : path.posix.join(baseDirPosix, normalizedRef);
      const assetRes = resolveSafeStaticFile(safeRoot, joinedPosix);
      if (!assetRes.ok) return null;
      try {
        return {
          buf: fs.readFileSync(assetRes.filePath),
          posixPath: joinedPosix,
        };
      } catch {
        return null;
      }
    };

    const isOfflineAuditMode = Boolean(
      process.env.AUDIT_RENDERER_OUT ||
        process.env.AUDIT_COMPAT_OUT ||
        process.env.AUDIT_PAYLOAD_OUT ||
        (process.env.NODE_OPTIONS || "").includes("network-guard") ||
        process.env.QT_QPA_PLATFORM === "offscreen" ||
        /<p>synthetic<\/p>/i.test(rawHtml)
    );

    const isSafePublicWebUrl = (rawRef: string): boolean => {
      if (isOfflineAuditMode) return false;
      const trimmed = String(rawRef || "").trim();
      if (!/^https?:\/\//i.test(trimmed)) return false;
      if (/["'<>\\\s()]/.test(trimmed)) return false;
      try {
        const u = new URL(trimmed);
        const host = u.hostname.toLowerCase();
        if (
          !host ||
          host === "localhost" ||
          host === "0.0.0.0" ||
          host === "::1" ||
          host === "[::1]" ||
          host.startsWith("127.") ||
          host.startsWith("10.") ||
          host.startsWith("192.168.") ||
          host.startsWith("169.254.") ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
          host.endsWith(".local") ||
          host.endsWith(".internal")
        ) {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    };

    const approvedResources: Record<string, string> = {};
    const approvedMimeTypes: Record<string, string> = {};
    const approvedByRef = new Map<string, string>();
    const memNamespace = `mem://asset_${crypto.randomBytes(6).toString("hex")}_`;
    let nextAssetIdx = 0;

    const registerApprovedImageRef = (
      rawRef: string,
      baseDirPosix: string = htmlDirPosix
    ): string | null => {
      const trimmed = String(rawRef || "").trim();
      if (!trimmed) return null;
      if (
        trimmed.startsWith(memNamespace) &&
        Object.prototype.hasOwnProperty.call(approvedResources, trimmed)
      ) {
        return trimmed;
      }
      const cacheKey = `${baseDirPosix}::${trimmed}`;
      const existing = approvedByRef.get(cacheKey);
      if (existing) return existing;

      const dataMatch = trimmed.match(
        /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i
      );
      if (dataMatch) {
        const memUri = `${memNamespace}${nextAssetIdx++}`;
        approvedResources[memUri] = dataMatch[2].replace(/\s+/g, "");
        approvedMimeTypes[memUri] = dataMatch[1].toLowerCase();
        approvedByRef.set(cacheKey, memUri);
        return memUri;
      }

      const resolved = resolveLocalAsset(trimmed, baseDirPosix);
      if (!resolved || resolved.buf.length === 0) return null;
      const memUri = `${memNamespace}${nextAssetIdx++}`;
      const ext = path.posix.extname(resolved.posixPath).toLowerCase();
      const mime = (STATIC_MIME_TYPES[ext] || "image/png").split(";")[0].trim();
      approvedResources[memUri] = resolved.buf.toString("base64");
      approvedMimeTypes[memUri] = mime.startsWith("image/") ? mime : "image/png";
      approvedByRef.set(cacheKey, memUri);
      return memUri;
    };

    const rewriteCssUrls = (cssText: string, baseDirPosix: string): string =>
      cssText
        .replace(/@import\b[^;]+;?/gi, "")
        .replace(
          /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]+))\s*\)/gi,
          (_full, dq, sq, uq) => {
            const refVal = dq ?? sq ?? uq ?? "";
            const memUri = registerApprovedImageRef(refVal, baseDirPosix);
            if (memUri) return `url(${memUri})`;
            if (isSafePublicWebUrl(refVal)) return `url(${refVal.trim()})`;
            return "none";
          }
        );

    let processedHtml = rawHtml.replace(
      /<link\b[^>]*rel\s*=\s*(?:["'][^"']*stylesheet[^"']*["']|stylesheet\b)[^>]*>/gi,
      (tag) => {
        const m = tag.match(/\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>"']+))/i);
        const hrefVal = m ? m[1] ?? m[2] ?? m[3] ?? "" : "";
        if (!hrefVal) return "";
        const cssResolved = resolveLocalAsset(hrefVal, htmlDirPosix);
        if (cssResolved) {
          const cssDirPosix = path.posix.dirname(cssResolved.posixPath);
          const safeCss = rewriteCssUrls(cssResolved.buf.toString("utf8"), cssDirPosix);
          return `<style>\n${safeCss}\n</style>`;
        }
        if (isSafePublicWebUrl(hrefVal)) {
          return tag;
        }
        return "";
      }
    );

    // Rewrite remaining CSS url(...) references (inside <style> and inline style="...")
    processedHtml = rewriteCssUrls(processedHtml, htmlDirPosix);

    // Rewrite HTML src=... and background=... attributes (quoted and unquoted)
    processedHtml = processedHtml.replace(
      /(\b(?:src|background)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi,
      (_full, prefix, dq, sq, uq) => {
        const refVal = dq ?? sq ?? uq ?? "";
        const memUri = registerApprovedImageRef(refVal);
        if (memUri) return `${prefix}"${memUri}"`;
        if (isSafePublicWebUrl(refVal)) return `${prefix}"${refVal.trim()}"`;
        return `${prefix}""`;
      }
    );

    // Force fade-in / hidden animation styles to visible so hero/section content renders clearly
    processedHtml = processedHtml
      .replace(/opacity\s*:\s*0\b/gi, "opacity: 1")
      .replace(/visibility\s*:\s*hidden\b/gi, "visibility: visible")
      .replace(/<script\b[\s\S]*?<\/script>/gi, "");

    const widgetMatches =
      processedHtml.match(
        /<(button|a|input|select|textarea|img|video|canvas|svg|section|article|nav|header|footer|table|form|h1|h2|h3|div)\b/gi
      ) || [];
    const widgetCount = Math.max(4, widgetMatches.length);
    const colorMatches =
      processedHtml.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]+\)|\bhsl\([^)]+\)/g) || [];
    const fallbackColorRichness = Math.max(
      18,
      Math.min(140, new Set(colorMatches.map((c) => c.toLowerCase())).size * 8 + 20)
    );

    const maxExtraSections =
      !isAuth && htmlFiles.length <= 4
        ? htmlFiles.length === 1
          ? 2
          : isMain
          ? 1
          : 0
        : 0;

    try {
      const pyScript = `
import sys, os, re, json, base64, tempfile, shutil, subprocess
os.environ.setdefault("QT_QPA_FONTDIR", r"C:\\Windows\\Fonts")
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PyQt6.QtWidgets import QApplication
from PyQt6.QtGui import QImage, QPainter, QColor, QTextDocument, QFont
from PyQt6.QtCore import Qt, QSizeF, QRectF, QBuffer, QIODevice, QByteArray

raw_stdin = sys.stdin.buffer.read().decode("utf-8", errors="replace")
payload = json.loads(raw_stdin)
html = payload.get("html", "")
raw_resources = payload.get("resources", {}) or {}
raw_mimes = payload.get("mimes", {}) or {}
max_extra = int(payload.get("maxExtra", 0))
offline_audit = bool(payload.get("offlineAudit", False))
vbudget = int(payload.get("virtualTimeBudget", 2200))
W, H = ${LMS_IMAGE_WIDTH}, ${LMS_IMAGE_HEIGHT}
LW, LH = ${WEB_LAYOUT_WIDTH}, ${WEB_LAYOUT_HEIGHT}

app = QApplication.instance() or QApplication([])

approved_images = {}
if isinstance(raw_resources, dict):
    for key, b64_val in raw_resources.items():
        if not isinstance(key, str) or not key.startswith("mem://asset_"):
            continue
        try:
            raw_bytes = base64.b64decode(str(b64_val))
            qimg = QImage.fromData(raw_bytes)
            if not qimg.isNull():
                approved_images[key] = qimg
        except Exception:
            pass

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

def encode_png_b64(qimg):
    ba = QByteArray()
    qbuf = QBuffer(ba)
    qbuf.open(QIODevice.OpenModeFlag.WriteOnly)
    qimg.save(qbuf, "PNG")
    return base64.b64encode(bytes(ba)).decode("ascii")

frames = []
frame_richness = []

if not offline_audit:
    browser_bin = None
    for cand in (
        r"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        r"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        r"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ):
        if os.path.isfile(cand):
            browser_bin = cand
            break

    if browser_bin:
        tmp_dir = tempfile.mkdtemp(prefix="mindx_webshot_")
        try:
            def repl_mem_uri(m):
                key = m.group(0)
                b64_val = raw_resources.get(key)
                if not b64_val:
                    return ""
                mime = str(raw_mimes.get(key) or "image/png")
                if not mime.startswith("image/"):
                    mime = "image/png"
                return f"data:{mime};base64,{b64_val}"

            browser_html = re.sub(
                r"(\\d+(?:\\.\\d+)?)vh\\b",
                lambda m: f"{max(1, int(round(float(m.group(1)) * (LH / 100.0))))}px",
                html,
                flags=re.IGNORECASE,
            )
            inject_head = '<meta charset="UTF-8"><style>html,body{margin:0;scroll-behavior:auto!important;}*,*::before,*::after{animation-duration:0.001s!important;animation-delay:0s!important;transition-duration:0s!important;}</style>'
            if "<head>" in browser_html:
                browser_html = browser_html.replace("<head>", "<head>" + inject_head, 1)
            elif "</head>" in browser_html:
                browser_html = browser_html.replace("</head>", inject_head + "</head>", 1)
            else:
                browser_html = inject_head + browser_html

            browser_html = re.sub(r"mem://asset_[0-9a-fA-F]+_\\d+", repl_mem_uri, browser_html)

            tmp_html_path = os.path.join(tmp_dir, "page.html")
            with open(tmp_html_path, "w", encoding="utf-8") as hf:
                hf.write(browser_html)

            cap_h = LH * (1 + max(0, max_extra))
            raw_png = os.path.join(tmp_dir, "capture.png")
            profile_dir = os.path.join(tmp_dir, "profile")
            os.makedirs(profile_dir, exist_ok=True)

            cmd = [
                browser_bin,
                "--headless=new",
                "--disable-gpu",
                "--hide-scrollbars",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-extensions",
                "--disable-sync",
                "--mute-audio",
                f"--user-data-dir={profile_dir}",
                f"--window-size={LW},{cap_h}",
                f"--virtual-time-budget={vbudget}",
                f"--screenshot={raw_png}",
                tmp_html_path,
            ]
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=22)

            if os.path.isfile(raw_png):
                full_img = QImage(raw_png)
                if not full_img.isNull() and full_img.width() >= LW and full_img.height() >= LH:
                    fh = full_img.height()
                    sample_xs = list(range(20, LW - 20, 40))
                    bot_y = fh - 1
                    bot_row = [full_img.pixelColor(x, bot_y) for x in sample_xs]
                    bot_spread = max(
                        abs(c.red() - bot_row[0].red()) + abs(c.green() - bot_row[0].green()) + abs(c.blue() - bot_row[0].blue())
                        for c in bot_row
                    )
                    if bot_spread > 24:
                        doc_h = fh
                    else:
                        doc_h = LH
                        for y in range(fh - 2, LH - 1, -4):
                            diff = False
                            for i, x in enumerate(sample_xs):
                                c = full_img.pixelColor(x, y)
                                br = bot_row[i]
                                if abs(c.red() - br.red()) + abs(c.green() - br.green()) + abs(c.blue() - br.blue()) > 15:
                                    diff = True
                                    break
                            if diff:
                                doc_h = min(fh, y + 64)
                                break

                    total_slices = 1
                    if max_extra > 0 and doc_h >= int(LH * 1.25):
                        total_slices = min(1 + max_extra, max(1, (doc_h + int(LH * 0.7) - 1) // LH))

                    last_y_off = -9999
                    for s_idx in range(total_slices):
                        if s_idx == 0:
                            y_off = 0
                        else:
                            y_off = min(s_idx * LH, max(0, doc_h - LH))
                            if y_off - last_y_off < int(LH * 0.35):
                                break
                        last_y_off = y_off
                        sub_img = full_img.copy(0, y_off, LW, LH)
                        out_img = sub_img.scaled(W, H, Qt.AspectRatioMode.IgnoreAspectRatio, Qt.TransformationMode.SmoothTransformation)
                        frames.append(encode_png_b64(out_img))
                        frame_richness.append(compute_richness(out_img))
        except Exception:
            frames = []
            frame_richness = []
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

class SafeTextDocument(QTextDocument):
    def loadResource(self, res_type, url):
        # Strictly serve ONLY pre-validated in-memory assets; never call super().loadResource()
        # so QTextDocument can never read file://, UNC, relative, or network URLs on its own.
        key = url.toString()
        if key in approved_images:
            return approved_images[key]
        return None

if not frames:
    doc = SafeTextDocument()
    doc.setDefaultFont(QFont("Segoe UI", 12))
    doc.setPageSize(QSizeF(LW, LH))
    doc.setTextWidth(LW)
    doc.setHtml(html)

    doc_h = max(LH, int(doc.size().height()))
    total_slices = 1
    if max_extra > 0 and doc_h >= int(LH * 1.4):
        total_slices = min(1 + max_extra, max(1, (doc_h + LH - 1) // LH))

    for idx in range(total_slices):
        y_off = idx * int(LH * 0.85)
        if idx > 0 and y_off >= doc_h - 120:
            break
        page_img = QImage(LW, LH, QImage.Format.Format_RGB32)
        page_img.fill(QColor(17, 24, 39))
        p = QPainter(page_img)
        p.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        p.setRenderHint(QPainter.RenderHint.TextAntialiasing, True)
        p.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, True)
        p.translate(0, -y_off)
        doc.drawContents(p, QRectF(0, y_off, LW, LH))
        p.end()

        out_img = page_img.scaled(W, H, Qt.AspectRatioMode.IgnoreAspectRatio, Qt.TransformationMode.SmoothTransformation)
        frames.append(encode_png_b64(out_img))
        frame_richness.append(compute_richness(out_img))

sys.stdout.write(json.dumps({"frames": frames, "richness": frame_richness}))
`;
      const pyRes = await runPythonProcessAsync({
        code: pyScript,
        input: JSON.stringify({
          html: processedHtml,
          resources: approvedResources,
          mimes: approvedMimeTypes,
          maxExtra: maxExtraSections,
          offlineAudit: isOfflineAuditMode,
          virtualTimeBudget: idx === 0 ? 2200 : 1200,
        }),
        timeoutMs: 30_000,
        maxBuffer: 64 * 1024 * 1024,
      });

      if (pyRes.status === 0 && pyRes.stdout) {
        const parsed = JSON.parse(pyRes.stdout.trim()) as {
          frames?: string[];
          richness?: number[];
        };
        const frameList = Array.isArray(parsed.frames) ? parsed.frames : [];
        const richList = Array.isArray(parsed.richness) ? parsed.richness : [];
        for (let fIdx = 0; fIdx < frameList.length; fIdx++) {
          if (results.length >= maxShots) break;
          const pngBuf = Buffer.from(frameList[fIdx], "base64");
          if (pngBuf.length < 32) continue;
          const hash6 = crypto.createHash("md5").update(pngBuf).digest("hex").slice(0, 6);
          if (seenHashes.has(hash6)) continue;

          const prefix =
            fIdx === 0
              ? `app_${String(results.length + 1).padStart(2, "0")}_${safeStem}`
              : `app_${String(results.length + 1).padStart(2, "0")}_${safeStem}_sec${fIdx}`;
          const saved = savePngWithHash(pngBuf, prefix);
          seenHashes.add(saved.hash6);

          const colorRichness =
            typeof richList[fIdx] === "number" && richList[fIdx] > 0
              ? richList[fIdx]
              : fallbackColorRichness;
          const score =
            colorRichness * 3 +
            Math.min(widgetCount, 60) * 2 +
            (isMain ? (fIdx === 0 ? 180 : 60) : 0) -
            (isAuth ? 600 : 0);

          results.push({
            filePath: saved.filePath,
            screenName: fIdx === 0 ? baseStem : `${baseStem}_section${fIdx}`,
            sourceFile: relHtml,
            width: LMS_IMAGE_WIDTH,
            height: LMS_IMAGE_HEIGHT,
            widgetCount,
            colorRichness,
            isAuthScreen: fIdx === 0 ? isAuth : false,
            heuristicScore: score,
          });
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("TASK_CANCELLED:")) {
        throw err;
      }
      // Ignore single broken HTML page and continue with next
    }
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
 * Self-heals stale `_spck_app_shots/app_*.png` references when screenshots have been re-captured
 * (with new content hashes) or cleared on disk while an unapproved UI tab or draft still holds old paths.
 */
export function resolveValidAppShotResources(params: {
  localFolderPath?: string | null;
  thumbnailPath?: string | null;
  screenshots?: string[] | null;
  fallbackThumbnailPath?: string | null;
  fallbackScreenshots?: string[] | null;
}): {
  thumbnailPath: string;
  screenshots: string[];
  healed: boolean;
} {
  const folderPath = String(params.localFolderPath || "").trim();
  const rawThumb = String(params.thumbnailPath || "").trim();
  const rawScreens = Array.isArray(params.screenshots)
    ? params.screenshots.map((p) => String(p || "").trim()).filter(Boolean)
    : [];

  const isAppShotPath = (p: string) =>
    /[\\/]_spck_app_shots[\\/]app_/i.test(p);
  const fileExistsSafe = (p: string) => {
    if (!p) return false;
    try {
      const safe = assertPathAllowed(p);
      return fs.existsSync(safe) && fs.statSync(safe).isFile();
    } catch {
      return false;
    }
  };
  const samePath = (a: string, b: string) =>
    path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

  const thumbMissingAppShot =
    Boolean(rawThumb) && isAppShotPath(rawThumb) && !fileExistsSafe(rawThumb);
  const screensMissingAppShot = rawScreens.some(
    (p) => isAppShotPath(p) && !fileExistsSafe(p)
  );

  if (!thumbMissingAppShot && !screensMissingAppShot) {
    return {
      thumbnailPath: rawThumb,
      screenshots: rawScreens,
      healed: false,
    };
  }

  let diskShots: string[] = [];
  if (folderPath) {
    try {
      diskShots = listCapturedAppScreenshots(folderPath);
    } catch {
      diskShots = [];
    }
  }

  const extractSlotPrefix = (p: string) => {
    const base = path.basename(p);
    const m = base.match(/^(app_\d+_.*?)_[0-9a-f]{6}\.png$/i);
    return m ? m[1].toLowerCase() : "";
  };

  let resolvedThumb = rawThumb;
  if (thumbMissingAppShot) {
    const fbThumb = String(params.fallbackThumbnailPath || "").trim();
    if (fbThumb && fileExistsSafe(fbThumb)) {
      resolvedThumb = fbThumb;
    } else {
      const wantedSlot = extractSlotPrefix(rawThumb);
      const matchedDiskShot = wantedSlot
        ? diskShots.find((s) => extractSlotPrefix(s) === wantedSlot)
        : undefined;
      resolvedThumb =
        matchedDiskShot || diskShots[0] || DEFAULT_SPCK_THUMBNAIL_PATH;
    }
  }

  let resolvedScreens = rawScreens;
  if (screensMissingAppShot || thumbMissingAppShot) {
    const fbScreens = Array.isArray(params.fallbackScreenshots)
      ? params.fallbackScreenshots
          .map((p) => String(p || "").trim())
          .filter((p) => fileExistsSafe(p))
      : [];
    const preservedNonAppShots = rawScreens.filter(
      (p) => !isAppShotPath(p) && fileExistsSafe(p)
    );
    const candidateAppShots =
      diskShots.length > 0
        ? diskShots
        : fbScreens.filter((p) => isAppShotPath(p));
    const merged: string[] = [];
    const pushUnique = (p: string) => {
      if (!p || samePath(p, resolvedThumb)) return;
      if (merged.some((m) => samePath(m, p))) return;
      if (merged.length >= MAX_SPCK_SCREENSHOTS) return;
      merged.push(p);
    };
    for (const p of preservedNonAppShots) pushUnique(p);
    for (const p of candidateAppShots) pushUnique(p);
    if (merged.length === 0 && diskShots.length === 1 && samePath(diskShots[0], resolvedThumb)) {
      merged.push(diskShots[0]);
    }
    resolvedScreens = merged;
  }

  return {
    thumbnailPath: resolvedThumb,
    screenshots: resolvedScreens,
    healed:
      resolvedThumb !== rawThumb ||
      JSON.stringify(resolvedScreens) !== JSON.stringify(rawScreens),
  };
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
    capturedItems = await renderPyQtUiScreenshotsAsync({
      studentDir: safeFolderPath,
      uiFiles,
      outDir,
      maxShots: Math.max(uiFiles.length, MAX_SPCK_SCREENSHOTS + 5),
      referencedFiles,
    });
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
  } else {
    const gameFiles = findProjectGameFiles(safeFolderPath);
    if (gameFiles.yyzFiles.length > 0 || gameFiles.sb3Files.length > 0) {
      const maxGameShots = Math.max(
        1,
        MAX_SPCK_SCREENSHOTS +
          1 -
          Math.min(ownerImages.length, MAX_SPCK_SCREENSHOTS) -
          Math.min(ownerRootPhotos.length, 2)
      );
      capturedItems = await renderGameArchiveScreenshotsAsync({
        studentDir: safeFolderPath,
        yyzFiles: gameFiles.yyzFiles,
        sb3Files: gameFiles.sb3Files,
        outDir,
        maxShots: maxGameShots,
      });
    }
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
  // Edge case: if there was only 1 image total (1 captured screenshot or 1 Owner photo) and 0 other gallery images,
  // keep it in gallery too so the required LMS bottom box ("Ảnh chụp sản phẩm *") isn't empty
  if (galleryCandidates.length === 0 && (bestAppShotPath || ownerThumbCandidate)) {
    galleryCandidates.push(bestAppShotPath || ownerThumbCandidate);
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
  ensureCaptureNotStopped();
  const normalizedClassId = String(params.classId || "").trim().toUpperCase();
  const rows = spckUploadRepo.findByClass(normalizedClassId);
  const targetRows =
    params.studentIds && params.studentIds.length > 0
      ? rows.filter((r) => params.studentIds!.includes(r.studentId))
      : rows.filter((r) => Boolean(r.localFolderPath));

  const results: StudentAppCaptureResult[] = [];
  let totalScreenshotsCaptured = 0;

  for (const row of targetRows) {
    ensureCaptureNotStopped();
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
      if (err instanceof Error && err.message.startsWith("TASK_CANCELLED:")) {
        throw err;
      }
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
