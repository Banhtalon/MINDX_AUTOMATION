import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';

const root = process.cwd();
const out = path.dirname(fileURLToPath(import.meta.url));
function allowed(p) {
  const resolved = path.resolve(p);
  const relative = path.relative(root, resolved);
  assert(!relative.startsWith('..') && !path.isAbsolute(relative), 'Outside review allowlist');
  return resolved;
}
const read = p => fs.readFileSync(allowed(path.join(root, p)), 'utf8');
const write = (name, value) => fs.writeFileSync(allowed(path.join(out, name)), value);
const homework = read('src/app/homework-grader/page.tsx');
const session = read('src/app/session-comments/page.tsx');
const sourceCss = read('src/app/globals.css');
const capture = (text, regex) => { const m = text.match(regex); assert(m, `Missing source fixture: ${regex}`); return m[1]; };
const summary = capture(homework, /(<span className="[^"]+">\s*👥 Học viên:[\s\S]*?<\/span>)/)
  .replaceAll('className=', 'class=')
  .replace('{matrix.summary.totalStudents}', '7')
  .replace('<span ', '<span id="count-bg" ')
  .replace('<strong ', '<strong id="count" ');
const titleClass = capture(homework, /<div className="([^"]+)">\s*\{col.title\}/);
const theadClass = capture(homework, /<thead className="([^"]+)"/);
const titleThClass = capture(homework, /key=\{col.columnId\}\s*className="([^"]+)"/);
const heroClass = capture(homework, /<div className="([^"]*mindx-hero[^"]*)"/);
const pickerClass = capture(session, /className="([^"]*text-slate-900 dark:text-white[^"\n]*min-w-\[180px\][^"]*)"/);
const inputClass = capture(session, /className="([^"]*text-slate-900 dark:text-white[^"\n]*w-36 uppercase)"/);
const statusSection = session.slice(session.indexOf('{/* Status & Actions (3.6:'), session.indexOf('{/* Status & Actions (3.6:') + 2400);
const statusClasses = [...statusSection.matchAll(/<span className="([^"]+)"/g)].slice(0, 5).map(m => m[1]);
assert.equal(statusClasses.length, 5);
const statusLabels = ['Đã lưu LMS', 'Đã duyệt', 'Đang lưu', 'Thất bại', 'Bản nháp'];
const cssPath = allowed(path.join(root, 'src/app/globals.css'));
const css = (await postcss([tailwind({ base: root })]).process(sourceCss, { from: cssPath })).css;
write('probe.css', css);
const hashes = ['src/app/globals.css', 'src/app/homework-grader/page.tsx', 'src/app/session-comments/page.tsx', 'src/components/top-navbar.tsx']
  .map(file => ({ file, sha256: crypto.createHash('sha256').update(read(file)).digest('hex') }));
write('reviewed-source-hashes.json', JSON.stringify(hashes, null, 2));
class SequentialTaskQueue {
  tail = Promise.resolve();
  run(fn) { this.tail = this.tail.then(fn); return this.tail; }
}
const queue = new SequentialTaskQueue();
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mindx-v310-round3-'));
// One isolated persistent context; never opens the real LMS profile.
const context = await chromium.launchPersistentContext(path.join(scratch, 'playwright-auth'), { headless: true, viewport: { width: 1440, height: 900 } });
try {
  const page = await queue.run(() => context.newPage());
  await queue.run(() => page.setContent(`<html data-theme="light"><head><style>${css}</style></head>
  <body class="mindx-body"><main class="mindx-main p-6 space-y-6">
  <div class="${heroClass}"><h1 class="text-xl font-bold text-white">Round 3 — synthetic score matrix</h1>
  <div class="mt-4">${summary}</div>
  <div class="bg-white/95 dark:bg-slate-900/90 mt-4 p-2"><select id="picker" class="${pickerClass}"><option>REVIEW-CLASS</option></select><input id="input" class="${inputClass}" value="REVIEW-CLASS"></div></div>
  <div class="mindx-card rounded-xl overflow-hidden"><table class="w-full text-left text-sm text-slate-300"><thead class="${theadClass}"><tr><th class="p-3">Student</th>
  ${['Practice exercise', 'Quiz exercise'].map((title, i) => `<th class="${titleThClass}"><div id="title-${i}" class="${titleClass}">${title}</div></th>`).join('')}
  </tr></thead><tbody><tr><td class="p-3 text-white">STUDENT_01</td><td class="p-3">90</td><td class="p-3">80</td></tr></tbody></table></div>
  <div class="mindx-card p-4 space-x-3">${statusClasses.map((classes, i) => `<span id="status-${i}" class="${classes}">${statusLabels[i]}</span>`).join('')}</div>
  </main></body></html>`));
  const results = [];
  for (const osTheme of ['light', 'dark']) for (const appTheme of ['light', 'dark']) {
    await queue.run(() => page.emulateMedia({ colorScheme: osTheme }));
    await queue.run(() => page.evaluate(t => document.documentElement.dataset.theme = t, appTheme));
    const result = await queue.run(() => page.evaluate(({ osTheme, appTheme }) => {
      const normalize = value => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = value;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return `rgb(${r}, ${g}, ${b})`;
      };
      const color = id => normalize(getComputedStyle(document.getElementById(id)).color);
      const background = element => {
        while (element) {
          const bg = getComputedStyle(element).backgroundColor;
          if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return normalize(bg);
          element = element.parentElement;
        }
        throw new Error(`No opaque background; theme=${document.documentElement.dataset.theme}; html=${document.body.innerHTML.slice(0, 1500)}`);
      };
      const contrast = (a, b) => {
        const luminance = c => {
          const rgb = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(x => { x /= 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; });
          return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
        };
        const x = luminance(a), y = luminance(b);
        return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
      };
      const inspect = id => { const fg = color(id), bg = background(document.getElementById(id)); return { color: fg, background: bg, contrast: contrast(fg, bg) }; };
      return { osTheme, appTheme, titles: [inspect('title-0'), inspect('title-1')], count: inspect('count'), total: document.getElementById('count').textContent, picker: color('picker'), input: color('input'), statusBadges: Array.from({length: 5}, (_, i) => ({ label: document.getElementById(`status-${i}`).textContent, ...inspect(`status-${i}`) })) };
    }, { osTheme, appTheme }));
    results.push(result);
    write('theme-probe-results.json', JSON.stringify(results, null, 2));
    for (const title of result.titles) {
      assert.equal(title.color, 'rgb(255, 255, 255)', 'R2-01 title foreground');
      assert(title.contrast >= 4.5, 'R2-01 title contrast');
    }
    assert.equal(result.total, '7');
    assert(result.count.contrast >= 4.5, 'R2-02 count contrast');
    const expected = appTheme === 'light' ? 'rgb(15, 23, 42)' : 'rgb(255, 255, 255)';
    if (appTheme === 'light') {
      const channels = result.count.color.match(/\d+/g).map(Number);
      assert(channels.every((value, i) => Math.abs(value - [15, 23, 42][i]) <= 1), 'R2-02 count foreground');
    } else assert.equal(result.count.color, expected, 'R2-02 count foreground');
    assert.equal(result.picker, expected, 'Round 1 picker regression');
    assert.equal(result.input, expected, 'Round 1 manual-input regression');
    await queue.run(() => page.screenshot({ path: allowed(path.join(out, `theme-${appTheme}-os-${osTheme}.png`)) }));
  }
  console.log(JSON.stringify(results, null, 2));
  console.log('PASS: R2-01, R2-02 and Round 1 regressions across all four app/OS combinations.');
  const statusFindings = results.filter(r => r.appTheme === 'light').map(r => ({
    osTheme: r.osTheme,
    badges: r.statusBadges.filter(b => b.contrast < 4.5),
  }));
  write('status-contrast-findings.json', JSON.stringify(statusFindings, null, 2));
  if (statusFindings.some(r => r.badges.length)) {
    console.error('FAIL R3-01: low-contrast student status badges in Light Mode. See status-contrast-findings.json.');
    process.exitCode = 1;
  }
} finally {
  await context.close();
}
