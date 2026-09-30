/*
 * content.js — "Urdu RTL Fixer" page fixer.
 * For every block that contains Arabic-script text:
 *   1. if the block reads right-to-left (first strong letter RTL, or RTL words >= LTR words)
 *      and it is not already RTL -> set dir="rtl" (the original value is remembered for undo)
 *   2. wrap every LTR run (English, numbers, units, formulas) in <bdi dir="ltr" data-urf-run>
 * Skips inputs, textareas, contenteditable, code/pre, script/style and anything already done.
 * A debounced MutationObserver keeps dynamic sites (ChatGPT, Grok, Gmail, WhatsApp Web) fixed.
 */
(() => {
  'use strict';
  if (window.__urfLoaded) return;
  window.__urfLoaded = true;

  const B = globalThis.URFBidi;
  const DEFAULTS = { enabled: true, disabledSites: [], nastaliq: false, wrapRuns: true };
  const SITE = location.hostname || location.protocol.replace(':', '');

  // ---- element classes ----------------------------------------------------
  const IGNORE = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE', 'META', 'LINK', 'WBR']);
  const HARD_SKIP = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'PRE', 'SVG', 'svg', 'MATH', 'math',
    'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'VIDEO', 'AUDIO']);
  const INLINE_OBJ = new Set(['CODE', 'KBD', 'SAMP', 'TT', 'VAR', 'IMG', 'PICTURE']);
  const SKIP_SELECTOR = 'input,textarea,select,option,script,style,noscript,template,code,pre,kbd,samp,tt,var,svg,math,canvas,[contenteditable]:not([contenteditable="false"])';
  const RUN_ATTR = 'data-urf-run';

  let settings = { ...DEFAULTS };
  let active = false;
  let observer = null;
  const pending = new Set();
  let timer = null, firstPendingAt = 0;
  const DEBOUNCE_MS = 350, MAX_WAIT_MS = 1500;
  const splitNodes = new Set();          // text nodes created by splitText (merged back on undo)
  const stats = { blocks: 0, runs: 0, dirSet: 0, lastMs: 0, passes: 0 };

  // ---- helpers -------------------------------------------------------------
  let displayCache = new Map();
  function isBlockEl(el) {
    if (el === document.body || el === document.documentElement) return true;
    let v = displayCache.get(el);
    if (v === undefined) {
      if (el.tagName === 'BDI' || el.tagName === 'BDO' || el.hasAttribute('dir')) {
        v = !el.hasAttribute(RUN_ATTR);  // an isolated element is its own unit
      } else {
        const d = getComputedStyle(el).display;
        v = !(d === 'inline' || d === 'contents' || d.startsWith('ruby'));
      }
      displayCache.set(el, v);
    }
    return v;
  }
  function isSkippedTextNode(t) {
    const p = t.parentElement;
    if (!p) return true;
    if (p.isContentEditable) return true;
    return !!p.closest(SKIP_SELECTOR);
  }
  function nearestBlock(node) {
    let el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el !== document.documentElement) {
      if (isBlockEl(el)) return el;
      el = el.parentElement;
    }
    return document.body;
  }

  /** Flatten a block's own inline content into a string + map of parts. */
  function flatten(block) {
    const parts = [];
    let str = '';
    (function visit(node) {
      for (let c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) {
          const d = c.data;
          if (d) { parts.push({ node: c, start: str.length, end: str.length + d.length, text: true }); str += d; }
        } else if (c.nodeType === 1) {
          const t = c.tagName;
          if (IGNORE.has(t)) continue;
          if (t === 'BR') { str += '\n'; continue; }
          if (c.hasAttribute(RUN_ATTR)) {                        // one of ours: already isolated LTR
            parts.push({ node: c, start: str.length, end: str.length + 1 }); str += B.OBJ_ISOLATED; continue;
          }
          if (HARD_SKIP.has(t) || c.isContentEditable || isBlockEl(c)) { str += '\n'; continue; }
          if (INLINE_OBJ.has(t)) { parts.push({ node: c, start: str.length, end: str.length + 1 }); str += B.OBJ_NEUTRAL; continue; }
          visit(c);
        }
      }
    })(block);
    return { block, str, parts };
  }

  function partIndexAt(parts, off) {
    let lo = 0, hi = parts.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1, p = parts[m];
      if (off < p.start) hi = m - 1; else if (off >= p.end) lo = m + 1; else return m;
    }
    return -1;
  }
  function isEmptyNode(n) { return (n.nodeType === 3 && n.data === '') || n.nodeType === 8; }
  function firstContentIn(anc, node) {       // is `node` the first content inside ancestor `anc`?
    for (let n = node; n !== anc; n = n.parentNode) {
      for (let s = n.previousSibling; s; s = s.previousSibling) if (!isEmptyNode(s)) return false;
    }
    return true;
  }
  function lastContentIn(anc, node) {
    for (let n = node; n !== anc; n = n.parentNode) {
      for (let s = n.nextSibling; s; s = s.nextSibling) if (!isEmptyNode(s)) return false;
    }
    return true;
  }

  function wrapRun(model, run) {
    const { parts } = model;
    const si = partIndexAt(parts, run.start), ei = partIndexAt(parts, run.end - 1);
    if (si < 0 || ei < 0) return false;
    const sp = parts[si], ep = parts[ei];
    let startNode = sp.node, endNode = ep.node;
    // Pre-check the structure before splitting anything, so a failed wrap leaves the DOM untouched.
    let first = startNode, last = endNode;
    if (startNode.parentNode !== endNode.parentNode) {
      const anc = new Set();
      for (let n = startNode.parentNode; n; n = n.parentNode) { anc.add(n); if (n === model.block) break; }
      let lca = endNode.parentNode;
      while (lca && !anc.has(lca)) lca = lca.parentNode;
      if (!lca) return false;
      first = startNode; while (first.parentNode !== lca) first = first.parentNode;
      last = endNode; while (last.parentNode !== lca) last = last.parentNode;
      const startOk = !(sp.text && run.start > sp.start) || startNode.parentNode === lca;
      const endOk = !(ep.text && run.end < ep.end) || endNode.parentNode === lca;
      if (!startOk || !endOk) return false;
      if (first !== startNode && !firstContentIn(first, startNode)) return false;
      if (last !== endNode && !lastContentIn(last, endNode)) return false;
    }
    if (ep.text && run.end < ep.end) splitNodes.add(endNode.splitText(run.end - ep.start));
    if (sp.text && run.start > sp.start) {
      const piece = startNode.splitText(run.start - sp.start);
      splitNodes.add(piece);
      if (first === startNode) first = piece;
      if (si === ei) { last = piece; }
      startNode = piece;
    }
    const bdi = document.createElement('bdi');
    bdi.setAttribute('dir', 'ltr');
    bdi.setAttribute(RUN_ATTR, run.formula ? 'f' : '1');
    const parent = first.parentNode;
    parent.insertBefore(bdi, first);
    let n = first;
    while (n) {
      const next = n.nextSibling;
      bdi.appendChild(n);
      if (n === last) break;
      n = next;
    }
    return true;
  }

  // ---- main pass -------------------------------------------------------------
  function collectBlocks(roots) {
    const blocks = new Set();
    for (const root of roots) {
      if (!root || !root.isConnected) continue;
      if (root.nodeType === 3) {
        if (B.hasArabicScript(root.data) && !isSkippedTextNode(root)) blocks.add(nearestBlock(root));
        continue;
      }
      if (root.nodeType !== 1 && root.nodeType !== 9) continue;
      const base = root.nodeType === 9 ? root.body : root;
      if (!base) continue;
      if (base.nodeType === 1 && base.closest && base !== document.body && base.parentElement &&
          (base.parentElement.isContentEditable || base.parentElement.closest(SKIP_SELECTOR))) continue;
      const w = document.createTreeWalker(base, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          if (n.nodeType === 1) {
            const t = n.tagName;
            if (IGNORE.has(t) || HARD_SKIP.has(t) || INLINE_OBJ.has(t) || n.hasAttribute(RUN_ATTR) ||
                n.getAttribute('contenteditable') === 'true' || n.getAttribute('contenteditable') === '' ||
                n.getAttribute('contenteditable') === 'plaintext-only') return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_SKIP;
          }
          return B.hasArabicScript(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
      });
      for (let t = w.nextNode(); t; t = w.nextNode()) {
        if (t.parentElement && t.parentElement.isContentEditable) continue;
        blocks.add(nearestBlock(t));
      }
    }
    return blocks;
  }

  function processRoots(roots) {
    const t0 = performance.now();
    displayCache = new Map();
    const blocks = collectBlocks(roots);
    // Phase 1: reads only (layout/style) -> plans
    const plans = [];
    for (const block of blocks) {
      if (!block || !block.isConnected) continue;
      const model = flatten(block);
      if (!B.hasArabicScript(model.str)) continue;
      const a = B.analyzeDirection(model.str);
      if (a.dir !== 'rtl') continue;
      const needDir = getComputedStyle(block).direction !== 'rtl';
      const runs = settings.wrapRuns ? B.findLtrRuns(model.str) : [];
      plans.push({ model, needDir, runs, urdu: B.looksUrdu(model.str) });
    }
    // Phase 2: writes
    for (const p of plans) {
      const block = p.model.block;
      if (p.needDir) {
        if (!block.hasAttribute('data-urf-dir')) block.setAttribute('data-urf-dir', block.getAttribute('dir') ?? '\u0000');
        block.setAttribute('dir', 'rtl');
        stats.dirSet++;
      }
      block.setAttribute('data-urf-b', '');
      if (p.urdu) block.setAttribute('data-urf-nq', '');
      for (let i = p.runs.length - 1; i >= 0; i--) if (wrapRun(p.model, p.runs[i])) stats.runs++;
      stats.blocks++;
    }
    // Lists: when every <li> of a <ul>/<ol> became RTL, flip the list too so bullets/numbers and the
    // list indent move to the right side instead of overflowing the right edge.
    const lists = new Set();
    for (const p of plans) {
      const par = p.model.block.parentElement;
      if (p.model.block.tagName === 'LI' && par && (par.tagName === 'UL' || par.tagName === 'OL')) lists.add(par);
    }
    for (const list of lists) {
      const items = Array.from(list.children).filter(c => c.tagName === 'LI');
      if (items.length && items.every(li => li.getAttribute('dir') === 'rtl') && getComputedStyle(list).direction !== 'rtl') {
        if (!list.hasAttribute('data-urf-dir')) list.setAttribute('data-urf-dir', list.getAttribute('dir') ?? '\u0000');
        list.setAttribute('dir', 'rtl');
        stats.dirSet++;
      }
    }
    displayCache = new Map();
    stats.passes++;
    stats.lastMs = Math.round((performance.now() - t0) * 10) / 10;
  }

  function withoutObserver(fn) {
    if (observer) observer.disconnect();
    try { fn(); } finally {
      if (observer && active) {
        observer.takeRecords();
        observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      }
    }
  }

  function unwrapBdi(bdi) {
    const parent = bdi.parentNode;
    if (!parent) return;
    while (bdi.firstChild) parent.insertBefore(bdi.firstChild, bdi);
    bdi.remove();
  }

  function flush() {
    timer = null; firstPendingAt = 0;
    if (!active) { pending.clear(); return; }
    const roots = [];
    for (const n of pending) {
      if (!n.isConnected) continue;
      // The page changed text we had wrapped (e.g. a React re-render) -> unwrap and redo the block
      const runEl = (n.nodeType === 1 ? n : n.parentElement)?.closest?.('bdi[' + RUN_ATTR + ']');
      if (runEl) { const b = runEl.parentElement; withoutObserver(() => unwrapBdi(runEl)); if (b) roots.push(nearestBlock(b)); continue; }
      // re-check the enclosing block if we already fixed it (e.g. streamed English appended to Urdu)
      const b = n.parentElement && nearestBlock(n.parentElement);
      if (b && b.hasAttribute('data-urf-b')) roots.push(b);
      roots.push(n);
    }
    pending.clear();
    if (roots.length) withoutObserver(() => processRoots(roots));
  }
  function schedule() {
    const now = performance.now();
    if (!firstPendingAt) firstPendingAt = now;
    clearTimeout(timer);
    const wait = Math.max(0, Math.min(DEBOUNCE_MS, MAX_WAIT_MS - (now - firstPendingAt)));
    timer = setTimeout(flush, wait);
  }
  function onMutations(records) {
    for (const r of records) {
      if (r.type === 'characterData') pending.add(r.target);
      else for (const n of r.addedNodes) {
        if (n.nodeType === 1 && n.hasAttribute && n.hasAttribute(RUN_ATTR)) continue;
        if (n.nodeType === 1 || n.nodeType === 3) pending.add(n);
      }
    }
    if (pending.size) schedule();
  }

  function start() {
    active = true;
    if (!observer) observer = new MutationObserver(onMutations);
    withoutObserver(() => processRoots([document]));
  }

  function undo() {
    active = false;
    if (observer) observer.disconnect();
    clearTimeout(timer); timer = null; pending.clear();
    const bdis = Array.from(document.querySelectorAll('bdi[' + RUN_ATTR + ']')).reverse();
    for (const b of bdis) unwrapBdi(b);
    // merge text nodes we split back into the original nodes
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of Array.from(splitNodes)) {
        if (!t.isConnected) { splitNodes.delete(t); continue; }
        const prev = t.previousSibling;
        if (prev && prev.nodeType === 3) { prev.appendData(t.data); t.remove(); splitNodes.delete(t); changed = true; }
      }
    }
    splitNodes.clear();
    for (const el of document.querySelectorAll('[data-urf-dir]')) {
      const v = el.getAttribute('data-urf-dir');
      if (v === '\u0000') el.removeAttribute('dir'); else el.setAttribute('dir', v);
      el.removeAttribute('data-urf-dir');
    }
    for (const el of document.querySelectorAll('[data-urf-b],[data-urf-nq]')) {
      el.removeAttribute('data-urf-b'); el.removeAttribute('data-urf-nq');
    }
    stats.blocks = stats.runs = stats.dirSet = 0;
  }

  function applySettings(next) {
    const prev = settings;
    settings = { ...DEFAULTS, ...next };
    const shouldBeActive = !!settings.enabled && !(settings.disabledSites || []).includes(SITE);
    document.documentElement.classList.toggle('urf-nq', shouldBeActive && !!settings.nastaliq);
    if (shouldBeActive && !active) start();
    else if (!shouldBeActive && active) undo();
    else if (active && prev.wrapRuns !== settings.wrapRuns) { undo(); start(); }
  }

  // ---- messages from popup / background --------------------------------------
  function getSelectedText() {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && /^(text|search|url|email|tel)?$/i.test(ae.type || '')))) {
      try {
        const s = ae.value.substring(ae.selectionStart, ae.selectionEnd);
        if (s) return s;
      } catch (e) { /* not selectable */ }
    }
    const sel = window.getSelection();
    return sel ? sel.toString() : '';
  }
  function copyViaPage(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
    (document.body || document.documentElement).appendChild(ta);
    const prevFocus = document.activeElement;
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* ignore */ }
    return ok;
  }
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'urf-get-selection') { sendResponse({ text: getSelectedText() }); return; }
    if (msg.type === 'urf-copy-text') {
      if (navigator.clipboard && document.hasFocus()) {
        navigator.clipboard.writeText(msg.text).then(() => sendResponse({ ok: true }),
          () => sendResponse({ ok: copyViaPage(msg.text) }));
        return true;
      }
      sendResponse({ ok: copyViaPage(msg.text) });
      return;
    }
    if (msg.type === 'urf-stats') { sendResponse({ site: SITE, active, ...stats }); return; }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const next = { ...settings };
    for (const k of Object.keys(changes)) next[k] = changes[k].newValue;
    applySettings(next);
  });
  chrome.storage.sync.get(DEFAULTS, (s) => applySettings(s));

  // test hook (harmless on real pages): lets the automated test force a synchronous pass
  window.addEventListener('urf-test-flush', () => { if (timer) { clearTimeout(timer); flush(); } });
})();
