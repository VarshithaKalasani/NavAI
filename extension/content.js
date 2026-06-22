(function () {
  "use strict";
  
  const NAVAI_ID_ATTR = "data-navai-id";
  const MAX_TEXT_LEN = 80; // keep snapshot small to avoid token overflow
  const TARGET_TAGS = ["a", "button", "input", "textarea", "select", "h1", "h2", "h3", "h4", "h5", "h6", "nav", "section", "article", "main"];

  let idCounter = 0;
  let isListening = false;
  let recognition = null;

  function getElementText(el) {
    let text = "";
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      text = el.getAttribute("aria-label") || el.placeholder || el.name || "";
    } else {
      text = el.getAttribute("aria-label") || el.innerText || el.textContent || "";
    }
    text = text.replace(/\s+/g, " ").trim();
    if (text.length > MAX_TEXT_LEN) {
      text = text.slice(0, MAX_TEXT_LEN) + "...";
    }
    return text;
  }

  function isVisible(el) {
    if (!el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    return true;
  }

  function buildDomSnapshot() {
    const selector = TARGET_TAGS.join(",");
    const candidates = document.querySelectorAll(selector);
    const snapshot = [];

    candidates.forEach((el) => {
      if (!isVisible(el)) return;

      const text = getElementText(el);
      // Skip elements with no usable text/placeholder/label — nothing to match against
      if (!text && el.tagName !== "INPUT" && el.tagName !== "NAV" && el.tagName !== "SECTION") return;

      let navId = el.getAttribute(NAVAI_ID_ATTR);
      if (!navId) {
        navId = el.id ? el.id : `navai-${idCounter++}`;
        el.setAttribute(NAVAI_ID_ATTR, navId);
      }

      const node = {
        id: navId,
        tag: el.tagName.toLowerCase(),
        text: text || null,
      };

      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        node.placeholder = el.placeholder || null;
      }

      snapshot.push(node);
    });

    return snapshot;
  }

  function getRecognition() {
    const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionImpl) {
      speak("Sorry, this browser does not support voice recognition.");
      return null;
    }
    const rec = new SpeechRecognitionImpl();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.maxAlternatives = 1;
    return rec;
  }

  function startListening() {
    if (isListening) return;
    recognition = getRecognition();
    if (!recognition) return;

    isListening = true;
    showStatusBubble("Listening...");

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      showStatusBubble(`Heard: "${transcript}"`);
      handleVoiceCommand(transcript);
    };

    recognition.onerror = (event) => {
      console.error("[NavAI] Speech recognition error:", event.error);
      speak("Sorry, I didn't catch that. Please try again.");
      isListening = false;
      hideStatusBubble();
    };

    recognition.onend = () => {
      isListening = false;
    };

    recognition.start();
  }

  function speak(text) {
    if (!text) return;
    window.speechSynthesis.cancel(); // stop any prior utterance
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  }

  async function handleVoiceCommand(command) {
    showStatusBubble("Thinking...");
    const snapshot = buildDomSnapshot();

    try {
      const result = await sendToBackground("NAVAI_FETCH_NAVIGATE", {
        command,
        dom_snapshot: snapshot,
      });

      if (!result.ok) {
        throw new Error(result.error || `Backend returned ${result.status}`);
      }

      await handleBackendResponse(result.data, command);
    } catch (err) {
      console.error("[NavAI] Request failed:", err);
      speak("Sorry, I could not reach the NavAI server. Please check that it is running.");
      hideStatusBubble();
    }
  }

  function sendToBackground(type, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  async function handleBackendResponse(data, originalCommand) {
    const { target_id, action_type, spoken_response } = data;

    if (action_type === "CAPTURE_SCREEN") {
      showStatusBubble("Looking at the page visually...");
      await runVisionFallback(originalCommand);
      return;
    }

    let success = false;
    if (action_type === "SCROLL_TO" && target_id) {
      const el = document.querySelector(`[${NAVAI_ID_ATTR}="${CSS.escape(target_id)}"]`) || document.getElementById(target_id);
      if (el) {
        scrollAndHighlight(el);
        success = true;
      }
    }

    speak(spoken_response || "Done.");
    saveLastCommand(originalCommand, success);
    hideStatusBubble();
  }

  function saveLastCommand(command, success) {
    try {
      chrome.storage.local.set({
        navaiLastCommand: { command, success, timestamp: Date.now() },
      });
    } catch (e) {
      /* extension context may be invalidated mid-reload; ignore */
    }
  }

  function requestScreenshot() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "NAVAI_CAPTURE_TAB" }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response && response.imageBase64) {
          resolve(response.imageBase64);
        } else {
          reject(new Error("No screenshot returned"));
        }
      });
    });
  }

  async function runVisionFallback(command) {
    try {
      const imageBase64 = await requestScreenshot();

      const result = await sendToBackground("NAVAI_FETCH_VISION", {
        command,
        image_base64: imageBase64,
      });

      if (!result.ok) {
        throw new Error(result.error || `Vision backend returned ${result.status}`);
      }

      const { spoken_response, x, y } = result.data;
      let success = false;

      if (typeof x === "number" && typeof y === "number") {
        const targetEl = document.elementFromPoint(x, y);
        if (targetEl) {
          scrollAndHighlight(targetEl);
          success = true;
        }
      }

      speak(spoken_response || "I found something close to what you asked for.");
      saveLastCommand(command, success);
    } catch (err) {
      console.error("[NavAI] Vision fallback failed:", err);
      speak("Sorry, I could not find that on the page, even after looking visually.");
      saveLastCommand(command, false);
    } finally {
      hideStatusBubble();
    }
  }

  function scrollAndHighlight(el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });

    const originalOutline = el.style.outline;
    const originalTransition = el.style.transition;
    el.style.transition = "outline 0.2s ease-in-out";
    el.style.outline = "3px solid #4F46E5";
    el.style.outlineOffset = "2px";

    setTimeout(() => {
      el.style.outline = originalOutline;
      el.style.transition = originalTransition;
    }, 2500);

    if (typeof el.focus === "function") {
      try {
        el.focus({ preventScroll: true });
      } catch (e) {
        /* some elements are not focusable; ignore */
      }
    }
  }

  function injectUI() {
    if (document.getElementById("navai-mic-button")) return;

    const micButton = document.createElement("button");
    micButton.id = "navai-mic-button";
    micButton.setAttribute("aria-label", "Activate NavAI voice navigation");
    micButton.title = "NavAI: click or press Alt+Shift+N to speak a command";
    micButton.textContent = "🎙";
    Object.assign(micButton.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      width: "56px",
      height: "56px",
      borderRadius: "50%",
      background: "#4F46E5",
      color: "#fff",
      fontSize: "24px",
      border: "none",
      boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
      cursor: "pointer",
      zIndex: "2147483647",
    });
    micButton.addEventListener("click", startListening);
    document.documentElement.appendChild(micButton);

    const statusBubble = document.createElement("div");
    statusBubble.id = "navai-status-bubble";
    Object.assign(statusBubble.style, {
      position: "fixed",
      bottom: "90px",
      right: "24px",
      maxWidth: "260px",
      padding: "10px 14px",
      borderRadius: "8px",
      background: "rgba(17,24,39,0.92)",
      color: "#fff",
      fontSize: "14px",
      fontFamily: "system-ui, sans-serif",
      zIndex: "2147483647",
      display: "none",
    });
    document.documentElement.appendChild(statusBubble);
  }

  function showStatusBubble(text) {
    const bubble = document.getElementById("navai-status-bubble");
    if (bubble) {
      bubble.textContent = text;
      bubble.style.display = "block";
    }
  }

  function hideStatusBubble() {
    const bubble = document.getElementById("navai-status-bubble");
    if (bubble) {
      setTimeout(() => {
        bubble.style.display = "none";
      }, 1800);
    }
  }

  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.shiftKey && e.key.toUpperCase() === "N") {
      startListening();
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "NAVAI_START_LISTENING") {
      startListening();
      sendResponse({ started: true });
    }
  });

  function announcePage() {
    const title = document.title ? document.title.trim() : "this page";

    const landmarks = [];
    if (document.querySelector("nav")) landmarks.push("a navigation menu");
    if (document.querySelector('input[type="search"], input[type="text"][placeholder*="search" i], [role="search"]')) {
      landmarks.push("a search bar");
    }
    if (document.querySelector("form")) landmarks.push("a form");
    if (document.querySelectorAll("h1, h2").length > 3) landmarks.push("several sections");

    let summary = `You are on ${title}.`;
    if (landmarks.length > 0) {
      summary += ` This page has ${landmarks.join(", ")}.`;
    }
    summary += " Say a command, or press Alt Shift N, to navigate.";

    speak(summary);
  }

  const observer = new MutationObserver(() => {
  });
  observer.observe(document.body, { childList: true, subtree: true });

  function init() {
    injectUI();
    setTimeout(announcePage, 800);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();