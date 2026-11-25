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
 * unstyled; CSSOM writes are never blocked. SVG attributes and the Web
 * Animations API are not affected by that policy either.
 */
(() => {
  'use strict';

  // Firefox exposes a Promise-based `browser`; Chromium only has `chrome`,
  // which also returns Promises in Manifest V3.
  const api = globalThis.browser ?? globalThis.chrome;

  const STORAGE = Object.freeze({ settings: 'settings', position: 'position' });
  const MESSAGE = Object.freeze({ reload: 'dtr:reload-tab', reloadFailed: 'dtr:reload-failed' }); // keep in sync with background.js

  const LOOKS = Object.freeze(['dark', 'light', 'glass']);
  const DEFAULTS = Object.freeze({
    transparency: 0.35,
    size: 44,
    doubleTapMs: 350,
    look: 'dark',
    haptics: true, // short vibration when the ball is grabbed and when it refreshes
    dock: false, // snap to the nearest edge and tuck away when idle
  });
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
  const NEAR_MISS_MS = 1200; // a second tap this soon after the first still counts as an attempt at a double tap
  const DOCK_IDLE_MS = 2500; // idle time before a docked ball tucks into the edge
  const TUCK_FRACTION = 0.4; // share of the ball that slides off screen when tucked
  const TUCK_OPACITY = 0.6;
  const SNAP_MS = 200; // glide to the edge and back out of it
  const GRAB_BUZZ_MS = 15; // vibration when the hold registers
  const REFRESH_BUZZ_MS = 10; // vibration when a refresh starts
  const HOST_Z_INDEX = '2147483647';

  // One accent for dark surfaces and one for light ones. Keep both in sync
  // with --accent in options.css.
  const ACCENT_ON_DARK = '#4d8bff';
  const ACCENT_ON_LIGHT = '#2f6df0';

  // What each look is made of. `fill` is the ball's RGB; its alpha comes from
  // the transparency setting (scaled by `fillScale`). `glyph` and `halo` are the
  // arrow and the soft outline under it, which keeps the arrow readable on any page.
  const LOOK_STYLES = Object.freeze({
    dark: Object.freeze({
      fill: '22, 24, 29', fillScale: 1, blur: false,
      rim: 'rgba(255, 255, 255, 0.34)', shadow: 'rgba(0, 0, 0, 0.38)',
      glyph: '#fff', halo: '#000', haloOpacity: '0.5',
      accent: ACCENT_ON_DARK, accentSoft: 'rgba(77, 139, 255, 0.32)',
    }),
    light: Object.freeze({
      fill: '250, 251, 253', fillScale: 1, blur: false,
      rim: 'rgba(0, 0, 0, 0.20)', shadow: 'rgba(0, 0, 0, 0.30)',
      glyph: '#171a20', halo: '#fff', haloOpacity: '0.7',
      accent: ACCENT_ON_LIGHT, accentSoft: 'rgba(47, 109, 240, 0.30)',
    }),
    glass: Object.freeze({
      fill: '26, 30, 40', fillScale: 0.6, blur: true,
      rim: 'rgba(255, 255, 255, 0.50)', shadow: 'rgba(0, 0, 0, 0.32)',
      glyph: '#fff', halo: '#000', haloOpacity: '0.5',
      accent: ACCENT_ON_DARK, accentSoft: 'rgba(77, 139, 255, 0.32)',
    }),
  });
  const BLUR_OK = typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
    && CSS.supports('backdrop-filter', 'blur(1px)');

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
      look: LOOKS.includes(src.look) ? src.look : DEFAULTS.look,
      haptics: typeof src.haptics === 'boolean' ? src.haptics : DEFAULTS.haptics,
      dock: typeof src.dock === 'boolean' ? src.dock : DEFAULTS.dock,
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

  // A circular arrow with a soft halo underneath, so it stays readable on any
  // page even when the ball's own background is very faint. `tone()` recolours
  // it for the current look.
  function buildIcon() {
    const svg = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    const halo = svgEl('g', { opacity: '0.5' });
    const haloArc = svgEl('path', { d: GLYPH.arc, fill: 'none', 'stroke-width': '4', 'stroke-linecap': 'round' });
    const haloHead = svgEl('path', { d: GLYPH.head, 'stroke-width': '1.8', 'stroke-linejoin': 'round' });
    const arc = svgEl('path', { d: GLYPH.arc, fill: 'none', 'stroke-width': '2.2', 'stroke-linecap': 'round' });
    const head = svgEl('path', { d: GLYPH.head, 'stroke-width': '0.6', 'stroke-linejoin': 'round' });
    halo.append(haloArc, haloHead);
    svg.append(halo, arc, head);

    function tone(look) {
      halo.setAttribute('opacity', look.haloOpacity);
      haloArc.setAttribute('stroke', look.halo);
      haloHead.setAttribute('stroke', look.halo);
      haloHead.setAttribute('fill', look.halo);
      arc.setAttribute('stroke', look.glyph);
      head.setAttribute('stroke', look.glyph);
      head.setAttribute('fill', look.glyph);
    }
    return { svg, tone };
  }

  // The ring that drains around the ball after the first tap, for as long as a
  // second tap would still count. It is drawn in a 44-unit box that is scaled
  // to the ball, so it stays proportional at every size.
  const RING_BOX = 44;
  const RING_RADIUS = 20.75;
  const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

  function buildRing() {
    const svg = svgEl('svg', { viewBox: `0 0 ${RING_BOX} ${RING_BOX}`, 'aria-hidden': 'true', focusable: 'false' });
    const arc = svgEl('circle', {
      cx: RING_BOX / 2,
      cy: RING_BOX / 2,
      r: RING_RADIUS,
      fill: 'none',
      'stroke-width': '2.5',
      'stroke-linecap': 'round',
      'stroke-dasharray': RING_LENGTH.toFixed(2),
      'stroke-dashoffset': '0',
      transform: `rotate(-90 ${RING_BOX / 2} ${RING_BOX / 2})`, // start at 12 o'clock
      opacity: '0', // only visible while its animation runs
    });
    svg.append(arc);
    return { svg, arc };
  }

  // -------------------------------------------------------------------- ball

  function setStyle(el, props, important = false) {
    const priority = important ? 'important' : '';
    for (const [name, value] of Object.entries(props)) el.style.setProperty(name, String(value), priority);
  }

  /**
   * Creates the floating refresh ball.
   *
   * options.placement   'fixed' (default): floats over the page.
   *                     'contained': floats inside options.container, which
   *                     must be a positioned element (the options-page preview).
   * options.draggable   false to disable press-and-hold dragging.
   * options.settings    { transparency, size, doubleTapMs, look, haptics, dock }
   * options.position    { x, y } ratios, see DEFAULT_POSITION
   * options.onRefresh   called after a double tap (or keyboard activation)
   * options.onMoveEnd   called with the new { x, y } when a drag ends
   * options.onTiming    called after a tap that closely follows another one,
   *                     with { gap, limit, ok }: the milliseconds between the
   *                     two taps, the allowed maximum, and whether it counted
   */
  function createBall(options = {}) {
    const container = options.placement === 'contained' && options.container && options.container.nodeType === 1
      ? options.container
      : null;
    const draggable = options.draggable !== false;
    const onRefresh = typeof options.onRefresh === 'function' ? options.onRefresh : null;
    const onMoveEnd = typeof options.onMoveEnd === 'function' ? options.onMoveEnd : null;
    const onTiming = typeof options.onTiming === 'function' ? options.onTiming : null;

    let cfg = sanitizeSettings(options.settings);
    let pos = sanitizePosition(options.position);

    const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ---- DOM: a 0x0 positioned host, a closed shadow root, one button.
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'closed' });
    const face = document.createElement('button');
    const glyph = buildIcon();
    const ring = buildRing();
    face.type = 'button';
    face.setAttribute('aria-label', 'Refresh page');
    face.title = 'Double-tap to refresh';
    face.append(ring.svg, glyph.svg);
    root.append(face);

    // ---- State.
    let phase = 'idle'; // 'idle' | 'pressed' | 'dragging'
    let hovered = false;
    let focusRing = false;
    let tucked = false; // docked and idle: partly off screen and dimmed
    let dockTimer = 0;
    let curLeft = 0; // where the ball is (or is going), before any tuck offset
    let curTop = 0;
    let pendingLayout = false;
    let deferredPosition = null;
    let lastTranslate = ''; // the last position written, to skip no-op moves
    let moveAnim = null; // the glide to a new spot
    let armedAnim = null; // the draining ring
    let spinAnim = null; // refresh feedback
    let lastTapEnd = 0; // timestamp of the previous completed tap; 0 = none pending
    let frame = 0;
    let listening = false;
    let mountedOnce = false;
    let resizeObserver = null;
    const gesture = { id: null, startX: 0, startY: 0, originLeft: 0, originTop: 0, downAt: 0, gap: Infinity, secondTap: false, hold: 0 };

    function styleHost() {
      setStyle(
        host,
        {
          all: 'initial', // must come first: shields the host from page CSS
          display: 'block',
          position: container ? 'absolute' : 'fixed',
          left: '0',
          top: '0',
          width: '0',
          height: '0',
          overflow: 'visible',
          'z-index': HOST_Z_INDEX,
          'pointer-events': 'none', // only the ball itself takes touches
        },
        true,
      );
    }

    function styleFace() {
      const calm = reducedMotion();
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
        transition: calm
          ? 'none'
          : 'scale 120ms ease-out, box-shadow 120ms ease-out, background-color 160ms ease-out, opacity 220ms ease-out',
      });
      setStyle(glyph.svg, {
        display: 'block',
        'flex-shrink': '0',
        'pointer-events': 'none',
        overflow: 'visible',
        transition: calm ? 'none' : `translate ${SNAP_MS}ms ease-out`,
      });
      setStyle(ring.svg, { position: 'absolute', left: '0', top: '0', display: 'block', 'pointer-events': 'none', overflow: 'visible' });
      applySize();
    }

    function applySize() {
      const s = cfg.size;
      setStyle(face, { width: `${s}px`, height: `${s}px` });
      const g = Math.round(s * 0.58);
      setStyle(glyph.svg, { width: `${g}px`, height: `${g}px` });
      setStyle(ring.svg, { width: `${s}px`, height: `${s}px` });
    }

    function applyLook() {
      const look = LOOK_STYLES[cfg.look] || LOOK_STYLES.dark;
      glyph.tone(look);
      ring.arc.setAttribute('stroke', look.accent);
    }

    // ---- Look: one place that turns state into styles.
    function paint() {
      const look = LOOK_STYLES[cfg.look] || LOOK_STYLES.dark;
      const dragging = phase === 'dragging';
      const alpha = ((1 - cfg.transparency) * look.fillScale).toFixed(3);
      face.style.backgroundColor = `rgba(${look.fill}, ${alpha})`;
      face.style.backdropFilter = look.blur && BLUR_OK ? 'blur(10px) saturate(1.5)' : 'none';
      face.style.opacity = tucked ? String(TUCK_OPACITY) : '1';
      face.style.scale = dragging ? '1.14' : phase === 'pressed' ? '0.93' : hovered ? '1.06' : '1';
      face.style.cursor = !draggable ? 'pointer' : dragging ? 'grabbing' : 'grab';
      face.style.boxShadow = [
        `inset 0 0 0 1.5px ${dragging ? look.accent : look.rim}`,
        dragging ? `0 0 0 6px ${look.accentSoft}` : '',
        focusRing ? `0 0 0 2px #fff, 0 0 0 4px ${look.accent}` : '',
        `0 2px 8px ${look.shadow}`,
      ]
        .filter(Boolean)
        .join(', ');
    }

    // ---- Position: px for the current frame, ratios for storage.

    // The area the ball moves in: the viewport, or the preview box.
    function bounds() {
      if (container) return { w: container.clientWidth, h: container.clientHeight, x: 0, y: 0 };
      return viewport();
    }

    // With docking on, the ball always rests on the nearer side edge.
    function effectivePos() {
      return cfg.dock ? { x: pos.x < 0.5 ? 0 : 1, y: pos.y } : pos;
    }

    const dockSide = () => (effectivePos().x < 0.5 ? -1 : 1); // -1 left edge, 1 right edge
    const tuckShift = () => EDGE_GAP + Math.round(cfg.size * TUCK_FRACTION);

    function setTranslate(x, y, animated) {
      const to = `${x}px ${y}px`;
      if (to === lastTranslate) return; // already there: leave any glide in progress alone
      lastTranslate = to;
      let from = '';
      if (animated && !reducedMotion()) {
        try {
          from = getComputedStyle(face).translate;
        } catch (_) {
          from = '';
        }
      }
      if (moveAnim) {
        moveAnim.cancel();
        moveAnim = null;
      }
      face.style.translate = to;
      if (from && from !== 'none' && from !== to) {
        try {
          moveAnim = face.animate([{ translate: from }, { translate: to }], { duration: SNAP_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
        } catch (_) {
          moveAnim = null; // cosmetic only
        }
      }
    }

    function place(left, top, animated = false) {
      const b = bounds();
      const t = travel(b.w, b.h, cfg.size);
      curLeft = clamp(left, b.x + t.minX, b.x + t.maxX);
      curTop = clamp(top, b.y + t.minY, b.y + t.maxY);
      const side = dockSide();
      setTranslate(curLeft + (tucked ? side * tuckShift() : 0), curTop, animated);
      // Keep the arrow centred in the part of the ball that is still on screen.
      glyph.svg.style.translate = tucked ? `${-side * Math.round((cfg.size * TUCK_FRACTION) / 2)}px 0px` : '0px 0px';
    }

    function layout(animated = false) {
      const b = bounds();
      const p = toPixels(effectivePos(), b.w, b.h, cfg.size);
      place(b.x + p.left, b.y + p.top, animated);
    }

    // ---- Docking: tuck into the edge when idle, slide back out on touch.
    function setTucked(next, animated) {
      if (tucked === next) return;
      tucked = next;
      layout(animated);
      paint();
    }

    function wake() {
      clearTimeout(dockTimer);
      if (tucked) setTucked(false, true);
    }

    function scheduleTuck() {
      clearTimeout(dockTimer);
      if (!cfg.dock) return;
      dockTimer = setTimeout(() => {
        if (cfg.dock && phase === 'idle' && !hovered && !focusRing) setTucked(true, true);
      }, DOCK_IDLE_MS);
    }

    // ---- Feedback.

    // After the first tap: a ring drains clockwise over exactly the time a
    // second tap would still count.
    function showArmed() {
      hideArmed();
      const full = RING_LENGTH.toFixed(2);
      try {
        armedAnim = reducedMotion()
          ? ring.arc.animate([{ opacity: 1 }, { opacity: 1 }], { duration: cfg.doubleTapMs })
          : ring.arc.animate(
            [
              { strokeDashoffset: '0px', opacity: 1 },
              { strokeDashoffset: `${(RING_LENGTH * 0.94).toFixed(2)}px`, opacity: 1, offset: 0.94 },
              { strokeDashoffset: `${full}px`, opacity: 0 },
            ],
            { duration: cfg.doubleTapMs, easing: 'linear' },
          );
      } catch (_) {
        armedAnim = null; // cosmetic only
      }
    }

    function hideArmed() {
      if (!armedAnim) return;
      try {
        armedAnim.cancel();
      } catch (_) {
        /* already gone */
      }
      armedAnim = null;
    }

    function disarm() {
      lastTapEnd = 0;
      hideArmed();
    }

    function buzz(ms) {
      if (!cfg.haptics) return;
      try {
        const activation = navigator.userActivation;
        if (activation && !activation.hasBeenActive) return; // Chromium refuses vibrate() until the page has had a tap
        if (typeof navigator.vibrate === 'function') navigator.vibrate(ms);
      } catch (_) {
        /* haptics are a nicety */
      }
    }

    function playRefreshFeedback() {
      if (spinAnim) spinAnim.cancel();
      spinAnim = reducedMotion()
        ? face.animate([{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }], { duration: 320 })
        : glyph.svg.animate([{ rotate: '0deg' }, { rotate: '360deg' }], { duration: 650, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
    }

    function refresh() {
      try {
        playRefreshFeedback();
      } catch (_) {
        /* the animation is cosmetic: never let it get in the way of the refresh */
      }
      buzz(REFRESH_BUZZ_MS);
      if (onRefresh) onRefresh();
    }

    // ---- Gestures.
    //   double tap            -> refresh
    //   press, hold, drag     -> move (mouse users may also drag straight away)
    //   anything else         -> ignored, so the page keeps working normally

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
      scheduleTuck();
    }

    function beginDrag() {
      if (phase !== 'pressed') return;
      clearTimeout(gesture.hold);
      phase = 'dragging';
      disarm(); // a long press interrupts any pending double tap
      buzz(GRAB_BUZZ_MS);
      paint();
    }

    function finishDrag() {
      const moved = curLeft !== gesture.originLeft || curTop !== gesture.originTop;
      if (moved) {
        const b = bounds();
        pos = toRatios(curLeft - b.x, curTop - b.y, b.w, b.h, cfg.size);
        if (cfg.dock) pos = { x: pos.x < 0.5 ? 0 : 1, y: pos.y };
        if (onMoveEnd) onMoveEnd({ x: pos.x, y: pos.y });
      } else if (deferredPosition) {
        pos = sanitizePosition(deferredPosition.value);
      }
      deferredPosition = null;
      if (pendingLayout || !moved || cfg.dock) layout(moved && cfg.dock); // docking glides to the edge
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
      gesture.downAt = event.timeStamp;
      gesture.gap = lastTapEnd > 0 ? event.timeStamp - lastTapEnd : Infinity;
      gesture.secondTap = gesture.gap <= cfg.doubleTapMs;
      if (gesture.secondTap) hideArmed(); // the second tap landed in time: the ring has done its job
      phase = 'pressed';
      wake(); // a tucked ball slides out first
      gesture.originLeft = curLeft;
      gesture.originTop = curTop;
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
        disarm();
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
          // The press moved without starting a drag: cancel the tap.
          disarm();
          endGesture();
          if (deferredPosition || pendingLayout) finishDrag();
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
      const gap = gesture.gap;
      const isShortPress = event.timeStamp - gesture.downAt < HOLD_MS;
      endGesture();
      if (wasPhase === 'dragging') {
        finishDrag();
      } else if (wasPhase === 'pressed' && isShortPress) {
        if (deferredPosition || pendingLayout) finishDrag();
        if (onTiming && gap <= NEAR_MISS_MS) {
          try {
            onTiming({ gap: Math.round(gap), limit: cfg.doubleTapMs, ok: wasSecondTap });
          } catch (_) {
            /* the listener's problem, not the ball's */
          }
        }
        if (wasSecondTap) {
          disarm();
          refresh();
        } else {
          lastTapEnd = event.timeStamp;
          showArmed();
        }
      } else {
        disarm();
        if (deferredPosition || pendingLayout) finishDrag();
      }
    });

    function abortGesture(event) {
      if (event.pointerId !== gesture.id) return;
      const wasDragging = phase === 'dragging';
      disarm();
      endGesture();
      if (wasDragging || deferredPosition || pendingLayout) finishDrag(); // apply deferred updates on cancellation
    }
    face.addEventListener('pointercancel', abortGesture);
    face.addEventListener('lostpointercapture', abortGesture);

    face.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'mouse') return;
      hovered = true;
      wake();
      paint();
    });
    face.addEventListener('pointerleave', () => {
      hovered = false;
      scheduleTuck();
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
      wake();
      paint();
    });
    face.addEventListener('blur', () => {
      focusRing = false;
      scheduleTuck();
      paint();
    });

    // ---- Page-level events.
    const onResize = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (phase === 'idle') layout();
        else pendingLayout = true;
      });
    };
    // Keep the ball out of printouts.
    const onBeforePrint = () => setStyle(host, { display: 'none' }, true);
    const onAfterPrint = () => setStyle(host, { display: 'block' }, true);

    styleHost();
    styleFace();
    applyLook();
    paint();

    return {
      mount(parent) {
        parent.appendChild(host);
        if (!mountedOnce) {
          mountedOnce = true;
          tucked = cfg.dock; // a docked ball starts out tucked in
        }
        layout();
        paint();
        if (!listening) {
          listening = true;
          if (container) {
            if (typeof ResizeObserver === 'function') {
              resizeObserver = new ResizeObserver(onResize);
              resizeObserver.observe(container);
            }
          } else {
            window.addEventListener('resize', onResize, { passive: true });
            window.visualViewport?.addEventListener('resize', onResize, { passive: true });
            window.visualViewport?.addEventListener('scroll', onResize, { passive: true });
            window.addEventListener('beforeprint', onBeforePrint);
            window.addEventListener('afterprint', onAfterPrint);
          }
        }
      },
      isMounted: () => host.isConnected,
      /** next may contain `settings` and/or `position`; a missing value means "back to the default". */
      update(next = {}) {
        let glide = false;
        if ('settings' in next) {
          const wasDocked = cfg.dock;
          cfg = sanitizeSettings(next.settings);
          applySize();
          applyLook();
          if (cfg.dock !== wasDocked) {
            // Turning docking on glides the ball to its edge, then tucks it in when idle.
            glide = true;
            tucked = false;
            clearTimeout(dockTimer);
            scheduleTuck();
          }
        }
        if ('position' in next) {
          if (phase !== 'idle') {
            deferredPosition = { value: next.position };
          } else {
            const nextPos = sanitizePosition(next.position);
            if (nextPos.x !== pos.x || nextPos.y !== pos.y) {
              glide = true; // e.g. "Reset position", or a drag in another tab
              pos = nextPos;
            }
          }
        }
        if (phase === 'idle') layout(glide);
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
        if (resizeObserver) resizeObserver.disconnect();
        clearTimeout(gesture.hold);
        clearTimeout(dockTimer);
        hideArmed();
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
    LOOKS,
    DEFAULT_POSITION,
    sanitizeSettings,
    sanitizePosition,
    travel,
    toPixels,
    toRatios,
    createBall,
  });
})();
