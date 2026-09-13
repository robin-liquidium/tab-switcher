// Query connection status from service worker with actual ping test
const statusEl = document.getElementById("status");
const statusTextEl = document.getElementById("status-text");

// Set initial checking state
statusEl.className = "status disconnected";
statusTextEl.textContent = "Checking connection...";

// Request a real ping test from the service worker
chrome.runtime.sendMessage({ action: "ping_native_host" }, function(response) {
  if (chrome.runtime.lastError) {
    statusEl.className = "status disconnected";
    statusTextEl.textContent = "Extension not responding";
    return;
  }

  if (response && response.connected) {
    statusEl.className = "status connected";
    statusTextEl.textContent = "Connected to Tab Switcher app";
  } else {
    statusEl.className = "status disconnected";
    statusTextEl.textContent = "Not connected — is the app running?";
  }
});

// Version info and update banner
function compareVersions(a, b) {
  var partsA = a.split(".").map(Number);
  var partsB = b.split(".").map(Number);
  for (var i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    var numA = partsA[i] || 0;
    var numB = partsB[i] || 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }
  return 0;
}

var versionLabel = document.getElementById("version-label");
var currentVersion = chrome.runtime.getManifest().version;
versionLabel.textContent = "v" + currentVersion;

// Load custom shortcut display from storage
chrome.storage.local.get("shortcuts", function(data) {
  if (data.shortcuts) {
    document.getElementById("tab-switch-keys").textContent = data.shortcuts.tabSwitch || "Unassigned";
    document.getElementById("copy-url-keys").textContent = data.shortcuts.copyUrl || "Unassigned";
  }
});

chrome.runtime.sendMessage({ action: "get_version_info" }, function(info) {
  if (chrome.runtime.lastError || !info) return;

  var banner = document.getElementById("update-banner");

  // Unpacked extensions are updated by replacing their files and reloading.
  if (info.isManualInstall && info.latestExtensionVersion && compareVersions(currentVersion, info.latestExtensionVersion) < 0) {
    banner.className = "update-banner update";
    banner.innerHTML = 'Update available (v' + info.latestExtensionVersion + ') — <a href="https://github.com/robin-liquidium/tab-switcher#installation" target="_blank">Download</a>';
    banner.style.display = "block";
  }
});

// Saved URLs stay in this browser profile. Use textContent for untrusted titles.
const cleanupList = document.getElementById("auto-closed-list");
const clearHistory = document.getElementById("clear-auto-closed");
const cleanupError = document.getElementById("cleanup-error");

async function updateCleanup(action = "get_auto_close", id) {
  cleanupError.hidden = true;
  cleanupList.querySelectorAll("button").forEach(button => { button.disabled = true; });
  clearHistory.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ action, id });
    if (!result || result.error) throw new Error(result?.error || "Could not load tab cleanup.");
    const { settings, recent } = result;
    const duration = settings.hours < 48 ? `${settings.hours} hour${settings.hours === 1 ? "" : "s"}` : `${settings.hours / 24} days`;
    document.getElementById("cleanup-status").textContent = settings.enabled
      ? `Auto-close after ${duration}. Change this in the Tab Switcher app.`
      : "Auto-close is off. Enable it in the Tab Switcher app.";
    cleanupList.replaceChildren();
    document.getElementById("cleanup-empty").hidden = recent.length > 0;
    clearHistory.hidden = recent.length === 0;
    for (const entry of recent) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.className = "restore-tab";
      button.title = `Reopen ${entry.url}`;
      const title = document.createElement("span");
      title.textContent = entry.title;
      const detail = document.createElement("small");
      detail.textContent = `${new URL(entry.url).hostname} · ${new Date(entry.closedAt).toLocaleDateString()}`;
      button.append(title, detail);
      button.addEventListener("click", () => updateCleanup("restore_auto_closed", entry.id));
      item.append(button);
      cleanupList.append(item);
    }
  } catch (error) {
    cleanupError.textContent = error.message;
    cleanupError.hidden = false;
  } finally {
    cleanupList.querySelectorAll("button").forEach(button => { button.disabled = false; });
    clearHistory.disabled = false;
  }
}

clearHistory.addEventListener("click", () => updateCleanup("clear_auto_closed"));
updateCleanup();
