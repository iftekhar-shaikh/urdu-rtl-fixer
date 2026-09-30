# Urdu RTL Fixer — Install karne ka tareeqa (Chrome / Edge)

Yeh extension kisi store par nahi hai; aap isay khud "Load unpacked" se install karte hain.

1. GitHub se repo download karein (Code → Download ZIP, phir unzip) ya `git clone` karein. Andar `extension` folder mein `manifest.json` hai.
2. Browser mein address bar par likhein:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
3. Upar daayen (Edge mein baayen) **Developer mode** ka button **on** karein.
4. **Load unpacked** par click karein.
5. Repo ka `extension` folder chunein (jis mein `manifest.json` hai) aur **Select Folder** dabayein.
6. Toolbar mein puzzle (🧩) icon se "Urdu RTL Fixer" ko **pin** kar lein.
7. Jo tabs pehle se khule hain unhein aik dafa **reload** karein.

## Istemaal

- **Auto-fix:** har page par Urdu/Arabi/Farsi/Pashto/Sindhi paragraph khud-ba-khud right-to-left ho jata hai aur
  English alfaaz, numbers aur formulas (`F = ma`, `9.8 m/s²`) sahi tarteeb mein dikhte hain.
  ChatGPT, Grok, Gmail, WhatsApp Web jaise pages par naya aane wala text bhi theek hota rehta hai.
- **Popup:** icon par click karein →
  - "Enabled everywhere" = poori extension on/off
  - "Enabled on <site>" = sirf is website ke liye on/off
  - "Nastaliq font" = Urdu paragraphs par Noto Nastaliq Urdu font (extension ke andar hai, internet ki zaroorat nahi) aur line-height 2
  - Textarea mein Urdu + English text paste karein → **Fix & Copy** → ab WhatsApp, Word, Notes ya email mein paste karein.
- **Right-click:** kisi page par text select karein → right-click → **Copy fixed for WhatsApp/Word**.

## Yaad rakhein

- Extension sirf browser ke andar pages ko theek karti hai. WhatsApp desktop app, MS Word waghera ke andar text kaisa
  dikhe, yeh extension nahi badal sakti — wahan ke liye **Fix & Copy** / right-click wala copy istemaal karein
  (yeh text mein invisible RLM / FSI / PDI marks daal deta hai, spaces nahi).
- Typing boxes (input, textarea, WhatsApp/Gmail ka likhne wala dabba), `code` aur `pre` ko extension nahi chherti.
- Agar kisi website par koi masla ho to popup se "Enabled on <site>" band kar dein, ya "Wrap English/number runs" band kar dein.
- Update karne ke liye naya folder rakh kar `chrome://extensions` par extension ke card par ⟳ (Reload) dabayein.
