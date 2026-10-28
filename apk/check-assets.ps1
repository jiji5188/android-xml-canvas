# apk/check-assets.ps1 -- verify asset entry names use forward slashes
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$apk = (Resolve-Path "apk/build/app.apk").Path
$zip = [System.IO.Compression.ZipFile]::OpenRead($apk)
$all = @($zip.Entries | ForEach-Object { $_.FullName })
$bad = @($all | Where-Object { $_ -like 'assets*' -and $_ -like '*\*' })
$assets = @($all | Where-Object { $_ -like 'assets/*' })
Write-Host "entries: $($all.Count)  assets(forward slash): $($assets.Count)  bad(backslash): $($bad.Count)"
@('assets/www/xml/index.html', 'assets/www/index.html', 'classes.dex') | ForEach-Object {
  $hit = $all -contains $_
  Write-Host ("  {0} -> {1}" -f $_, $(if ($hit) { 'OK' } else { 'MISSING' }))
}
$js = @($all | Where-Object { $_ -like 'assets/www/_next/static/chunks/*.js' })
Write-Host "js chunks: $($js.Count)"
$zip.Dispose()
