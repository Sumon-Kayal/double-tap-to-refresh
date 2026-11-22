'use strict';
// Dependency-free tests for the pure logic in src/shared.js. Run: node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'src');

function loadShared() {
  const context = vm.createContext({ chrome: {} });
  vm.runInContext(fs.readFileSync(path.join(SRC, 'shared.js'), 'utf8'), context, { filename: 'shared.js' });
  return context.DTR;
}

const DTR = loadShared();
const plain = (value) => JSON.parse(JSON.stringify(value)); // objects from the vm context have a foreign prototype

test('sanitizeSettings returns the defaults for missing or malformed input', () => {
  const defaults = plain(DTR.DEFAULTS);
  for (const input of [undefined, null, 42, 'x', [], {}]) {
    assert.deepEqual(plain(DTR.sanitizeSettings(input)), defaults);
  }
});

test('sanitizeSettings clamps to the limits and rounds whole-number settings', () => {
  assert.deepEqual(
    plain(DTR.sanitizeSettings({ transparency: 5, size: 500, doubleTapMs: 1 })),
    { transparency: 0.85, size: 72, doubleTapMs: 200 },
  );
  assert.deepEqual(
    plain(DTR.sanitizeSettings({ transparency: -1, size: 1, doubleTapMs: 99999 })),
    { transparency: 0, size: 32, doubleTapMs: 600 },
  );
  const rounded = DTR.sanitizeSettings({ size: 44.6, doubleTapMs: 349.4 });
  assert.equal(rounded.size, 45);
  assert.equal(rounded.doubleTapMs, 349);
});

test('sanitizeSettings ignores values that are not finite numbers', () => {
  const defaults = plain(DTR.DEFAULTS);
  const result = plain(DTR.sanitizeSettings({ transparency: NaN, size: Infinity, doubleTapMs: '350' }));
  assert.deepEqual(result, defaults);
});

test('sanitizePosition defaults and clamps to 0..1', () => {
  assert.deepEqual(plain(DTR.sanitizePosition(undefined)), plain(DTR.DEFAULT_POSITION));
  assert.deepEqual(plain(DTR.sanitizePosition({ x: -3, y: 9 })), { x: 0, y: 1 });
  assert.deepEqual(plain(DTR.sanitizePosition({ x: 0.25, y: 'nope' })), { x: 0.25, y: DTR.DEFAULT_POSITION.y });
});

test('toPixels keeps the ball inside the viewport at the extremes', () => {
  const size = 44;
  const topLeft = DTR.toPixels({ x: 0, y: 0 }, 390, 844, size);
  const bottomRight = DTR.toPixels({ x: 1, y: 1 }, 390, 844, size);
  assert.ok(topLeft.left > 0 && topLeft.top > 0, 'leaves a gap at the top-left');
  assert.ok(bottomRight.left + size < 390 && bottomRight.top + size < 844, 'leaves a gap at the bottom-right');
});

test('toRatios inverts toPixels', () => {
  for (const pos of [{ x: 0, y: 0 }, { x: 1, y: 0.7 }, { x: 0.33, y: 0.91 }]) {
    const px = DTR.toPixels(pos, 412, 915, 52);
    const back = DTR.toRatios(px.left, px.top, 412, 915, 52);
    assert.ok(Math.abs(back.x - pos.x) < 1e-9 && Math.abs(back.y - pos.y) < 1e-9, JSON.stringify(pos));
  }
});

test('rotating the phone keeps the ball on the same side', () => {
  const portrait = DTR.toPixels({ x: 1, y: 0.5 }, 390, 844, 44);
  const landscape = DTR.toPixels({ x: 1, y: 0.5 }, 844, 390, 44);
  assert.equal(portrait.left, 390 - 44 - 6);
  assert.equal(landscape.left, 844 - 44 - 6);
});

test('a viewport smaller than the ball never produces NaN or negative travel', () => {
  const t = DTR.travel(20, 20, 44);
  assert.ok(t.maxX >= t.minX && t.maxY >= t.minY);
  const back = DTR.toRatios(6, 6, 20, 20, 44);
  assert.deepEqual(plain(back), { x: 0, y: 0 });
  const px = DTR.toPixels({ x: 1, y: 1 }, 20, 20, 44);
  assert.ok(Number.isFinite(px.left) && Number.isFinite(px.top));
});

test('the message names match between shared.js and background.js', () => {
  const background = fs.readFileSync(path.join(SRC, 'background.js'), 'utf8');
  const pick = (name) => {
    const match = background.match(new RegExp(`${name}\\s*=\\s*'([^']+)'`));
    assert.ok(match, `background.js defines ${name}`);
    return match[1];
  };
  assert.equal(pick('MESSAGE_RELOAD'), DTR.MESSAGE.reload);
  assert.equal(pick('MESSAGE_RELOAD_FAILED'), DTR.MESSAGE.reloadFailed);
});
