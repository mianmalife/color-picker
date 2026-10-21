$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$appDirectory = Join-Path $projectRoot 'release\win-unpacked'
$zipPath = Join-Path $projectRoot ("release\Color Picker-{0}-win.zip" -f $package.version)
$temporaryZip = "$zipPath.tmp"

if (-not (Test-Path -LiteralPath (Join-Path $appDirectory 'Color Picker.exe') -PathType Leaf)) {
    throw 'Packaged application not found. Run npm run pack first.'
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
    # Keep an existing ZIP until the replacement has been created successfully.
    if (Test-Path -LiteralPath $temporaryZip) {
        Remove-Item -LiteralPath $temporaryZip -Force
    }
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $appDirectory,
        $temporaryZip,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )
    Move-Item -LiteralPath $temporaryZip -Destination $zipPath -Force
    Write-Output "ZIP created: $zipPath"
}
finally {
    if (Test-Path -LiteralPath $temporaryZip) {
        Remove-Item -LiteralPath $temporaryZip -Force
    }
}
