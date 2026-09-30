// End-to-end test: speaks MCP over stdio to server.js using the official SDK client.
// Run: node test/client-test.mjs   (writes previews/test-*.png)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FSI = '\u2068', PDI = '\u2069', RLM = '\u200F';
const SAMPLE = "نیوٹن کا دوسرا قانون Newton's Second Law کہتا ہے کہ F = ma، اور زمین پر g = 9.8 m/s² ہوتا ہے۔";

// a few lines from extension/test/fixtures/content.py with the [[ ]] / {{ }} markers removed (i.e. raw, unfixed text)
const src = readFileSync(path.join(ROOT, '..', 'extension', 'test', 'fixtures', 'content.py'), 'utf8');
const all = [...src.matchAll(/^"(.+)",$/gm)].map(m => m[1].replace(/\[\[|\]\]|\{\{|\}\}/g, ''));
const pick = (re) => all.find(l => re.test(l));
const CONTENT = [pick(/6\.4 × 10⁶ m/), pick(/kilo \(k\)/), pick(/\+1\.6 × 10⁻¹⁹ C/), pick(/E = mc²/), pick(/Alpha \(α\)/)].filter(Boolean);
assert.equal(CONTENT.length, 5, 'expected 5 lines from content.py');
const TEXT = [SAMPLE, ...CONTENT].join('\n');

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };
const body = (r) => r.content.filter(c => c.type === 'text').map(c => c.text).join('');

const transport = new StdioClientTransport({ command: 'node', args: [path.join(ROOT, 'server.js')], env: { ...process.env }, stderr: 'pipe' });
const client = new Client({ name: 'urdu-rtl-fixer-test', version: '1.0.0' });
await client.connect(transport);
console.log('connected:', client.getServerVersion());

// --- tools/list
const { tools } = await client.listTools();
console.log('tools:', tools.map(t => t.name).join(', '));
ok('lists exactly the 5 tools with descriptions + schemas', () => {
  assert.deepEqual(tools.map(t => t.name).sort(), ['check_text', 'fix_html', 'fix_plain_text', 'render_preview', 'strip_marks']);
  for (const t of tools) { assert.ok(t.description.length > 60, t.name); assert.equal(t.inputSchema.type, 'object'); }
});

// --- fix_plain_text
const fixed = body(await client.callTool({ name: 'fix_plain_text', arguments: { text: TEXT } }));
const fixedLines = fixed.split('\n');
ok('fix_plain_text: exact expected output for the sample line', () => {
  assert.equal(fixedLines[0], `${RLM}نیوٹن کا دوسرا قانون ${FSI}Newton's Second Law${PDI} کہتا ہے کہ ${FSI}F = ma${PDI}، اور زمین پر ${FSI}g = 9.8 m/s²${PDI} ہوتا ہے۔`);
});
ok('fix_plain_text: every line starts with RLM and FSI == PDI per line', () => {
  for (const l of fixedLines) { assert.equal(l[0], RLM); assert.equal(l.split(FSI).length, l.split(PDI).length); }
});
ok('fix_plain_text: content.py formulas isolated whole', () => {
  for (const f of ['6.4 × 10⁶ m', '+1.6 × 10⁻¹⁹ C', '−1.6 × 10⁻¹⁹ C', 'E = mc²', 'kilo (k) = 10³', 'Alpha (α)', '(K-2/K-3)'])
    assert.ok(fixed.includes(FSI + f + PDI), f);
});
const fixed2 = body(await client.callTool({ name: 'fix_plain_text', arguments: { text: fixed } }));
ok('fix_plain_text: idempotent', () => assert.equal(fixed2, fixed));
const eng = body(await client.callTool({ name: 'fix_plain_text', arguments: { text: 'Plain English, F = ma.' } }));
ok('fix_plain_text: English-only line untouched', () => assert.equal(eng, 'Plain English, F = ma.'));

// --- strip_marks
const stripped = body(await client.callTool({ name: 'strip_marks', arguments: { text: fixed } }));
ok('strip_marks: restores the original text exactly', () => assert.equal(stripped, TEXT));

// --- check_text
const chkRaw = JSON.parse(body(await client.callTool({ name: 'check_text', arguments: { text: SAMPLE } })));
const chkFixed = JSON.parse(body(await client.callTool({ name: 'check_text', arguments: { text: fixedLines[0] } })));
const chkBad = JSON.parse(body(await client.callTool({ name: 'check_text', arguments: { text: `اردو ${FSI}F = ma ہے\n${PDI}x` } })));
console.log('  check_text(raw sample) ->', JSON.stringify({ rtl: chkRaw.rtl_detected, dir: chkRaw.direction, balanced: chkRaw.isolates_balanced, runs: chkRaw.ltr_runs.map(r => r.text), already_fixed: chkRaw.already_fixed }));
ok('check_text: raw sample -> RTL, balanced, 3 runs, not isolated', () => {
  assert.equal(chkRaw.rtl_detected, true); assert.equal(chkRaw.direction, 'rtl'); assert.equal(chkRaw.isolates_balanced, true);
  assert.deepEqual(chkRaw.ltr_runs.map(r => r.text), ["Newton's Second Law", 'F = ma', 'g = 9.8 m/s²']);
  assert.ok(chkRaw.ltr_runs.every(r => !r.isolated)); assert.equal(chkRaw.already_fixed, false);
});
ok('check_text: fixed sample -> all runs isolated, counts 3/3, already_fixed', () => {
  assert.ok(chkFixed.ltr_runs.every(r => r.isolated)); assert.equal(chkFixed.counts.FSI, 3); assert.equal(chkFixed.counts.PDI, 3);
  assert.equal(chkFixed.counts.RLM, 1); assert.equal(chkFixed.already_fixed, true);
});
ok('check_text: isolate split across lines -> unbalanced lines [1,2]', () => {
  assert.equal(chkBad.isolates_balanced, false); assert.deepEqual(chkBad.unbalanced_lines, [1, 2]);
});

// --- fix_html
const htmlIn = `<p class="lead" title="F = ma اردو">${SAMPLE}</p>\n<p>قانون <b>Newton's</b> Second Law، دیکھیں <a href="https://example.com/x?a=1&amp;b=2">یہ لنک</a> اور <code>x = 1</code>۔</p>\n<script>const s = "اردو F = ma";</script>\n<p>An English paragraph with one لفظ only.</p>`;
const htmlOut = body(await client.callTool({ name: 'fix_html', arguments: { html: htmlIn } }));
console.log('  fix_html ->\n' + htmlOut.split('\n').map(l => '     ' + l).join('\n'));
ok('fix_html: sample runs wrapped in <bdi dir="ltr">, formulas class="f"', () => {
  assert.ok(htmlOut.includes(`<bdi dir="ltr">Newton's Second Law</bdi> کہتا`));
  assert.ok(htmlOut.includes(`<bdi dir="ltr" class="f">F = ma</bdi>،`));
  assert.ok(htmlOut.includes(`<bdi dir="ltr" class="f">g = 9.8 m/s²</bdi> ہوتا ہے۔`));
});
ok('fix_html: tags/attributes/script/code untouched; only <bdi> inserted', () => {
  assert.equal(htmlOut.replace(/<bdi dir="ltr"(?: class="f")?>|<\/bdi>/g, ''), htmlIn);
  assert.ok(htmlOut.includes('<bdi dir="ltr"><b>Newton\'s</b> Second Law</bdi>'), 'run across an inline tag kept whole');
  assert.ok(htmlOut.includes('<p>An English paragraph with one لفظ only.</p>'), 'LTR paragraph untouched');
});
const htmlOut2 = body(await client.callTool({ name: 'fix_html', arguments: { html: htmlOut } }));
ok('fix_html: idempotent', () => assert.equal(htmlOut2, htmlOut));
const doc = body(await client.callTool({ name: 'fix_html', arguments: { text: TEXT, full_document: true, title: 'test' } }));
ok('fix_html(text, full_document): complete RTL page, Nastaliq stack, line-height 2.2', () => {
  assert.ok(doc.startsWith('<!DOCTYPE html>')); assert.ok(doc.includes('<html lang="ur" dir="rtl">'));
  assert.ok(doc.includes('"Noto Nastaliq Urdu", "Jameel Noori Nastaleeq"')); assert.ok(doc.includes('line-height: 2.2'));
  assert.equal((doc.match(/<p>/g) || []).length, 6); assert.ok(doc.includes('<bdi dir="ltr" class="f">E = mc²</bdi>'));
});
const bad = await client.callTool({ name: 'fix_html', arguments: {} });
ok('fix_html: missing input -> isError', () => assert.equal(bad.isError, true));

// --- render_preview
const outText = path.join(ROOT, 'previews', 'test-plain-text.png');
const outHtml = path.join(ROOT, 'previews', 'test-html.png');
const r1 = await client.callTool({ name: 'render_preview', arguments: { text: TEXT, compare: true, out_path: outText } });
console.log('  render_preview(text) ->', body(r1).replace(/\n/g, ' | '));
const r2 = await client.callTool({ name: 'render_preview', arguments: { html: htmlIn + '\n' + textToP(CONTENT), compare: true, out_path: outHtml, include_image: true } });
console.log('  render_preview(html) ->', body(r2).replace(/\n/g, ' | '));
ok('render_preview: PNGs written, Nastaliq loaded, inline image returned', () => {
  for (const [r, p] of [[r1, outText], [r2, outHtml]]) {
    assert.ok(!r.isError, body(r)); assert.ok(existsSync(p) && statSync(p).size > 10000, p);
    assert.ok(body(r).includes('Noto Nastaliq Urdu loaded: true'));
  }
  assert.ok(r2.content.some(c => c.type === 'image' && c.mimeType === 'image/png' && c.data.length > 1000));
});
const r3 = await client.callTool({ name: 'render_preview', arguments: { text: 'x', out_path: '/tmp/x.jpg' } });
ok('render_preview: bad out_path -> clear isError', () => assert.equal(r3.isError, true));

// --- vendored bidi core is identical to the extension's
ok('lib/bidi.cjs identical to ../extension/bidi.js', () => {
  const h = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
  assert.equal(h(path.join(ROOT, 'lib/bidi.cjs')), h(path.join(ROOT, '..', 'extension', 'bidi.js')));
});

await client.close();
console.log(`\nALL ${passed} CHECKS PASSED`);

function textToP(lines) { return lines.map(l => `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('\n'); }
