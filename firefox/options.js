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
  let ready = false;
  let storageRevision = 0;
  let pending = {};
  let saving = false;
  let saveAgain = false;
  let saveTimer = 0;
  let statusTimer = 0;

  function say(message) {
    statusEl.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 2500);
  }

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
      say('Couldn’t save. Try again.');
    } finally {
      saving = false;
      if (saveAgain) { saveAgain = false; save(); }
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
    f.input.disabled = true;
    f.input.min = String(f.min);
    f.input.max = String(f.max);
    f.input.step = String(f.step);
    const edit = (committed) => {
      if (!ready) return;
      const shown = Number(f.input.value);
      settings = sanitizeSettings({ ...settings, [f.key]: shown / f.scale });
      pending[f.key] = settings[f.key];
      f.out.textContent = f.text(shown);
      ball.update({ settings });
      if (committed) save();
      else saveSoon();
    };
    f.input.addEventListener('input', () => edit(false));
    f.input.addEventListener('change', () => edit(true));
  }

  byId('reset-position').addEventListener('click', async () => {
    try {
      await api.storage.local.remove(STORAGE.position);
      say('The ball is back at its starting spot.');
    } catch (_) {
      say('Couldn’t reset. Try again.');
    }
  });

  byId('reset-defaults').disabled = true;
  byId('reset-defaults').addEventListener('click', async () => {
    if (!ready) return;
    settings = sanitizeSettings();
    pending = { ...settings };
    ball.update({ settings });
    render();
    clearTimeout(saveTimer);
    await save();
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(STORAGE.settings in changes)) return;
    storageRevision++;
    settings = sanitizeSettings({ ...sanitizeSettings(changes[STORAGE.settings].newValue), ...pending });
    if (ready) { ball.update({ settings }); render(); }
  });

  (async () => {
    const revision = storageRevision;
    try {
      const stored = await api.storage.local.get(STORAGE.settings);
      if (revision === storageRevision) settings = sanitizeSettings(stored[STORAGE.settings]);
    } catch (_) {
      /* keep the defaults */
    }
    ball = createBall({ placement: 'inline', draggable: false, settings });
    ball.mount(byId('preview'));
    render();
    ready = true;
    for (const f of FIELDS) f.input.disabled = false;
    byId('reset-defaults').disabled = false;
  })();
})();
