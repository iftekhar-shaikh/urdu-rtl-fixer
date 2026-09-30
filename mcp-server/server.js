#!/usr/bin/env node
// urdu-rtl-fixer — local stdio MCP server that fixes mixed Urdu (RTL) + English (LTR) text.
// Bidi core: lib/bidi.cjs (vendored copy of ../extension/bidi.js from the Chrome extension).
// No network access, no secrets. Logs go to stderr only (stdout is the MCP channel).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { fixHtml, textToHtml, fullDocument, bodyInner, isFullDocument, escapeHtml, fontFaceCss } from './lib/html.js';

const require = createRequire(import.meta.url);
const B = require('./lib/bidi.cjs');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PYTHON = process.env.URF_PYTHON || 'python3';
const PREVIEW_DIR = process.env.URF_PREVIEW_DIR || path.join(HERE, 'previews');
const LOCAL_TTF = [process.env.URF_NASTALIQ_TTF, path.join(os.homedir(), '.fonts/NotoNastaliqUrdu.ttf'),
  path.join(HERE, '..', 'extension', 'fonts', 'NotoNastaliqUrdu-Regular.ttf')].find(p => p && existsSync(p)) || null;

const text = (s) => ({ content: [{ type: 'text', text: s }] });
const fail = (msg) => ({ content: [{ type: 'text', text: `Error: ${msg}` }], isError: true });
const LINE_SPLIT = /\r\n|\n|\r|\u2028|\u2029/;
const cnt = (s, ch) => s.split(ch).length - 1;

const server = new McpServer({ name: 'urdu-rtl-fixer', version: '1.0.0' }, {
  instructions: 'Fixes the display order of Urdu/Arabic-script (right-to-left) text that contains English words, ' +
    'numbers, units or formulas by isolating every left-to-right run. Use fix_plain_text for WhatsApp/Word/SMS/email, ' +
    'fix_html for web pages, check_text to inspect, strip_marks to undo, render_preview to look at the result as a PNG.'
});

// 1. fix_plain_text ---------------------------------------------------------
server.registerTool('fix_plain_text', {
  title: 'Fix mixed Urdu/English plain text',
  description: 'Fix the display order of right-to-left (Urdu, Arabic, Persian…) plain text that contains English words, ' +
    'numbers, units or formulas. Each RTL line gets an RLM (U+200F) at the start and every left-to-right run is wrapped in ' +
    'FSI (U+2068) … PDI (U+2069). Lines without Arabic-script letters, and mostly-English lines, are left unchanged. ' +
    'Idempotent (existing bidi marks are removed first). Returns only the fixed text, ready to paste into WhatsApp, Word, Notes, SMS or email.',
  inputSchema: { text: z.string().describe('The plain text to fix (may be multi-line).') },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true }
}, async ({ text: t }) => text(B.fixText(t)));

// 2. fix_html -----------------------------------------------------------------
server.registerTool('fix_html', {
  title: 'Fix mixed Urdu/English HTML',
  description: 'Wrap every left-to-right run (English terms, numbers with units, formulas, URLs) inside right-to-left text ' +
    'in <bdi dir="ltr">…</bdi> (formulas also get class="f"). Tags, attributes, comments, <script>/<style>, <pre>, <code> and ' +
    'existing <bdi dir="ltr"> are never modified; only <bdi> tags are inserted. Only blocks that read right-to-left are touched. ' +
    'Give either `html` or `text` (plain text becomes one <p> per line). With full_document=true the result is a complete page: ' +
    '<html lang="ur" dir="rtl">, a Nastaliq font stack (Noto Nastaliq Urdu, Jameel Noori Nastaleeq…), line-height 2.2 and ' +
    'styles for bdi/.f; if the input is already a whole page, its <body> content is used.',
  inputSchema: {
    html: z.string().optional().describe('HTML fragment or full page to fix.'),
    text: z.string().optional().describe('Plain text to convert to HTML paragraphs and fix (use instead of html).'),
    full_document: z.boolean().optional().default(false).describe('Return a complete RTL HTML page instead of a fragment.'),
    lang: z.string().optional().default('ur').describe('lang attribute for full_document (ur, ar, fa, ps, sd). Default ur.'),
    title: z.string().optional().describe('<title> for full_document.'),
    webfont: z.boolean().optional().default(true).describe('full_document only: include the Google Fonts <link> for Noto Nastaliq Urdu (loaded by the viewer’s browser, not by this server). Default true.')
  },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true }
}, async ({ html, text: t, full_document, lang, title, webfont }) => {
  if ((html == null) === (t == null)) return fail('give exactly one of `html` or `text`.');
  let src = html != null ? html : textToHtml(t);
  if (full_document) src = bodyInner(src);
  const r = fixHtml(src);
  const out = full_document ? fullDocument(r.html.trim(), { lang, title: title || '', webfont }) : r.html;
  return text(out);
});

// 3. render_preview -------------------------------------------------------------
function runPython(args, timeoutMs = 90000) {
  return new Promise((resolve) => {
    execFile(PYTHON, [path.join(HERE, 'render_preview.py'), ...args], { timeout: timeoutMs, maxBuffer: 4 << 20 },
      (err, stdout, stderr) => {
        const line = String(stdout).trim().split('\n').pop() || '';
        try { resolve(JSON.parse(line)); }
        catch { resolve({ ok: false, error: (err ? err.message : 'no output') + (stderr ? `\n${String(stderr).slice(-1500)}` : '') }); }
      });
  });
}

server.registerTool('render_preview', {
  title: 'Render a PNG preview',
  description: 'Render text or HTML to a PNG with headless Chrome (Playwright, offline: network requests are blocked, the ' +
    'locally installed Noto Nastaliq Urdu font is used) for visual verification of the RTL/LTR order. ' +
    '`text` is fixed with fix_plain_text and shown as plain <p dir="auto"> lines (no markup), so only the invisible marks ' +
    'decide the order. `html` is fixed with fix_html and shown as a full RTL page (a whole page is rendered as given after ' +
    'fixing). Set fix=false to render the input unchanged, compare=true to show before and after. Returns the PNG path.',
  inputSchema: {
    text: z.string().optional().describe('Plain text to preview (use instead of html).'),
    html: z.string().optional().describe('HTML fragment or page to preview (use instead of text).'),
    out_path: z.string().optional().describe('Where to write the PNG (absolute, .png). Default: <server dir>/previews/preview-<time>.png'),
    fix: z.boolean().optional().default(true).describe('Apply the fixer before rendering. Default true.'),
    compare: z.boolean().optional().default(false).describe('Render the unfixed input above the fixed output.'),
    width: z.number().int().min(200).max(3000).optional().default(900).describe('Viewport width in CSS px. Default 900.'),
    include_image: z.boolean().optional().default(false).describe('Also return the PNG inline as image content.')
  },
  annotations: { readOnlyHint: false, openWorldHint: false }
}, async ({ text: t, html, out_path, fix, compare, width, include_image }) => {
  if ((html == null) === (t == null)) return fail('give exactly one of `text` or `html`.');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = out_path ? path.resolve(out_path) : path.join(PREVIEW_DIR, `preview-${stamp}.png`);
  if (!out.toLowerCase().endsWith('.png')) return fail('out_path must end with .png');
  const css = `  .label { direction: ltr; text-align: left; font: 13px "DejaVu Sans", Arial, sans-serif; color: #666; margin: 18px 0 0; border-top: 1px solid #ccc; padding-top: 6px; }\n` +
    `  .plain p { margin: 0.2em 0; white-space: pre-wrap; }\n`;
  let page;
  if (t != null) {
    const para = (s) => `<div class="plain">\n${s.split(LINE_SPLIT).map(l => `<p dir="auto">${escapeHtml(l) || '&nbsp;'}</p>`).join('\n')}\n</div>`;
    const fixed = fix ? B.fixText(t) : t;
    const body = compare
      ? `<div class="label">BEFORE (input as given)</div>\n${para(t)}\n<div class="label">AFTER (fix_plain_text: RLM + FSI…PDI, no markup)</div>\n${para(fixed)}`
      : para(fixed);
    page = fullDocument(body, { title: 'urdu-rtl-fixer preview', webfont: false, localTtf: LOCAL_TTF, extraCss: css });
  } else if (isFullDocument(html) && !compare) {
    page = fix ? fixHtml(html).html : html;
    const face = `<style>${fontFaceCss(LOCAL_TTF)}</style>`;
    page = /<head\b[^>]*>/i.test(page) ? page.replace(/<head\b[^>]*>/i, (m) => `${m}\n${face}`) : face + page;
  } else {
    const inner = bodyInner(html);
    const fixed = fix ? fixHtml(inner).html : inner;
    const body = compare
      ? `<div class="label">BEFORE (input as given)</div>\n${inner}\n<div class="label">AFTER (fix_html)</div>\n${fixed}`
      : fixed;
    page = fullDocument(body, { title: 'urdu-rtl-fixer preview', webfont: false, localTtf: LOCAL_TTF, extraCss: css });
  }
  const tmp = path.join(os.tmpdir(), `urf-preview-${process.pid}-${Date.now()}.html`);
  try {
    await fs.writeFile(tmp, page, 'utf8');
    if (PYTHON.includes(path.sep) && !existsSync(PYTHON)) return fail(`cannot render: Python with Playwright not found at ${PYTHON} (set URF_PYTHON).`);
    const r = await runPython([tmp, out, String(width), '1.5']);
    if (!r.ok) return fail(`rendering failed: ${r.error}`);
    const lines = [`PNG written: ${r.out}`, `size: ${width}x${r.height} CSS px @ ${r.scale}x`,
      `Noto Nastaliq Urdu loaded: ${r.nastaliq_loaded}`];
    const res = text(lines.join('\n'));
    if (include_image) res.content.push({ type: 'image', mimeType: 'image/png', data: (await fs.readFile(r.out)).toString('base64') });
    return res;
  } catch (e) {
    return fail(`rendering failed: ${e.message}`);
  } finally {
    fs.unlink(tmp).catch(() => {});
  }
});

// 4. check_text -------------------------------------------------------------------
server.registerTool('check_text', {
  title: 'Check bidi state of text',
  description: 'Inspect plain text without changing it. Reports whether isolates (FSI/LRI/RLI … PDI) are balanced on every ' +
    'line, whether right-to-left (Arabic-script) text is detected and the overall direction, counts of each bidi control, ' +
    'the left-to-right runs found (English terms, numbers, formulas) with whether each is already isolated, and whether ' +
    'fix_plain_text would change the text. Returns JSON.',
  inputSchema: { text: z.string().describe('The plain text to inspect.') },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true }
}, async ({ text: t }) => {
  const lines = String(t).split(LINE_SPLIT);
  const clean = B.stripBidiControls(t);
  const runs = [], unbalanced = [];
  lines.forEach((line, idx) => {
    if (!B.isolatesBalanced(line)) unbalanced.push(idx + 1);
    const s = B.stripBidiControls(line);
    if (!B.hasArabicScript(s)) return;
    const d = B.analyzeDirection(s).dir;
    for (const r of B.findLtrRuns(s)) {
      const isolated = [B.FSI, B.LRI].some(o => line.includes(o + r.text + B.PDI));
      runs.push({ line: idx + 1, text: r.text, formula: r.formula, isolated, line_direction: d });
    }
  });
  const report = {
    rtl_detected: B.hasArabicScript(clean),
    looks_urdu: B.looksUrdu(clean),
    direction: B.analyzeDirection(clean).dir,
    isolates_balanced: B.isolatesBalanced(t),
    unbalanced_lines: unbalanced,
    counts: { FSI: cnt(t, B.FSI), LRI: cnt(t, B.LRI), RLI: cnt(t, B.RLI), PDI: cnt(t, B.PDI), RLM: cnt(t, B.RLM), LRM: cnt(t, B.LRM),
      ALM: cnt(t, '\u061C'), legacy_embeddings: (t.match(/[\u202A-\u202E]/g) || []).length },
    ltr_runs: runs,
    already_fixed: B.fixText(t) === t,
  };
  return text(JSON.stringify(report, null, 2));
});

// 5. strip_marks -------------------------------------------------------------------
server.registerTool('strip_marks', {
  title: 'Remove bidi control characters',
  description: 'Remove all invisible bidi control characters from text: LRM U+200E, RLM U+200F, ALM U+061C, ' +
    'embeddings/overrides U+202A–U+202E and isolates U+2066–U+2069 (LRI, RLI, FSI, PDI). Returns the cleaned text; ' +
    'the inverse of fix_plain_text.',
  inputSchema: { text: z.string().describe('Text to clean.') },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true }
}, async ({ text: t }) => text(B.stripBidiControls(t)));

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`urdu-rtl-fixer MCP server running on stdio (python: ${PYTHON}, font: ${LOCAL_TTF || 'system'})`);
