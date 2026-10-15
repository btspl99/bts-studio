# Changelog

## 1.1.0 — 2026-10-15

### New
- **Instant Replay** — continuous buffer of Program and/or cameras (20–600 s), Mark In / Mark Out, "last N seconds" clips, one-button INSTANT REPLAY to Output, slow motion 25/50/75/100 %, events list, multiple replay cameras. Shortcuts: Shift+R instant replay, [ mark in, ] mark out, Shift+S save marks.
- **Stream / IP camera input** — RTSP (CCTV / IP cams), SRT, RTMP (incl. listen mode for encoders/phones), HLS/HTTP, UDP/MPEG-TS, with audio into the mixer and auto-reconnect.
- **Capture cards** — redesigned Camera / Capture input with live preview, signal and format detection, mode list filtered to what the device supports, automatic pairing of the card's audio device, deinterlacing, hold-last-frame and "NO SIGNAL" slate on signal loss, auto-reconnect and hot-plug recovery, device-specific tips for Blackmagic (DeckLink / UltraStudio / Intensity), AVerMedia, Elgato and Magewell, and a DirectShow capture backend option for PCIe cards.
- **Scripts (macros)** — step lists of any function with waits, loop mode; run from shortcuts, MIDI, triggers or the API (ScriptStart).
- **Input triggers** — run a function when an input goes live, leaves Output, or finishes.
- **Playlist** — play inputs to Output in sequence with a chosen transition, per-entry duration, loop.
- **MIDI controllers** — learn mode; map buttons to any function and faders to the T-Bar, master or input volume.
- **Titles** — 9 new templates (Lower Third + Logo, News Strap, Ticker, LIVE bug, Cricket Batting Card, Match Intro, Leaderboard, Quote, End Credits roll); ticker items/separator/direction, pause/resume/reset/speed functions; typewriter text animation; credits crawl.
- **Colour tags** for inputs, mirror (flip) option, playback speed (SetRate).

### Performance & stability
- Adaptive load governor: under heavy load previews, thumbnails and multiview slow down first so Output stays smooth.
- Staggered thumbnail rendering; render-loop backlog dropping.
- Browser sources use back-pressure (one frame in flight) instead of flooding the engine.
- Fault isolation: an input that keeps failing is suspended for 2 s instead of affecting other sources.
- Automatic engine recovery: if the render process crashes or hangs, BTS Studio reloads it and restores the last autosave (every 20 s). GPU process crashes are reported with guidance.
- Prefers the high-performance GPU on dual-GPU laptops; software-rendering fallback option.

## 1.0.0 — 2026-10-15
- First public release.
