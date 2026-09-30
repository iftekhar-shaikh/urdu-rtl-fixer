/*
 * bidi.js — shared core for "Urdu RTL Fixer".
 * Pure string logic (no DOM), used by the content script, popup, background
 * worker and by the Node unit tests.
 *
 * Method (see RTL-MIXED-TEXT-RECIPE.md): isolate every left-to-right run.
 *   HTML        -> <bdi dir="ltr">…</bdi>  (content.js does the DOM part)
 *   plain text  -> RLM at line start + FSI … PDI around each LTR run
 * Padding with spaces does NOT work, so we never do that.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.URFBidi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FSI = '\u2068', PDI = '\u2069', RLM = '\u200F', LRM = '\u200E';
  const LRI = '\u2066', RLI = '\u2067';
  // Placeholder chars used by the DOM layer when it flattens a block to a string:
  const OBJ_ISOLATED = '\uE000'; // an element we (or the page) already isolated as LTR -> behaves like a letter at run edges
  const OBJ_NEUTRAL = '\uFFFC';  // inline object (img, inline code…) -> neutral, can sit inside a run, trimmed at edges

  // Arabic-script blocks (Urdu, Arabic, Persian, Pashto, Sindhi…)
  const ARABIC_SCRIPT_RE = /[\u0600-\u06FF\u0750-\u077F\u0870-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const URDU_MARKERS_RE = /[\u0679\u0688\u0691\u06BA\u06BE\u06C1\u06C3\u06D2\u06D3\u06D4]/; // ٹ ڈ ڑ ں ھ ہ ۃ ے ۓ ۔
  // Bidi formatting controls (removed before re-applying, which makes fixText idempotent)
  const BIDI_CONTROLS_RE = /[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/g;

  function cpIsRtlBlock(cp) {
    return (cp >= 0x0590 && cp <= 0x08FF) ||      // Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan, Mandaic, Arabic Ext
      (cp >= 0xFB1D && cp <= 0xFDFF) ||            // Hebrew + Arabic presentation forms A
      (cp >= 0xFE70 && cp <= 0xFEFF) ||            // Arabic presentation forms B
      (cp >= 0x10800 && cp <= 0x10FFF) ||          // historic RTL scripts
      (cp >= 0x1E800 && cp <= 0x1EFFF);            // Adlam, Arabic math alphabetic symbols…
  }
  function cpIsBidiControl(cp) {
    return cp === 0x200E || cp === 0x200F || cp === 0x061C ||
      (cp >= 0x202A && cp <= 0x202E) || (cp >= 0x2066 && cp <= 0x2069);
  }
  function cpIsLineBreak(cp) {
    return cp === 0x0A || cp === 0x0D || cp === 0x2028 || cp === 0x2029 || cp === 0x85;
  }
  /** A char that can never be part of an LTR run. */
  function cpIsStop(cp) { return cpIsRtlBlock(cp) || cpIsBidiControl(cp) || cpIsLineBreak(cp); }

  const LETTER_OR_DIGIT_RE = /[\p{L}\p{Nd}]/u;
  const LETTER_RE = /\p{L}/u;
  const SUPER_SUB_RE = /[\u00B2\u00B3\u00B9\u00BC-\u00BE\u2070-\u209F\u2150-\u215F]/;
  // Chars allowed at the START of an LTR run (besides letters/digits)
  const LEAD_SET = new Set(Array.from('([{+-\u2212\u00B1\u2213\u2220\u221A\u221B\u0394\u2207\u2211\u220F\u222B\u2202\u221E$\u00A3\u20AC\u00A5\u20B9\u20A8#@~<>\u2264\u2265\u2248\u2260\u2261\u00AC'));
  // Chars allowed at the END of an LTR run (besides letters/digits)
  const TRAIL_SET = new Set(Array.from(')]}%\u2030\u00B0\u2032\u2033\u2103\u2109\u2122\u00AE\u00A9+#*'));
  const OPEN_TO_CLOSE = { '(': ')', '[': ']', '{': '}', '\u207D': '\u207E', '\u208D': '\u208E' };
  const CLOSE_TO_OPEN = { ')': '(', ']': '[', '}': '{', '\u207E': '\u207D', '\u208E': '\u208D' };

  function isAnchorChar(ch) { return LETTER_OR_DIGIT_RE.test(ch) && !cpIsRtlBlock(ch.codePointAt(0)); }
  function leadOK(ch) { return ch === OBJ_ISOLATED || isAnchorChar(ch) || LEAD_SET.has(ch) || SUPER_SUB_RE.test(ch); }
  function trailOK(ch) { return ch === OBJ_ISOLATED || isAnchorChar(ch) || TRAIL_SET.has(ch) || SUPER_SUB_RE.test(ch); }

  function hasArabicScript(s) { return ARABIC_SCRIPT_RE.test(s); }
  function looksUrdu(s) { return URDU_MARKERS_RE.test(s); }
  function stripBidiControls(s) { return s.replace(BIDI_CONTROLS_RE, ''); }

  /**
   * Direction analysis of a string.
   * Returns { first, rtlWords, ltrUnits, dir } where first/dir are 'rtl' | 'ltr' | null.
   * dir is 'rtl' when the first strong letter is RTL, OR when the number of RTL words is at
   * least the number of LTR *units* (each English term / formula run counts once, because
   * "SI unit m/s²" is one thing inside an Urdu sentence). So
   * "Acceleration کی SI unit m/s² ہے۔" is RTL, "This English sentence has one لفظ only" is LTR.
   */
  function analyzeDirection(s) {
    let first = null, rtlWords = 0, cur = null;
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      if (cp === 0x200F || cp === 0x061C) { if (!first) first = 'rtl'; cur = null; continue; }
      if (cp === 0x200E) { if (!first) first = 'ltr'; cur = null; continue; }
      if (ch === OBJ_ISOLATED) { if (!first) first = 'ltr'; cur = null; continue; }
      if (!LETTER_RE.test(ch)) { if (!/\p{M}/u.test(ch)) cur = null; continue; }
      const d = cpIsRtlBlock(cp) ? 'rtl' : 'ltr';
      if (!first) first = d;
      if (d === 'rtl' && cur !== 'rtl') rtlWords++;
      cur = d;
    }
    let ltrUnits = 0;
    if (rtlWords > 0 && first !== 'rtl') {
      // one unit per maximal stretch of non-RTL text that holds a letter/digit or an isolated object
      let i = 0;
      const n = s.length;
      while (i < n) {
        if (cpIsStop(s.codePointAt(i))) { i += cpLenAt(s, i); continue; }
        let j = i, has = false;
        while (j < n && !cpIsStop(s.codePointAt(j))) {
          const l = cpLenAt(s, j), ch = s.slice(j, j + l);
          if (ch === OBJ_ISOLATED || isAnchorChar(ch)) has = true;
          j += l;
        }
        if (has) ltrUnits++;
        i = j;
      }
    }
    let dir = first;
    if (rtlWords > 0 && rtlWords >= ltrUnits) dir = 'rtl';
    return { first, rtlWords, ltrUnits, dir };
  }

  function findMatchForward(s, i, j) {
    const open = s[i], close = OPEN_TO_CLOSE[open];
    let depth = 0;
    for (let k = i; k < j; k++) {
      if (s[k] === open) depth++;
      else if (s[k] === close) { depth--; if (depth === 0) return k; }
    }
    return -1;
  }
  function findMatchBackward(s, i, j) {
    const close = s[j - 1], open = CLOSE_TO_OPEN[close];
    let depth = 0;
    for (let k = j - 1; k >= i; k--) {
      if (s[k] === close) depth++;
      else if (s[k] === open) { depth--; if (depth === 0) return k; }
    }
    return -1;
  }

  // helpers for code-point stepping on UTF-16 indices
  function cpLenAt(s, i) { const c = s.charCodeAt(i); return (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) ? 2 : 1; }
  function cpLenBefore(s, j) { const c = s.charCodeAt(j - 1); return (c >= 0xDC00 && c <= 0xDFFF && j >= 2) ? 2 : 1; }

  function trimRun(s, i, j) {
    for (let guard = 0; guard < 1000 && i < j; guard++) {
      while (i < j && !leadOK(s.slice(i, i + cpLenAt(s, i)))) i += cpLenAt(s, i);
      while (j > i && !trailOK(s.slice(j - cpLenBefore(s, j), j))) j -= cpLenBefore(s, j);
      if (i >= j) break;
      if (OPEN_TO_CLOSE[s[i]] && findMatchForward(s, i, j) < 0) { i++; continue; }
      if (CLOSE_TO_OPEN[s[j - 1]] && findMatchBackward(s, i, j) < 0) { j--; continue; }
      break;
    }
    return [i, j];
  }

  /**
   * Find the LTR runs (English words/phrases, numbers, units, formulas, URLs) inside a
   * string that is displayed right-to-left. Returns [{start, end, text, formula}] with
   * UTF-16 offsets, in logical order. A run never contains RTL letters, Arabic punctuation
   * (، ؛ ؟ ۔ stay outside), bidi controls or line breaks; leading/trailing spaces and
   * sentence punctuation are left outside; brackets are kept only when balanced.
   */
  function findLtrRuns(s) {
    const runs = [];
    const n = s.length;
    let i = 0;
    while (i < n) {
      const len = cpLenAt(s, i);
      if (cpIsStop(s.codePointAt(i))) { i += len; continue; }
      let j = i;
      while (j < n && !cpIsStop(s.codePointAt(j))) j += cpLenAt(s, j);
      pushRuns(s, i, j, runs);
      i = j;
    }
    return runs;
  }

  function pushRuns(s, i, j, runs) {
    const [a, b] = trimRun(s, i, j);
    if (a >= b) return;
    const text = s.slice(a, b);
    // need at least one real letter/digit (an already-isolated object alone is not re-wrapped)
    let real = false;
    for (const ch of text) { if (isAnchorChar(ch)) { real = true; break; } }
    if (!real) return;
    // "Newton's Second Law: F = ma" -> two runs (term, then formula), as a human writes it in Urdu:
    // split at ': ' / '; ' when the right side is a formula with '=' and the left side is not.
    const m = /[:;]\s+/.exec(text);
    if (m) {
      const left = text.slice(0, m.index), right = text.slice(m.index + m[0].length);
      if (right.includes('=') && isFormula(right) && !left.includes('=') && /\p{L}/u.test(left)) {
        pushRuns(s, a, a + m.index, runs);
        pushRuns(s, a + m.index + m[0].length, b, runs);
        return;
      }
    }
    // "SI unit m/s²", "Momentum p = mv" -> term + formula/unit as two runs (again the human reading
    // order in an Urdu sentence). Only when the left part is plain words and the right part is a short
    // formula/unit (not a URL, no long English words).
    const ws = /\s+/g;
    let w;
    while ((w = ws.exec(text))) {
      const left = text.slice(0, w.index), right = text.slice(w.index + w[0].length);
      if (!/^\p{L}[\p{L}'\u2019\- ]*$/u.test(left)) break;
      if (!/^[\p{L}\p{Nd}]/u.test(right) || !MATH_RE.test(right)) continue;
      if (/:\/\/|www\.|@/.test(right) || /(^|\s)\p{L}{4,}(?=\s|$)/u.test(right)) continue;
      const toks = right.split(/\s+/);
      if (MATH_RE.test(toks[0]) || (toks[0].length <= 2 && toks[1] && /^[=<>\u2264\u2265\u2248\u2260]/.test(toks[1]))) {
        pushRuns(s, a, a + w.index, runs);
        pushRuns(s, a + w.index + w[0].length, b, runs);
        return;
      }
    }
    runs.push({ start: a, end: b, text, formula: isFormula(text) });
  }
  const MATH_RE = /[=\/\u00B2\u00B3\u00B9\u2070-\u209F\u00D7\u00F7\u00B1\u221A\u2220]/;

  /** Short run that looks like a formula / number+unit -> should not wrap across lines. */
  function isFormula(t) {
    if (t.length > 48) return false;
    return /[=+\u00D7\u00F7\u00B1\u2248\u2260\u2264\u2265<>^\u221A\u2220\u2211\u222B\u2212]/.test(t) ||
      SUPER_SUB_RE.test(t) || /\d\s*[a-zA-Z\u00B5\u03A9\u00B0%]/.test(t) || /\d[.,]\d/.test(t);
  }

  /** Fix one line of plain text: RLM + FSI…PDI around every LTR run. Idempotent. */
  function fixLine(line) {
    const s = stripBidiControls(line);
    if (!hasArabicScript(s)) return line;           // nothing RTL here — leave the line alone
    if (analyzeDirection(s).dir !== 'rtl') return line; // an English line that quotes an Urdu word
    const runs = findLtrRuns(s);
    let out = RLM, pos = 0;
    for (const r of runs) {
      out += s.slice(pos, r.start) + FSI + r.text + PDI;
      pos = r.end;
    }
    return out + s.slice(pos);
  }

  /** Fix a whole (multi-line) plain-text string for WhatsApp / Word / Notes / SMS. */
  function fixText(text) {
    if (text == null) return '';
    return String(text).split(/(\r\n|\n|\r|\u2028|\u2029)/).map((part, idx) =>
      (idx % 2 === 1) ? part : fixLine(part)).join('');
  }

  /** Check every line has balanced FSI/LRI/RLI … PDI. */
  function isolatesBalanced(text) {
    return String(text).split(/\r\n|\n|\r|\u2028|\u2029/).every(line => {
      let depth = 0;
      for (const ch of line) {
        if (ch === FSI || ch === LRI || ch === RLI) depth++;
        else if (ch === PDI) { depth--; if (depth < 0) return false; }
      }
      return depth === 0;
    });
  }

  return {
    FSI, PDI, RLM, LRM, LRI, RLI, OBJ_ISOLATED, OBJ_NEUTRAL,
    hasArabicScript, looksUrdu, stripBidiControls, analyzeDirection,
    findLtrRuns, isFormula, fixLine, fixText, isolatesBalanced,
    _internal: { cpIsStop, cpIsRtlBlock, trimRun }
  };
});
