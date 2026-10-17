'use strict';
/** Command palette (Ctrl+K / Ctrl+Shift+P): fuzzy-search every action, input and API function from one box. */
(function (BTS) {
  const U = BTS.U;

  function score(q, text) {
    // subsequence match with bonuses for word starts and contiguous runs
    text = text.toLowerCase(); let s = 0, ti = 0, run = 0;
    for (const ch of q) {
      const i = text.indexOf(ch, ti); if (i < 0) return -1;
      run = i === ti ? run + 1 : 0;
      s += 1 + run * 2 + (i === 0 || /[\s\-/.:(]/.test(text[i - 1]) ? 4 : 0) - Math.min(3, (i - ti) * 0.05);
      ti = i + 1;
    }
    return s - text.length * 0.01;
  }

  function items() {
    const st = BTS.studio, ui = BTS.ui, out = [];
    const menu = (label, id, group = 'Actions', hint = '') => out.push({ label, group, hint, run: () => ui.handleMenu(id) });
    menu('Add input…', 'add-input'); menu('Settings', 'settings'); menu('Streaming settings', 'stream-settings'); menu('Recording settings', 'record-settings');
    menu('Start / stop streaming', 'toggle-stream'); menu('Start / stop recording', 'toggle-record'); menu('External output', 'external');
    menu('Title Editor — new title', 'title-designer'); menu('Data sources', 'data-sources'); menu('Telestrator', 'telestrator');
    menu('Keyboard shortcuts', 'shortcuts'); menu('Statistics', 'stats'); menu('Toggle multiview', 'toggle-multiview', 'View', 'F8'); menu('Toggle audio mixer', 'toggle-mixer', 'View', 'F9');
    menu('Pop out multiview', 'multiview-popout', 'View'); menu('New preset', 'new', 'File'); menu('Open preset…', 'open', 'File'); menu('Save preset', 'save', 'File', 'Ctrl+S'); menu('Save preset as…', 'save-as', 'File'); menu('About BTS Studio', 'about', 'Help');
    out.push({ label: 'Cut', group: 'Switching', hint: 'Enter', run: () => st.cut() }, { label: 'Quick Play (auto transition)', group: 'Switching', hint: 'Space', run: () => st.quickPlay() });
    for (const inp of st.inputs) {
      const n = `${inp.number}. ${inp.title}`;
      out.push({ label: `${n} → Preview`, group: 'Inputs', run: () => st.setPreview(inp.id) });
      out.push({ label: `${n} → Cut to Output`, group: 'Inputs', run: () => st.cut(inp.id) });
      out.push({ label: `${n} — settings`, group: 'Inputs', run: () => ui.inputSettings(inp) });
      if (inp.type === 'title') out.push({ label: `${n} — edit title`, group: 'Inputs', run: () => BTS.TitleEditor.open(inp) });
    }
    if (BTS.layout && BTS.Layout.PRESETS) for (const [p, d] of Object.entries(BTS.Layout.PRESETS || {})) out.push({ label: `Workspace: ${d.name}`, group: 'View', run: () => BTS.layout.applyPreset(p) });
    for (const f of BTS.Functions.all()) if (!f.params || !f.params.length) out.push({ label: f.name, group: 'Function · ' + (f.group || 'General'), hint: f.desc || '', run: () => BTS.Functions.call(f.name, {}).then(r => { if (!r.ok) U.toast(`${f.name}: ${r.error}`, 'error'); }) });
    return out;
  }

  let open = null;
  function show() {
    if (open) return open.q.focus();
    const all = items();
    const back = U.el('div', { class: 'cp-back' });
    const q = U.el('input', { class: 'cp-q', placeholder: 'Type a command, input or function…', spellcheck: false });
    const list = U.el('div', { class: 'cp-list' });
    const box = U.el('div', { class: 'cp-box' }, [q, list, U.el('div', { class: 'cp-foot', text: '↑↓ select · Enter run · Esc close' })]);
    back.append(box); document.body.append(back);
    let shown = [], idx = 0;
    const render = () => {
      const v = q.value.trim().toLowerCase();
      shown = v ? all.map(it => ({ it, s: score(v, it.label + ' ' + it.group) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, 60).map(x => x.it) : all.slice(0, 60);
      idx = Math.min(idx, Math.max(0, shown.length - 1));
      list.innerHTML = '';
      shown.forEach((it, i) => {
        const row = U.el('div', { class: 'cp-item' + (i === idx ? ' on' : '') }, [U.el('span', { class: 'cp-label', text: it.label }), U.el('span', { class: 'cp-group', text: it.hint || it.group })]);
        row.onmousemove = () => { if (idx !== i) { idx = i; mark(); } };
        row.onclick = () => run(i);
        list.append(row);
      });
      if (!shown.length) list.append(U.el('div', { class: 'cp-empty', text: 'No matches' }));
    };
    const mark = () => { [...list.children].forEach((c, i) => c.classList.toggle('on', i === idx)); const el = list.children[idx]; if (el) el.scrollIntoView({ block: 'nearest' }); };
    const close = () => { back.remove(); open = null; };
    const run = (i) => { const it = shown[i]; close(); if (it) try { it.run(); } catch (e) { U.toast(e.message, 'error'); } };
    q.oninput = () => { idx = 0; render(); };
    q.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(shown.length - 1, idx + 1); mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); mark(); }
      else if (e.key === 'Enter') { e.preventDefault(); run(idx); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    };
    back.onmousedown = (e) => { if (e.target === back) close(); };
    render(); q.focus();
    open = { q, close, items: () => shown };
    return open;
  }

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (k === 'k' || (e.shiftKey && k === 'p'))) { if (document.querySelector('.te-root')) return; e.preventDefault(); e.stopPropagation(); show(); }
  }, true);

  const btn = document.getElementById('btnPalette'); if (btn) btn.addEventListener('click', () => show());
  BTS.CommandPalette = { show, items, score };
})(window.BTS);
