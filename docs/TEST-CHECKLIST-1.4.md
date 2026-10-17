# BTS Studio 1.4 — Windows test checklist

Run on a real Windows PC with a GPU before publishing. Tick each line; note GPU model and driver version.

## 1. Encoders (Settings → Encoders)
- [ ] The capability table lists hardware H.264 as **available** (NVIDIA / Intel / AMD).
- [ ] FFmpeg encoder list shows NVENC / QSV / AMF entries for your GPU.
- [ ] Stats module → *GPU encode* card shows "hardware".

## 2. Recording quality (1080p30 then 2160p30)
- [ ] Record 2 min with **GPU — shared hardware H.264, Constant quality High**. File plays in VLC and in Premiere/Resolve, no frame drops in Stats.
- [ ] Repeat with **x264**, **NVENC HEVC** (or QSV/AMF), **ProRes 422 HQ (.mov)** and **DNxHR HQ (.mov)**.
- [ ] Lossless quality: file is large and visually identical to the source.
- [ ] Pull the power / kill the process during an MP4 recording → the MP4 still opens (fragmented MP4).

## 3. Streaming
- [ ] Stream to YouTube (or a local RTMP server) and record at the same time; Stats shows **one** shared encode.
- [ ] Two destinations at different resolutions (e.g. 1080p + 720p) both work.
- [ ] Unplug the network for 20 s: the app stays responsive, Stats shows dropped frames, stream reconnects.

## 4. 4K load (the vMix test)
- [ ] Project at **3840×2160 30p**: 4 × 4K video files + 2 cameras + 3 titles + 1 virtual set, colour correction on all.
- [ ] Output FPS stays at 30 in Stats for 30 min; *Render ms* stays under 25 ms; Load level stays Normal/Light.
- [ ] Record + stream together at 4K for 15 min; memory in Stats does not keep rising.

## 5. Lip-sync
- [ ] Clap test with a camera + mic: record 30 s, check in an editor. Offset under 1 frame; if not, set *Audio offset* in Settings → Encoders and retest.

## 6. Multiview & external monitors
- [ ] Multiview 1 on a second monitor (Settings → External outputs): tally borders follow Cut, meters move.
- [ ] Multiview 2 with a different layout on a third monitor at the same time.
- [ ] Right-click a cell → assign input works; click → Preview; double-click → Cut.

## 7. Title Editor
- [ ] Open a template → Edit; move, resize (Shift / Alt), rotate, align, undo/redo.
- [ ] Set per-object animations, drag bars on the timeline, play In/Out.
- [ ] Apply → take the title live with an overlay: animation matches the editor.
- [ ] Installed fonts appear in the font list.
- [ ] 4K canvas title on a 4K project is sharp.

## 8. General
- [ ] Ctrl+K command palette, Settings search.
- [ ] Open a 1.3 project: everything loads.
- [ ] Auto-update from studio.btspl.tech works from 1.3.0 → 1.4.0.
