$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$catalogPath = Join-Path $repositoryRoot "public\catalog.js"
$catalog = Get-Content $catalogPath -Raw
$imagePaths = [regex]::Matches($catalog, 'image:\s*"(\./Images/[^"]+)"') |
  ForEach-Object { $_.Groups[1].Value }
$imagePaths += "./Images/Crocheted Heart-Detail Peplum Top.png", "./Images/LOGO.png"
$imagePaths = $imagePaths | Select-Object -Unique
$outputDirectory = Join-Path $repositoryRoot "public\Images\optimized"
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$jpegEncoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
  Where-Object MimeType -eq "image/jpeg"
$encoderParameters = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encoderParameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
  [System.Drawing.Imaging.Encoder]::Quality,
  [long]84
)

foreach ($imagePath in $imagePaths) {
  $sourcePath = Join-Path $repositoryRoot ("public\" + $imagePath.Substring(2).Replace("/", "\"))
  $source = [System.Drawing.Image]::FromFile($sourcePath)
  $bitmap = $null
  $graphics = $null

  try {
    $scale = [math]::Min(1.0, 1000.0 / [math]::Max($source.Width, $source.Height))
    $width = [math]::Max(1, [int][math]::Round($source.Width * $scale))
    $height = [math]::Max(1, [int][math]::Round($source.Height * $scale))
    $bitmap = New-Object System.Drawing.Bitmap(
      $width,
      $height,
      [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
    )
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.Clear([System.Drawing.Color]::FromArgb(248, 244, 236))
    $graphics.DrawImage($source, 0, 0, $width, $height)

    $outputName = [System.IO.Path]::GetFileNameWithoutExtension($sourcePath) + ".jpg"
    $outputPath = Join-Path $outputDirectory $outputName
    $bitmap.Save($outputPath, $jpegEncoder, $encoderParameters)
    Write-Output "Optimized $imagePath -> public\Images\optimized\$outputName"
  } finally {
    if ($graphics) { $graphics.Dispose() }
    if ($bitmap) { $bitmap.Dispose() }
    $source.Dispose()
  }
}

$encoderParameters.Dispose()
