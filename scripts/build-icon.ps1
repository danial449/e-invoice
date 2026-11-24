# Regenerates build/icon.ico (and the 512px PNGs) from build/icon-source.png.
#
#   powershell -ExecutionPolicy Bypass -File scripts/build-icon.ps1
#
# The source artwork is white line art on transparency, so only its alpha is
# used as a stencil; the ink colour is applied here. Small sizes get less
# padding and several passes, because thin strokes otherwise average away to
# pale grey when downscaled.
param(
  [string]$Source = 'build/icon-source.png',
  [string]$Ink = '#1f2937'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root $Source
if (-not (Test-Path $src)) { throw "Source artwork not found: $src" }

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("icon-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$plan = @(
  @{ s = 16;  inset = 0.04; passes = 4 },
  @{ s = 24;  inset = 0.05; passes = 3 },
  @{ s = 32;  inset = 0.06; passes = 2 },
  @{ s = 48;  inset = 0.08; passes = 2 },
  @{ s = 64;  inset = 0.09; passes = 1 },
  @{ s = 128; inset = 0.11; passes = 1 },
  @{ s = 256; inset = 0.12; passes = 1 },
  @{ s = 512; inset = 0.12; passes = 1 }
)
foreach ($p in $plan) {
  & (Join-Path $PSScriptRoot 'make-icon.ps1') `
    -Source $src -OutFile (Join-Path $tmp "$($p.s).png") `
    -Size $p.s -Ink $Ink -Inset $p.inset -RadiusPct 0.20 -Passes $p.passes | Out-Null
}

node (Join-Path $PSScriptRoot 'pack-ico.js') $tmp (Join-Path $root 'build/icon.ico')
Copy-Item (Join-Path $tmp '512.png') (Join-Path $root 'build/icon.png') -Force
Copy-Item (Join-Path $tmp '512.png') (Join-Path $root 'resources/icon.png') -Force
Remove-Item $tmp -Recurse -Force
Write-Output 'Icon rebuilt: build/icon.ico, build/icon.png, resources/icon.png'
