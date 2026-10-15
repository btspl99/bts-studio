'use strict';
/**
 * Auto-update from https://studio.btspl.tech/updates/ (electron-updater, generic provider).
 * Publish: upload BTS-Studio-Setup-x.y.z.exe, its .blockmap and latest.yml to /updates/.
 */
const { autoUpdater } = require('electron-updater');
const log = require('electron-log/main');

let ctx = null;
let manual = false;
let state = { status: 'idle' };

function send(payload) {
  state = { ...state, ...payload };
  const w = ctx && ctx.getWin();
  if (w && !w.isDestroyed()) w.webContents.send('update:status', { ...state, manual });
}

function init(c) {
  ctx = c;
  autoUpdater.logger = log;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  const custom = ctx.getSettings().updates.url;
  if (custom) autoUpdater.setFeedURL({ provider: 'generic', url: custom });

  autoUpdater.on('checking-for-update', () => send({ status: 'checking' }));
  autoUpdater.on('update-available', (info) => send({ status: 'available', version: info.version, releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '', releaseDate: info.releaseDate }));
  autoUpdater.on('update-not-available', (info) => send({ status: 'none', version: info.version }));
  autoUpdater.on('download-progress', (p) => send({ status: 'downloading', percent: p.percent, bytesPerSecond: p.bytesPerSecond, transferred: p.transferred, total: p.total }));
  autoUpdater.on('update-downloaded', (info) => send({ status: 'downloaded', version: info.version }));
  autoUpdater.on('error', (err) => send({ status: 'error', message: err == null ? 'Unknown error' : (err.message || String(err)).split('\n')[0] }));

  if (process.windowsStore) return; // Store builds are updated by the Microsoft Store
  if (ctx.getSettings().updates.autoCheck) setTimeout(() => check(false), 12000);
  setInterval(() => { if (ctx.getSettings().updates.autoCheck) check(false); }, 6 * 60 * 60 * 1000);
}

function check(isManual) {
  manual = !!isManual;
  if (process.windowsStore) {
    send({ status: 'dev', message: 'This copy is updated automatically by the Microsoft Store.' });
    return;
  }
  if (!ctx.isPackaged) {
    send({ status: 'dev', message: 'Updates are checked only in the installed build.' });
    return;
  }
  autoUpdater.checkForUpdates().catch(err => send({ status: 'error', message: err.message }));
}

function registerIpc(ipcMain) {
  ipcMain.handle('update:check', () => check(true));
  ipcMain.handle('update:download', () => autoUpdater.downloadUpdate().catch(err => send({ status: 'error', message: err.message })));
  ipcMain.handle('update:install', () => setImmediate(() => autoUpdater.quitAndInstall(false, true)));
  ipcMain.handle('update:state', () => state);
}

module.exports = { init, check, registerIpc };
