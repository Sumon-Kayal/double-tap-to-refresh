'use strict';
// The license travels with the code: every source file names it, the options page links to the text,
// and the docs say the same thing everywhere. Run: node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const text = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const sources = fs.readdirSync(path.join(ROOT, 'src')).filter((name) => /\.(js|css|html)$/.test(name));

test('every source file starts with the copyright line and the SPDX identifier', () => {
  assert.ok(sources.length >= 6, 'expected the extension sources');
  for (const name of sources) {
    const head = text('src', name).slice(0, 700);
    assert.match(head, /Copyright \(C\) 20\d\d Sumon Kayal/, `src/${name}: copyright line`);
    assert.match(head, /SPDX-License-Identifier: GPL-3\.0-only/, `src/${name}: SPDX identifier`);
    assert.doesNotMatch(text('src', name), /GPL-3\.0-or-later/, `src/${name}: the project is GPL-3.0-only`);
  }
});

test('LICENSE.md is the GNU General Public License, version 3', () => {
  const license = text('LICENSE.md');
  assert.match(license, /GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/);
  assert.match(license, /END OF TERMS AND CONDITIONS/);
});

test('README and CHANGELOG name the same license as the source files', () => {
  for (const file of ['README.md', 'CHANGELOG.md']) {
    assert.match(text(file), /GPL-3\.0-only/, `${file} names GPL-3.0-only`);
  }
  assert.match(text('README.md'), /Copyright \(C\) 20\d\d Sumon Kayal/, 'README states the same copyright holder');
});

test('the options page links to LICENSE.txt, and build.sh puts that file in every build', () => {
  assert.match(text('src', 'options.html'), /<a href="LICENSE\.txt">/);
  assert.match(text('scripts', 'build.sh'), /cp "\$license" "\$target\/LICENSE\.txt"/);
});
