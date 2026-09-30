// lib/html.js — HTML fixer for Urdu RTL Fixer MCP.
// A small, dependency-free tokenizer (no DOM). It never rewrites tags or attributes: it only
// INSERTS <bdi dir="ltr"> … </bdi> at source offsets around LTR runs found by bidi.cjs.
// Block handling mirrors the extension's content.js: each block (p, li, td, …, or any element
// with a dir attribute) is flattened to a string, direction-checked, and its LTR runs isolated.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const B = require('./bidi.cjs');

const VOID = new Set('area base br col embed hr img input link meta param source track wbr keygen'.split(' '));
const BLOCK = new Set(('address article aside blockquote body caption center dd details dialog dir div dl dt ' +
  'fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr html legend li main menu nav ol p ' +
  'section summary table tbody td tfoot th thead tr ul head label button').split(' '));
const IGNORE_RAW = new Set(['script', 'style', 'title', 'noscript', 'template']);         // content is not text, no boundary
const HARD_SKIP = new Set(['pre', 'textarea', 'svg', 'math', 'select', 'iframe', 'object', 'video', 'audio', 'canvas', 'xmp', 'listing', 'plaintext']);
const INLINE_OBJ = new Set(['code', 'kbd', 'samp', 'tt', 'var', 'picture', 'img']);        // neutral object inside a run
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp']);                 // no tags inside, scan to </name>
const AUTO_CLOSE = { p: ['p'], li: ['li'], dt: ['dt', 'dd'], dd: ['dt', 'dd'], td: ['td', 'th'], th: ['td', 'th'], tr: ['tr', 'td', 'th'], option: ['option'] };
const P_CLOSERS = new Set('address article aside blockquote div dl fieldset figure footer form h1 h2 h3 h4 h5 h6 header hr main menu nav ol p pre section table ul'.split(' '));

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0', hellip: '\u2026', mdash: '\u2014',
  ndash: '\u2013', times: '\u00D7', divide: '\u00F7', deg: '\u00B0', plusmn: '\u00B1', minus: '\u2212', sup1: '\u00B9',
  sup2: '\u00B2', sup3: '\u00B3', lrm: '\u200E', rlm: '\u200F', zwj: '\u200D', zwnj: '\u200C', copy: '\u00A9',
  reg: '\u00AE', trade: '\u2122', laquo: '\u00AB', raquo: '\u00BB', micro: '\u00B5', middot: '\u00B7', bull: '\u2022',
  rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201C', rdquo: '\u201D', le: '\u2264', ge: '\u2265', ne: '\u2260',
  asymp: '\u2248', lambda: '\u03BB', Omega: '\u03A9', alpha: '\u03B1', beta: '\u03B2', gamma: '\u03B3', Delta: '\u0394',
  theta: '\u03B8', pi: '\u03C0', mu: '\u03BC', rarr: '\u2192', larr: '\u2190' };

const TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9:_-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;
const ENTITY_RE = /&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/y;

function attr(attrs, name) {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))|(?:^|\\s)(${name})(?=\\s|$)`, 'i').exec(attrs || '');
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? '';
}

/** Tokenize into tags/text/comments with source offsets. */
export function tokenize(src) {
  const toks = [];
  let i = 0; const n = src.length;
  let textStart = 0;
  const pushText = (end) => { if (end > textStart) toks.push({ type: 'text', start: textStart, end }); };
  while (i < n) {
    if (src[i] !== '<') { i++; continue; }
    if (src.startsWith('<!--', i)) {
      pushText(i);
      const e = src.indexOf('-->', i + 4); const end = e < 0 ? n : e + 3;
      toks.push({ type: 'comment', start: i, end }); i = textStart = end; continue;
    }
    if (src[i + 1] === '!' || src[i + 1] === '?') {
      pushText(i);
      const e = src.indexOf('>', i); const end = e < 0 ? n : e + 1;
      toks.push({ type: 'decl', start: i, end }); i = textStart = end; continue;
    }
    TAG_RE.lastIndex = i;
    const m = TAG_RE.exec(src);
    if (!m) { i++; continue; }                     // a stray '<' is text
    pushText(i);
    const name = m[2].toLowerCase();
    const tok = { type: m[1] ? 'close' : 'open', name, attrs: m[3], selfClose: !!m[4], start: i, end: i + m[0].length };
    toks.push(tok);
    i = textStart = tok.end;
    if (tok.type === 'open' && RAW_TEXT.has(name)) {           // raw text: skip to </name
      const re = new RegExp(`</${name}\\s*>`, 'ig'); re.lastIndex = i;
      const cm = re.exec(src); const cEnd = cm ? cm.index : n;
      if (cEnd > i) toks.push({ type: 'raw', start: i, end: cEnd });
      i = textStart = cEnd;
    }
  }
  pushText(n);
  return toks;
}

function decodeInto(src, start, end, ctx, nodeId) {
  let i = start;
  while (i < end) {
    if (src[i] === '&') {
      ENTITY_RE.lastIndex = i;
      const m = ENTITY_RE.exec(src);
      if (m && m.index + m[0].length <= end) {
        const body = m[1];
        let ch;
        if (body[0] === '#') {
          const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
          try { ch = String.fromCodePoint(cp); } catch { ch = B.OBJ_NEUTRAL; }
        } else ch = ENT[body] ?? B.OBJ_NEUTRAL;       // unknown named entity -> neutral placeholder
        for (let k = 0; k < ch.length; k++) ctx.map.push({ s: i, e: i + m[0].length, node: nodeId, text: true });
        ctx.str += ch; i += m[0].length; continue;
      }
    }
    ctx.map.push({ s: i, e: i + 1, node: nodeId, text: true });
    ctx.str += src[i]; i++;
  }
}

/**
 * Wrap LTR runs inside RTL text in <bdi dir="ltr"> (formulas get class="f").
 * Returns { html, runs: [{text, formula, block}], blocks, rtlBlocks }.
 */
export function fixHtml(src, opts = {}) {
  const formulaClass = opts.formulaClass !== false;
  const toks = tokenize(src);
  const byStart = new Map(), byEnd = new Map();
  toks.forEach((t, k) => { byStart.set(t.start, k); byEnd.set(t.end, k); });
  const inserts = [];     // {pos, order, str}  order: 0 = close, 1 = open
  const report = { runs: [], blocks: 0, rtlBlocks: 0 };
  let nodeSeq = 0;
  const newCtx = (name) => ({ name, str: '', map: [] });
  const root = newCtx('#root');
  const stack = [root];     // block contexts
  const elStack = [];       // open element names (for auto-closing blocks), each {name, ctx|null}
  const top = () => stack[stack.length - 1];
  const addBreak = (ctx) => { ctx.str += '\n'; ctx.map.push({ s: -1, e: -1, node: -1 }); };

  function finalize(ctx) {
    report.blocks++;
    const s = ctx.str;
    if (!B.hasArabicScript(s)) return;
    if (B.analyzeDirection(s).dir !== 'rtl') return;
    report.rtlBlocks++;
    for (const r of B.findLtrRuns(s)) wrap(ctx, r);
  }

  function balanced(a, b) {
    const st = [];
    let k = byStart.get(a);
    if (k === undefined) { k = toks.findIndex(t => t.start >= a); if (k < 0) return true; }
    for (; k < toks.length && toks[k].start < b; k++) {
      const t = toks[k];
      if (t.type === 'open' && !t.selfClose && !VOID.has(t.name)) st.push(t.name);
      else if (t.type === 'close' && !VOID.has(t.name)) { if (st.pop() !== t.name) return false; }
    }
    return st.length === 0;
  }
  function unmatched(a, b) {   // counts of unmatched closes / opens in src[a,b)
    let opens = [], closes = 0;
    for (const t of toks) {
      if (t.start < a || t.start >= b) continue;
      if (t.type === 'open' && !t.selfClose && !VOID.has(t.name)) opens.push(t.name);
      else if (t.type === 'close' && !VOID.has(t.name)) { if (opens.length && opens[opens.length - 1] === t.name) opens.pop(); else closes++; }
    }
    return { closes, opens: opens.length };
  }

  function emit(a, b, formula) {
    const open = `<bdi dir="ltr"${formula && formulaClass ? ' class="f"' : ''}>`;
    inserts.push({ pos: a, order: 1, str: open, seq: inserts.length });
    inserts.push({ pos: b, order: 0, str: '</bdi>', seq: inserts.length });
  }

  function wrap(ctx, r) {
    const m0 = ctx.map[r.start], m1 = ctx.map[r.end - 1];
    let a = m0.s, b = m1.e;
    // expand over enclosing inline tags when the run fills them ( <b>Newton's</b> Law -> wrap the <b> too )
    for (let guard = 0; guard < 20 && !balanced(a, b); guard++) {
      const u = unmatched(a, b);
      let moved = false;
      if (u.closes > 0 && byEnd.has(a) && toks[byEnd.get(a)].type === 'open') { a = toks[byEnd.get(a)].start; moved = true; }
      if (u.opens > 0 && byStart.has(b) && toks[byStart.get(b)].type === 'close') { b = toks[byStart.get(b)].end; moved = true; }
      if (!moved) break;
    }
    if (balanced(a, b)) {
      emit(a, b, r.formula);
      report.runs.push({ text: r.text, formula: r.formula, wrapped: 'whole' });
      return;
    }
    // fallback: wrap each text-node piece separately (never produces broken markup)
    let k = r.start;
    while (k < r.end) {
      const node = ctx.map[k].node;
      let j = k;
      while (j < r.end && ctx.map[j].node === node) j++;
      if (ctx.map[k].text) {
        let x = k, y = j;
        while (x < y && /\s/.test(ctx.str[x])) x++;
        while (y > x && /\s/.test(ctx.str[y - 1])) y--;
        if (x < y && /[\p{L}\p{Nd}]/u.test(ctx.str.slice(x, y))) emit(ctx.map[x].s, ctx.map[y - 1].e, r.formula);
      }
      k = j;
    }
    report.runs.push({ text: r.text, formula: r.formula, wrapped: 'split' });
  }

  function closeEl(name) {    // pop element stack down to `name`
    for (let k = elStack.length - 1; k >= 0; k--) {
      if (elStack[k].name === name) {
        while (elStack.length > k) {
          const e = elStack.pop();
          if (e.ctx) { const c = stack.pop(); finalize(c); addBreak(top()); }
        }
        return true;
      }
    }
    return false;
  }

  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.type === 'text') { decodeInto(src, t.start, t.end, top(), nodeSeq++); continue; }
    if (t.type === 'comment' || t.type === 'decl' || t.type === 'raw') continue;
    const name = t.name;
    if (t.type === 'close') {
      if (name === 'br') { addBreak(top()); continue; }
      if (BLOCK.has(name) || elStack.some(e => e.name === name)) closeEl(name);
      continue;
    }
    // open tag
    if (name === 'br' || name === 'hr') { addBreak(top()); continue; }
    if (IGNORE_RAW.has(name)) { if (!RAW_TEXT.has(name)) k = skipSubtree(k); continue; }
    if (HARD_SKIP.has(name)) { addBreak(top()); k = RAW_TEXT.has(name) ? k : skipSubtree(k); addBreak(top()); continue; }
    const dir = attr(t.attrs, 'dir');
    if ((name === 'bdi' && dir && dir.toLowerCase() === 'ltr') || attr(t.attrs, 'data-urf-run') !== null) {
      // already isolated as LTR (ours or the author's): behaves like one LTR letter at run edges
      const endK = skipSubtree(k);
      const e = toks[endK] ? toks[endK].end : t.end;
      pushObj(top(), t.start, e, B.OBJ_ISOLATED); k = endK; continue;
    }
    if (INLINE_OBJ.has(name)) {
      const endK = (VOID.has(name) || t.selfClose) ? k : skipSubtree(k);
      const e = toks[endK] ? toks[endK].end : t.end;
      pushObj(top(), t.start, e, B.OBJ_NEUTRAL); k = endK; continue;
    }
    if (VOID.has(name) || t.selfClose) continue;
    // implicit closes
    const ac = AUTO_CLOSE[name];
    if (ac) {
      const topEl = elStack[elStack.length - 1];
      if (topEl && ac.includes(topEl.name)) closeEl(topEl.name);
    }
    if (P_CLOSERS.has(name)) { const topEl = elStack[elStack.length - 1]; if (topEl && topEl.name === 'p') closeEl('p'); }
    const isBlock = BLOCK.has(name) || name === 'bdi' || name === 'bdo' || dir !== null;
    if (isBlock) { addBreak(top()); const c = newCtx(name); stack.push(c); elStack.push({ name, ctx: c }); }
    else elStack.push({ name, ctx: null });
  }
  while (stack.length > 1) finalize(stack.pop());
  finalize(root);

  function pushObj(ctx, s, e, ch) { ctx.str += ch; ctx.map.push({ s, e, node: nodeSeq++, text: false }); }
  function skipSubtree(k) {     // index of the matching close tag (depth-counted), or k if none
    const name = toks[k].name; let depth = 0;
    for (let j = k; j < toks.length; j++) {
      const t = toks[j];
      if (t.name !== name) continue;
      if (t.type === 'open' && !t.selfClose) depth++;
      else if (t.type === 'close') { depth--; if (depth === 0) return j; }
    }
    return k;
  }

  inserts.sort((x, y) => x.pos - y.pos || x.order - y.order || x.seq - y.seq);
  let out = '', pos = 0;
  for (const ins of inserts) { out += src.slice(pos, ins.pos) + ins.str; pos = ins.pos; }
  out += src.slice(pos);
  return { html: out, ...report };
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Plain text -> HTML paragraphs (one <p> per line, blank lines dropped). */
export function textToHtml(text) {
  return B.stripBidiControls(String(text)).split(/\r\n|\n|\r|\u2028|\u2029/)
    .filter(l => l.trim() !== '').map(l => `<p>${escapeHtml(l)}</p>`).join('\n');
}

export const NASTALIQ_STACK = '"Noto Nastaliq Urdu", "Jameel Noori Nastaleeq", "Alvi Nastaleeq", "Urdu Typesetting", serif';

export function fontFaceCss(localTtf) {
  // local() first; the file: URL is only used when a local path is given (offline preview)
  const src = [`local("Noto Nastaliq Urdu")`, `local("NotoNastaliqUrdu-Regular")`];
  if (localTtf) src.push(`url("file://${encodeURI(localTtf)}") format("truetype")`);
  return `@font-face { font-family: "Noto Nastaliq Urdu"; src: ${src.join(', ')}; }\n`;
}

/** Complete RTL page around an already-fixed HTML body. */
export function fullDocument(bodyHtml, { lang = 'ur', title = '', webfont = true, localTtf = null, extraCss = '' } = {}) {
  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${webfont ? '<link href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;700&display=swap" rel="stylesheet">\n' : ''}<style>
${localTtf ? fontFaceCss(localTtf) : ''}  body { font-family: ${NASTALIQ_STACK}; line-height: 2.2; font-size: 20px; margin: 24px 32px; }
  bdi  { unicode-bidi: isolate; font-family: "Noto Serif", "Times New Roman", serif; }
  .f   { direction: ltr; white-space: nowrap; font-family: "DejaVu Sans", Arial, sans-serif; }
${extraCss}</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}

/** If src is a whole page, return the inner HTML of <body>; otherwise src. */
export function bodyInner(src) {
  const m = /<body\b[^>]*>([\s\S]*?)(?:<\/body\s*>|$)/i.exec(src);
  if (m) return m[1];
  if (/<html\b/i.test(src)) return src.replace(/<!doctype[^>]*>/i, '').replace(/<head\b[\s\S]*?<\/head\s*>/i, '').replace(/<\/?html\b[^>]*>/ig, '');
  return src;
}
export function isFullDocument(src) { return /<html\b|<body\b|<!doctype/i.test(src); }
