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
| ag-psd 31 (with pako, base64-js) | MIT | Photoshop PSD import for titles. https://github.com/Agamnentzar/ag-psd (licence in `src/renderer/vendor/ag-psd/LICENSE`) |
| selfsigned, @peculiar/x509, pkijs | MIT / BSD-3-Clause | Self-signed HTTPS certificate for the Remote Guests page |
| koffi | MIT | Calls the NDI® runtime installed on the PC (no compilation). https://koffi.dev |
| NDI® runtime | NDI licence | Not bundled. Installed by the user with NDI Tools / NDI Runtime from https://ndi.video and loaded at run time. |
| softcam | MIT | BTS Studio Virtual Camera (DirectShow filter), built from https://github.com/tshino/softcam |
| PortAudio | MIT-style | Audio engine (`native/audio`) |
| Steinberg ASIO SDK | GPLv3 | Compiled into the separate `bts-audio.exe` helper only; source in `native/audio` |
| Steinberg VST3 SDK | MIT | VST3 hosting in `bts-audio.exe` |
| Blackmagic DeckLink API headers | Blackmagic redistributable licence | `native/decklink/sdk`, see LICENSE-DeckLinkAPI.txt |
| LibreOffice / Microsoft PowerPoint | — | Not bundled. Used if installed to convert .pptx/.ppt/.odp to PDF for the Slides input |

NDI® is a registered trademark of Vizrt NDI AB. BTS Studio is not affiliated with or endorsed by Vizrt.

FFmpeg is a trademark of Fabrice Bellard. BTS Studio is not affiliated with the FFmpeg project.
Under the GPL, recipients of the FFmpeg binary may obtain its corresponding source code from the links above.
