'use strict';
/** Title Designer — visual editor for title templates (text, shapes, images, clocks, countdowns, tickers). */
(function (BTS) {
  const U = BTS.U;

  function open(inp) {
    const st = BTS.studio;
    const tpl = U.deepClone(inp ? inp.renderer.t : BTS.Titles.TEMPLATES.blank());
    const r = new BTS.Titles.TitleRenderer(tpl);
    let sel = tpl.elements.at(-1)?.id || null;
    let drag = null;
    const snap = { on: true, grid: 10 };

    const stage = U.el('canvas', { width: tpl.width, height: tpl.height });
    const sctx = stage.getContext('2d');
    const list = U.el('div', { class: 'list', style: { maxHeight: 'none', flex: 1 } });
    const props = U.el('div', { class: 'td-panel' });
    const addBar = U.el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginBottom: '8px' } });
    const left = U.el('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0 } }, [U.el('div', { class: 'hint', text: 'ADD ELEMENT', style: { marginBottom: '4px' } }), addBar, U.el('div', { class: 'hint', text: 'LAYERS (top = front)', style: { margin: '6px 0 4px' } }), list]);
    const wrap = U.el('div', { class: 'td-wrap' }, [left, U.el('div', { class: 'td-stage' }, [stage]), props]);

    const B = BTS.Titles.BASE_TEXT;
    const adders = {
      Text: () => ({ type: 'text', name: 'Text' + (tpl.elements.length + 1), x: 200, y: 200, w: 800, h: 90, text: 'New text', size: 56, ...B }),
      Rectangle: () => ({ type: 'rect', name: 'Box' + (tpl.elements.length + 1), x: 160, y: 180, w: 900, h: 130, fill: '#14161b', radius: 8, opacity: 0.95 }),
      Image: () => ({ type: 'image', name: 'Logo' + (tpl.elements.length + 1), x: 100, y: 100, w: 240, h: 240, src: '', fit: 'contain' }),
      Clock: () => ({ type: 'clock', name: 'Clock', x: 1600, y: 60, w: 260, h: 70, format: 'HH:mm:ss', size: 40, ...B, align: 'center' }),
      Countdown: () => ({ type: 'countdown', name: 'Timer', x: 760, y: 440, w: 400, h: 200, seconds: 60, size: 150, ...B, align: 'center' }),
      Ticker: () => ({ type: 'ticker', name: 'Ticker', x: 0, y: 1000, w: 1920, h: 60, text: 'Ticker text • more news', speed: 140, size: 32, ...B, weight: 500 })
    };
    for (const [label, mk] of Object.entries(adders)) addBar.append(U.el('button', { class: 'btn', text: '＋ ' + label, onclick: () => { const e = BTS.Titles.newElement(mk()); tpl.elements.push(e); sel = e.id; r.setTemplate(tpl); refresh(); } }));

    const selected = () => tpl.elements.find(e => e.id === sel);

    function refreshList() {
      list.innerHTML = '';
      [...tpl.elements].reverse().forEach((e) => {
        const idx = tpl.elements.indexOf(e);
        const ico = { text: 'T', rect: '▭', image: '🖼', clock: '🕒', countdown: '⏱', ticker: '⇆' }[e.type];
        const li = U.el('div', { class: 'li' + (e.id === sel ? ' on' : ''), style: { cursor: 'pointer' } }, [
          U.el('span', { text: ico }), U.el('span', { class: 'grow', text: e.name }),
          U.el('button', { class: 'tbtn small', title: e.hidden ? 'Show' : 'Hide', text: e.hidden ? '◌' : '●', onclick: (ev) => { ev.stopPropagation(); e.hidden = !e.hidden; refreshList(); } }),
          U.el('button', { class: 'tbtn small', text: '▲', title: 'Bring forward', onclick: (ev) => { ev.stopPropagation(); if (idx < tpl.elements.length - 1) { [tpl.elements[idx], tpl.elements[idx + 1]] = [tpl.elements[idx + 1], tpl.elements[idx]]; refreshList(); } } }),
          U.el('button', { class: 'tbtn small', text: '▼', title: 'Send backward', onclick: (ev) => { ev.stopPropagation(); if (idx > 0) { [tpl.elements[idx], tpl.elements[idx - 1]] = [tpl.elements[idx - 1], tpl.elements[idx]]; refreshList(); } } })
        ]);
        li.onclick = () => { sel = e.id; refresh(); };
        list.append(li);
      });
    }

    function refreshProps() {
      props.innerHTML = '';
      const e = selected();
      const fonts = ['Segoe UI', 'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Consolas', 'Georgia', 'Impact', 'Tahoma', 'Trebuchet MS', 'Verdana', 'Roboto', 'Montserrat', 'Poppins', 'Oswald', 'Nirmala UI', 'Mangal'];
      if (e) {
        const rows = [{ section: e.type.toUpperCase() }, { label: 'Name', key: 'name', hint: 'Used by SetText / data binding', onChange: refreshList },
          { label: 'X', key: 'x', type: 'number' }, { label: 'Y', key: 'y', type: 'number' }, { label: 'Width', key: 'w', type: 'number' }, { label: 'Height', key: 'h', type: 'number' },
          { label: 'Opacity', key: 'opacity', type: 'range', min: 0, max: 1, step: 0.01, default: 1 }, { label: 'Anim delay', key: 'delay', type: 'number', unit: 'ms' }];
        if (e.type === 'rect') rows.push({ label: 'Fill', key: 'fill', type: 'color' }, { label: 'Gradient to', key: 'fill2', type: 'color' }, { custom: U.el('button', { class: 'btn', text: 'No gradient', onclick: () => { e.fill2 = null; } }) }, { label: 'Radius', key: 'radius', type: 'number' }, { label: 'Stroke', key: 'stroke', type: 'color' }, { label: 'Stroke width', key: 'strokeWidth', type: 'number' });
        if (['text', 'clock', 'countdown', 'ticker'].includes(e.type)) {
          if (e.type === 'text' || e.type === 'ticker') rows.push({ label: 'Text', key: 'text', type: 'textarea', rows: 2 });
          if (e.type === 'clock') rows.push({ label: 'Format', key: 'format', hint: 'HH mm ss hh A dd MM yyyy' });
          if (e.type === 'countdown') rows.push({ label: 'Seconds', key: 'seconds', type: 'number', onChange: (v) => r.setTimer(e, v) }, { label: 'Count up', key: 'countUp', type: 'checkbox' });
          if (e.type === 'ticker') rows.push({ label: 'Speed px/s', key: 'speed', type: 'number' });
          rows.push({ label: 'Font', key: 'font', type: 'select', options: fonts }, { label: 'Size', key: 'size', type: 'number' }, { label: 'Weight', key: 'weight', type: 'select', number: true, options: [[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']] },
            { label: 'Italic', key: 'italic', type: 'checkbox' }, { label: 'Colour', key: 'color', type: 'color' }, { label: 'Align', key: 'align', type: 'select', options: ['left', 'center', 'right'] }, { label: 'V-align', key: 'valign', type: 'select', options: ['top', 'middle', 'bottom'] },
            { label: 'UPPERCASE', key: 'uppercase', type: 'checkbox' }, { label: 'Auto-fit', key: 'autoFit', type: 'checkbox' }, { label: 'Shadow', key: 'shadow', type: 'checkbox' }, { label: 'Outline', key: 'stroke', type: 'color' }, { label: 'Outline width', key: 'strokeWidth', type: 'number' });
        }
        if (e.type === 'image') rows.push({ label: 'Image', key: 'src', type: 'file', filters: [{ name: 'Images', extensions: U.IMAGE_EXT }] }, { label: 'Fit', key: 'fit', type: 'select', options: ['contain', 'cover', 'stretch'] }, { label: 'Radius', key: 'radius', type: 'number' });
        props.append(BTS.Dialog.form(rows, e), U.el('div', { class: 'inline', style: { margin: '10px 0' } }, [
          U.el('button', { class: 'btn', text: 'Duplicate', onclick: () => { const c = BTS.Titles.newElement({ ...U.deepClone(e), id: undefined, name: e.name + ' copy', x: e.x + 20, y: e.y + 20 }); tpl.elements.push(c); sel = c.id; r.setTemplate(tpl); refresh(); } }),
          U.el('button', { class: 'btn danger', text: 'Delete', onclick: () => { tpl.elements = tpl.elements.filter(x => x !== e); sel = tpl.elements.at(-1)?.id; r.setTemplate(tpl); refresh(); } })
        ]));
      }
      const anim = [['none', 'None'], ['fade', 'Fade'], ['slide-left', 'Slide from left'], ['slide-right', 'Slide from right'], ['slide-up', 'Slide up'], ['slide-down', 'Slide down'], ['wipe', 'Wipe'], ['zoom', 'Zoom']];
      props.append(BTS.Dialog.form([{ section: 'Title' }, { label: 'Name', key: 'name' },
        { label: 'Anim in', key: 'animIn.type', type: 'select', options: anim }, { label: 'In ms', key: 'animIn.duration', type: 'number' },
        { label: 'Anim out', key: 'animOut.type', type: 'select', options: anim }, { label: 'Out ms', key: 'animOut.duration', type: 'number' },
        { custom: U.el('div', { class: 'inline' }, [U.el('button', { class: 'btn', text: '▶ Preview in', onclick: () => r.transitionIn() }), U.el('button', { class: 'btn', text: '◀ Preview out', onclick: () => r.transitionOut() })]) }
      ], tpl), BTS.Dialog.form([{ label: 'Snap to grid', key: 'on', type: 'checkbox' }], snap));
    }

    function refresh() { refreshList(); refreshProps(); }

    let raf;
    const loop = () => {
      const now = performance.now();
      const anim = r.animDir !== 0;
      const c = r.render(now, !anim);
      sctx.clearRect(0, 0, stage.width, stage.height);
      sctx.drawImage(c, 0, 0);
      // safe area
      sctx.strokeStyle = 'rgba(255,255,255,.18)'; sctx.setLineDash([10, 10]); sctx.lineWidth = 2;
      sctx.strokeRect(stage.width * 0.05, stage.height * 0.05, stage.width * 0.9, stage.height * 0.9);
      sctx.setLineDash([]);
      const e = selected();
      if (e && !anim) {
        sctx.strokeStyle = '#f0a53a'; sctx.lineWidth = 3; sctx.strokeRect(e.x, e.y, e.w, e.h);
        sctx.fillStyle = '#f0a53a'; sctx.fillRect(e.x + e.w - 10, e.y + e.h - 10, 20, 20);
      }
      raf = requestAnimationFrame(loop);
    };
    loop();

    const toStage = (ev) => { const b = stage.getBoundingClientRect(); return { x: (ev.clientX - b.left) * stage.width / b.width, y: (ev.clientY - b.top) * stage.height / b.height }; };
    const snapV = (v) => (snap.on ? Math.round(v / snap.grid) * snap.grid : Math.round(v));
    stage.addEventListener('mousedown', (ev) => {
      const p = toStage(ev);
      const e = selected();
      if (e && Math.abs(p.x - (e.x + e.w)) < 18 && Math.abs(p.y - (e.y + e.h)) < 18) { drag = { mode: 'resize', e, ox: p.x, oy: p.y, w: e.w, h: e.h }; return; }
      const hit = [...tpl.elements].reverse().find(x => !x.hidden && p.x >= x.x && p.x <= x.x + x.w && p.y >= x.y && p.y <= x.y + x.h);
      if (hit) { sel = hit.id; drag = { mode: 'move', e: hit, ox: p.x, oy: p.y, x: hit.x, y: hit.y }; refresh(); }
    });
    const onMove = (ev) => {
      if (!drag) return;
      const p = toStage(ev);
      if (drag.mode === 'move') { drag.e.x = snapV(drag.x + p.x - drag.ox); drag.e.y = snapV(drag.y + p.y - drag.oy); }
      else { drag.e.w = Math.max(10, snapV(drag.w + p.x - drag.ox)); drag.e.h = Math.max(10, snapV(drag.h + p.y - drag.oy)); }
    };
    const onUp = () => { if (drag) { drag = null; refreshProps(); } };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    const onKey = (ev) => {
      const e = selected(); if (!e || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      const d = ev.shiftKey ? 10 : 1;
      if (ev.key === 'ArrowLeft') e.x -= d; else if (ev.key === 'ArrowRight') e.x += d; else if (ev.key === 'ArrowUp') e.y -= d; else if (ev.key === 'ArrowDown') e.y += d;
      else if (ev.key === 'Delete') { tpl.elements = tpl.elements.filter(x => x !== e); sel = null; refresh(); } else return;
      ev.preventDefault(); ev.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);

    refresh();
    BTS.Dialog.open({
      title: 'Title Designer' + (inp ? ` — ${inp.title}` : ''), body: wrap,
      onClose: () => { cancelAnimationFrame(raf); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); window.removeEventListener('keydown', onKey, true); },
      buttons: [
        { label: 'Load template…', close: false, onClick: async () => { const f = await window.bts.dialog.open({ filters: [{ name: 'BTS Title', extensions: ['btstitle', 'json'] }] }); if (!f) return false; try { const t = JSON.parse(await window.bts.file.readText(f[0])); Object.keys(tpl).forEach(k => delete tpl[k]); Object.assign(tpl, t); r.setTemplate(tpl); sel = null; refresh(); } catch (e) { U.toast('Invalid template: ' + e.message, 'error'); } return false; } },
        { label: 'Save template as…', close: false, onClick: async () => { const f = await window.bts.dialog.save({ defaultPath: (tpl.name || 'title') + '.btstitle', filters: [{ name: 'BTS Title', extensions: ['btstitle'] }] }); if (f) { await window.bts.project.write(f, tpl); U.toast('Template saved', 'ok'); } return false; } },
        { label: 'Cancel' },
        { label: inp ? 'Apply to input' : 'Create title input', primary: true, onClick: async () => {
          if (inp) { inp.cfg.template = tpl; await inp.init(); inp.emit('fields'); U.toast('Title updated', 'ok'); }
          else await st.addInput({ type: 'title', title: tpl.name || 'Title', cfg: { template: tpl } });
        } }
      ]
    });
  }

  BTS.TitleDesigner = { open };
})(window.BTS);
