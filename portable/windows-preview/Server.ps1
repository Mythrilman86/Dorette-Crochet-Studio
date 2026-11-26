$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'www'))
$package=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'preview-package.json') -Raw | ConvertFrom-Json
. (Join-Path $PSScriptRoot 'UpdateCore.ps1')
$active=Get-StudioActive
if($active){$root=$active.root;$package=$active.metadata}
$updateToken=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
$installId=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'UpdateCore.ps1') -Algorithm SHA256).Hash
$installationRoot=[IO.Path]::GetFullPath($PSScriptRoot).ToLowerInvariant()
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
  $reason=@{200='OK';400='Bad Request';403='Forbidden';404='Not Found';405='Method Not Allowed';409='Conflict';500='Internal Server Error';431='Request Header Fields Too Large'}[$status]
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
      $invalidHeaders=$false
      foreach($line in $lines[1..($lines.Length-1)]){if(!$line){continue};if($line -notmatch '^([A-Za-z0-9-]+):\s*(.*)$'){$invalidHeaders=$true;break};$key=$Matches[1].ToLowerInvariant();if($headers.ContainsKey($key)){$invalidHeaders=$true;break};$headers[$key]=$Matches[2]}
      if($invalidHeaders){TextReply $stream 400 'Invalid or duplicate request headers';continue}
      if($headers['host'] -ne '127.0.0.1:17828'){TextReply $stream 403 'Use the fixed local preview address';continue}
      $path=[Uri]::UnescapeDataString(($target -split '\?',2)[0])
      if($path -eq '/__preview_health' -and $method -eq 'GET'){
        $body=@{application='dees-private-windows-preview';sourceCommit=$package.sourceCommit;version=$package.version;updateProtocol=1;helperIdentity=$installId;installationRoot=$installationRoot;instance=$instance;port=$listener.LocalEndpoint.Port;binding=$listener.LocalEndpoint.Address.ToString();powershellVersion=$PSVersionTable.PSVersion.ToString()}|ConvertTo-Json -Compress
        Reply $stream 200 'application/json' ([Text.Encoding]::UTF8.GetBytes($body));continue
      }
      if($path.StartsWith('/__studio_update/')){
        if(!(Test-StudioRequest $headers $method $path $updateToken)){TextReply $stream 403 'Only the Studio page may request updates';continue}
        try{
          if($path -ceq '/__studio_update/session' -and $method -eq 'GET'){$reply=@{token=$updateToken;current=$package.version;protocol=1}}
          elseif($path -ceq '/__studio_update/check' -and $method -eq 'GET'){
            $studioCandidate=Select-StudioRelease (Get-StudioRelease) $package.version
            $reply=@{current=$package.version;candidate=$null};if($studioCandidate){$reply.candidate=@{version=$studioCandidate.version;notes=$studioCandidate.notes}}
          }
          elseif($path -ceq '/__studio_update/prepare' -and $method -eq 'POST'){
            if($studioPrepared){throw 'An update is already staged. Do not repeat this action.'}
            if(!$studioCandidate -or $headers['x-dees-version'] -cne $studioCandidate.version){throw 'Check for Updates again before preparing a package.'}
            $studioPrepared=Prepare-StudioUpdate $studioCandidate
            $reply=@{prepared=$true;version=$studioPrepared.metadata.version}
          }
          elseif($path -ceq '/__studio_update/apply' -and $method -eq 'POST'){
            if(!$studioPrepared -or $headers['x-dees-version'] -cne $studioPrepared.metadata.version){throw 'No matching verified package is staged.'}
            $active=Commit-StudioUpdate $studioPrepared;$root=$active.root;$package=$active.metadata;$studioPrepared=$null;$studioCandidate=$null
            $updateToken=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
            $reply=@{applied=$true;version=$package.version;restartRequired=$false}
          }else{TextReply $stream 404 'Unknown update action';continue}
          Reply $stream 200 'application/json' ([Text.Encoding]::UTF8.GetBytes(($reply|ConvertTo-Json -Depth 5 -Compress)))
        }catch{
          # No URL, signed CDN query, token, project data or exception stack is logged.
          $message='Unable to Update. The package may be unavailable, damaged, incompatible, or this folder may not be writable. Keep your work open and review the update instructions.'
          $safeErrors=@('The update checksum did not match. The current version is unchanged.','The download is incomplete.','The official Windows package has no usable integrity metadata.','This release changes the helper. Use a separately reviewed manual transition.','The package identity or updater protocol is incompatible. A manual transition is required.','Package file verification failed.','At least 700 MiB of free space is needed to stage an update safely.','An update is already staged. Do not repeat this action.')
          if($_.Exception.Message -cin $safeErrors){$message=$_.Exception.Message}
          $cause=$_.Exception;while($cause.InnerException){$cause=$cause.InnerException}
          if($cause -is [UnauthorizedAccessException]){$message='Unable to Update. This installation folder is not writable. Keep your work open; use a writable permanent folder in the one-time setup. No administrator access is requested.'}
          elseif($cause -is [Net.WebException]){$message='Unable to Update. The official download could not be reached. Keep your work and check your connection later.'}
          Reply $stream 409 'application/json' ([Text.Encoding]::UTF8.GetBytes((@{error=$message}|ConvertTo-Json -Compress)))
        }
        continue
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
