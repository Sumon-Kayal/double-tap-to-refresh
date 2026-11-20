/*
 * Copyright (C) 2026 Sumon Kayal
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * This file is part of Double Tap to Refresh, free software under version 3 of the
 * GNU General Public License. It comes WITHOUT ANY WARRANTY. The license text is in
 * LICENSE.md (source) and LICENSE.txt (packages), or at https://www.gnu.org/licenses/.
 */

/*
 * Double Tap to Refresh — shared code.
 *
 * Loaded by the content script (before content.js) and by the options page.
 * It defines one global, `DTR`, in whichever JavaScript world loads it.
 * The floating ball itself (look, gestures, positioning) lives here so the
 * options-page preview behaves exactly like the real thing.
 *
 * Styling note: the ball is styled only through the CSSOM (element.style),
 * never through a <style> element or a style="" attribute. Pages with a strict
 * Content-Security-Policy can block those two, and then the ball would render
 * unstyled; CSSOM writes are never blocked.
 */
(() => {
  'use strict';

  // Firefox exposes a Promise-based `browser`; Chromium only has `chrome`,
  // which also returns Promises in Manifest V3.
  const api = globalThis.browser ?? globalThis.chrome;

  const STORAGE = Object.freeze({ settings: 'settings', position: 'position' });
  const MESSAGE = Object.freeze({ reload: 'dtr:reload-tab', reloadFailed: 'dtr:reload-failed' }); // keep in sync with background.js

  const DEFAULTS = Object.freeze({ transparency: 0.35, size: 44, doubleTapMs: 350 });
  const LIMITS = Object.freeze({
    transparency: Object.freeze({ min: 0, max: 0.85 }), // 85% max: a fully transparent ball would be unusable
    size: Object.freeze({ min: 32, max: 72 }), // CSS px
    doubleTapMs: Object.freeze({ min: 200, max: 600 }),
  });

  // Position is stored as two ratios (0 = left/top edge, 1 = right/bottom edge)
  // of the space the ball can travel in, so it survives rotation and resizing.
  const DEFAULT_POSITION = Object.freeze({ x: 1, y: 0.7 });
  const EDGE_GAP = 6; // CSS px kept free between the ball and the viewport edge

  const HOLD_MS = 380; // press-and-hold time before the ball can be dragged
  const SLOP_PX = 10; // finger wobble that still counts as a tap or a hold
  const ACCENT = '#4d8bff';
  const ACCENT_SOFT = 'rgba(77, 139, 255, 0.32)';
  const HOST_Z_INDEX = '2147483647';

  // ---------------------------------------------------------------- settings

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const finite = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

  function sanitizeSettings(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const L = LIMITS;
    return {
      transparency: clamp(finite(src.transparency, DEFAULTS.transparency), L.transparency.min, L.transparency.max),
      size: Math.round(clamp(finite(src.size, DEFAULTS.size), L.size.min, L.size.max)),
      doubleTapMs: Math.round(clamp(finite(src.doubleTapMs, DEFAULTS.doubleTapMs), L.doubleTapMs.min, L.doubleTapMs.max)),
    };
  }

  function sanitizePosition(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
      x: clamp(finite(src.x, DEFAULT_POSITION.x), 0, 1),
      y: clamp(finite(src.y, DEFAULT_POSITION.y), 0, 1),
    };
  }

  // ---------------------------------------------------------------- geometry

  // The rectangle the ball's top-left corner may move in, for a viewport w x h.
  function travel(viewW, viewH, size) {
    const minX = EDGE_GAP;
    const minY = EDGE_GAP;
    return {
      minX,
      minY,
      maxX: Math.max(minX, viewW - size - EDGE_GAP),
      maxY: Math.max(minY, viewH - size - EDGE_GAP),
    };
  }

  function toPixels(pos, viewW, viewH, size) {
    const t = travel(viewW, viewH, size);
    return {
      left: t.minX + pos.x * (t.maxX - t.minX),
      top: t.minY + pos.y * (t.maxY - t.minY),
    };
  }

  function toRatios(left, top, viewW, viewH, size) {
    const t = travel(viewW, viewH, size);
    const x = t.maxX > t.minX ? (left - t.minX) / (t.maxX - t.minX) : 0;
    const y = t.maxY > t.minY ? (top - t.minY) / (t.maxY - t.minY) : 0;
    return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
  }

  // Size of the area `position: fixed` elements are laid out in.
  function viewport() {
    const visual = window.visualViewport;
    if (visual) return { w: visual.width, h: visual.height, x: visual.offsetLeft, y: visual.offsetTop };
    const root = document.documentElement;
    // In quirks mode the root element's clientHeight is its content height, not the viewport's.
    if (document.compatMode === 'BackCompat') return { w: window.innerWidth, h: window.innerHeight, x: 0, y: 0 };
    return { w: root.clientWidth || window.innerWidth, h: root.clientHeight || window.innerHeight, x: 0, y: 0 };
  }

  // -------------------------------------------------------------------- icon

  const SVG_NS = 'http://www.w3.org/2000/svg';
  // Same geometry as scripts/make-icons.py (python3 scripts/make-icons.py --paths).
  const GLYPH = Object.freeze({
    arc: 'M18.38 11.44A6.6 6.6 0 1 1 13.71 6.77',
    head: 'M14.38 4.26L13.04 9.28L17.19 7.70Z',
  });

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    return el;
  }

  // A white circular arrow with a soft dark halo underneath, so it stays
  // readable on any page even when the ball's own background is very faint.
  function buildIcon() {
    const svg = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    const halo = svgEl('g', { opacity: '0.5' });
    halo.append(
      svgEl('path', { d: GLYPH.arc, fill: 'none', stroke: '#000', 'stroke-width': '4', 'stroke-linecap': 'round' }),
      svgEl('path', { d: GLYPH.head, fill: '#000', stroke: '#000', 'stroke-width': '1.8', 'stroke-linejoin': 'round' }),
    );
    svg.append(
      halo,
      svgEl('path', { d: GLYPH.arc, fill: 'none', stroke: '#fff', 'stroke-width': '2.2', 'stroke-linecap': 'round' }),
      svgEl('path', { d: GLYPH.head, fill: '#fff', stroke: '#fff', 'stroke-width': '0.6', 'stroke-linejoin': 'round' }),
    );
    return svg;
  }

  // -------------------------------------------------------------------- ball

  function setStyle(el, props, important = false) {
    const priority = important ? 'important' : '';
    for (const [name, value] of Object.entries(props)) el.style.setProperty(name, String(value), priority);
  }

  /**
   * Creates the floating refresh ball.
   *
   * options.placement   'fixed' (default): floats over the page, draggable.
   *                     'inline': sits in normal flow (the options-page preview).
   * options.draggable   false to disable press-and-hold dragging.
   * options.settings    { transparency, size, doubleTapMs }
   * options.position    { x, y } ratios, see DEFAULT_POSITION
   * options.onRefresh   called after a double tap (or keyboard activation)
   * options.onMoveEnd   called with the new { x, y } when a drag ends
   */
  function createBall(options = {}) {
    const placement = options.placement === 'inline' ? 'inline' : 'fixed';
    const draggable = placement === 'fixed' && options.draggable !== false;
    const onRefresh = typeof options.onRefresh === 'function' ? options.onRefresh : null;
    const onMoveEnd = typeof options.onMoveEnd === 'function' ? options.onMoveEnd : null;

    let cfg = sanitizeSettings(options.settings);
    let pos = sanitizePosition(options.position);

    const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ---- DOM: a 0x0 fixed host in the page, a closed shadow root, one button.
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'closed' });
    const face = document.createElement('button');
    const icon = buildIcon();
    face.type = 'button';
    face.setAttribute('aria-label', 'Refresh page');
    face.title = 'Double-tap to refresh';
    face.append(icon);
    root.append(face);

    function styleHost() {
      const fixed = placement === 'fixed';
      setStyle(
        host,
        {
          all: 'initial', // must come first: shields the host from page CSS
          display: 'block',
          position: fixed ? 'fixed' : 'relative',
          left: '0',
          top: '0',
          width: fixed ? '0' : `${cfg.size}px`,
          height: fixed ? '0' : `${cfg.size}px`,
          overflow: 'visible',
          'z-index': HOST_Z_INDEX,
          'pointer-events': 'none', // only the ball itself takes touches
        },
        true,
      );
    }

    function styleFace() {
      setStyle(face, {
        all: 'unset', // drop the browser's default button look
        position: 'absolute',
        left: '0',
        top: '0',
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        'box-sizing': 'border-box',
        'border-radius': '50%',
        'pointer-events': 'auto',
        'touch-action': 'none', // no scrolling or double-tap zoom starts on the ball
        'user-select': 'none',
        '-webkit-user-select': 'none',
        '-webkit-touch-callout': 'none',
        '-webkit-tap-highlight-color': 'transparent',
        transition: reducedMotion()
          ? 'none'
          : 'scale 120ms ease-out, box-shadow 120ms ease-out, background-color 160ms ease-out',
      });
      setStyle(icon, { display: 'block', 'flex-shrink': '0', 'pointer-events': 'none', overflow: 'visible' });
      applySize();
    }

    function applySize() {
      const s = cfg.size;
      if (placement === 'inline') setStyle(host, { width: `${s}px`, height: `${s}px` }, true);
      setStyle(face, { width: `${s}px`, height: `${s}px` });
      const glyph = Math.round(s * 0.58);
      setStyle(icon, { width: `${glyph}px`, height: `${glyph}px` });
    }

    // ---- Look: one place that turns state into styles.
    let phase = 'idle'; // 'idle' | 'pressed' | 'dragging'
    let hovered = false;
    let focusRing = false;

    function paint() {
      const dragging = phase === 'dragging';
      const alpha = (1 - cfg.transparency).toFixed(3);
      face.style.backgroundColor = `rgba(22, 24, 29, ${alpha})`;
      face.style.scale = dragging ? '1.14' : phase === 'pressed' ? '0.93' : hovered ? '1.06' : '1';
      face.style.cursor = !draggable ? 'pointer' : dragging ? 'grabbing' : 'grab';
      face.style.boxShadow = [
        `inset 0 0 0 1.5px ${dragging ? ACCENT : 'rgba(255, 255, 255, 0.34)'}`,
        dragging ? `0 0 0 6px ${ACCENT_SOFT}` : '',
        focusRing ? `0 0 0 2px #fff, 0 0 0 4px ${ACCENT}` : '',
        '0 2px 8px rgba(0, 0, 0, 0.38)',
      ]
        .filter(Boolean)
        .join(', ');
    }

    // ---- Position: px for the current frame, ratios for storage.
    let pendingLayout = false;
    let deferredPosition = null;
    let curLeft = 0;
    let curTop = 0;

    function place(left, top) {
      const v = viewport();
      const t = travel(v.w, v.h, cfg.size);
      curLeft = clamp(left, v.x + t.minX, v.x + t.maxX);
      curTop = clamp(top, v.y + t.minY, v.y + t.maxY);
      face.style.translate = `${curLeft}px ${curTop}px`;
    }

    function layout() {
      if (placement !== 'fixed') {
        face.style.translate = 'none';
        return;
      }
      const v = viewport();
      const p = toPixels(pos, v.w, v.h, cfg.size);
      place(v.x + p.left, v.y + p.top);
    }

    // ---- Feedback when a refresh is triggered.
    let animation = null;
    function playRefreshFeedback() {
      if (animation) animation.cancel();
      animation = reducedMotion()
        ? face.animate([{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }], { duration: 320 })
        : icon.animate([{ rotate: '0deg' }, { rotate: '360deg' }], { duration: 650, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
    }

    function refresh() {
      try {
        playRefreshFeedback();
      } catch (_) {
        /* the animation is cosmetic: never let it get in the way of the refresh */
      }
      if (onRefresh) onRefresh();
    }

    // ---- Gestures.
    //   double tap            -> refresh
    //   press, hold, drag     -> move (mouse users may also drag straight away)
    //   anything else         -> ignored, so the page keeps working normally
    const gesture = { id: null, startX: 0, startY: 0, originLeft: 0, originTop: 0, downAt: 0, secondTap: false, hold: 0 };
    let lastTapEnd = 0; // timestamp of the previous completed tap; 0 = none pending

    function endGesture() {
      clearTimeout(gesture.hold);
      if (gesture.id !== null) {
        try {
          face.releasePointerCapture(gesture.id);
        } catch (_) {
          /* capture was already gone */
        }
      }
      gesture.id = null;
      phase = 'idle';
      paint();
    }

    function beginDrag() {
      if (phase !== 'pressed') return;
      clearTimeout(gesture.hold);
      phase = 'dragging';
      lastTapEnd = 0; // a long press interrupts any pending double tap
      paint();
    }

    function finishDrag() {
      const moved = curLeft !== gesture.originLeft || curTop !== gesture.originTop;
      if (moved) {
        const v = viewport();
        pos = toRatios(curLeft - v.x, curTop - v.y, v.w, v.h, cfg.size);
        if (onMoveEnd) onMoveEnd({ x: pos.x, y: pos.y });
      } else if (deferredPosition) {
        pos = sanitizePosition(deferredPosition.value);
      }
      deferredPosition = null;
      if (pendingLayout || !moved) layout();
      pendingLayout = false;
    }

    face.addEventListener('pointerdown', (event) => {
      event.stopPropagation(); // keep the page's click-away handlers out of it
      if (!event.isPrimary) return; // a second finger: ignore
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (gesture.id !== null) endGesture(); // left over from a gesture that never finished
      gesture.id = event.pointerId;
      gesture.startX = event.clientX;
      gesture.startY = event.clientY;
      gesture.originLeft = curLeft;
      gesture.originTop = curTop;
      gesture.downAt = event.timeStamp;
      gesture.secondTap = lastTapEnd > 0 && event.timeStamp - lastTapEnd <= cfg.doubleTapMs;
      phase = 'pressed';
      try {
        face.setPointerCapture(event.pointerId);
      } catch (_) {
        /* the pointer is already gone */
      }
      if (draggable) gesture.hold = setTimeout(beginDrag, HOLD_MS);
      paint();
      event.preventDefault();
    });

    face.addEventListener('pointermove', (event) => {
      if (event.pointerId !== gesture.id) return;
      event.stopPropagation();
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (event.pointerType !== 'mouse' && Math.hypot(dx, dy) > SLOP_PX
          && event.timeStamp < gesture.downAt + HOLD_MS) {
        lastTapEnd = 0;
        endGesture();
        curLeft = gesture.originLeft;
        curTop = gesture.originTop;
        finishDrag();
        return;
      }
      if (phase === 'pressed' && Math.hypot(dx, dy) > SLOP_PX) {
        if (draggable && event.pointerType === 'mouse') {
          beginDrag();
        } else {
          // Moved before the hold finished: a swipe, neither a tap nor a drag.
          lastTapEnd = 0;
          endGesture();
          return;
        }
      }
      if (phase === 'dragging') {
        place(gesture.originLeft + dx, gesture.originTop + dy);
        event.preventDefault();
      }
    });

    face.addEventListener('pointerup', (event) => {
      event.stopPropagation();
      if (event.pointerId !== gesture.id) return;
      const wasPhase = phase;
      const wasSecondTap = gesture.secondTap;
      const isShortPress = event.timeStamp - gesture.downAt < HOLD_MS;
      endGesture();
      if (wasPhase === 'dragging') {
        finishDrag();
      } else if (wasPhase === 'pressed' && isShortPress) {
        if (wasSecondTap) {
          lastTapEnd = 0;
          refresh();
        } else {
          lastTapEnd = event.timeStamp;
        }
      } else {
        lastTapEnd = 0;
      }
    });

    function abortGesture(event) {
      if (event.pointerId !== gesture.id) return;
      const wasDragging = phase === 'dragging';
      lastTapEnd = 0;
      endGesture();
      if (wasDragging) finishDrag(); // the system took the touch away: keep where the ball got to
    }
    face.addEventListener('pointercancel', abortGesture);
    face.addEventListener('lostpointercapture', abortGesture);

    face.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'mouse') return;
      hovered = true;
      paint();
    });
    face.addEventListener('pointerleave', () => {
      hovered = false;
      paint();
    });

    face.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && event.repeat) event.preventDefault();
    });
    face.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      // Pointer clicks carry a pointer type or a nonzero click count.
      if (!event.pointerType && event.detail === 0) refresh();
    });
    // Long-press must not open the browser's context menu or start a drag-and-drop.
    face.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    face.addEventListener('dragstart', (event) => event.preventDefault());

    face.addEventListener('focus', () => {
      focusRing = face.matches(':focus-visible');
      paint();
    });
    face.addEventListener('blur', () => {
      focusRing = false;
      paint();
    });

    // ---- Page-level events.
    let frame = 0;
    const onResize = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (phase !== 'dragging') layout();
        else pendingLayout = true;
      });
    };
    // Keep the ball out of printouts.
    const onBeforePrint = () => setStyle(host, { display: 'none' }, true);
    const onAfterPrint = () => setStyle(host, { display: 'block' }, true);
    let listening = false;

    styleHost();
    styleFace();
    paint();

    return {
      mount(parent) {
        parent.appendChild(host);
        layout();
        paint();
        if (!listening) {
          listening = true;
          window.addEventListener('resize', onResize, { passive: true });
          window.visualViewport?.addEventListener('resize', onResize, { passive: true });
          window.visualViewport?.addEventListener('scroll', onResize, { passive: true });
          window.addEventListener('beforeprint', onBeforePrint);
          window.addEventListener('afterprint', onAfterPrint);
        }
      },
      isMounted: () => host.isConnected,
      /** next may contain `settings` and/or `position`; a missing value means "back to the default". */
      update(next = {}) {
        if ('settings' in next) {
          cfg = sanitizeSettings(next.settings);
          styleHost();
          applySize();
        }
        if ('position' in next) {
          if (phase === 'dragging') deferredPosition = { value: next.position };
          else pos = sanitizePosition(next.position);
        }
        if (phase !== 'dragging') layout();
        else pendingLayout = true; // never yank the ball out from under a finger
        paint();
      },
      destroy() {
        listening = false;
        window.removeEventListener('resize', onResize);
        window.visualViewport?.removeEventListener('resize', onResize);
        window.visualViewport?.removeEventListener('scroll', onResize);
        window.removeEventListener('beforeprint', onBeforePrint);
        window.removeEventListener('afterprint', onAfterPrint);
        clearTimeout(gesture.hold);
        if (frame) cancelAnimationFrame(frame);
        host.remove();
      },
    };
  }

  globalThis.DTR = Object.freeze({
    api,
    STORAGE,
    MESSAGE,
    DEFAULTS,
    LIMITS,
    DEFAULT_POSITION,
    sanitizeSettings,
    sanitizePosition,
    travel,
    toPixels,
    toRatios,
    createBall,
  });
})();
