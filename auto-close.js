// Runs independently of the native app. Tab IDs are kept only for this browser
// session; after a browser restart, use Chromium's own lastAccessed timestamps.
function createTabAutoClose(chrome, isSwitching = () => false) {
  const ALARM = "auto-close-tabs";
  const HOURS = [1, 6, 12, 24, 48, 168, 720];
  const HOUR = 60 * 60 * 1000;
  let settings = { enabled: false, hours: 24, enabledSince: 0 };
  let recent = [], viewed = {}, activeByWindow = {};
  let revision = 0;
  let pendingChanges = 0;

  function normalize(value) {
    return { enabled: value?.enabled === true, hours: HOURS.includes(value?.hours) ? value.hours : 24 };
  }

  async function configureAlarm() {
    if (!settings.enabled) {
      await chrome.alarms.clear(ALARM);
    } else if (!await chrome.alarms.get(ALARM)) {
      await chrome.alarms.create(ALARM, { periodInMinutes: 5 });
    }
  }

  const ready = (async () => {
    const local = await chrome.storage.local.get(["autoCloseSettings", "autoClosedTabs"]);
    settings = { ...normalize(local.autoCloseSettings), enabledSince: local.autoCloseSettings?.enabledSince || Date.now() };
    recent = local.autoClosedTabs || [];
    const session = await chrome.storage.session.get("autoCloseViewed");
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      viewed[tab.id] = session.autoCloseViewed?.[tab.id] || tab.lastAccessed || Date.now();
      if (tab.active) activeByWindow[tab.windowId] = tab.id;
    }
    await chrome.storage.session.set({ autoCloseViewed: viewed });
    await configureAlarm();
  })();

  // Serialize storage changes, sweeps, and restores. Events invalidate a sweep
  // immediately, before their queued writes, so a newly viewed tab is protected.
  let queue = ready.catch(() => {});
  function enqueue(operation) {
    const result = queue.then(async () => { await ready; return operation(); });
    queue = result.catch(error => console.error("Tab auto-close:", error));
    return result;
  }

  function change(operation) {
    revision++;
    pendingChanges++;
    return enqueue(async () => {
      try { return await operation(); }
      finally { pendingChanges--; }
    });
  }

  function eligible(tab, now) {
    const lastViewed = Math.max(viewed[tab.id] || now, tab.lastAccessed || 0, settings.enabledSince);
    return settings.enabled && !isSwitching() && !tab.active && !tab.pinned && !tab.audible &&
      !tab.incognito && !tab.pendingUrl && /^https?:\/\//i.test(tab.url || "") &&
      now - lastViewed >= settings.hours * HOUR;
  }

  async function sweep() {
    if (!settings.enabled || isSwitching() || pendingChanges) return;
    const startedAtRevision = revision;
    const tabs = await chrome.tabs.query({});
    for (const candidate of tabs) {
      if (revision !== startedAtRevision || isSwitching()) return;
      if (!eligible(candidate, Date.now())) continue;
      let tab;
      try { tab = await chrome.tabs.get(candidate.id); } catch { continue; }
      if (!eligible(tab, Date.now()) || revision !== startedAtRevision) continue;

      const entry = { id: crypto.randomUUID(), url: tab.url, title: tab.title || tab.url, closedAt: Date.now() };
      const previous = recent;
      const next = [entry, ...recent].slice(0, 50);
      // Save the URL before closing. A failed storage write must never lose a tab.
      await chrome.storage.local.set({ autoClosedTabs: next });
      let closed = false;
      try {
        tab = await chrome.tabs.get(candidate.id);
        if (revision === startedAtRevision && tab.url === entry.url && eligible(tab, Date.now())) {
          await chrome.tabs.remove(tab.id);
          closed = true;
        }
      } catch { /* The tab may already have been closed manually. */ }
      recent = closed ? next : previous;
      if (!closed) await chrome.storage.local.set({ autoClosedTabs: recent });
    }
  }

  function setSettings(value) {
    return change(async () => {
      const next = normalize(value);
      const enabledSince = next.enabled && !settings.enabled ? Date.now() : settings.enabledSince;
      const saved = { ...next, enabledSince };
      await chrome.storage.local.set({ autoCloseSettings: saved });
      settings = saved;
      await configureAlarm();
    });
  }

  chrome.tabs.onActivated.addListener(info => {
    const now = Date.now();
    change(async () => {
      const previous = activeByWindow[info.windowId];
      // Time spent reading counts too, even if the tab was selected days ago.
      if (previous !== undefined) viewed[previous] = now;
      viewed[info.tabId] = now;
      activeByWindow[info.windowId] = info.tabId;
      await chrome.storage.session.set({ autoCloseViewed: viewed });
    });
  });
  chrome.tabs.onCreated.addListener(tab => {
    const now = Date.now();
    change(async () => {
      viewed[tab.id] = now;
      await chrome.storage.session.set({ autoCloseViewed: viewed });
    });
  });
  chrome.tabs.onUpdated.addListener((id, changes) => {
    // Closing a tab emits status: "unloaded" in Chromium. That must not abort
    // our own sweep; only changes that affect eligibility invalidate it.
    if ("pinned" in changes || "audible" in changes || "url" in changes) revision++;
  });
  chrome.tabs.onRemoved.addListener(id => {
    enqueue(async () => {
      delete viewed[id];
      for (const windowId of Object.keys(activeByWindow)) {
        if (activeByWindow[windowId] === id) delete activeByWindow[windowId];
      }
      await chrome.storage.session.set({ autoCloseViewed: viewed });
    });
  });
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === ALARM) enqueue(sweep);
  });
  chrome.runtime.onStartup.addListener(() => enqueue(async () => {
    await configureAlarm();
    await sweep();
  }));

  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (!["get_auto_close", "restore_auto_closed", "clear_auto_closed"].includes(request.action)) return;
    // Only extension pages can access the saved browsing history.
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) return;
    enqueue(async () => {
      if (request.action === "restore_auto_closed") {
        const entry = recent.find(item => item.id === request.id);
        if (!entry || !/^https?:\/\//i.test(entry.url)) throw new Error("This tab is no longer in the list.");
        const tab = await chrome.tabs.create({ url: entry.url, active: true });
        viewed[tab.id] = Date.now();
        recent = recent.filter(item => item.id !== entry.id);
        await chrome.storage.local.set({ autoClosedTabs: recent });
      } else if (request.action === "clear_auto_closed") {
        await chrome.storage.local.set({ autoClosedTabs: [] });
        recent = [];
      }
      return { settings, recent };
    }).then(respond, () => respond({ error: "Could not update auto-closed tabs. Please try again." }));
    return true;
  });

  // Re-check on every worker start, including wake/restart after missed alarms.
  enqueue(sweep);
  return { setSettings, ready, idle: () => queue };
}

if (typeof module !== "undefined") module.exports = { createTabAutoClose };
