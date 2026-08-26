$enc = [System.Text.Encoding]::UTF8
# create a fresh backup
$bk = & curl.exe -s -X POST "http://localhost:8000/api/backup" -b c.txt
Write-Output "=== manual backup ==="; $bk; Write-Output ""
$path = ($bk | ConvertFrom-Json).path
# restore from that same backup (round-trip; equivalent state)
$rb = @{ path = $path } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText("req.json", $rb, $enc)
Write-Output "=== restore from backup ==="
& curl.exe -s -X POST "http://localhost:8000/api/backup/restore" -H "Content-Type: application/json" -b c.txt --data-binary "@req.json"; Write-Output ""
Write-Output "=== server still alive? ==="
& curl.exe -s http://localhost:8000/health; Write-Output ""
& curl.exe -s http://localhost:8000/auth/me -b c.txt; Write-Output ""