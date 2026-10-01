# Privacy Policy — Urdu RTL Fixer

_Last updated: 1 October 2026_

This privacy policy covers the **Urdu RTL Fixer** browser extension for **Microsoft Edge** (Microsoft Edge Add-ons) and **Google Chrome** (Chrome Web Store). Urdu RTL Fixer fixes the display order of Urdu (and Arabic, Persian, Pashto, Sindhi) text that is mixed with English words, numbers and formulas.

## Summary

- Urdu RTL Fixer **does not collect, sell, share or send** any personal information or browsing data.
- The extension **makes no network requests**. It has no servers, analytics, ads, tracking or remote code.
- Page text is read and fixed **only on your own device**, inside your browser.

## What the extension does with page content

To fix the text order, the extension's content script reads the text of the web pages you visit. It then adds invisible direction marks (such as `<bdi>` isolates and `dir="rtl"`) in the page that is open in your browser. This happens locally in memory. The page text is never stored by the extension and never leaves your device.

When you use **"Copy fixed for WhatsApp/Word"** (right-click menu) or **Fix & Copy** (toolbar popup), the selected or typed text is fixed locally and written to your clipboard. The last copied text is kept only in the browser's temporary session storage (`storage.session`). It is deleted when the browser closes and is never sent anywhere.

## Settings

Your preferences are saved with the browser's built-in `storage.sync` area:

- on/off switch
- list of sites where you turned the extension off (site host names only)
- Nastaliq font on/off
- "wrap English/number runs" on/off

If you have browser sync turned on, Microsoft Edge or Google Chrome may sync these settings between your own devices through your Microsoft or Google account. That sync follows the browser vendor's privacy policy. The developer of Urdu RTL Fixer never receives or sees these settings. You can clear them at any time by removing the extension.

## Permissions

| Permission | Why it is needed |
|---|---|
| Access to all websites (`<all_urls>` content script) | To find and fix mixed Urdu/English text on any page you open, and to let pages use the bundled Nastaliq font. |
| `storage` | To remember your settings (see above). |
| `contextMenus` | To add the "Copy fixed for WhatsApp/Word" right-click item. |
| `clipboardWrite` | To put the fixed text on your clipboard when you ask for it. |
| `offscreen` | To write to the clipboard from the background script (Manifest V3). |
| `activeTab` | To show the current site's name in the popup for the per-site on/off switch. |

## Bundled font

The extension includes the Noto Nastaliq Urdu font (SIL Open Font License 1.1) inside the package. It is loaded from the extension itself, not downloaded from the internet.

## Children

The extension collects no information from anyone, including children.

## Changes

If this policy changes, the updated version will be published at this address with a new "Last updated" date. If the extension ever needs to handle data differently, the policy will be updated first and the store listings will be changed to match.

## Contact

Questions or concerns: please open an issue at
https://github.com/iftekhar-shaikh/urdu-rtl-fixer/issues
