'use strict';
/**
 * Data-file readers for title data sources (main process, no third-party dependencies):
 *  - Excel .xlsx / .xlsm and OpenDocument .ods (ZIP + XML) -> { sheets: [{ name, rows: string[][] }] }
 * Formula cells use their cached values, as Excel saved them.
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

/* ---------- minimal ZIP reader (central directory) ---------- */
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a valid .xlsx/.ods file (ZIP directory not found)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    files.set(name, { method, csize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    names: [...files.keys()],
    read(name) {
      const f = files.get(name);
      if (!f) return null;
      const lnl = buf.readUInt16LE(f.local + 26), lel = buf.readUInt16LE(f.local + 28);
      const start = f.local + 30 + lnl + lel;
      const data = buf.subarray(start, start + f.csize);
      if (f.method === 0) return data.toString('utf8');
      if (f.method === 8) return zlib.inflateRawSync(data).toString('utf8');
      throw new Error('Unsupported ZIP compression method ' + f.method);
    }
  };
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unesc = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] ?? m));
const attr = (tag, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? unesc(m[1]) : null; };
const colIndex = (ref) => { const letters = /^[A-Z]+/.exec(ref)[0]; let n = 0; for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/* ---------- XLSX ---------- */
function readXlsx(z) {
  const shared = [];
  const ss = z.read('xl/sharedStrings.xml');
  if (ss) for (const si of ss.match(/<si\b[\s\S]*?<\/si>/g) || []) shared.push(unesc((si.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join('')));
  // date styles: numFmtId 14-22 and custom formats containing d/m/y
  const styles = z.read('xl/styles.xml') || '';
  const customDate = new Set();
  for (const nf of styles.match(/<numFmt\b[^>]*>/g) || []) if (/[dmy]/i.test(attr(nf, 'formatCode') || '') && !/^\[/.test(attr(nf, 'formatCode'))) customDate.add(+attr(nf, 'numFmtId'));
  const cellXfs = /<cellXfs\b[\s\S]*?<\/cellXfs>/.exec(styles);
  const xfDate = (cellXfs ? cellXfs[0].match(/<xf\b[^>]*>/g) || [] : []).map(x => { const id = +attr(x, 'numFmtId'); return (id >= 14 && id <= 22) || customDate.has(id); });

  const wb = z.read('xl/workbook.xml') || '';
  const rels = z.read('xl/_rels/workbook.xml.rels') || '';
  const relMap = Object.fromEntries((rels.match(/<Relationship\b[^>]*>/g) || []).map(r => [attr(r, 'Id'), attr(r, 'Target')]));
  const sheets = [];
  for (const s of wb.match(/<sheet\b[^>]*>/g) || []) {
    const name = attr(s, 'name');
    const rid = attr(s, 'r:id');
    let target = relMap[rid] || '';
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const xml = z.read(target);
    if (!xml) continue;
    const rows = [];
    for (const rowM of xml.match(/<row\b[\s\S]*?(?:<\/row>|\/>)/g) || []) {
      const rIdx = +attr(rowM, 'r') - 1;
      const row = [];
      for (const c of rowM.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
        const head = /<c\b[^>]*>/.exec(c)[0];
        const ref = attr(head, 'r'); const t = attr(head, 't'); const sIdx = attr(head, 's');
        const v = /<v>([\s\S]*?)<\/v>/.exec(c);
        let val = '';
        if (t === 's') val = v ? shared[+v[1]] ?? '' : '';
        else if (t === 'inlineStr') val = unesc((c.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || []).map(x => x.replace(/<[^>]+>/g, '')).join(''));
        else if (t === 'b') val = v && v[1] === '1' ? 'TRUE' : 'FALSE';
        else if (v) {
          val = unesc(v[1]);
          if (t !== 'str' && t !== 'e' && sIdx != null && xfDate[+sIdx] && !isNaN(+val)) {
            const d = new Date(Math.round((+val - 25569) * 86400000));
            val = +val % 1 === 0 ? d.toISOString().slice(0, 10) : (+val < 1 ? d.toISOString().slice(11, 19) : d.toISOString().slice(0, 19).replace('T', ' '));
          } else if (t !== 'str' && t !== 'e' && !isNaN(+val) && /\.\d{10,}/.test(val)) val = String(+(+val).toPrecision(12));
        }
        row[ref ? colIndex(ref) : row.length] = val;
      }
      rows[isNaN(rIdx) ? rows.length : rIdx] = Array.from(row, x => x ?? '');
    }
    sheets.push({ name, rows: Array.from(rows, r => r || []) });
  }
  return sheets;
}

/* ---------- ODS ---------- */
function readOds(z) {
  const xml = z.read('content.xml');
  if (!xml) throw new Error('Not a valid .ods file');
  const sheets = [];
  for (const tbl of xml.match(/<table:table\b[\s\S]*?<\/table:table>/g) || []) {
    const name = attr(/<table:table\b[^>]*>/.exec(tbl)[0], 'table:name');
    const rows = [];
    for (const r of tbl.match(/<table:table-row\b[\s\S]*?(?:<\/table:table-row>|\/>)/g) || []) {
      const rep = Math.min(+attr(/<table:table-row\b[^>]*>/.exec(r)[0], 'table:number-rows-repeated') || 1, 1000);
      const row = [];
      for (const c of r.match(/<table:(?:covered-)?table-cell\b[^>]*?(?:\/>|>[\s\S]*?<\/table:(?:covered-)?table-cell>)/g) || []) {
        const head = /<table:(?:covered-)?table-cell\b[^>]*>/.exec(c)[0];
        const n = Math.min(+attr(head, 'table:number-columns-repeated') || 1, 200);
        const val = unesc((c.match(/<text:p\b[^>]*>[\s\S]*?<\/text:p>/g) || []).map(p => p.replace(/<text:s\/>/g, ' ').replace(/<[^>]+>/g, '')).join('\n'));
        for (let i = 0; i < n; i++) row.push(val);
      }
      while (row.length && row[row.length - 1] === '') row.pop();
      for (let i = 0; i < rep; i++) rows.push(row);
    }
    while (rows.length && !rows[rows.length - 1].length) rows.pop();
    sheets.push({ name, rows });
  }
  return sheets;
}

function readSpreadsheet(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.xls') throw new Error('Old .xls format — open it in Excel and save as .xlsx (or CSV)');
  const z = unzip(fs.readFileSync(file));
  const sheets = ext === '.ods' || z.names.includes('content.xml') && !z.names.includes('xl/workbook.xml') ? readOds(z) : readXlsx(z);
  return { sheets, mtime: fs.statSync(file).mtimeMs };
}

function registerIpc(ipcMain) {
  ipcMain.handle('data:read-sheet', (e, file) => readSpreadsheet(file));
  ipcMain.handle('data:mtime', (e, file) => { try { return fs.statSync(file).mtimeMs; } catch { return 0; } });
  // Imported graphics (e.g. PSD layers) are written under <userData>/assets only.
  ipcMain.handle('assets:write', (e, rel, data) => {
    const root = path.join(require('electron').app.getPath('userData'), 'assets');
    const file = path.normalize(path.join(root, String(rel)));
    if (!file.startsWith(root + path.sep)) throw new Error('Invalid asset path');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data));
    return file;
  });
}

module.exports = { registerIpc, readSpreadsheet, unzip };
