# Double Tap to Refresh

## Extension Design Specification — revision 2

| | |
|---|---|
| **Project name** | Double Tap to Refresh |
| **Platform** | Chromium 152+ and Firefox 160+, on desktop and Android. Firefox for Android is a primary target. |
| **Extension type** | Browser extension (Manifest V3) |
| **Primary inspiration** | Xiaomi MIUI Quick Ball |
| **Primary purpose** | Provide a floating, draggable refresh control accessible anywhere on a webpage. |

Revision 2 adds Firefox, with Android as its focus, and sets the minimum browser versions. What changed from revision 1 is listed in [Appendix B](#appendix-b--revision-notes).

---

## 1. Project Overview

Double Tap to Refresh is a lightweight browser extension that makes refreshing a webpage more convenient on mobile devices.

It introduces a floating control inspired by Xiaomi MIUI Quick Ball. Users can position the control anywhere on the webpage and customize its transparency.

Instead of navigating browser menus or reaching for browser controls, users can simply double-tap the floating control to refresh the current webpage.

It targets Firefox for Android first and also runs on desktop Firefox and on Chromium browsers.

## 2. Design Philosophy

The extension follows four principles:

- **Accessibility:** Refresh functionality should always be within easy reach.
- **Minimalism:** The floating control should occupy minimal screen space.
- **Customization:** Users should control its position and transparency.
- **Non-intrusiveness:** The control should not unnecessarily obstruct webpage content.

## 3. Core Features

### 3.1 Floating Refresh Control

- Display a floating refresh button above webpage content.
- Keep it accessible while navigating the webpage.
- Use a compact, circular design (44 px by default).
- Provide a recognizable refresh icon.
- Maintain appropriate visual contrast against different webpage backgrounds: the icon is white with a soft dark halo, and the ball has a hairline light ring and a shadow, so it stays visible on light and dark pages and at high transparency.

### 3.2 Double-Tap Refresh

- A double tap on the floating control triggers a webpage refresh.
- A single tap should not accidentally refresh the page.
- Detect double taps within a configurable or predefined time interval. The default is 350 ms, measured from the release of the first tap to the press of the second, and it can be set between 200 and 600 ms.
- Movement up to 10 px may still count as a tap. A press that is held (see 3.3) or that moves more than 10 px is never counted as a tap, and it cancels a pending double tap.
- Refresh the current tab without opening another tab.
- Mouse, touch and pen all use the same rule. Keyboard activation (Enter or Space on the focused ball) and assistive-technology activation refresh immediately, because they are already deliberate.

### 3.3 Drag and Reposition

- Support long-press-and-drag interaction. A press becomes a drag after 380 ms without moving more than 10 px.
- Allow users to move the floating control anywhere within the permitted webpage viewport.
- Keep the control accessible after repositioning.
- Prevent accidental dragging during ordinary webpage interaction: a touch that moves more than 10 px before the hold finishes is a swipe, and does neither a drag nor a refresh. The ball takes no part in scrolling (`touch-action: none` applies to the ball only).
- Avoid placing the control outside the visible viewport: it is clamped inside the viewport with a 6 px gap on every side, and re-fitted when the window is resized or rotated.
- With a mouse, dragging may also start immediately, since a mouse press on the ball cannot be accidental.

### 3.4 Adjustable Transparency

- Provide a transparency adjustment setting.
- Allow users to make the floating control less intrusive.
- Apply transparency consistently to the control's background (0–85 %, default 35 %). The upper limit keeps the control findable.
- Preserve icon visibility and usability: the icon is never made transparent.

### 3.5 Persistent Preferences

Remember user preferences across browser sessions where technically supported:

- Last floating-control position, stored as two ratios (0–1) of the space the ball can travel in, so it survives rotation and resizing.
- Transparency level.
- Other user-configurable settings: size (32–72 px), double-tap timing, look (dark/light/glass), haptics (on by default), and edge docking (off by default). The preview supports dragging and timing feedback.

All of it is kept in `storage.local` on the device.

## 4. User Interaction

| User Action | Expected Behaviour |
|---|---|
| Double tap | Refresh current webpage |
| Single tap | Nothing |
| Long press | Enter drag interaction |
| Drag | Reposition floating control |
| Release | Save updated position |
| Change settings | Update the floating control on every open page immediately |
| Reload webpage | Restore floating control and saved preferences |
| Enter or Space on the focused ball | Refresh current webpage |

## 5. Visual Design

### Floating Button

- Shape: Circular.
- Appearance: Minimalist. Dark graphite disc, white refresh arrow, hairline light ring.
- Icon: Refresh/reload symbol (a circular arrow).
- Position: User-controlled. Default: right edge, 70 % down.
- Layering: Above ordinary webpage content (highest z-index) and hidden when printing.
- Transparency: Adjustable.

### Interaction Feedback

- Provide subtle visual feedback during interaction: the ball dips slightly while pressed, and grows slightly on mouse hover.
- Indicate when dragging is active: the ball grows and gets a blue ring with a soft halo that stays visible around a finger.
- Provide feedback when a refresh action is triggered: the arrow makes one turn. With "reduce motion" turned on, the ball flashes instead.
- Avoid excessive animations.

## 6. Technical Architecture

The extension uses Manifest V3 with the WebExtensions API on both browser families.

### 6.1 Components

| Component | Responsibility |
|---|---|
| Manifest (two files) | `manifests/chromium.json` and `manifests/firefox.json`. They differ only in the background declaration and the browser-specific keys in 6.3. |
| Shared module (`shared.js`) | Settings schema, position maths, and the ball itself (look and gestures). Loaded by the content script and by the options page, so the preview behaves like the real ball. |
| Content script | Creates the ball on `http://` and `https://` pages, in the top frame only; asks the background to reload; applies setting changes. |
| Background script | Chromium: service worker. Firefox: non-persistent event page. Reloads the requesting tab and opens the options page from the toolbar button. |
| Options page | Preferences with a live preview, opened in a tab. |
| Storage API | `storage.local`, keys `settings` and `position`. |

Both browsers are built from one source: `src/` is copied next to the right manifest by `scripts/build.sh`, which also saves the license as `LICENSE.txt` in each build.

### 6.2 APIs

- `tabs.reload(tabId)`: reloads the tab that sent the message. It needs no `tabs` permission.
- `storage.local` and `storage.onChanged`: preferences, and live updates between tabs and the options page.
- `runtime.sendMessage` and `runtime.onMessage`: the content script asks the background to reload.
- `runtime.openOptionsPage`, with a `tabs.create` fallback, for the toolbar button.
- A one-line shim, `browser ?? chrome`, picks the Promise-based namespace in Firefox and `chrome` in Chromium; there are no other browser-specific code paths.

Reload reliability:

1. The background answers the message first and reloads second, because the page is about to unload and a lost reply must not look like a failure.
2. If `tabs.reload` is missing, or rejects, the page reloads itself with `location.reload()`.
3. If the extension was just updated and the old content script is orphaned, the message fails and the page reloads itself.

In every case the tab is reloaded exactly once.

### 6.3 Browser support

| Browser | Minimum | Manifest keys |
|---|---|---|
| Chromium (desktop and Android forks that load Chrome extensions) | 152 | `minimum_chrome_version: "152"`, `background.service_worker` |
| Firefox desktop | 160 | `browser_specific_settings.gecko.strict_min_version: "160.0"`, `background.scripts` |
| Firefox for Android | 160 | `browser_specific_settings.gecko_android.strict_min_version: "160.0"` |
| Firefox Focus | not supported | Focus has no extension support. |

Compatibility rules:

- Prioritize Firefox for Android, then Chromium-based mobile browsers that support the required extension APIs.
- Validate desktop compatibility separately.
- Avoid browser-specific APIs where possible; use only APIs that Firefox for Android supports (`tabs`, `storage`, `runtime`, `options_ui`, `action` with no popup).

### 6.4 Firefox and Android specifics

- **Manifest keys.** `browser_specific_settings.gecko` carries the add-on ID, `strict_min_version` and `data_collection_permissions: { "required": ["none"] }`, which Mozilla requires of new extensions. `gecko_android` is present so the add-on is offered on Android.
- **Host access.** From Firefox 127, the `http://*/*` and `https://*/*` content-script patterns are shown in the install prompt. Users can revoke site access later, so if the ball doesn't appear, check the add-on's permissions. Firefox does not show host permissions that an update newly requests, so the match patterns should stay the same across updates.
- **Installing.** Release and Beta builds of Firefox for Android run only signed add-ons. Development: `web-ext run --target=firefox-android` over `adb`. Distribution: sign through addons.mozilla.org (listed or unlisted) and install the signed file from the hidden debug menu; Mozilla says Nightly can install a zipped, unsigned file the same way. Steps are in `README.md`.
- **Settings.** The options page opens in a tab, reached from Add-ons → the extension → Settings. The toolbar action (shown as a menu entry on Android) opens it too.
- **Touch.** The ball uses Pointer Events with `touch-action: none` and its own hold timer, and cancels `contextmenu` so a long press doesn't open the browser's menu. Double-tap-to-zoom and pull-to-refresh don't start from the ball.
- **Private windows.** Firefox runs extensions in private windows only when the user allows it.
- **Dynamic toolbar and rotation.** Position is stored as ratios and recomputed from the current viewport on `resize`.

### 6.5 Styling and page isolation

- The ball lives in a closed shadow root, so page CSS can't restyle it.
- It is styled only through the CSSOM, never a `<style>` element or a `style` attribute, so a strict Content-Security-Policy can't leave it unstyled.
- It takes no part in page events: pointer and click events on the ball are stopped before they reach the page's own handlers.
- If a page removes the ball, it is put back (at most five times).

## 7. Permissions and Privacy

Follow the principle of least privilege.

- Request only permissions required for extension functionality: `storage`, and content-script access to `http://` and `https://` pages in the top frame. No `tabs`, `activeTab` or separate host permissions.
- Avoid collecting browsing history.
- Avoid collecting personal information.
- Do not transmit user preferences to external servers. The extension makes no network requests. The license viewer reads the packaged LICENSE.txt using a local extension URL.
- Keep preference storage local.
- Firefox is told so with `data_collection_permissions: none`.

## 8. Performance Requirements

- Keep the content script lightweight (about 35 KB unminified, comments and license header included, no libraries).
- Avoid unnecessary background processing: the background wakes only for a message or a toolbar click.
- Minimize DOM manipulation: one host element and one button per page.
- Avoid interfering with webpage scrolling and touch interactions: only touches that start on the ball are affected.
- Ensure the floating control does not significantly affect page performance. Dragging moves the ball with the compositor-friendly `translate` property, and it saves once, on release.

## 9. Future Enhancements

Potential future features:

- ~~Adjustable floating-button size~~ — done in revision 2.
- Customizable button appearance.
- Optional edge snapping.
- Multiple quick actions.
- ~~Configurable double-tap interval~~ — done in revision 2.
- Import/export of extension preferences.
- ~~Keeping the ball in view while the page is pinch-zoomed~~ — follows visual viewport dimensions and offsets.

These enhancements should remain optional and should not compromise the simplicity of the core experience.

## 10. Design Goals

The project aims to deliver a small, reliable and convenient browser utility.

Its central idea is simple:

*Inspired by MIUI Quick Ball. Built for Firefox on Android and Chromium. Designed for effortless webpage refreshing.*

---

## Appendix A — Defaults and limits

| Setting | Default | Range |
|---|---|---|
| Transparency | 35 % | 0–85 % |
| Size | 44 px | 32–72 px |
| Double-tap timing | 350 ms | 200–600 ms |
| Hold before drag | 380 ms | fixed |
| Movement tolerance | 10 px | fixed |
| Gap to viewport edge | 6 px | fixed |
| Default position | right edge, 70 % down | anywhere in the viewport |

## Appendix B — Revision notes

Changes from revision 1:

- **Platform:** Chromium-only became Chromium 152+ and Firefox 160+ on desktop and Android, with Firefox for Android as a primary target.
- **§1, §10:** state the Firefox and Android focus.
- **§3.2:** the double-tap interval is defined (350 ms, configurable), and holds and moves are excluded; keyboard and assistive-technology activation added.
- **§3.3:** long-press and tolerance values defined; mouse may drag at once; clamping and re-fitting rules written out.
- **§3.4, §3.5, §5:** transparency range and default, size and timing settings, stored-position format, default look and feedback written out.
- **§4:** single tap, settings change and keyboard rows added.
- **§6:** rewritten around two manifests with one shared source. Added the browser-support table (6.3), the Firefox and Android notes (6.4) and the styling and isolation rules (6.5). The background is a service worker on Chromium and an event page on Firefox. Reload now falls back to the page itself.
- **§7:** permissions pinned down to `storage` plus http(s) content-script access; Firefox data-collection declaration added.
- **§9:** size and double-tap interval moved from "future" to done; pinch-zoom added.
