/**
 * PromptVault AI - Background Service Worker
 * Manifest V3 compatible service worker handles context menus and SPA navigation.
 */

// Create Context Menu item on installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "insert-prompt",
    title: "Open PromptVault AI Library",
    contexts: ["editable"]
  });
  
  // Set default initial prompts if storage is empty
  chrome.storage.local.get(["promptvault_prompts"], (result) => {
    if (!result.promptvault_prompts) {
      const defaultPrompts = [
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
          content: "You are an expert Python Software Architect. Analyze the following python code piece and refactor it in accordance with PEP 8 layout, type safety, modular performance, and readability metrics. Add minimal clean docstrings under classes and methods.\n\nCode to refactor:\n{{code}}",
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
          content: "You are an elite tutor incomputer science. Your response style should be strictly Socratic: do not give me the complete code solution directly. Instead, ask guided questions about my current implementation to lead me step-by-step toward the correct algorithmic insights. Let's study: {{subject}}",
          tags: ["tutor", "pedagogy", "interactive"],
          isFavorite: false,
          variables: ["subject"]
        }
      ];
      
      chrome.storage.local.set({ promptvault_prompts: defaultPrompts });
    }
  });
});

// Listener for context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "insert-prompt") {
    // Send message to active tab to trigger prompt panel slide-in
    chrome.tabs.sendMessage(tab.id, { action: "toggle-promptvault-sidebar" });
  }
});


// SPA Navigation Watchdog (background layer)
// Fires whenever an AI platform tab navigates via pushState/replaceState
// (History API), which does NOT trigger a full page reload.
// We send a "spa-navigated" message to the content script so it can
// re-inject the FAB if the SPA wiped it during the route change.
const SUPPORTED_HOSTS = [
  "chatgpt.com",
  "gemini.google.com",
  "grok.com",
  "claude.ai",
  "perplexity.ai",
  "deepseek.com",
  "copilot.microsoft.com",
  "bing.com",
  "m365.cloud.microsoft",
  "copilot.cloud.microsoft",
];

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  // Only act on top-level frames (frameId 0), not iframes inside the page
  if (details.frameId !== 0) return;

  try {
    const url  = new URL(details.url);
    const host = url.hostname.toLowerCase();

    const isSupported = SUPPORTED_HOSTS.some((h) => host.includes(h));
    if (!isSupported) return;

    // Notify content script — it will re-inject the FAB if missing
    chrome.tabs.sendMessage(
      details.tabId,
      { action: "spa-navigated", url: details.url },
      // Suppress "no listener" errors from tabs that don't have the content script
      () => void chrome.runtime.lastError
    );
  } catch (_) {
    // Silently ignore URL parse errors
  }
});
