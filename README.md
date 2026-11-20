# Double Tap to Refresh

A small floating ball, inspired by Xiaomi's MIUI Quick Ball, that you can park anywhere on a web page.
**Double-tap it to reload the page. Press, hold, then drag to move it.** Built for Firefox on Android first,
and it also runs on Chromium.

> **Beta (0.1.0-beta).** The Chromium build has been tested in a real browser. The Firefox build has **not** been run in
> Firefox or on an Android device yet, so expect rough edges there. See [Testing status](#testing-status).

| | |
|---|---|
| **Version** | 0.1.0-beta |
| **Browsers** | Firefox 160+ (desktop and Android), Chromium 152+ |
| **Permissions** | `storage` only. Runs on `http://` and `https://` pages, top frame only. |
| **Network** | None. No analytics, no accounts, no browsing history. |
| **License** | [GPL-3.0-only](LICENSE) |

The full design is in [`SPEC.md`](SPEC.md), how it was built and tested is in [the development record](CHANGELOG.md#development-record-included-in-this-release),
and what changed in each version is in [`CHANGELOG.md`](CHANGELOG.md).

## Quick start

| Browser | Do this |
|---|---|
| Chromium | `chrome://extensions` → **Developer mode** → **Load unpacked** → pick the `chromium/` folder. |
| Firefox desktop | `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → pick `firefox/manifest.json`. |
| Firefox for Android | Release and Beta only run signed add-ons, so read [Firefox for Android](#firefox-for-android) first. |

Then open any web page and double-tap the ball.

## Features

- A round refresh ball that stays above the page. A single tap does nothing, so you can't refresh by accident.
- Double-tap with a finger, pen or mouse to reload the current tab. Enter or Space on the focused ball works too.
- Press and hold (about 0.4 s), then drag, so scrolling the page never moves it. With a mouse you can drag at once.
- Remembers where you put it, as a share of the screen, so it stays put after you rotate the phone or resize the window.
- Settings with a live preview: transparency, size and double-tap timing. Changes reach every open page right away.
- Isolated from the page: a closed shadow root, styled only through the CSSOM, so page CSS can't restyle it and a strict
  Content-Security-Policy can't leave it unstyled.
- Small and local: about 22 KB of script per page, no libraries, no network requests.

## Compatibility

| Browser | Minimum | Build | Notes |
|---|---|---|---|
| Firefox for Android | 160 | `firefox/` | Primary target. See [Firefox for Android](#firefox-for-android) for installing. |
| Firefox desktop | 160 | `firefox/` | Same build. |
| Chromium desktop (Chrome, Edge, Brave, …) | 152 | `chromium/` | |
| Chromium on Android | 152 | `chromium/` | Only browsers that can load Chrome extensions. Not tested. |
| Firefox Focus | — | — | Firefox Focus has no extension support. |

The minimums are `strict_min_version` in `manifests/firefox.json` and `minimum_chrome_version` in
`manifests/chromium.json`. Lower them if you want older browsers (Firefox ESR 153, for example, is older than 160).

## Using it

| You do | It does |
|---|---|
| Double-tap the ball | Reloads the current tab (a single tap does nothing) |
| Press and hold ~0.4 s, then drag | Moves the ball; the ring turns blue while you drag; releasing saves the spot |
| Open the settings | Transparency, size and double-tap timing, with a live preview |

Where the settings are:

- **Firefox for Android:** menu → Add-ons → Double Tap to Refresh → Settings.
- **Firefox desktop:** the toolbar button, or Add-ons → Double Tap to Refresh → Preferences.
- **Chromium:** the toolbar button, or `chrome://extensions` → Details → Extension options.

The ball is a button, so keyboard users can Tab to it and press Enter or Space; that refreshes right away.
Firefox runs extensions in private windows only if you allow it (Add-ons → Double Tap to Refresh → Run in Private Windows).

## Install

Ready-made packages are in `dist/` (`double-tap-to-refresh-chromium-0.1.0-beta.zip` and
`double-tap-to-refresh-firefox-0.1.0-beta.xpi`), and the unpacked builds are in `chromium/` and `firefox/`.
Chromium shows the version as `0.1.0-beta`; Firefox shows `0.1.0` (see [Version numbers](#version-numbers)).

### Chromium

Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and pick the `chromium/` folder
(or the folder you get by unzipping the `.zip` from `dist/`).

### Firefox desktop

Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on** and pick `firefox/manifest.json`.
It stays until Firefox restarts.

### Firefox for Android

Release and Beta builds only run add-ons that Mozilla has signed, so there are three routes:

**1. Try it without signing (temporary, gone after Firefox restarts).** Uses `web-ext` over `adb`:

1. Android: turn on *Developer options → USB debugging* (or *Wireless debugging*).
2. Firefox: *Settings → Remote debugging via USB* on.
3. On a computer:

   ```sh
   npm install --global web-ext
   adb devices                      # note the device id
   web-ext run --target=firefox-android --android-device=<device-id> \
               --firefox-apk=org.mozilla.firefox --source-dir=firefox
   ```

   The package name is `org.mozilla.firefox` (Release), `org.mozilla.firefox_beta` (Beta) or `org.mozilla.fenix` (Nightly).
   Keep at least one tab open in Firefox so the extension can load, allow the connection if the phone asks, and
   allow storage access for the APK on the first run if `web-ext` tells you to.

   From Termux on the same phone, the same commands should work with wireless debugging
   (`pkg install nodejs android-tools`, then `adb pair localhost:<pairing-port>` and `adb connect localhost:<port>`).
   I haven't tried that.

**2. Install it for good.** Get it signed, then install the signed file:

1. Change `gecko.id` in `manifests/firefox.json` to an ID of your own. It can't be changed later.
2. `./scripts/build.sh`, then
   `web-ext sign --channel=unlisted --source-dir=firefox --api-key=<key> --api-secret=<secret>`
   (keys come from your addons.mozilla.org developer account). This writes a signed `.xpi` to `web-ext-artifacts/`.
3. On the phone: *Settings → About Firefox*, tap the Firefox logo five times to enable the debug menu, then go back to
   Settings, copy or download the XPI from your computer to your phone, and choose **Install extension from file**. (Mozilla's bug tracker says that option needs Android 10 or newer.)

The `.xpi` that `build.sh` puts in `dist/` is **not signed**, so release Firefox rejects it as it is.

**3. Firefox Nightly.** Mozilla's add-ons team says Nightly on Android can install a zipped, unsigned add-on from file
with the same steps as route 2, so you can use the `.xpi` from `dist/` without signing. Release and Beta can't.

## Settings

| Setting | Range | Default |
|---|---|---|
| Transparency (of the ball's background; the arrow stays solid) | 0–85 % | 35 % |
| Size | 32–72 px | 44 px |
| Double-tap timing (time allowed between the first tap's release and the second tap's press) | 200–600 ms | 350 ms |

Settings and the ball's position live in `storage.local` on your device. Nothing is sent anywhere.
In the options page, *Reset position* puts the ball back at its starting spot (right edge, 70 % down) and
*Restore defaults* resets the three sliders.

## Permissions and privacy

- Permission: `storage`. The script runs on `http://` and `https://` pages in the top frame only.
- No network requests, no analytics, no browsing history. Firefox gets `data_collection_permissions: none`.
- The ball sits in a closed shadow root and is styled only through the CSSOM, so page CSS can't restyle it and a strict
  Content-Security-Policy can't leave it unstyled.
- No third-party code is included in the extension.

## Building and testing

### Project layout

```
src/         the extension's code, shared by both browsers (edit here)
manifests/   chromium.json and firefox.json (the only per-browser differences)
scripts/     build.sh, make-icons.py
tests/       node --test (no dependencies); tests/e2e/run.js is the optional browser test (needs Playwright)
chromium/    built output, load unpacked          (generated)
firefox/     built output, load or package        (generated)
dist/        zip and unsigned xpi of the builds   (generated)
LICENSE      GNU General Public License, version 3 (copied into every build)
CHANGELOG.md what changed in each version
```

`./scripts/build.sh` rebuilds `chromium/`, `firefox/` and `dist/` from `src/`, `manifests/` and `LICENSE`.
It needs `bash` and `zip` (Termux: `pkg install zip`). Never edit `chromium/` or `firefox/` by hand; the next build overwrites them.

`node --test` runs the unit tests (settings and position maths) and checks that the two manifests agree, ask for nothing
extra and carry a valid version. `tests/e2e/run.js` drives the built Chromium extension in a real browser with touch emulation:
`npm install playwright && npx playwright install chromium`, then `./scripts/build.sh && node tests/e2e/run.js`.
`python3 scripts/make-icons.py` redraws the icons (needs Pillow).

### Version numbers

Both manifests carry `"version": "0.1.0"`, the number the browsers compare. It must be one to four numbers separated by dots:
addons.mozilla.org accepts nothing else, and Chromium wants plain numbers too. A suffix such as `-beta` therefore can't go in `version`.
The beta label is `"version_name": "0.1.0-beta"` in `manifests/chromium.json`, which Chromium shows on its extensions page.
Firefox has no such field here, so it shows `0.1.0`. `build.sh` names the files in `dist/` after the label, and `node --test`
checks both rules. To cut a release, change `version` in both manifests (and `version_name` in the Chromium one), add an entry to
`CHANGELOG.md`, then run `./scripts/build.sh`.

## Testing status

- **Unit and manifest tests:** 15 pass (`node --test`).
- **Chromium build:** run in Chrome for Testing 153 with touch emulation: single, slow and double taps, hold-and-drag, saved
  position, rotation, live settings, a strict-CSP page, keyboard activation, the options page, and both reload fallbacks
  (38 browser checks). That run was made on the build that is now called 0.1.0-beta. Its `src/` is byte-for-byte the same;
  only the manifests' version fields, the added `LICENSE` file and the docs differ. The browser suite has not been run again since.
- **Firefox:** the manifest follows MDN (event-page background, `gecko_android`, `data_collection_permissions`), and the code
  is the same one that ran in Chromium, but it **has not been run in Firefox or on an Android device yet**. If something
  misbehaves there, the touch gestures in `src/shared.js` are the first place to look.

## Known limitations

- Extensions can't run on browser-internal pages (`about:`, `chrome://`), the Chrome Web Store, `addons.mozilla.org`,
  or in the built-in PDF viewers, so the ball doesn't appear there. `file://` pages are not matched.
- The ball follows the visible viewport when you pinch-zoom or pan, keeping its saved relative position.
- Firefox lets you revoke an add-on's site access. If the ball disappears everywhere, check Add-ons → Double Tap to Refresh →
  Permissions. Keep the match patterns the same in updates: Firefox does not show newly requested host permissions on update.
- Screen-reader activation (for example TalkBack's double-tap) hasn't been tried.
- The add-on ID in `manifests/firefox.json` is a placeholder (`@example.invalid`); replace it before you sign anything.
- Not in this version: edge snapping, other quick actions, import/export of settings (see `SPEC.md` §9).

## Reporting a problem

Please say which browser and version you use (and the device and Android version, if it is a phone), the page where it
happened, what you did, what you expected and what happened instead, and whether the ball appeared at all.
For Firefox for Android, [the troubleshooting notes](CHANGELOG.md#firefox-for-android-troubleshooting-notes) lists the first places to look for each symptom.

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md). The current version, **0.1.0-beta**, is the first beta.

## License

Double Tap to Refresh is free software, released under the GNU General Public License, version 3 only (`GPL-3.0-only`).
The full text is in [`LICENSE`](LICENSE), and every package built by `scripts/build.sh` includes a copy.

```
Copyright (C) 2026 The Double Tap to Refresh authors

This program is free software: you can redistribute it and/or modify it under the
terms of the GNU General Public License as published by the Free Software
Foundation, version 3 of the License.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with this
program. If not, see <https://www.gnu.org/licenses/>.
```
