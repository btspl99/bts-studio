# Third-party notices

BTS Studio is MIT-licensed. It bundles or depends on the following third-party software:

| Component | Licence | Notes |
|---|---|---|
| Electron (Chromium, Node.js) | MIT / BSD-style | https://www.electronjs.org |
| electron-updater, electron-builder | MIT | https://www.electron.build |
| electron-log | MIT | https://github.com/megahertz/electron-log |
| FFmpeg | GPL v3 (the bundled static build) | Shipped as a separate executable (`resources/ffmpeg/ffmpeg.exe`) invoked as a child process. Source: https://ffmpeg.org/download.html — build from https://github.com/eugeneware/ffmpeg-static (b6.0). |
| OpenH264 (inside Chromium) | BSD | Video Codec provided by Cisco Systems, Inc. |
| PDF.js (pdfjs-dist 6.4) | Apache 2.0 | Slides input — PDF rendering. https://mozilla.github.io/pdf.js/ (licence in `src/renderer/vendor/pdfjs/LICENSE`) |
| selfsigned, @peculiar/x509, pkijs | MIT / BSD-3-Clause | Self-signed HTTPS certificate for the Remote Guests page |
| LibreOffice / Microsoft PowerPoint | — | Not bundled. Used if installed to convert .pptx/.ppt/.odp to PDF for the Slides input |

FFmpeg is a trademark of Fabrice Bellard. BTS Studio is not affiliated with the FFmpeg project.
Under the GPL, recipients of the FFmpeg binary may obtain its corresponding source code from the links above.
