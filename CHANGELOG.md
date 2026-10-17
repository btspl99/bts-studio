# Changelog

## 1.4.1 — 2026-10-17

### Fixed
- **External output showing the whole desktop / opening on the wrong screen.** Full-screen outputs now open exactly on the chosen monitor (HDMI, DisplayPort, projector, LED processor, capture device) and stay there when screens are plugged in, unplugged or changed. Before, Windows could put the output on the control screen.
- If only one screen is available (Windows set to *Duplicate*), External Outputs explains how to switch to **Extend** (Win+P). Choosing the control screen for an output now asks first.
- The `StartExternal` function opens on a second screen when one is connected, instead of in a window.

### New
- **External outputs like vMix** — set up to 6 outputs once (screen, source, fit, rotation, mirror, area), tick them, then press **External** (or **F7**) to turn them all on or off. Settings are saved; outputs can **start with BTS Studio** and **come back automatically when a screen is reconnected**. New ⚙ button next to External opens the setup.
- **Clean feed** source — the Output without overlays / titles, for IMAG screens and ISO recorders (only rendered while in use).
- **Video wall** — spread one picture over several screens (columns × rows) in a few clicks, or set each output's area by hand. **Rotate** 90/180/270° for portrait screens, **Mirror** for teleprompters, **Fit / Fill / Stretch** per output.
- **Identify screens** — shows each monitor's number on it for 3 seconds. Screens are listed with their names, real resolution and refresh rate.
- **Change the source of a running external output** (Output, Preview, any multiview or input) without closing it.
- **Blackmagic DeckLink / UltraStudio output (SDI & HDMI)** — 2 playout outputs with the program picture (near-lossless) and embedded audio from Master or any bus, in 1080p, 1080i, 720p, 2160p or the project format. Needs Blackmagic Desktop Video and an FFmpeg built with DeckLink support (Blackmagic's licence does not allow it to be bundled); set its path in External Outputs. New functions `StartBlackmagic` / `StopBlackmagic`.

## 1.4.0 — 2026-10-17

The performance and 4K release.

### Output engine (rebuilt)
- **Encode once, use everywhere** — each output profile is encoded a single time by the GPU (NVIDIA / Intel / AMD / Apple hardware H.264 through WebCodecs) and shared by every stream and recording that uses it. Streaming to 5 destinations and recording no longer costs 6 encodes.
- **GPU or software encoders like vMix** — GPU (shared hardware H.264), x264, x265, NVENC H.264/HEVC/AV1, Intel Quick Sync H.264/HEVC, AMD AMF H.264/HEVC, Apple VideoToolbox, ProRes 422 HQ (10-bit) and DNxHR HQ for editing.
- **Constant-quality recording** with a new *Lossless* level, 40 Mbps default for fixed bitrate, PCM 24-bit audio in MOV / MKV and AAC 320 kbps elsewhere.
- **Crash-safe MP4** (fragmented) — a recording survives a power cut.
- **Per-destination resolution and encoder**, with Lanczos scaling.
- **Back-pressure protection** — a slow network or disk drops frames cleanly to the next keyframe instead of growing memory or freezing the app.
- **Audio/video sync** measured at under 10 ms, plus an *Audio offset* trim in Settings → Encoders.

### Performance & stability
- **Health monitor** — warns about low FPS, encoder drops, slow outputs and low memory, and frees caches automatically when memory runs low.
- **Statistics module rebuilt** — CPU, app memory, free RAM, GPU memory, GPU encode, FPS / frame-time graph, per-output buffers and every process.
- **4K-native effects** — colour correction, keying and effects now run at full 4K resolution.
- **Best camera mode** — cameras automatically open in their highest resolution and frame rate (up to 4096×2160).
- **Static title cache** — titles are only redrawn when they change, which saves most of the GPU cost of many 4K titles.
- The load governor ignores the start-up and project-load burst.
- High-quality scaling is kept after changing the video format.

### Multiview
- **4 independent multiviews**, each with 12 layouts (2+8, 2+12, 2+16, 2+24, Output only, grids, 4/9/16 inputs). Each multiview has its own resolution (up to 4K), labels, tally borders, audio meters, safe areas and a LIVE / REC / REPLAY / FPS / clock status bar.
- Right-click any cell to assign an input, Output, Preview or clock to it. Click a cell to send it to Preview, double-click to cut it to Output.
- **Multiview on an external monitor** — any multiview can go to any screen. External outputs are now drawn directly to the monitor window with one frame of latency.

### Title Editor (new, GT-style)
- Full-screen designer with **layers** (show, lock, rename, drag to reorder), **move / resize / rotate handles**, marquee and multi-select, **smart guides** and snapping, align and distribute, undo / redo, copy / paste, nudge with the arrow keys, zoom, grid, safe areas, and a live-output background.
- **Objects**: text, rectangle, ellipse, line, image, clock, countdown / stopwatch, ticker, crawl / credits.
- **Inspector**: fonts (including installed fonts), gradients, letter spacing, wrapping, shrink-to-fit, background box, outline, soft shadows, blend modes and opacity.
- **Per-object animation** — 22 In / Out effects (slide, nudge, wipe, reveal, zoom, pop, flip, spin, blur, typewriter and more) with 7 easings. Each object has its own delay and duration on a **timeline** you can drag and scrub.
- 4K title canvases. PSD import is still supported.

### Interface
- **Command palette** (Ctrl+K) — search and run any action, input or function.
- **Settings** now uses a searchable side navigation.

## 1.3.0 — 2026-10-17

The vMix feature-parity release.

### Switcher & outputs
- **8 overlay channels** (was 4) and **8 stingers** (was 2).
- **Mix inputs** — independent second switchers with their own preview, Cut and transitions (MixCut / MixFade / MixPreviewInput functions).
- **Video Delay input** — delay any input by up to 10 s (picture and sound).
- **6 external outputs** — each shows Output, Preview, Multiview or any single input, on any screen or in a window.
- **5 stream destinations** (was 3); each can carry the Master or any bus as its audio.
- **Recorder 2** — a second recording that starts with Record (e.g. MP4 + MKV safety copy).

### Video
- **Colour wheels** — Lift / Gamma / Gain with master sliders, looks (Warm, Cool, Cinematic, Vivid, B&W, Faded, Stage-light fix), save / load `.btscolor`, copy to all cameras.
- **Sharpen** filter.
- **Scopes module** — luma waveform, RGB waveform, RGB parade, vectorscope with targets and skin-tone line, histogram with clip / crush warnings.
- **Layer Designer** — drag and resize scene layers directly on the picture, snapping, arrange presets (PiP, side by side, 2×2, interview…).

### Inputs
- **Automatic conversion** of AVI, WMV, MXF, MPEG-2, VOB, FLV, ProRes and other formats Chromium cannot play (FFmpeg H.264 proxy, cached).
- **Slides input** — PDF, PowerPoint (.pptx / .ppt via PowerPoint or LibreOffice), Keynote/ODP, or a folder of exported images; fade/push transitions, auto-advance, thumbnails; SlideNext / SlidePrevious / SlideSelect.
- **Interactive web browser** — click, scroll and type on a browser input from the new Interact tab; back / forward / reload.
- **Remote Guests** — invite callers with a private browser link (no install). Guests get the program return feed, mix-minus audio, an ON AIR tally and chat; STUN/TURN settings for guests outside your network.
- **Telestrator** — draw pens, highlighter, arrows, circles, boxes and a spotlight over the live picture, with auto-fade.
- **Virtual Sets** — put keyed presenters into News Desk, Talk Show or Tech Grid sets (or your own images), with a video wall and animated virtual camera shots.

### Titles & data
- **40 title templates** (20 new: interview names, location tag, subscribe, sponsor bug, comment card, football and basketball score bugs, election results, quiz, poll, starting soon, be right back, end screen, agenda, weather, RSS ticker, chapter title, caption box…) with categories and search.
- **Photoshop PSD import** — layers become images, text layers stay editable fields.
- **Data sources**: Excel `.xlsx` / OpenDocument `.ods` (sheet choice, live re-read on save), XML, RSS / Atom; bindings to a row offset or to all rows (perfect for tickers and leaderboards).

### Audio & replay
- **Audio buses A–G** (was A–B): send to Master, listen in headphones, or play out to any audio device (in-ear / IFB / PA feeds).
- **Replay A/B** — Replay B can follow A in sync with a different camera angle.
- **Highlight music** — a music bed fades in under Play Highlights and out at the end, with the replay sound ducked.

### Control
- **PTZ control** — VISCA over IP (Sony / BirdDog / PTZOptics…): joystick, zoom, focus, 16 presets with thumbnails, PTZ virtual inputs that move the camera when selected, PTZ functions.
- **TCP API** (vMix-compatible) on port 8099: FUNCTION, TALLY, SUBSCRIBE TALLY / ACTS, XML.
- **Live preview** — MJPEG video at `/api/mjpeg`; the Web Controller can show live Preview / Output monitors.
- **JavaScript scripts** — sandboxed, with `API`, `sleep`, `log`, `running` (alongside step scripts).
- Tally over HTTP/TCP now updates the moment you switch.

## 1.2.0 — 2026-10-15

### New interface
- **Dockable workspace** — every panel is a module (Preview, Output, Transitions, Inputs, Audio Mixer, Multiview, Instant Replay, Playlist, Scripts, Statistics). Drag a module's tab onto the edge of another panel to split it, onto its centre to add it as a tab, or onto the window edge to dock it across the whole workspace. Resize with the gutters (double-click to equalise), close modules, re-open them from **Modules**.
- **Workspaces** — six built-in layouts (Classic Switcher, Sports & Replay, Multiview Director, Audio Focus, Laptop / Compact, Broadcast Studio), save your own, lock the layout during a show.
- **Modern theme** — new app bar, refreshed controls, five themes (Graphite, Midnight, Carbon, Slate, Light), any accent colour, compact density. Tally colours stay fixed.
- Inputs module: filter box and card-size slider. New Statistics module.

### Instant Replay, rebuilt
- Multi-angle events: every event captures all replay cameras (up to 8) at the same moment.
- Switch camera angle while a replay plays — the playhead stays in place.
- Replay monitor with jog (mouse wheel), frame step, seek bar, speed lever (5–200 %) and presets.
- Mark In / Mark Out / Save Event, Last 5/10/20 s, Instant Replay, Play to Output, Return to Live (back to whatever was live before), Play Highlights (starred events back-to-back).
- Event list with labels, stars, filter; transitions into/out of replay (Quick Play, Cut or a Stinger), auto-return, pre-roll.
- Clips are frame-accurate to the out point; buffer segments shortened to 1 s.
- New functions: ReplayCamera1–8, ReplayReturnToLive, ReplayPlay, ReplayPause, ReplayPlayHighlights, ReplayJog.

### Fixes
- Seeking media before it has loaded now waits for the file instead of jumping to 0.
- Media-file inputs used as replay cameras start reliably.

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
