# Urdu RTL Fixer (Chrome / Edge, Manifest V3)

Fixes the display order of right-to-left text (Urdu, Arabic, Persian, Pashto, Sindhi) mixed with English terms,
numbers and formulas, by **isolating every left-to-right run** (never by padding with spaces):

* **Web pages** (`content.js`): blocks with Arabic-script text whose first strong letter is RTL (or that have at least
  as many RTL words as LTR runs) get `dir="rtl"`; every Latin/number/formula run inside them is wrapped in
  `<bdi dir="ltr" data-urf-run>`. TreeWalker + debounced MutationObserver (350 ms, max 1.5 s) for dynamic sites.
  Skips input, textarea, contenteditable, code/pre/kbd/samp, script/style, svg/math and already-processed nodes.
  Idempotent; turning a site off restores the original DOM.
* **Plain text** (popup "Fix & Copy", right-click "Copy fixed for WhatsApp/Word"): RLM U+200F at the start of each
  RTL line and FSI U+2068 … PDI U+2069 around each LTR run. Idempotent (existing bidi controls are stripped first).
* **Nastaliq** (optional): bundled Noto Nastaliq Urdu 3.009 (SIL OFL 1.1, `fonts/OFL.txt`), `line-height: 2`,
  applied to Urdu blocks only, restricted to Arabic-script code points via `unicode-range`.

Files: `bidi.js` (shared core, no DOM), `content.js`/`content.css`, `popup.*`, `background.js` (context menu),
`offscreen.*` (clipboard for the service worker), `manifest.json`, `icons/`, `fonts/`.

Tests (not needed at runtime):

```
node --test test/             # unit tests incl. all lines of test/fixtures/content.py
python3 test/make_pages.py    # regenerate test pages
python3 test/e2e_test.py      # headless Chrome end-to-end + screenshots/ (pip install playwright pillow)
```

Install: see `INSTALL.md` (Roman Urdu).
