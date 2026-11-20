# Changelog — Double Tap to Refresh

All changes, development work, design decisions and verification notes for the **first release, `0.1.0-beta`**, are consolidated below.

This project is released under **GPL-3.0-only**.

---

## [Unreleased]

<small>Build, release and licensing work on top of `0.1.0-beta`. The extension's JavaScript is unchanged.</small>

### Added

- GitHub Actions that start by hand only: `chromium.yml` and `firefox.yml` (development and release builds, an optional release tag, the archive `<browser>-<branch>-<mode>-<version>.tar.gz` holding the package and its source, Mozilla signing for Firefox) and `test release.yml` (both extensions as plain downloads, not signed).
- `.gitignore` for the generated `chromium/`, `firefox/` and `dist/` folders, signing leftovers and secrets.
- `scripts/make-archive.sh`, which packs a package with the exact committed source (`git archive`) and refuses tracked files that look like keys or tokens, and `scripts/lib.sh` with the helpers both scripts share.
- Tests for the build scripts, the workflow rules (manual trigger only, pinned actions, least privilege, secrets only in the Firefox signing step, no typed input inside scripts), the license headers and the per-page script size: 46 tests in all.
- A license line with a link to `LICENSE.txt` on the options page, and an SPDX header (`GPL-3.0-only`) in every source file. The headers are comments; no JavaScript changed.

### Changed

- `scripts/build.sh` saves `LICENSE.md` as `LICENSE.txt` in both builds, builds one browser on request (`build.sh firefox`), gives byte-identical packages for the same source, and names each file after its own manifest, so the Firefox package is `double-tap-to-refresh-firefox-0.1.0.xpi` (it was `-0.1.0-beta.xpi`).
- `scripts/make-icons.py` can use the optional `pyoxipng` to make the PNGs about 40% smaller, and uses the current Pillow name for LANCZOS.
- Icons recompressed without changing a pixel: 25.5 KB down to 14.3 KB, so each package is about 11 KB smaller.
- README and SPEC brought up to date: the real Firefox add-on ID instead of a placeholder, `LICENSE.md`, the per-page script size (about 24 KB), the Waterfox for Android 160 report, and the new scripts and workflows.

### Fixed

- `scripts/build.sh` looked for a file named `LICENSE`, which the repository does not have, so it stopped with "LICENSE is missing".
- `node --test tests/` fails on Node 22 because a folder argument is no longer expanded; the tests now say to run `node --test`.

---

## [0.1.0-beta] - 2026-11-19

<small>First beta release. This release contains the complete rebuilt extension and the work that preceded it. Earlier development labels (`1.3.0` and `2.0.0`) are retained only as historical context in this entry; they are not separate releases in this changelog.</small>

### Added

- Firefox as a first-class browser target, with Firefox for Android as the primary focus.
- Chromium support.
- A round floating refresh button with a recognizable refresh arrow.
- Shared mouse, touch and pen gesture handling.
- Double-tap refresh.
- Press-and-hold dragging for touch and pen; mouse dragging can begin immediately.
- Keyboard and assistive-technology activation through a real HTML button.
- Persistent button position stored as viewport ratios, surviving resizing and rotation.
- A mobile-first settings page with live preview.
- Settings for transparency, button size and double-tap timing.
- Reset-position and restore-defaults actions.
- Shared extension source for both browsers, separate browser manifests and a build script.
- Reload handling through the background script with page-side fallbacks.
- Closed Shadow DOM and CSSOM-based styling intended to resist interference from page CSS and restrictive Content Security Policies.
- Unit tests, manifest tests and a Playwright-based Chromium browser suite.
- GPL-3.0-only `LICENSE`, included at the project root and copied into both browser builds.
- This consolidated changelog and development record.

### Changed

- Renamed the extension from **Floating Reload Dot** to **Double Tap to Refresh**.
- Rebuilt the implementation to follow the supplied design specification rather than incrementally patching the original implementation.
- Set the minimum supported versions to Firefox 160+ and Chromium 152+.
- Replaced duplicated Chromium and Firefox source folders with one shared `src/` tree.
- Replaced the old split mouse/touch gesture logic with one Pointer Events gesture path.
- Replaced absolute-pixel position storage with normalized X/Y ratios.
- Reworked the options page from static text into a functional settings interface with live preview.
- Reduced permissions to `storage`; content scripts match HTTP and HTTPS pages only.
- Kept the Firefox and Chromium manifests separate because their background execution models and browser-specific keys differ.
- Set both manifest `version` fields to `0.1.0`. The Chromium manifest additionally uses `version_name: 0.1.0-beta`; Firefox displays `0.1.0`.
- Updated the build script to copy the license into both builds, require the license to exist, and name output packages using the release label.
- Rewrote the README to document installation, use, settings, limitations, versioning and licensing.
- Removed the temporary `legacy/` folder. The beta does not ship the old implementation.
- Kept the shared `src/` source byte-identical to the source tested during the `2.0.0` development run.

### Fixed

- Fixed the original touch double-tap defect that could send two reload requests for a single gesture.
- Prevented ordinary touch swipes from accidentally dragging the floating button or triggering refresh.
- Added a reply-first background reload flow and page-side fallbacks for missing or failed `tabs.reload`.
- Improved position clamping so the button remains within the viewport after dragging or resizing.
- Hardened the floating control against page styles and restrictive Content Security Policy rules.
- Removed the old unused `tabs` permission.
- Corrected the old options-page wording that incorrectly implied identical local-storage wording across browsers.

### Security and privacy

- Requests only the `storage` permission.
- Does not declare `tabs`, `activeTab` or a separate `host_permissions` entry.
- Does not make network requests or transmit extension data.
- Runs its content script on `http://*/*` and `https://*/*`, in the top frame.
- Does not run on `file://` or `ftp://` pages; this is an intentional reduction from the original `<all_urls>` match pattern.
- Firefox manifest declares `data_collection_permissions` as `none`.
- Firefox add-on ID in this beta is still a placeholder and must be replaced with a permanent unique ID before signing.

---

## Development record included in this release

### Origin and rebuild rationale

The project began as **Floating Reload Dot**. The original 1.3.0 archive was compared with the supplied design specification. The implementation did not provide most of the requested behaviour, so the project was rebuilt to match the specification.

The request expanded the platform scope to include Firefox alongside Chromium, with Android as the primary Firefox target. The requested minimum versions were Firefox 160 and Chromium 152+.

“Focus on Android” was interpreted as an emphasis on Firefox for Android, not as a reference to the separate Firefox Focus browser.

### Original implementation baseline

The original implementation had:
- Duplicated Chromium and Firefox folders containing copies of most source files.
- An 18 × 18 px grey dot without a refresh icon.
- Dragging that began on any press-and-move, with no long-press threshold.
- Absolute-pixel position storage.
- A native `dblclick` handler for mouse and a separate manual timer for touch and pen.
- No functional settings interface.
- A broad `<all_urls>` match pattern, including file and FTP pages.
- Firefox minimum version 109.0, no `gecko_android` declaration and no data-collection declaration.
- No declared Chromium minimum version.

### Measured double-reload defect

During development, the original build was run in Chrome for Testing 153 with touch emulation. A temporary service-worker listener counted messages received by the background script.

| Gesture | Background messages | Observation |
|---|---:|---|
| Touch double tap, five attempts | 2 each time | Both the manual timer and native `dblclick` requested a reload |
| Mouse double-click, five attempts | 1 each time | One reload request |

The number of actual page loads observed by the local test server varied because a second navigation could replace the first. The confirmed defect was that one touch double tap generated two reload requests.

The rebuilt gesture handler uses one Pointer Events path and does not listen for `dblclick`. The browser suite asserts exactly one background message and one reload per double tap.

A separate suspicion that the background's missing response caused the duplicate reload was not supported by the measurement. The reply-first design was retained as defensive handling.

### Architecture and implementation decisions

**One source, two manifests.** `src/` holds the shared implementation. `manifests/chromium.json` and `manifests/firefox.json` hold browser-specific settings. `scripts/build.sh` generates the `chromium/` and `firefox/` folders and release packages. Separate manifests prevent browser-specific keys from leaking into the other browser's build.

**Shared module.** `src/shared.js` exposes the `DTR` module. It contains settings defaults and limits, position calculations, the icon and floating-button implementation. The content script and options page use the same module, so the settings preview represents the actual control.

**Page isolation and styling.** The control is mounted in a closed Shadow DOM. Styling uses CSSOM operations rather than a `<style>` element or inline style attribute. The host is reset and styled defensively. The icon is constructed with SVG DOM methods rather than `innerHTML`.

This approach was checked in Chromium on a page using `style-src 'none'`. Firefox behaviour remains unverified.

**Pointer-event gesture model.**
- A tap must finish within 380 ms and move no more than 10 px.
- A second tap must begin within the configured double-tap interval.
- The default interval is 350 ms; the configurable range is 200–600 ms.
- A 380 ms hold without excessive movement starts a touch/pen drag.
- A swipe cancels the pending tap instead of dragging or refreshing.
- A hold, swipe or move cancels a pending double tap.
- Mouse dragging can begin immediately.
- Pointer and click events are stopped from bubbling out of the floating control.

**Position persistence.** The button position is stored as normalized X/Y ratios from 0 to 1. It is clamped inside the viewport with a 6 px edge gap and recalculated after resize or rotation. Pinch-zoom compensation using `visualViewport` was deliberately deferred because fixed-element behaviour differs between engines and could not be verified in Gecko during development.

**Reload path.** The content script sends a reload request to the background script. The background replies before calling `tabs.reload`, because navigation may unload the page immediately. If the API is missing or rejects, the page can reload itself. If the content script is orphaned after an extension update, message failure also triggers the fallback. The background route remains primary.

**Least privilege.** The extension requests only `storage`. It matches HTTP and HTTPS pages in the top frame and does not make network requests. The narrower match scope is intentional.

**Keyboard and assistive activation.** The floating control is a real button. Keyboard or assistive activation refreshes immediately. A cooldown prevents a held Enter key from repeatedly triggering refreshes.

**Settings.** The mobile-first settings page supports light and dark appearance and touch-friendly controls. Settings are saved automatically and propagated to open pages.

| Setting | Range | Default |
|---|---:|---:|
| Transparency | 0–85% | 35% |
| Button size | 32–72 px | 44 px |
| Double-tap interval | 200–600 ms | 350 ms |

**Visual design.** The button is a dark graphite disc with a white refresh arrow, a subtle halo and a thin ring. A blue ring and halo indicate dragging. Refresh uses a rotation animation, with a reduced-motion alternative.

**Deferred features.** Edge snapping, haptics, idle fading, pinch-zoom compensation, translations, and settings import/export were not included in this beta.

### Firefox manifest and platform research

The Firefox manifest uses:
- `background.scripts` for its background event page.
- A Gecko add-on ID.
- `strict_min_version` 160.0.
- A `gecko_android` declaration with minimum version 160.0.
- `data_collection_permissions` declaring `none`.

The beta's Gecko ID is still a placeholder. It must be replaced before signing.

The Chromium manifest uses a service worker and `minimum_chrome_version` 152. It does not include Firefox-specific keys.

Firefox for Android has additional installation and development constraints. The README documents installation routes and the `web-ext` workflow. Firefox Focus is a separate browser and does not support add-ons.

### Verification and test results

**Development environment:** Chrome for Testing 153.0.8010.12, Playwright 1.63.0, Node 22.23.4, a 390 × 844 phone-sized viewport with touch emulation, DevTools-protocol touch events and a local HTTP server counting page loads. The browser was one major version above the declared Chromium minimum.

**Unit and manifest tests:**
- 14 tests passed during the main development run.
- One version-format test was added for beta packaging.
- 15 unit and manifest tests are reported passing in the beta archive.

Coverage includes settings validation and clamping, position calculations, rotation, small viewports, message-name consistency, manifest parity, permissions and version formatting.

**Chromium browser suite:**
- Grew from 33 checks on its first run to 38 checks.
- Covers default placement, hit testing, single and double taps, exactly one reload, slow taps, swipes, holds, dragging, position persistence, edge clamping, rotation, live settings, mouse and keyboard activation, strict-CSP and quirks-mode pages, options-page controls, error handling and reload fallbacks.

**Visual and package checks:** Screenshots were inspected for the default control, a larger transparent control, a strict-CSP page and the options page in light and dark appearance. Earlier packages were extracted into clean folders, rebuilt and compared with the shipped browser folders. Unit tests and the browser suite were run against the extracted copy.

**Not verified:**
- Firefox desktop or Firefox for Android.
- Any real Android device, including Gecko touch handling, long-press behaviour, dynamic toolbar interaction and fixed-position behaviour.
- `web-ext lint`, AMO validation and signing.
- Installation from file on Firefox for Android.
- `web-ext run` over ADB or wireless debugging.
- TalkBack and other screen readers.
- Chromium-based Android browsers and Chrome 152 itself.
- Pinch-zoom behaviour.
- Print hiding, remounting after page removal, back/forward-cache restoration, reduced-motion feedback, mouse hover scaling and position sync across tabs.

The Chromium browser suite was not rerun after beta renumbering because the packaging environment did not have browser binaries. The source remained unchanged; the beta build differences were manifest version fields and the addition of the license.

### Firefox for Android troubleshooting notes

| Symptom | First places to inspect |
|---|---|
| Button does not appear | Add-on site permissions; restricted pages such as `about:` and addons.mozilla.org |
| Long press opens a context menu or selects text | `contextmenu` and selection handling in `src/shared.js`; interaction between the 380 ms hold and Gecko's long-tap behaviour |
| Drag works but double tap does not, or vice versa | Pointer handlers, `lostpointercapture` and the `isPrimary` check |
| One tap refreshes | Keyboard/assistive activation heuristic and delayed touch-click behaviour |
| Button animates but page does not reload | `tabs.reload` support on Android and the `dtr:reload-failed` fallback path |
| Refresh animation does not play | `Element.animate()` support in the content-script context |
| Button is misplaced after toolbar changes or rotation | `viewport()` and resize handling in `src/shared.js` |
| Signing or AMO validation fails | Run `web-ext lint`; replace the placeholder Gecko ID and verify manifest metadata |

Keep content-script match patterns stable across updates. Firefox may not show users a new host-access prompt when an update adds host access through changed content-script matches.

### Release preparation

The beta preparation pass combined the original archive with the rebuilt project, updated the README and changelog, added the GPL-3.0-only license, removed legacy implementation files and reset the release version.

- The old archive's file paths were present in the rebuilt project, but none of the compared files was byte-identical. The rebuilt project was retained as the merge result.
- A temporary `legacy/` reference folder was removed. No 1.3.0 implementation is shipped in this beta.
- Both manifests use numeric version `0.1.0`; Chromium additionally uses `version_name` `0.1.0-beta`.
- The GPL-3.0-only license is included at the root and copied into both browser builds and release packages.
- The build script reads the release label for package names, copies the license and refuses to build without it.
- A version-format test was added, bringing the unit and manifest total to 15.
- `src/` remains byte-identical to the source tested in the Chromium browser suite.
- The browser suite was not rerun during beta packaging because the packaging environment had no browser binaries.

### Open items after the first beta

- Replace `double-tap-to-refresh@example.invalid` with the permanent Firefox add-on ID before signing.
- Confirm the copyright holder for the README license notice.
- Run `web-ext lint` and validate the Firefox package.
- Test Firefox desktop and Firefox for Android on real devices.
- Re-run the Chromium browser suite after packaging in an environment with a supported browser.
- Decide whether a future release should use `GPL-3.0-or-later` instead of `GPL-3.0-only`.

---

## Project structure

```text
project/
├── README.md                 installation, use, settings and limitations
├── SPEC.md                   design specification
├── CHANGELOG.md              this release and development record
├── LICENSE                   GNU GPL version 3
├── src/                      shared extension implementation
│   ├── shared.js             settings, position maths and floating button
│   ├── content.js            page integration, messaging and storage sync
│   ├── background.js         reload handling and toolbar action
│   ├── options.html
│   ├── options.css
│   ├── options.js
│   └── icons/
├── manifests/
│   ├── chromium.json
│   └── firefox.json
├── scripts/
│   ├── build.sh
│   └── make-icons.py
├── tests/
│   ├── shared.test.js
│   ├── manifests.test.js
│   └── e2e/
│       └── run.js
├── chromium/                 generated Chromium build
├── firefox/                  generated Firefox build
└── dist/                     generated release packages
```

## Development references

The development work consulted these references:

- MDN — [browser_specific_settings](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)
- MDN — [host_permissions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions)
- What Train Is It Now — [Firefox 160 release information](https://whattrainisitnow.com/release/?version=160)
- Mozilla Discourse — [Add-on loading from file on Firefox for Android](https://discourse.mozilla.org/t/is-add-on-loading-from-file-possible-in-firefox-for-android-139-0-4/144353)
- Extension Workshop — [Install self-distributed extensions](https://extensionworkshop.com/documentation/publish/install-self-distributed)
- Extension Workshop — [Developing extensions for Firefox for Android](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android)
- Extension Workshop — [Getting started with web-ext](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext)
- MDN — [web-ext command reference](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/web-ext_command_reference)
- [Firefox 160 release notes for developers](https://developer.mozilla.org/en-US/Firefox/Releases/160)
- [Bugzilla 1814123 — Install add-on from file on Android](https://bugzilla.mozilla.org/show_bug.cgi?id=1814123)
- [MDN browser compatibility data for options_ui](https://github.com/mdn/browser-compat-data/blob/cb823d97c279acda0f13ce91510e0120655f2ba7/webextensions/manifest/options_ui.json)
- [Mozilla Support — Add-ons in Firefox Focus](https://support.mozilla.org/mg/questions/1418476)
- [Firefox bug 1893232](https://bugzilla.mozilla.org/show_bug.cgi?id=1893232)
