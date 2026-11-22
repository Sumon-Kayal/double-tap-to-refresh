'use strict';
// Checks scripts/build.sh, scripts/make-archive.sh and .gitignore in a scratch copy of the project.
// Needs bash, zip, unzip, git and GNU tar; each test skips itself when one is missing. Run: node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const probe = { bash: ['--version'], zip: ['-v'], unzip: ['-v'], git: ['--version'], tar: ['--version'] };
const missing = Object.keys(probe).find((tool) => spawnSync(tool, probe[tool], { stdio: 'ignore' }).status !== 0);
const SKIP = missing ? `needs ${missing}` : false;

const read = (file) => fs.readFileSync(file);
const sha = (file) => crypto.createHash('sha256').update(read(file)).digest('hex');
const json = (file) => JSON.parse(read(file).toString('utf8'));
const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8' });
const GIT = ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid'];
const commit = (dir, message) => assert.equal(run('git', [...GIT, 'commit', '-q', '-a', '-m', message], dir).status, 0);

// A scratch project holding just what the scripts need.
function scratch(t, { git = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtr-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of ['src', 'manifests', 'scripts', 'LICENSE.md', '.gitignore']) {
    fs.cpSync(path.join(ROOT, name), path.join(dir, name), { recursive: true });
  }
  if (git) {
    assert.equal(run('git', ['init', '-q'], dir).status, 0);
    assert.equal(run('git', ['add', '-A'], dir).status, 0);
    commit(dir, 'test');
  }
  return dir;
}

const build = (dir, ...args) => run('bash', ['scripts/build.sh', ...args], dir);
const files = (dir) => {
  const out = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const next = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(next);
      else out.push(next.split(path.sep).join('/'));
    }
  };
  walk('.');
  return out.map((f) => f.replace(/^\.\//, '')).sort();
};
const zipList = (file) => run('unzip', ['-Z1', file]).stdout.trim().split('\n').sort();
const tarList = (file) => run('tar', ['-tzf', file]).stdout.trim().split('\n');
const label = (manifest) => manifest.version_name ?? manifest.version;

test('build.sh makes both folders from src, the manifest and the license saved as LICENSE.txt', { skip: SKIP }, (t) => {
  const dir = scratch(t);
  const result = build(dir);
  assert.equal(result.status, 0, result.stderr);

  for (const browser of ['chromium', 'firefox']) {
    const manifest = json(path.join(dir, 'manifests', `${browser}.json`));
    const out = path.join(dir, browser);
    assert.deepEqual(read(path.join(out, 'manifest.json')), read(path.join(dir, 'manifests', `${browser}.json`)));
    assert.deepEqual(read(path.join(out, 'LICENSE.txt')), read(path.join(dir, 'LICENSE.md')), 'LICENSE.txt is the license, unchanged');
    assert.ok(!fs.existsSync(path.join(out, 'LICENSE.md')), 'only LICENSE.txt travels with a build');
    for (const file of files(path.join(dir, 'src'))) {
      assert.deepEqual(read(path.join(out, file)), read(path.join(dir, 'src', file)), `${file} is copied unchanged`);
    }
    assert.deepEqual(files(out), [...files(path.join(dir, 'src')), 'LICENSE.txt', 'manifest.json'].sort(), `${browser}/ holds nothing else`);

    const referenced = [
      ...Object.values(manifest.icons),
      ...Object.values(manifest.action.default_icon),
      ...manifest.content_scripts.flatMap((cs) => cs.js),
      manifest.options_ui.page,
      manifest.background.service_worker ?? manifest.background.scripts[0],
    ];
    for (const file of referenced) assert.ok(fs.existsSync(path.join(out, file)), `${browser}/${file} is missing`);
  }
});

test('build.sh zips each folder: manifest at the root, same files, no folder entries, named after the label', { skip: SKIP }, (t) => {
  const dir = scratch(t);
  assert.equal(build(dir).status, 0);
  const cases = [['chromium', 'zip'], ['firefox', 'xpi']];
  for (const [browser, extension] of cases) {
    const manifest = json(path.join(dir, 'manifests', `${browser}.json`));
    const pkg = path.join(dir, 'dist', `double-tap-to-refresh-${browser}-${label(manifest)}.${extension}`);
    assert.ok(fs.existsSync(pkg), `${pkg} was not made`);
    const listed = zipList(pkg);
    assert.deepEqual(listed, files(path.join(dir, browser)));
    assert.ok(listed.includes('manifest.json'), 'manifest.json sits at the root of the package');
    assert.ok(listed.every((name) => !name.endsWith('/')), 'no folder entries');
  }
  assert.equal(fs.readdirSync(path.join(dir, 'dist')).length, 2);
});

test('the same source gives byte-identical packages, even after the files were touched', { skip: SKIP }, (t) => {
  const dir = scratch(t);
  assert.equal(build(dir).status, 0);
  const names = fs.readdirSync(path.join(dir, 'dist')).sort();
  const before = names.map((n) => sha(path.join(dir, 'dist', n)));

  const later = new Date('2031-05-05T05:05:05Z');
  for (const file of files(path.join(dir, 'src'))) fs.utimesSync(path.join(dir, 'src', file), later, later);
  fs.utimesSync(path.join(dir, 'LICENSE.md'), later, later);
  assert.equal(build(dir).status, 0);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'dist')).sort(), names);
  assert.deepEqual(names.map((n) => sha(path.join(dir, 'dist', n))), before);
});

test('build.sh builds one browser on request and rejects anything else', { skip: SKIP }, (t) => {
  const dir = scratch(t);
  assert.equal(build(dir, 'firefox').status, 0);
  assert.ok(fs.existsSync(path.join(dir, 'firefox', 'manifest.json')));
  assert.ok(!fs.existsSync(path.join(dir, 'chromium')), 'chromium/ was not asked for');

  const wrong = build(dir, 'safari');
  assert.equal(wrong.status, 2);
  assert.match(wrong.stderr, /usage/);
  assert.equal(build(dir, 'firefox', 'chromium').status, 2);
});

test('build.sh needs a license: LICENSE.md, or LICENSE as a fallback', { skip: SKIP }, (t) => {
  const none = scratch(t);
  fs.rmSync(path.join(none, 'LICENSE.md'));
  const failed = build(none);
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /license is missing/);

  const plain = scratch(t);
  fs.renameSync(path.join(plain, 'LICENSE.md'), path.join(plain, 'LICENSE'));
  assert.equal(build(plain).status, 0);
  assert.deepEqual(read(path.join(plain, 'firefox', 'LICENSE.txt')), read(path.join(plain, 'LICENSE')));
});

test('make-archive.sh packs extension/ and source/ under <browser>-<branch>-<mode>-<version>.tar.gz', { skip: SKIP }, (t) => {
  const dir = scratch(t, { git: true });
  assert.equal(build(dir).status, 0);
  const version = json(path.join(dir, 'manifests', 'firefox.json')).version;
  const pkg = fs.readdirSync(path.join(dir, 'dist')).find((n) => n.endsWith('.xpi'));
  fs.copyFileSync(path.join(dir, 'dist', pkg), path.join(dir, 'dist', 'firefox-signed.xpi'));

  const made = run('bash', ['scripts/make-archive.sh', 'firefox', 'development', 'feature/x y', 'dist/firefox-signed.xpi'], dir);
  assert.equal(made.status, 0, made.stderr);
  assert.equal(made.stdout.trim(), `dist/firefox-feature-x-y-development-${version}.tar.gz`, 'the path is the only thing on stdout');

  const archive = path.join(dir, made.stdout.trim());
  const listed = tarList(archive);
  for (const entry of ['extension/firefox-signed.xpi', 'source/manifests/firefox.json', 'source/manifests/chromium.json',
    'source/scripts/build.sh', 'source/LICENSE.md', 'source/src/shared.js', 'source/.gitignore']) {
    assert.ok(listed.includes(entry), `${entry} is missing`);
  }
  assert.ok(listed.every((e) => /^(extension|source)(\/|$)/.test(e)), 'only extension/ and source/ at the top');
  assert.ok(!listed.some((e) => /^source\/(chromium|firefox|dist)\//.test(e)), 'build output is not source');
  const inside = spawnSync('tar', ['-xzOf', archive, 'extension/firefox-signed.xpi']).stdout;
  assert.deepEqual(inside, read(path.join(dir, 'dist', 'firefox-signed.xpi')), 'the package is stored unchanged');

  const again = run('bash', ['scripts/make-archive.sh', 'firefox', 'development', 'feature/x y', 'dist/firefox-signed.xpi'], dir);
  assert.equal(sha(path.join(dir, again.stdout.trim())), sha(archive), 'the same input gives the same archive');
});

test('make-archive.sh names Chromium archives and release builds correctly', { skip: SKIP }, (t) => {
  const dir = scratch(t, { git: true });
  assert.equal(build(dir, 'chromium').status, 0);
  const version = json(path.join(dir, 'manifests', 'chromium.json')).version;
  const pkg = fs.readdirSync(path.join(dir, 'dist')).find((n) => n.endsWith('.zip'));
  fs.copyFileSync(path.join(dir, 'dist', pkg), path.join(dir, 'dist', 'chromium.zip'));

  const made = run('bash', ['scripts/make-archive.sh', 'chromium', 'release', 'main', 'dist/chromium.zip'], dir);
  assert.equal(made.status, 0, made.stderr);
  assert.equal(made.stdout.trim(), `dist/chromium-main-release-${version}.tar.gz`);
  assert.ok(tarList(path.join(dir, made.stdout.trim())).includes('extension/chromium.zip'));
});

test('make-archive.sh refuses bad input and tracked files that look like secrets', { skip: SKIP }, (t) => {
  const dir = scratch(t, { git: true });
  assert.equal(build(dir, 'chromium').status, 0);
  const pkg = fs.readdirSync(path.join(dir, 'dist')).find((n) => n.endsWith('.zip'));
  fs.copyFileSync(path.join(dir, 'dist', pkg), path.join(dir, 'dist', 'chromium.zip'));
  const pack = (...args) => run('bash', ['scripts/make-archive.sh', ...args], dir);

  assert.equal(pack('chromium', 'staging', 'main', 'dist/chromium.zip').status, 2, 'unknown mode');
  assert.equal(pack('opera', 'release', 'main', 'dist/chromium.zip').status, 2, 'unknown browser');
  assert.notEqual(pack('chromium', 'release', 'main', 'dist/nope.zip').status, 0, 'missing package');

  fs.writeFileSync(path.join(dir, '.env'), 'TOKEN=not-a-real-secret\n');
  fs.writeFileSync(path.join(dir, 'signing.pem'), 'not a real key\n');
  assert.equal(run('git', ['add', '-f', '.env', 'signing.pem'], dir).status, 0);
  commit(dir, 'oops');
  const refused = pack('chromium', 'release', 'main', 'dist/chromium.zip');
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /\.env/);
  assert.match(refused.stderr, /signing\.pem/);
  assert.equal(refused.stdout, '', 'no archive path is printed');
  assert.ok(!fs.readdirSync(path.join(dir, 'dist')).some((n) => n.endsWith('.tar.gz')), 'no archive was left behind');
});

test('.gitignore keeps the generated folders, signing leftovers and secrets out of git', { skip: SKIP }, (t) => {
  const dir = scratch(t, { git: true });
  for (const ignored of ['chromium/manifest.json', 'chrome/manifest.json', 'firefox/manifest.json', 'dist/x.zip',
    'web-ext-artifacts/x.xpi', 'node_modules/x/index.js', '.env', '.env.local', 'key.pem']) {
    assert.equal(run('git', ['check-ignore', '-q', ignored], dir).status, 0, `${ignored} should be ignored`);
  }
  for (const tracked of ['src/shared.js', 'manifests/chromium.json', 'tests/build.test.js', '.github/workflows/firefox.yml', 'scripts/build.sh']) {
    assert.equal(run('git', ['check-ignore', '-q', tracked], dir).status, 1, `${tracked} must not be ignored`);
  }
});

// An archive has no .git; it must retain the exact timestamp selected at packaging time.
test('source archive rebuilds reproduce the original packages without Git or epoch overrides', { skip: SKIP }, (t) => {
  const dir = scratch(t, { git: true });
  fs.writeFileSync(path.join(dir, '.source-date-epoch'), '1800000000\n');
  assert.equal(build(dir).status, 0);
  const pkg = fs.readdirSync(path.join(dir, 'dist')).find((name) => name.endsWith('.zip'));
  const original = sha(path.join(dir, 'dist', pkg));
  const made = run('bash', ['scripts/make-archive.sh', 'chromium', 'release', 'main', `dist/${pkg}`], dir);
  assert.equal(made.status, 0, made.stderr);
  const extracted = path.join(dir, 'extracted');
  fs.mkdirSync(extracted);
  assert.equal(run('tar', ['-xzf', path.join(dir, made.stdout.trim()), '-C', extracted], dir).status, 0);
  const source = path.join(extracted, 'source');
  const gitEpoch = run('git', ['log', '-1', '--format=%ct'], dir).stdout.trim();
  assert.equal(fs.readFileSync(path.join(source, '.source-date-epoch'), 'utf8').trim(), gitEpoch,
    'ordinary checkout uses Git even if an archived epoch exists');
  assert.equal(build(source, 'chromium').status, 0);
  assert.equal(sha(path.join(source, 'dist', pkg)), original);
});

// Build a package and prepare it for archive tests.
function packer(dir, browser = 'chromium') {
  assert.equal(build(dir, browser).status, 0);
  const extension = browser === 'chromium' ? '.zip' : '.xpi';
  const packaged = browser === 'chromium' ? 'chromium.zip' : 'firefox-signed.xpi';
  const pkg = fs.readdirSync(path.join(dir, 'dist'))
    .find((n) => n.startsWith(`double-tap-to-refresh-${browser}-`) && n.endsWith(extension));
  fs.copyFileSync(path.join(dir, 'dist', pkg), path.join(dir, 'dist', packaged));
  return () => run('bash', ['scripts/make-archive.sh', browser, 'development', 'main', `dist/${packaged}`], dir);
}

test('make-archive.sh checks working tree cleanliness', { skip: SKIP }, (t) => {
  const dir = scratch(t, { git: true });
  let pack = packer(dir);
  assert.equal(pack().status, 0, 'a clean tree is fine: build output is ignored by git');

  fs.appendFileSync(path.join(dir, 'src', 'shared.js'), '// edited\n');
  const edited = pack();
  assert.notEqual(edited.status, 0);
  assert.match(edited.stderr, /uncommitted changes/);
  commit(dir, 'edit');
  pack = packer(dir);
  assert.equal(pack().status, 0, 'committing the edit makes it fine again');

  fs.writeFileSync(path.join(dir, 'src', 'new.js'), '// git does not know this file yet\n');
  assert.match(pack().stderr, /uncommitted changes/, 'a new file counts too');
  fs.rmSync(path.join(dir, 'src', 'new.js'));

  fs.chmodSync(path.join(dir, 'scripts', 'build.sh'), 0o644);
  assert.equal(pack().status, 0, 'a mode change alone is not a change of content');
});

test('the secret check also catches token, secret and credential file names in any letter case', { skip: SKIP }, (t) => {
  const dir = scratch(t, { git: true });
  const pack = packer(dir);
  const names = ['api-token.txt', 'credentials.json', 'Secrets.yml', 'deploy.PEM', 'config/.env.production'];
  for (const name of names) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), 'not a real secret\n');
  }
  assert.equal(run('git', ['add', '-f', ...names], dir).status, 0);
  commit(dir, 'names');

  const refused = pack();
  assert.notEqual(refused.status, 0);
  for (const name of names) assert.ok(refused.stderr.includes(name), `${name} should be named in the refusal`);
  assert.ok(!fs.readdirSync(path.join(dir, 'dist')).some((n) => n.endsWith('.tar.gz')), 'no archive was made');
});

test('refuse_secret_like_files, which the test release also runs, fails on a committed .env and passes on a clean repo', { skip: SKIP }, (t) => {
  const dir = scratch(t, { git: true });
  const check = () => run('bash', ['-c', '. scripts/lib.sh; refuse_secret_like_files'], dir);
  assert.equal(check().status, 0, check().stderr);

  fs.writeFileSync(path.join(dir, '.env'), 'X=1\n');
  assert.equal(run('git', ['add', '-f', '.env'], dir).status, 0);
  commit(dir, 'env');
  const refused = check();
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /\.env/);
});
