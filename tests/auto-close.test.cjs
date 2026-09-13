const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const HOUR = 3600000;
const START = 1800000000000;
const clone = value => structuredClone(value);
const oldTab = (id, fields = {}) => ({ id, windowId: 1, url: `https://example.org/${id}`, title: `Tab ${id}`, lastAccessed: START - 48 * HOUR, active: false, pinned: false, audible: false, ...fields });

async function harness({ tabs = [oldTab(1)], enabled = false, local, session = {}, time = START, switching = false } = {}) {
  const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, emit(...args) { this.listeners.forEach(fn => fn(...args)); } });
  local ??= { autoCloseSettings: { enabled, hours: 24, enabledSince: START - 48 * HOUR } };
  let now = time, nextId = 1000, alarm;
  const removed = [], created = [], errors = [];
  const hooks = {};
  const area = (data, name) => ({
    async get(keys) { return Object.fromEntries([keys].flat().filter(key => key in data).map(key => [key, clone(data[key])])); },
    async set(values) { if (hooks[name]) await hooks[name](values); Object.assign(data, clone(values)); },
  });
  const chrome = {
    storage: { local: area(local, 'localSet'), session: area(session, 'sessionSet') },
    runtime: { id: 'our-extension', getURL: path => `chrome-extension://our-extension/${path}`, onMessage: event(), onStartup: event() },
    alarms: { onAlarm: event(), async get() { return alarm; }, async create(name, options) { alarm = { name, ...options }; }, async clear() { alarm = undefined; } },
    tabs: {
      onCreated: event(), onActivated: event(), onRemoved: event(), onUpdated: event(),
      async query() { return clone(tabs); },
      async get(id) { if (hooks.get) await hooks.get(id); const tab = tabs.find(t => t.id === id); if (!tab) throw Error('Missing tab'); return clone(tab); },
      async remove(id) {
        if (hooks.remove) await hooks.remove(id);
        const index = tabs.findIndex(t => t.id === id);
        if (index < 0) throw Error('Missing tab');
        chrome.tabs.onUpdated.emit(id, { status: 'unloaded' }, clone(tabs[index]));
        tabs.splice(index, 1); removed.push(id); chrome.tabs.onRemoved.emit(id);
      },
      async create(details) {
        if (hooks.create) await hooks.create(details);
        const tab = oldTab(nextId++, { ...details, lastAccessed: now });
        tabs.push(tab); created.push(clone(tab)); chrome.tabs.onCreated.emit(tab);
        return clone(tab);
      },
    },
  };
  const context = vm.createContext({ chrome, crypto: { randomUUID }, Date: class extends Date { static now() { return now; } }, console: { error: (...args) => errors.push(args) } });
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../auto-close.js'), 'utf8'), context);
  const engine = context.createTabAutoClose(chrome, () => switching);
  const drain = async () => { for (let i = 0; i < 5; i++) await engine.idle(); };
  await drain();
  return {
    chrome, engine, tabs, local, session, removed, created, hooks, errors, drain,
    alarm: () => alarm, advance: hours => { now += hours * HOUR; }, setSwitching: value => { switching = value; },
    sweep: async () => { chrome.alarms.onAlarm.emit({ name: 'auto-close-tabs' }); await drain(); },
    message: (request, sender = { id: 'our-extension', url: 'chrome-extension://our-extension/popup.html' }) => new Promise(resolve => {
      const listener = chrome.runtime.onMessage.listeners[0];
      if (!listener(request, sender, resolve)) resolve(undefined);
    }),
  };
}

test('off by default; enabling starts a full grace period and reconnecting preserves it', async () => {
  const h = await harness();
  assert.deepEqual(h.removed, []);
  assert.equal(h.alarm(), undefined);
  await h.engine.setSettings({ enabled: true, hours: 24 });
  assert.equal(h.alarm().periodInMinutes, 5);
  h.advance(23);
  await h.engine.setSettings({ enabled: true, hours: 24 });
  await h.sweep(); assert.deepEqual(h.removed, []);
  h.advance(1); await h.sweep(); assert.deepEqual(h.removed, [1]);
  assert.equal(h.local.autoClosedTabs[0].url, 'https://example.org/1');
});

test('protects pinned, selected in every window, audible, private, and non-web tabs', async () => {
  const h = await harness({ enabled: true, tabs: [
    oldTab(1), oldTab(2, { pinned: true }), oldTab(3, { active: true }),
    oldTab(4, { active: true, windowId: 2 }), oldTab(5, { audible: true }),
    oldTab(6, { incognito: true }), oldTab(7, { url: 'chrome://settings' }),
    oldTab(8, { url: 'file:///notes.txt' }), oldTab(9, { pendingUrl: 'https://new.org' }),
    oldTab(10, { lastAccessed: START - HOUR }),
  ] });
  assert.deepEqual(h.removed, [1]);
  assert.equal(h.local.autoClosedTabs.length, 1);
});

test('selection resets inactivity even during switching; background loads do not', async () => {
  const h = await harness({ enabled: true, switching: true, tabs: [oldTab(1), oldTab(2)] });
  h.chrome.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
  h.chrome.tabs.onUpdated.emit(2, { status: 'complete' }, h.tabs[1]);
  await h.drain();
  h.setSwitching(false); await h.sweep();
  assert.deepEqual(h.removed, [2]);
  h.advance(24); await h.sweep(); assert.deepEqual(h.removed, [2, 1]);
});

test('leaving a long-selected tab and creating a background tab start fresh timers', async () => {
  const h = await harness({ enabled: true, tabs: [oldTab(1, { active: true })] });
  h.tabs[0].active = false;
  const tab = oldTab(2, { lastAccessed: undefined }); h.tabs.push(tab);
  h.chrome.tabs.onCreated.emit(tab);
  h.chrome.tabs.onActivated.emit({ tabId: 2, windowId: 1 });
  await h.drain(); await h.sweep(); assert.deepEqual(h.removed, []);
  h.advance(24); await h.sweep(); assert.deepEqual(h.removed, [1, 2]);
});

test('worker restart preserves activity; browser restart never reuses old tab-ID records', async () => {
  const h = await harness({ enabled: true, switching: true });
  h.chrome.tabs.onActivated.emit({ tabId: 1, windowId: 1 }); await h.drain();
  const worker = await harness({ enabled: true, local: clone(h.local), session: clone(h.session) });
  assert.deepEqual(worker.removed, []);
  worker.advance(24); await worker.sweep(); assert.deepEqual(worker.removed, [1]);
  const browser = await harness({ enabled: true, local: clone(h.local), session: {}, tabs: [oldTab(1, { lastAccessed: undefined }), oldTab(2)] });
  assert.deepEqual(browser.removed, [2]);
  browser.advance(24); await browser.sweep(); assert.deepEqual(browser.removed, [2, 1]);
});

test('an activation queued behind a sweep protects the tab we just stopped reading', async () => {
  const h = await harness({ enabled: true, tabs: [oldTab(1, { active: true })] });
  h.tabs[0].active = false;
  const tab = oldTab(2, { active: true, lastAccessed: START }); h.tabs.push(tab);
  h.chrome.alarms.onAlarm.emit({ name: 'auto-close-tabs' });
  h.chrome.tabs.onCreated.emit(tab);
  h.chrome.tabs.onActivated.emit({ tabId: 2, windowId: 1 });
  await h.drain(); await h.sweep();
  assert.deepEqual(h.removed, []);
  assert.equal(h.session.autoCloseViewed[1], START);
});

test('missed alarms catch up after sleep and missing alarms are recreated on worker start', async () => {
  const h = await harness({ enabled: true, tabs: [oldTab(1, { lastAccessed: START })] });
  await h.chrome.alarms.clear();
  const restarted = await harness({ local: clone(h.local), session: clone(h.session), tabs: h.tabs, time: START + 25 * HOUR });
  assert.equal(restarted.alarm().periodInMinutes, 5);
  assert.deepEqual(restarted.removed, [1]);
});

test('disabling removes the alarm; re-enabling gives a new grace period', async () => {
  const h = await harness({ enabled: true, switching: true });
  await h.engine.setSettings({ enabled: false, hours: 24 });
  assert.equal(h.alarm(), undefined);
  h.advance(100); h.setSwitching(false); await h.sweep(); assert.deepEqual(h.removed, []);
  await h.engine.setSettings({ enabled: true, hours: 24 });
  await h.sweep(); assert.deepEqual(h.removed, []);
  h.advance(24); await h.sweep(); assert.deepEqual(h.removed, [1]);
});

test('rechecks eligibility after saving recovery data and cancels on new activity', async () => {
  for (const change of ['active', 'pinned', 'audible', 'url', 'activation', 'disable', 'switching']) {
    const h = await harness({ enabled: true, switching: true });
    h.setSwitching(false);
    h.hooks.localSet = async data => {
      if (!data.autoClosedTabs?.length) return;
      delete h.hooks.localSet;
      if (change === 'url') h.tabs[0].url = 'https://changed.org';
      else if (change === 'activation') h.chrome.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
      else if (change === 'disable') h.engine.setSettings({ enabled: false, hours: 24 });
      else if (change === 'switching') h.setSwitching(true);
      else h.tabs[0][change] = true;
    };
    await h.sweep();
    assert.deepEqual(h.removed, [], change);
    assert.deepEqual(h.local.autoClosedTabs, [], change);
  }
});

test('storage or closing failures do not lose tabs or create false recovery entries', async () => {
  for (const failure of ['storage', 'remove', 'missing']) {
    const h = await harness({ enabled: true, switching: true });
    h.setSwitching(false);
    if (failure === 'storage') h.hooks.localSet = () => { throw Error('disk full'); };
    if (failure === 'remove') h.hooks.remove = () => { throw Error('cannot close'); };
    if (failure === 'missing') h.hooks.get = () => { throw Error('already closed'); };
    await h.sweep();
    assert.deepEqual(h.removed, [], failure);
    assert.equal((h.local.autoClosedTabs || []).length, 0, failure);
  }
});

test('recovery is bounded, survives restart, reopens URLs, and can be cleared', async () => {
  const h = await harness({ enabled: true, tabs: Array.from({ length: 55 }, (_, i) => oldTab(i + 1)) });
  assert.equal(h.removed.length, 55);
  assert.equal(h.local.autoClosedTabs.length, 50);
  const restarted = await harness({ local: clone(h.local), tabs: [] });
  let data = await restarted.message({ action: 'get_auto_close' });
  const entry = data.recent[0];
  data = await restarted.message({ action: 'restore_auto_closed', id: entry.id });
  assert.equal(restarted.created[0].url, entry.url);
  assert.equal(restarted.created[0].active, true);
  assert.equal(data.recent.length, 49);
  assert.ok((await restarted.message({ action: 'restore_auto_closed', id: entry.id })).error);
  data = await restarted.message({ action: 'clear_auto_closed' });
  assert.equal(data.recent.length, 0);
  assert.deepEqual(restarted.local.autoClosedTabs, []);
});

test('failed restoration preserves the entry; content scripts cannot access history', async () => {
  const h = await harness({ enabled: true });
  h.hooks.create = () => { throw Error('cannot create'); };
  const entry = h.local.autoClosedTabs[0];
  assert.ok((await h.message({ action: 'restore_auto_closed', id: entry.id })).error);
  assert.equal(h.local.autoClosedTabs.length, 1);
  assert.equal(await h.message({ action: 'get_auto_close' }, { id: 'our-extension', url: 'https://example.org', tab: { id: 1 } }), undefined);
  assert.equal(await h.message({ action: 'clear_auto_closed' }, { id: 'another-extension' }), undefined);
  assert.equal((await h.message({ action: 'get_auto_close' }, { id: 'our-extension', url: 'chrome-extension://our-extension/popup.html', tab: { id: 1 } })).recent.length, 1);
});

test('custom timeout is honored and invalid timeout falls back to 24 hours', async () => {
  const h = await harness();
  await h.engine.setSettings({ enabled: true, hours: 6 });
  h.advance(5); await h.sweep(); assert.deepEqual(h.removed, []);
  h.advance(1); await h.sweep(); assert.deepEqual(h.removed, [1]);
  await h.engine.setSettings({ enabled: true, hours: 0 });
  assert.equal(h.local.autoCloseSettings.hours, 24);
});
