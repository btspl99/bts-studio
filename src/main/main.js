'use strict';
/**
 * BTS Studio — main process
 * Responsibilities: windows, menus, settings/project storage, FFmpeg outputs,
 * HTML browser sources, HTTP control API, auto-update.
 */
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, screen, desktopCapturer, session, nativeTheme, powerSaveBlocker } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const log = require('electron-log/main');
const pendingOutputDisplays = []; // display ids for external-output windows being created
const outputWindows = new Map();   // output window -> display id
// Last-resort guards: a stray pipe/socket error in one output or API client must never take down a live show.
process.on('uncaughtException', (err) => { try { log.error('Uncaught exception (kept running)', err && err.stack || err); } catch { /* noop */ } });
process.on('unhandledRejection', (err) => { try { log.warn('Unhandled rejection', err && err.stack || err); } catch { /* noop */ } });

const outputs = require('./outputs');
const browserSources = require('./browserSources');
const api = require('./api');
const updater = require('./updater');
const streamInputs = require('./streamInputs');
const replay = require('./replay');
const media = require('./media');
const guests = require('./guests');
const dataFiles = require('./dataFiles');
const ptz = require('./ptz');
const ndi = require('./ndi');
const vcam = require('./vcam');
const decklinkKeyer = require('./decklinkKeyer');

log.initialize();
log.transports.file.level = 'info';
Object.assign(console, log.functions);

const isDev = process.argv.includes('--dev');
const ROOT = path.join(__dirname, '..');
const USER = app.getPath('userData');
const SETTINGS_FILE = path.join(USER, 'settings.json');
const RECENT_FILE = path.join(USER, 'recent.json');

// GPU / media friendly switches
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('force-color-profile', 'srgb');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCEncoderSupport,MediaRecorderEnableMp4Muxer,CanvasOopRasterization');
// Prefer the discrete GPU on dual-GPU laptops, never throttle when covered by other windows
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('max-active-webgl-contexts', '32');
{
  const early = readJSON(SETTINGS_FILE, {});
  const disable = ['CalculateNativeWinOcclusion', 'HardwareMediaKeyHandling'];
  // DirectShow capture backend: needed for Blackmagic DeckLink / UltraStudio and some older capture cards
  if (early.capture && early.capture.backend === 'directshow') disable.push('MediaFoundationVideoCapture');
  app.commandLine.appendSwitch('disable-features', disable.join(','));
  if (early.performance && early.performance.disableGpu) app.disableHardwareAcceleration();
}
if (process.platform === 'linux' && process.getuid && process.getuid() === 0) app.commandLine.appendSwitch('no-sandbox');

let mainWin = null;
let pendingOpenFile = null;
let psbId = null;

// ---------- settings ----------
const DEFAULT_SETTINGS = {
  video: { width: 1920, height: 1080, fps: 30 },
  audio: { sampleRate: 48000, masterDelayMs: 0 },
  stream: {
    destinations: [
      { enabled: true, name: 'Destination 1', service: 'youtube', url: 'rtmp://a.rtmp.youtube.com/live2', key: '' },
      { enabled: false, name: 'Destination 2', service: 'facebook', url: 'rtmps://live-api-s.facebook.com:443/rtmp/', key: '' },
      { enabled: false, name: 'Destination 3', service: 'custom', url: '', key: '' },
      { enabled: false, name: 'Destination 4', service: 'custom', url: '', key: '' },
      { enabled: false, name: 'Destination 5', service: 'custom', url: '', key: '' }
    ],
    encoder: 'gpu', preset: 'veryfast', videoBitrate: 6000, audioBitrate: 160, keyint: 2, resolution: 'program',
    autoReconnect: true
  },
  record: {
    folder: '', format: 'mp4', mode: 'passthrough', encoder: 'gpu', quality: 'high', rateControl: 'quality', videoBitrate: 40000, audioCodec: 'aac',
    filenamePattern: 'BTS-Studio-{date}-{time}'
  },
  record2: { enabled: false, format: 'mkv', mode: 'encode', encoder: 'gpu', quality: 'medium', rateControl: 'quality', videoBitrate: 12000, suffix: '-2' },
  encoding: { engine: 'v2', hardware: 'auto', migrated: 0 },
  decklink: { ffmpeg: '', outputs: [] },
  api: { enabled: true, port: 8088, allowRemote: true, tcpEnabled: true, tcpPort: 8099, user: '', password: '', tallyOpen: true },
  guests: { port: 8089, stun: 'stun:stun.l.google.com:19302', turn: '', turnUser: '', turnPass: '' },
  media: { autoConvert: true, convertQuality: 'fast' },
  updates: { autoCheck: true, url: '' },
  ui: { theme: 'dark', showMultiview: true, tbarReverse: false },
  shortcuts: null,
  capture: { backend: 'mediafoundation' },
  performance: { governor: true, thumbnailFps: 10, disableGpu: false },
  midi: { enabled: true, mappings: [] }
};

function deepMerge(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
  return out;
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

let settings = deepMerge(DEFAULT_SETTINGS, readJSON(SETTINGS_FILE, {}));
// older settings files had 3 stream destinations — pad to 5
// 1.4 migration: switch the default software encoder to the shared GPU engine (choices of a hardware encoder are kept)
if (!settings.encoding.migrated) {
  if (settings.stream.encoder === 'libx264') settings.stream.encoder = 'gpu';
  if (settings.record.encoder === 'libx264') settings.record.encoder = 'gpu';
  if (settings.record2.encoder === 'libx264') settings.record2.encoder = 'gpu';
  if ((settings.record.videoBitrate || 0) < 40000) settings.record.videoBitrate = 40000;
  settings.encoding.migrated = 1;
}
while (settings.stream.destinations.length < 5) settings.stream.destinations.push({ enabled: false, name: 'Destination ' + (settings.stream.destinations.length + 1), service: 'custom', url: '', key: '' });
if (!settings.record.folder) settings.record.folder = path.join(app.getPath('videos'), 'BTS Studio');

function saveSettings() { writeJSON(SETTINGS_FILE, settings); }

function getRecent() { return readJSON(RECENT_FILE, []).filter(f => fs.existsSync(f)).slice(0, 10); }
function addRecent(file) {
  const list = [file, ...getRecent().filter(f => f !== file)].slice(0, 10);
  writeJSON(RECENT_FILE, list);
  buildMenu();
}

// ---------- window ----------
function createMainWindow() {
  nativeTheme.themeSource = 'dark';
  mainWin = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1180, minHeight: 720,
    backgroundColor: '#1b1c1f',
    title: 'BTS Studio',
    icon: path.join(ROOT, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      webSecurity: true,
      spellcheck: false
    }
  });

  mainWin.webContents.setWindowOpenHandler(({ url, frameName, features }) => {
    // Pop-out windows (external output, multiview) share the renderer process so they can receive MediaStreams.
    if (url.startsWith('file:') || url === 'about:blank') {
      const params = new URL(url, 'file://x/').searchParams;
      const displayId = params.get('display');
      const d = screen.getAllDisplays().find(x => String(x.id) === String(displayId)) || null;
      const opts = {
        backgroundColor: '#000000',
        autoHideMenuBar: true,
        title: /^external/.test(frameName) ? 'BTS Studio — External Output' : 'BTS Studio — ' + (frameName || 'Window'),
        icon: path.join(ROOT, '..', 'build', 'icon.png'),
        webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
      };
      // Full-screen outputs: create a frameless window exactly on the chosen monitor. Do NOT pass fullscreen:true here —
      // on Windows that makes the window go full screen on the monitor it was first created on (usually the control screen).
      if (d) Object.assign(opts, { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, frame: false, show: false, resizable: false, movable: false,
        minimizable: false, maximizable: false, skipTaskbar: true, hasShadow: false, roundedCorners: false, thickFrame: false, enableLargerThanScreen: true, fullscreenable: true });
      else Object.assign(opts, { width: 960, height: 560 });
      if (d) pendingOutputDisplays.push(d.id);
      return { action: 'allow', overrideBrowserWindowOptions: opts };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWin.webContents.on('did-create-window', (win, { frameName }) => {
    if (!/^external/.test(frameName || '')) return;
    const id = pendingOutputDisplays.shift();
    if (id == null) return;
    const place = () => {
      const d = screen.getAllDisplays().find(x => x.id === id);
      if (!d || win.isDestroyed()) return;
      win.setBounds(d.bounds);
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setFullScreen(true);
      win.setBounds(d.bounds); // re-assert after the full-screen switch (mixed-DPI monitors)
    };
    win.once('ready-to-show', () => { place(); win.showInactive(); });
    setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) { place(); win.showInactive(); } }, 1500);
    outputWindows.set(win, id);
    win.on('closed', () => outputWindows.delete(win));
  });

  mainWin.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });

  mainWin.loadFile(path.join(ROOT, 'renderer', 'index.html'));

  // ---- crash resilience ----
  let crashes = 0;
  mainWin.webContents.on('render-process-gone', (e, details) => {
    log.error('Renderer gone', details);
    if (details.reason === 'clean-exit' || !mainWin || mainWin.isDestroyed()) return;
    outputs.stopAll();
    browserSources.destroyAll();
    streamInputs.stopAll(); replay.stopAll();
    crashes++;
    if (crashes > 5) { dialog.showErrorBox('BTS Studio', 'The production engine keeps stopping. Please check your graphics drivers, then restart BTS Studio.'); return; }
    setTimeout(() => { if (mainWin && !mainWin.isDestroyed()) mainWin.loadFile(path.join(ROOT, 'renderer', 'index.html'), { query: { recover: '1', reason: details.reason } }); }, 800);
  });
  let hangTimer = null;
  mainWin.on('unresponsive', () => {
    log.warn('Main window unresponsive');
    clearTimeout(hangTimer);
    hangTimer = setTimeout(async () => {
      if (!mainWin || mainWin.isDestroyed()) return;
      const r = await dialog.showMessageBox(mainWin, { type: 'warning', buttons: ['Keep waiting', 'Reload engine'], defaultId: 0, title: 'BTS Studio', message: 'BTS Studio is not responding.', detail: 'Your session is autosaved. Reloading restores the last autosave.' });
      if (r.response === 1) { outputs.stopAll(); browserSources.destroyAll(); mainWin.loadFile(path.join(ROOT, 'renderer', 'index.html'), { query: { recover: '1', reason: 'hang' } }); }
    }, 8000);
  });
  mainWin.on('responsive', () => clearTimeout(hangTimer));
  mainWin.once('ready-to-show', () => {
    mainWin.maximize();
    mainWin.show();
    if (isDev) mainWin.webContents.openDevTools({ mode: 'detach' });
  });

  mainWin.on('close', async (e) => {
    if (mainWin.__forceClose) return;
    if (outputs.anyActive()) {
      e.preventDefault();
      const r = await dialog.showMessageBox(mainWin, {
        type: 'warning', buttons: ['Stop outputs and exit', 'Cancel'], defaultId: 1, cancelId: 1,
        title: 'BTS Studio', message: 'Streaming or recording is still running.', detail: 'Exiting now will stop all active outputs.'
      });
      if (r.response === 0) { outputs.stopAll(); mainWin.__forceClose = true; setTimeout(() => mainWin && mainWin.close(), 600); }
      return;
    }
  });
  mainWin.on('closed', () => { mainWin = null; browserSources.destroyAll(); outputs.stopAll(); streamInputs.stopAll(); ndi.stopAll(); vcam.stop(); decklinkKeyer.stopAll(); replay.stopAll(); });

  outputs.init({ getWin: () => mainWin, getSettings: () => settings, resourcesPath: process.resourcesPath, isPackaged: app.isPackaged, root: path.join(ROOT, '..') });
  browserSources.init({ getWin: () => mainWin });
  streamInputs.init({ getWin: () => mainWin, getSettings: () => settings });
  ndi.init({ getWin: () => mainWin, getSettings: () => settings });
  vcam.init({ getWin: () => mainWin, resourcesPath: process.resourcesPath, isPackaged: app.isPackaged, root: path.join(ROOT, '..') });
  decklinkKeyer.init({ getWin: () => mainWin, resourcesPath: process.resourcesPath, isPackaged: app.isPackaged, root: path.join(ROOT, '..') });
  replay.init({ getWin: () => mainWin, getSettings: () => settings });
  media.init({ getWin: () => mainWin });
  guests.init({ getWin: () => mainWin, getSettings: () => settings, saveSettings, webRoot: path.join(ROOT, 'web') });
  updater.init({ getWin: () => mainWin, getSettings: () => settings, isPackaged: app.isPackaged });
  restartApi();
}

function restartApi() {
  api.stop();
  if (settings.api.enabled) {
    api.start({
      port: settings.api.port, allowRemote: settings.api.allowRemote, tcpPort: settings.api.tcpEnabled === false ? 0 : (settings.api.tcpPort || 8099), getWin: () => mainWin,
      user: settings.api.user || '', password: settings.api.password || '', tallyOpen: settings.api.tallyOpen !== false,
      webRoot: path.join(ROOT, 'web')
    }).catch(err => log.error('API start failed', err));
  }
}

function send(channel, payload) { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload); }

// ---------- menu ----------
function buildMenu() {
  const recent = getRecent();
  const m = (id) => () => send('menu', id);
  const template = [
    {
      label: 'File', submenu: [
        { label: 'New Preset', accelerator: 'CmdOrCtrl+N', click: m('new') },
        { label: 'Open Preset…', accelerator: 'CmdOrCtrl+O', click: m('open') },
        { label: 'Open Recent', submenu: recent.length ? recent.map(f => ({ label: f, click: () => send('menu', { id: 'open-file', file: f }) })) : [{ label: 'No recent presets', enabled: false }] },
        { type: 'separator' },
        { label: 'Save Preset', accelerator: 'CmdOrCtrl+S', click: m('save') },
        { label: 'Save Preset As…', accelerator: 'CmdOrCtrl+Shift+S', click: m('save-as') },
        { label: 'Save Preset Bundle (with media)…', click: m('save-bundle') },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: m('settings') },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' }
      ]
    },
    {
      label: 'Inputs', submenu: [
        { label: 'Add Input…', accelerator: 'CmdOrCtrl+I', click: m('add-input') },
        { label: 'Camera / Capture Card', click: () => send('menu', { id: 'add-input', type: 'camera' }) },
        { label: 'Screen / Window Capture', click: () => send('menu', { id: 'add-input', type: 'screen' }) },
        { label: 'Video / Audio File', click: () => send('menu', { id: 'add-input', type: 'video' }) },
        { label: 'Image', click: () => send('menu', { id: 'add-input', type: 'image' }) },
        { label: 'Playlist (List)', click: () => send('menu', { id: 'add-input', type: 'playlist' }) },
        { label: 'Web Browser / HTML Overlay', click: () => send('menu', { id: 'add-input', type: 'browser' }) },
        { label: 'Title / Scoreboard', click: () => send('menu', { id: 'add-input', type: 'title' }) },
        { label: 'Colour / Bars', click: () => send('menu', { id: 'add-input', type: 'color' }) },
        { label: 'Scene (Layers)', click: () => send('menu', { id: 'add-input', type: 'scene' }) },
        { label: 'Audio Device', click: () => send('menu', { id: 'add-input', type: 'audio' }) }
      ]
    },
    {
      label: 'Output', submenu: [
        { label: 'Stream Settings…', click: m('stream-settings') },
        { label: 'Start / Stop Streaming', accelerator: 'CmdOrCtrl+Shift+L', click: m('toggle-stream') },
        { label: 'Record Settings…', click: m('record-settings') },
        { label: 'Start / Stop Recording', accelerator: 'CmdOrCtrl+Shift+R', click: m('toggle-record') },
        { type: 'separator' },
        { label: 'External Output (Fullscreen)…', click: m('external') },
        { label: 'Pop-out Multiview', click: m('multiview-popout') },
        { label: 'Open Recordings Folder', click: () => { fs.mkdirSync(settings.record.folder, { recursive: true }); shell.openPath(settings.record.folder); } }
      ]
    },
    {
      label: 'Tools', submenu: [
        { label: 'Title Editor…', click: m('title-designer') },
        { label: 'Data Sources…', click: m('data-sources') },
        { label: 'Telestrator…', accelerator: 'CmdOrCtrl+Shift+T', click: m('telestrator') },
        { label: 'Keyboard Shortcuts…', click: m('shortcuts') },
        { label: 'Web Controller', click: () => shell.openExternal(`http://127.0.0.1:${settings.api.port}/`) },
        { type: 'separator' },
        { label: 'Statistics', click: m('stats') },
        { label: 'Show Log File', click: () => shell.showItemInFolder(log.transports.file.getFile().path) },
        { role: 'toggleDevTools', label: 'Developer Tools' }
      ]
    },
    {
      label: 'View', submenu: [
        { label: 'Toggle Multiview', accelerator: 'F8', click: m('toggle-multiview') },
        { label: 'Toggle Audio Mixer', accelerator: 'F9', click: m('toggle-mixer') },
        { type: 'separator' },
        { role: 'togglefullscreen' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }
      ]
    },
    {
      label: 'Help', submenu: [
        { label: 'User Guide', accelerator: 'F1', click: () => shell.openExternal('https://studio.btspl.tech/docs/') },
        { label: 'Check for Updates…', click: () => updater.check(true) },
        { label: 'Website', click: () => shell.openExternal('https://studio.btspl.tech') },
        { type: 'separator' },
        { label: 'About BTS Studio', click: m('about') }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(), name: app.getName(), platform: process.platform, arch: process.arch,
    electron: process.versions.electron, chrome: process.versions.chrome, userData: USER,
    ffmpeg: outputs.ffmpegPath(), apiPort: settings.api.port, isPackaged: app.isPackaged
  }));
  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:set', (e, next) => {
    const prevApi = JSON.stringify(settings.api);
    const prevGuests = settings.guests || {};
    settings = deepMerge(DEFAULT_SETTINGS, next);
    // the relay identity is created in the main process — never lose it to an older renderer copy
    settings.guests = settings.guests || {};
    for (const k of ['relayRoom', 'relaySecret']) if (!settings.guests[k] && prevGuests[k]) settings.guests[k] = prevGuests[k];
    guests.settingsChanged();
    saveSettings();
    if (JSON.stringify(settings.api) !== prevApi) restartApi();
    return settings;
  });

  // process health for the Statistics module / watchdog
  ipcMain.handle('app:metrics', () => {
    const procs = app.getAppMetrics().map(m => ({ type: m.type, name: m.name || m.serviceName || '', cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10, memMB: Math.round((m.memory.workingSetSize || 0) / 1024) }));
    const sys = { freeMB: Math.round(os.freemem() / 1048576), totalMB: Math.round(os.totalmem() / 1048576), cpus: os.cpus().length, load: os.loadavg()[0] };
    let gpu = {}; try { gpu = app.getGPUFeatureStatus(); } catch { /* noop */ }
    return { procs, sys, gpu: { video_encode: gpu.video_encode, video_decode: gpu.video_decode, gpu_compositing: gpu.gpu_compositing, webgl: gpu.webgl } };
  });
  ipcMain.handle('displays:list', () => {
    const ctrl = mainWin && !mainWin.isDestroyed() ? screen.getDisplayMatching(mainWin.getBounds()).id : screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d, i) => {
      const px = `${Math.round(d.size.width * d.scaleFactor)}×${Math.round(d.size.height * d.scaleFactor)}`;
      const hz = d.displayFrequency ? ` ${Math.round(d.displayFrequency)} Hz` : '';
      const name = d.label && !/^\s*$/.test(d.label) ? d.label : `Display ${i + 1}`;
      return { id: d.id, n: i + 1, name, control: d.id === ctrl, primary: d.id === screen.getPrimaryDisplay().id, bounds: d.bounds, scale: d.scaleFactor, hz: d.displayFrequency || 0,
        label: `${i + 1}. ${name} — ${px}${hz}${d.id === ctrl ? ' (BTS Studio is on this screen)' : ''}` };
    });
  });
  // Show a big number on every monitor for 3 s so the operator can tell them apart
  ipcMain.handle('displays:identify', () => {
    screen.getAllDisplays().forEach((d, i) => {
      const w = new BrowserWindow({ x: d.bounds.x + Math.round(d.bounds.width / 2) - 180, y: d.bounds.y + Math.round(d.bounds.height / 2) - 180, width: 360, height: 360, frame: false, transparent: true,
        alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
      const html = `<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:rgba(10,12,16,.88);border-radius:28px;font:800 220px Segoe UI,Arial,sans-serif;color:#f5a524">${i + 1}</body>`;
      w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).then(() => w.showInactive()).catch(() => {});
      setTimeout(() => { if (!w.isDestroyed()) w.close(); }, 3000);
    });
    return true;
  });

  ipcMain.handle('capture:sources', async () => {
    const list = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false });
    return list.map(s => ({ id: s.id, name: s.name, display_id: s.display_id, thumb: s.thumbnail.toDataURL() }));
  });

  // Files / projects
  ipcMain.handle('dialog:open', async (e, opts) => {
    const r = await dialog.showOpenDialog(mainWin, opts || {});
    return r.canceled ? null : r.filePaths;
  });
  ipcMain.handle('dialog:save', async (e, opts) => {
    const r = await dialog.showSaveDialog(mainWin, opts || {});
    return r.canceled ? null : r.filePath;
  });
  ipcMain.handle('dialog:folder', async (e, current) => {
    const r = await dialog.showOpenDialog(mainWin, { defaultPath: current, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('dialog:message', (e, opts) => dialog.showMessageBox(mainWin, opts));
  ipcMain.handle('project:read', (e, file) => {
    const txt = fs.readFileSync(file, 'utf8');
    addRecent(file);
    const data = JSON.parse(txt);
    // bundle: media paths are stored relative to the preset folder ("media/…") — make them absolute again
    if (data && data.bundle) {
      const dir = path.dirname(file);
      const walk = (v) => {
        if (typeof v === 'string') return /^media[\\/]/.test(v) ? path.join(dir, v) : v;
        if (Array.isArray(v)) return v.map(walk);
        if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = walk(v[k]); return v; }
        return v;
      };
      walk(data);
    }
    return { file, data };
  });
  /** Save a preset as a self-contained folder: the .btsproj plus every media file it uses (videos, images, LUTs, stingers…) */
  ipcMain.handle('project:bundle', async (e, folder, name, data) => {
    const media = path.join(folder, 'media');
    fs.mkdirSync(media, { recursive: true });
    const copied = new Map(); let count = 0, bytes = 0; const missing = [];
    const copyOne = (src) => {
      if (copied.has(src)) return copied.get(src);
      let base = path.basename(src), n = 1;
      while ([...copied.values()].includes('media/' + base)) base = path.basename(src, path.extname(src)) + '-' + (++n) + path.extname(src);
      const st = fs.statSync(src);
      if (st.isDirectory()) { // image-sequence folder
        const dst = path.join(media, base); fs.mkdirSync(dst, { recursive: true });
        for (const f of fs.readdirSync(src)) { const fp = path.join(src, f); if (fs.statSync(fp).isFile()) { fs.copyFileSync(fp, path.join(dst, f)); bytes += fs.statSync(fp).size; } }
      } else { fs.copyFileSync(src, path.join(media, base)); bytes += st.size; }
      count++;
      const rel = 'media/' + base; copied.set(src, rel); return rel;
    };
    const looksLikePath = (v) => typeof v === 'string' && v.length < 1024 && (path.isAbsolute(v) || /^file:\/\//i.test(v)) && !/^[a-z]+:\/\/(?!\/)/i.test(v.replace(/^file:\/\//i, ''));
    const walk = (v, key) => {
      if (typeof v === 'string') {
        if (!looksLikePath(v) || key === 'folder' || key === 'ffmpeg' || key === 'runtime') return v;
        const p = v.replace(/^file:\/\//i, '');
        try { if (fs.existsSync(p)) return copyOne(p); } catch { /* unreadable */ }
        missing.push(p); return v;
      }
      if (Array.isArray(v)) return v.map(x => walk(x, key));
      if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = walk(v[k], k); return v; }
      return v;
    };
    walk(data);
    data.bundle = true;
    const file = path.join(folder, (name || 'Production').replace(/[\\/:*?"<>|]/g, '_') + '.btsproj');
    writeJSON(file, data);
    addRecent(file);
    return { file, count, bytes, missing };
  });
  ipcMain.handle('project:write', (e, file, data) => {
    writeJSON(file, data);
    if (file.endsWith('.btsproj')) addRecent(file);
    return true;
  });
  ipcMain.handle('project:autosave', (e, data) => { writeJSON(path.join(USER, 'autosave.btsproj'), data); return true; });
  ipcMain.handle('project:autosave-read', () => readJSON(path.join(USER, 'autosave.btsproj'), null));
  ipcMain.handle('project:pending', () => { const f = pendingOpenFile; pendingOpenFile = null; return f; });
  ipcMain.handle('file:read-text', (e, file) => fs.readFileSync(file, 'utf8'));
  ipcMain.handle('file:url', (e, file) => require('url').pathToFileURL(file).href);
  ipcMain.handle('file:exists', (e, file) => fs.existsSync(file));
  ipcMain.handle('shell:open', (e, target) => target.startsWith('http') ? shell.openExternal(target) : shell.openPath(target));
  ipcMain.handle('shell:show', (e, target) => shell.showItemInFolder(target));
  ipcMain.handle('snapshot:save', async (e, dataUrl) => {
    const dir = path.join(settings.record.folder, 'Snapshots');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `Snapshot-${stamp()}.png`);
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    return file;
  });

  // Data source fetch (CSV/JSON/XML over http) — done in main to avoid CORS
  ipcMain.handle('net:fetch-text', async (e, url) => {
    if (/^https?:/i.test(url)) {
      const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    }
    return fs.readFileSync(url.replace(/^file:\/\//, ''), 'utf8');
  });

  ipcMain.on('log', (e, level, msg) => { (log[level] || log.info)('[renderer]', msg); });

  // Power save while live
  ipcMain.on('power:live', (e, on) => {
    if (on && psbId === null) psbId = powerSaveBlocker.start('prevent-display-sleep');
    if (!on && psbId !== null) { powerSaveBlocker.stop(psbId); psbId = null; }
  });

  outputs.registerIpc(ipcMain);
  browserSources.registerIpc(ipcMain);
  streamInputs.registerIpc(ipcMain);
  ndi.registerIpc(ipcMain);
  vcam.registerIpc(ipcMain);
  decklinkKeyer.registerIpc(ipcMain);
  replay.registerIpc(ipcMain);
  media.registerIpc(ipcMain);
  guests.registerIpc(ipcMain);
  dataFiles.registerIpc(ipcMain);
  ptz.registerIpc(ipcMain);
  api.registerIpc(ipcMain);
  updater.registerIpc(ipcMain);
}

function stamp() {
  const d = new Date(); const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ---------- lifecycle ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (e, argv) => {
    const f = argv.find(a => a.endsWith('.btsproj'));
    if (f) send('menu', { id: 'open-file', file: f });
    if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); }
  });
  pendingOpenFile = process.argv.find(a => a.endsWith('.btsproj')) || null;
  app.on('open-file', (e, f) => { e.preventDefault(); if (mainWin) send('menu', { id: 'open-file', file: f }); else pendingOpenFile = f; });

  app.whenReady().then(() => {
    // Monitors plugged in / unplugged / resolution changed: keep full-screen outputs on their screen, close ones whose screen is gone
    const onDisplays = (why) => {
      for (const [win, id] of outputWindows) {
        if (win.isDestroyed()) continue;
        const d = screen.getAllDisplays().find(x => x.id === id);
        if (!d) { win.close(); continue; }
        win.setFullScreen(false); win.setBounds(d.bounds); win.setFullScreen(true); win.setBounds(d.bounds);
      }
      send('displays:changed', why);
    };
    screen.on('display-added', () => onDisplays('added'));
    screen.on('display-removed', () => onDisplays('removed'));
    screen.on('display-metrics-changed', (e, d, changed) => { if (changed.includes('bounds') || changed.includes('scaleFactor')) onDisplays('changed'); });
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(['media', 'display-capture', 'fullscreen', 'clipboard-read', 'clipboard-sanitized-write', 'notifications', 'midi', 'midiSysex'].includes(permission)));
    app.on('child-process-gone', (e, d) => {
      log.error('Child process gone', d);
      if (d.type === 'GPU') send('engine:notice', { level: 'error', message: `Graphics process restarted (${d.reason}). If this repeats, update your GPU driver or enable Settings → Performance → Software rendering.` });
    });
    session.defaultSession.setPermissionCheckHandler(() => true);
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then(s => callback({ video: s[0], audio: process.platform === 'win32' ? 'loopback' : undefined }));
    });
    registerIpc();
    buildMenu();
    createMainWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => { outputs.stopAll(); browserSources.destroyAll(); streamInputs.stopAll(); ndi.stopAll(); vcam.stop(); decklinkKeyer.stopAll(); replay.stopAll(); guests.stop(); ptz.closeAll(); api.stop(); });
}
