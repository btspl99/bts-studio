// Downloads the Windows FFmpeg binary bundled with the installer: node scripts/fetch-ffmpeg.js
const https = require('https'); const fs = require('fs'); const zlib = require('zlib'); const path = require('path');
const url = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-win32-x64.gz';
const out = path.join(__dirname, '..', 'vendor', 'ffmpeg', 'win32-x64', 'ffmpeg.exe');
fs.mkdirSync(path.dirname(out), { recursive: true });
(function get(u) {
  https.get(u, (res) => {
    if (res.statusCode >= 300 && res.headers.location) return get(res.headers.location);
    if (res.statusCode !== 200) { console.error('HTTP', res.statusCode); process.exit(1); }
    res.pipe(zlib.createGunzip()).pipe(fs.createWriteStream(out)).on('finish', () => console.log('Saved', out));
  });
})(url);
