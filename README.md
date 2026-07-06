# PromptVault AI Browser Extension 🔒🚀

PromptVault AI is a high-performance, developer-grade Manifest V3 browser extension designed to save, organize, and instantly paste advanced, structured prompt templates into popular AI chat platforms. 

## Supported AI Platforms

Our injected active script features target query selectors ready for:
* **ChatGPT** (`https://chatgpt.com/*`)
* **Gemini** (`https://gemini.google.com/*`)
* **Claude** (`https://claude.ai/*`)
* **Grok** (`https://grok.com/*`)
* **DeepSeek** (`https://chat.deepseek.com/*`)
* **Perplexity** (`https://www.perplexity.ai/*`)
* **Microsoft Copilot** (`https://copilot.microsoft.com/*`)

---

## 📂 Extension Folder Structure

Your exported `/extension/` directory conforms perfectly to industry-level standards:

* `manifest.json`: Unified configurations, keyboard shortcuts, and granular script matches.
* `background.js`: Event service-worker listening for hotkeys and right-click context menu bindings.
* `content.js` + `content.css`: Content injection modules, providing coordinate memory on the draggable FAB button, backdrop blur shields, and custom synthetic React paste event dispatches.
* `popup.html` + `popup.js` + `popup.css`: Dual-purpose visual core, rendering as the toolbar popover list and sliding sideframe panel via embedded iframe.

---

## 🛠️ Step-by-Step Installation Instructions

To load, run, and modify this extension locally in your web browser:

1. **Download the Extension Files**
   * Grab the files inside the `/extension/` subdirectory from this workspace (manifest, background, content, popup). Keep them in a single folder named `PromptVault-AI`.

2. **Open Extensions Page in your Chromium Browser**
   * Navigate to: `chrome://extensions/` (or `edge://extensions/` for Microsoft Edge, `brave://extensions/` for Brave).

3. **Toggle Developer Mode Toggle**
   * Turn on **Developer Mode** by clicking the toggle switch in the top-right corner of the Extensions dashboard page.

4. **Load Unpacked Extension**
   * Click the **Load unpacked** button located in the top-left area.
   * Select your prepared `PromptVault-AI` folder in your operating system's file browser.

5. **Start Prompting!**
   * Visit any support site (e.g., [https://chatgpt.com](https://chatgpt.com) or [https://claude.ai](https://claude.ai)).
   * You'll instantly see the glowing **PromptVault FAB Lock icon** floating in the bottom-right!
   * Drag it anywhere you like. Click it to slide in your prompt library side drawer, select a template, and witness instant input pasting with complete React state synchronization!

---

## 🎹 Keyboard Shortcuts

We have configured fast, intuitive keyboard shortcuts inside `manifest.json` for rapid navigation:

* **Ctrl+Shift+P** (Mac: **Control+Shift+P**): Open standard toolbar Prompt Library popover.
* **Ctrl+Shift+Y** (Mac: **Control+Shift+Y**): Slide open/close the embedded Side Panel directly inside your active AI chat page!

---

## 🖼️ Suggested Extension Icons

To make this extension ready for the Chrome Web Store, add beautiful icons in an `icons/` folder inside the extension directory:

1. `icons/icon16.png` - Used as the favicon on the extensions management page.
2. `icons/icon48.png` - Shown on the extensions toolbar popover list.
3. `icons/icon128.png` - Primary store launcher icon shown in the Chrome Web Store.

---

## 🚀 Key Architectural Advantages & Scalability

1. **Unified Frame Architecture (Popup + Sidebar)**
   * Most browser extensions maintain separate code for popups and injected side panels. PromptVault AI solves this elegantly by routing both to `popup.html` with an `embed=true` URL query parameter, avoiding duplication!

2. **Framework state sync**
   * Modern SPAs (ChatGPT, Gemini, etc.) use virtual DOM frameworks (React, ProseMirror) that ignore standard input `.value = newValue` changes. Our `content.js` dispatches custom synthetic events (`input`, `change`, `keydown`) so the target platforms immediately adapt to changes.

3. **Granular Local State Persistence**
   * Integrates seamlessly with `chrome.storage.local` to carry over your stored prompts, favorites, categories, theme preferences, and dragging coordinates across all session cycles.
