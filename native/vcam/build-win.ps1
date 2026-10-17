# BTS Studio Virtual Camera — a DirectShow virtual camera built from softcam (MIT, https://github.com/tshino/softcam).
# Patched to its own name, CLSID and shared-memory names so it never clashes with other softcam-based cameras.
# Output: bts-vcam.dll (the filter + the sender API scCreateCamera / scSendFrame / scDeleteCamera) and LICENSE.
param([Parameter(Mandatory = $true)][string]$OutDir)
$ErrorActionPreference = 'Stop'
$tag = 'v1.8.1'
$work = Join-Path $env:RUNNER_TEMP 'softcam'
if (-not $env:RUNNER_TEMP) { $work = Join-Path ([IO.Path]::GetTempPath()) 'softcam' }
if (Test-Path $work) { Remove-Item -Recurse -Force $work }
git clone --depth 1 --branch $tag https://github.com/tshino/softcam $work
if ($LASTEXITCODE) { throw 'git clone softcam failed' }

$name = 'BTS Studio Virtual Camera'
# {2549D071-66AE-4F28-8116-6ABFE429F663}
$guidOld = '0xaef3b972, 0x5fa5, 0x4647, 0x95, 0x71, 0x35, 0x8e, 0xb4, 0x72, 0xbc, 0x9e'
$guidNew = '0x2549d071, 0x66ae, 0x4f28, 0x81, 0x16, 0x6a, 0xbf, 0xe4, 0x29, 0xf6, 0x63'
$files = @('src/softcam/softcam.cpp', 'src/softcamcore/DShowSoftcam.cpp', 'src/softcamcore/FrameBuffer.cpp')
foreach ($rel in $files) {
  $p = Join-Path $work $rel
  $t = [IO.File]::ReadAllText($p)
  $t = $t.Replace($guidOld, $guidNew).Replace('DirectShow Softcam', $name)
  [IO.File]::WriteAllText($p, $t)
}
$check = [IO.File]::ReadAllText((Join-Path $work 'src/softcam/softcam.cpp'))
if (-not $check.Contains($guidNew) -or -not $check.Contains($name)) { throw 'softcam patch did not apply' }

Push-Location $work
msbuild softcam.sln /t:softcam /p:Configuration=Release /p:Platform=x64 /m /nologo /v:minimal
$code = $LASTEXITCODE
Pop-Location
if ($code) { throw "msbuild failed ($code)" }

$dll = Get-ChildItem -Recurse -Path $work -Filter softcam.dll | Where-Object { $_.FullName -match 'x64\\Release' } | Select-Object -First 1
if (-not $dll) { throw 'softcam.dll not found after build' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Copy-Item $dll.FullName (Join-Path $OutDir 'bts-vcam.dll')
Copy-Item (Join-Path $work 'LICENSE') (Join-Path $OutDir 'LICENSE-softcam.txt')
Write-Host "Built $(Join-Path $OutDir 'bts-vcam.dll')"
