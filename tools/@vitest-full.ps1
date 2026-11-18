Set-Location D:\android-xml-canvas\repo
& D:\android-xml-canvas\repo\node_modules\.bin\vitest.cmd run > D:\android-xml-canvas\repo\vitest-full.log 2>&1
"EXIT=" + $LASTEXITCODE | Out-File -Append D:\android-xml-canvas\repo\vitest-full.log
