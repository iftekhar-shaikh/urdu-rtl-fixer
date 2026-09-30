// Unit tests for bidi.js — run with:  node --test test/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../bidi.js');
const { FSI, PDI, RLM } = B;

const runsOf = (s) => B.findLtrRuns(s).map(r => r.text);
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

test('recipe example becomes exactly the recipe pattern', () => {
  const src = "نیوٹن کا دوسرا قانون Newton's Second Law: F = ma۔";
  assert.equal(B.fixText(src), `${RLM}نیوٹن کا دوسرا قانون ${FSI}Newton's Second Law${PDI}: ${FSI}F = ma${PDI}۔`);
});

test('units, signs, superscripts and parentheses stay inside one run', () => {
  assert.deepEqual(runsOf('زمین پر g = 9.8 m/s² ہوتا ہے۔'), ['g = 9.8 m/s²']);
  assert.deepEqual(runsOf('چارج +1.6 × 10⁻¹⁹ C اور −1.6 × 10⁻¹⁹ C ہے۔'), ['+1.6 × 10⁻¹⁹ C', '−1.6 × 10⁻¹⁹ C']);
  assert.deepEqual(runsOf('میٹر (m)، کلوگرام (kg)'), ['(m)', '(kg)']);
  assert.deepEqual(runsOf('کراچی (K-2/K-3) کے'), ['(K-2/K-3)']);
  assert.deepEqual(runsOf('فارمولا {{x}} ہے'), ['{{x}}']);
});

test('term followed by a unit/formula becomes two runs; formulas/URLs/sentences stay whole', () => {
  assert.deepEqual(runsOf('Acceleration کی SI unit m/s² ہے۔'), ['Acceleration', 'SI unit', 'm/s²']);
  assert.deepEqual(runsOf('یہ Momentum p = mv ہے'), ['Momentum', 'p = mv']);
  assert.deepEqual(runsOf('مثلاً kilo (k) = 10³ اور'), ['kilo (k) = 10³']);
  assert.deepEqual(runsOf('یہ Efficiency = (Output / Input) × 100% ہے'), ['Efficiency = (Output / Input) × 100%']);
  assert.deepEqual(runsOf('دیکھیں visit https://x.com پر'), ['visit https://x.com']);
  assert.deepEqual(runsOf('کریں use a/b testing ضرور'), ['use a/b testing']);
  assert.deepEqual(runsOf('کل Zoom meeting 10:30 AM ہے'), ['Zoom meeting 10:30 AM']);
  assert.equal(B.fixText('Acceleration کی SI unit m/s² ہے۔')[0], RLM, 'still detected as an RTL line');
});

test('unbalanced brackets and sentence punctuation stay outside', () => {
  assert.deepEqual(runsOf('(f میٹر میں)'), ['f']);
  assert.deepEqual(runsOf('یہ Hello, world. ہے'), ['Hello, world']);
  assert.deepEqual(runsOf('سوال: What is this? جواب'), ['What is this']);
});

test('Arabic punctuation (، ؛ ؟ ۔) is never inside a run and separates runs', () => {
  assert.deepEqual(runsOf('vf = vi + at، S = vi·t + ½at² اور 2aS = vf² − vi²۔'),
    ['vf = vi + at', 'S = vi·t + ½at²', '2aS = vf² − vi²']);
  for (const r of B.findLtrRuns('A؛ B؟ C۔ D، E')) assert.ok(!ARABIC.test(r.text));
});

test('URLs, emails, emoji, astral math letters, Eastern digits', () => {
  assert.deepEqual(runsOf('ویب سائٹ https://example.com/a?b=1 دیکھیں'), ['https://example.com/a?b=1']);
  assert.deepEqual(runsOf('ای میل me@example.org پر'), ['me@example.org']);
  assert.deepEqual(runsOf('بہت اچھا 😀 Great job 👍 شکریہ'), ['Great job']);
  assert.deepEqual(runsOf('مساوات 𝑥 = 𝑦 ہے'), ['𝑥 = 𝑦']);
  assert.deepEqual(runsOf('سال ۲۰۲۶ میں'), []); // Eastern digits are left to the RTL context
});

test('direction analysis', () => {
  assert.equal(B.analyzeDirection('فزکس Physics').dir, 'rtl');
  assert.equal(B.analyzeDirection('Physics فزکس کی وہ شاخ ہے').dir, 'rtl');     // starts English, mostly Urdu
  assert.equal(B.analyzeDirection('This English sentence has one لفظ only').dir, 'ltr');
  assert.equal(B.analyzeDirection('123 ...').dir, null);
});

test('fixText: lines, RLM, untouched English lines, CRLF, idempotent, reversible', () => {
  const src = 'Physics فزکس کی F = ma ہے۔\r\nplain English line\n\nدوسری سطر 100 نکات';
  const out = B.fixText(src);
  const lines = out.split(/\r\n|\n/);
  assert.equal(lines[0], `${RLM}${FSI}Physics${PDI} فزکس کی ${FSI}F = ma${PDI} ہے۔`);
  assert.equal(lines[1], 'plain English line');
  assert.equal(lines[2], '');
  assert.equal(lines[3], `${RLM}دوسری سطر ${FSI}100${PDI} نکات`);
  assert.ok(out.includes('\r\n'));
  assert.equal(B.fixText(out), out, 'idempotent');
  assert.equal(B.stripBidiControls(out), src, 'only invisible controls were added');
  assert.ok(B.isolatesBalanced(out));
  assert.equal(B.fixText(''), '');
  assert.equal(B.fixText(null), '');
});

test('padding with spaces is never used: only controls are added', () => {
  const src = 'قانون F = ma ہے';
  const out = B.fixText(src);
  assert.equal(out.replace(/[\u200F\u2068\u2069]/g, ''), src);
});

test('object placeholders from the DOM layer', () => {
  const iso = B.OBJ_ISOLATED, obj = B.OBJ_NEUTRAL;
  // an already-isolated run alone is not re-wrapped (idempotent DOM pass)
  assert.deepEqual(runsOf(`اردو ${iso} اردو`), []);
  // text streamed next to an already-isolated run joins it
  assert.deepEqual(runsOf(`اردو ${iso}'s Law ہے`), [`${iso}'s Law`]);
  // an inline image inside a run stays inside; at the edge it is trimmed
  assert.deepEqual(runsOf(`اردو Hello ${obj} world ${obj} اردو`), [`Hello ${obj} world`]);
});

// ---------------------------------------------------------------------------
// content.py: [[...]] = English term, {{...}} = formula — the hand-marked ground truth.
function loadContentLines() {
  const p = path.join(__dirname, 'fixtures', 'content.py');
  const src = fs.readFileSync(p, 'utf8');
  const out = [];
  for (const line of src.split('\n')) {
    if (line.trim().startsWith('#')) continue;
    for (const m of line.matchAll(/"((?:[^"\\]|\\.)*)"/g)) out.push(m[1]);
  }
  return out;
}
function parseMarked(marked) {
  let raw = '', segs = [];
  const re = /\[\[(.+?)\]\]|\{\{(.+?)\}\}/g;
  let last = 0, m;
  while ((m = re.exec(marked))) {
    raw += marked.slice(last, m.index);
    const t = m[1] ?? m[2];
    segs.push({ start: raw.length, end: raw.length + t.length, text: t, formula: m[2] != null });
    raw += t;
    last = re.lastIndex;
  }
  raw += marked.slice(last);
  return { raw, segs };
}

test('content.py sample lines: every marked English term/formula lands whole in one run', () => {
  const lines = loadContentLines();
  assert.ok(lines.length >= 100, `expected >=100 lines, got ${lines.length}`);
  let segTotal = 0, exact = 0, merged = [];
  for (const marked of lines) {
    const { raw, segs } = parseMarked(marked);
    const runs = B.findLtrRuns(raw);
    for (const r of runs) {
      assert.ok(!ARABIC.test(r.text), `run contains Arabic script: ${r.text}`);
      // every letter/digit in a run must belong to a marked segment (we never grab Urdu-side text)
      for (let k = r.start; k < r.end; k++) {
        if (/[\p{L}\p{Nd}]/u.test(raw[k])) assert.ok(segs.some(s => k >= s.start && k < s.end),
          `run "${r.text}" includes unmarked char "${raw[k]}" in: ${raw}`);
      }
    }
    for (const s of segs) {
      segTotal++;
      const host = runs.filter(r => r.start <= s.start && r.end >= s.end);
      assert.equal(host.length, 1, `segment "${s.text}" not inside exactly one run in: ${raw}\nruns: ${JSON.stringify(runs.map(r => r.text))}`);
      if (host[0].start === s.start && host[0].end === s.end) exact++;
      else if (!merged.includes(host[0].text)) merged.push(host[0].text);
    }
    const fixed = B.fixText(raw);
    assert.ok(B.isolatesBalanced(fixed));
    assert.equal(B.fixText(fixed), fixed);
    assert.equal(B.stripBidiControls(fixed), raw);
    assert.ok(fixed.startsWith(RLM));
  }
  console.log(`  content.py: ${lines.length} lines, ${segTotal} marked segments, ${exact} matched exactly, ` +
    `${segTotal - exact} inside a slightly larger run: ${JSON.stringify(merged)}`);
});
