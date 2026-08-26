$enc = [System.Text.Encoding]::UTF8
function Post($url, $bodyObj, $cookie) {
  $j = $bodyObj | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText("req.json", $j, $enc)
  $args = @("-s","-X","POST",$url,"-H","Content-Type: application/json","--data-binary","@req.json")
  if ($cookie) { $args += "-b"; $args += $cookie; $args += "-c"; $args += $cookie }
  & curl.exe @args
}
function GetJ($url, $cookie) {
  $args = @("-s",$url)
  if ($cookie) { $args += "-b"; $args += $cookie }
  & curl.exe @args
}
Post "http://localhost:8000/auth/signup" (@{"email"="verify@example.com";"password"="testpassword123"}) "c.txt"; Write-Output ""
Post "http://localhost:8000/auth/login" (@{"email"="verify@example.com";"password"="testpassword123"}) "c.txt"; Write-Output ""
Write-Output "=== /auth/me ==="; GetJ "http://localhost:8000/auth/me" "c.txt"; Write-Output ""