'use strict';
// Keeps the two manifests honest. Run: node --test tests/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const chromium = read('manifests/chromium.json');
const firefox = read('manifests/firefox.json');

test('both manifests share the same identity and behaviour', () => {
  for (const key of ['manifest_version', 'name', 'version', 'description', 'icons', 'permissions', 'content_scripts', 'action', 'options_ui']) {
    assert.deepEqual(firefox[key], chromium[key], key);
  }
  assert.equal(chromium.manifest_version, 3);
  assert.match(chromium.version, /^\d+(\.\d+){0,3}$/);
});

test('every file a manifest points at exists in src/', () => {
  const files = new Set();
  for (const m of [chromium, firefox]) {
    Object.values(m.icons).forEach((f) => files.add(f));
    Object.values(m.action.default_icon).forEach((f) => files.add(f));
    m.content_scripts.forEach((cs) => cs.js.forEach((f) => files.add(f)));
    files.add(m.options_ui.page);
  }
  files.add(chromium.background.service_worker);
  firefox.background.scripts.forEach((f) => files.add(f));
  for (const file of files) {
    assert.ok(fs.existsSync(path.join(ROOT, 'src', file)), `src/${file} is missing`);
  }
});

test('least privilege: storage only, http(s) pages only, top frame only', () => {
  assert.deepEqual(chromium.permissions, ['storage']);
  assert.equal(chromium.host_permissions, undefined);
  assert.equal(firefox.host_permissions, undefined);
  for (const cs of chromium.content_scripts) {
    assert.deepEqual(cs.matches, ['http://*/*', 'https://*/*']);
    assert.notEqual(cs.all_frames, true);
    assert.ok(cs.js.indexOf('shared.js') < cs.js.indexOf('content.js'), 'shared.js must load first');
  }
});

test('Chromium manifest targets Chromium 152+ with a service worker', () => {
  assert.equal(chromium.minimum_chrome_version, '152');
  assert.equal(chromium.background.service_worker, 'background.js');
  assert.equal(chromium.background.scripts, undefined);
  assert.equal(chromium.browser_specific_settings, undefined);
});

test('Firefox manifest targets Firefox 160+ on desktop and Android', () => {
  const b = firefox.browser_specific_settings;
  assert.deepEqual(firefox.background, { scripts: ['background.js'] });
  assert.match(b.gecko.id, /^[a-zA-Z0-9-._]*@[a-zA-Z0-9-._]+$/);
  assert.ok(b.gecko.id.length <= 80);
  assert.equal(b.gecko.strict_min_version, '160.0');
  assert.equal(b.gecko_android.strict_min_version, '160.0');
  assert.deepEqual(b.gecko.data_collection_permissions, { required: ['none'] });
  assert.equal(firefox.minimum_chrome_version, undefined);
});

test('version is valid for both stores; a label like "-beta" belongs in version_name', () => {
  // addons.mozilla.org: 1 to 4 dot-separated numbers, no leading zeros, at most 9 digits each.
  const AMO = /^(0|[1-9][0-9]{0,8})([.](0|[1-9][0-9]{0,8})){0,3}$/;
  assert.match(firefox.version, AMO);
  assert.match(chromium.version, AMO);
  // Chrome Web Store: every number between 0 and 65535, and not all zeros.
  const parts = chromium.version.split('.').map(Number);
  assert.ok(parts.every((n) => n <= 65535), 'a number is above 65535');
  assert.ok(parts.some((n) => n > 0), 'version must not be all zeros');
  // The label (for example "0.1.0-beta") must start with the real version.
  if (chromium.version_name !== undefined) {
    assert.ok(chromium.version_name.startsWith(chromium.version), 'version_name should start with version');
  }
});
