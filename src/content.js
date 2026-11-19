/*
 * Double Tap to Refresh — content script.
 *
 * Puts the floating ball on web pages (top frame only) and asks the background
 * script to reload the tab when the ball is double-tapped. The ball itself is
 * built in shared.js, which manifest.json loads just before this file.
 */
(() => {
  'use strict';

  const { api, STORAGE, MESSAGE, createBall } = globalThis.DTR;

  // Ordinary HTML documents in the top frame only (not XML/SVG files, not iframes).
  if (window.top !== window) return;
  if (!document.documentElement || document.documentElement.namespaceURI !== 'http://www.w3.org/1999/xhtml') return;
  if (globalThis.__dtrContentLoaded) return; // never add a second ball
  globalThis.__dtrContentLoaded = true;

  const KEYS = [STORAGE.settings, STORAGE.position];

  async function loadStored() {
    try {
      return await api.storage.local.get(KEYS);
    } catch (_) {
      return null; // distinguish failure from a successful read of missing values
    }
  }

  function savePosition(position) {
    try {
      Promise.resolve(api.storage.local.set({ [STORAGE.position]: position })).catch(() => {});
    } catch (_) {
      /* extension context was invalidated, nothing to save to */
    }
  }

  async function requestReload() {
    try {
      const reply = await api.runtime.sendMessage({ type: MESSAGE.reload });
      if (reply && reply.ok) return;
    } catch (_) {
      /* background unreachable, e.g. the extension was just updated */
    }
    location.reload();
  }

  // The background script could not reload the tab (tabs.reload() missing or failing): do it here.
  api.runtime.onMessage.addListener((message) => {
    if (message && message.type === MESSAGE.reloadFailed) location.reload();
    return false;
  });

  // If the page removes our node, put it back, but give up if it keeps doing so.
  function keepMounted(ball) {
    let attempts = 0;
    let root = document.documentElement;
    const observer = new MutationObserver(() => {
      if (root !== document.documentElement) {
        root = document.documentElement;
        observer.disconnect();
        observer.observe(document, { childList: true });
        if (root) {
          observer.observe(root, { childList: true });
          ball.mount(root);
        }
        return;
      }
      if (ball.isMounted()) return;
      if (++attempts > 5) {
        observer.disconnect();
        observer.observe(document, { childList: true });
        return;
      }
      if (root) ball.mount(root);
    });
    observer.observe(document, { childList: true });
    observer.observe(root, { childList: true });
  }

  loadStored().then((stored) => {
    const ball = createBall({
      placement: 'fixed',
      settings: stored?.[STORAGE.settings],
      position: stored?.[STORAGE.position],
      onRefresh: requestReload,
      onMoveEnd: savePosition,
    });
    ball.mount(document.documentElement);
    keepMounted(ball);

    // Settings changed in the options page, or the ball was moved in another tab.
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const next = {};
      if (STORAGE.settings in changes) next.settings = changes[STORAGE.settings].newValue;
      if (STORAGE.position in changes) next.position = changes[STORAGE.position].newValue;
      if (Object.keys(next).length > 0) ball.update(next);
    });

    // Coming back from the back/forward cache: catch up with anything changed meanwhile.
    window.addEventListener('pageshow', (event) => {
      if (!event.persisted) return;
      loadStored().then((fresh) => {
        if (!fresh) return;
        ball.update({ settings: fresh[STORAGE.settings], position: fresh[STORAGE.position] });
      });
    });
  });
})();
