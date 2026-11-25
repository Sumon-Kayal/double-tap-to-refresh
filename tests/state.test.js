'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = (name) => fs.readFileSync(path.join(__dirname, '../src', name + '.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function harness() {
  const timers = new Map();
  let timer = 0;
  function node() {
    const handlers = {};
    return {
      dataset: {}, style: { setProperty(k, v) { this[k] = v; } }, children: [], handlers,
      namespaceURI: 'http://www.w3.org/1999/xhtml',
      addEventListener(k, fn) { (handlers[k] ||= []).push(fn); }, removeEventListener() {},
      emit(k, values = {}) {
        const e = { preventDefault() {}, stopPropagation() {}, ...values };
        for (const fn of handlers[k] || []) fn(e);
      },
      setAttribute() {}, append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); child.isConnected = true; },
      attachShadow() { return (this.shadow = node()); },
      setPointerCapture() {}, releasePointerCapture() {}, matches() { return false; },
      animate() { return { cancel() {} }; }, remove() {},
    };
  }
  const window = node();
  window.top = window;
  window.innerWidth = 390; window.innerHeight = 844;
  window.matchMedia = () => ({ matches: false });
  window.visualViewport = Object.assign(node(), { width: 390, height: 844, offsetLeft: 0, offsetTop: 0 });
  const elements = {};
  const document = Object.assign(node(), {
    compatMode: 'CSS1Compat', documentElement: node(), createElement: node, createElementNS: node,
    querySelectorAll: () => [], getElementById: (id) => elements[id] ||= node(),
  });
  const context = vm.createContext({ window, document, navigator: {}, chrome: {},
    setTimeout(fn) { timers.set(++timer, fn); return timer; }, clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { fn(); return 0; }, cancelAnimationFrame() {},
  });
  vm.runInContext(source('shared'), context);
  const tick = () => { const work = [...timers.values()]; timers.clear(); work.forEach((fn) => fn()); };
  return { context, window, document, elements, tick, timers };
}
function ballFixture() {
  const h = harness();
  const moves = []; let refreshes = 0;
  const ball = h.context.DTR.createBall({ onMoveEnd: (p) => moves.push(p), onRefresh: () => refreshes++ });
  ball.mount(h.document.documentElement);
  const face = h.document.documentElement.children[0].shadow.children[0];
  const pointer = (kind, extra) => face.emit(kind, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 350, clientY: 570, timeStamp: 1000, ...extra });
  return { ...h, ball, face, pointer, moves, refreshes: () => refreshes };
}

test('late pre-hold touch movement cancels a timer-started drag without saving or refreshing', () => {
  const h = ballFixture();
  const initial = h.face.style.translate;
  h.pointer('pointerdown'); h.tick();
  h.pointer('pointermove', { clientX: 300, timeStamp: 1200 });
  h.pointer('pointerup', { timeStamp: 1400 });
  assert.equal(h.moves.length, 0); assert.equal(h.refreshes(), 0);
  assert.equal(h.face.style.translate, initial);
});

test('latest deferred position, including a reset, applies after a stationary hold', () => {
  const h = ballFixture();
  h.ball.update({ position: { x: 0, y: 0 } });
  h.pointer('pointerdown'); h.tick();
  h.ball.update({ position: { x: 0.5, y: 0.5 } });
  h.ball.update({ position: undefined });
  h.pointer('pointerup', { timeStamp: 1500 });
  assert.equal(h.face.style.translate, '340px 557.5999999999999px');
  assert.equal(h.moves.length, 0);
});

test('visual viewport pan/resize deferred during a hold applies on cancellation', () => {
  const h = ballFixture();
  h.pointer('pointerdown'); h.tick();
  Object.assign(h.window.visualViewport, { width: 200, height: 400, offsetLeft: 100, offsetTop: 200 });
  h.window.visualViewport.emit('resize');
  h.pointer('pointercancel');
  const p = h.context.DTR.toPixels(h.context.DTR.DEFAULT_POSITION, 200, 400, 44);
  assert.equal(h.face.style.translate, `${100 + p.left}px ${200 + p.top}px`);
  assert.equal(h.moves.length, 0);
});

test('mouse dragging saves; keyboard and assistive clicks work immediately after pointer activity', () => {
  const h = ballFixture();
  h.pointer('pointerdown', { pointerType: 'mouse', button: 0 });
  h.pointer('pointermove', { pointerType: 'mouse', clientX: 300, timeStamp: 1100 });
  h.pointer('pointerup', { pointerType: 'mouse', timeStamp: 1150 });
  assert.equal(h.moves.length, 1);
  h.face.emit('click', { pointerType: 'mouse', detail: 1 });
  assert.equal(h.refreshes(), 0);
  h.face.emit('click', { detail: 0 }); h.face.emit('click', { detail: 0 });
  assert.equal(h.refreshes(), 2);
  let prevented = false;
  h.face.emit('keydown', { key: 'Enter', repeat: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});

test('options gate early edits, preserve pending edits on external changes and merge on committed save', async () => {
  const h = harness();
  let resolveRead; let stored = { size: 60, transparency: 0.5, doubleTapMs: 400, extra: true };
  let reads = 0; const writes = []; let changed;
  h.context.chrome.storage = {
    local: {
      get() { reads++; return reads === 1 ? new Promise((r) => { resolveRead = r; }) : Promise.resolve({ settings: stored }); },
      async set(value) { writes.push(value.settings); stored = value.settings; },
    },
    onChanged: { addListener(fn) { changed = fn; } },
  };
  vm.runInContext(source('options'), h.context);
  const size = h.elements.size;
  assert.equal(size.disabled, true);
  size.value = '72'; size.emit('input'); h.elements['reset-defaults'].emit('click');
  resolveRead({ settings: stored }); await flush();
  assert.equal(size.disabled, false); assert.equal(size.value, '60');
  size.value = '56'; size.emit('input');
  stored = { ...stored, transparency: 0.8, doubleTapMs: 550 };
  changed({ settings: { newValue: stored } }, 'local');
  assert.equal(size.value, '56'); assert.equal(h.elements.doubleTapMs.value, '550');
  size.emit('change');
  assert.equal(reads, 2); // commit starts the read immediately, without running timers
  await flush();
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0])), { ...stored, size: 56 });
  h.tick(); await flush(); assert.equal(writes.length, 1);
});

test('content reobserves replacement roots, limits direct removals, and skips failed catch-up reads', async () => {
  const h = harness(); let observer; let failed = false; let mounts = 0; const updates = [];
  h.context.MutationObserver = class {
    constructor(fn) { observer = this; this.notify = fn; this.targets = []; }
    observe(target) { this.targets.push(target); } disconnect() { this.targets = []; }
  };
  const api = { storage: { local: { get: async () => { if (failed) throw Error('unavailable'); return {}; } }, onChanged: { addListener() {} } }, runtime: { onMessage: { addListener() {} } } };
  h.context.DTR = { api, STORAGE: { settings: 'settings', position: 'position' }, MESSAGE: {},
    createBall() { return { mount() { mounts++; }, isMounted: () => false, update(v) { updates.push(v); } }; } };
  vm.runInContext(source('content'), h.context); await flush();
  for (let i = 0; i < 6; i++) observer.notify();
  assert.equal(mounts, 6);
  h.document.documentElement = {}; observer.notify();
  assert.equal(mounts, 7); assert.ok(observer.targets.includes(h.document.documentElement));
  failed = true; h.window.emit('pageshow', { persisted: true }); await flush();
  assert.equal(updates.length, 0);
  failed = false; h.window.emit('pageshow', { persisted: true }); await flush();
  assert.equal(updates.length, 1); assert.ok('position' in updates[0]); assert.equal(updates[0].position, undefined);
});

test('a moved drag overrides deferred positions and stores visual viewport ratios', () => {
  const h = ballFixture();
  Object.assign(h.window.visualViewport, { width: 200, height: 400, offsetLeft: 100, offsetTop: 200 });
  h.window.visualViewport.emit('scroll');
  h.pointer('pointerdown', { pointerType: 'mouse', button: 0 });
  h.pointer('pointermove', { pointerType: 'mouse', clientX: 320, clientY: 550 });
  h.ball.update({ position: undefined });
  const [left, top] = h.face.style.translate.match(/[\d.]+/g).map(Number);
  h.pointer('pointerup', { pointerType: 'mouse', timeStamp: 1500 });
  const expected = h.context.DTR.toRatios(left - 100, top - 200, 200, 400, 44);
  assert.equal(h.moves.length, 1);
  assert.equal(h.moves[0].x, expected.x); assert.equal(h.moves[0].y, expected.y);
});
