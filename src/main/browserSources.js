'use strict';
/**
 * HTML / Web browser sources rendered off-screen with transparency.
 * Frames are delivered to the renderer as raw BGRA bitmaps and uploaded to a WebGL texture there.
 */
const { BrowserWindow } = require('electron');
const log = require('electron-log/main');

let ctx = null;
const sources = new Map(); // id -> {win, cfg, interactive}

function init(c) { ctx = c; }

function create(id, cfg) {
  destroy(id);
  const width = Math.max(64, Math.min(3840, cfg.width || 1920));
  const height = Math.max(64, Math.min(2160, cfg.height || 1080));
  const win = new BrowserWindow({
    width, height, show: false, frame: false, transparent: true,
    backgroundColor: '#00000000', useContentSize: true,
    webPreferences: {
      offscreen: { useSharedTexture: false },
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required'
    }
  });
  win.setContentSize(width, height);
  win.webContents.setFrameRate(Math.max(1, Math.min(60, cfg.fps || 30)));
  win.webContents.setAudioMuted(!cfg.audio);
  const src = { win, cfg: { ...cfg, width, height }, lastSend: 0, busy: false };
  sources.set(id, src);

  // Back-pressure: only one frame in flight; the newest frame waits for the renderer's ack.
  const sendFrame = (image) => {
    const main = ctx.getWin();
    if (!main || main.isDestroyed()) return;
    const size = image.getSize();
    if (!size.width || !size.height) return;
    src.waiting = true; src.sentAt = Date.now();
    main.webContents.send('browser:frame', id, size.width, size.height, image.toBitmap()); // BGRA premultiplied
  };
  src.flush = () => { src.waiting = false; if (src.pending) { const img = src.pending; src.pending = null; sendFrame(img); } };
  win.webContents.on('paint', (event, dirty, image) => {
    if (src.waiting && Date.now() - src.sentAt < 1000) { src.pending = image; return; }
    src.pending = null;
    sendFrame(image);
  });
  win.webContents.on('did-finish-load', () => {
    if (src.cfg.css) win.webContents.insertCSS(src.cfg.css).catch(() => {});
    else win.webContents.insertCSS('html,body{background:transparent !important}').catch(() => {});
    win.webContents.invalidate();
    notify(id, { loaded: true, title: win.webContents.getTitle(), url: win.webContents.getURL() });
  });
  win.webContents.on('did-fail-load', (e, code, desc, url) => {
    if (code === -3) return; // aborted (navigation)
    notify(id, { error: `${desc} (${code})`, url });
  });
  win.webContents.on('render-process-gone', (e, d) => {
    log.warn(`[browser ${id}] render process gone`, d.reason);
    notify(id, { error: 'Page crashed — reloading' });
    setTimeout(() => { if (!win.isDestroyed()) win.webContents.reload(); }, 1000);
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadURL(normalise(cfg.url)).catch(err => notify(id, { error: err.message }));
  return true;
}

function normalise(url) {
  if (!url) return 'about:blank';
  if (/^(https?|file|data|about):/i.test(url)) return url;
  if (/^[a-z]:\\|^\//i.test(url)) return require('url').pathToFileURL(url).href;
  return 'https://' + url;
}

function notify(id, info) {
  const main = ctx.getWin();
  if (main && !main.isDestroyed()) main.webContents.send('browser:status', id, info);
}

function update(id, cfg) {
  const s = sources.get(id);
  if (!s) return create(id, cfg);
  const next = { ...s.cfg, ...cfg };
  if (next.width !== s.cfg.width || next.height !== s.cfg.height) return create(id, next);
  if (next.url !== s.cfg.url) s.win.loadURL(normalise(next.url));
  if (next.fps !== s.cfg.fps) s.win.webContents.setFrameRate(next.fps || 30);
  if (next.audio !== s.cfg.audio) s.win.webContents.setAudioMuted(!next.audio);
  if (next.css !== s.cfg.css && next.css) s.win.webContents.insertCSS(next.css);
  s.cfg = next;
  return true;
}

function destroy(id) {
  const s = sources.get(id);
  if (!s) return;
  sources.delete(id);
  try { if (!s.win.isDestroyed()) s.win.destroy(); } catch { /* noop */ }
}
function destroyAll() { for (const id of [...sources.keys()]) destroy(id); }

function registerIpc(ipcMain) {
  ipcMain.handle('browser:create', (e, id, cfg) => create(id, cfg));
  ipcMain.handle('browser:update', (e, id, cfg) => update(id, cfg));
  ipcMain.handle('browser:destroy', (e, id) => destroy(id));
  ipcMain.handle('browser:reload', (e, id) => { const s = sources.get(id); if (s) s.win.webContents.reloadIgnoringCache(); });
  ipcMain.handle('browser:exec', (e, id, js) => { const s = sources.get(id); return s ? s.win.webContents.executeJavaScript(js, true) : null; });
  ipcMain.handle('browser:devtools', (e, id) => { const s = sources.get(id); if (s) s.win.webContents.openDevTools({ mode: 'detach' }); });
  ipcMain.on('browser:ack', (e, id) => { const s = sources.get(id); if (s && s.flush) s.flush(); });
  ipcMain.handle('browser:input', (e, id, ev) => {
    const s = sources.get(id); if (!s) return;
    const wc = s.win.webContents;
    if (!s.focused) { s.focused = true; try { wc.focus(); } catch { /* noop */ } }
    wc.sendInputEvent(ev);
  });
  ipcMain.handle('browser:nav', (e, id, action) => {
    const s = sources.get(id); if (!s) return null;
    const wc = s.win.webContents, h = wc.navigationHistory;
    if (action === 'back' && h.canGoBack()) h.goBack();
    else if (action === 'forward' && h.canGoForward()) h.goForward();
    else if (action === 'stop') wc.stop();
    return { url: wc.getURL(), title: wc.getTitle(), canGoBack: h.canGoBack(), canGoForward: h.canGoForward() };
  });
}

module.exports = { init, registerIpc, destroyAll };
