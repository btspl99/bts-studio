'use strict';
/**
 * Display outputs (vMix-style "External"): up to 6 saved full-screen outputs on extended displays.
 * Each output remembers its screen, source (Output, clean feed, Preview, Multiview 1-4, any input), fit, rotation,
 * mirroring and a region of the picture (so several screens can form one video wall).
 * The External button turns all enabled outputs on/off; outputs can start with the app and come back when a
 * screen is reconnected.
 */
(function (BTS) {
  const U = BTS.U;
  const SLOTS = 6;
  const blank = () => ({ enabled: false, screen: null, source: 'program', fit: 'contain', rotate: 0, mirror: false, region: { x: 0, y: 0, w: 1, h: 1 } });

  function cfg() {
    const s = BTS.settings;
    const d = s.displayOutputs = s.displayOutputs || { autoStart: false, reconnect: true, list: [] };
    for (let i = 0; i < SLOTS; i++) d.list[i] = { ...blank(), ...(d.list[i] || {}) };
    return d;
  }
  let saveT = null;
  function save() { clearTimeout(saveT); saveT = setTimeout(() => BTS.SettingsUI.save(), 300); }

  /** Find the saved screen among the current displays: same id, else same name + resolution, else same position. */
  function resolve(scr, displays) {
    if (!scr) return null;
    return displays.find(d => String(d.id) === String(scr.id))
      || displays.find(d => d.name === scr.name && d.bounds.width === scr.w && d.bounds.height === scr.h)
      || displays.find(d => d.bounds.x === scr.x && d.bounds.y === scr.y)
      || null;
  }
  const screenRef = (d) => d ? { id: d.id, name: d.name, w: d.bounds.width, h: d.bounds.height, x: d.bounds.x, y: d.bounds.y } : null;
  const opts = (c) => ({ fit: c.fit, rotate: +c.rotate || 0, mirror: !!c.mirror, region: c.region });

  const ui = () => BTS.ui;
  function isLive(slot) { const x = ui().externals[slot]; return !!(x && x.win && !x.win.closed); }
  function anyLive() { return ui().externals.some(x => x && x.win && !x.win.closed); }

  /** Start one saved output. Returns false when its screen is not connected. */
  async function start(slot, displays) {
    const c = cfg().list[slot];
    displays = displays || await window.bts.displays();
    const d = c.screen ? resolve(c.screen, displays) : null;
    if (c.screen && !d) return false;
    ui().openExternal(d ? String(d.id) : null, c.source, slot, opts(c));
    return true;
  }
  function stop(slot) { ui().closeExternal(slot); }

  let armed = false; // the operator turned External on (used to bring outputs back when a screen is reconnected)
  async function startAll() {
    const d = cfg(), displays = await window.bts.displays();
    const on = d.list.map((c, i) => [c, i]).filter(([c]) => c.enabled);
    if (!on.length) { BTS.SettingsUI.external(); return false; }
    armed = true;
    const missing = [];
    for (const [c, i] of on) if (!isLive(i) && !(await start(i, displays))) missing.push(`${i + 1} (${c.screen.name})`);
    if (missing.length) U.toast(`Screen not connected for output ${missing.join(', ')} — it starts automatically when the screen is plugged in.`, 'info', 8000);
    ui().updateButtons();
    return true;
  }
  function stopAll() { armed = false; for (let i = 0; i < SLOTS; i++) if (isLive(i)) stop(i); ui().updateButtons(); }
  function toggle() { return anyLive() ? stopAll() : startAll(); }

  /** Apply a changed setting to a running output immediately. */
  function apply(slot) {
    const c = cfg().list[slot], x = ui().externals[slot];
    if (!isLive(slot)) return;
    if (x.source !== c.source) ui().setExternalSource(slot, c.source);
    ui().setExternalOpts(slot, opts(c));
  }

  /** Video wall: one source spread over cols x rows screens. screens = display ids in reading order. */
  function makeWall({ source, cols, rows, screens, startSlot = 0, fit = 'stretch' }) {
    const d = cfg();
    const all = screens.map(s => s);
    let slot = startSlot;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (slot >= SLOTS) break;
      const scr = all[r * cols + c];
      d.list[slot] = { ...blank(), enabled: true, screen: screenRef(scr), source, fit, region: { x: c / cols, y: r / rows, w: 1 / cols, h: 1 / rows } };
      slot++;
    }
    save();
  }

  // screens plugged in / out
  window.bts.onDisplaysChanged && window.bts.onDisplaysChanged(async (why) => {
    if (why !== 'added' && why !== 'changed') return;
    const d = cfg();
    if (!(armed && d.reconnect)) return;
    const displays = await window.bts.displays();
    for (let i = 0; i < SLOTS; i++) {
      const c = d.list[i];
      if (c.enabled && c.screen && !isLive(i) && resolve(c.screen, displays)) { await start(i, displays); U.toast(`Output ${i + 1} is back on ${c.screen.name}`, 'ok'); }
    }
    ui().updateButtons();
  });

  /** called once the studio is up: start saved outputs when "Start with BTS Studio" is on */
  function init() { setTimeout(() => { try { if (cfg().autoStart && cfg().list.some(c => c.enabled)) startAll(); } catch (e) { console.warn('display outputs autostart', e); } }, 1500); }

  BTS.DisplayOutputs = { init, SLOTS, cfg, save, resolve, screenRef, start, stop, startAll, stopAll, toggle, apply, makeWall, isLive, anyLive, blank };
})(window.BTS);
