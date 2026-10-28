# apk/add-assets.ps1 -- write the static site into the APK with forward slashes.
#
# Why: aapt2 on Windows stores asset subdirectories with backslashes
# (assets/www\xml\index.html). AssetManager only resolves forward slashes,
# so every asset lookup fails and the WebView shows a blank page.
# This script deletes aapt2's entries and rewrites them properly.
param(
  [Parameter(Mandatory = $true)][string]$Apk,
  [Parameter(Mandatory = $true)][string]$AssetsDir
)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$apkFull = (Resolve-Path $Apk).Path
$root = (Resolve-Path $AssetsDir).Path
$zip = [System.IO.Compression.ZipFile]::Open($apkFull, 'Update')

$stale = @($zip.Entries | Where-Object { $_.FullName -like 'assets*' })
foreach ($e in $stale) { $e.Delete() }
Write-Host "removed stale assets entries: $($stale.Count)"

$count = 0
Get-ChildItem $root -Recurse -File | ForEach-Object {
  $rel = $_.FullName.Substring($root.Length).TrimStart('\', '/')
  $name = 'assets/www/' + ($rel -replace '\\', '/')
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
    $zip, $_.FullName, $name,
    [System.IO.Compression.CompressionLevel]::NoCompression) | Out-Null
  $count++
}
$zip.Dispose()
Write-Host "wrote assets entries: $count"
