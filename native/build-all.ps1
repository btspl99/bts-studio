# Builds every native helper under native/<name>/build-win.ps1 (Windows, run on GitHub Actions windows-latest).
# Each script must put its outputs in vendor/native/win32-x64/<name>/ ; electron-builder ships that folder
# as resources/native/<name>/.  Pass -Only <name> to build one component.
param([string]$Only = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'vendor/native/win32-x64'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$failed = @()
foreach ($dir in Get-ChildItem -Directory $PSScriptRoot) {
  if ($Only -and $dir.Name -ne $Only) { continue }
  $script = Join-Path $dir.FullName 'build-win.ps1'
  if (-not (Test-Path $script)) { continue }
  Write-Host "=== native/$($dir.Name) ==="
  try { & $script -OutDir (Join-Path $out $dir.Name) } catch { Write-Host "::error::native/$($dir.Name) failed: $_"; $failed += $dir.Name }
}
Get-ChildItem -Recurse $out | Select-Object FullName, Length | Format-Table -AutoSize
if ($failed.Count) { throw "Native builds failed: $($failed -join ', ')" }
