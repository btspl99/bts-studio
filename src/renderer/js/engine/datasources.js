'use strict';
/**
 * Data sources — CSV / JSON / Google Sheets (published CSV) / plain text, local or HTTP, auto-refresh.
 * Bind columns to title fields. Row selection via UI or API (DataSourceNextRow etc.).
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
    update(id, patch) { const s = this.get(id); if (!s) return; Object.assign(s, patch); this._schedule(s); this.refresh(s); this.emit('change'); }

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
        const text = await window.bts.fetchText(url);
        let rows = [], columns = [];
        if (s.type === 'json' || (/^\s*[[{]/.test(text) && s.type !== 'csv' && s.type !== 'text')) {
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
        s.rows = rows; s.columns = columns; s.error = ''; s.lastUpdate = Date.now();
        if (s.row >= rows.length) s.row = Math.max(0, rows.length - 1);
        this.apply(s);
      } catch (e) {
        s.error = e.message;
      }
      this.emit('change', s);
    }

    apply(s) {
      const row = s.rows[s.row];
      if (!row) return;
      for (const b of s.bindings) {
        const inp = this.studio.byId(b.inputId);
        if (!inp || inp.type !== 'title' || !b.field || !b.column) continue;
        const val = row[b.column] ?? '';
        const el = inp.renderer.find(b.field);
        if (el && el.type === 'image') inp.setImage(b.field, val); else inp.setText(b.field, val);
      }
    }

    selectRow(ref, n) { const s = this.get(ref); if (!s || !s.rows.length) return false; s.row = U.clamp(n, 0, s.rows.length - 1); this.apply(s); this.emit('change', s); return true; }
    nextRow(ref) { const s = this.get(ref); return s ? this.selectRow(ref, (s.row + 1) % Math.max(1, s.rows.length)) : false; }
    prevRow(ref) { const s = this.get(ref); return s ? this.selectRow(ref, (s.row - 1 + s.rows.length) % Math.max(1, s.rows.length)) : false; }

    serialize() { return this.sources.map(s => ({ id: s.id, name: s.name, type: s.type, url: s.url, interval: s.interval, row: s.row, jsonPath: s.jsonPath, bindings: s.bindings })); }
    load(list) { this.clear(); for (const s of list || []) this.add(s); }
    clear() { for (const t of this.timers.values()) clearInterval(t); this.timers.clear(); this.sources = []; this.emit('change'); }
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
