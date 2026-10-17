# Builds bts-audio.exe (PortAudio with ASIO / WASAPI / WDM-KS / MME + VST3 host) — Windows x64, VS 2022.
param([Parameter(Mandatory = $true)][string]$OutDir)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$deps = Join-Path $here 'deps'
New-Item -ItemType Directory -Force -Path $deps, $OutDir | Out-Null

function Fetch-Git($url, $tag, $dir, [switch]$Submodules) {
  if (Test-Path (Join-Path $deps $dir)) { return }
  $args = @('clone', '-q', '--depth', '1', '--branch', $tag)
  if ($Submodules) { $args += @('--recurse-submodules', '--shallow-submodules') }
  & git @args $url (Join-Path $deps $dir)
  if ($LASTEXITCODE) { throw "git clone $url failed" }
}
Fetch-Git 'https://github.com/PortAudio/portaudio' 'v19.7.0' 'portaudio'
Fetch-Git 'https://github.com/steinbergmedia/vst3sdk' 'v3.8.1_build_84' 'vst3sdk' -Submodules

# Steinberg ASIO SDK 2.3.4 (dual licence: Steinberg ASIO licence or GPLv3 — BTS Studio uses it under GPLv3)
$asio = Join-Path $deps 'asiosdk'
if (-not (Test-Path (Join-Path $asio 'common/asio.h'))) {
  $zip = Join-Path $deps 'asiosdk.zip'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://download.steinberg.net/sdk_downloads/ASIO-SDK_2.3.4_2025-10-15.zip' -OutFile $zip
  $tmp = Join-Path $deps 'asio-unzip'
  Expand-Archive -Force $zip $tmp
  $root = (Get-ChildItem -Recurse -Filter asio.h $tmp | Where-Object { $_.Directory.Name -eq 'common' } | Select-Object -First 1).Directory.Parent.FullName
  if (-not $root) { throw 'ASIO SDK layout not recognised' }
  Move-Item $root $asio
}

$build = Join-Path $here 'build'
cmake -S $here -B $build -G 'Visual Studio 17 2022' -A x64 "-DDEPS_DIR=$deps"
if ($LASTEXITCODE) { throw 'cmake configure failed' }
cmake --build $build --config Release --target bts-audio --parallel
if ($LASTEXITCODE) { throw 'cmake build failed' }

$exe = Get-ChildItem -Recurse -Filter bts-audio.exe $build | Where-Object { $_.FullName -match 'Release' } | Select-Object -First 1
Copy-Item $exe.FullName $OutDir
$lic = Join-Path $OutDir 'licenses'
New-Item -ItemType Directory -Force -Path $lic | Out-Null
Copy-Item (Join-Path $deps 'portaudio/LICENSE.txt') (Join-Path $lic 'PortAudio-LICENSE.txt')
Copy-Item (Join-Path $deps 'vst3sdk/LICENSE.txt') (Join-Path $lic 'VST3-SDK-LICENSE.txt')
Copy-Item (Join-Path $asio 'common/LICENSE.txt') (Join-Path $lic 'ASIO-SDK-LICENSE.txt')
Copy-Item (Join-Path $here 'README.md') $OutDir
Set-Content -Path (Join-Path $lic 'NOTICE.txt') -Value @"
bts-audio.exe is part of BTS Studio (MIT). It contains:
 - PortAudio v19.7.0 (MIT-style licence) — https://github.com/PortAudio/portaudio
 - Steinberg VST3 SDK 3.8.1 (MIT licence) — VST is a registered trademark of Steinberg Media Technologies GmbH
 - Steinberg ASIO SDK 2.3.4, used under the GNU General Public License v3 — ASIO is a trademark and software of Steinberg Media Technologies GmbH.
   Because of the ASIO SDK, bts-audio.exe as a whole is distributed under the GPLv3. Its source code is in the
   BTS Studio repository: https://github.com/btspl99/bts-studio/tree/main/native/audio
"@
Write-Host "bts-audio built: $((Get-Item (Join-Path $OutDir 'bts-audio.exe')).Length) bytes"
