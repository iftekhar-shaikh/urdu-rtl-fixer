/* offscreen.js — clipboard writer for the service worker (MV3 has no DOM in the worker). */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'urf-offscreen-copy') return;
  const ta = document.getElementById('t');
  ta.value = msg.text;
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  sendResponse({ ok });
});
