# Builds square PNGs from the supplied box artwork:
#   white rounded-corner background, artwork recoloured to a dark ink.
# The source is pure white with soft alpha, so only its alpha is reused as a
# stencil - the colour comes from -Ink.
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [int]$Size = 256,
  [string]$Ink = '#1f2937',
  [double]$RadiusPct = 0.20,
  [double]$Inset = 0.12,
  # Downscaling thin line art averages the strokes into pale grey. Drawing the
  # artwork over itself builds the alpha back up without altering the shape.
  [int]$Passes = 1
)

Add-Type -AssemblyName System.Drawing

function New-RoundedPath {
  param([int]$W, [int]$H, [single]$R)
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $R * 2
  $p.AddArc(0, 0, $d, $d, 180, 90)
  $p.AddArc($W - $d, 0, $d, $d, 270, 90)
  $p.AddArc($W - $d, $H - $d, $d, $d, 0, 90)
  $p.AddArc(0, $H - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

$src = [System.Drawing.Bitmap]::FromFile($Source)

$inkColor = [System.Drawing.ColorTranslator]::FromHtml($Ink)
# Force RGB to the ink colour, pass the source alpha straight through.
$cm = New-Object System.Drawing.Imaging.ColorMatrix
$cm.Matrix00 = 0; $cm.Matrix01 = 0; $cm.Matrix02 = 0; $cm.Matrix03 = 0; $cm.Matrix04 = 0
$cm.Matrix10 = 0; $cm.Matrix11 = 0; $cm.Matrix12 = 0; $cm.Matrix13 = 0; $cm.Matrix14 = 0
$cm.Matrix20 = 0; $cm.Matrix21 = 0; $cm.Matrix22 = 0; $cm.Matrix23 = 0; $cm.Matrix24 = 0
$cm.Matrix30 = 0; $cm.Matrix31 = 0; $cm.Matrix32 = 0; $cm.Matrix33 = 1; $cm.Matrix34 = 0
$cm.Matrix40 = $inkColor.R / 255.0
$cm.Matrix41 = $inkColor.G / 255.0
$cm.Matrix42 = $inkColor.B / 255.0
$cm.Matrix43 = 0; $cm.Matrix44 = 1
$ia = New-Object System.Drawing.Imaging.ImageAttributes
$ia.SetColorMatrix($cm)

$bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)

# White plate with rounded corners.
$radius = [single]([Math]::Max(2, $Size * $RadiusPct))
$path = New-RoundedPath -W $Size -H $Size -R $radius
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.FillPath($white, $path)

# Keep the artwork inside the plate so it never touches the rounded edge.
$g.SetClip($path)
$pad = [int]($Size * $Inset)
$box = $Size - ($pad * 2)
$dest = New-Object System.Drawing.Rectangle($pad, $pad, $box, $box)
for ($i = 0; $i -lt [Math]::Max(1, $Passes); $i++) {
  $g.DrawImage($src, $dest, 0, 0, $src.Width, $src.Height, [System.Drawing.GraphicsUnit]::Pixel, $ia)
}
$g.ResetClip()

$bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)

$white.Dispose(); $path.Dispose(); $g.Dispose(); $bmp.Dispose(); $src.Dispose(); $ia.Dispose()
Write-Output "wrote $OutFile ($Size px, ink $Ink, passes $Passes)"
