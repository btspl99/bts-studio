#!/bin/bash
# Fetch pinned sources for a local (Linux) build. Windows uses build-win.ps1.
set -e
D="$(cd "$(dirname "$0")" && pwd)/deps"; mkdir -p "$D"; cd "$D"
[ -d portaudio ] || git clone -q --depth 1 --branch v19.7.0 https://github.com/PortAudio/portaudio portaudio
[ -d vst3sdk ] || git clone -q --depth 1 --branch v3.8.1_build_84 --recurse-submodules --shallow-submodules https://github.com/steinbergmedia/vst3sdk vst3sdk
