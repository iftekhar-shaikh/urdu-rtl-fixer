/* background.js — MV3 service worker: context menu "Copy fixed for WhatsApp/Word". */
importScripts('bidi.js');

const MENU_ID = 'urf-copy-fixed';
const DEFAULTS = { enabled: true, disabledSites: [], nastaliq: false, wrapRuns: true };

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: 'Copy fixed for WhatsApp/Word', contexts: ['selection'] });
  });
  const cur = await chrome.storage.sync.get(DEFAULTS);
  await chrome.storage.sync.set(cur); // write defaults once so every context sees them
});

async function ensureOffscreen() {
  if (!chrome.offscreen) return false;
  try {
    if (chrome.runtime.getContexts) {
      const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      if (ctx.length) return true;
    }
    await chrome.offscreen.createDocument({
      url: 'offscreen.html', reasons: ['CLIPBOARD'],
      justification: 'Copy the bidi-fixed text to the clipboard'
    });
    return true;
  } catch (e) {
    return /single offscreen/i.test(String(e && e.message));
  }
}

async function copyText(text, tabId, frameId) {
  // 1) offscreen document (reliable in MV3), 2) the page's content script as a fallback
  try {
    if (await ensureOffscreen()) {
      const r = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'urf-offscreen-copy', text });
      if (r && r.ok) return 'offscreen';
    }
  } catch (e) { /* fall through */ }
  if (tabId != null) {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { type: 'urf-copy-text', text }, { frameId: frameId || 0 });
      if (r && r.ok) return 'page';
    } catch (e) { /* no content script on this page */ }
  }
  return null;
}

async function copyFixed(rawText, tabId, frameId) {
  const fixed = URFBidi.fixText(rawText || '');
  const via = await copyText(fixed, tabId, frameId);
  try { await chrome.storage.session.set({ lastCopy: { raw: rawText, fixed, via, at: Date.now() } }); } catch (e) { /* ignore */ }
  if (tabId != null) {
    chrome.action.setBadgeBackgroundColor({ color: via ? '#1a7f37' : '#b42318', tabId });
    chrome.action.setBadgeText({ text: via ? '✓' : '!', tabId });
    setTimeout(() => chrome.action.setBadgeText({ text: '', tabId }), 2000);
  }
  return { fixed, via };
}
globalThis.urfCopyFixed = copyFixed; // used by the automated tests

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const tabId = tab && tab.id;
  let text = '';
  // Ask the page for the selection: keeps line breaks and works inside inputs/textareas.
  if (tabId != null) {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { type: 'urf-get-selection' }, { frameId: info.frameId || 0 });
      text = (r && r.text) || '';
    } catch (e) { /* e.g. chrome:// pages, PDF viewer */ }
  }
  if (!text) text = info.selectionText || '';
  if (!text) return;
  await copyFixed(text, tabId, info.frameId);
});
