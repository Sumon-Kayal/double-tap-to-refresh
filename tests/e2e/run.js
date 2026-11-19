'use strict';
// End-to-end checks for the built Chromium extension, run in a real browser with touch emulation
// (real touch events through the DevTools protocol). It is not part of `node --test`
// because it needs Playwright and a Chromium download:
//
//   npm install playwright && npx playwright install chromium
//   ./scripts/build.sh && node tests/e2e/run.js
//
// Environment: EXT_DIR (unpacked extension, default ../../chromium), SHOTS_DIR (screenshots, default a temp folder).

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (_) {
  console.error('Playwright is not installed. Run: npm install playwright && npx playwright install chromium');
  process.exit(2);
}

const PROJECT = path.resolve(__dirname, '..', '..');
const EXT = process.env.EXT_DIR || path.join(PROJECT, 'chromium');
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'dtr-shots');
fs.mkdirSync(SHOTS, { recursive: true });

// Same maths as the extension, loaded straight from the source file.
const ctx = vm.createContext({ chrome: {} });
vm.runInContext(fs.readFileSync(path.join(PROJECT, 'src', 'shared.js'), 'utf8'), ctx);
const DTR = ctx.DTR;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- test server
const hits = { page: 0, csp: 0, quirks: 0 };
const LONG = Array.from({ length: 60 }, (_, i) => `<p>Paragraph ${i + 1}. The quick brown fox jumps over the lazy dog.</p>`).join('\n');
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>t</title></head><body style="font:16px sans-serif;margin:0;padding:12px;background:#fff">${LONG}</body></html>`;
const QUIRKS = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><p>Short quirks-mode page</p></body></html>`;

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/page') { hits.page++; res.setHeader('content-type', 'text/html'); res.end(PAGE); return; }
  if (url === '/csp') {
    hits.csp++;
    res.setHeader('content-type', 'text/html');
    res.setHeader('content-security-policy', "default-src 'none'; style-src 'none'; script-src 'none'");
    res.end(PAGE); return;
  }
  if (url === '/quirks') { hits.quirks++; res.setHeader('content-type', 'text/html'); res.end(QUIRKS); return; }
  res.statusCode = 404; res.end('nope');
});

// -------------------------------------------------------------------- results
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtr-'));

  const VW = 390, VH = 844;
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    viewport: { width: VW, height: VH },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });

  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  console.log('extension id:', extId);

  const storageGet = () => sw.evaluate(() => chrome.storage.local.get());
  const storageSet = (obj) => sw.evaluate((o) => chrome.storage.local.set(o), obj);
  const storageClear = () => sw.evaluate(() => chrome.storage.local.clear());

  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  // ---- touch helpers (real touch events through CDP -> pointer events with pointerType "touch")
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  async function tap(x, y, hold = 40) { await touch('touchStart', x, y); await sleep(hold); await touch('touchEnd'); }
  async function doubleTap(x, y, gap = 90) { await tap(x, y); await sleep(gap); await tap(x, y); }
  async function longPressDrag(x, y, toX, toY, hold = 520, steps = 14) {
    await touch('touchStart', x, y);
    await sleep(hold);
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', x + ((toX - x) * i) / steps, y + ((toY - y) * i) / steps);
      await sleep(16);
    }
    await touch('touchEnd');
  }

  const isBallAt = (x, y) => page.evaluate(([px, py]) => document.elementFromPoint(px, py) === document.documentElement.lastElementChild
    && document.documentElement.lastElementChild.tagName === 'DIV', [x, y]);
  const centerOf = (pos, vw = VW, vh = VH, size = 44) => {
    const p = DTR.toPixels(pos, vw, vh, size);
    return { x: p.left + size / 2, y: p.top + size / 2 };
  };

  // Counts reload requests reaching the background; installs its listener once per worker instance.
  const resetCounter = () => sw.evaluate(() => {
    globalThis.__msgs = 0;
    if (!globalThis.__counting) {
      globalThis.__counting = true;
      chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'dtr:reload-tab') globalThis.__msgs++; return false; });
    }
  });
  const counted = () => sw.evaluate(() => globalThis.__msgs);

  async function load(route = '/page') {
    await page.goto(base + route, { waitUntil: 'load' });
    await sleep(400); // content script runs at document_idle and reads storage
  }
  async function reloadsAfter(action, wait = 1600) {
    const before = hits.page;
    await action();
    await sleep(wait);
    return hits.page - before;
  }

  // =========================================================================
  await storageClear();
  await load('/page');

  const home = centerOf(DTR.DEFAULT_POSITION);
  check('ball is rendered at the default spot (right edge, 70% down)', await isBallAt(home.x, home.y), `at ${home.x.toFixed(0)},${home.y.toFixed(0)}`);
  check('nothing is hit just outside the ball', !(await isBallAt(home.x - 40, home.y)));
  await page.screenshot({ path: path.join(SHOTS, 'page-default.png') });

  // ---- tap behaviour
  let n = await reloadsAfter(() => tap(home.x, home.y));
  check('a single tap does not reload', n === 0, `reloads: ${n}`);

  await sleep(500);
  n = await reloadsAfter(() => doubleTap(home.x, home.y));
  check('a double tap reloads exactly once (no duplicate fallback reload)', n === 1, `reloads: ${n}`);
  await sleep(400);

  await resetCounter();
  await sleep(300);
  n = await reloadsAfter(() => doubleTap(home.x, home.y));
  const handled = await counted();
  check('the reload goes through the background script (tabs.reload), not the fallback', n === 1 && handled === 1, `reloads: ${n}, background messages: ${handled}`);
  await sleep(400);

  n = await reloadsAfter(async () => { await tap(home.x, home.y); await sleep(600); await tap(home.x, home.y); });
  check('two slow taps (600 ms apart) do not reload', n === 0, `reloads: ${n}`);

  // ---- swipe from the ball: neither drag nor reload
  await sleep(500);
  n = await reloadsAfter(async () => {
    await touch('touchStart', home.x, home.y);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', home.x - i * 12, home.y); await sleep(12); }
    await touch('touchEnd');
  }, 900);
  check('a quick swipe starting on the ball does not reload', n === 0);
  check('...and does not move it', (await storageGet()).position === undefined && await isBallAt(home.x, home.y));

  // ---- long press without moving is not a tap
  await sleep(500);
  n = await reloadsAfter(async () => { await tap(home.x, home.y, 600); await sleep(80); await tap(home.x, home.y); });
  check('hold + tap does not count as a double tap', n === 0, `reloads: ${n}`);

  // ---- press-and-hold, then drag
  await storageClear();
  await load('/page');
  const target = { x: 120, y: 300 };
  await longPressDrag(home.x, home.y, target.x, target.y);
  await sleep(250);
  const stored = (await storageGet()).position;
  check('press-hold-drag moves the ball', await isBallAt(target.x, target.y) && !(await isBallAt(home.x, home.y)));
  check('release saves the position (ratios in 0..1)', !!stored && stored.x > 0 && stored.x < 1 && stored.y > 0 && stored.y < 1, JSON.stringify(stored));
  await page.screenshot({ path: path.join(SHOTS, 'page-moved.png') });

  await page.reload({ waitUntil: 'load' });
  await sleep(400);
  check('after a page reload the ball comes back where it was left', await isBallAt(target.x, target.y));

  await load('/page');
  check('...also after a fresh navigation', await isBallAt(target.x, target.y));

  // ---- drag far outside the viewport: clamped
  await longPressDrag(target.x, target.y, -400, -400);
  await sleep(250);
  const topLeft = centerOf({ x: 0, y: 0 });
  check('dragging off the top-left corner clamps to the edge gap', await isBallAt(topLeft.x, topLeft.y));
  await longPressDrag(topLeft.x, topLeft.y, 2000, 2000);
  await sleep(250);
  const bottomRight = centerOf({ x: 1, y: 1 });
  check('dragging off the bottom-right corner clamps to the edge gap', await isBallAt(bottomRight.x, bottomRight.y));

  // ---- orientation change keeps the ball on screen on the same side
  await page.setViewportSize({ width: 844, height: 390 });
  await sleep(400);
  const landscape = centerOf({ x: 1, y: 1 }, 844, 390);
  check('rotating to landscape keeps the ball at the same corner, inside the screen', await isBallAt(landscape.x, landscape.y), `expected ${landscape.x.toFixed(0)},${landscape.y.toFixed(0)}`);
  await page.setViewportSize({ width: VW, height: VH });
  await sleep(400);

  // ---- settings applied live from storage (what the options page does)
  await storageClear();
  await load('/page');
  const probeX = home.x - 28; // 28 px left of centre: outside a 44 px ball (r = 22), inside a 64 px ball (r = 32)
  check('default size: a point 28 px from the centre is not on the ball', !(await isBallAt(probeX, home.y)));
  await storageSet({ settings: { transparency: 0.8, size: 64, doubleTapMs: 500 } });
  await sleep(400);
  const big = centerOf(DTR.DEFAULT_POSITION, VW, VH, 64);
  check('changing size in storage resizes the ball live', await isBallAt(big.x - 28, big.y) && await isBallAt(big.x, big.y));
  await page.screenshot({ path: path.join(SHOTS, 'page-big-transparent.png') });

  n = await reloadsAfter(() => doubleTap(big.x, big.y, 460));
  check('a longer double-tap timing setting (500 ms) accepts a slower double tap', n === 1, `reloads: ${n}`);
  await sleep(500);

  await storageClear(); // settings + position removed -> defaults again
  await sleep(400);
  check('clearing storage puts size and position back to the defaults', !(await isBallAt(probeX, home.y)) && await isBallAt(home.x, home.y));

  // ---- mouse (desktop-style) input in the same page
  await load('/page');
  n = await reloadsAfter(async () => { await page.mouse.dblclick(home.x, home.y); });
  check('mouse double-click reloads exactly once', n === 1, `reloads: ${n}`);
  await sleep(400);
  await page.mouse.move(home.x, home.y);
  await page.mouse.down();
  await page.mouse.move(home.x - 60, home.y - 90, { steps: 8 });
  await page.mouse.up();
  await sleep(250);
  check('mouse can drag the ball straight away', await isBallAt(home.x - 60, home.y - 90));

  // ---- keyboard / assistive activation
  await storageClear();
  await load('/page');
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
  await page.keyboard.press('Shift+Tab'); // from the top of the page: lands on the last focusable element
  n = await reloadsAfter(() => page.keyboard.press('Enter'));
  check('keyboard: Enter on the focused ball reloads once', n === 1, `reloads: ${n}`);
  await sleep(300);
  await page.keyboard.press('Shift+Tab');
  n = await reloadsAfter(async () => { await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); });
  check('keyboard: Enter pressed repeatedly still reloads once', n === 1, `reloads: ${n}`);
  await sleep(300);

  // ---- strict-CSP page (no styles, no scripts allowed)
  await storageClear();
  await load('/csp');
  check('under a strict CSP the ball is still positioned and sized', await isBallAt(home.x, home.y) && !(await isBallAt(home.x - 40, home.y)));
  await page.screenshot({ path: path.join(SHOTS, 'page-csp.png') });
  const before = hits.csp;
  await doubleTap(home.x, home.y); await sleep(1500);
  check('...and a double tap still reloads there', hits.csp - before === 1, `reloads: ${hits.csp - before}`);

  // ---- quirks-mode page
  await load('/quirks');
  check('quirks-mode page: ball is still at the default spot', await isBallAt(home.x, home.y));

  // ---- extension pages: options
  const opts = await context.newPage();
  await opts.setViewportSize({ width: 390, height: 844 });
  await opts.goto(`chrome-extension://${extId}/options.html`);
  await sleep(500);
  const labels = await opts.evaluate(() => ['transparency-out', 'size-out', 'timing-out'].map((id) => document.getElementById(id).textContent));
  check('options: sliders show the defaults', JSON.stringify(labels) === JSON.stringify(['35%', '44 px', '350 ms']), labels.join(' | '));
  const previewHasBall = await opts.evaluate(() => document.getElementById('preview').children.length === 1);
  check('options: preview ball is mounted', previewHasBall);
  await opts.screenshot({ path: path.join(SHOTS, 'options-light.png'), fullPage: true });
  await opts.emulateMedia({ colorScheme: 'dark' });
  await opts.screenshot({ path: path.join(SHOTS, 'options-dark.png'), fullPage: true });
  await opts.emulateMedia({ colorScheme: 'light' });

  await opts.evaluate(() => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('transparency', '60'); set('size', '56'); set('timing', '450');
  });
  await sleep(500);
  const saved = (await storageGet()).settings;
  check('options: moving the sliders saves the settings', saved && saved.transparency === 0.6 && saved.size === 56 && saved.doubleTapMs === 450, JSON.stringify(saved));

  // the open page tab should have followed the change live
  const bigLive = centerOf(DTR.DEFAULT_POSITION, VW, VH, 56);
  await page.bringToFront();
  await load('/page');
  check('options: a page opened afterwards uses the saved size', await isBallAt(bigLive.x - 24, bigLive.y));

  await storageSet({ position: { x: 0.2, y: 0.2 } });
  await opts.bringToFront();
  await opts.click('#reset-position');
  await sleep(400);
  check('options: "Reset position" removes the saved position', (await storageGet()).position === undefined);
  await opts.click('#reset-defaults');
  await sleep(500);
  const restored = (await storageGet()).settings;
  check('options: "Restore defaults" writes the default settings', restored && restored.transparency === 0.35 && restored.size === 44 && restored.doubleTapMs === 350, JSON.stringify(restored));

  // preview double-tap: the preview ball responds without leaving the page
  const urlBefore = opts.url();
  const box = await opts.evaluate(() => { const r = document.getElementById('preview').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const optsCdp = await context.newCDPSession(opts);
  const t2 = (type, x, y) => optsCdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  await t2('touchStart', box.x, box.y); await sleep(40); await t2('touchEnd'); await sleep(90);
  await t2('touchStart', box.x, box.y); await sleep(40); await t2('touchEnd'); await sleep(900);
  check('options: double-tapping the preview does not navigate', opts.url() === urlBefore);

  // ---- no console errors from the extension on a normal page
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.bringToFront(); // CDP touch input does not reach a background tab
  await load('/page');
  n = await reloadsAfter(() => doubleTap(home.x, home.y), 1200);
  check('no page errors or console errors during use (and the double tap really reloaded)', errors.length === 0 && n === 1, `${errors.join(' ; ')} reloads: ${n}`);

  // ---- background cannot reload the tab (tabs.reload failing, or missing on this platform)
  await page.bringToFront();
  await load('/page');
  await resetCounter();
  await sw.evaluate(() => { chrome.tabs.reload = () => Promise.reject(new Error('simulated failure')); });
  n = await reloadsAfter(() => doubleTap(home.x, home.y), 2000);
  check('tabs.reload() rejecting: the page reloads itself, exactly once', n === 1, `reloads: ${n}`);
  await sleep(500);
  await sw.evaluate(() => { chrome.tabs.reload = undefined; });
  n = await reloadsAfter(() => doubleTap(home.x, home.y), 2000);
  const asked = await counted();
  check('tabs.reload() missing: the page reloads itself, exactly once', n === 1 && asked === 2, `reloads: ${n}, background messages: ${asked}`);
  await sleep(500);

  // ---- extension reloaded while a page is open: the old content script is orphaned.
  // (Last on purpose: Playwright's --load-extension does not bring the extension back afterwards.)
  await storageClear();
  await load('/page');
  await sw.evaluate(() => chrome.runtime.reload()).catch(() => {});
  await sleep(2000);
  n = await reloadsAfter(() => doubleTap(home.x, home.y), 2000);
  check('after the extension is reloaded, an already-open page still reloads exactly once (fallback path)', n === 1, `reloads: ${n}`);

  await context.close();
  server.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('HARNESS ERROR:', err);
  process.exit(2);
});
