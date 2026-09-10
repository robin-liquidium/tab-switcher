const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../mainsw.js'), 'utf8');

function harness() {
  const timers = new Map(), canvases = [], bitmaps = [];
  let timerId = 0;
  const tab = { active: true, windowId: 10, url: 'https://example.org' };
  const win = { focused: true, state: 'normal' };
  const calls = { capture: 0 };
  const context = vm.createContext({
    tabThumbnails: {}, tabThumbnailOrder: [], MAX_THUMBNAILS: 20, MAX_THUMBNAIL_CHARS: 1024 * 1024,
    thumbnailTimer: undefined, thumbnailGeneration: 0, thumbnailCaptureInFlight: false, lastThumbnailCapture: 0,
    Date, Uint8Array, btoa: str => Buffer.from(str, 'binary').toString('base64'), log() {},
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    chrome: {
      tabs: { get: async () => ({ ...tab }), captureVisibleTab: async () => { calls.capture++; return 'full-resolution'; } },
      windows: { get: async () => win },
    },
    fetch: async () => ({ blob: async () => ({}) }),
    createImageBitmap: async () => {
      const bitmap = { width: 3840, height: 2160, closed: false, close() { this.closed = true; } };
      bitmaps.push(bitmap); return bitmap;
    },
    OffscreenCanvas: class {
      constructor(width, height) { this.width = width; this.height = height; canvases.push(this); }
      getContext() { return { drawImage: (bitmap, x, y, w, h) => { this.drawn = [w, h]; } }; }
      async convertToBlob() { return { arrayBuffer: async () => new Uint8Array(100).buffer }; }
    },
  });
  vm.runInContext(source.slice(source.indexOf('// Coalesce activation/loading bursts'), source.indexOf('// Capture thumbnail of the current active tab')), context);
  return { context, tab, win, calls, timers, canvases, bitmaps };
}

test('4K capture becomes a 440px JPEG and releases bitmap/canvas backing storage', async () => {
  const h = harness(); await h.context.captureThumbnail(1, 10);
  assert.deepEqual(h.canvases[0].drawn, [440, 248]);
  assert.equal(h.bitmaps[0].closed, true);
  assert.equal(h.canvases[0].width, 1);
  assert.match(h.context.tabThumbnails[1], /^data:image\/jpeg;base64,/);
  assert.notEqual(h.context.tabThumbnails[1], 'full-resolution');
});
test('activation/loading bursts coalesce and enforce capture cooldown', () => {
  const h = harness(); h.context.lastThumbnailCapture = Date.now();
  for (let id = 1; id <= 10; id++) h.context.scheduleThumbnailCapture(id, 10);
  assert.equal(h.timers.size, 1);
  assert.ok([...h.timers.values()][0].delay >= 900);
});
test('inactive, unfocused, minimized and restricted tabs never capture', async () => {
  for (const mode of ['inactive', 'unfocused', 'minimized', 'restricted']) {
    const h = harness();
    if (mode === 'inactive') h.tab.active = false;
    if (mode === 'unfocused') h.win.focused = false;
    if (mode === 'minimized') h.win.state = 'minimized';
    if (mode === 'restricted') h.tab.url = 'chrome://extensions';
    await h.context.captureThumbnail(1, 10);
    assert.equal(h.calls.capture, 0, mode);
  }
});
test('only one capture runs at a time; newest request is scheduled', async () => {
  const h = harness();
  await Promise.all([h.context.captureThumbnail(1, 10), h.context.captureThumbnail(2, 10)]);
  assert.ok(h.calls.capture <= 1);
  assert.equal(h.timers.size, 1);
  assert.equal(h.context.thumbnailCaptureInFlight, false);
});
test('navigation during capture discards stale preview and releases resources', async () => {
  const h = harness();
  h.context.chrome.tabs.captureVisibleTab = async () => { h.tab.url = 'https://other.example'; return 'capture'; };
  await h.context.captureThumbnail(1, 10);
  assert.equal(Object.keys(h.context.tabThumbnails).length, 0);
  assert.equal(h.bitmaps[0].closed, true);
  assert.equal(h.canvases[0].width, 1);
});
test('encoding failure releases resources and allows the next capture', async () => {
  const h = harness();
  h.context.OffscreenCanvas.prototype.convertToBlob = async () => { throw Error('encode failed'); };
  await h.context.captureThumbnail(1, 10);
  assert.equal(h.bitmaps[0].closed, true);
  assert.equal(h.canvases[0].width, 1);
  assert.equal(h.context.thumbnailCaptureInFlight, false);
  assert.equal(Object.keys(h.context.tabThumbnails).length, 0);
});
test('cache evicts by both count and encoded byte budget', async () => {
  const h = harness();
  for (let id = 1; id <= 25; id++) await h.context.captureThumbnail(id, 10);
  assert.equal(h.context.tabThumbnailOrder.length, 20);
  assert.equal(h.context.tabThumbnails[1], undefined);
  h.context.MAX_THUMBNAIL_CHARS = 350;
  await h.context.captureThumbnail(26, 10);
  assert.ok(Object.values(h.context.tabThumbnails).reduce((n, s) => n + s.length, 0) <= 350);
  assert.equal(h.context.tabThumbnailOrder[0], 26);
});
test('tab closing during capture cannot repopulate its cache entry', async () => {
  const h = harness(); let reads = 0;
  h.context.chrome.tabs.get = async () => { if (++reads > 1) throw Error('closed'); return { ...h.tab }; };
  await h.context.captureThumbnail(1, 10);
  assert.equal(h.context.tabThumbnails[1], undefined);
  assert.equal(h.context.thumbnailCaptureInFlight, false);
});
