'use strict';
// Static checks on the GitHub Actions workflows: the deployment rules, written as tests.
// The files are plain enough to read line by line, so no YAML parser is needed. Run: node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', '.github', 'workflows');
const NAMES = ['chromium.yml', 'firefox.yml', 'test release.yml'];
const text = (name) => fs.readFileSync(path.join(DIR, name), 'utf8');
const logicalLines = (name) => text(name).split('\n').filter((line) => !/^\s*#/.test(line)); // comment lines left out

// The text of every `run:` script, one string per step.
function runScripts(name) {
  const all = logicalLines(name);
  const scripts = [];
  for (let i = 0; i < all.length; i++) {
    const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(all[i]);
    if (!m) continue;
    if (/^[|>][+-]?$/.test(m[2])) {
      const body = [];
      for (i++; i < all.length && (all[i].trim() === '' || all[i].search(/\S/) > m[1].length); i++) body.push(all[i]);
      i--;
      scripts.push(body.join('\n'));
    } else {
      scripts.push(m[2]);
    }
  }
  return scripts;
}

test('the three workflows exist and nothing else is in the folder', () => {
  assert.deepEqual(fs.readdirSync(DIR).sort(), [...NAMES].sort());
});

test('every workflow is started by hand only', () => {
  for (const name of NAMES) {
    const t = text(name);
    assert.match(t, /^on:\n  workflow_dispatch:/m, `${name}: needs workflow_dispatch`);
    assert.doesNotMatch(
      t,
      /^ {2}(push|pull_request|pull_request_target|schedule|workflow_run|workflow_call|release|issues|issue_comment|repository_dispatch):/m,
      `${name}: must not start on anything but a manual run`,
    );
  }
});

test('every action is pinned to a full commit SHA with its version beside it', () => {
  for (const name of NAMES) {
    const uses = logicalLines(name).filter((l) => /^\s*(- )?uses:/.test(l));
    assert.ok(uses.length > 0, `${name}: expected at least one action`);
    for (const line of uses) {
      assert.match(line, /uses:\s*[\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+#\s*v\d+\.\d+\.\d+\s*$/, `${name}: ${line.trim()}`);
    }
  }
});

test('permissions: read-only by default, and write access only in the publish job of a release build', () => {
  for (const name of NAMES) {
    assert.match(text(name), /^permissions:\n  contents: read\n/m, `${name}: top-level permissions`);
    const writes = logicalLines(name).filter((l) => /contents:\s*write/.test(l));
    if (name === 'test release.yml') {
      assert.equal(writes.length, 0, `${name}: never writes`);
      continue;
    }
    assert.equal(writes.length, 1, `${name}: exactly one job may write`);
    const [build, publish] = text(name).split(/^ {2}publish:$/m);
    assert.ok(publish && /contents:\s*write/.test(publish), `${name}: the write permission belongs to publish`);
    assert.doesNotMatch(build, /contents:\s*write/, `${name}: the build job cannot write`);
    assert.doesNotMatch(publish, /actions\/checkout|\bnpm\b/, `${name}: publish runs no checked-out or installed code`);
  }
});

test('Mozilla credentials exist only in the Firefox signing step', () => {
  for (const name of NAMES) {
    const secrets = logicalLines(name).filter((l) => l.includes('secrets.'));
    if (name !== 'firefox.yml') {
      assert.deepEqual(secrets, [], `${name}: must not touch secrets`);
      assert.doesNotMatch(text(name), /WEB_EXT_|web-ext (sign|lint|build)|npm install/, `${name}: no web-ext, no Mozilla variables`);
      continue;
    }
    assert.equal(secrets.length, 2);
    for (const line of secrets) {
      assert.match(line, /^\s+WEB_EXT_API_(KEY|SECRET): \$\{\{ secrets\.WEB_EXT_API_(KEY|SECRET) \}\}$/);
    }
    const sign = text(name).split(/^ {6}- name: /m).find((step) => step.startsWith('Sign with Mozilla'));
    assert.ok(sign, 'the signing step exists');
    assert.equal((sign.match(/secrets\./g) || []).length, 2, 'both secrets sit inside that one step');
    assert.match(sign, /--channel unlisted/);
  }
});

test('typed or branch-controlled values reach scripts only through env, never through ${{ }} in a script', () => {
  for (const name of NAMES) {
    for (const script of runScripts(name)) {
      assert.doesNotMatch(script, /\$\{\{/, `${name}: an expression is interpolated into a script:\n${script}`);
    }
    for (const line of logicalLines(name).filter((l) => l.includes('inputs.tag'))) {
      assert.match(line, /^\s+TAG: \$\{\{ inputs\.tag \}\}$/, `${name}: inputs.tag may only fill the TAG variable`);
    }
  }
  assert.doesNotMatch(text('test release.yml'), /inputs\./, 'the test release takes no input');
});

test('release builds check the tag, require its release, and use the exact tag as the source', () => {
  for (const name of ['chromium.yml', 'firefox.yml']) {
    const t = text(name);
    assert.match(t, /REF_TYPE" != branch/, `${name}: a tag in "Use workflow from" is refused`);
    assert.match(t, /git check-ref-format "refs\/tags\/\$TAG"/, `${name}: the tag name is validated`);
    assert.match(t, /gh release view "\$TAG"/, `${name}: the release must already exist`);
    assert.match(t, /echo "ref=refs\/tags\/\$TAG"/, `${name}: the source is the tag itself`);
    assert.match(t, /rev-parse "refs\/tags\/\$TAG\^\{commit\}"/, `${name}: the checkout is verified`);
    assert.doesNotMatch(t, /gh release create|gh release edit|gh release delete/, `${name}: never creates or changes a release`);
    assert.match(t, /gh release upload "\$TAG" release\/\* --repo "\$REPO"/, `${name}: only uploads to the existing release`);
  }
});

test('development archives are kept for 72 hours under the agreed artifact names', () => {
  const cases = [['firefox.yml', 'Firefox-Development'], ['chromium.yml', 'Chromium-Development']];
  for (const [name, artifact] of cases) {
    assert.match(text(name), new RegExp(`name: ${artifact}\\n\\s+path: .*\\n\\s+retention-days: 3\\n`), `${name}: ${artifact}`);
  }
});

test('the archive name carries browser, branch, mode and version, and the workflows use the script that builds it', () => {
  for (const name of ['chromium.yml', 'firefox.yml']) {
    const browser = name.replace('.yml', '');
    assert.match(text(name), new RegExp(`scripts/make-archive\\.sh ${browser} "\\$MODE" "\\$BRANCH" dist/`), name);
    assert.match(text(name), /BRANCH: \$\{\{ github\.ref_name \}\}/, name);
  }
});

test('the test release packs both extensions and two git-archive source archives into one download', () => {
  const t = text('test release.yml');
  assert.match(t, /bash scripts\/build\.sh\n/, 'builds both browsers');
  assert.match(t, /double-tap-to-refresh-chromium-\*\.zip/);
  assert.match(t, /double-tap-to-refresh-firefox-\*\.xpi/);
  assert.equal((t.match(/git archive --format=tar\.gz --output "\$src_(chrome|firefox)" HEAD/g) || []).length, 2, 'two source archives, both from git archive');
  assert.doesNotMatch(t, /tar -czf "\$src_/, 'a source archive must not be a tar of the working tree (it would hold build output)');

  const bundle = t.split('tar -czf "$bundle"')[1].split('\n\n')[0];
  for (const member of ['$chromium', '$src_chrome', '$firefox', '$src_firefox']) {
    assert.ok(bundle.includes(`"$(basename "${member}")"`), `${member} goes into the bundle`);
  }

  const build = t.split(/^ {6}- name: /m).find((step) => step.startsWith('Build extensions and bundle tarball'));
  const check = build.indexOf('refuse_secret_like_files');
  assert.ok(check !== -1 && check < build.indexOf('git archive'), 'the secret-name check runs before the source archives are made');

  assert.equal((t.match(/upload-artifact@/g) || []).length, 1, 'one download');
  const upload = t.split(/^ {6}- name: /m).find((step) => step.startsWith('Upload test release tarball'));
  assert.match(upload, /archive: false/);
  assert.match(upload, /retention-days: 3/);
  assert.doesNotMatch(upload, /^\s+name:/m, 'with archive: false the artifact is named after the file, so a name would be ignored');
});

test('Firefox signing uses the verified build commit, even if the release tag moves', () => {
  const t = text('firefox.yml');
  assert.match(t, /sha: \$\{\{ steps\.revision\.outputs\.sha \}\}/);
  assert.match(t, /id: revision/);
  assert.match(t, /echo "sha=\$expected" >> "\$GITHUB_OUTPUT"/);
  const sign = t.split(/^  sign:$/m)[1].split(/^  publish:$/m)[0];
  assert.match(sign, /ref: \$\{\{ needs\.build\.outputs\.sha \}\}/);
  assert.match(sign, /EXPECTED_SHA: \$\{\{ needs\.build\.outputs\.sha \}\}/);
  assert.match(sign, /git rev-parse HEAD\)" != "\$EXPECTED_SHA"/);
  assert.doesNotMatch(sign, /refs\/tags/);
});
