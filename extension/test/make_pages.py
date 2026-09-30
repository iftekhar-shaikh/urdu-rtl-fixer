"""Generate the e2e test pages (no bdi / no isolates anywhere in test-page.html)."""
import re, html, pathlib, runpy
HERE = pathlib.Path(__file__).parent
content = runpy.run_path(str(HERE / "fixtures" / "content.py"))
MARK = re.compile(r"\[\[(.+?)\]\]|\{\{(.+?)\}\}")
raw = lambda s: MARK.sub(lambda m: m.group(1) or m.group(2), s)
def marked_html(s):
    out, last = [], 0
    for m in MARK.finditer(s):
        out.append(html.escape(s[last:m.start()]))
        if m.group(1): out.append(f'<bdi dir="ltr">{html.escape(m.group(1))}</bdi>')
        else: out.append(f'<bdi dir="ltr" class="f">{html.escape(m.group(2))}</bdi>')
        last = m.end()
    out.append(html.escape(s[last:])); return "".join(out)

lines = [content["TITLE"]] + [l for _, ls in content["SECTIONS"] for l in ls]

STYLE = """<style>
 body{font-family:"Noto Naskh Arabic","DejaVu Sans",Arial,sans-serif;font-size:19px;line-height:1.7;width:960px;margin:16px auto;color:#111}
 h1{font-size:22px;margin:4px 0 10px} .case{border:1px solid #ccd;border-radius:6px;padding:4px 12px;margin:8px 0;background:#fcfcff}
 .tag{font:11px/1.2 monospace;color:#789;display:block;text-align:left;direction:ltr}
 .msg{display:inline-block;max-width:600px;background:#dcf8c6;border-radius:8px;padding:4px 10px}
 input,textarea{font:16px "Noto Naskh Arabic",sans-serif;width:600px} textarea{height:44px}
 td,th{border:1px solid #ccd;padding:2px 8px} .f{white-space:nowrap}
</style>"""

cases = [
 ("recipe example (p)", "<p>نیوٹن کا دوسرا قانون Newton's Second Law: F = ma۔</p>"),
 ("units + superscript", "<p>زمین پر g = 9.8 m/s² ہوتا ہے، اور چارج +1.6 × 10⁻¹⁹ C ہے۔</p>"),
 ("line starts with English", "<p>Physics فزکس سائنس کی وہ شاخ ہے جو مادّے اور توانائی کا مطالعہ کرتی ہے۔</p>"),
 ("parentheses + two adjacent terms", "<p>بدلتا ہوا Magnetic Field کرنٹ پیدا کرتا ہے (Faraday's Law)، اسے Electromagnetic Induction کہتے ہیں۔</p>"),
 ("formula split across inline tags", "<p>قانون کے مطابق <b>F</b> = <i>ma</i> ہوتا ہے، اور <b>E = mc²</b> بھی۔</p>"),
 ("chat bubble (WhatsApp-like spans)", '<div class="msg"><span class="copyable-text"><span>کل 10:30 AM پر Zoom meeting ہے، link: https://example.com/j/123 ہے۔</span></span></div>'),
 ("list + table", "<ul><li>پہلا نکتہ: V = IR (Ohm's Law)۔</li><li>دوسرا نکتہ: 1/R = 1/R₁ + 1/R₂۔</li></ul>"
                  "<table><tr><th>مقدار</th><td>رفتار Speed کی اکائی m/s ہے۔</td></tr></table>"),
 ("English paragraph with one Urdu word (stays LTR)", "<p>This paragraph is English and mentions پاکستان only once, so it stays left-to-right.</p>"),
 ("must stay untouched: input / textarea / contenteditable / pre / code",
  '<input id="inp" value="ان پٹ میں F = ma ہے۔"><br><textarea id="ta">ٹیکسٹ ایریا میں V = IR ہے۔</textarea>'
  '<div id="ce" contenteditable="true">ایڈیٹر میں P = VI ہے۔</div>'
  '<pre id="pre">کوڈ بلاک: x = 10 ہے۔</pre><p>انلائن کوڈ <code id="code">npm install ہے</code> دیکھیں۔</p>'),
]
body = "".join(f'<div class="case"><span class="tag">{html.escape(t)}</span>{h}</div>' for t, h in cases)
body += '<div class="case" id="dyn"><span class="tag">dynamic content (added by JS after load, streamed token by token)</span></div>'
body += '<h1>Physics sample (content.py, markup removed)</h1>' + "".join(f"<p class='phys'>{html.escape(raw(l))}</p>" for l in lines[:12])
SCRIPT = """<script>
setTimeout(() => {
  const d = document.getElementById('dyn');
  const p = document.createElement('p'); p.id = 'dynp';
  p.textContent = 'یہ پیراگراف بعد میں آیا: Momentum p = mv ہے، اکائی kg·m/s ہے۔';
  d.appendChild(p);
  const s = document.createElement('p'); s.id = 'stream'; d.appendChild(s);
  const tokens = ['روشنی ', 'کی ', 'رفتار ', 'c = ', '3 × 10⁸ ', 'm/s ', 'ہے۔'];
  let i = 0; const t = setInterval(() => { s.textContent += tokens[i++]; if (i >= tokens.length) clearInterval(t); }, 60);
}, 300);
</script>"""
(HERE / "test-page.html").write_text(f'<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Urdu RTL Fixer test page</title>{STYLE}</head>'
    f'<body><h1>Mixed Urdu/English test page — no bdi, no dir, no isolates</h1>{body}{SCRIPT}</body></html>', encoding="utf-8")

# Visual reference: every content.py line on a wide page, raw vs. hand-marked (recipe) versions
WIDE = STYLE.replace("width:960px", "width:1500px")
(HERE / "phys-raw.html").write_text('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' + WIDE + '</head><body>' +
    "".join(f"<p id='l{i}'>{html.escape(raw(l))}</p>" for i, l in enumerate(lines)) + "</body></html>", encoding="utf-8")
(HERE / "phys-ref.html").write_text('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' + WIDE + '</head><body>' +
    "".join(f"<p id='l{i}' dir='rtl'>{marked_html(l)}</p>" for i, l in enumerate(lines)) + "</body></html>", encoding="utf-8")
assert "<bdi" not in (HERE / "test-page.html").read_text()
print("pages written;", len(lines), "physics lines")
