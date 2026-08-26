$enc = [System.Text.Encoding]::UTF8
function Post($url, $bodyObj, $cookie) {
  $j = $bodyObj | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText("req.json", $j, $enc)
  $a = @("-s","-X","POST",$url,"-H","Content-Type: application/json","--data-binary","@req.json")
  if ($cookie) { $a += "-b"; $a += $cookie; $a += "-c"; $a += $cookie }
  & curl.exe @a
}
function GetJ($url, $cookie) {
  $a = @("-s",$url); if ($cookie) { $a += "-b"; $a += $cookie }
  & curl.exe @a
}
$email = "v2_" + [guid]::NewGuid().ToString("N").Substring(0,8) + "@example.com"
Write-Output "=== signup $email ==="
Post "http://localhost:8000/auth/signup" (@{"email"=$email;"password"="testpassword123"}) "c.txt"; Write-Output ""
Write-Output "=== /auth/me ==="
GetJ "http://localhost:8000/auth/me" "c.txt"; Write-Output ""
Write-Output "=== create project p2 ==="
$pidjson = Post "http://localhost:8000/api/projects" (@{"project_id"="p2";"project_name"="P2"}) "c.txt"
$pidjson; Write-Output ""
$PIDv = ($pidjson | ConvertFrom-Json).id
Write-Output "=== /auth/me after create (should show last_project_id) ==="
GetJ "http://localhost:8000/auth/me" "c.txt"; Write-Output ""
Write-Output "=== select project (POST /api/projects/{id}/select) ==="
Post "http://localhost:8000/api/projects/$PIDv/select" $null "c.txt"; Write-Output ""
Write-Output "=== create table t in project ==="
Post "http://localhost:8000/api/projects/$PIDv/tables" (@{"table"="t";"columns"=@(@{"name"="id";"type"="INTEGER"},@{"name"="v";"type"="TEXT"});"primary_key"="id"}) "c.txt"; Write-Output ""
Write-Output "=== insert row ==="
Post "http://localhost:8000/api/projects/$PIDv/tables/t" (@{"v"="hello"}) "c.txt"; Write-Output ""
Write-Output "=== read row (roundtrip) ==="
GetJ "http://localhost:8000/api/projects/$PIDv/tables/t" "c.txt"; Write-Output ""
Write-Output "=== create API key read+write ==="
$kjson = Post "http://localhost:8000/api/projects/$PIDv/api/keys" (@{"name"="k";"scopes"=@("read","write")}) "c.txt"
$kjson; Write-Output ""
$KEY = ($kjson | ConvertFrom-Json).key
Write-Output "=== E1: SQL with read+write key (should return rows, NOT forbidden) ==="
$sq = @{"sql"="SELECT * FROM t"} | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText("req.json", $sq, $enc)
& curl.exe -s -X POST "http://localhost:8000/api/projects/$PIDv/sql/execute" -H "Content-Type: application/json" -H "Authorization: Bearer $KEY" --data-binary "@req.json"; Write-Output ""