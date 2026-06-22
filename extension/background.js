const BACKEND_HEALTH_URL = "http://127.0.0.1:8000/";
const BACKEND_NAVIGATE_URL = "http://127.0.0.1:8000/api/v1/navigate";
const BACKEND_VISION_URL = "http://127.0.0.1:8000/api/v1/navigate-vision";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "NAVAI_HEALTH_CHECK") {
    fetch(BACKEND_HEALTH_URL)
      .then((response) => {
        sendResponse({ ok: response.ok });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message && message.type === "NAVAI_CAPTURE_TAB") {
    const windowId = sender.tab ? sender.tab.windowId : chrome.windows.WINDOW_ID_CURRENT;

    chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 70 }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error("[NavAI background] captureVisibleTab failed:", chrome.runtime.lastError.message);
        sendResponse({ error: chrome.runtime.lastError.message });
        return;
      }
      const base64 = dataUrl.split(",")[1];
      sendResponse({ imageBase64: base64 });
    });

    // Return true to indicate we will respond asynchronously.
    return true;
  }

  if (message && message.type === "NAVAI_FETCH_NAVIGATE") {
    fetch(BACKEND_NAVIGATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        sendResponse({ ok: response.ok, status: response.status, data });
      })
      .catch((err) => {
        console.error("[NavAI background] /navigate fetch failed:", err);
        sendResponse({ ok: false, error: err.message || String(err) });
      });
    return true;
  }

  if (message && message.type === "NAVAI_FETCH_VISION") {
    fetch(BACKEND_VISION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        sendResponse({ ok: response.ok, status: response.status, data });
      })
      .catch((err) => {
        console.error("[NavAI background] /navigate-vision fetch failed:", err);
        sendResponse({ ok: false, error: err.message || String(err) });
      });
    return true;
  }
});