param(
    [Parameter(Mandatory)][string]$Artwork,
    [string]$Preview
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = (Resolve-Path "$PSScriptRoot/..").Path
$image = [Drawing.Image]::FromFile((Resolve-Path -LiteralPath $Artwork).Path)
$cream = [Drawing.ColorTranslator]::FromHtml('#fff4df')
if ($image.Width -ne $image.Height -or $image.Width -lt 1024) {
    $image.Dispose()
    throw 'Use the square approved master at 1024 pixels or larger.'
}

function Write-Icon($Path, [int]$Size, [double]$Scale, [string]$Shape) {
    $format = if ($Shape -eq 'opaque') { 'Format24bppRgb' } else { 'Format32bppArgb' }
    $bitmap = [Drawing.Bitmap]::new($Size, $Size, $format)
    $g = [Drawing.Graphics]::FromImage($bitmap)
    $brush = [Drawing.SolidBrush]::new($cream)
    try {
        $g.SmoothingMode = 'AntiAlias'
        $g.InterpolationMode = 'HighQualityBicubic'
        $g.PixelOffsetMode = 'HighQuality'
        $g.Clear([Drawing.Color]::Transparent)
        if ($Shape -eq 'opaque') { $g.Clear($cream) }
        if ($Shape -eq 'round') { $g.FillEllipse($brush, 0, 0, $Size, $Size) }
        $inset = [int][Math]::Round($Size * (1 - $Scale) / 2)
        $side = $Size - 2 * $inset
        if ($Shape -eq 'round') {
            $mask = [Drawing.Drawing2D.GraphicsPath]::new()
            $mask.AddEllipse(0, 0, $Size, $Size)
            $g.SetClip($mask)
            $mask.Dispose()
        }
        $g.DrawImage($image, $inset, $inset, $side, $side)
        $bitmap.Save($Path, [Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $brush.Dispose()
        $g.Dispose()
        $bitmap.Dispose()
    }
}

try {
    $res = "$root/mobile/android/app/src/main/res"
    $ios = "$root/mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset"
    Write-Icon "$ios/AppIcon-512@2x.png" 1024 0.92 opaque
    $sizes = [ordered]@{ mdpi = 48; hdpi = 72; xhdpi = 96; xxhdpi = 144; xxxhdpi = 192 }
    foreach ($density in $sizes.Keys) {
        $size = $sizes[$density]
        $folder = "$res/mipmap-$density"
        Write-Icon "$folder/ic_launcher.png" $size 0.92 opaque
        Write-Icon "$folder/ic_launcher_round.png" $size 0.88 round
        Write-Icon "$folder/ic_launcher_foreground.png" ([int]($size * 108 / 48)) (60/108) transparent
    }
    $file = "$res/values/ic_launcher_background.xml"
    (Get-Content $file -Raw) -replace '#[0-9a-fA-F]{6,8}', '#FFF4DF' | Set-Content $file
    if ($Preview) {
        $directory = (New-Item -ItemType Directory -Force $Preview).FullName
        Write-Icon "$directory/ios-60.png" 60 0.92 opaque
        Write-Icon "$directory/android-48.png" 48 (60/72) round
        Write-Icon "$directory/small-32.png" 32 (60/72) round
    }
} finally {
    $image.Dispose()
}
