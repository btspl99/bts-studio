# BTS Studio

Free, open-source live production software for students and creators — switch cameras and media, add titles and overlays, mix audio, stream to several platforms at once and record, all from one Windows app.

Website & downloads: https://studio.btspl.tech · User guide: https://studio.btspl.tech/docs/

## Features (v1.8)

New in 1.8 (control): 11 trigger events, several actions per shortcut, **MIDI activators** (LED feedback), Web Controller **password**, **vMix-compatible XML / XMLTEXT and function names**, input layer functions and **preset bundles** with media. See CHANGELOG.md.

New in 1.7 (production): **layers on every input**, **3D LUT / blur / alpha-mask** effects, **digital PTZ** presets, **title pages** (storyboard), **replay tags** with tag highlights, **image-sequence stingers** and **YouTube / Twitch comments** on air. See CHANGELOG.md.

New in 1.6 (outputs): per-output **source** (program, clean feed, preview, multiview or any input) for every stream and recorder, **vertical / square** streams with fill-crop, **stream delay**, **multi-track** recording (buses as separate audio tracks), **WAV** recording and **file splitting**. See CHANGELOG.md.

New in 1.5 (signal chain): **NDI® input and output** (tally, 4 senders), **Capture Card (Pro)** input with input-port, exact-mode and 8/16-channel embedded audio selection (DirectShow / DeckLink / V4L2), **GPU decoding** of H.264/HEVC network streams with no re-compression, **BTS Link** guest links that need no port forwarding, per-input video delay and per-input dropped-frame statistics. See CHANGELOG.md.

New in 1.4 (performance & 4K): shared GPU encoding for every output, hardware and software encoders like vMix (NVENC, Quick Sync, AMF, x264/x265, AV1, ProRes, DNxHR), lossless / constant-quality and crash-safe recording, 4 multiviews with 12 layouts on any monitor, a GT-style **Title Editor** with per-object animation timeline, health monitor and statistics, command palette (Ctrl+K). See CHANGELOG.md.

New in 1.3 (vMix feature parity): 8 overlay channels, 8 stingers, Mix inputs, Video Delay, 6 external outputs, 5 stream destinations, Recorder 2, colour wheels & scopes, Layer Designer, auto-convert of AVI/WMV/MXF/MPEG-2, Slides (PowerPoint/PDF), interactive web browser, Remote Guests (browser call-in), Excel/XML/RSS data, Photoshop title import, 40 title templates, Telestrator, audio buses A–G, Replay A/B with highlight music, PTZ control, TCP API, live web preview, JavaScript scripting and virtual sets. See CHANGELOG.md.

- **Switcher** — Preview / Output, Quick Play, Cut, 4 transition buttons, T-Bar, Fade to Black; **Mix inputs** (independent second switchers, e.g. for a big screen)
- **Transitions** — Fade, Merge, Zoom, Wipes, Iris, Slide, Push, Cube, Flip, Dip, Blur and **8 Stingers** (video with alpha + cut point)
- **8 overlay channels** with their own in/out transitions
- **Inputs** — cameras & capture cards (Blackmagic, AVerMedia, Elgato, Magewell…), IP cameras (RTSP / SRT / RTMP / HLS / UDP), screen capture, video & audio files (AVI, WMV, MXF, MPEG-2, ProRes… converted automatically), images, lists, **Slides** (PDF, PowerPoint, Keynote, image folders), **interactive web browser**, titles, colours, scenes, **Remote Guests** (WebRTC call-in from any browser, mix-minus + return feed), **Video Delay**, **Telestrator**, **Virtual Sets**, PTZ positions
- **Video** — GPU colour correction with **Lift / Gamma / Gain colour wheels**, looks & presets, sharpen, chroma & luma key; **Scopes** (waveform, RGB parade, vectorscope, histogram); **Layer Designer** — drag & resize layers on the picture
- **Titles** — **40 templates** (news, sports, lower thirds, full screen, engagement) with categories & search, **Photoshop PSD import** (text layers stay editable), **Title Editor** (layers, smart guides, 22 per-object animations on a timeline, 4K canvases), `.btstitle`
- **Data sources** — **Excel (.xlsx / .ods)**, CSV, Google Sheets, JSON, **XML, RSS/Atom**; auto-refresh; bind to the selected row, a row offset, or all rows (tickers)
- **Audio mixer** — Master + **buses A–G** (send to master, headphones, any output device, per-stream audio); per-input EQ, compressor, gate, delay, solo, audio-follow-video; limiter
- **Instant Replay** — 8 angles, multi-angle events, slow motion, highlights with **music bed**, **Replay A/B** (B follows A with another angle)
- **Outputs** — **encode once on the GPU, share with every output**; GPU / x264 / x265 / NVENC / Quick Sync / AMF / AV1 / ProRes / DNxHR; stream to **5 destinations** at once, **2 recorders** (lossless option, crash-safe MP4), MultiCorder ISO, **6 external outputs** (output, preview, any of **4 multiviews** or any input)
- **Control** — HTTP API, Web Controller with **live video monitors (MJPEG)**, tally pages, **vMix-compatible TCP API** (Companion / Stream Deck / tally boxes), MIDI, shortcuts, step scripts and **JavaScript scripts**, triggers, playlist, **PTZ cameras (VISCA over IP)** with presets
- Dockable workspace with layouts & themes, presets (`.btsproj`), autosave & crash recovery
- **Automatic updates** from `https://studio.btspl.tech/updates/`

Not yet included: virtual webcam output, ASIO and VST3 plug-ins (need native Windows drivers).

## Develop

```bash
npm install
npm run fetch-ffmpeg     # downloads the Windows FFmpeg binary into vendor/ (Linux/macOS dev uses system ffmpeg)
npm run dev              # starts the app with DevTools
```

## Build & publish an update

1. Bump `"version"` in `package.json` (e.g. `1.0.1`).
2. Build: `npm run dist:win` (on Windows, or Linux with wine + wine32) — or push a tag `v1.0.1` and let GitHub Actions build it (`.github/workflows/release.yml`).
3. Upload `dist/BTS-Studio-Setup-1.0.1.exe`, `dist/BTS-Studio-Setup-1.0.1.exe.blockmap`, then **`dist/latest.yml` last** to `studio.btspl.tech/updates/`.
4. Every installed copy checks at startup and every 6 hours, downloads in the background (differential via blockmap) and installs on restart.

See `website/DEPLOY.md` and `website/updates/README.txt`.

## Project layout

```
src/main/        Electron main process — windows, menus, FFmpeg outputs, browser sources, HTTP/TCP API, PTZ,
                 media conversion, data files, remote-guest signalling, updater
src/renderer/    UI + engine (compositor, transitions, inputs, audio, titles, outputs, data sources)
src/web/         Web Controller, Tally and Remote Guest pages
website/         studio.btspl.tech site, docs and update-server config
build/           app icons
```

## API quick reference

```
GET  /api                                  state (JSON)      /api?format=xml   state (XML)
GET  /api/functions                        list of functions
GET  /api/?Function=Cut&Input=2
GET  /api/?Function=QuickPlay&Input=Camera 1
GET  /api/?Function=SetText&Input=Score&SelectedName=Score&Value=120/3
GET  /api/?Function=OverlayInput1&Input=3
GET  /api/?Function=StartStreaming
POST /api   {"Function":"SetVolume","Input":"2","Value":"75"}
```
`Input` accepts the input number, its title, or its id.

```
GET  /api/mjpeg?Input=program&fps=10&width=640    live MJPEG video (program, preview, multiview or an input)
TCP  8099:  FUNCTION Cut Input=2   ·   TALLY   ·   SUBSCRIBE TALLY   ·   SUBSCRIBE ACTS   ·   XML   ·   QUIT
```

## Licence

MIT © 2026 Bhoomiputra Tech Solutions Pvt Ltd. FFmpeg is bundled as a separate executable under its own licence — see `THIRD_PARTY_NOTICES.md`.
