# Builds bts-decklink.exe (Blackmagic DeckLink playout + hardware keyer) with MIDL + MSVC (x64, Release).
param([Parameter(Mandatory = $true)][string]$OutDir)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$build = Join-Path $here 'build'
New-Item -ItemType Directory -Force -Path $build, $OutDir | Out-Null

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Visual Studio with C++ tools not found' }
$vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvars64.bat'

$sdk = Join-Path $here 'sdk'
$cmd = @"
call "$vcvars" >nul
cd /d "$build"
midl /nologo /env x64 /W1 /I "$sdk" /h DeckLinkAPI_h.h /iid DeckLinkAPI_i.c /tlb DeckLinkAPI.tlb "$sdk\DeckLinkAPI.idl" || exit /b 1
cl /nologo /O2 /EHsc /MT /std:c++17 /W3 /DUNICODE /D_UNICODE /I "$build" /I "$sdk" "$here\bts-decklink.cpp" DeckLinkAPI_i.c /Fe:bts-decklink.exe /link ole32.lib oleaut32.lib || exit /b 1
"@
$bat = Join-Path $build 'build.cmd'
Set-Content -Path $bat -Value $cmd -Encoding ASCII
& cmd /c $bat
if ($LASTEXITCODE -ne 0) { throw "bts-decklink build failed ($LASTEXITCODE)" }

Copy-Item (Join-Path $build 'bts-decklink.exe') $OutDir -Force
Copy-Item (Join-Path $here 'LICENSE-DeckLinkAPI.txt') $OutDir -Force
# smoke test: without a DeckLink driver --list must still exit 0 with driver:false
$list = & (Join-Path $OutDir 'bts-decklink.exe') --list
Write-Host "bts-decklink --list => $list"
if ($LASTEXITCODE -ne 0) { throw "bts-decklink --list exited $LASTEXITCODE" }
& (Join-Path $OutDir 'bts-decklink.exe') --version
