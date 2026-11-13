$ErrorActionPreference='Stop'
$statePath=Join-Path $env:LOCALAPPDATA 'DeesCrochetStudioPreview\server.json'
try{
  if(-not (Test-Path -LiteralPath $statePath)){Write-Output 'Studio local server is already stopped.';exit 0}
  $state=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  $health=(Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:17828/__preview_health' -TimeoutSec 2 -Proxy $null).Content | ConvertFrom-Json
  if($health.application -ne 'dees-private-windows-preview' -or $health.instance -ne $state.instance){throw 'The port belongs to another program. Nothing was stopped.'}
  Invoke-WebRequest -UseBasicParsing -Method Post -Uri 'http://127.0.0.1:17828/__preview_stop' -Headers @{'X-Dees-Stop'=$state.token} -TimeoutSec 5 -Proxy $null | Out-Null
  Write-Output 'Studio local server stopped. Saved browser projects were not removed. You may close the browser tab.'
}catch [Net.WebException]{
  if($_.Exception.Status -eq [Net.WebExceptionStatus]::ConnectFailure){Write-Output 'Studio local server is already stopped.';exit 0}
  Write-Host ('Could not stop Studio: '+$_.Exception.Message);exit 1
}catch{Write-Host ('Could not stop Studio: '+$_.Exception.Message);exit 1}
