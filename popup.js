/**
 * PromptVault AI - Popover & Embedded Controller
 * Fully functional javascript module handling library grids, variable parsing drawers,
 * JSON imports/exports, and Gemini AI optimizations via the full-stack server proxy.
 *
 * Supports two contexts:
 *  1. Injected sidebar (isEmbed=true)  — loaded inside an iframe by content.js
 *  2. Browser toolbar popup (isPopupMode) — opened directly by Chrome
 */

// --- Initialize PromptVault logic directly ---
  // 1. Context and URL Parameter detection
  const urlParams     = new URLSearchParams(window.location.search);
  const isEmbed       = urlParams.get("embed") === "true";
  const activePlatform = urlParams.get("platform") || "Active";

  // True when opened from the browser toolbar (not inside the sidebar iframe)
  const isPopupMode   = !isEmbed && (window === window.top);

  // Elements
  const body = document.body;
  const platformBadge = document.getElementById("platform-badge");
  const closeSideBtn = document.getElementById("close-side-panel-btn");
  const themeToggleBtn = document.getElementById("theme-toggle-btn");
  const sunIcon = themeToggleBtn.querySelector(".sun-icon");
  const moonIcon = themeToggleBtn.querySelector(".moon-icon");

  const searchBar = document.getElementById("search-bar");
  const promptsList = document.getElementById("prompts-list");
  const promptCountBadge = document.getElementById("prompt-count-badge");
  const emptyResultsState = document.getElementById("empty-results-state");
  const categoryScroller = document.getElementById("category-scroller");

  // Form elements
  const addPromptBtn = document.getElementById("add-prompt-btn");
  const createFirstPromptBtn = document.getElementById("create-first-prompt-btn");
  const promptFormOverlay = document.getElementById("prompt-form-overlay");
  const closeDrawerBtn = document.getElementById("close-drawer-btn");
  const cancelDrawerBtn = document.getElementById("cancel-drawer-btn");
  const promptEditorForm = document.getElementById("prompt-editor-form");
  const drawerTitleText = document.getElementById("drawer-title");
  
  // Form fields
  const editIdValue = document.getElementById("edit-id-value");
  const promptTitleInput = document.getElementById("prompt-title-input");
  const promptCategoryInput = document.getElementById("prompt-category-input");
  const promptTagsInput = document.getElementById("prompt-tags-input");
  const promptContentInput = document.getElementById("prompt-content-input");
  const promptFavoriteCheckbox = document.getElementById("prompt-favorite-checkbox");
  const aiOptimizeBtn = document.getElementById("ai-optimize-btn");

  // Variable Filler elements
  const variableFillerOverlay = document.getElementById("variable-filler-overlay");
  const closeFillerBtn = document.getElementById("close-filler-btn");
  const cancelFillerBtn = document.getElementById("cancel-filler-btn");
  const variableForm = document.getElementById("variable-form");
  const variableInputsContainer = document.getElementById("variable-inputs-container");
  const variableFillerActionBtn = variableForm.querySelector(".fill-action-btn");

  // Backup Elements
  const backupBtn = document.getElementById("backup-btn");
  const restoreBtn = document.getElementById("restore-btn");
  const fileRestoreInput = document.getElementById("file-restore-input");

  // Delete Confirmation Modal Elements
  const deleteConfirmOverlay = document.getElementById("delete-confirm-overlay");
  const deleteModalCard = document.getElementById("delete-modal-card");
  const deleteModalPromptName = document.getElementById("delete-modal-prompt-name");
  const deleteModalCancelBtn = document.getElementById("delete-modal-cancel-btn");
  const deleteModalConfirmBtn = document.getElementById("delete-modal-confirm-btn");

  // State
  let allPrompts = [];
  let currentCategoryFilter = "ALL";
  let searchQuery = "";
  let activeTemplateToFill = null;
  let pendingDeleteId = null;
  let siteSupported = false; // Whether the current tab has the content script running

  // ── Apply popup-mode class to body immediately ──────────────────────────────
  if (isPopupMode) {
    body.classList.add("popup-mode");
  }

  // ── Sidebar close button (embed only) ───────────────────────────────────────
  if (isEmbed) {
    closeSideBtn.classList.remove("hidden");
  }

  // 2. Cross-Environment Storage Layer (Supports Chrome Storage API and standard localStorage Fallbacks)
  const StorageEngine = {
    get: function(key, callback) {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([key], (res) => callback(res[key]));
      } else {
        const val = localStorage.getItem(key);
        callback(val ? JSON.parse(val) : null);
      }
    },
    set: function(key, value, callback) {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [key]: value }, callback);
      } else {
        localStorage.setItem(key, JSON.stringify(value));
        if (callback) callback();
      }
    }
  };

  // 3. Theme management Loading
  StorageEngine.get("promptvault_theme", (savedTheme) => {
    if (savedTheme === "theme-light") {
      body.className = body.className.replace(/theme-\S+/, "").trim() + " theme-light";
      if (isPopupMode) body.classList.add("popup-mode");
      sunIcon.classList.remove("hidden");
      moonIcon.classList.add("hidden");
    } else {
      body.className = body.className.replace(/theme-\S+/, "").trim() + " theme-dark";
      if (isPopupMode) body.classList.add("popup-mode");
      sunIcon.classList.add("hidden");
      moonIcon.classList.remove("hidden");
    }
  });

  themeToggleBtn.addEventListener("click", () => {
    if (body.classList.contains("theme-dark")) {
      body.classList.replace("theme-dark", "theme-light");
      sunIcon.classList.remove("hidden");
      moonIcon.classList.add("hidden");
      StorageEngine.set("promptvault_theme", "theme-light");
    } else {
      body.classList.replace("theme-light", "theme-dark");
      sunIcon.classList.add("hidden");
      moonIcon.classList.remove("hidden");
      StorageEngine.set("promptvault_theme", "theme-dark");
    }
  });

  // Close direct embedded panel action
  closeSideBtn.addEventListener("click", () => {
    if (isEmbed) {
      window.parent.postMessage({ source: "promptvault-embed", action: "close" }, "*");
    }
  });

  // ── Content-script availability check (popup mode only) ─────────────────────
  /**
   * Pings the active tab's content script.
   * Resolves true if the script is present (AI website), false otherwise.
   */
  function isContentScriptAvailable() {
    return new Promise(resolve => {
      if (!isPopupMode) { resolve(false); return; }
      if (typeof chrome === "undefined" || !chrome.tabs) { resolve(false); return; }
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (!tabs[0]?.id) { resolve(false); return; }
        chrome.tabs.sendMessage(tabs[0].id, { action: "ping" }, resp => {
          const err = chrome.runtime.lastError; // must always be read to suppress warnings
          resolve(!err && resp?.ok === true);
        });
      });
    });
  }

  /** Map a hostname to a friendly AI platform label */
  function platformFromUrl(url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      const path = new URL(url).pathname.toLowerCase();
      const params = new URL(url).searchParams;
      const isBingHost = host === "bing.com" || host.endsWith(".bing.com");
      if (host.includes("chatgpt.com"))           return "ChatGPT";
      if (host.includes("gemini.google.com"))     return "Gemini";
      if (host.includes("grok.com"))              return "Grok";
      if (host.includes("claude.ai"))             return "Claude";
      if (host.includes("perplexity.ai"))         return "Perplexity";
      if (host.includes("deepseek.com"))          return "DeepSeek";
      if (host.includes("copilot.microsoft.com")) return "Copilot";
      if (host === "m365.cloud.microsoft" && path.startsWith("/chat")) return "Copilot";
      if (isBingHost && (
        path.startsWith("/chat") ||
        path.startsWith("/copilot") ||
        (path.startsWith("/search") && (
          params.has("showconv") ||
          params.has("sendquery") ||
          params.get("form") === "MA13FV"
        ))
      )) return "Copilot";
    } catch (_) { /* ignore invalid URLs */ }
    return null;
  }

  /** Initialise popup-mode UI: detect site support and update badge accordingly */
  async function initPopupMode() {
    if (!isPopupMode) return;

    siteSupported = await isContentScriptAvailable();

    if (siteSupported) {
      // Resolve the actual platform name from the active tab URL
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const name = tabs[0]?.url ? platformFromUrl(tabs[0].url) : null;
        platformBadge.textContent = name || "Supported";
        platformBadge.className = "platform-badge badge-active";
      });
    } else {
      platformBadge.textContent = "Browse & Copy";
      platformBadge.className = "platform-badge badge-neutral";
      // Inject the "paste unavailable" notice above the prompt list
      showPasteUnavailableNotice();
    }

    // Re-render cards now that siteSupported is known
    renderPrompts();
  }

  /** Injects a dismissible notice at the top of the list viewport */
  function showPasteUnavailableNotice() {
    if (document.getElementById("paste-unavailable-notice")) return;
    const notice = document.createElement("div");
    notice.id = "paste-unavailable-notice";
    notice.className = "paste-unavailable-notice";
    notice.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>
      </svg>
      <span>Open an AI website (ChatGPT, Gemini, Claude…) to paste prompts directly. <strong>Clicking a prompt will copy it to clipboard instead.</strong></span>
    `;
    const listViewport = document.querySelector(".list-viewport");
    if (listViewport) listViewport.prepend(notice);
  }

  // 4. Loading default prompts if storage is blank
  function loadPromptsFromStorage() {
    StorageEngine.get("promptvault_prompts", (stored) => {
      if (stored && Array.isArray(stored)) {
        allPrompts = stored;
        renderPrompts();
      } else {
        // Fallback mock prompt templates
        allPrompts = [
          {
            id: "p1",
            title: "Remove Background Professional",
            category: "Image Editing",
            content: "Act as an expert image editor. Analyze the uploaded image and remove the entire background while preserving fine details such as hair, fur, transparent objects, shadows, and edges. Return a clean professional result suitable for product photography and graphic design.",
            tags: ["image", "background", "professional"],
            isFavorite: true,
            variables: []
          },
          {
            id: "p2",
            title: "Refactor Python Code for Cleanliness",
            category: "Coding",
            content: "You are an expert Python Software Architect. Analyze the following python code piece and refactor it in accordance with PEP 8 rules, type safety, modular performance and readability metrics. Add minimal clean docstrings under classes and methods.\n\nCode to refactor:\n{{code}}",
            tags: ["python", "clean-code", "oop"],
            isFavorite: false,
            variables: ["code"]
          },
          {
            id: "p3",
            title: "Optimize SEO Analytics Blogpost",
            category: "Writing",
            content: "Act as an expert SEO Copywriter. Review my draft about {{topic}} targeting the primary keyword {{keyword}}. Optimize the paragraph structure, readability metrics, and heading structure while maintaining an engaging, natural {{tone}} tone for an audience interest of {{audience}}.",
            tags: ["seo", "blogging", "optimized"],
            isFavorite: true,
            variables: ["topic", "keyword", "tone", "audience"]
          },
          {
            id: "p4",
            title: "Ultimate Socratic Code Tutor",
            category: "Education",
            content: "You are an elite tutor in computer science. Your response style should be strictly Socratic: do not give me the complete code solution directly. Instead, ask guided questions about my current implementation to lead me step-by-step toward the correct algorithmic insights. Let's study: {{subject}}",
            tags: ["tutor", "pedagogy", "interactive"],
            isFavorite: false,
            variables: ["subject"]
          }
        ];
        StorageEngine.set("promptvault_prompts", allPrompts);
        renderPrompts();
      }
    });
  }

  // 5. Template variables detection matcher
  function extractVariables(text) {
    const regex = /\{\{([^}]+)\}\}/g;
    const matches = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      const varName = match[1].trim();
      if (!matches.includes(varName)) {
        matches.push(varName);
      }
    }
    return matches;
  }

  // 6. Primary Rendering Core
  function renderPrompts() {
    promptsList.innerHTML = "";
    
    // Filter logic
    let filtered = allPrompts.filter(p => {
      // Category matches
      if (currentCategoryFilter === "FAVORITES") {
        if (!p.isFavorite) return false;
      } else if (currentCategoryFilter !== "ALL" && p.category !== currentCategoryFilter) {
        return false;
      }

      // Search matches (Title, Category, Snippet, or Tags)
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const textToSearch = `${p.title} ${p.category} ${p.content} ${p.tags.join(" ")}`.toLowerCase();
        return textToSearch.includes(query);
      }

      return true;
    });

    // Sort order: Favorites always rise to top, then alphabetical template names
    filtered.sort((a, b) => {
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      return a.title.localeCompare(b.title);
    });

    // Update Counter
    promptCountBadge.innerText = `${filtered.length} Prompt${filtered.length === 1 ? "" : "s"} Available`;

    if (filtered.length === 0) {
      emptyResultsState.classList.remove("hidden");
      promptsList.classList.add("hidden");
    } else {
      emptyResultsState.classList.add("hidden");
      promptsList.classList.remove("hidden");

      filtered.forEach((p) => {
        const vars = extractVariables(p.content);
        const cardClass = vars.length > 0 ? "prompt-card contains-variables" : "prompt-card";
        
        const card = document.createElement("div");
        card.className = cardClass;
        card.dataset.id = p.id;

        const pTags = Array.isArray(p.tags) ? p.tags : [];
        const tagBadges = pTags.map(t => `<span class="tag-badge">#${t}</span>`).join("");

        const pContent = p.content || "";
        const pTitle = p.title || "";

        // In popup mode on unsupported sites show "Copy" pill; otherwise show normal paste/variable pill
        let actionPill;
        if (isPopupMode && !siteSupported) {
          actionPill = `<span class="paste-pill paste-copy-mode">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            Copy
          </span>`;
        } else if (vars.length > 0) {
          actionPill = `<span class="paste-pill" style="color: var(--accent-orange)"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="3"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M2 12h2"/><path d="M20 12h2"/></svg>${vars.length} Variable${vars.length === 1 ? '' : 's'}</span>`;
        } else {
          actionPill = `<span class="paste-pill"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>Quick Paste</span>`;
        }

        card.innerHTML = `
          <div class="prompt-card-header">
            <div>
              <span class="prompt-card-category">${p.category}</span>
              <h3 class="prompt-card-title">${escapeHTML(pTitle)}</h3>
            </div>
            <div class="prompt-card-actions">
              <button class="inline-action-btn star-icon-btn ${p.isFavorite ? 'active' : ''}" data-id="${p.id}" title="${p.isFavorite ? 'Remove Favorite' : 'Mark Favorite'}">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="${p.isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              </button>
              <button class="inline-action-btn edit-icon-btn" data-id="${p.id}" title="Edit Template">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              </button>
              <button class="inline-action-btn clone-icon-btn" data-id="${p.id}" title="Duplicate Template">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
              </button>
              <button class="inline-action-btn delete-icon-btn" data-id="${p.id}" title="Delete Template">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
              </button>
            </div>
          </div>
          <p class="prompt-card-snippet">${escapeHTML(pContent).substring(0, 150)}${pContent.length > 150 ? '...' : ''}</p>
          <div class="prompt-card-footer">
            <div class="tags-shelf">${tagBadges}</div>
            ${actionPill}
          </div>
        `;

        // Card Click Handler
        card.addEventListener("click", (e) => {
          // Ignore if clicking action buttons inside card header
          if (e.target.closest(".inline-action-btn")) return;
          handlePromptTrigger(p);
        });

        // Favorite Toggle action click
        card.querySelector(".star-icon-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          p.isFavorite = !p.isFavorite;
          syncPromptsToStorage();
        });

        // Edit button action click
        card.querySelector(".edit-icon-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          openEditDrawer(p);
        });

        // Duplicate/Clone action click
        card.querySelector(".clone-icon-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          duplicatePrompt(p);
        });

        // Delete action click — opens custom modal instead of native confirm()
        card.querySelector(".delete-icon-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          openDeleteModal(p.id, p.title);
        });

        promptsList.appendChild(card);
      });
    }
  }

  // 7. Click triggers action pasting (handles variables filling drawer logic)
  function handlePromptTrigger(prompt) {
    const vars = extractVariables(prompt.content);
    if (vars.length > 0) {
      activeTemplateToFill = prompt;
      openVariableFiller(vars);
    } else {
      executeTextPaste(prompt.content);
    }
  }

  function openVariableFiller(variables) {
    variableInputsContainer.innerHTML = "";
    
    variables.forEach(vName => {
      const varContainer = document.createElement("div");
      varContainer.className = "variable-item";
      
      // Capitalize for display label
      const beautyLabel = vName.charAt(0).toUpperCase() + vName.slice(1);
      
      varContainer.innerHTML = `
        <label for="var-field-${vName}">${beautyLabel}</label>
        <input type="text" id="var-field-${vName}" data-var="${vName}" placeholder="Provide value for {{${vName}}}" required autocomplete="off">
      `;
      variableInputsContainer.appendChild(varContainer);
    });

    // Update the action button label based on site support
    if (isPopupMode && !siteSupported) {
      variableFillerActionBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
        Copy to Clipboard
      `;
    } else {
      variableFillerActionBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 2v2"/><path d="m11.5 7.5-1.3-1.3"/><path d="m8.5 7.5 1.3-1.3"/><circle cx="10" cy="11" r="5"/><path d="M10 14V8"/></svg>
        Paste into Chat
      `;
    }

    variableFillerOverlay.classList.remove("hidden");
    
    // Focus first input automatically
    setTimeout(() => {
      const firstInput = variableInputsContainer.querySelector("input");
      if (firstInput) firstInput.focus();
    }, 100);
  }

  // Submit filled variable forms
  variableForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!activeTemplateToFill) return;

    let finalPromptContent = activeTemplateToFill.content;
    const inputFields = variableInputsContainer.querySelectorAll("input");
    
    inputFields.forEach(input => {
      const keyName = input.getAttribute("data-var");
      const userVal = input.value || "";
      // Replace matching {{keyName}} globally
      const regex = new RegExp(`\\{\\{\\s*${keyName}\\s*\\}\\}`, "g");
      finalPromptContent = finalPromptContent.replace(regex, userVal);
    });

    // Close Modal overlay and Paste
    variableFillerOverlay.classList.add("hidden");
    executeTextPaste(finalPromptContent);
    activeTemplateToFill = null;
  });

  // 8. Direct pasting pipeline
  async function executeTextPaste(textToPaste) {
    if (isEmbed) {
      // Send message to outer parent window context (sidebar path — unchanged)
      window.parent.postMessage({
        source: "promptvault-embed",
        action: "paste",
        text: textToPaste
      }, "*");
      return;
    }

    if (isPopupMode) {
      if (siteSupported) {
        // Content script is present — paste directly into the AI site
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: "paste-prompt",
              text: textToPaste
            });
            window.close(); // Close popup after injecting
          }
        });
      } else {
        // Unsupported site — copy to clipboard and show a toast notice
        try {
          await navigator.clipboard.writeText(textToPaste);
          showPopupToast("✅ Copied to clipboard! Paste it into your AI chat.");
        } catch (_) {
          showPopupToast("⚠️ Clipboard access denied. Please copy the prompt manually.");
        }
      }
      return;
    }

    // Non-embed, non-popup (e.g. playground / demo)
    if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: "paste-prompt",
            text: textToPaste
          });
          window.close();
        } else {
          navigator.clipboard.writeText(textToPaste);
          alert("Success! Copied prompt template to clipboard. Go ahead and paste (Cmd+V) inside your AI Chat!");
        }
      });
    } else {
      // App playground demo clipboard fallback handling
      navigator.clipboard.writeText(textToPaste);
      const copyToast = document.createElement("div");
      copyToast.innerText = "Prompt copied to clipboard! Ready to paste into the simulated screen.";
      copyToast.style.cssText = `
        position: fixed; left: 50%; bottom: 80px; transform: translateX(-50%);
        background: #10b981; color: white; padding: 10px 18px; border-radius: 8px;
        font-weight: 500; font-size: 13px; z-index: 10002; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.3));
      `;
      body.appendChild(copyToast);
      setTimeout(() => copyToast.remove(), 2500);

      // Notify simulated page component directly if running inside our browser applet
      const simulatedEvent = new CustomEvent("demo-prompt-pasted", { detail: { text: textToPaste } });
      window.dispatchEvent(simulatedEvent);
    }
  }

  /** Shows a transient toast notification inside the popup */
  function showPopupToast(message) {
    const existing = document.getElementById("popup-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "popup-toast";
    toast.className = "popup-toast";
    toast.textContent = message;
    body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.classList.add("visible");
    });

    setTimeout(() => {
      toast.classList.remove("visible");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Helper sync logic
  function syncPromptsToStorage() {
    StorageEngine.set("promptvault_prompts", allPrompts, () => {
      renderPrompts();
    });
  }

  function duplicatePrompt(p) {
    const copy = {
      ...p,
      id: "p_" + Date.now(),
      title: p.title + " (Copy)"
    };
    allPrompts.push(copy);
    syncPromptsToStorage();
  }

  // 9. Modal drawers opening & creations
  addPromptBtn.addEventListener("click", () => {
    openAddDrawer();
  });

  createFirstPromptBtn.addEventListener("click", () => {
    openAddDrawer();
  });

  function openAddDrawer() {
    drawerTitleText.innerText = "Add New Prompt";
    editIdValue.value = "";
    promptEditorForm.reset();
    promptFormOverlay.classList.remove("hidden");
    setTimeout(() => promptTitleInput.focus(), 100);
  }

  function openEditDrawer(p) {
    drawerTitleText.innerText = "Edit Template";
    editIdValue.value = p.id;
    promptTitleInput.value = p.title;
    promptCategoryInput.value = p.category;
    promptTagsInput.value = p.tags.join(", ");
    promptContentInput.value = p.content;
    promptFavoriteCheckbox.checked = p.isFavorite || false;
    promptFormOverlay.classList.remove("hidden");
    setTimeout(() => promptTitleInput.focus(), 100);
  }

  function closeDrawer() {
    promptFormOverlay.classList.add("hidden");
  }

  closeDrawerBtn.addEventListener("click", closeDrawer);
  cancelDrawerBtn.addEventListener("click", closeDrawer);

  promptEditorForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const editingId = editIdValue.value;
    const titleVal = promptTitleInput.value.trim();
    const catVal = promptCategoryInput.value;
    const contentVal = promptContentInput.value.trim();
    const faveVal = promptFavoriteCheckbox.checked;
    
    // Parse tags list
    const rawTags = promptTagsInput.value;
    const parsedTags = rawTags 
      ? rawTags.split(",").map(t => t.trim().toLowerCase()).filter(t => t !== "") 
      : [];

    if (editingId) {
      // Edit existing
      allPrompts = allPrompts.map(item => {
        if (item.id === editingId) {
          return {
            ...item,
            title: titleVal,
            category: catVal,
            content: contentVal,
            tags: parsedTags,
            isFavorite: faveVal
          };
        }
        return item;
      });
    } else {
      // Create new
      const newPrompt = {
        id: "p_" + Date.now(),
        title: titleVal,
        category: catVal,
        content: contentVal,
        tags: parsedTags,
        isFavorite: faveVal,
        variables: []
      };
      allPrompts.push(newPrompt);
    }

    syncPromptsToStorage();
    closeDrawer();
  });

  // 10. AI Optimization leveraging server-side Proxy
  aiOptimizeBtn.addEventListener("click", async () => {
    const currentText = promptContentInput.value.trim();
    if (!currentText) {
      alert("Please enter a basic prompt template instructions first to enhance!");
      return;
    }

    const initialText = aiOptimizeBtn.innerHTML;
    aiOptimizeBtn.disabled = true;
    aiOptimizeBtn.innerHTML = `
      <svg class="sparkles-icon animate-spin" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
      </svg>
      Optimizing...
    `;

    try {
      const response = await fetch("/api/enhance-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: currentText,
          category: promptCategoryInput.value,
          title: promptTitleInput.value
        })
      });

      if (!response.ok) {
        throw new Error("Proxy error call failing.");
      }

      const result = await response.json();
      if (result.enhanced) {
        promptContentInput.value = result.enhanced;
        if (result.explanation) {
          // Put the explanation in a subtle alerts toast or log
          const toast = document.createElement("div");
          toast.className = "ai-toast-explanation";
          toast.innerHTML = `
            <strong>Refinement success:</strong><br>
            ${result.explanation}
          `;
          toast.style.cssText = `
            position: fixed; top: 12px; left: 50%; transform: translateX(-50%); width: 85%; max-width: 340px;
            background: #1e1b4b; color: #a5b4fc; border: 1px solid #4f46e5; border-radius: 8px; padding: 10px 14px;
            font-size: 11.5px; z-index: 10005; box-shadow: 0 10px 25px rgba(0,0,0,0.4); pointer-events: none;
          `;
          body.appendChild(toast);
          setTimeout(() => toast.remove(), 7000);
        }
      }
    } catch (err) {
      console.error("AI service error:", err);
      alert("AI optimization fallback check: We couldn't connect to server optimizer route. Restructuring locally instead!");
      
      // Dynamic client-side skeleton refractor fallback
      const cat = promptCategoryInput.value || "Expert";
      promptContentInput.value = `Act as an expert ${cat}. Provide highly structured answers avoiding lazy generic structures:\n\nObjective: ${promptTitleInput.value || "Refine template"}\n\nTasks:\n- Perform ${currentText}\n\nConstraints:\n- Be clear, exhaustive, and precise.`;
    } finally {
      aiOptimizeBtn.disabled = false;
      aiOptimizeBtn.innerHTML = initialText;
    }
  });

  // 11. Search and Filtering hooks
  searchBar.addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    renderPrompts();
  });

  categoryScroller.addEventListener("click", (e) => {
    const pill = e.target.closest(".category-pill");
    if (!pill) return;
    
    categoryScroller.querySelectorAll(".category-pill").forEach(p => p.classList.remove("active"));
    pill.classList.add("active");
    
    currentCategoryFilter = pill.getAttribute("data-category");
    renderPrompts();
  });

  // Auto-scroll category strip on hover near edges (no shift+scroll needed)
  (function initCategoryHoverScroll() {
    const EDGE_ZONE = 52;     // px from edge that triggers scrolling
    const MAX_SPEED = 7;      // max px per frame at the very edge
    let scrollRaf = null;
    let isHovering = false;
    let cursorX = 0;          // cursor X relative to scroller left

    function getScrollSpeed() {
      const w = categoryScroller.clientWidth;
      if (cursorX < EDGE_ZONE) {
        // Left zone: speed ramps up as cursor moves further left
        const ratio = 1 - (cursorX / EDGE_ZONE);      // 0..1, 1 = at very edge
        return -Math.ceil(ratio * MAX_SPEED);
      } else if (cursorX > w - EDGE_ZONE) {
        // Right zone: speed ramps up as cursor moves further right
        const ratio = 1 - ((w - cursorX) / EDGE_ZONE); // 0..1
        return Math.ceil(ratio * MAX_SPEED);
      }
      return 0;
    }

    function scrollLoop() {
      if (!isHovering) { scrollRaf = null; return; }

      const speed = getScrollSpeed();
      if (speed !== 0) {
        const maxScroll = categoryScroller.scrollWidth - categoryScroller.clientWidth;
        categoryScroller.scrollLeft = Math.max(0, Math.min(maxScroll, categoryScroller.scrollLeft + speed));
      }

      scrollRaf = requestAnimationFrame(scrollLoop);
    }

    categoryScroller.addEventListener("mousemove", (e) => {
      const rect = categoryScroller.getBoundingClientRect();
      cursorX = e.clientX - rect.left;

      if (!isHovering) {
        isHovering = true;
        if (!scrollRaf) scrollRaf = requestAnimationFrame(scrollLoop);
      }
    });

    categoryScroller.addEventListener("mouseleave", () => {
      isHovering = false;
      cursorX = 0;
      if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = null; }
    });

    // Manual horizontal scrolling via mouse wheel / trackpad while hovering
    // Converts vertical delta → horizontal scroll so no Shift key is needed
    categoryScroller.addEventListener("wheel", (e) => {
      // Honour native horizontal swipe (trackpads that send deltaX directly)
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      e.preventDefault(); // stop the page from scrolling vertically
      categoryScroller.scrollBy({ left: delta * 1.4, behavior: "auto" });
    }, { passive: false });
  })();

  // 12. Custom Delete Confirmation Modal
  function openDeleteModal(promptId, promptTitle) {
    pendingDeleteId = promptId;
    // Populate the prompt name shown in the dialog body
    deleteModalPromptName.textContent = `"${promptTitle}"`;
    // Show overlay
    deleteConfirmOverlay.classList.remove("hidden");
    // Focus the Cancel button by default to prevent accidental deletes on Enter key
    setTimeout(() => deleteModalCancelBtn.focus(), 50);
  }

  function closeDeleteModal() {
    pendingDeleteId = null;
    deleteConfirmOverlay.classList.add("hidden");
  }

  // Cancel button
  deleteModalCancelBtn.addEventListener("click", () => {
    closeDeleteModal();
  });

  // Confirm (Delete) button
  deleteModalConfirmBtn.addEventListener("click", () => {
    if (!pendingDeleteId) return;
    allPrompts = allPrompts.filter(p => p.id !== pendingDeleteId);
    syncPromptsToStorage();
    closeDeleteModal();
  });

  // Click outside the card to dismiss
  deleteConfirmOverlay.addEventListener("click", (e) => {
    if (!deleteModalCard.contains(e.target)) {
      closeDeleteModal();
    }
  });

  // Keyboard: Escape closes the modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !deleteConfirmOverlay.classList.contains("hidden")) {
      closeDeleteModal();
    }
  });

  // 13. Backup file actions Export JSON
  backupBtn.addEventListener("click", () => {
    const strData = JSON.stringify(allPrompts, null, 2);
    const dataBlob = new Blob([strData], { type: "application/json" });
    const url = URL.createObjectURL(dataBlob);
    
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "promptvault_ai_library.json";
    document.body.appendChild(anchor);
    anchor.click();
    
    setTimeout(() => {
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    }, 100);
  });

  // Restore triggers
  restoreBtn.addEventListener("click", () => {
    fileRestoreInput.click();
  });

  fileRestoreInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
      try {
        const importedData = JSON.parse(evt.target.result);
        if (Array.isArray(importedData)) {
          // Deduplicate prompts based on template titles
          const existingTitles = allPrompts.map(p => p.title.toLowerCase());
          const newItems = importedData.filter(p => p.title && !existingTitles.includes(p.title.toLowerCase()));
          
          if (newItems.length === 0) {
            alert("No new unique prompts recognized inside selected backup file!");
            return;
          }

          // Format check
          const formattedItems = newItems.map(item => ({
            id: item.id || "p_" + Date.now() + Math.random().toString(36).substring(2, 5),
            title: item.title,
            category: item.category || "General",
            content: item.content || "",
            tags: Array.isArray(item.tags) ? item.tags : [],
            isFavorite: item.isFavorite || false,
            variables: Array.isArray(item.variables) ? item.variables : []
          }));

          allPrompts = [...allPrompts, ...formattedItems];
          syncPromptsToStorage();
          alert(`Successfully imported ${formattedItems.length} prompt templates from backup!`);
        } else {
          alert("Backup format invalid. Needs to be a valid backup prompt collection array!");
        }
      } catch (err) {
        alert("JSON parsing failed, check that the imported file is format compliant.");
      }
    };
    reader.readAsText(file);
    fileRestoreInput.value = ""; // Reset files selection trigger
  });

  // Closing auxiliary variable fillers
  closeFillerBtn.addEventListener("click", () => {
    variableFillerOverlay.classList.add("hidden");
    activeTemplateToFill = null;
  });

  cancelFillerBtn.addEventListener("click", () => {
    variableFillerOverlay.classList.add("hidden");
    activeTemplateToFill = null;
  });

  // Set visual badge depending on platform (embed/sidebar mode)
  if (isEmbed) {
    platformBadge.textContent = activePlatform;
    platformBadge.className = "platform-badge badge-active";
  }

  // Start runtime loading
  loadPromptsFromStorage();

  // Initialise popup mode (async — detects content script, updates badge, re-renders)
  initPopupMode();

  // Escape HTML helper
  function escapeHTML(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
// --- Finished PromptVault execution init ---
