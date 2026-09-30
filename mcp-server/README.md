# urdu-rtl-fixer (MCP server)

A local **stdio** MCP server that fixes the display order of right-to-left text (Urdu, Arabic, Persian…) that contains
English words, numbers, units or formulas. It follows [`docs/RTL-MIXED-TEXT-RECIPE.md`](../docs/RTL-MIXED-TEXT-RECIPE.md): it isolates
every left-to-right run.

- Plain text: an RLM (U+200F) at the start of each RTL line, and FSI (U+2068) … PDI (U+2069) around each LTR run.
- HTML: `<bdi dir="ltr">…</bdi>` around each LTR run. Formulas get `class="f"`, which the full-document CSS sets to `nowrap`.

The bidi logic lives in `lib/bidi.cjs`, a byte-identical copy of the Chrome extension's [`extension/bidi.js`](../extension/bidi.js)
(the test checks this). If you change the extension, copy the file again.
The server makes no network calls and uses no secrets. It writes only to stdout, which carries MCP, and stderr, which carries one startup log line.

## Launch

```
command: node
args:    ["/absolute/path/to/urdu-rtl-fixer/mcp-server/server.js"]
```

Requires Node ≥ 18. Run `npm install` in `mcp-server/` first to install the dependencies (`@modelcontextprotocol/sdk`, `zod`).

## Tools

| Tool | Input | Output |
|---|---|---|
| `fix_plain_text` | `text` | Fixed text with RLM, FSI and PDI added, for WhatsApp, Word, SMS or email. Idempotent. English-only lines are left as they are. |
| `fix_html` | `html` **or** `text`, `full_document?`, `lang?` (default `ur`), `title?`, `webfont?` (default true) | The HTML with `<bdi dir="ltr">` inserted. Existing tags, attributes, comments, `script`, `style`, `pre`, `code` and existing `<bdi dir="ltr">` are left alone. With `full_document`, you get a complete `<html lang="ur" dir="rtl">` page with the Nastaliq font stack and `line-height: 2.2`. |
| `render_preview` | `text` **or** `html`, `out_path?`, `fix?` (true), `compare?` (false), `width?` (900), `include_image?` (false) | The path of a PNG rendered with headless Chrome. Plain text is shown as bare `<p dir="auto">` lines, so the invisible marks alone set the order. `compare` shows the input before and after the fix. Returns `isError` with a clear message if it can't render. |
| `check_text` | `text` | JSON with `rtl_detected`, `direction`, `isolates_balanced`, `unbalanced_lines`, the count of each control character, `ltr_runs` (each with `isolated`), and `already_fixed`. |
| `strip_marks` | `text` | The text with LRM, RLM, ALM, U+202A–202E and U+2066–2069 removed. This undoes `fix_plain_text`. |

## Rendering

`render_preview.py` runs with `python3` (needs `pip install playwright`) and `/usr/bin/google-chrome`. It blocks every
request that isn't `file:`, and it uses a local Noto Nastaliq Urdu font (`~/.fonts/NotoNastaliqUrdu.ttf` if present, otherwise the copy in `../extension/fonts/`). PNGs go to
`previews/` by default.

You can override these with environment variables: `URF_PYTHON`, `URF_CHROME`, `URF_PREVIEW_DIR`, `URF_NASTALIQ_TTF`.

## Test

```
cd mcp-server && npm install && npm test     # = node test/client-test.mjs
```

The test starts the server over stdio with the SDK client, lists the tools, and calls each one. It uses the Newton sample
line and five lines from `extension/test/fixtures/content.py`, and writes `previews/test-plain-text.png` and `previews/test-html.png`.

## Notes and limits

- The HTML fixer is a lightweight tokenizer, not a full HTML5 parser. It only ever inserts `<bdi>` tags.
  If a run crosses inline tags, it wraps the whole span when the markup is balanced (for example `<b>Newton's</b> Second Law`).
  Otherwise it wraps each text piece separately.
- A block is only changed when it reads right-to-left. `fix_html` does not add `dir` attributes to blocks. In a
  `full_document`, an English-only paragraph inherits `dir="rtl"`, so add `dir="ltr"` to it yourself if you need to.
- Older software that doesn't understand isolates may show FSI and PDI as boxes. See §2 of the recipe.
