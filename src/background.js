/*
 * Copyright (C) 2026 Sumon Kayal 
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * This file is part of Double Tap to Refresh, free software under version 3 of the
 * GNU General Public License. It comes WITHOUT ANY WARRANTY. The license text is in
 * LICENSE.md (source) and LICENSE.txt (packages), or at https://www.gnu.org/licenses/.
 */

/*
 * Double Tap to Refresh — background script.
 *
 * Chromium runs this as a service worker, Firefox as an event page. Either way
 * it only wakes up for a message from the content script or a toolbar click.
 */
const api = globalThis.browser ?? globalThis.chrome;

// Keep both names in sync with MESSAGE in shared.js.
const MESSAGE_RELOAD = 'dtr:reload-tab';
const MESSAGE_RELOAD_FAILED = 'dtr:reload-failed';

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== MESSAGE_RELOAD) return false;

  const tabId = sender.tab ? sender.tab.id : undefined;
  const isTopFrame = sender.frameId === undefined || sender.frameId === 0;
  const canReload = api.tabs && typeof api.tabs.reload === 'function';
  if (tabId === undefined || !isTopFrame || !canReload) {
    sendResponse({ ok: false }); // the content script reloads the page itself
    return false;
  }

  // Reply first. The page starts unloading as soon as the reload begins, and a
  // reply that never arrives would look like a failure to the content script.
  sendResponse({ ok: true });
  Promise.resolve()
    .then(() => api.tabs.reload(tabId))
    .catch(() => tellPageToReload(tabId));
  return false;
});

// tabs.reload() failed after we already said "ok": have the page reload itself.
function tellPageToReload(tabId) {
  try {
    Promise.resolve(api.tabs.sendMessage(tabId, { type: MESSAGE_RELOAD_FAILED }, { frameId: 0 })).catch(() => {});
  } catch (_) {
    /* the tab is gone */
  }
}

// The toolbar button (a menu entry on Firefox for Android) opens the settings.
async function openSettings() {
  try {
    await api.runtime.openOptionsPage();
  } catch (_) {
    try {
      await api.tabs.create({ url: api.runtime.getURL('options.html') });
    } catch (__) {
      /* nothing more we can do */
    }
  }
}

if (api.action && api.action.onClicked) {
  api.action.onClicked.addListener(openSettings);
}
