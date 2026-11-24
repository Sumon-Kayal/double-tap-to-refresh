# Building Double Tap to Refresh

How to build the two extensions from source, run the tests and package them. If you only want to use the extension, the
[README](README.md) is enough. The commands are the same everywhere; what differs is how you install the tools, so each
system has its own guide:

| System | Guide |
|---|---|
| Linux (Ubuntu, Debian, openSUSE, Arch, Fedora) | [docs/building/linux.md](docs/building/linux.md) |
| macOS | [docs/building/macos.md](docs/building/macos.md) |
| Windows (through WSL) | [docs/building/windows.md](docs/building/windows.md) |
| Android (Termux) | [docs/building/termux.md](docs/building/termux.md) |

## What the build does

`bash scripts/build.sh [chromium|firefox|all]` (no argument builds both) takes `src/`, the browser's manifest from
`manifests/` and `LICENSE.md`, and writes:

| Output | What it is |
|---|---|
| `chromium/` | the unpacked Chromium extension: `src/`, `manifests/chromium.json` as `manifest.json`, and the license as `LICENSE.txt` |
| `firefox/` | the same for Firefox, with `manifests/firefox.json` |
| `dist/` | `double-tap-to-refresh-chromium-<label>.zip` and `double-tap-to-refresh-firefox-<label>.xpi` (the `.xpi` is not signed) |

These are generated: never edit them by hand and never commit them (they are in `.gitignore`). The same source gives
byte-identical packages, because every file gets one fixed time and the zip is written in sorted order.

## What you need

| Tool | What for |
|---|---|
| `bash` 4 or newer | runs the scripts (macOS ships 3.2; see its guide) |
| GNU `touch` and `tar`, plus `find`, `sed`, `sort` and `gzip` | stamping files and packing archives (macOS and BusyBox systems ship other versions of `touch` and `tar`) |
| `zip` | `scripts/build.sh` |
| `unzip` | the build tests |
| `git` | `scripts/make-archive.sh` and the build tests |
| `node` 18 or newer | the tests (checked on Node 18, 20, 22 and 24; the GitHub workflows use 22); `web-ext` needs Node 20 or newer |
| `python3` | the signing-script tests; with Pillow, `scripts/make-icons.py` |

To only build the packages, `bash`, GNU `touch`, `find`, `sed`, `sort` and `zip` are enough. The rest is for the tests,
source archives and signing.

## Build

```sh
git clone https://github.com/Sumon-Kayal/double-tap-to-refresh.git
cd double-tap-to-refresh
bash scripts/build.sh
```

Run the scripts with `bash`: a fresh clone may not have the executable bit set, and then `./scripts/build.sh` says
`Permission denied`. The build prints one line per browser, for example
`Built firefox 0.1.0 (version 0.1.0): firefox/ and dist/double-tap-to-refresh-firefox-0.1.0.xpi (… bytes)`.
Build one browser with `bash scripts/build.sh chromium` or `bash scripts/build.sh firefox`.

## Run the tests

```sh
node --test
```

Give it no folder argument: `node --test tests/` fails on Node 22 and newer. The tests cover the settings and position
maths, both manifests, the build and archive scripts, the workflow rules, the Mozilla signing script, the license headers,
and whether the README and SPEC still match the code. A test that needs a missing tool (`bash`, `zip`, `unzip`, `git`,
`tar`) skips itself; the signing tests need `python3`. `tests/e2e/run.js` is an optional browser test that needs
Playwright; see [Testing status](README.md#testing-status) in the README.

## Try the build in a browser

- **Chromium, Chrome, Edge, Brave:** open `chrome://extensions`, turn on Developer mode, choose Load unpacked and pick
  the `chromium/` folder.
- **Firefox on the desktop:** open `about:debugging#/runtime/this-firefox`, choose Load Temporary Add-on and pick
  `firefox/manifest.json`.
- **Android:** see [Install](README.md#install) in the README. Release and Beta Firefox only run signed add-ons.

## Source archives, signing and releases

`bash scripts/make-archive.sh <chromium|firefox> <development|release> <branch> <package>` packs a package together with
the source it was built from. It needs a git checkout with nothing uncommitted. The GitHub workflows do this, and the Mozilla
signing, for you; see [Releases and automation](README.md#releases-and-automation) in the README.

## Redraw the icons

`python3 scripts/make-icons.py` redraws `src/icons/` and needs Pillow (`pip install pillow`; on Debian and Ubuntu use
`sudo apt install python3-pil` or a virtual environment). With `pip install pyoxipng` the PNGs come out about 40% smaller,
which is what is committed.

## When something goes wrong

| What you see | Why | What to do |
|---|---|---|
| `Permission denied` for `./scripts/build.sh` | the script is not marked executable | run `bash scripts/build.sh` |
| `error: the license is missing` | there is no `LICENSE.md` in the project root | run it from a full checkout |
| `zip: command not found` | `zip` is not installed | install it (see your system's guide) |
| `bad substitution` in `scripts/lib.sh` | `bash` is older than 4 | install a newer `bash` (macOS: see its guide) |
| `touch` or `tar` rejects `-d @…` or `--sort` | BSD or BusyBox tools instead of GNU ones | install GNU coreutils and tar (macOS: see its guide) |
| `node --test tests/` says `Cannot find module` | Node 22 and newer do not expand a folder | run `node --test` with no argument |
| `error: the working tree has uncommitted changes` | `make-archive.sh` packs the committed source | commit or stash your changes |
| `error: run this inside a git checkout that has at least one commit` | there is no git history | use a `git clone` |
| `error: these committed files look like secrets or build output` | a committed file has a name like a key or token file | remove it from git |
