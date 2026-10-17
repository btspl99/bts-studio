'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const listen = (channel) => (cb) => {
  const fn = (e, ...args) => cb(...args);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('bts', {
  platform: process.platform,
  info: () => ipcRenderer.invoke('app:info'),
  metrics: () => ipcRenderer.invoke('app:metrics'),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (s) => ipcRenderer.invoke('settings:set', s)
  },
  displays: () => ipcRenderer.invoke('displays:list'),
  displaysIdentify: () => ipcRenderer.invoke('displays:identify'),
  onDisplaysChanged: (fn) => ipcRenderer.on('displays:changed', (e, why) => fn(why)),
  captureSources: () => ipcRenderer.invoke('capture:sources'),
  dialog: {
    open: (o) => ipcRenderer.invoke('dialog:open', o),
    save: (o) => ipcRenderer.invoke('dialog:save', o),
    folder: (c) => ipcRenderer.invoke('dialog:folder', c),
    message: (o) => ipcRenderer.invoke('dialog:message', o)
  },
  project: {
    read: (f) => ipcRenderer.invoke('project:read', f),
    write: (f, d) => ipcRenderer.invoke('project:write', f, d),
    bundle: (folder, name, d) => ipcRenderer.invoke('project:bundle', folder, name, d),
    autosave: (d) => ipcRenderer.invoke('project:autosave', d),
    autosaveRead: () => ipcRenderer.invoke('project:autosave-read'),
    pending: () => ipcRenderer.invoke('project:pending')
  },
  file: {
    readText: (f) => ipcRenderer.invoke('file:read-text', f),
    url: (f) => ipcRenderer.invoke('file:url', f),
    exists: (f) => ipcRenderer.invoke('file:exists', f),
    pathOf: (file) => { try { return webUtils.getPathForFile(file); } catch { return file.path || ''; } }
  },
  shell: {
    open: (t) => ipcRenderer.invoke('shell:open', t),
    show: (t) => ipcRenderer.invoke('shell:show', t)
  },
  snapshot: (dataUrl) => ipcRenderer.invoke('snapshot:save', dataUrl),
  fetchText: (url) => ipcRenderer.invoke('net:fetch-text', url),
  power: (on) => ipcRenderer.send('power:live', on),
  output: {
    start: (id, cfg) => ipcRenderer.invoke('output:start', id, cfg),
    chunk: (id, buf) => ipcRenderer.send('output:chunk', id, buf),
    stop: (id) => ipcRenderer.invoke('output:stop', id),
    encoders: () => ipcRenderer.invoke('output:encoders'),
    ffmpegVersion: () => ipcRenderer.invoke('output:ffmpeg-version'),
    onStatus: listen('output:status'),
    list: () => ipcRenderer.invoke('output:list'),
    decklink: () => ipcRenderer.invoke('decklink:list')
  },
  enc: {
    config: (sid, avcC) => ipcRenderer.send('enc:config', sid, avcC),
    video: (sid, pts, key, data) => ipcRenderer.send('enc:video', sid, pts, key, data),
    audio: (sid, sample, data) => ipcRenderer.send('enc:audio', sid, sample, data),
    onNeedKey: listen('enc:need-key'),
    sessions: () => ipcRenderer.invoke('enc:sessions')
  },
  browser: {
    create: (id, cfg) => ipcRenderer.invoke('browser:create', id, cfg),
    update: (id, cfg) => ipcRenderer.invoke('browser:update', id, cfg),
    destroy: (id) => ipcRenderer.invoke('browser:destroy', id),
    reload: (id) => ipcRenderer.invoke('browser:reload', id),
    exec: (id, js) => ipcRenderer.invoke('browser:exec', id, js),
    devtools: (id) => ipcRenderer.invoke('browser:devtools', id),
    input: (id, ev) => ipcRenderer.invoke('browser:input', id, ev),
    nav: (id, action) => ipcRenderer.invoke('browser:nav', id, action),
    ack: (id) => ipcRenderer.send('browser:ack', id),
    onFrame: listen('browser:frame'),
    onStatus: listen('browser:status')
  },
  api: {
    onCall: listen('api:call'),
    result: (reqId, result) => ipcRenderer.send('api:result', { reqId, result }),
    state: (s) => ipcRenderer.send('state:update', s),
    functions: (l) => ipcRenderer.send('api:functions', l),
    addresses: () => ipcRenderer.invoke('api:addresses')
  },
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    state: () => ipcRenderer.invoke('update:state'),
    onStatus: listen('update:status')
  },
  onMenu: listen('menu'),
  onNotice: listen('engine:notice'),
  log: (level, msg) => ipcRenderer.send('log', level, String(msg).slice(0, 4000)),
  decklinkKey: {
    list: () => ipcRenderer.invoke('dlk:list'),
    start: (id, cfg) => ipcRenderer.invoke('dlk:start', id, cfg),
    stop: (id) => ipcRenderer.invoke('dlk:stop', id),
    status: () => ipcRenderer.invoke('dlk:status'),
    frame: (id, data) => ipcRenderer.send('dlk:frame', id, data),
    audio: (id, data) => ipcRenderer.send('dlk:audio', id, data),
    onStatus: listen('dlk:status')
  },
  ndi: {
    status: () => ipcRenderer.invoke('ndi:status'),
    sources: (wait) => ipcRenderer.invoke('ndi:sources', wait),
    recv: (id, cfg) => ipcRenderer.invoke('ndi:recv', id, cfg),
    recvStop: (id) => ipcRenderer.invoke('ndi:recv-stop', id),
    tally: (id, pgm, pvw) => ipcRenderer.send('ndi:tally', id, pgm, pvw),
    send: (id, cfg) => ipcRenderer.invoke('ndi:send', id, cfg),
    sendStop: (id) => ipcRenderer.invoke('ndi:send-stop', id),
    video: (id, w, h, data, fmt) => ipcRenderer.send('ndi:video', id, w, h, data, fmt),
    audio: (id, data) => ipcRenderer.send('ndi:audio', id, data)
  },
  stream: {
    start: (id, cfg) => ipcRenderer.invoke('stream:start', id, cfg),
    stop: (id) => ipcRenderer.invoke('stream:stop', id),
    stats: () => ipcRenderer.invoke('stream:stats'),
    devices: (backend) => ipcRenderer.invoke('capture:devices', backend),
    modes: (backend, device) => ipcRenderer.invoke('capture:modes', backend, device),
    onStatus: listen('stream:status'),
    onAudio: listen('stream:audio')
  },
  media: {
    probe: (f) => ipcRenderer.invoke('media:probe', f),
    needsConvert: (f) => ipcRenderer.invoke('media:needs-convert', f),
    convert: (f, o) => ipcRenderer.invoke('media:convert', f, o),
    officeToPdf: (f) => ipcRenderer.invoke('media:office-to-pdf', f),
    listImages: (d) => ipcRenderer.invoke('media:list-images', d),
    readBinary: (f) => ipcRenderer.invoke('media:read-binary', f),
    clearCache: () => ipcRenderer.invoke('media:clear-cache'),
    onProgress: listen('media:progress')
  },
  data: {
    readSheet: (f) => ipcRenderer.invoke('data:read-sheet', f),
    mtime: (f) => ipcRenderer.invoke('data:mtime', f),
    writeAsset: (rel, d) => ipcRenderer.invoke('assets:write', rel, d)
  },
  ptz: {
    move: (c, x, y) => ipcRenderer.invoke('ptz:move', c, x, y),
    stop: (c) => ipcRenderer.invoke('ptz:stop', c),
    zoom: (c, v) => ipcRenderer.invoke('ptz:zoom', c, v),
    focus: (c, m) => ipcRenderer.invoke('ptz:focus', c, m),
    home: (c) => ipcRenderer.invoke('ptz:home', c),
    recall: (c, n) => ipcRenderer.invoke('ptz:recall', c, n),
    store: (c, n) => ipcRenderer.invoke('ptz:store', c, n),
    power: (c, on) => ipcRenderer.invoke('ptz:power', c, on),
    presetSpeed: (c, s) => ipcRenderer.invoke('ptz:preset-speed', c, s)
  },
  guests: {
    start: () => ipcRenderer.invoke('guests:start'),
    stop: () => ipcRenderer.invoke('guests:stop'),
    slot: (k, info) => ipcRenderer.invoke('guests:slot', k, info),
    send: (sid, msg) => ipcRenderer.invoke('guests:send', sid, msg),
    urls: () => ipcRenderer.invoke('guests:urls'),
    relay: (on) => ipcRenderer.invoke('guests:relay', on),
    onSignal: listen('guests:signal')
  },
  replay: {
    start: (id, cfg) => ipcRenderer.invoke('replay:start', id, cfg),
    chunk: (id, buf) => ipcRenderer.send('replay:chunk', id, buf),
    stop: (id) => ipcRenderer.invoke('replay:stop', id),
    clip: (id, opts) => ipcRenderer.invoke('replay:clip', id, opts),
    status: (id) => ipcRenderer.invoke('replay:status', id),
    deleteClip: (file) => ipcRenderer.invoke('replay:delete-clip', file)
  }
});
