$enc = [System.Text.Encoding]::UTF8
# refresh session
$j = @{email="v2_ded9acbf@example.com";password="testpassword123"} | ConvertTo-Json -Compress
[IO.File]::WriteAllText("req.json", $j, $enc)
& curl.exe -s -X POST "http://localhost:8000/auth/login" -H "Content-Type: application/json" -b c.txt -c c.txt --data-binary "@req.json"; Write-Output ""
$bk = & curl.exe -s -X POST "http://localhost:8000/api/backup" -b c.txt
Write-Output "=== backup ==="; $bk; Write-Output ""
$path = ($bk | ConvertFrom-Json).path
$rb = @{ path = $path } | ConvertTo-Json -Compress
[IO.File]::WriteAllText("req.json", $rb, $enc)
Write-Output "=== restore ==="
& curl.exe -s -X POST "http://localhost:8000/api/backup/restore" -H "Content-Type: application/json" -b c.txt --data-binary "@req.json"; Write-Output ""
Write-Output "=== health + me ==="
& curl.exe -s http://localhost:8000/health; Write-Output ""
& curl.exe -s http://localhost:8000/auth/me -b c.txt; Write-Output ""