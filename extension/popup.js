/* popup.js — toggles + "Fix & Copy". */
const B = globalThis.URFBidi;
const DEFAULTS = { enabled: true, disabledSites: [], nastaliq: false, wrapRuns: true };
const $ = (id) => document.getElementById(id);
let site = null, tabId = null, settings = { ...DEFAULTS };

function siteFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.hostname;
    if (u.protocol === 'file:') return 'file';
  } catch (e) { /* ignore */ }
  return null;
}

async function init() {
  // ?site= lets the automated test drive the popup as a normal tab
  const qp = new URLSearchParams(location.search);
  if (qp.has('site')) site = qp.get('site');
  else {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) { tabId = tab.id; site = siteFromUrl(tab.url || ''); }
    } catch (e) { /* ignore */ }
  }
  settings = await chrome.storage.sync.get(DEFAULTS);
  render();
  refreshStatus();
}

function render() {
  $('optEnabled').checked = !!settings.enabled;
  $('optNastaliq').checked = !!settings.nastaliq;
  $('optWrap').checked = !!settings.wrapRuns;
  $('siteName').textContent = site || 'this page (n/a)';
  $('optSite').disabled = !site || !settings.enabled;
  $('optSite').checked = !!site && !settings.disabledSites.includes(site);
}

async function save(patch) {
  settings = { ...settings, ...patch };
  await chrome.storage.sync.set(patch);
  render();
  setTimeout(refreshStatus, 150);
}

async function refreshStatus() {
  const el = $('pageStatus');
  if (tabId == null) { el.textContent = ''; return; }
  try {
    const s = await chrome.tabs.sendMessage(tabId, { type: 'urf-stats' });
    el.textContent = s && s.active
      ? `Active on this page: ${s.blocks} block(s), ${s.runs} run(s) isolated, ${s.dirSet} dir fix(es).`
      : 'Not active on this page.';
  } catch (e) { el.textContent = 'Page not scriptable (browser page or not reloaded since install).'; }
}

$('optEnabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));
$('optNastaliq').addEventListener('change', (e) => save({ nastaliq: e.target.checked }));
$('optWrap').addEventListener('change', (e) => save({ wrapRuns: e.target.checked }));
$('optSite').addEventListener('change', (e) => {
  if (!site) return;
  const set = new Set(settings.disabledSites);
  if (e.target.checked) set.delete(site); else set.add(site);
  save({ disabledSites: Array.from(set) });
});

function updatePreview() {
  $('preview').textContent = B.fixText($('input').value);
}
$('input').addEventListener('input', updatePreview);

async function writeClipboard(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fallback */ }
  const ta = document.createElement('textarea');
  ta.value = text; document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

$('fixCopy').addEventListener('click', async () => {
  const src = $('input').value;
  const msg = $('msg');
  if (!src.trim()) { msg.className = 'err'; msg.textContent = 'Nothing to fix.'; return; }
  const fixed = B.fixText(src);
  $('preview').textContent = fixed;
  document.body.dataset.lastFixed = fixed; // for tests
  const ok = await writeClipboard(fixed);
  const n = (fixed.match(/\u2068/g) || []).length;
  msg.className = ok ? '' : 'err';
  msg.textContent = ok ? `Copied ✓ (${n} isolate${n === 1 ? '' : 's'})` : 'Copy failed — select the preview and copy manually.';
});
$('clear').addEventListener('click', () => { $('input').value = ''; updatePreview(); $('msg').textContent = ''; $('input').focus(); });

init();
