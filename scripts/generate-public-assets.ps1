# All raster assets are drawn from a fresh bitmap. No product image is read.
# Uses only the .NET drawing library supplied by Windows; no download or API.
param()
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$assetRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'assets'))
$requiredRoot = [IO.Path]::GetFullPath('E:\Codex工作盘') + [IO.Path]::DirectorySeparatorChar
if (-not $assetRoot.StartsWith($requiredRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Generate these public assets in a project under E:\Codex工作盘.'
}
$assetPrefix = $assetRoot + [IO.Path]::DirectorySeparatorChar
$generated = New-Object System.Collections.Generic.List[object]
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Asset-Path([string]$relative) {
    $target = [IO.Path]::GetFullPath((Join-Path $assetRoot $relative))
    if (-not $target.StartsWith($assetPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Asset path must stay inside public assets.' }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
    return $target
}
function Read-AssetJson([string]$relative) {
    return [IO.File]::ReadAllText((Asset-Path $relative), [Text.Encoding]::UTF8) | ConvertFrom-Json
}
function Write-AssetJson([string]$relative, $value) {
    [IO.File]::WriteAllText((Asset-Path $relative), ($value | ConvertTo-Json -Depth 100) + [Environment]::NewLine, $utf8)
}
function Remove-PrivateMetadata($value) {
    if ($null -eq $value) { return }
    if ($value -is [Array]) {
        foreach ($entry in $value) { Remove-PrivateMetadata $entry }
    } elseif ($value -is [pscustomobject]) {
        foreach ($property in @($value.PSObject.Properties)) {
            if ($property.Name -match '^(source|sources|sourcePath|sourceKey|removedToolbar|footerTruncation|policy)$|sha256|copiedExactly|retainedOtherPixelsExactly|coveredSourceContentCannotRecover') {
                $value.PSObject.Properties.Remove($property.Name)
            } else {
                Remove-PrivateMetadata $property.Value
            }
        }
    }
}
function Empty-SampleValues($table) {
    $rows = New-Object System.Collections.Generic.List[object]
    for ($row = 0; $row -lt $table.dataRows.Count; $row++) {
        $cells = @(); for ($column = 0; $column -lt $table.columnCount; $column++) { $cells += '' }
        $rows.Add($cells)
    }
    $table.referenceSampleValues = $rows.ToArray()
}

$manifest = Read-AssetJson 'turntide-template/manifest.json'
$four = Read-AssetJson 'turntide-template/geometry.json'
$pants = Read-AssetJson 'pants-reference/geometry.json'
# Save only the geometry that affects layout. This assertion protects table
# coordinates and photo frames while removing private provenance/sample text.
$layoutBefore = $manifest.layout | ConvertTo-Json -Depth 100 -Compress
$coordinateBefore = @($four.blocks.size.table.colBounds, $four.blocks.size.table.columnCenters,
    $four.blocks.size.table.dataRows, $pants.blocks.size.table.colBounds,
    $pants.blocks.size.table.columnCenters, $pants.blocks.size.table.dataRows,
    $pants.blocks.recommendation.table.colBounds, $pants.blocks.recommendation.table.columnCenters,
    $pants.blocks.recommendation.table.dataRows) | ConvertTo-Json -Depth 100 -Compress
foreach ($document in @($manifest, $four, $pants)) { Remove-PrivateMetadata $document }
$manifest.name = '服装详情 · 四板块公开模板'
$manifest.hero[0].asset = 'assets/turntide-template/hero.png'
$manifest.hero[0].name = '上传首图 · 自有占位图'
$manifest.footer[0].name = '购买提示 · 自有通用占位'
$manifest.layout.models.caption.brand.text = '服装展示'
$manifest.layout.models.caption.year.text = '产品图片'
$four.coordinateSystem = 'Local template pixels. Public bitmap is freshly drawn; cell and frame coordinates remain fixed.'
$pants.coordinateSystem = $four.coordinateSystem
Empty-SampleValues $four.blocks.size.table
if ($manifest.size.table) { Empty-SampleValues $manifest.size.table }
Empty-SampleValues $pants.blocks.size.table
Empty-SampleValues $pants.blocks.recommendation.table
for ($column = 1; $column -lt $pants.blocks.recommendation.table.columns.Count; $column++) {
    $pants.blocks.recommendation.table.columns[$column] = ''
}
$manifest | Add-Member -NotePropertyName publicAssets -NotePropertyValue $true -Force
$publicPolicy = [pscustomobject]@{
    rasterOrigin = 'Fresh blank bitmap and original vector/text drawing; no user product image pixels.'
    editableData = 'Blank. Supply your own verified product measurements before export.'
    geometry = 'Existing layout dimensions, row/column coordinates and cell masks retained for compatibility.'
}
foreach ($document in @($manifest, $four, $pants)) { $document | Add-Member -NotePropertyName policy -NotePropertyValue $publicPolicy -Force }
$coordinateAfter = @($four.blocks.size.table.colBounds, $four.blocks.size.table.columnCenters,
    $four.blocks.size.table.dataRows, $pants.blocks.size.table.colBounds,
    $pants.blocks.size.table.columnCenters, $pants.blocks.size.table.dataRows,
    $pants.blocks.recommendation.table.colBounds, $pants.blocks.recommendation.table.columnCenters,
    $pants.blocks.recommendation.table.dataRows) | ConvertTo-Json -Depth 100 -Compress
if ($coordinateBefore -ne $coordinateAfter) { throw 'Table coordinates unexpectedly changed.' }
# Caption text is intentionally sanitized; compare positions, not the text.
$layoutCleanBefore = $layoutBefore | ConvertFrom-Json
$layoutCleanBefore.models.caption.brand.text = '服装展示'; $layoutCleanBefore.models.caption.year.text = '产品图片'
if (($layoutCleanBefore | ConvertTo-Json -Depth 100 -Compress) -ne ($manifest.layout | ConvertTo-Json -Depth 100 -Compress)) { throw 'Layout unexpectedly changed.' }
Write-AssetJson 'turntide-template/manifest.json' $manifest
Write-AssetJson 'turntide-template/geometry.json' $four
Write-AssetJson 'pants-reference/geometry.json' $pants

function New-Canvas([int]$width, [int]$height) {
    $bitmap = New-Object System.Drawing.Bitmap($width, $height, [Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([Drawing.Color]::White)
    return [pscustomobject]@{ Bitmap = $bitmap; G = $graphics; W = $width; H = $height }
}
function Draw-Text($canvas, [string]$text, [float]$x, [float]$y, [float]$width, [float]$height,
    [float]$size, [string]$color = '#171C1A', [bool]$bold = $false, [string]$align = 'Center') {
    $style = [Drawing.FontStyle]::Regular; if ($bold) { $style = [Drawing.FontStyle]::Bold }
    $font = New-Object Drawing.Font('Microsoft YaHei', $size, $style, [Drawing.GraphicsUnit]::Pixel)
    $brush = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml($color))
    $format = New-Object Drawing.StringFormat
    $format.Alignment = [Drawing.StringAlignment]::$align
    $format.LineAlignment = [Drawing.StringAlignment]::Center
    $format.Trimming = [Drawing.StringTrimming]::EllipsisCharacter
    try { $canvas.G.DrawString($text, $font, $brush, (New-Object Drawing.RectangleF($x, $y, $width, $height)), $format) }
    finally { $format.Dispose(); $brush.Dispose(); $font.Dispose() }
}
function Fill-Rect($canvas, [string]$color, [float]$x, [float]$y, [float]$w, [float]$h) {
    $brush = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml($color))
    try { $canvas.G.FillRectangle($brush, $x, $y, $w, $h) } finally { $brush.Dispose() }
}
function Draw-Line($canvas, [float]$x1, [float]$y1, [float]$x2, [float]$y2, [string]$color = '#242A27', [float]$width = 2) {
    $pen = New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml($color), $width)
    try { $canvas.G.DrawLine($pen, $x1, $y1, $x2, $y2) } finally { $pen.Dispose() }
}
function Save-Canvas($canvas, [string]$relative) {
    $target = Asset-Path $relative
    try {
        if ([IO.Path]::GetExtension($target) -eq '.jpg') {
            $codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
            $parameters = New-Object Drawing.Imaging.EncoderParameters(1)
            $parameters.Param[0] = New-Object Drawing.Imaging.EncoderParameter([Drawing.Imaging.Encoder]::Quality, [long]92)
            try { $canvas.Bitmap.Save($target, $codec, $parameters) } finally { $parameters.Dispose() }
        } else { $canvas.Bitmap.Save($target, [Drawing.Imaging.ImageFormat]::Png) }
        $generated.Add([pscustomobject]@{ asset = 'assets/' + $relative.Replace('\', '/'); width = $canvas.W; height = $canvas.H; bytes = (Get-Item -LiteralPath $target).Length })
    } finally { $canvas.G.Dispose(); $canvas.Bitmap.Dispose() }
}
function Draw-PictureSymbol($canvas, [float]$cx, [float]$cy, [float]$scale) {
    $pen = New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml('#9AA8A1'), [float](3 * $scale))
    try {
        $canvas.G.DrawRectangle($pen, [float]($cx - 62 * $scale), [float]($cy - 45 * $scale), [float](124 * $scale), [float](90 * $scale))
        $canvas.G.DrawEllipse($pen, [float]($cx + 21 * $scale), [float]($cy - 26 * $scale), [float](15 * $scale), [float](15 * $scale))
        $points = [Drawing.PointF[]]@((New-Object Drawing.PointF(($cx - 49 * $scale), ($cy + 29 * $scale))), (New-Object Drawing.PointF(($cx - 15 * $scale), ($cy - 5 * $scale))), (New-Object Drawing.PointF(($cx + 8 * $scale), ($cy + 18 * $scale))), (New-Object Drawing.PointF(($cx + 27 * $scale), ($cy + 2 * $scale))), (New-Object Drawing.PointF(($cx + 49 * $scale), ($cy + 29 * $scale))))
        $canvas.G.DrawLines($pen, $points)
    } finally { $pen.Dispose() }
}
function Make-Placeholder([string]$relative, [int]$w, [int]$h, [string]$title, [string]$subtitle) {
    $canvas = New-Canvas $w $h
    Fill-Rect $canvas '#F2F5F2' 0 0 $w $h
    $padding = [Math]::Max(18, [Math]::Round($w * .075))
    $pen = New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml('#D5DFD8'), 2)
    $pen.DashStyle = [Drawing.Drawing2D.DashStyle]::Dash
    try { $canvas.G.DrawRectangle($pen, [float]$padding, [float]$padding, [float]($w - 2 * $padding), [float]($h - 2 * $padding)) } finally { $pen.Dispose() }
    $scale = [Math]::Max(.7, $w / 700)
    Draw-PictureSymbol $canvas ($w / 2) ($h * .42) $scale
    Draw-Text $canvas $title $padding ($h * .53) ($w - 2 * $padding) ($h * .11) ([Math]::Max(21, $w * .043)) '#28382F' $true
    Draw-Text $canvas $subtitle $padding ($h * .65) ($w - 2 * $padding) ($h * .08) ([Math]::Max(14, $w * .022)) '#718078'
    Draw-Text $canvas '公开版占位素材' $padding ($h - $padding - 40 * $scale) ($w - 2 * $padding) (30 * $scale) ([Math]::Max(11, $w * .013)) '#8C9891'
    Save-Canvas $canvas $relative
}
function Draw-Table($canvas, $table, [bool]$blackHeader) {
    $left = [float]$table.colBounds[0]; $right = [float]$table.colBounds[-1]
    $top = [float]$table.headerRow.top; $bottom = [float]$table.headerRow.bottom
    if ($blackHeader) { Fill-Rect $canvas '#151515' $left $top ($right - $left) ($bottom - $top) }
    for ($column = 0; $column -lt $table.columnCount; $column++) {
        $a = [float]$table.colBounds[$column]; $b = [float]$table.colBounds[$column + 1]
        $textColor = '#161616'; if ($blackHeader) { $textColor = '#FFFFFF' }
        $fontSize = [Math]::Min(25, ($b - $a) / 4.4)
        if ([string]$table.columns[$column] -match 'SIZE') { $fontSize = 24 }
        Draw-Text $canvas ([string]$table.columns[$column]) $a $top ($b - $a) ($bottom - $top) $fontSize $textColor $true
    }
    foreach ($row in $table.dataRows) {
        Fill-Rect $canvas ([string]$row.background) $left ([float]$row.top) ($right - $left) ([float]($row.bottom - $row.top))
        Draw-Line $canvas $left ([float]$row.bottom) $right ([float]$row.bottom) '#B6B6B6' 1
    }
    Draw-Line $canvas $left $bottom $right $bottom '#555555' 1
}
function Draw-Arrow($canvas, [float]$x1, [float]$y1, [float]$x2, [float]$y2) {
    $pen = New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml('#75857B'), 1.6)
    $pen.StartCap = [Drawing.Drawing2D.LineCap]::ArrowAnchor
    $pen.EndCap = [Drawing.Drawing2D.LineCap]::ArrowAnchor
    try { $canvas.G.DrawLine($pen, $x1, $y1, $x2, $y2) } finally { $pen.Dispose() }
}
function Draw-Pants($canvas, [float]$x, [float]$y, [float]$w, [float]$h) {
    $points = [Drawing.PointF[]]@((New-Object Drawing.PointF(($x + .22*$w), $y)), (New-Object Drawing.PointF(($x + .78*$w), $y)), (New-Object Drawing.PointF(($x + .86*$w), ($y + .92*$h))), (New-Object Drawing.PointF(($x + .60*$w), ($y + $h))), (New-Object Drawing.PointF(($x + .5*$w), ($y + .40*$h))), (New-Object Drawing.PointF(($x + .40*$w), ($y + $h))), (New-Object Drawing.PointF(($x + .14*$w), ($y + .92*$h))))
    $pen = New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml('#313A35'), 2.3)
    $brush = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#F5F7F5'))
    try { $canvas.G.FillPolygon($brush, $points); $canvas.G.DrawPolygon($pen, $points) } finally { $pen.Dispose(); $brush.Dispose() }
    Draw-Line $canvas ($x + .22*$w) ($y + .07*$h) ($x + .78*$w) ($y + .07*$h) '#313A35' 1.5
    Draw-Line $canvas ($x + .5*$w) ($y + .07*$h) ($x + .5*$w) ($y + .32*$h) '#818C85' 1.5
    Draw-Arrow $canvas ($x + .24*$w) ($y - .05*$h) ($x + .76*$w) ($y - .05*$h)
    Draw-Text $canvas '腰围' $x ($y - .145*$h) $w (.07*$h) 15 '#414D45'
    Draw-Arrow $canvas ($x + .28*$w) ($y + .2*$h) ($x + .72*$w) ($y + .2*$h)
    Draw-Text $canvas '臀围' $x ($y + .22*$h) $w (.07*$h) 15 '#414D45'
    Draw-Arrow $canvas ($x + .91*$w) $y ($x + .91*$w) ($y + .94*$h)
    Draw-Text $canvas '裤长' ($x + .71*$w) ($y + .56*$h) (.28*$w) (.08*$h) 14 '#414D45'
    Draw-Arrow $canvas ($x + .18*$w) ($y + .94*$h) ($x + .38*$w) ($y + .98*$h)
    Draw-Text $canvas '裤脚' ($x + .02*$w) ($y + 1.01*$h) (.56*$w) (.08*$h) 14 '#414D45'
}

Make-Placeholder 'cover.jpg' 1440 1920 '上传首图' '点击图片板块，替换为你的产品图片'
Make-Placeholder 'look.jpg' 1440 1920 '上传模特图' '保留原图比例，展示服装穿着效果'
foreach ($group in @('hero', 'details', 'models')) {
    foreach ($item in $manifest.$group) {
        $title = '上传首图'; $subtitle = '点击更换你的产品图片'
        if ($group -eq 'details') { $title = '上传细节图'; $subtitle = '面料 · 工艺 · 局部展示' }
        if ($group -eq 'models') { $title = '上传模特图'; $subtitle = '替换为你的服装展示图片' }
        Make-Placeholder ($item.asset -replace '^assets/', '') $item.width $item.height $title $subtitle
    }
}

foreach ($relative in @('turntide-template/size-template.png', 'turntide-template/size-original.png')) {
    $block = $four.blocks.size; $canvas = New-Canvas $block.width $block.height
    Draw-Text $canvas '尺码信息' 140 14 818 42 31 '#171717' $true
    Draw-Table $canvas $block.table $false
    Draw-Text $canvas '请填入实际测量数据，核对单位后使用。' 140 424 818 38 24 '#333333'
    Draw-Text $canvas '测量方式与误差说明请按商品实际情况填写。' 140 469 818 38 22 '#555555'
    Save-Canvas $canvas $relative
}
foreach ($relative in @('pants-reference/size-template.png', 'pants-reference/size-original.png')) {
    $block = $pants.blocks.size; $canvas = New-Canvas $block.width $block.height
    Draw-Text $canvas '商品信息' 322 30 450 51 37 '#111111' $true
    Draw-Text $canvas '尺码表' 322 84 450 36 22 '#414141'
    Draw-Text $canvas '单位请与上传的尺码表保持一致' 300 141 582 42 21 '#454545'
    Draw-Table $canvas $block.table $true
    Draw-Pants $canvas 10 310 240 337
    Draw-Text $canvas '平铺测量示意' 10 678 240 34 18 '#4D5B52'
    Draw-Text $canvas '数据仅由用户填写，请核对后导出。' 294 628 590 34 22 '#414141'
    Draw-Text $canvas '测量方式及误差范围请按实际商品说明。' 294 666 590 42 20 '#555555'
    Save-Canvas $canvas $relative
}
foreach ($relative in @('pants-reference/recommendation-template.png', 'pants-reference/recommendation-original.png')) {
    $block = $pants.blocks.recommendation; $canvas = New-Canvas $block.width $block.height
    Draw-Text $canvas '尺码建议（请填写并核对）' 12 3 875 40 25 '#111111' $true
    Draw-Table $canvas $block.table $true
    Save-Canvas $canvas $relative
}
$canvas = New-Canvas $pants.measurementDiagram.width $pants.measurementDiagram.height
Draw-Pants $canvas 5 68 240 320
Draw-Text $canvas '平铺测量示意' 3 427 252 30 17 '#414D45'
Save-Canvas $canvas ($pants.measurementDiagram.asset -replace '^assets/', '')
$canvas = New-Canvas $pants.informationTitle.width $pants.informationTitle.height
Draw-Text $canvas '商品信息' 0 1 255 48 34 '#111111' $true
Draw-Text $canvas 'PRODUCT INFORMATION' 0 48 255 30 13 '#515151'
Save-Canvas $canvas ($pants.informationTitle.asset -replace '^assets/', '')

foreach ($item in $manifest.footer) {
    $canvas = New-Canvas $item.width $item.height
    Draw-Text $canvas '购买提示' 85 83 856 62 44 '#151515' $true
    Draw-Text $canvas '使用前请补充你的店铺服务说明' 85 159 856 46 24 '#555555'
    $sections = @(@('尺码与测量', '请填写真实尺码数据，并说明适用的测量方式。'), @('图片与实物', '使用你有权公开的商品图片，并准确描述产品信息。'), @('售后与服务', '请按店铺实际服务规则填写联系方式及售后说明。'))
    $y = 272
    foreach ($section in $sections) {
        Draw-Line $canvas 105 ($y - 20) 921 ($y - 20) '#DADADA' 1
        Draw-Text $canvas $section[0] 105 $y 816 48 30 '#222222' $true 'Near'
        Draw-Text $canvas $section[1] 105 ($y + 61) 816 62 24 '#555555' $false 'Near'
        $y += 176
    }
    Save-Canvas $canvas ($item.asset -replace '^assets/', '')
}
$report = [pscustomobject]@{ version = 1; generatedFromBlank = $true; tableCoordinatesPreserved = $true; layoutPreserved = $true; assets = $generated.ToArray() }
Write-AssetJson 'public-assets.json' $report
Write-Output ('Generated {0} public images inside {1}' -f $generated.Count, $assetRoot)
Write-Output 'Private image files were not read. Layout and table coordinate assertions passed.'
