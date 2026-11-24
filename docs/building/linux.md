# Building on Linux

Part of [BUILDING.md](../../BUILDING.md). The build and test commands below were run in a fresh clone on Ubuntu. The package
lines for each distribution were not run on a fresh install, so tell us if a package name is wrong.

Pick your distribution, install the tools, then go to [Build and test](#build-and-test). `bash`, GNU `tar`, `gzip`, `find`,
`sed` and the other basics are already installed on all of them.

## Ubuntu

```sh
sudo apt update
sudo apt install git zip unzip python3 nodejs
```

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:d2d20d51a7b4129d2417be7caa0d207dd19ba7f5ff2d483fa887c9980bbda441 -->

The tests require Node.js 18 or newer. Check with `node --version` after installing Ubuntu's `nodejs` package.
If it reports an older version, follow the [Node.js installation instructions](https://nodejs.org/en/download) for
Linux to install a current LTS release, then check `node --version` again before running the tests.

<!-- /coderabbit-ai-generated:v1 -->

## Debian

```sh
sudo apt update
sudo apt install git zip unzip python3 nodejs
```

If `sudo` is not installed, become root with `su -` and run the same lines without `sudo`. Debian's own `nodejs` is enough
for the tests (Node 18 or newer).

## openSUSE

```sh
sudo zypper install git zip unzip python3 nodejs-default
```

If your release has no `nodejs-default`, run `zypper search nodejs` and install the highest `nodejsNN` package instead.

## Arch

```sh
sudo pacman -S --needed git zip unzip python nodejs
```

## Fedora

```sh
sudo dnf install git zip unzip python3 nodejs
```

## Build and test

```sh
git clone https://github.com/Sumon-Kayal/double-tap-to-refresh.git
cd double-tap-to-refresh
bash scripts/build.sh
node --test
```

The build creates `chromium/`, `firefox/` and `dist/`; BUILDING.md explains what is in them. `node --test` takes no folder
argument.

## Try it in a browser

- **Chromium, Chrome, Edge, Brave:** open `chrome://extensions`, turn on Developer mode, choose Load unpacked and pick the
  `chromium/` folder.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, choose Load Temporary Add-on and pick `firefox/manifest.json`.

## Optional: web-ext

`web-ext` checks and runs the Firefox build. It needs Node 20 or newer and npm (Debian and Ubuntu: `sudo apt install npm`;
openSUSE: `npm-default`; Arch, Fedora: `npm`). If your Node is older than 20, install a newer one from <https://nodejs.org>
or with nvm first.

```sh
npx web-ext lint --source-dir firefox --warnings-as-errors
npx web-ext run --source-dir firefox
```
