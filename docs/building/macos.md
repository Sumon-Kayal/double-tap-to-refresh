# Building on macOS

Part of [BUILDING.md](../../BUILDING.md). **Not run on a Mac yet:** this page is written from what the scripts need, so tell us
if a step fails.

macOS ships `bash` 3.2 and the BSD versions of `touch` and `tar`. The scripts need `bash` 4 or newer, GNU `touch -d @…`
and GNU `tar --sort`, so install those with [Homebrew](https://brew.sh). `zip` and `unzip` come with macOS.

## 1. Install the tools

```sh
xcode-select --install
brew install bash coreutils gnu-tar node python
```

`xcode-select --install` gives you `git` and the other command line tools (skip it if you already have them, or run
`brew install git`).

## 2. Put the GNU tools first

Add this line to `~/.zprofile`, then open a new Terminal window:

```sh
export PATH="$(brew --prefix)/bin:$(brew --prefix coreutils)/libexec/gnubin:$(brew --prefix gnu-tar)/libexec/gnubin:$PATH"
```

Check that it worked: `bash --version` should say 5, `touch --version` and `tar --version` should say GNU. If `bash` still
says 3.2, the line is not in effect yet.

## 3. Build and test

```sh
git clone https://github.com/Sumon-Kayal/double-tap-to-refresh.git
cd double-tap-to-refresh
bash scripts/build.sh
node --test
```

The build creates `chromium/`, `firefox/` and `dist/`; BUILDING.md explains what is in them. `node --test` takes no folder
argument.

## 4. Try it in a browser

- **Chromium, Chrome, Edge, Brave:** open `chrome://extensions`, turn on Developer mode, choose Load unpacked and pick the
  `chromium/` folder.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, choose Load Temporary Add-on and pick `firefox/manifest.json`.
- **Safari** is not supported.

## Optional: web-ext

```sh
npx web-ext lint --source-dir firefox --warnings-as-errors
npx web-ext run --source-dir firefox
```

`web-ext` needs Node 20 or newer, which `brew install node` gives you.
