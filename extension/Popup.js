(function () {
  "use strict";

  const statusDot = document.getElementById("status-dot");
  const statusValue = document.getElementById("status-value");
  const lastCommandValue = document.getElementById("last-command-value");
  const micButton = document.getElementById("mic-trigger");

  function setStatus(state, text) {
    statusDot.className = `dot ${state}`;
    statusValue.textContent = text;
  }

  function checkBackendStatus() {
    setStatus("checking", "Checking...");
    chrome.runtime.sendMessage({ type: "NAVAI_HEALTH_CHECK" }, (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) {
        setStatus("disconnected", "Not reachable");
        micButton.disabled = true;
        return;
      }
      setStatus("connected", "Connected");
      micButton.disabled = false;
    });
  }

  function loadLastCommand() {
    chrome.storage.local.get(["navaiLastCommand"], (result) => {
      const entry = result.navaiLastCommand;
      if (entry && entry.command) {
        const prefix = entry.success ? "✅" : "⚠️";
        lastCommandValue.textContent = `${prefix} "${entry.command}"`;
      }
    });
  }

  function triggerListening() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id) return;

      chrome.tabs.sendMessage(tab.id, { type: "NAVAI_START_LISTENING" }, () => {
        if (chrome.runtime.lastError) {
          lastCommandValue.textContent = "Can't activate mic on this page. Try a regular website.";
          return;
        }
        window.close(); // close popup so the user can see the page's status bubble
      });
    });
  }

  micButton.addEventListener("click", triggerListening);

  checkBackendStatus();
  loadLastCommand();
})();