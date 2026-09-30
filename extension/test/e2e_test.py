"""
End-to-end test: loads the unpacked extension into headless Chrome and checks it.
Run:  python3 test/e2e_test.py   (needs: pip install playwright pillow; Google Chrome)
Branded Google Chrome >= 137 ignores --load-extension, so we start Chrome with
--enable-unsafe-extension-debugging and load the folder with CDP Extensions.loadUnpacked
(the same "Load unpacked" action), then drive it with Playwright over CDP.
"""
import io, json, os, pathlib, socket, subprocess, sys, tempfile, threading, time, functools, http.server
from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops

EXT = pathlib.Path(__file__).resolve().parent.parent
TEST = EXT / "test"
SHOTS = EXT / "screenshots"
SHOTS.mkdir(exist_ok=True)
for old in SHOTS.glob("refdiff-*.png"): old.unlink()
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
results = []

def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail else ""))

def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

# serve the test pages over http (content scripts on file:// need an extra user toggle)
http_port = free_port()
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Quiet, directory=str(TEST))
srv = http.server.ThreadingHTTPServer(("127.0.0.1", http_port), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{http_port}"

cdp_port = free_port()
ud = tempfile.mkdtemp(prefix="urf-profile-")
chrome = subprocess.Popen([CHROME, "--headless=new", "--no-sandbox", f"--remote-debugging-port={cdp_port}",
    "--enable-unsafe-extension-debugging", f"--user-data-dir={ud}", "--no-first-run", "--no-default-browser-check",
    "--window-size=1100,900", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def wait_cdp():
    for _ in range(100):
        try: socket.create_connection(("127.0.0.1", cdp_port), 0.2).close(); return
        except OSError: time.sleep(0.1)
    raise SystemExit("chrome did not start")

try:
    wait_cdp()
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{cdp_port}")
        bcdp = browser.new_browser_cdp_session()
        ext_id = bcdp.send("Extensions.loadUnpacked", {"path": str(EXT)})["id"]
        check("extension loads unpacked", bool(ext_id), ext_id)
        ctx = browser.contexts[0]
        sw = None
        for _ in range(300):
            sw = next((w for w in ctx.service_workers if ext_id in w.url), None)
            if sw: break
            bcdp.send("Target.getTargets")   # pumps Playwright's event loop (time.sleep would not)
            time.sleep(0.1)
        if not sw: sys.exit("service worker not found")
        check("service worker running", sw is not None)
        set_storage = lambda obj: sw.evaluate("o => chrome.storage.sync.set(o)", obj)

        # ---------- BEFORE: extension globally off ----------
        set_storage({"enabled": False, "disabledSites": [], "nastaliq": False, "wrapRuns": True})
        page = ctx.new_page()
        page.set_viewport_size({"width": 1000, "height": 900})
        page.goto(BASE + "/test-page.html")
        page.wait_for_timeout(1200)          # let the dynamic/streamed content arrive
        page.evaluate("document.fonts.ready")
        original_html = page.evaluate("document.body.innerHTML")
        check("OFF: page has no bdi / no dir", page.evaluate("document.querySelectorAll('bdi,[dir]').length") == 0)
        page.screenshot(path=str(SHOTS / "before-extension-off.png"), full_page=True)

        # ---------- AFTER: turn it on live (storage change, no reload) ----------
        set_storage({"enabled": True})
        page.wait_for_timeout(700)
        page.evaluate("document.fonts.ready")
        page.screenshot(path=str(SHOTS / "after-extension-on.png"), full_page=True)
        stats = page.evaluate("""() => ({
            runs: document.querySelectorAll('bdi[data-urf-run]').length,
            rtlBlocks: document.querySelectorAll('[data-urf-b]').length })""")
        check("ON: runs isolated and blocks fixed", stats["runs"] > 40 and stats["rtlBlocks"] > 15, json.dumps(stats))
        p1 = page.evaluate("""() => { const p = document.querySelector('.case p');
            return { dir: p.getAttribute('dir'), runs: [...p.querySelectorAll('bdi[data-urf-run]')].map(b => b.textContent) } }""")
        check("recipe example: dir=rtl + [Newton's Second Law] [F = ma]", p1 == {"dir": "rtl", "runs": ["Newton's Second Law", "F = ma"]}, json.dumps(p1, ensure_ascii=False))
        split = page.evaluate("""() => [...document.querySelectorAll('.case')][4].querySelector('p').innerHTML""")
        check("formula split across <b>/<i> wrapped as one isolate", '<bdi dir="ltr" data-urf-run="f"><b>F</b> = <i>ma</i></bdi>' in split, split)
        chat = page.evaluate("""() => [...document.querySelectorAll('.msg bdi')].map(b => b.textContent)""")
        check("chat bubble spans processed", chat == ["10:30 AM", "Zoom meeting", "link: https://example.com/j/123"], json.dumps(chat))
        lst = page.evaluate("() => [document.querySelector('ul').getAttribute('dir'), [...document.querySelectorAll('li')].map(l => l.getAttribute('dir'))]")
        check("list items RTL -> list flipped to RTL too", lst == ["rtl", ["rtl", "rtl"]], json.dumps(lst))
        eng = page.evaluate("""() => { const p = [...document.querySelectorAll('.case')][7].querySelector('p'); return [p.getAttribute('dir'), p.querySelectorAll('bdi').length] }""")
        check("English paragraph with one Urdu word left LTR", eng == [None, 0], json.dumps(eng))
        untouched = page.evaluate("""() => ({
            inp: document.getElementById('inp').value, ta: document.getElementById('ta').value,
            ce: document.getElementById('ce').innerHTML, pre: document.getElementById('pre').innerHTML,
            code: document.getElementById('code').innerHTML,
            ceDir: document.getElementById('ce').getAttribute('dir'), preDir: document.getElementById('pre').getAttribute('dir') })""")
        check("inputs/textarea/contenteditable/pre/code untouched",
              untouched["inp"] == "ان پٹ میں F = ma ہے۔" and untouched["ta"] == "ٹیکسٹ ایریا میں V = IR ہے۔"
              and "<bdi" not in untouched["ce"] + untouched["pre"] + untouched["code"]
              and untouched["ceDir"] is None and untouched["preDir"] is None, json.dumps(untouched, ensure_ascii=False))
        dyn = page.evaluate("""() => ({ p: [...document.querySelectorAll('#dynp bdi')].map(b => b.textContent), pdir: document.getElementById('dynp').getAttribute('dir'),
                                         s: [...document.querySelectorAll('#stream bdi')].map(b => b.textContent), sdir: document.getElementById('stream').getAttribute('dir') })""")
        check("dynamic + streamed content fixed (MutationObserver)",
              dyn["pdir"] == "rtl" and dyn["p"] == ["Momentum", "p = mv", "kg·m/s"] and dyn["sdir"] == "rtl" and dyn["s"] == ["c = 3 × 10⁸ m/s"],
              json.dumps(dyn, ensure_ascii=False))

        # new content appended after the fact (MutationObserver, debounced)
        page.evaluate("""() => { const p = document.createElement('p'); p.id = 'late';
            p.textContent = 'آخری سطر: Ohm\\'s Law کے مطابق V = IR ہے۔'; document.body.appendChild(p); }""")
        page.wait_for_timeout(600)
        late = page.evaluate("() => [document.getElementById('late').getAttribute('dir'), [...document.querySelectorAll('#late bdi')].map(b => b.textContent)]")
        check("late-added paragraph fixed", late == ["rtl", ["Ohm's Law", "V = IR"]], json.dumps(late, ensure_ascii=False))

        # idempotency: poke every text node in processed blocks (characterData mutations) -> re-process -> no change
        before_html = page.evaluate("document.body.innerHTML")
        page.evaluate("""() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            for (let t = w.nextNode(); t; t = w.nextNode()) if (t.parentElement.closest('[data-urf-b]') && !t.parentElement.closest('bdi')) t.data = t.data; }""")
        page.wait_for_timeout(600)
        check("idempotent: re-processing changes nothing", page.evaluate("document.body.innerHTML") == before_html)

        # performance: time a pass on a large synthetic page chunk
        t = page.evaluate("""async () => { const box = document.createElement('div'); box.id = 'perf';
            let h = ''; for (let i = 0; i < 2000; i++) h += '<p>سطر ' + i + ': نیوٹن کا قانون F = ma ہے اور g = 9.8 m/s² ہے۔</p>';
            box.innerHTML = h; const t0 = performance.now(); document.body.appendChild(box);
            await new Promise(r => { const iv = setInterval(() => { if (document.querySelectorAll('#perf bdi').length >= 6000) { clearInterval(iv); r(); } }, 20); });
            return Math.round(performance.now() - t0); }""")
        check("2000 paragraphs (6000 runs) fixed", t < 3000, f"{t} ms incl. 350 ms debounce")
        page.evaluate("document.getElementById('perf').remove(); document.getElementById('late').remove()")
        page.wait_for_timeout(100)

        # Nastaliq toggle
        set_storage({"nastaliq": True})
        page.wait_for_timeout(500)
        page.evaluate("document.fonts.ready")
        page.wait_for_timeout(500)
        nq = page.evaluate("""() => { const p = document.querySelector('.case p'); const cs = getComputedStyle(p);
            return { cls: document.documentElement.classList.contains('urf-nq'), font: cs.fontFamily, lh: cs.lineHeight, fs: cs.fontSize,
                     loaded: document.fonts.check('19px "URF Noto Nastaliq Urdu"', 'اردو') && [...document.fonts].some(f => f.family.includes('URF Noto Nastaliq') && f.status === 'loaded') } }""")
        check("Nastaliq font (bundled) applied with line-height 2", nq["cls"] and "URF Noto Nastaliq Urdu" in nq["font"] and nq["loaded"]
              and abs(float(nq["lh"][:-2]) - 2 * float(nq["fs"][:-2])) < 0.6, json.dumps(nq))
        page.screenshot(path=str(SHOTS / "after-extension-on-nastaliq.png"), full_page=True)
        set_storage({"nastaliq": False})

        # per-site off -> full undo, DOM identical to the original
        set_storage({"disabledSites": ["127.0.0.1"]})
        page.wait_for_timeout(400)
        # (Chrome's own built-in component extensions add an empty style="" to form fields; ignore that)
        norm = lambda h: h.replace(' style=""', '')
        original_html = norm(original_html)
        restored = norm(page.evaluate("document.body.innerHTML"))
        if restored != original_html:
            import difflib
            for l in difflib.unified_diff(original_html.replace('><', '>\n<').split('\n'), restored.replace('><', '>\n<').split('\n'), lineterm='', n=0): print('   ', l)
        check("site toggle off: DOM restored exactly", restored == original_html)
        set_storage({"disabledSites": []})
        page.wait_for_timeout(400)
        check("site toggle on again: fixed again", page.evaluate("document.querySelectorAll('bdi[data-urf-run]').length") > 40)

        # ---------- context-menu path: selection -> fixed plain text -> clipboard ----------
        bcdp.send("Browser.grantPermissions", {"permissions": ["clipboardReadWrite", "clipboardSanitizedWrite"]})
        page.evaluate("""() => { const p = document.querySelector('.case p'); const r = document.createRange(); r.selectNodeContents(p);
            const s = getSelection(); s.removeAllRanges(); s.addRange(r); }""")
        sel = sw.evaluate("""async () => { const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            const r = await chrome.tabs.sendMessage(tab.id, { type: 'urf-get-selection' });
            const out = await urfCopyFixed(r.text, tab.id, 0); return { sel: r.text, ...out }; }""")
        expected = "\u200fنیوٹن کا دوسرا قانون \u2068Newton's Second Law\u2069: \u2068F = ma\u2069۔"
        check("context menu: selection read from page (bdi text flattened)", sel["sel"] == "نیوٹن کا دوسرا قانون Newton's Second Law: F = ma۔", repr(sel["sel"]))
        check("context menu: fixed text copied", sel["fixed"] == expected and sel["via"] in ("offscreen", "page"), f"via={sel['via']}")
        page.bring_to_front()
        clip = page.evaluate("navigator.clipboard.readText()")
        check("clipboard holds fixed text (context menu)", clip == expected, repr(clip))

        # ---------- popup: Fix & Copy ----------
        pop = ctx.new_page()
        pop.set_viewport_size({"width": 400, "height": 700})
        pop.goto(f"chrome-extension://{ext_id}/popup.html?site=127.0.0.1")
        src = "نیوٹن کا دوسرا قانون Newton's Second Law: F = ma۔\nزمین پر g = 9.8 m/s² ہوتا ہے۔\nPhysics فزکس کی ایک شاخ Optics ہے (Light)۔"
        pop.fill("#input", src)
        pop.click("#fixCopy")
        pop.wait_for_timeout(300)
        exp_popup = pop.evaluate("s => URFBidi.fixText(s)", src)
        pclip = pop.evaluate("navigator.clipboard.readText()")
        want_lines = [
            "\u200fنیوٹن کا دوسرا قانون \u2068Newton's Second Law\u2069: \u2068F = ma\u2069۔",
            "\u200fزمین پر \u2068g = 9.8 m/s²\u2069 ہوتا ہے۔",
            "\u200f\u2068Physics\u2069 فزکس کی ایک شاخ \u2068Optics\u2069 ہے \u2068(Light)\u2069۔"]
        check("popup Fix & Copy: clipboard == expected RLM/FSI/PDI text", pclip == "\n".join(want_lines) == exp_popup, repr(pclip))
        check("popup message", "Copied" in pop.inner_text("#msg"), pop.inner_text("#msg"))
        check("popup preview uses dir=rtl", pop.get_attribute("#preview", "dir") == "rtl")
        check("popup toggles reflect storage", pop.is_checked("#optEnabled") and pop.is_checked("#optSite") and pop.is_checked("#optWrap"))
        pop.evaluate("document.fonts.ready")
        pop.wait_for_timeout(300)
        pop.screenshot(path=str(SHOTS / "popup.png"), full_page=True)
        # plain-text proof: render the copied text as plain <p dir=auto> lines, no markup at all
        proof = ctx.new_page(); proof.set_viewport_size({"width": 900, "height": 300})
        proof.set_content('<meta charset="utf-8"><style>body{font:20px "Noto Naskh Arabic",sans-serif;margin:16px} p{border:1px solid #ccd;padding:2px 10px}</style>'
                          '<h3 style="font:14px sans-serif">Plain text as pasted (top: raw, bottom: Fix &amp; Copy output), rendered in &lt;p dir=auto&gt; with no markup</h3>'
                          '<div id="a"></div><div id="b"></div>')
        proof.evaluate("""([a, b]) => { for (const [id, t] of [['a', a], ['b', b]]) for (const l of t.split('\\n')) {
            const p = document.createElement('p'); p.dir = 'auto'; p.textContent = l; document.getElementById(id).appendChild(p); } }""", [src, pclip])
        proof.evaluate("document.fonts.ready"); proof.wait_for_timeout(200)
        proof.screenshot(path=str(SHOTS / "plaintext-raw-vs-fixed.png"), full_page=True)
        proof.close()

        # popup site toggle writes storage
        pop.click("#optSite"); pop.wait_for_timeout(200)
        ds = sw.evaluate("() => chrome.storage.sync.get('disabledSites')")
        check("popup site toggle saves to chrome.storage", ds["disabledSites"] == ["127.0.0.1"], json.dumps(ds))
        pop.click("#optSite"); pop.wait_for_timeout(200)
        pop.close()

        # ---------- visual reference: extension output vs hand-marked recipe markup ----------
        vis = ctx.new_page(); vis.set_viewport_size({"width": 1560, "height": 900})
        shots = {}
        for name in ("phys-ref.html", "phys-raw.html"):
            vis.goto(BASE + "/" + name); vis.bring_to_front()
            vis.wait_for_timeout(700); vis.evaluate("document.fonts.ready")
            n = vis.evaluate("document.querySelectorAll('p').length")
            shots[name] = [vis.locator(f"#l{i}").screenshot() for i in range(n)]
        same, diff = 0, []
        for i, (ra, rb) in enumerate(zip(shots["phys-ref.html"], shots["phys-raw.html"])):
            a = Image.open(io.BytesIO(ra)).convert("RGB"); b = Image.open(io.BytesIO(rb)).convert("RGB")
            if a.size == b.size and ImageChops.difference(a, b).getbbox() is None: same += 1
            else:
                diff.append(i)
                a.save(SHOTS / f"refdiff-l{i}-handmarked.png"); b.save(SHOTS / f"refdiff-l{i}-extension.png")
        check("physics lines pixel-identical to hand-marked recipe version", same >= n - 8, f"{same}/{n} identical; differing line ids {diff}")
        browser.close()
finally:
    chrome.kill(); srv.shutdown()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
