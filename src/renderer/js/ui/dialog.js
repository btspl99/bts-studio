'use strict';
(function (BTS) {
  const U = BTS.U;
  const stack = [];

  function open({ title = '', body, buttons = [{ label: 'Close', primary: true }], width, minWidth, onClose, tabs } = {}) {
    const root = U.$('#modalRoot');
    const back = U.el('div', { class: 'backdrop' });
    const modal = U.el('div', { class: 'modal', style: { width: width ? width + 'px' : '', minWidth: minWidth ? minWidth + 'px' : '' } });
    const head = U.el('div', { class: 'modal-head' }, [title, U.el('button', { class: 'x', html: '×', title: 'Close' })]);
    const bodyEl = U.el('div', { class: 'modal-body' });
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
    const foot = U.el('div', { class: 'modal-foot' });
    let closed = false;
    const api = {
      el: modal, body: bodyEl,
      close: (result) => {
        if (closed) return; closed = true;
        back.remove(); stack.splice(stack.indexOf(api), 1);
        if (onClose) onClose(result);
      }
    };
    for (const b of buttons) {
      const btn = U.el('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), text: b.label });
      btn.onclick = async () => {
        if (b.onClick) { const r = await b.onClick(api); if (r === false) return; }
        if (b.close !== false) api.close(b.value);
      };
      foot.append(btn);
    }
    head.querySelector('.x').onclick = () => api.close();
    modal.append(head, bodyEl);
    if (buttons.length) modal.append(foot);
    back.append(modal);
    back.addEventListener('mousedown', (e) => { if (e.target === back) back._down = true; });
    back.addEventListener('mouseup', (e) => { if (e.target === back && back._down) api.close(); back._down = false; });
    root.append(back);
    stack.push(api);
    setTimeout(() => { const f = modal.querySelector('input:not([type=checkbox]):not([type=range]):not([type=color]), textarea, select'); if (f) f.focus(); }, 30);
    return api;
  }

  function confirm(message, { title = 'BTS Studio', ok = 'OK', danger = false } = {}) {
    return new Promise(res => open({ title, body: U.el('div', { style: { maxWidth: '460px', lineHeight: '1.5' }, text: message }), onClose: (v) => res(!!v), buttons: [{ label: 'Cancel', value: false }, { label: ok, primary: !danger, danger, value: true }] }));
  }

  function prompt(title, value = '', { label = '', placeholder = '' } = {}) {
    return new Promise(res => {
      const input = U.el('input', { type: 'text', value, placeholder, style: { width: '100%' } });
      const body = U.el('div', {}, [label ? U.el('div', { class: 'hint', style: { marginBottom: '6px' }, text: label }) : null, input]);
      let result = null;
      const d = open({ title, body, minWidth: 420, onClose: () => res(result), buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, onClick: () => { result = input.value; } }] });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { result = input.value; d.close(); } });
    });
  }

  function tabs(defs, opts = {}) {
    // defs: [{id,label,el,icon}] — many tabs get a searchable side navigation instead of a wrapping tab row
    const side = opts.side ?? defs.length > 6;
    const bar = U.el('div', { class: side ? 'sidenav' : 'tabs' });
    const wrap = U.el('div', { class: side ? 'sidenav-body' : '' });
    const panes = {};
    let cur = null;
    const show = (id) => { cur = id; for (const d of defs) { panes[d.id].classList.toggle('hidden', d.id !== id); bar.querySelector(`[data-t="${d.id}"]`).classList.toggle('on', d.id === id); } if (side) wrap.scrollTop = 0; };
    if (side) {
      const q = U.el('input', { type: 'search', class: 'sidenav-q', placeholder: 'Search settings…' });
      q.oninput = () => {
        const v = q.value.trim().toLowerCase(); let first = null;
        for (const d of defs) { const hit = !v || d.label.toLowerCase().includes(v) || panes[d.id].textContent.toLowerCase().includes(v); bar.querySelector(`[data-t="${d.id}"]`).classList.toggle('hidden', !hit); if (hit && !first) first = d.id; }
        if (first && bar.querySelector(`[data-t="${cur}"]`).classList.contains('hidden')) show(first);
      };
      bar.append(q);
    }
    for (const d of defs) {
      const b = U.el('button', { 'data-t': d.id, onclick: () => show(d.id) }, [...(d.icon ? [U.el('span', { class: 'ico', text: d.icon })] : []), U.el('span', { text: d.label })]);
      bar.append(b);
      panes[d.id] = U.el('div', { class: 'hidden' }, [side ? U.el('h3', { class: 'sidenav-title', text: d.label }) : '', d.el].filter(Boolean));
      wrap.append(panes[d.id]);
    }
    show(defs[0].id);
    return { el: U.el('div', { class: side ? 'sidenav-wrap' : '' }, [bar, wrap]), show };
  }

  /** Form builder: rows [{label, key, type, options, min, max, step, hint, full}] bound to obj */
  function form(rows, obj, onChange) {
    const f = U.el('div', { class: 'form' });
    for (const r of rows) {
      if (r.section) { f.append(U.el('h4', { text: r.section })); continue; }
      if (r.custom) { if (r.label) f.append(U.el('label', { text: r.label })); f.append(U.el('div', { class: r.label ? '' : 'full' }, [r.custom])); continue; }
      const get = () => U.getPath(obj, r.key);
      const set = (v) => { const parts = r.key.split('.'); let o = obj; for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] || {}; o[parts.at(-1)] = v; if (onChange) onChange(r.key, v); if (r.onChange) r.onChange(v); };
      let ctrl;
      const v = get();
      switch (r.type) {
        case 'checkbox': ctrl = U.el('input', { type: 'checkbox' }); ctrl.checked = !!v; ctrl.onchange = () => set(ctrl.checked); break;
        case 'select': ctrl = U.el('select'); for (const o of r.options) { const [val, lab] = Array.isArray(o) ? o : [o, o]; const op = U.el('option', { value: val, text: lab }); if (String(val) === String(v)) op.selected = true; ctrl.append(op); } ctrl.onchange = () => set(r.number ? +ctrl.value : ctrl.value); break;
        case 'range': {
          const inp = U.el('input', { type: 'range', min: r.min ?? 0, max: r.max ?? 1, step: r.step ?? 0.01, value: v ?? r.min ?? 0 });
          const val = U.el('span', { class: 'val', text: fmt(v, r) });
          inp.oninput = () => { set(+inp.value); val.textContent = fmt(+inp.value, r); };
          inp.ondblclick = () => { if (r.default !== undefined) { inp.value = r.default; set(r.default); val.textContent = fmt(r.default, r); } };
          ctrl = U.el('div', { class: 'inline' }, [inp, val]); break;
        }
        case 'color': ctrl = U.el('input', { type: 'color', value: v || '#000000' }); ctrl.oninput = () => set(ctrl.value); break;
        case 'number': ctrl = U.el('input', { type: 'number', value: v ?? '', min: r.min, max: r.max, step: r.step || 1, style: { width: '120px' } }); ctrl.onchange = () => set(ctrl.value === '' ? null : +ctrl.value); break;
        case 'textarea': ctrl = U.el('textarea', { rows: r.rows || 4, style: { width: '100%', fontFamily: r.mono ? 'Consolas, monospace' : '' } }); ctrl.value = v ?? ''; ctrl.onchange = () => set(ctrl.value); break;
        case 'password': ctrl = U.el('input', { type: 'password', value: v ?? '', style: { width: '100%' }, placeholder: r.placeholder || '' }); ctrl.onchange = () => set(ctrl.value); break;
        case 'file': {
          const t = U.el('input', { type: 'text', value: v ?? '', style: { flex: 1 } });
          t.onchange = () => set(t.value);
          const b = U.el('button', { class: 'btn', text: 'Browse…', onclick: async () => { const f = r.folder ? await window.bts.dialog.folder(t.value) : (await window.bts.dialog.open({ filters: r.filters, properties: ['openFile'] }) || [])[0]; if (f) { t.value = f; set(f); } } });
          ctrl = U.el('div', { class: 'inline' }, [t, b]); break;
        }
        default: ctrl = U.el('input', { type: 'text', value: v ?? '', style: { width: '100%' }, placeholder: r.placeholder || '' }); ctrl.onchange = () => set(ctrl.value);
      }
      if (r.full) { f.append(U.el('div', { class: 'full' }, [U.el('label', { text: r.label, style: { display: 'block', marginBottom: '4px' } }), ctrl])); }
      else f.append(U.el('label', { text: r.label }), ctrl);
      if (r.hint) f.append(U.el('div'), U.el('div', { class: 'hint', text: r.hint }));
    }
    return f;
  }
  function fmt(v, r) { if (r.format) return r.format(v); if (v == null) return ''; return (Math.round(v * 100) / 100).toString() + (r.unit || ''); }

  /* ---------- context menu ---------- */
  function ctxMenu(x, y, items) {
    const m = U.$('#ctxMenu');
    m.innerHTML = '';
    for (const it of items) {
      if (it === '-') { m.append(U.el('div', { class: 'sep' })); continue; }
      if (!it) continue;
      const mi = U.el('div', { class: 'mi' }, [U.el('span', { text: it.label }), it.key ? U.el('span', { class: 'k', text: it.key }) : null]);
      mi.onclick = () => { hide(); it.onClick && it.onClick(); };
      m.append(mi);
    }
    m.classList.remove('hidden');
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, innerWidth - r.width - 6) + 'px';
    m.style.top = Math.min(y, innerHeight - r.height - 6) + 'px';
    setTimeout(() => document.addEventListener('mousedown', onDoc, { once: true }), 0);
    function onDoc(e) { if (!m.contains(e.target)) hide(); else document.addEventListener('mousedown', onDoc, { once: true }); }
    function hide() { m.classList.add('hidden'); }
  }

  BTS.Dialog = { open, confirm, prompt, tabs, form, ctxMenu, get top() { return stack.at(-1); } };
})(window.BTS);
