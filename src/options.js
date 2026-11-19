/*
 * Double Tap to Refresh — options page.
 * Every change is saved straight away; open pages pick it up through storage.onChanged.
 */
(() => {
  'use strict';

  const { api, STORAGE, LIMITS, sanitizeSettings, createBall } = globalThis.DTR;
  const byId = (id) => document.getElementById(id);

  // One slider per setting. `scale` converts the stored value to the slider's units.
  const FIELDS = [
    {
      key: 'transparency', input: byId('transparency'), out: byId('transparency-out'),
      min: LIMITS.transparency.min * 100, max: LIMITS.transparency.max * 100, step: 5, scale: 100,
      text: (v) => `${v}%`,
    },
    {
      key: 'size', input: byId('size'), out: byId('size-out'),
      min: LIMITS.size.min, max: LIMITS.size.max, step: 2, scale: 1,
      text: (v) => `${v} px`,
    },
    {
      key: 'doubleTapMs', input: byId('timing'), out: byId('timing-out'),
      min: LIMITS.doubleTapMs.min, max: LIMITS.doubleTapMs.max, step: 25, scale: 1,
      text: (v) => `${v} ms`,
    },
  ];

  const statusEl = byId('status');
  let settings = sanitizeSettings();
  let ball = null;
  let saveTimer = 0;
  let statusTimer = 0;

  function say(message) {
    statusEl.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 2500);
  }

  async function save() {
    try {
      await api.storage.local.set({ [STORAGE.settings]: settings });
      say('Saved');
    } catch (_) {
      say('Couldn’t save. Try again.');
    }
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 150);
  }

  function render() {
    for (const f of FIELDS) {
      const shown = Math.round(settings[f.key] * f.scale);
      f.input.value = String(shown);
      f.out.textContent = f.text(shown);
    }
  }

  for (const f of FIELDS) {
    f.input.min = String(f.min);
    f.input.max = String(f.max);
    f.input.step = String(f.step);
    f.input.addEventListener('input', () => {
      const shown = Number(f.input.value);
      settings = sanitizeSettings({ ...settings, [f.key]: shown / f.scale });
      f.out.textContent = f.text(shown);
      ball.update({ settings });
      saveSoon();
    });
  }

  byId('reset-position').addEventListener('click', async () => {
    try {
      await api.storage.local.remove(STORAGE.position);
      say('The ball is back at its starting spot.');
    } catch (_) {
      say('Couldn’t reset. Try again.');
    }
  });

  byId('reset-defaults').addEventListener('click', async () => {
    settings = sanitizeSettings();
    ball.update({ settings });
    render();
    clearTimeout(saveTimer);
    await save();
  });

  (async () => {
    try {
      const stored = await api.storage.local.get(STORAGE.settings);
      settings = sanitizeSettings(stored[STORAGE.settings]);
    } catch (_) {
      /* keep the defaults */
    }
    ball = createBall({ placement: 'inline', draggable: false, settings });
    ball.mount(byId('preview'));
    render();
  })();
})();
