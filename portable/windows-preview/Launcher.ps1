param([switch]$NoBrowser,[string]$TestProfile)
$ErrorActionPreference='Stop'
$base='http://127.0.0.1:17828'
$package=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'preview-package.json') -Raw | ConvertFrom-Json
function Health {
  try { return (Invoke-WebRequest -UseBasicParsing -Uri ($base+'/__preview_health') -TimeoutSec 2 -Proxy $null).Content | ConvertFrom-Json } catch { return $null }
}
$mutex=New-Object Threading.Mutex($false,'Local\DeesStudioPreviewLauncher17828')
$held=$false
try {
  $held=$mutex.WaitOne(15000)
  if(-not $held){throw 'Another launcher is starting. Wait a moment and try again.'}
  $health=Health
  if($health -and ($health.application -ne 'dees-private-windows-preview' -or $health.sourceCommit -ne $package.sourceCommit)){throw 'A different program or preview is using port 17828. Stop that program normally. The storage address will not be changed.'}
  if(-not $health){
    $probe=New-Object Net.Sockets.TcpClient
    try{$probe.Connect('127.0.0.1',17828);throw 'Port 17828 is already occupied. Nothing was stopped and no alternate port was chosen.'}catch [Net.Sockets.SocketException]{}finally{$probe.Close()}
    $ps=Join-Path $PSHOME 'powershell.exe'
    $script=Join-Path $PSScriptRoot 'Server.ps1'
    $process=Start-Process -FilePath $ps -ArgumentList @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$script+'"')) -WindowStyle Hidden -PassThru
    for($i=0;$i -lt 60;$i++){
      Start-Sleep -Milliseconds 150
      $health=Health
      if($health){break}
      if($process.HasExited){break}
    }
    if(-not $health){throw 'The local server could not start. See Troubleshooting.txt and the log in LocalAppData\DeesCrochetStudioPreview. No browser data was cleared.'}
  }
  if($health.application -ne 'dees-private-windows-preview' -or $health.sourceCommit -ne $package.sourceCommit){throw 'The local address is not this preview. Nothing was changed.'}
  Write-Output ('Studio is ready at '+$base)
  if(-not $NoBrowser){
    $folders=@(${env:ProgramFiles(x86)},$env:ProgramFiles,$env:LOCALAPPDATA) | Where-Object {$_}
    $choices=@(foreach($folder in $folders){Join-Path $folder 'Microsoft\Edge\Application\msedge.exe'})+@(foreach($folder in $folders){Join-Path $folder 'Google\Chrome\Application\chrome.exe'})
    $browser=$choices | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1
    if(-not $browser){throw 'Install or update Microsoft Edge or Chrome first. The preview needs a supported modern browser.'}
    $args=@($base+'/__preview_start')
    # Disposable automation only; ordinary launches use the regular visible browser.
    if($TestProfile){$args=@(('--user-data-dir="'+$TestProfile+'"'),'--no-first-run','--headless=new','--remote-debugging-port=0')+$args}
    Start-Process -FilePath $browser -ArgumentList $args -WindowStyle Normal | Out-Null
  }
}catch{Write-Host ('Unable to open Studio: '+$_.Exception.Message);exit 1}
finally{if($held){$mutex.ReleaseMutex()};$mutex.Dispose()}
