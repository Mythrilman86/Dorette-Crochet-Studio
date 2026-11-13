$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'www'))
$package=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'preview-package.json') -Raw | ConvertFrom-Json
$stateDir=Join-Path $env:LOCALAPPDATA 'DeesCrochetStudioPreview'
[IO.Directory]::CreateDirectory($stateDir) | Out-Null
$statePath=Join-Path $stateDir 'server.json'
$logPath=Join-Path $stateDir 'server.log'
if((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 65536){[IO.File]::WriteAllText($logPath,'')}
$instance=[Guid]::NewGuid().ToString('N')
$token=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
$listener=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,17828)
$listener.ExclusiveAddressUse=$true
$running=$true
function Reply($stream,[int]$status,[string]$mime,[byte[]]$body,[bool]$head=$false){
  $reason=@{200='OK';400='Bad Request';403='Forbidden';404='Not Found';405='Method Not Allowed';431='Request Header Fields Too Large'}[$status]
  $headers="HTTP/1.1 $status $reason`r`nContent-Type: $mime`r`nContent-Length: $($body.Length)`r`nConnection: close`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nCross-Origin-Resource-Policy: same-origin`r`n`r`n"
  $bytes=[Text.Encoding]::ASCII.GetBytes($headers);$stream.Write($bytes,0,$bytes.Length)
  if(-not $head -and $body.Length){$stream.Write($body,0,$body.Length)}
}
function TextReply($stream,$status,$text){Reply $stream $status 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($text))}
try{
  $listener.Start(64)
  [IO.File]::WriteAllText($statePath,(@{instance=$instance;token=$token;pid=$PID;sourceCommit=$package.sourceCommit}|ConvertTo-Json))
  Add-Content -LiteralPath $logPath -Value ((Get-Date -Format o)+' local preview started')
  while($running){
    if(-not $listener.Pending()){Start-Sleep -Milliseconds 10;continue}
    $client=$listener.AcceptTcpClient()
    try{
      if(-not [Net.IPAddress]::IsLoopback($client.Client.RemoteEndPoint.Address)){continue}
      $stream=$client.GetStream();$stream.ReadTimeout=2000;$stream.WriteTimeout=5000
      $buffer=New-Object Collections.Generic.List[byte]
      while($buffer.Count -lt 16384){$b=$stream.ReadByte();if($b -lt 0){break};$buffer.Add([byte]$b);$n=$buffer.Count;if($n -ge 4 -and $buffer[$n-4] -eq 13 -and $buffer[$n-3] -eq 10 -and $buffer[$n-2] -eq 13 -and $buffer[$n-1] -eq 10){break}}
      if($buffer.Count -ge 16384){TextReply $stream 431 'Header limit';continue}
      $lines=[Text.Encoding]::ASCII.GetString($buffer.ToArray()) -split "`r`n"
      if($lines[0] -notmatch '^(GET|HEAD|POST) (/[^ ]*) HTTP/1\.[01]$'){TextReply $stream 405 'GET or HEAD only';continue}
      $method=$Matches[1];$target=$Matches[2];$headers=@{}
      foreach($line in $lines[1..($lines.Length-1)]){if($line -match '^([^:]+):\s*(.*)$'){$headers[$Matches[1].ToLowerInvariant()]=$Matches[2]}}
      if($headers['host'] -ne '127.0.0.1:17828'){TextReply $stream 403 'Use the fixed local preview address';continue}
      $path=[Uri]::UnescapeDataString(($target -split '\?',2)[0])
      if($path -eq '/__preview_health' -and $method -eq 'GET'){
        $body=@{application='dees-private-windows-preview';sourceCommit=$package.sourceCommit;instance=$instance;port=$listener.LocalEndpoint.Port;binding=$listener.LocalEndpoint.Address.ToString();powershellVersion=$PSVersionTable.PSVersion.ToString()}|ConvertTo-Json -Compress
        Reply $stream 200 'application/json' ([Text.Encoding]::UTF8.GetBytes($body));continue
      }
      if($path -eq '/__preview_stop'){
        if($method -ne 'POST' -or $headers['x-dees-stop'] -cne $token){TextReply $stream 403 'Stop token required';continue}
        TextReply $stream 200 'Stopped';$running=$false;continue
      }
      if($method -eq 'POST'){TextReply $stream 405 'Uploads are not accepted';continue}
      if($path -eq '/__preview_start'){
        Reply $stream 200 'text/html; charset=utf-8' ([IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'Compatibility.html'))) ($method -eq 'HEAD');continue
      }
      if($path.Contains('\') -or $path.Contains([char]0) -or (($path -split '/') -contains '..') -or $path.Contains(':')){TextReply $stream 403 'Path not allowed';continue}
      if($path -eq '/'){$path='/index.html'}
      $file=[IO.Path]::GetFullPath((Join-Path $root ($path.TrimStart('/'))))
      if(-not $file.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or -not [IO.File]::Exists($file)){TextReply $stream 404 'Not found';continue}
      if(([IO.File]::GetAttributes($file) -band [IO.FileAttributes]::ReparsePoint) -ne 0){TextReply $stream 403 'Links are not served';continue}
      $types=@{'.html'='text/html; charset=utf-8';'.js'='application/javascript';'.mjs'='application/javascript';'.css'='text/css';'.json'='application/json';'.webmanifest'='application/manifest+json';'.svg'='image/svg+xml';'.png'='image/png';'.jpg'='image/jpeg';'.jpeg'='image/jpeg';'.pdf'='application/pdf';'.wasm'='application/wasm';'.ttf'='font/ttf';'.woff2'='font/woff2'}
      $mime=$types[[IO.Path]::GetExtension($file).ToLowerInvariant()];if(-not $mime){$mime='application/octet-stream'}
      Reply $stream 200 $mime ([IO.File]::ReadAllBytes($file)) ($method -eq 'HEAD')
    }catch{# Malformed/disconnected local clients are isolated; no request content is logged.
    }finally{$client.Close()}
  }
}catch{Add-Content -LiteralPath $logPath -Value ((Get-Date -Format o)+' server could not run');exit 1}
finally{
  $listener.Stop()
  try{$state=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json;if($state.instance -eq $instance){Remove-Item -LiteralPath $statePath}}catch{}
  Add-Content -LiteralPath $logPath -Value ((Get-Date -Format o)+' local preview stopped')
}
