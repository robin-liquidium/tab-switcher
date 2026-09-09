const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function harness({ count = 9, focused = true, delay = 0 } = {}) {
  const event = () => ({ listeners: [], addListener(callback) { this.listeners.push(callback); } });
  const tabs = Array.from({ length: count }, (_, i) => ({ id: i + 1, windowId: 10, active: i === 0, title: `Tab ${i + 1}`, lastAccessed: 100 - i }));
  const windows = [{ id: 10, focused, tabs }, { id: 20, focused: false, tabs: [{ id: 99, windowId: 20, title: 'Other window' }] }];
  const sent = [], activated = [], calls = { windows: 0, tabs: 0 };
  const port = { onMessage: event(), onDisconnect: event(), postMessage: message => sent.push(message) };
  const chrome = {
    runtime: { getManifest: () => ({ version: '3.7.4' }), onInstalled: event(), onStartup: event(), onMessage: event(), connectNative: () => port },
    commands: { onCommand: event() },
    storage: { local: { set() {} } },
    windows: {
      onFocusChanged: event(),
      getAll: (options, callback) => {
        if (callback) { callback(windows); return; }
        calls.windows++;
        return new Promise(resolve => setTimeout(() => resolve(windows), delay));
      },
      update: async () => {},
    },
    tabs: {
      onActivated: event(), onUpdated: event(), onCreated: event(), onRemoved: event(),
      get: async id => { calls.tabs++; const tab = windows.flatMap(w => w.tabs).find(t => t.id === id); if (!tab) throw Error('Tab closed'); return tab; },
      update: async id => activated.push(id),
      query: async () => tabs.filter(tab => tab.active),
    },
  };
  const context = vm.createContext({ chrome, navigator: { userAgent: 'Helium' }, console, setTimeout() {}, setInterval() {}, fetch: async () => ({ json: async () => ({}) }) });
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../mainsw.js'), 'utf8'), context);
  context.mru = [1, 99, 5, 3, 7, 2, 6, 4, 8, 9];
  const cycle = (direction, maxTabs) => context.queueNativeSwitch(() => context.handleNativeCycle(direction, true, maxTabs));
  const hover = id => context.queueNativeSwitch(() => context.handleNativeSelection(id));
  const end = () => context.queueNativeSwitch(context.handleNativeEndSwitch);
  const cancel = () => {
    port.onMessage.listeners.forEach(callback => callback({ action: 'cancel_switch' }));
    return context.nativeSwitchQueue;
  };
  return { context, sent, activated, calls, windows, tabs, cycle, hover, end, cancel, focus: id => chrome.windows.onFocusChanged.listeners.forEach(callback => callback(id)) };
}

test('first key immediately requests six previews using one metadata query', async () => {
  const h = harness(); await h.cycle(1);
  assert.deepEqual(Array.from(h.sent[0].tabs, t => t.id), [1, 5, 3, 7, 2, 6]);
  assert.equal(h.sent[0].selectedIndex, 1);
  assert.deepEqual(h.calls, { windows: 1, tabs: 0 });
});
test('six forward presses wrap to the first card without querying again', async () => {
  const h = harness(); for (let i = 0; i < 6; i++) await h.cycle(1);
  assert.equal(h.sent.at(-1).selectedIndex, 0);
  assert.equal(h.calls.windows, 1);
  await h.end(); assert.deepEqual(h.activated, [1]);
});
test('backward cycling wraps to the sixth card', async () => {
  const h = harness(); await h.cycle(-1);
  assert.equal(h.sent[0].selectedIndex, 5);
  await h.end(); assert.deepEqual(h.activated, [6]);
});
test('hover selection is the tab activated on modifier release', async () => {
  const h = harness(); await h.cycle(1); await h.hover(7); await h.end();
  assert.deepEqual(h.activated, [7]);
  assert.equal(h.context.mru[0], 7);
});
test('keyboard cycling continues from the hovered tab', async () => {
  const h = harness(); await h.cycle(1); await h.hover(6); await h.cycle(1); await h.end();
  assert.deepEqual(h.activated, [1]);
});
test('fast key-repeat and release stay ordered during asynchronous initialization', async () => {
  const h = harness({ delay: 10 });
  await Promise.all([h.cycle(1), h.cycle(1), h.hover(7), h.end()]);
  assert.deepEqual(h.activated, [7]);
  assert.equal(h.sent.at(-1).action, 'hide_switcher');
  assert.equal(h.context.nativeSwitchOngoing, false);
});
test('single tab stays selected when cycling in either direction', async () => {
  const h = harness({ count: 1 }); await h.cycle(1); await h.cycle(-1); await h.end();
  assert.equal(h.sent[0].tabs.length, 1);
  assert.deepEqual(h.activated, [1]);
});
test('nonfocused browser profiles do not show or activate tabs', async () => {
  const h = harness({ focused: false }); await h.cycle(1); await h.end();
  assert.equal(h.sent.length, 0); assert.equal(h.activated.length, 0);
});
test('losing focus before release does not activate a tab', async () => {
  const h = harness(); await h.cycle(1); h.windows[0].focused = false; await h.end();
  assert.equal(h.activated.length, 0); assert.equal(h.sent.at(-1).action, 'hide_switcher');
});
test('closed selected tab hides cleanly and the next switch excludes it', async () => {
  const h = harness(); await h.cycle(1); h.tabs.splice(h.tabs.findIndex(t => t.id === 5), 1); await h.end();
  assert.equal(h.activated.length, 0); await h.cycle(1);
  assert.equal(h.sent.at(-1).tabs.some(t => t.id === 5), false);
});
test('hover outside the six-tab session and after release is ignored', async () => {
  const h = harness(); await h.cycle(1); await h.hover(99); await h.end(); await h.hover(3);
  assert.deepEqual(h.activated, [5]); assert.equal(h.context.nativeSwitchOngoing, false);
});
test('empty focused window does not create an invalid selection', async () => {
  const h = harness({ count: 0 }); await h.cycle(1); await h.end();
  assert.equal(h.sent.length, 0);
});

test('focus changes cancel an open session before another profile can cycle it', async () => {
  const h = harness(); await h.cycle(1); h.windows[0].focused = false; h.focus(-1);
  assert.equal(h.context.nativeSwitchOngoing, false);
  assert.equal(h.sent.at(-1).action, 'hide_switcher');
  await h.cycle(1); await h.end(); assert.equal(h.activated.length, 0);
});
test('focus lost while metadata is loading cannot show a stale popup', async () => {
  const h = harness({ delay: 10 }); const pending = h.cycle(1);
  await new Promise(resolve => setTimeout(resolve, 1)); h.focus(-1);
  await pending; assert.equal(h.sent.some(m => m.action === 'show_switcher'), false);
});

test('configured limit controls the list and wraps in both directions', async () => {
  for (const maxTabs of [2, 4, 8, 10]) {
    const h = harness({ count: 12 });
    await h.cycle(-1, maxTabs);
    assert.equal(h.sent[0].tabs.length, maxTabs);
    assert.equal(h.sent[0].selectedIndex, maxTabs - 1);
    await h.cycle(1, maxTabs);
    assert.equal(h.sent.at(-1).selectedIndex, 0);
  }
});
test('changing limit takes effect on the next session, preserving the current selection', async () => {
  const h = harness(); await h.cycle(1, 4);
  await h.cycle(1, 8);
  assert.equal(h.context.filteredMru.length, 4);
  await h.end(); await h.cycle(1, 8);
  assert.equal(h.sent.at(-1).tabs.length, 8);
});
test('copy URL returns only the focused profile active tab', async () => {
  const h = harness(); h.tabs[0].url = 'https://example.org/';
  await h.context.handleCopyUrl();
  assert.equal(h.sent.at(-1).action, 'url_copied');
  assert.equal(h.sent.at(-1).url, 'https://example.org/');
  h.sent.length = 0; h.windows[0].focused = false;
  await h.context.handleCopyUrl(); assert.equal(h.sent.length, 0);
});

test('Escape cancels a hovered selection and releasing Control does not switch tabs', async () => {
  const h = harness(); const originalMru = Array.from(h.context.mru);
  await h.cycle(1); await h.hover(7); await h.cancel(); await h.end();
  assert.equal(h.sent.at(-1).action, 'hide_switcher');
  assert.equal(h.context.nativeSwitchOngoing, false);
  assert.deepEqual(h.activated, []);
  assert.deepEqual(Array.from(h.context.mru), originalMru);
});
test('Escape during initial metadata loading cancels before release can commit', async () => {
  const h = harness({ delay: 10 });
  await Promise.all([h.cycle(1), h.cancel(), h.end()]);
  assert.equal(h.sent.at(-1).action, 'hide_switcher');
  assert.deepEqual(h.activated, []);
});
test('a fresh cycle after Escape starts from the original active tab', async () => {
  const h = harness(); await h.cycle(1); await h.hover(7); await h.cancel();
  await h.cycle(1); assert.equal(h.sent.at(-1).selectedIndex, 1);
  await h.end(); assert.deepEqual(h.activated, [5]);
});
test('cancel outside a switch is harmless', async () => {
  const h = harness(); await h.cancel(); await h.end();
  assert.equal(h.sent.length, 0); assert.deepEqual(h.activated, []);
});
