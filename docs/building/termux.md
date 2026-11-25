# Building on Android with Termux

Part of [BUILDING.md](../../BUILDING.md). **Not run in Termux yet:** this page is written from what the scripts need, so tell
us if a step fails. Termux has the GNU `touch`, `tar` and `bash` the scripts want, so no extra setup is needed beyond the
packages below.

## 1. Install the tools

Use the Termux build from F-Droid or GitHub, and run:

```sh
pkg update
pkg install git zip unzip nodejs python
```

`bash`, `tar`, `gzip`, `find` and `sed` are part of Termux already. Check that `node --version` works; the tests pass on
Node 18 and newer.

## 2. Build and test

Work in the Termux home folder (`~`), not in shared storage such as `/sdcard` or `~/storage`: shared storage does not keep
Unix file modes.

```sh
git clone https://github.com/Sumon-Kayal/double-tap-to-refresh.git
cd double-tap-to-refresh
bash scripts/build.sh
node --test
```

The build creates `chromium/`, `firefox/` and `dist/`; BUILDING.md explains what is in them. `node --test` takes no folder
argument.

## 3. Get the packages to the browser

Termux files are private to Termux, so copy the packages to your Downloads folder. Run `termux-setup-storage` once and allow
the permission, then:

```sh
cp dist/*.xpi dist/*.zip ~/storage/downloads/
```

Then open the file from the browser, or from your file manager. How to install it, and which browsers can, is in
[Install](../../README.md#install) in the README; in short, release and Beta Firefox only run signed add-ons, and the `.xpi`
that `build.sh` makes is not signed. The [Firefox build workflow](../../README.md#releases-and-automation) makes a signed one
on GitHub.

## Optional: redraw the icons

```sh
pkg install python-pillow
python3 scripts/make-icons.py
```

`pyoxipng` is optional. Without it the icons come out larger than the committed ones, with identical pixels.
