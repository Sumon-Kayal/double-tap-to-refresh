'use strict';
// SPEC section 8 keeps the content script light: shared.js and content.js are loaded into every web page,
// unminified and with their comments. This fails when they grow past the budget. Run: node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BUDGET_BYTES = 36000; // about 35 KB after feature import (comments and the license header included)
const size = (name) => fs.statSync(path.join(__dirname, '..', 'src', name)).size;

test('the scripts injected into every page stay within the size budget', () => {
  const total = size('shared.js') + size('content.js');
  assert.ok(total <= BUDGET_BYTES, `shared.js + content.js are ${total} bytes; the budget is ${BUDGET_BYTES}`);
});
