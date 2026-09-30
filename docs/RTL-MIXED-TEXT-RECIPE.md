# Recipe: RTL text (Urdu / Arabic / Persian / Pashto / Sindhi) mixed with English

**The problem:** the Unicode Bidirectional Algorithm (UBA) decides the order of text on screen. Numbers,
spaces, `= + − / ( ) . ,` and similar characters are *weak or neutral*, so they take their direction from
whatever is next to them. Inside an RTL paragraph this is why `F = ma` can show up as `ma = F`,
`9.8 m/s²` can split apart, a trailing `.` or `)` can jump to the wrong end, and two English terms next to
each other can swap places. **The fix is to isolate every LTR run** so the algorithm treats it as one
unbreakable block.

## 1. HTML

```html
<!DOCTYPE html>
<html lang="ur" dir="rtl">            <!-- lang: ur | ar | fa | ps | sd -->
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;700&display=swap" rel="stylesheet">
<style>
  body { font-family: "Noto Nastaliq Urdu", "Jameel Noori Nastaleeq", serif; line-height: 2.2; }
  bdi  { unicode-bidi: isolate; font-family: "Noto Serif", "Times New Roman", serif; }   /* Latin runs */
  .f   { direction: ltr; white-space: nowrap; font-family: "DejaVu Sans", Arial, sans-serif; } /* formulas */
</style>
</head>
<body>
<p>نیوٹن کا دوسرا قانون <bdi dir="ltr">Newton's Second Law</bdi>: <bdi dir="ltr" class="f">F = ma</bdi>۔</p>
<p>زمین پر <bdi dir="ltr" class="f">g = 9.8 m/s²</bdi> ہوتا ہے۔</p>
</body></html>
```

Rules:
- Put `dir="rtl"` and `lang` on `<html>` (or on the container), not just `text-align:right`. Alignment is not direction.
- Wrap **every** English word or phrase, number with a unit, formula, URL, code snippet, and
  English text in parentheses in `<bdi dir="ltr">…</bdi>`. `<span dir="ltr">` also works, because `dir` on an
  inline element isolates in modern browsers. `<bdi>` isolates everywhere and states what you mean.
- Use `<bdi>` with no `dir` (auto) for user-generated or unknown-direction strings, like names or usernames.
- Leave RTL punctuation (`۔ ، ؛ ؟`) **outside** the isolate. Keep LTR punctuation inside it.
- Use `white-space: nowrap` on formulas so a line break can't split them.
- Fonts: Urdu → Noto Nastaliq Urdu / Jameel Noori Nastaleeq. Arabic/Sindhi/Pashto → Noto Naskh Arabic, Amiri,
  Scheherazade New. Persian → Vazirmatn. Nastaliq is tall and needs `line-height` of about 2–2.4, or glyphs will collide.
- Pick one digit system and use it everywhere. Western digits `0-9` are safest inside LTR formulas.
  Eastern digits `۰-۹` also work, but don't mix the two.
- Headless PDF/PNG: call `document.fonts.ready` before capturing, and install the font locally too
  (for example `~/.fonts/NotoNastaliqUrdu.ttf` + `fc-cache -f`) so the output doesn't depend on network access.

## 2. Plain text (WhatsApp, Word, Notes, SMS, email)

Plain text has no tags, so use invisible Unicode controls:

| Char | Code | Use |
|---|---|---|
| FSI  | U+2068 | *First Strong Isolate*: opens an isolate whose direction comes from its first strong letter |
| LRI  | U+2066 | opens an isolate that is always LTR (use for formulas that start with a digit or symbol) |
| RLI  | U+2067 | opens an isolate that is always RTL |
| PDI  | U+2069 | closes the most recent isolate. **Every opener needs exactly one PDI on the same line/paragraph.** |
| RLM  | U+200F | Right-to-left mark (invisible strong RTL letter). Put it at the start of a line so apps that auto-detect direction pick RTL even when the line starts with English or a number. You can also place it after trailing neutrals so they stick to the RTL side. |
| LRM  | U+200E | Left-to-right mark. Use it the same way inside LTR context, for example after `m/s²` so the trailing `²`/`)` stays with the English. |

Pattern: `RLM + urdu … FSI English/formula PDI … urdu۔`

```python
FSI, PDI, RLM = "\u2068", "\u2069", "\u200F"
line = f"{RLM}نیوٹن کا دوسرا قانون {FSI}Newton's Second Law{PDI}: {FSI}F = ma{PDI}۔"
```

Notes: FSI defaults to LTR when the run has no letters (such as `9.8` or `+1.6 × 10⁻¹⁹`), so that's fine.
Use LRI when you want to be explicit. Older isolate-unaware software (some old Windows apps, some terminals)
may show the controls as boxes or ignore them. In that case, fall back to RLM/LRM marks around the run.
Don't mix up isolates (FSI/LRI/RLI…PDI) with the older embeddings (LRE/RLE…PDF U+202A–U+202C).
Prefer isolates.

## 3. Padding with spaces does NOT fix bidi

Adding spaces, tabs, or NBSPs around `F = ma` changes nothing. Spaces are *neutral* characters too, so the
algorithm reorders them along with the rest. The same goes for swapping word order by hand
("typing it backwards"): it breaks as soon as the text wraps, the font changes, or someone copies it.
Only directional **structure** fixes the order: `dir`/`<bdi>` in HTML, or isolates/marks in plain text.

## 4. Verify by rendering (checklist)

Don't trust the source view. Render the output and look at it:

- [ ] Render the HTML with headless Chromium (Playwright: `page.goto(file://…)`, `document.fonts.ready`,
      `page.screenshot(full_page=True)`, `page.pdf()`), then **look at the images at full resolution**
      (crop, don't just view a thumbnail).
- [ ] Check that the target font actually loaded (`document.fonts.check('16px "Noto Nastaliq Urdu"')`),
      and in the PDF check `pdffonts` for the Nastaliq font.
- [ ] Each line starts on the **right**; line numbers and the `۔` full stop sit at the correct (right / left) ends.
- [ ] Multi-word English terms stay whole and in the correct left-to-right order (`Law of Conservation of Energy`).
- [ ] Formulas aren't mirrored or reordered: `F = ma`, `V = IR`, `v = fλ`, `1/R = 1/R₁ + 1/R₂`,
      `+1.6 × 10⁻¹⁹ C`. Signs stay on the correct side of numbers, and units stay attached (`9.8 m/s²`).
- [ ] When two English runs sit next to each other in one sentence, the first (in logical order) appears to the **right**.
- [ ] Parentheses wrap the correct content, e.g. `(Faraday's Law)`, `(K-2/K-3)`, and aren't flipped to `)…(`.
- [ ] Wrapped lines: a formula never breaks across lines, and a wrapped Urdu line continues on the right.
- [ ] Superscripts and subscripts, Greek letters (λ, Ω, α, β, γ), and symbols (∠, Δ, °) have glyphs (no tofu boxes).
- [ ] Plain text: count FSI == PDI on every line, then render the .txt as plain `<p dir="auto">` lines
      (no markup) to confirm the controls alone fix the order. Also test-paste into the real target app (WhatsApp/Word).
- [ ] Digits: one system (Western or Eastern) used consistently.
