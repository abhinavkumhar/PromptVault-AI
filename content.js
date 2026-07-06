/**
 * PromptVault AI - Injected Content Script
 * Handles FAB creation, SPA re-injection, side panel iframe rendering,
 * and advanced target-input pasting with full React/ProseMirror support.
 *
 * Platform adapters:
 *   ChatGPT, Gemini, Claude, Grok, Perplexity, DeepSeek, Copilot (Microsoft)
 *
 * Key fixes (v3):
 *  - Copilot: isConnected guard + body-replacement watcher + DOM guardian loop
 *  - Copilot: cleared PromptVaultInjected flag across SPA navigations
 *  - All:     unified FAB liveness check (getElementById + isConnected)
 *  - All:     platform adapter pattern with readiness polling per site
 */

(function () {
  // ─── Guard: one instance per document lifecycle ───────────────────────────────
  // NOTE: We do NOT use a persistent window flag here because Copilot can fully
  // replace document.body (and its descendants) during SPA navigation, which
  // would leave the flag set but the FAB gone.  Instead we rely on the
  // isFABAlive() helper that checks both presence AND connectedness.
  if (window.__pvScriptRunning) return;
  window.__pvScriptRunning = true;

  let activeIframe   = null;
  let activeBackdrop = null;
  let fabElement     = null;
  let spaLastUrl     = window.location.href;
  let fabWatchTimer  = null; // debounce handle for MutationObserver
  let fabRetryTimer  = null; // polling handle for delayed injection
  let guardianTimer  = null; // Copilot-specific periodic liveness check
  const ROOT_ID      = "promptvault-extension-root";
  const FAB_ID       = "promptvault-action-fab";

  // ─── 1. Platform Detection ────────────────────────────────────────────────────
  function getPlatformName() {
    const host = window.location.hostname.toLowerCase();
    const path = window.location.pathname.toLowerCase();
    if (host.includes("chatgpt.com"))           return "ChatGPT";
    if (host.includes("gemini.google.com"))     return "Gemini";
    if (host.includes("grok.com"))              return "Grok";
    if (host.includes("claude.ai"))             return "Claude";
    if (host.includes("perplexity.ai"))         return "Perplexity";
    if (host.includes("deepseek.com"))          return "DeepSeek";
    if (isCopilot())                            return "Copilot";
    return "AI Platform";
  }

  function isCopilot() {
    const host = window.location.hostname.toLowerCase();
    const path = window.location.pathname.toLowerCase();
    const params = new URLSearchParams(window.location.search);
    const isBingHost = host === "bing.com" || host.endsWith(".bing.com");

    return host === "copilot.microsoft.com" ||
           host.endsWith(".copilot.microsoft.com") ||
           (host === "m365.cloud.microsoft" && path.startsWith("/chat")) ||
           (isBingHost && (
             path.startsWith("/chat") ||
             path.startsWith("/copilot") ||
             (path.startsWith("/search") && (
               params.has("showconv") ||
               params.has("sendquery") ||
               params.get("form") === "MA13FV"
             ))
           ));
  }

  function isSupportedRuntimePage() {
    const host = window.location.hostname.toLowerCase();
    if (host === "bing.com" || host.endsWith(".bing.com")) return isCopilot();
    if (host === "m365.cloud.microsoft") return isCopilot();
    return true;
  }


  // ─── 2. FAB Liveness Check ────────────────────────────────────────────────────
  /**
   * Returns true only if the FAB element exists in the DOM AND is connected
   * to the live document.  document.getElementById alone can return stale
   * nodes that were detached during a Copilot SPA re-render.
   */
  function isFABAlive() {
    const aliveFabs = Array
      .from(document.querySelectorAll(`#${FAB_ID}`))
      .filter(el => el.isConnected);

    // Keep the first live launcher and remove any accidental duplicates.
    aliveFabs.slice(1).forEach(el => el.remove());
    return aliveFabs.length > 0;
  }

  function removeFAB() {
    document.querySelectorAll(`#${FAB_ID}`).forEach(el => el.remove());
    fabElement = null;
  }

  function getPromptVaultRoot() {
    const parent = document.documentElement || document.body;
    if (!parent) return null;

    let root = document.getElementById(ROOT_ID);
    if (root && root.isConnected) return root;
    if (root) root.remove();

    root = document.createElement("div");
    root.id = ROOT_ID;
    root.setAttribute("data-promptvault-root", "true");
    root.style.setProperty("all", "initial", "important");
    root.style.setProperty("position", "static", "important");
    root.style.setProperty("display", "contents", "important");
    parent.appendChild(root);
    return root;
  }

  // ─── 3. Platform Adapters — input detection ───────────────────────────────────
  /**
   * Each adapter returns { element, isContentEditable } or null.
   * Adapters try their most specific selector first and fall back to generic ones.
   * They also pierce one level of open shadow DOM where needed.
   */

  // Helper: walk open shadow roots recursively to find an element
  function queryShadowDeep(root, selector, maxDepth = 6) {
    if (maxDepth <= 0) return null;
    const direct = root.querySelector(selector);
    if (direct) return direct;
    const hosts = root.querySelectorAll("*");
    for (const host of hosts) {
      if (host.shadowRoot) {
        const found = queryShadowDeep(host.shadowRoot, selector, maxDepth - 1);
        if (found) return found;
      }
    }
    return null;
  }

  const PLATFORM_ADAPTERS = {
    // ── ChatGPT ─────────────────────────────────────────────────────────────────
    "chatgpt.com": {
      findInput() {
        return (
          document.querySelector("#prompt-textarea") ||
          document.querySelector('div[contenteditable="true"][data-id="root"]') ||
          document.querySelector('div[contenteditable="true"][role="textbox"]') ||
          document.querySelector('div[contenteditable="true"]')
        );
      }
    },

    // ── Gemini ──────────────────────────────────────────────────────────────────
    "gemini.google.com": {
      findInput() {
        return (
          document.querySelector('div[role="textbox"][contenteditable="true"]') ||
          document.querySelector('.ql-editor[contenteditable="true"]') ||
          document.querySelector('[contenteditable="true"]') ||
          document.querySelector(".textarea-container textarea") ||
          document.querySelector("textarea")
        );
      }
    },

    // ── Claude ──────────────────────────────────────────────────────────────────
    "claude.ai": {
      findInput() {
        return (
          document.querySelector('div[contenteditable="true"].ProseMirror') ||
          document.querySelector('[data-placeholder][contenteditable="true"]') ||
          document.querySelector('div[contenteditable="true"]') ||
          document.querySelector("textarea")
        );
      }
    },

    // ── Perplexity ───────────────────────────────────────────────────────────────
    "perplexity.ai": {
      findInput() {
        return (
          document.querySelector('textarea[placeholder*="Ask"]') ||
          document.querySelector("textarea") ||
          document.querySelector('div[contenteditable="true"]')
        );
      }
    },

    // ── DeepSeek ─────────────────────────────────────────────────────────────────
    "deepseek.com": {
      findInput() {
        return (
          document.querySelector("#chat-input") ||
          document.querySelector('textarea[placeholder*="message"]') ||
          document.querySelector('textarea[placeholder*="Message"]') ||
          document.querySelector("textarea") ||
          document.querySelector('div[contenteditable="true"]')
        );
      }
    },

    // ── Grok ─────────────────────────────────────────────────────────────────────
    // Grok uses a React 18 controlled <textarea>. The element is re-created on
    // conversation switches. We cast a wide net of selectors.
    "grok.com": {
      findInput() {
        return (
          // Most stable: aria attributes
          document.querySelector('textarea[aria-label]') ||
          document.querySelector('textarea[placeholder]') ||
          // Fallback structural selectors
          document.querySelector('main textarea') ||
          document.querySelector('form textarea') ||
          document.querySelector("textarea") ||
          // Last resort: contenteditable
          document.querySelector('div[contenteditable="true"]')
        );
      }
    },

    // ── Microsoft Copilot ────────────────────────────────────────────────────────
    // Copilot uses a heavy Shadow DOM tree rooted at <cib-serp> or <copilot-chat>.
    // The chat input lives deep inside shadow roots. We pierce them to find it.
    // Additionally, copilot.microsoft.com (new UI) uses a React-based SPA with
    // a standard textarea that may be nested in <div data-testid="..."> containers.
    "copilot.microsoft.com": {
      findInput() {
        // 1. Try direct document query first (new Copilot React UI has standard textareas)
        const direct =
          document.querySelector('textarea[data-testid]') ||
          document.querySelector('textarea[placeholder]') ||
          document.querySelector('div[role="textbox"][contenteditable="true"]') ||
          document.querySelector('textarea') ||
          document.querySelector('[contenteditable="true"]');
        if (direct) return direct;

        // 2. Pierce known shadow-host elements (legacy Bing Chat UI)
        const shadowHosts = [
          "cib-serp",
          "cib-chat-main",
          "cib-action-bar",
          "copilot-chat",
          "ms-chat-ui",
        ];
        for (const tag of shadowHosts) {
          const host = document.querySelector(tag);
          if (!host) continue;
          const found = queryShadowDeep(
            host.shadowRoot || host,
            'textarea, div[role="textbox"][contenteditable="true"], [contenteditable="true"]'
          );
          if (found) return found;
        }

        // 3. Full shadow-deep scan from document root
        return queryShadowDeep(
          document,
          'div[role="textbox"][contenteditable="true"], textarea, [contenteditable="true"]'
        );
      }
    },
  };

  // Alias bing.com to Copilot adapter
  PLATFORM_ADAPTERS["bing.com"] = PLATFORM_ADAPTERS["copilot.microsoft.com"];
  PLATFORM_ADAPTERS["m365.cloud.microsoft"] = PLATFORM_ADAPTERS["copilot.microsoft.com"];

  function getAdapter() {
    const host = window.location.hostname.toLowerCase();
    for (const key of Object.keys(PLATFORM_ADAPTERS)) {
      if (host.includes(key)) return PLATFORM_ADAPTERS[key];
    }
    return null;
  }

  function findChatInput() {
    const adapter = getAdapter();
    if (adapter) return adapter.findInput();
    // Generic fallback for unlisted sites
    return (
      document.querySelector("textarea") ||
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector('input[type="text"]')
    );
  }

  // ─── 4. React Native-Value Setter ─────────────────────────────────────────────
  function setNativeInputValue(el, value) {
    const proto =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }
  }

  // ─── 5. Comprehensive Framework Event Dispatcher ──────────────────────────────
  function dispatchFrameworkEvents(el, insertedText) {
    // beforeinput — required by some React 18 / Slate editors
    try {
      el.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true, cancelable: true,
        inputType: "insertText", data: insertedText
      }));
    } catch (_) {}

    // input with inputType — primary React reconciler signal
    try {
      el.dispatchEvent(new InputEvent("input", {
        bubbles: true, cancelable: true,
        inputType: "insertText", data: insertedText
      }));
    } catch (_) {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }

    el.dispatchEvent(new Event("change", { bubbles: true }));

    // Keyboard events — Grok / Copilot use these to enable the send button
    ["keydown", "keypress", "keyup"].forEach(evType => {
      el.dispatchEvent(new KeyboardEvent(evType, {
        bubbles: true, key: "End", code: "End", keyCode: 35
      }));
    });

    // Safety net plain input for Vue / Svelte
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // ─── 6. Prompt Text Insertion ─────────────────────────────────────────────────
  function insertPromptText(text) {
    const chatInput = findChatInput();
    if (!chatInput) {
      // Retry once after 500 ms in case the input hasn't rendered yet
      setTimeout(() => {
        const retried = findChatInput();
        if (retried) {
          doInsert(retried, text);
        } else {
          showTransientBanner("⚠️ Chat input not found. Focus it manually and paste.");
        }
      }, 500);
      return;
    }
    doInsert(chatInput, text);
  }

  function doInsert(chatInput, text) {
    chatInput.focus();

    const isEditable = chatInput.isContentEditable || chatInput.tagName === "DIV";

    if (isEditable) {
      // ── ContentEditable path (ChatGPT, Gemini, Claude, Copilot) ─────────────
      insertIntoContentEditable(chatInput, text);
    } else {
      // ── Textarea / Input path (Grok, Perplexity, DeepSeek) ──────────────────
      insertIntoTextarea(chatInput, text);
    }

    showTransientBanner("✅ Prompt Instantly Inserted!");
  }

  function insertIntoContentEditable(el, text) {
    try {
      el.focus();
      const selection = window.getSelection();

      // Position cursor at the end
      const endRange = document.createRange();
      endRange.selectNodeContents(el);
      endRange.collapse(false);
      selection.removeAllRanges();
      selection.addRange(endRange);

      // Try execCommand first — most reliable cross-framework approach for
      // contenteditable (works with ProseMirror, Quill, Slate, Lexical)
      const inserted = document.execCommand("insertText", false, text);
      if (inserted) {
        dispatchFrameworkEvents(el, text);
        return;
      }

      // Fallback: manual DOM fragment insertion
      const paragraphs = text.split("\n");
      const fragment   = document.createDocumentFragment();
      paragraphs.forEach((line, idx) => {
        fragment.appendChild(document.createTextNode(line));
        if (idx < paragraphs.length - 1) {
          fragment.appendChild(document.createElement("br"));
        }
      });

      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(fragment);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);

      dispatchFrameworkEvents(el, text);
    } catch (err) {
      console.error("[PromptVault] ContentEditable insertion failed:", err);
      el.textContent = text;
      dispatchFrameworkEvents(el, text);
    }
  }

  function insertIntoTextarea(el, text) {
    const currentVal = el.value || "";
    const start      = el.selectionStart ?? currentVal.length;
    const end        = el.selectionEnd   ?? currentVal.length;
    const newVal     = currentVal.slice(0, start) + text + currentVal.slice(end);

    // Step 1: Use native setter to bypass React's controlled-input wrapper
    setNativeInputValue(el, newVal);

    // Step 2: Move cursor to end of inserted text
    const cursorPos = start + text.length;
    try {
      el.selectionStart = cursorPos;
      el.selectionEnd   = cursorPos;
    } catch (_) {}

    // Step 3: Try execCommand as well — works in some React 18 setups and
    // ensures the undo stack is preserved
    try {
      el.focus();
      el.select();
      document.execCommand("insertText", false, text);
    } catch (_) {}

    // Step 4: Full event sequence
    dispatchFrameworkEvents(el, text);
  }

  // ─── 7. Toast Notification ────────────────────────────────────────────────────
  function showTransientBanner(msg) {
    // Remove any existing banner to avoid stacking
    const existing = document.getElementById("pv-banner");
    if (existing) existing.remove();

    const banner = document.createElement("div");
    banner.id = "pv-banner";
    banner.innerText = msg;
    banner.style.cssText = `
      position: fixed !important;
      left: 50% !important;
      top: 24px !important;
      transform: translateX(-50%) !important;
      background: #0f172a !important;
      color: #10b981 !important;
      padding: 10px 20px !important;
      border-radius: 8px !important;
      font-size: 14px !important;
      font-weight: 500 !important;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
      z-index: 2147483647 !important;
      border: 1px solid #10b981 !important;
      font-family: system-ui, -apple-system, sans-serif !important;
      pointer-events: none !important;
      transition: opacity 0.3s ease !important;
    `;
    const root = getPromptVaultRoot();
    (root || document.body).appendChild(banner);
    setTimeout(() => {
      banner.style.opacity = "0";
      setTimeout(() => banner.remove(), 300);
    }, 2000);
  }

  // ─── 8. FAB Creation ──────────────────────────────────────────────────────────
  /**
   * For Copilot we insert the FAB into document.body directly (fixed
   * positioning floats it above all shadow trees) and verify with isConnected.
   *
   * Key invariant: we NEVER create a new FAB if one is already alive in the DOM.
   * We only create when isFABAlive() returns false.
   */
  function initializeFAB() {
    const root = getPromptVaultRoot();
    if (!root) return false;

    // Already alive — nothing to do
    if (isFABAlive()) return true;

    // Stale reference cleanup: if fabElement is detached, discard it
    if (fabElement && !fabElement.isConnected) {
      fabElement = null;
    }

    fabElement = document.createElement("div");
    fabElement.className = "promptvault-fab";
    fabElement.id        = FAB_ID;

    const logoImg = document.createElement("img");
    logoImg.className = "promptvault-fab-logo";
    logoImg.src       = chrome.runtime.getURL("icons/logo.png");
    logoImg.alt       = "PromptVault AI";
    fabElement.appendChild(logoImg);

    // Always append to document.body — fixed positioning makes it float above
    // all shadow-DOM stacking contexts as long as z-index is high enough.
    root.appendChild(fabElement);
    fabElement.addEventListener("click", toggleSidebar);

    // Verify it was actually added (Copilot can synchronously remove children)
    return fabElement.isConnected;
  }

  // ─── 9. Sidebar Panel ─────────────────────────────────────────────────────────
  function toggleSidebar() {
    if (activeIframe && !activeIframe.isConnected) {
      activeIframe = null;
      activeBackdrop = null;
    }
    activeIframe ? closeSidebar() : openSidebar();
  }

  function openSidebar() {
    if (activeIframe && activeIframe.isConnected) return;
    activeIframe = null;
    activeBackdrop = null;

    const root = getPromptVaultRoot();
    if (!root) return;

    const fab = document.getElementById(FAB_ID);
    if (fab) fab.classList.add("panel-open");

    activeBackdrop = document.createElement("div");
    activeBackdrop.className = "promptvault-backdrop";
    root.appendChild(activeBackdrop);

    activeIframe = document.createElement("iframe");
    activeIframe.className = "promptvault-panel-iframe";
    activeIframe.src = (
      chrome.runtime.getURL("popup.html") +
      "?embed=true&platform=" +
      encodeURIComponent(getPlatformName())
    );
    root.appendChild(activeIframe);

    setTimeout(() => {
      if (activeBackdrop) activeBackdrop.classList.add("open");
      if (activeIframe) activeIframe.classList.add("open");
    }, 10);

    activeBackdrop.addEventListener("click", closeSidebar);
  }

  function closeSidebar() {
    if (!activeIframe && !activeBackdrop) return;

    const fab = document.getElementById(FAB_ID);
    if (fab) fab.classList.remove("panel-open");

    if (activeIframe) activeIframe.classList.remove("open");
    if (activeBackdrop) activeBackdrop.classList.remove("open");

    setTimeout(() => {
      if (activeIframe)   { activeIframe.remove();   activeIframe   = null; }
      if (activeBackdrop) { activeBackdrop.remove();  activeBackdrop = null; }
    }, 400);
  }

  // ─── 10. FAB Ready-Check & Deferred Injection ──────────────────────────────────
  /**
   * Copilot and Grok take 1–4 s after DOMContentLoaded to render their root
   * shell. We poll every 300 ms (up to ~15 s) so the FAB is injected as soon
   * as document.body is ready and stable enough to accept children.
   *
   * For non-Copilot sites this resolves almost instantly.
   *
   * IMPORTANT: This function clears fabRetryTimer before rescheduling so that
   * concurrent calls to scheduleFABWithRetry don't pile up timers.
   */
  function scheduleFABWithRetry(maxAttempts, intervalMs) {
    // Cancel any existing retry loop before starting a new one
    if (fabRetryTimer) {
      clearTimeout(fabRetryTimer);
      fabRetryTimer = null;
    }

    let attempts = 0;

    function attempt() {
      fabRetryTimer = null;

      // Already alive — done
      if (isFABAlive()) return;

      {
        const added = initializeFAB();
        if (added) return; // Success — stop retrying
      }

      // Not yet added — schedule next attempt
      if (attempts < maxAttempts) {
        attempts++;
        fabRetryTimer = setTimeout(attempt, intervalMs);
      } else {
        console.warn("[PromptVault] FAB injection failed after", maxAttempts, "attempts");
      }
    }

    attempt();
  }

  // ─── 11. Copilot DOM Guardian ─────────────────────────────────────────────────
  /**
   * Copilot can silently remove document.body children (including our FAB)
   * during React reconciliation passes without firing predictable mutation events.
   * This guardian runs every 1.5 s and re-injects the FAB if it went missing.
   *
   * This is intentionally low-frequency to avoid performance impact on other
   * platforms; it is only started for Copilot tabs.
   */
  function startCopilotGuardian() {
    if (guardianTimer) return; // already running

    function check() {
      if (!isSupportedRuntimePage()) {
        removeFAB();
        guardianTimer = setTimeout(check, 1500);
        return;
      }
      if (!isFABAlive()) {
        console.debug("[PromptVault] Guardian: FAB missing, re-injecting...");
        initializeFAB();
      }
      guardianTimer = setTimeout(check, 1500);
    }

    guardianTimer = setTimeout(check, 1500);
  }

  // ─── 12. SPA Navigation Watchdog ──────────────────────────────────────────────
  /**
   * Handles pushState/replaceState/popstate navigation on SPAs.
   * Debounce is 300 ms so Copilot's multi-phase render cycle has time to settle.
   * After a URL change we kick off a 300 ms retry loop for up to ~12 s.
   */
  function onUrlChange() {
    const currentUrl = window.location.href;
    if (currentUrl === spaLastUrl) return;
    spaLastUrl = currentUrl;

    // Tear down any open panel (its iframe src is now stale)
    if (activeIframe)   { activeIframe.remove();   activeIframe   = null; }
    if (activeBackdrop) { activeBackdrop.remove();  activeBackdrop = null; }
    fabElement = null;

    // Re-inject FAB — for Copilot use retry loop since the body may be wiped
    if (!isSupportedRuntimePage()) {
      removeFAB();
      return;
    }

    if (isCopilot()) {
      startCopilotGuardian();
      scheduleFABWithRetry(40, 300); // up to ~12 s
    } else {
      if (!isFABAlive()) initializeFAB();
    }
  }

  function onDomMutation() {
    clearTimeout(fabWatchTimer);
    fabWatchTimer = setTimeout(() => {
      // Check for URL change (SPA navigation)
      onUrlChange();

      if (!isSupportedRuntimePage()) return;

      // Re-inject FAB if it has been removed from the DOM
      if (!isFABAlive()) {
        if (isCopilot()) {
          scheduleFABWithRetry(30, 300); // up to ~9 s
        } else {
          initializeFAB();
        }
      }
    }, 300); // 300 ms debounce — gives Copilot time to settle
  }

  // Intercept History API calls directly — these do NOT always fire DOM
  // mutations so the MutationObserver might miss pure pushState navigations.
  (function patchHistoryAPI() {
    function wrapHistoryMethod(method) {
      const orig = history[method];
      history[method] = function (...args) {
        const result = orig.apply(this, args);
        // After pushState/replaceState the URL has changed — trigger watchdog
        setTimeout(onDomMutation, 50); // slight delay to let the URL settle
        return result;
      };
    }
    // Guard against double-patching if the script ever somehow re-runs
    if (!history.__pvPatched) {
      wrapHistoryMethod("pushState");
      wrapHistoryMethod("replaceState");
      history.__pvPatched = true;
    }
    window.addEventListener("popstate", onDomMutation);
  })();

  const spaObserver = new MutationObserver(onDomMutation);
  spaObserver.observe(document, { childList: true, subtree: true });

  // ─── 13. Initial Injection ────────────────────────────────────────────────────
  if (isSupportedRuntimePage() && isCopilot()) {
    // Copilot renders its shell asynchronously — poll until ready, then guard
    const doInit = () => {
      scheduleFABWithRetry(40, 300); // up to ~12 s
      startCopilotGuardian();
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", doInit, { once: true });
    } else {
      doInit();
    }
  } else if (isSupportedRuntimePage()) {
    initializeFAB();
  }

  // ─── 14. Messaging Bus ────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // Ping handler — lets popup.js confirm the content script is alive on this tab
    if (message.action === "ping") {
      sendResponse({ ok: true });
      return true;
    }

    if (message.action === "toggle-promptvault-sidebar") {
      toggleSidebar();

    } else if (message.action === "paste-prompt") {
      insertPromptText(message.text);
      closeSidebar();

    } else if (message.action === "spa-navigated") {
      // Background script detected a SPA pushState navigation.
      if (activeIframe)   { activeIframe.remove();   activeIframe   = null; }
      if (activeBackdrop) { activeBackdrop.remove();  activeBackdrop = null; }
      fabElement = null;

      if (!isSupportedRuntimePage()) {
        removeFAB();
        return;
      }

      // Use retry loop so we handle Copilot's slow render
      const delay = isCopilot() ? 500 : 250;
      setTimeout(() => {
        if (!isFABAlive()) {
          if (isCopilot()) {
            startCopilotGuardian();
            scheduleFABWithRetry(20, 300);
          } else {
            initializeFAB();
          }
        }
      }, delay);
    }
  });

  // Cross-frame messages from the popup iframe
  window.addEventListener("message", (event) => {
    if (event.data?.source === "promptvault-embed") {
      if (event.data.action === "paste") {
        insertPromptText(event.data.text);
        closeSidebar();
      } else if (event.data.action === "close") {
        closeSidebar();
      }
    }
  });
})();
