'use strict';
/** Telestrator window — draw over the live program; strokes go to air through a Telestrator input on an overlay channel. */
(function (BTS) {
  const U = BTS.U;
  const COLORS = ['#ffde00', '#ff3b30', '#ffffff', '#00e676', '#2196f3', '#ff9100', '#e040fb', '#000000'];
  const TOOL_INFO = { pen: ['✏️', 'Pen (P)'], highlighter: ['🖍️', 'Highlighter (H)'], arrow: ['➚', 'Arrow (A)'], line: ['╱', 'Line (L)'], ellipse: ['◯', 'Circle (C)'], rect: ['▭', 'Box (B)'], spotlight: ['🔦', 'Spotlight (S)'] };
  const KEYS = { p: 'pen', h: 'highlighter', a: 'arrow', l: 'line', c: 'ellipse', b: 'rect', s: 'spotlight' };
  const state = { tool: 'arrow', color: '#ffde00', size: 8, overlay: 4 };
  let dlg = null;

  async function ensureInput() {
    const st = BTS.studio;
    let inp = st.inputs.find(i => i.type === 'telestrator');
    if (!inp) inp = await st.addInput({ type: 'telestrator', title: 'Telestrator', cfg: { fadeSeconds: 0 }, noAutoProgram: true }, { select: false });
    return inp;
  }

  async function open() {
    if (dlg) return;
    const st = BTS.studio;
    const inp = await ensureInput();
    try { const s = JSON.parse(localStorage.getItem('bts-telestrator') || '{}'); Object.assign(state, s); } catch { /* noop */ }
    const save = () => { try { localStorage.setItem('bts-telestrator', JSON.stringify(state)); } catch { /* noop */ } };

    const cv = U.el('canvas', { class: 'tele-canvas', tabindex: 0 });
    const g = cv.getContext('2d');
    const tools = U.el('div', { class: 'tele-tools' });
    const drawTools = () => {
      tools.innerHTML = '';
      for (const t of BTS.Telestrator.TOOLS) tools.append(U.el('button', { class: 'tbtn' + (state.tool === t ? ' on' : ''), text: TOOL_INFO[t][0], title: TOOL_INFO[t][1], onclick: () => { state.tool = t; save(); drawTools(); } }));
      tools.append(U.el('span', { class: 'sep' }));
      for (const c of COLORS) tools.append(U.el('button', { class: 'tele-col' + (state.color === c ? ' on' : ''), style: { background: c }, title: c, onclick: () => { state.color = c; save(); drawTools(); } }));
      const custom = U.el('input', { type: 'color', value: state.color, title: 'Custom colour' }); custom.oninput = () => { state.color = custom.value; save(); };
      tools.append(custom, U.el('span', { class: 'sep' }));
      const size = U.el('input', { type: 'range', min: 2, max: 30, value: state.size, title: 'Thickness', style: { width: '90px' } }); size.oninput = () => { state.size = +size.value; save(); };
      tools.append(U.el('span', { class: 'hint', text: 'Size' }), size, U.el('span', { class: 'sep' }),
        U.el('button', { class: 'tbtn', text: '↶ Undo', title: 'Undo (Ctrl+Z)', onclick: () => inp.undo() }),
        U.el('button', { class: 'tbtn', text: '🗑 Clear', title: 'Clear all (Delete)', onclick: () => inp.clear() }));
    };
    drawTools();

    const ovSel = U.el('select'); for (let n = 1; n <= 8; n++) ovSel.append(U.el('option', { value: n, text: 'Overlay ' + n, selected: n === state.overlay }));
    ovSel.onchange = () => { state.overlay = +ovSel.value; save(); };
    const fade = U.el('select', { title: 'Strokes disappear this long after you finish drawing them' });
    for (const [v, l] of [[0, 'Keep drawings'], [2, 'Fade after 2 s'], [4, 'Fade after 4 s'], [8, 'Fade after 8 s']]) fade.append(U.el('option', { value: v, text: l, selected: (inp.cfg.fadeSeconds || 0) === v }));
    fade.onchange = () => { inp.cfg.fadeSeconds = +fade.value; };
    const srcSel = U.el('select', { title: 'Background picture to draw on' });
    for (const [v, l] of [['program', 'Draw on Output'], ['preview', 'Draw on Preview']]) srcSel.append(U.el('option', { value: v, text: l }));
    const air = U.el('button', { class: 'btn', onclick: () => { st.overlay(state.overlay, inp.id, isOn() ? 'out' : 'in'); setTimeout(upd, 50); } });
    const isOn = () => st.overlays.some(o => o.inputId === inp.id && o.state !== 'off');
    const upd = () => { const on = isOn(); air.textContent = on ? '● ON AIR — take off' : 'Put on air'; air.classList.toggle('danger', on); air.classList.toggle('primary', !on); };
    upd();
    const offOv = st.on('overlays', upd);

    // live background + strokes
    let raf = 0;
    const loop = () => {
      if (!cv.isConnected) { if (cv._shown) return; } else cv._shown = true;
      const W = st.W, H = st.H;
      if (cv.width !== W) { cv.width = W; cv.height = H; }
      const bg = srcSel.value === 'preview' ? st.previewCanvas : st.programCanvas;
      g.drawImage(bg, 0, 0, W, H);
      // when on air the program already contains the strokes; draw them on top only when they are not in the background image
      if (!(srcSel.value === 'program' && isOn())) BTS.Telestrator.drawStrokes(g, inp.strokes, W, H, performance.now(), inp.fadeMs);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // pointer drawing
    let cur = null;
    const pt = (e) => { const r = cv.getBoundingClientRect(); return [U.clamp((e.clientX - r.left) / r.width, 0, 1), U.clamp((e.clientY - r.top) / r.height, 0, 1)]; };
    cv.addEventListener('pointerdown', (e) => {
      if (e.button === 2) { inp.undo(); return; }
      cv.focus(); try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      const [x, y] = pt(e);
      cur = inp.begin(state.tool, state.color, state.size * (e.pressure && e.pointerType === 'pen' ? 0.5 + e.pressure : 1), x, y);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!cur) return;
      const [x, y] = pt(e);
      const freehand = cur.tool === 'pen' || cur.tool === 'highlighter';
      if (freehand) { const l = cur.pts[cur.pts.length - 1]; if (Math.hypot(x - l[0], y - l[1]) < 0.002) return; }
      inp.extend(cur, x, y, !freehand);
    });
    const up = () => { if (cur) { inp.end(cur); cur = null; } };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); inp.undo(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); inp.clear(); return; }
      const t = KEYS[e.key.toLowerCase()]; if (t && !e.ctrlKey) { state.tool = t; save(); drawTools(); }
      const n = +e.key; if (n >= 1 && n <= 8) { state.color = COLORS[n - 1]; save(); drawTools(); }
    });

    const body = U.el('div', {}, [
      tools,
      cv,
      U.el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px', flexWrap: 'wrap' } }, [
        srcSel, ovSel, fade, U.el('span', { style: { flex: 1 } }),
        U.el('span', { class: 'hint', text: 'Right-click = undo · 1–8 colours · P H A L C B S tools' }), air
      ])
    ]);
    dlg = BTS.Dialog.open({ title: '✍️ Telestrator', body, width: 1180, onClose: () => { cancelAnimationFrame(raf); offOv(); dlg = null; }, buttons: [{ label: 'Close', primary: true }] });
    setTimeout(() => cv.focus(), 50);
  }

  BTS.TelestratorUI = { open, ensureInput };
})(window.BTS);
