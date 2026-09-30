#!/usr/bin/env python3
"""Render a local HTML file to PNG with headless Chrome via Playwright (offline).
Usage: render_preview.py <html_path> <out_png> [width] [scale]
Prints one JSON line: {"ok":..., "out":..., "width":..., "height":..., "nastaliq_loaded":..., "error":...}
All non-file: requests are aborted, so rendering never touches the network."""
import json, os, sys

def main():
    html, out = sys.argv[1], sys.argv[2]
    width = int(sys.argv[3]) if len(sys.argv) > 3 else 900
    scale = float(sys.argv[4]) if len(sys.argv) > 4 else 1.5
    chrome = os.environ.get("URF_CHROME", "/usr/bin/google-chrome")
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"playwright not importable: {e}"})); return 2
    if not os.path.exists(chrome):
        print(json.dumps({"ok": False, "error": f"Chrome not found at {chrome} (set URF_CHROME)"})); return 2
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path=chrome, headless=True, args=["--no-sandbox"])
            pg = b.new_page(viewport={"width": width, "height": 400}, device_scale_factor=scale)
            pg.route("**/*", lambda r: r.continue_() if r.request.url.startswith(("file:", "data:", "about:")) else r.abort())
            pg.goto("file://" + os.path.abspath(html), wait_until="load", timeout=30000)
            pg.evaluate("document.fonts.ready")
            loaded = pg.evaluate("""async () => {
                const f = await document.fonts.load('20px "Noto Nastaliq Urdu"', 'اردو');
                return f.length > 0 && document.fonts.check('20px "Noto Nastaliq Urdu"', 'اردو');
            }""")
            pg.evaluate("document.fonts.ready")
            os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
            pg.screenshot(path=out, full_page=True)
            h = pg.evaluate("document.documentElement.scrollHeight")
            b.close()
        print(json.dumps({"ok": True, "out": os.path.abspath(out), "width": width, "height": h,
                          "scale": scale, "nastaliq_loaded": bool(loaded)}))
        return 0
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"})); return 1

if __name__ == "__main__":
    sys.exit(main())
