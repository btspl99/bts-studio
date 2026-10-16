'use strict';
/**
 * Data sources — CSV / JSON / Google Sheets / Excel (.xlsx, .ods) / XML / RSS & Atom / plain text, local or HTTP, auto-refresh.
 * Bind columns to title fields (current row, a fixed row offset, or all rows joined — e.g. RSS headlines into a ticker).
 * Row selection via UI or API (DataSourceNextRow etc.).
 */
(function (BTS) {
  const U = BTS.U;

  class DataSources extends BTS.Emitter {
    constructor(studio) {
      super();
      this.studio = studio;
      this.sources = [];
      this.timers = new Map();
    }

    add(cfg) {
      const s = Object.assign({ id: U.uid('ds'), name: 'Data Source', type: 'csv', url: '', interval: 5, row: 0, jsonPath: '', rows: [], columns: [], bindings: [], error: '', lastUpdate: 0 }, cfg);
      if (!cfg.rows) s.rows = [];
      this.sources.push(s);
      this._schedule(s);
      this.refresh(s);
      this.emit('change');
      return s;
    }
    remove(id) { const s = this.get(id); if (!s) return; clearInterval(this.timers.get(id)); this.timers.delete(id); this.sources = this.sources.filter(x => x !== s); this.emit('change'); }
    get(ref) { return this.sources.find(s => s.id === ref || s.name.toLowerCase() === String(ref).toLowerCase()) || null; }
    update(id, patch) { const s = this.get(id); if (!s) return; Object.assign(s, patch); s._mtime = 0; this._schedule(s); this.refresh(s); this.emit('change'); }

    _schedule(s) {
      clearInterval(this.timers.get(s.id));
      if (s.interval > 0 && s.url) this.timers.set(s.id, setInterval(() => this.refresh(s), Math.max(1, s.interval) * 1000));
    }

    async refresh(s) {
      if (!s.url) return;
      try {
        let url = s.url.trim();
        // Google Sheets share link -> CSV export
        const g = /docs\.google\.com\/spreadsheets\/d\/([^/]+)/.exec(url);
        if (g && !/output=csv|format=csv/.test(url)) { const gid = (/gid=(\d+)/.exec(url) || [])[1] || '0'; url = `https://docs.google.com/spreadsheets/d/${g[1]}/export?format=csv&gid=${gid}`; }
        let rows = [], columns = [];
        const isLocal = !/^https?:/i.test(url);
        if (s.type === 'excel' || (isLocal && /\.(xlsx|xlsm|ods|xls)$/i.test(url))) {
          if (isLocal) { const m = await window.bts.data.mtime(url); if (m && m === s._mtime && s.rows.length) return; s._mtime = m; }
          const book = await window.bts.data.readSheet(url);
          s.sheets = book.sheets.map(x => x.name);
          const sh = book.sheets.find(x => x.name === s.sheet) || book.sheets[0];
          if (!sh) throw new Error('Workbook has no sheets');
          const grid = sh.rows.slice(Math.max(0, (s.headerRow || 1) - 1));
          columns = (grid.shift() || []).map((c, i) => String(c).trim() || `Column${i + 1}`);
          rows = grid.filter(r => r.some(v => v !== '')).map(r => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? ''])));
        } else {
          const text = await window.bts.fetchText(url);
          if (s.type === 'xml' || s.type === 'rss' || (!s.type || s.type === 'auto') && /^\s*<(\?xml|rss|feed|[a-z])/i.test(text)) ({ rows, columns } = parseXml(text, s));
          else if (s.type === 'json' || (/^\s*[[{]/.test(text) && s.type !== 'csv' && s.type !== 'text')) {
            let data = JSON.parse(text);
            if (s.jsonPath) data = U.getPath(data, s.jsonPath);
            if (!Array.isArray(data)) data = [data];
            rows = data.map(r => (typeof r === 'object' && r ? flatten(r) : { value: r }));
            columns = [...new Set(rows.flatMap(r => Object.keys(r)))];
          } else if (s.type === 'text') {
            rows = text.split(/\r?\n/).filter(Boolean).map(l => ({ value: l }));
            columns = ['value'];
          } else {
            const csv = U.parseCSV(text);
            columns = (csv.shift() || []).map((c, i) => c.trim() || `Column${i + 1}`);
            rows = csv.map(r => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? ''])));
          }
        }
        if (s.maxRows > 0) rows = rows.slice(0, s.maxRows);
        s.rows = rows; s.columns = columns; s.error = ''; s.lastUpdate = Date.now();
        if (s.row >= rows.length) s.row = Math.max(0, rows.length - 1);
        this.apply(s);
      } catch (e) {
        s.error = e.message;
      }
      this.emit('change', s);
    }

    apply(s) {
      if (!s.rows.length) return;
      for (const b of s.bindings) {
        const inp = this.studio.byId(b.inputId);
        if (!inp || inp.type !== 'title' || !b.field || !b.column) continue;
        const el = inp.renderer.find(b.field);
        if (b.mode === 'all') {
          // every row joined: ticker items, or one multi-line text (credits, lists)
          const vals = s.rows.map(r => String(r[b.column] ?? '').trim()).filter(Boolean);
          if (el && el.type === 'ticker') { el.items = vals; inp.emit('fields'); } else inp.setText(b.field, vals.join(b.separator ?? '\n'));
          continue;
        }
        const row = s.rows[s.row + (+b.rowOffset || 0)];
        const val = row ? (row[b.column] ?? '') : '';
        if (el && el.type === 'image') inp.setImage(b.field, val);
        else if (el && el.type === 'ticker') { el.items = null; inp.setText(b.field, val); }
        else inp.setText(b.field, val);
      }
    }

    selectRow(ref, n) { const s = this.get(ref); if (!s || !s.rows.length) return false; s.row = U.clamp(n, 0, s.rows.length - 1); this.apply(s); this.emit('change', s); return true; }
    nextRow(ref) { const s = this.get(ref); return s ? this.selectRow(ref, (s.row + 1) % Math.max(1, s.rows.length)) : false; }
    prevRow(ref) { const s = this.get(ref); return s ? this.selectRow(ref, (s.row - 1 + s.rows.length) % Math.max(1, s.rows.length)) : false; }

    serialize() { return this.sources.map(s => ({ id: s.id, name: s.name, type: s.type, url: s.url, interval: s.interval, row: s.row, jsonPath: s.jsonPath, sheet: s.sheet, headerRow: s.headerRow, itemPath: s.itemPath, maxRows: s.maxRows, bindings: s.bindings })); }
    load(list) { this.clear(); for (const s of list || []) this.add(s); }
    clear() { for (const t of this.timers.values()) clearInterval(t); this.timers.clear(); this.sources = []; this.emit('change'); }
  }

  /** XML / RSS / Atom -> rows. s.itemPath: tag name or simple path of the repeating element (auto-detected for RSS/Atom). */
  function parseXml(text, s) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const err = doc.querySelector('parsererror');
    if (err) throw new Error('Invalid XML: ' + err.textContent.split('\n')[0].slice(0, 120));
    const root = doc.documentElement;
    let items;
    const path = (s.itemPath || '').trim();
    if (path) {
      if (path.startsWith('/')) { const r = doc.evaluate(path, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); items = Array.from({ length: r.snapshotLength }, (_, i) => r.snapshotItem(i)); }
      else items = [...doc.getElementsByTagName(path.split('/').pop())];
    } else if (root.nodeName === 'rss' || root.getElementsByTagName('channel').length) items = [...doc.getElementsByTagName('item')];
    else if (root.nodeName === 'feed') items = [...doc.getElementsByTagName('entry')];
    else {
      // the most frequent element name among the children of the root (or of its single child)
      let parent = root; while (parent.children.length === 1 && parent.firstElementChild.children.length) parent = parent.firstElementChild;
      const counts = {}; for (const c of parent.children) counts[c.nodeName] = (counts[c.nodeName] || 0) + 1;
      const tag = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
      items = tag ? [...parent.children].filter(c => c.nodeName === tag) : [];
    }
    const strip = (h) => { const d = document.createElement('div'); d.innerHTML = h; return (d.textContent || '').replace(/\s+/g, ' ').trim(); };
    const rows = items.map(it => {
      const r = {};
      for (const a of it.attributes || []) r['@' + a.name] = a.value;
      for (const c of it.children) {
        const name = c.nodeName.replace(/^(media|dc|content|itunes):/, (m, p) => p === 'dc' || p === 'content' ? '' : p + ':');
        let v = c.children.length && !/encoded|description|summary|content/i.test(c.nodeName) ? '' : c.textContent;
        if (c.nodeName === 'link' && c.getAttribute('href')) v = c.getAttribute('href');
        if (/^(media:(content|thumbnail)|enclosure)$/.test(c.nodeName) && c.getAttribute('url')) { r.image = r.image || c.getAttribute('url'); continue; }
        if (/description|summary|encoded|content/i.test(c.nodeName)) { const img = /<img[^>]+src="([^"]+)"/i.exec(v); if (img && !r.image) r.image = img[1]; v = strip(v); }
        if (!(name in r)) r[name] = (v || '').trim();
        for (const a of c.attributes || []) if (!(`${name}@${a.name}` in r)) r[`${name}@${a.name}`] = a.value;
      }
      if (!it.children.length && it.textContent.trim()) r.value = it.textContent.trim();
      if (r.pubDate || r.published || r.updated) { const d = new Date(r.pubDate || r.published || r.updated); if (!isNaN(d)) r.time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
      return r;
    });
    const columns = [...new Set(rows.flatMap(r => Object.keys(r)))];
    return { rows, columns };
  }

  function flatten(obj, prefix = '', out = {}) {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
      else out[key] = Array.isArray(v) ? v.join(', ') : v;
    }
    return out;
  }

  BTS.DataSources = DataSources;
})(window.BTS);
