/*
 * Copyright (C) 2026 Sumon Kayal
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * This file is part of Double Tap to Refresh, free software under version 3 of the
 * GNU General Public License. It comes WITHOUT ANY WARRANTY. The license text is in
 * LICENSE.txt (source) and LICENSE.txt (packages), or at https://www.gnu.org/licenses/.
 */

/*
 * Double Tap to Refresh — options page.
 * Every change is saved straight away; open pages pick it up through storage.onChanged.
 * The preview is the real ball: drag it there to choose where it sits on every page.
 */
(() => {
  'use strict';

  const { api, STORAGE, LIMITS, sanitizeSettings, createBall } = globalThis.DTR;
  const byId = (id) => document.getElementById(id);

  // One slider per setting; its input and output elements share the setting's key as id.
  // `scale` converts the stored value to the slider's units.
  const SLIDERS = [
    {
      key: 'transparency', scale: 100, step: 5,
      min: LIMITS.transparency.min * 100, max: LIMITS.transparency.max * 100,
      text: (v) => `${v}%`,
    },
    {
      key: 'size', scale: 1, step: 2,
      min: LIMITS.size.min, max: LIMITS.size.max,
      text: (v) => `${v} px`,
    },
    {
      key: 'doubleTapMs', scale: 1, step: 25,
      min: LIMITS.doubleTapMs.min, max: LIMITS.doubleTapMs.max,
      text: (v) => `${v} ms`,
    },
  ].map((f) => ({ ...f, input: byId(f.key), out: byId(`${f.key}-out`) }));

  const SWITCHES = ['haptics', 'dock'].map((key) => ({ key, input: byId(key) }));
  const LOOK_INPUTS = Array.from(document.querySelectorAll('input[name="look"]'));
  const resetPosition = byId('reset-position');
  const resetDefaults = byId('reset-defaults');
  const stage = byId('stage');
  const statusEl = byId('status');
  const tapInfo = byId('tapinfo');
  const TAP_HINT = tapInfo.textContent;
  const canVibrate = typeof navigator.vibrate === 'function';

  let positionRevision = 0;
  let latestPosition;
  let settings = sanitizeSettings();
  let ball = null;
  let ready = false;
  let storageRevision = 0;
  let pending = {};
  let saving = false;
  let saveAgain = false;
  let saveTimer = 0;
  let statusTimer = 0;

  // ---- Header and footer.

  try {
    byId('version').textContent = api.runtime.getManifest().version;
  } catch (_) {
    byId('version-line').hidden = true;
  }

  if (!canVibrate) byId('haptics-help').textContent = 'This browser can’t vibrate.';

  // The license text ships inside the extension; read it the first time the section opens.
  const license = byId('license');
  let licenseLoaded = false;
  license.addEventListener('toggle', async () => {
    if (!license.open || licenseLoaded) return;
    licenseLoaded = true;
    const out = byId('license-text');
    try {
      const response = await fetch(api.runtime.getURL('LICENSE.txt'));
      if (!response.ok) throw new Error(String(response.status));
      out.textContent = await response.text();
    } catch (_) {
      licenseLoaded = false;
      out.textContent = 'Couldn’t load the license text. It ships with the extension as LICENSE.txt.';
    }
  });

  // ---- Status messages (the pill in the corner of the preview).

  function say(message, isError = false) {
    statusEl.textContent = message;
    statusEl.dataset.state = isError ? 'error' : 'ok';
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { statusEl.textContent = ''; }, isError ? 5000 : 2200);
  }

  // What the ball just measured, shown under the preview.
  function showTiming({ gap, limit, ok }) {
    tapInfo.textContent = ok
      ? `Double-tap registered: ${gap} ms between taps.`
      : `Too slow: ${gap} ms between taps (limit ${limit} ms).`;
  }

  // ---- Saving.

  async function save() {
    clearTimeout(saveTimer);
    if (saving) { saveAgain = true; return; }
    if (!Object.keys(pending).length) return;
    saving = true;
    const edits = { ...pending };
    try {
      const stored = await api.storage.local.get(STORAGE.settings);
      await api.storage.local.set({ [STORAGE.settings]: { ...stored[STORAGE.settings], ...edits } });
      for (const key of Object.keys(edits)) {
        if (pending[key] === edits[key]) delete pending[key];
      }
      say('Saved');
    } catch (_) {
      say('Couldn’t save. Try again.', true);
    } finally {
      saving = false;
      if (saveAgain) { saveAgain = false; save(); }
    }
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 150);
  }

  async function savePosition(position) {
    try {
      await api.storage.local.set({ [STORAGE.position]: position });
      say('Saved');
    } catch (_) {
      say('Couldn’t save. Try again.', true);
    }
  }

  // ---- Controls.

  function render() {
    for (const f of SLIDERS) {
      const shown = Math.round(settings[f.key] * f.scale);
      f.input.value = String(shown);
      f.out.textContent = f.text(shown);
      f.input.setAttribute('aria-valuetext', f.text(shown));
    }
    for (const s of SWITCHES) s.input.checked = settings[s.key];
    for (const r of LOOK_INPUTS) r.checked = r.value === settings.look;
  }

  function setEnabled(on) {
    for (const f of SLIDERS) f.input.disabled = !on;
    for (const s of SWITCHES) s.input.disabled = !on || (s.key === 'haptics' && !canVibrate);
    for (const r of LOOK_INPUTS) r.disabled = !on;
    resetDefaults.disabled = !on;
    resetPosition.disabled = !on;
  }

  for (const f of SLIDERS) {
    f.input.min = String(f.min);
    f.input.max = String(f.max);
    f.input.step = String(f.step);
    const edit = (committed) => {
      if (!ready) return;
      const shown = Number(f.input.value);
      settings = sanitizeSettings({ ...settings, [f.key]: shown / f.scale });
      pending[f.key] = settings[f.key];
      f.out.textContent = f.text(shown);
      f.input.setAttribute('aria-valuetext', f.text(shown));
      if (f.key === 'doubleTapMs') tapInfo.textContent = TAP_HINT; // an old reading no longer matches the limit
      ball.update({ settings });
      if (committed) save();
      else saveSoon();
    };
    f.input.addEventListener('input', () => edit(false));
    f.input.addEventListener('change', () => edit(true));
  }

  function choose(key, value) {
    if (!ready) return;
    settings = sanitizeSettings({ ...settings, [key]: value });
    pending[key] = settings[key];
    ball.update({ settings });
    save();
  }

  for (const s of SWITCHES) s.input.addEventListener('change', () => choose(s.key, s.input.checked));
  for (const r of LOOK_INPUTS) r.addEventListener('change', () => { if (r.checked) choose('look', r.value); });

  resetPosition.addEventListener('click', async () => {
    if (!ready) return;
    try {
      await api.storage.local.remove(STORAGE.position); // the preview ball glides back via onChanged
      say('Position reset');
    } catch (_) {
      say('Couldn’t reset. Try again.', true);
    }
  });

  setEnabled(false);
  resetDefaults.addEventListener('click', async () => {
    if (!ready) return;
    settings = sanitizeSettings();
    pending = { ...settings };
    tapInfo.textContent = TAP_HINT;
    ball.update({ settings });
    render();
    clearTimeout(saveTimer);
    await save();
  });

  // ---- Stay in sync with changes made elsewhere (another tab, or the ball on a page).

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (STORAGE.settings in changes) {
      storageRevision++;
      settings = sanitizeSettings({ ...sanitizeSettings(changes[STORAGE.settings].newValue), ...pending });
      if (ready) { ball.update({ settings }); render(); }
    }
    if (STORAGE.position in changes) {
      positionRevision++;
      latestPosition = changes[STORAGE.position].newValue;
      if (ready) ball.update({ position: latestPosition });
    }
  });

  (async () => {
    const revision = storageRevision;
    let position;
    const initialPositionRevision = positionRevision;
    try {
      const stored = await api.storage.local.get([STORAGE.settings, STORAGE.position]);
      if (revision === storageRevision) settings = sanitizeSettings(stored[STORAGE.settings]);
      position = initialPositionRevision === positionRevision ? stored[STORAGE.position] : latestPosition;
    } catch (_) {
      /* keep the defaults */
    }
    ball = createBall({
      placement: 'contained',
      container: stage,
      settings,
      position,
      onMoveEnd: savePosition,
      onTiming: showTiming,
    });
    ball.mount(stage);
    render();
    ready = true;
    setEnabled(true);
  })();
})();
