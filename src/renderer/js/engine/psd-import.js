'use strict';
/**
 * Photoshop (.psd) → BTS title template.
 * Every visible pixel layer becomes an image element (saved as PNG in the app's assets folder);
 * every text layer becomes an editable text field that keeps its font, size, colour and alignment.
 * Layer names become field names, so data sources and the API can address them (e.g. SetText Name).
 */
(function (BTS) {
  const U = BTS.U;
  const E = BTS.Titles.newElement;
  let libP = null;
  function lib() {
    if (window.agPsd) return Promise.resolve(window.agPsd);
    if (!libP) libP = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('vendor/ag-psd/ag-psd.js', document.baseURI).href;
      s.onload = () => resolve(window.agPsd); s.onerror = () => { libP = null; reject(new Error('Could not load the PSD reader')); };
      document.head.append(s);
    });
    return libP;
  }

  const hex = (c) => c && c.r != null ? '#' + [c.r, c.g, c.b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('') : '#ffffff';
  const blobOf = (canvas) => new Promise(res => canvas.toBlob(b => res(b), 'image/png'));

  async function importPsd(file, opts = {}) {
    const ag = await lib();
    const bytes = await window.bts.media.readBinary(file);
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const psd = ag.readPsd(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), { skipThumbnail: true, skipCompositeImageData: !opts.flatten });
    const base = U.baseName(file).replace(/\.[^.]+$/, '');
    const dir = `psd/${base.replace(/[^\w.-]+/g, '_').slice(0, 40)}-${Date.now().toString(36)}`;
    const elements = [];
    const used = new Set();
    const uniq = (n) => { let name = (n || 'Layer').trim().replace(/\s+/g, ' ').slice(0, 40) || 'Layer'; let k = name, i = 2; while (used.has(k.toLowerCase())) k = `${name} ${i++}`; used.add(k.toLowerCase()); return k; };
    let n = 0, skipped = 0;

    if (opts.flatten && psd.canvas) {
      const f = await window.bts.data.writeAsset(`${dir}/flattened.png`, new Uint8Array(await (await blobOf(psd.canvas)).arrayBuffer()));
      elements.push(E({ type: 'image', name: uniq('Background'), x: 0, y: 0, w: psd.width, h: psd.height, src: f, fit: 'stretch' }));
    } else {
      // ag-psd lists children bottom → top, which is our drawing order
      const walk = async (layers, parentOpacity = 1) => {
        for (const L of layers || []) {
          if (L.hidden) { skipped++; continue; }
          const op = (L.opacity ?? 1) * parentOpacity;
          if (L.children) { await walk(L.children, op); continue; }
          const w = (L.right ?? 0) - (L.left ?? 0), h = (L.bottom ?? 0) - (L.top ?? 0);
          if (L.text && L.text.text != null) {
            const t = L.text, st = t.style || {}, ps = t.paragraphStyle || {};
            const scale = t.transform ? Math.hypot(t.transform[2] || 0, t.transform[3] || 1) : 1;
            const size = Math.max(6, Math.round((st.fontSize || 32) * scale));
            const fontName = (st.font && st.font.name) || 'Segoe UI';
            const family = fontName.replace(/MT$|PS$/, '').replace(/[-_ ]?(Regular|Roman|Bold|Black|Light|Medium|SemiBold|Semibold|Italic|BoldItalic|ExtraBold|Heavy|Thin|Book|Condensed)+$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim() || 'Segoe UI';
            const bold = /bold|black|heavy|semibold/i.test(fontName) || st.fauxBold;
            const align = ps.justification === 'center' ? 'center' : ps.justification === 'right' ? 'right' : 'left';
            const text = String(t.text).replace(/\r/g, '\n').split('\n')[0];
            elements.push(E({ type: 'text', name: uniq(L.name), x: L.left, y: L.top, w: Math.max(w, size), h: Math.max(h, size * 1.2), text, size, font: family, weight: bold ? 700 : 400, italic: /italic/i.test(fontName) || !!st.fauxItalic, color: hex(st.fillColor), align, valign: 'middle', autoFit: true, opacity: op, uppercase: !!(st.fontCaps === 2) }));
            n++; continue;
          }
          if (!L.canvas || w <= 0 || h <= 0) { skipped++; continue; }
          const blob = await blobOf(L.canvas);
          const f = await window.bts.data.writeAsset(`${dir}/${String(++n).padStart(3, '0')}-${(L.name || 'layer').replace(/[^\w.-]+/g, '_').slice(0, 40)}.png`, new Uint8Array(await blob.arrayBuffer()));
          elements.push(E({ type: 'image', name: uniq(L.name), x: L.left, y: L.top, w, h, src: f, fit: 'stretch', opacity: op }));
        }
      };
      await walk(psd.children);
    }
    if (!elements.length) throw new Error('No visible layers found in this PSD');
    return {
      template: { name: base, width: psd.width, height: psd.height, animIn: { type: 'fade', duration: 400 }, animOut: { type: 'fade', duration: 300 }, elements, source: file },
      layers: n, skipped
    };
  }

  BTS.PsdImport = { importPsd };
})(window.BTS);
