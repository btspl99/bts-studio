# bts-audio

Native pro-audio helper for BTS Studio: ASIO, WASAPI (shared or exclusive), WDM-KS and MME devices through
PortAudio, with a VST3 effect chain. BTS Studio starts one process per *Audio Device (Pro)* input and one per
*Pro audio output*. Audio is always 48 kHz.

## Command line

| Command | What it does |
|---|---|
| `bts-audio --list` | Prints `{"hostApis":[…],"devices":[{id,name,hostApi,maxIn,maxOut,defaultRate,lowLatencyMs}]}` |
| `bts-audio --in <id> [--channels N] [--pair K \| --mono C] [--exclusive] [--vst file.vst3]…` | Captures from device `id`; channel pair `K` (0 = 1+2, 1 = 3+4 …) or one channel `C` (0-based) as mono→stereo; runs the VST3 chain; writes **s16le stereo 48 kHz** to stdout |
| `bts-audio --test-tone [--vst file.vst3]…` | Same, with a 440 / 660 Hz test tone instead of a device |
| `bts-audio --out <id> [--pair K] [--exclusive]` | Reads **s16le stereo 48 kHz** from stdin and plays it on device `id` (channels 2K+1 / 2K+2) |
| `bts-audio --vst-info file.vst3` | Prints the plug-in name, channel counts and parameters as JSON |

`--exclusive` uses WASAPI exclusive mode (lowest latency, the device is reserved for BTS Studio). ASIO
devices are always exclusive and use the buffer size set in the driver's control panel; the device must
run at 48 kHz.

## Control (stdin, `--in` / `--test-tone` only) — one JSON object per line

`{"cmd":"editor","index":0}` open the plug-in window (Windows) · `{"cmd":"closeEditor","index":0}` ·
`{"cmd":"bypass","index":0,"value":true}` · `{"cmd":"param","index":0,"id":1,"value":0.25}` (normalised 0–1) ·
`{"cmd":"params","index":0}` · `{"cmd":"getState","index":0}` · `{"cmd":"setState","index":0,"state":"…"}` ·
`{"cmd":"chain"}` · `{"cmd":"quit"}`. Closing stdin also stops the helper.

## Events (stderr) — one JSON object per line

`started` (device, channels, latencyMs), `plugin` (index, name), `params`, `state` (base64 component +
"." + controller state), `stateSet`, `bypass`, `editor` (open true/false), `chain`, `error` (message).

## Building

Windows: `build-win.ps1 -OutDir <dir>` (fetches PortAudio v19.7.0, VST3 SDK 3.8.1 and the ASIO SDK 2.3.4).
Linux (for testing, no ASIO): `./fetch-deps.sh && cmake -S . -B build && cmake --build build --target bts-audio`.

## Licences

PortAudio (MIT-style), Steinberg VST3 SDK (MIT), Steinberg ASIO SDK (used under GPLv3, so `bts-audio.exe`
is GPLv3 as a whole; BTS Studio itself stays MIT and talks to it only through pipes).
