'use strict';
// README.md and SPEC.md say things about the code, the manifests, the scripts and the workflows. Each test here takes
// one of those claims and checks it against the thing it describes, so a change that the other side does not follow
// fails. Nothing here starts a browser, and CHANGELOG.md is only read for the headings that README links to.
// Run: node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const README = read('README.md');
const SPEC = read('SPEC.md');
const SHARED = read('src', 'shared.js');
const SOURCES = fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js')).map((f) => read('src', f)).join('\n');
const chromium = JSON.parse(read('manifests', 'chromium.json'));
const firefox = JSON.parse(read('manifests', 'firefox.json'));
const gecko = firefox.browser_specific_settings.gecko;
const geckoAndroid = firefox.browser_specific_settings.gecko_android;
const WORKFLOWS = fs.readdirSync(path.join(ROOT, '.github', 'workflows')).filter((f) => f.endsWith('.yml')).sort();
const workflow = (file) => read('.github', 'workflows', file);

const context = vm.createContext({ chrome: {} });
vm.runInContext(SHARED, context, { filename: 'shared.js' });
const { DEFAULTS, LIMITS, DEFAULT_POSITION } = JSON.parse(JSON.stringify(context.DTR)); // plain data only
const constant = (name) => Number(new RegExp(`const ${name} = (\\d+)`).exec(SHARED)[1]);
const percent = (fraction) => Math.round(fraction * 100);
const label = (manifest) => manifest.version_name ?? manifest.version;
const startsWith = (text, prefix) => text.split('\n').find((l) => l.startsWith(prefix));

test('README and SPEC give the settings, limits and defaults that the code has', () => {
  const transparency = `${percent(LIMITS.transparency.min)}–${percent(LIMITS.transparency.max)} %`;
  const rows = [
    ['Transparency', transparency, `${percent(DEFAULTS.transparency)} %`],
    ['Size', `${LIMITS.size.min}–${LIMITS.size.max} px`, `${DEFAULTS.size} px`],
    ['Double-tap timing', `${LIMITS.doubleTapMs.min}–${LIMITS.doubleTapMs.max} ms`, `${DEFAULTS.doubleTapMs} ms`],
  ];
  for (const [name, range, fallback] of rows) {
    const readme = startsWith(README, `| ${name}`);
    assert.ok(readme?.endsWith(`| ${range} | ${fallback} |`), `README ${name}: expected ... | ${range} | ${fallback} |, found: ${readme}`);
    assert.equal(startsWith(SPEC, `| ${name} |`), `| ${name} | ${fallback} | ${range} |`, `SPEC appendix A, ${name}`);
  }

  const hold = constant('HOLD_MS');
  const slop = constant('SLOP_PX');
  const gap = constant('EDGE_GAP');
  assert.equal(startsWith(SPEC, '| Hold before drag'), `| Hold before drag | ${hold} ms | fixed |`);
  assert.equal(startsWith(SPEC, '| Movement tolerance'), `| Movement tolerance | ${slop} px | fixed |`);
  assert.equal(startsWith(SPEC, '| Gap to viewport edge'), `| Gap to viewport edge | ${gap} px | fixed |`);
  for (const phrase of [
    `${DEFAULTS.size} px by default`,
    `The default is ${DEFAULTS.doubleTapMs} ms`,
    `Movement up to ${slop} px may still count as a tap`,
    `A press becomes a drag after ${hold} ms without moving more than ${slop} px`,
    `${gap} px gap on every side`,
    `(${transparency}, default ${percent(DEFAULTS.transparency)} %)`,
    `size (${LIMITS.size.min}–${LIMITS.size.max} px)`,
  ]) {
    assert.ok(SPEC.includes(phrase), `SPEC should say: ${phrase}`);
  }

  assert.equal(DEFAULT_POSITION.x, 1, 'the docs say "right edge"');
  const start = `right edge, ${percent(DEFAULT_POSITION.y)} % down`;
  assert.ok(README.includes(start), `README should say: ${start}`);
  assert.ok(SPEC.includes(start), `SPEC should say: ${start}`);
  const seconds = (hold / 1000).toFixed(1);
  assert.ok(README.includes(`about ${seconds} s`) && README.includes(`~${seconds} s`), `README should give the hold as ${seconds} s`);
});

test('README and SPEC name the browser versions, label and add-on ID that the manifests have', () => {
  const chrome = Number(chromium.minimum_chrome_version);
  const desktop = Number.parseInt(gecko.strict_min_version, 10);
  assert.equal(desktop, Number.parseInt(geckoAndroid.strict_min_version, 10), 'the docs give one Firefox number for desktop and Android');
  assert.ok(README.includes(`| **Browsers** | Firefox ${desktop}+ (desktop and Android), Chromium ${chrome}+ |`));
  assert.ok(SPEC.includes(`Chromium ${chrome}+ and Firefox ${desktop}+`));
  for (const key of [
    `minimum_chrome_version: "${chromium.minimum_chrome_version}"`,
    `gecko.strict_min_version: "${gecko.strict_min_version}"`,
    `gecko_android.strict_min_version: "${geckoAndroid.strict_min_version}"`,
  ]) {
    assert.ok(SPEC.includes(key), `SPEC section 6.3 should show ${key}`);
  }

  assert.ok(README.includes(`| **Version** | ${label(chromium)} |`));
  assert.ok(README.includes(`Chromium shows the version as \`${label(chromium)}\`; Firefox shows \`${firefox.version}\``));
  assert.ok(README.includes(`double-tap-to-refresh-chromium-${label(chromium)}.zip`));
  assert.ok(README.includes(`double-tap-to-refresh-firefox-${label(firefox)}.xpi`));

  const ids = README.match(/double-tap-to-refresh@[\w.-]+/g) ?? [];
  assert.ok(ids.length > 0, 'README names the add-on ID');
  for (const id of ids) assert.equal(id, gecko.id, 'README names the add-on ID that manifests/firefox.json has');

  assert.deepEqual(chromium.permissions, ['storage']);
  assert.ok(README.includes('`storage` only') && README.includes('`http://` and `https://` pages, top frame only'));
});

test('the size of the per-page script in README and SPEC matches the files', () => {
  const bytes = ['shared.js', 'content.js'].reduce((sum, f) => sum + fs.statSync(path.join(ROOT, 'src', f)).size, 0);
  for (const [name, text] of [['README', README], ['SPEC', SPEC]]) {
    const claimed = Number(/about (\d+) KB/.exec(text)?.[1]);
    assert.ok(claimed > 0, `${name} should state the size`);
    assert.ok(Math.abs(claimed * 1000 - bytes) <= 1000, `${name} says about ${claimed} KB, but shared.js + content.js are ${bytes} bytes`);
  }
});

test('the browser-check count in README is the number of checks in tests/e2e/run.js (counted, not run)', () => {
  const claimed = Number(/\((\d+) browser checks\)/.exec(README)?.[1]);
  const actual = (read('tests', 'e2e', 'run.js').match(/^\s*(?:await\s+)?check\(/gm) || []).length;
  assert.equal(claimed, actual);
});

test('what the SPEC says about the page, the network and the code is true of the source', () => {
  const claims = [
    [/closed shadow root/, /attachShadow\(\{ mode: 'closed' \}\)/],
    [/highest z-index/, /HOST_Z_INDEX = '2147483647'/],
    [/hidden when printing/, /beforeprint/],
    [/put back \(at most five times\)/, /\+\+attempts > 5/],
    [/`tabs\.create` fallback/, /openOptionsPage[\s\S]*tabs\.create/],
  ];
  for (const [inSpec, inSource] of claims) {
    assert.match(SPEC, inSpec);
    assert.match(SOURCES, inSource, `the source should do what the SPEC says (${inSpec})`);
  }
  assert.match(SPEC, /makes no network requests/);
  assert.doesNotMatch(SOURCES, /\bfetch\(|\bXMLHttpRequest\b|\bWebSocket\b|\bsendBeacon\b|\bEventSource\b/, 'no network requests');
  assert.match(SPEC, /never a `<style>` element or a `style` attribute/);
  assert.doesNotMatch(SOURCES, /createElement\(['"]style['"]\)|setAttribute\(['"]style['"]/, 'styled only through the CSSOM');
});

test('every script is named in README, and README shows the usage the scripts print', () => {
  for (const file of fs.readdirSync(path.join(ROOT, 'scripts'))) {
    assert.ok(README.includes(file), `README should name scripts/${file}`);
  }
  const build = /echo "usage: scripts\/build\.sh (.+?)" >&2/.exec(read('scripts', 'build.sh'))[1];
  const archive = /echo "usage: scripts\/make-archive\.sh (.+?)" >&2/.exec(read('scripts', 'make-archive.sh'))[1];
  assert.ok(README.includes(`./scripts/build.sh ${build}`), `README should show ./scripts/build.sh ${build}`);
  assert.ok(README.includes(`./scripts/make-archive.sh ${archive}`), `README should show ./scripts/make-archive.sh ${archive}`);

  const makeArchive = read('scripts', 'make-archive.sh');
  assert.ok(makeArchive.includes('$browser-$safe_branch-$mode-$version.tar.gz'), 'the archive is named <browser>-<branch>-<mode>-<version>.tar.gz');
  for (const browser of ['chromium', 'firefox']) {
    assert.ok(README.includes(`${browser}-<branch>-<mode>-<version>.tar.gz`), `README should show the ${browser} archive name`);
  }
  for (const inner of ['chromium.zip', 'firefox-signed.xpi']) {
    assert.ok(makeArchive.includes(`packaged_as=${inner}`) && README.includes(inner), `${inner} is stored in the archive and shown in README`);
  }
  if (read('scripts', 'lib.sh').includes('.source-date-epoch')) {
    assert.ok(README.includes('.source-date-epoch'), 'README should explain .source-date-epoch');
  }
});

test('README describes the workflows as they are: names, jobs, secrets, artifacts and retention', () => {
  for (const file of WORKFLOWS) {
    const name = /^name: (.+)$/m.exec(workflow(file))[1];
    assert.ok(README.includes(`\`${file}\``), `README should name ${file}`);
    assert.ok(README.includes(`**${name}**`), `README should call ${file} **${name}**`);
  }

  const jobs = [...workflow('firefox.yml').matchAll(/^ {2}[\w-]+:\n {4}name: (.+)$/gm)].map((m) => m[1]);
  assert.equal(jobs.length, 3, 'the Firefox workflow has three jobs');
  for (const job of jobs) assert.ok(README.includes(`*${job}*`), `README should name the job *${job}*`);

  const secrets = new Set(WORKFLOWS.flatMap((f) => [...workflow(f).matchAll(/secrets\.(\w+)/g)].map((m) => m[1])));
  assert.deepEqual([...secrets].sort(), ['WEB_EXT_API_KEY', 'WEB_EXT_API_SECRET']);
  for (const secret of secrets) assert.ok(README.includes(`\`${secret}\``), `README should name the secret ${secret}`);

  const retention = (file, artifact) => Number(new RegExp(`name: ${artifact}\\n\\s+path: .*\\n\\s+retention-days: (\\d+)`).exec(workflow(file))?.[1]);
  for (const [file, artifact] of [['firefox.yml', 'Firefox-Development'], ['chromium.yml', 'Chromium-Development']]) {
    assert.ok(README.includes(artifact), `README should name the artifact ${artifact}`);
    assert.ok(README.includes(`${retention(file, artifact) * 24} hours`), `README should give the retention of ${artifact} in hours`);
  }
  assert.equal(retention('firefox.yml', 'Firefox-Unsigned-Dir'), 1);
  assert.ok(README.includes('one-day artifact'), 'README should say the signing hand-over lasts one day');

  const testRelease = workflow('test release.yml');
  const days = Number(/retention-days: (\d+)/.exec(testRelease)[1]);
  assert.ok(README.includes(`kept ${days} days`), 'README should give the retention of the test release');
  for (const file of ['test-release-bundle.tar.gz', 'source-chrome.tar.gz', 'source-firefox.tar.gz']) {
    assert.ok(testRelease.includes(file) && README.includes(file), `${file} is made by the test release and named in README`);
  }
  for (const file of ['chromium.yml', 'firefox.yml']) {
    assert.match(workflow(file), /^ {6}tag:\n {8}description: Release tag/m, `${file} takes the tag input`);
  }
  assert.ok(README.includes('**tag**'), 'README should explain the tag input');
});

test('every repo path named in README and SPEC exists', () => {
  const missing = [];
  for (const [file, text] of [['README.md', README], ['SPEC.md', SPEC]]) {
    for (const [, token] of text.matchAll(/`([^`\n]+)`/g)) {
      const name = token.replace(/^\.\//, '');
      const isPath = /^(src|scripts|tests|manifests|\.github)\/[\w./-]*$/.test(name) || /^(LICENSE|CHANGELOG|README|SPEC)\.md$/.test(name);
      if (isPath && !fs.existsSync(path.join(ROOT, name))) missing.push(`${file}: ${token}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('the README project layout lists real paths and the main folders', () => {
  const block = /## Project layout\n+```\n([\s\S]*?)```/.exec(README)?.[1];
  assert.ok(block, 'README has a Project layout block');
  const listed = block.split('\n').filter((l) => /^\S/.test(l)).map((l) => l.split(/\s+/)[0]);
  const generated = ['chromium/', 'firefox/', 'dist/']; // made by scripts/build.sh, so they may not exist
  for (const entry of listed) {
    if (!generated.includes(entry)) assert.ok(fs.existsSync(path.join(ROOT, entry)), `${entry} is listed but does not exist`);
  }
  const tops = new Set(listed.map((entry) => entry.split('/')[0]));
  for (const folder of ['src', 'manifests', 'scripts', 'tests', '.github']) assert.ok(tops.has(folder), `${folder}/ should be in the layout`);
});

// GitHub's heading anchors: lower case, formatting and punctuation dropped, spaces to hyphens, repeats numbered.
function slug(heading) {
  return heading
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*~]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_ -]/gu, '')
    .replace(/ /g, '-');
}

function anchors(text) {
  const seen = new Map();
  const found = new Set();
  let fenced = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    const heading = fenced ? null : /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    const base = slug(heading[1]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    found.add(count === 0 ? base : `${base}-${count}`);
  }
  return found;
}

test('every relative link and heading anchor in README and SPEC resolves', () => {
  const headings = { 'README.md': anchors(README), 'SPEC.md': anchors(SPEC), 'CHANGELOG.md': anchors(read('CHANGELOG.md')) };
  const broken = [];
  for (const [file, text] of [['README.md', README], ['SPEC.md', SPEC]]) {
    for (const [, target] of text.replace(/```[\s\S]*?```/g, '').matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // https://, mailto:
      const [target_file, fragment] = target.split('#');
      const destination = target_file || file;
      if (!fs.existsSync(path.join(ROOT, destination))) broken.push(`${file}: ${target} (no such file)`);
      else if (fragment && !headings[destination]?.has(fragment)) broken.push(`${file}: ${target} (no such heading)`);
    }
  }
  assert.deepEqual(broken, []);
});
