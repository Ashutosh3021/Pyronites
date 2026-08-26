$enc = [System.Text.Encoding]::UTF8
function PostF($url, $cookie, $fpath) {
  & curl.exe -s -X POST $url -b $cookie -F "file=@$fpath"
}
function GetBin($url, $cookie, $out) {
  & curl.exe -s $url -b $cookie --output $out
  Write-Output "downloaded bytes: $((Get-Item $out).Length)"
}
# legacy upload
Write-Output "=== legacy upload ==="
$u = PostF "http://localhost:8000/storage/upload" "c.txt" "test_dl.txt"
$u; Write-Output ""
$ID = ($u | ConvertFrom-Json).id
Write-Output "=== legacy /storage/{id} (metadata, not bytes) ==="
& curl.exe -s "http://localhost:8000/storage/$ID" -b c.txt; Write-Output ""
Write-Output "=== legacy /storage/{id}/download (bytes) ==="
GetBin "http://localhost:8000/storage/$ID/download" "c.txt" "dl_legacy.bin"
Write-Output "=== compare ==="
if ((Get-Content test_dl.txt -Raw) -eq (Get-Content dl_legacy.bin -Raw)) { Write-Output "LEGACY DOWNLOAD MATCHES OK" } else { Write-Output "MISMATCH" }