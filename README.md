# BTS Studio

Free, open-source live production software for students and creators — switch cameras and media, add titles and overlays, mix audio, stream to several platforms at once and record, all from one Windows app.

Website & downloads: https://studio.btspl.tech · User guide: https://studio.btspl.tech/docs/

## Features (v1.0)

- **Switcher** — Preview / Output monitors, Quick Play, Cut, 4 programmable transition buttons, manual T-Bar, Fade to Black
- **Transitions** — Fade, Merge, Zoom, Cross Zoom, Wipes (4 directions + diagonal), Iris, Barn Door, Slide, Push, Fly, Cube, Flip, Dip to Black/White, Blur, 2 Stingers (video with alpha + cut point)
- **4 overlay channels** with their own in/out transitions (titles animate themselves)
- **Inputs** — cameras & capture cards, screen/window capture (+ system audio on Windows), video & audio files or URLs, images & animated GIFs, playlists (List), web browser / HTML overlays with transparency, titles, colour/gradient/bars, scenes with up to 10 layers (PiP, side-by-side, quad), audio devices
- **Per-input** position, zoom, pan, rotate, crop, border, rounded corners, shadow, opacity; GPU colour correction, chroma key, luma key; auto-play/pause/restart, mark in/out, on-completion actions
- **Titles** — 11 built-in templates (lower thirds, breaking news + ticker, cricket score bar, sports score, clock, countdown, full-screen title, social handle, up next) + visual **Title Designer**; save/load `.btstitle`
- **Data sources** — CSV, JSON, Google Sheets, text; auto-refresh; bind columns to title fields; row selection from UI/API
- **Audio mixer** — Master, Bus A, Bus B; per-input trim, fader, balance, lip-sync delay, 3-band EQ, compressor, noise gate, solo, audio-follow-video, bus routing; master limiter; peak meters with hold; headphone monitoring
- **Streaming** to up to 3 destinations at once (YouTube, Facebook, Twitch, custom RTMP/RTMPS, SRT, UDP) with auto-reconnect; x264 or hardware NVENC / Quick Sync / AMF (auto-detected)
- **Recording** MP4 / MKV / MOV / WebM (pass-through or re-encode) and **MultiCorder** ISO recording of individual inputs
- **Multiview** (F8), fullscreen **External output** to any display, snapshots
- **HTTP API + Web Controller + Tally** on port 8088 — control from phones, tablets, Stream Deck (via HTTP), or your own HTML overlays
- Keyboard shortcuts (customisable), presets (`.btsproj`), autosave & crash recovery
- **Automatic updates** from `https://studio.btspl.tech/updates/`

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
src/main/        Electron main process — windows, menus, FFmpeg outputs, browser sources, HTTP API, updater
src/renderer/    UI + engine (compositor, transitions, inputs, audio, titles, outputs, data sources)
src/web/         Web Controller and Tally pages served by the API
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

## Licence

MIT © 2026 Bhoomiputra Tech Solutions Pvt Ltd. FFmpeg is bundled as a separate executable under its own licence — see `THIRD_PARTY_NOTICES.md`.
