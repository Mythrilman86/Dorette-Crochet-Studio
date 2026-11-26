# Protocol 1: immutable helper; only verified application resources switch versions.
# This file is dot-sourced by the existing loopback server. It never changes policy.
$studioOrigin='http://127.0.0.1:17828'
$studioRepository='Mythrilman86/Dorette-Crochet-Studio'
$studioUpdateRoot=Join-Path $PSScriptRoot 'StudioUpdates'
$studioPointer=Join-Path $studioUpdateRoot 'active.json'
$studioCandidate=$null
$studioPrepared=$null

function Assert-StudioPlainPath([string]$path) {
  $item=[IO.Path]::GetFullPath($path)
  while($item){
    if(Test-Path -LiteralPath $item){if(([IO.File]::GetAttributes($item) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Linked update directories are not supported.'}}
    $parent=[IO.Path]::GetDirectoryName($item);if($parent -eq $item){break};$item=$parent
  }
}
function Get-StudioHash([string]$path){(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Assert-StudioVersion([string]$version){if($version -cnotmatch '^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$'){throw 'Invalid update version.'}}
function Test-StudioNewer([string]$next,[string]$current){Assert-StudioVersion $next;Assert-StudioVersion $current;return [version]$next -gt [version]$current}
function Test-StudioRequest($headers,[string]$method,[string]$path,[string]$expectedToken) {
  if($headers['host'] -cne '127.0.0.1:17828' -or $headers['x-dees-request'] -cne '1'){return $false}
  if($headers['sec-fetch-site'] -and $headers['sec-fetch-site'] -cne 'same-origin'){return $false}
  if($headers['origin'] -and $headers['origin'] -cne $studioOrigin){return $false}
  if($headers['transfer-encoding'] -or ($headers['content-length'] -and $headers['content-length'] -ne '0')){return $false}
  if($method -eq 'GET'){return (!$headers['origin'] -and $headers['sec-fetch-site'] -ceq 'same-origin') -or $headers['origin'] -ceq $studioOrigin}
  return $method -eq 'POST' -and $headers['origin'] -ceq $studioOrigin -and $headers['x-dees-update'] -ceq $expectedToken
}
function Get-StudioRelease {
  [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
  $request=[Net.HttpWebRequest]::Create(('https://api.github.com/repos/'+$studioRepository+'/releases/latest'))
  $request.UserAgent='Dees-Studio-Windows-Update/1';$request.Accept='application/vnd.github+json';$request.AllowAutoRedirect=$false;$request.Timeout=20000;$request.ReadWriteTimeout=20000
  $response=$request.GetResponse()
  try{
    if($response.StatusCode -ne 200 -or $response.ContentLength -gt 262144){throw 'Release metadata is unavailable or too large.'}
    $reader=New-Object IO.StreamReader($response.GetResponseStream())
    try{$buffer=New-Object char[] 262145;$count=0;while($count -lt $buffer.Length){$n=$reader.Read($buffer,$count,$buffer.Length-$count);if(!$n){break};$count+=$n};if($count -gt 262144){throw 'Release metadata is too large.'};$text=New-Object string($buffer,0,$count);return $text|ConvertFrom-Json}finally{$reader.Dispose()}
  }finally{$response.Dispose()}
}
function Select-StudioRelease($release,[string]$current) {
  if($release.draft -ne $false -or $release.prerelease -ne $false -or $release.tag_name -cnotmatch '^v(.+)$'){throw 'A stable public release is required.'}
  $version=$Matches[1];Assert-StudioVersion $version
  if(!(Test-StudioNewer $version $current)){return $null}
  $name='Dees-Crochet-Studio-'+$version+'-Windows.zip'
  $url='https://github.com/'+$studioRepository+'/releases/download/v'+$version+'/'+$name
  $assets=@($release.assets|Where-Object {$_.name -ceq $name})
  if($assets.Count -ne 1 -or $assets[0].browser_download_url -cne $url -or $assets[0].state -cne 'uploaded' -or $assets[0].digest -cnotmatch '^sha256:[a-f0-9]{64}$' -or $assets[0].size -le 0 -or $assets[0].size -gt 104857600){throw 'The official Windows package has no usable integrity metadata.'}
  $notes=[string]$release.body;if($notes.Length -gt 1800){$notes=$notes.Substring(0,1800)}
  return @{version=$version;url=$url;sha256=$assets[0].digest.Substring(7);bytes=[long]$assets[0].size;notes=$notes}
}
function Save-StudioDownload($candidate,[string]$destination) {
  # GitHub redirects binary assets to its official release-asset CDN. No cookies/auth.
  $url=$candidate.url
  for($redirect=0;$redirect -lt 5;$redirect++){
    $uri=[Uri]$url
    if($uri.Scheme -cne 'https' -or $uri.UserInfo -or $uri.Port -ne 443 -or $uri.Host -notin @('github.com','release-assets.githubusercontent.com','objects.githubusercontent.com')){throw 'Unexpected update download host.'}
    $request=[Net.HttpWebRequest]::Create($uri);$request.UserAgent='Dees-Studio-Windows-Update/1';$request.AllowAutoRedirect=$false;$request.Timeout=30000;$request.ReadWriteTimeout=30000
    $response=$request.GetResponse()
    try{
      if([int]$response.StatusCode -in @(301,302,303,307,308)){$url=([Uri]::new($uri,$response.Headers['Location'])).AbsoluteUri;continue}
      if($response.StatusCode -ne 200){throw 'The package download failed.'}
      $inputStream=$response.GetResponseStream();$output=[IO.File]::Open($destination,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
      try{$buffer=New-Object byte[] 65536;$total=0L;while(($n=$inputStream.Read($buffer,0,$buffer.Length)) -gt 0){$total+=$n;if($total -gt $candidate.bytes){throw 'Update download exceeded its approved size.'};$output.Write($buffer,0,$n)};if($total -ne $candidate.bytes){throw 'The download is incomplete.'}}finally{$output.Dispose();$inputStream.Dispose()}
      if((Get-StudioHash $destination) -cne $candidate.sha256){throw 'The update checksum did not match. The current version is unchanged.'}
      return
    }finally{$response.Dispose()}
  }
  throw 'Too many download redirects.'
}
function Assert-StudioEntry([string]$name) {
  if(!$name -or $name.Length -gt 220 -or $name.Contains('\') -or $name.StartsWith('/') -or $name -match '[:\x00-\x1f]' -or $name -match '(^|/)(\.|\.\.)(/|$)'){throw 'Unsafe archive path.'}
  foreach($part in $name.TrimEnd('/').Split('/')){if(!$part -or $part -match '[. ]$' -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)'){throw 'Unsafe Windows filename.'}}
}
function Expand-StudioPackage([string]$zipPath,[string]$target) {
  Assert-StudioPlainPath $target
  if(Test-Path -LiteralPath $target){throw 'An update staging directory already exists.'}
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive=[IO.Compression.ZipFile]::OpenRead($zipPath)
  try{
    if($archive.Entries.Count -gt 1500 -or $archive.Entries.Count -lt 10){throw 'Invalid archive entry count.'}
    $seen=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase);$total=0L
    foreach($entry in $archive.Entries){
      Assert-StudioEntry $entry.FullName
      if(!$seen.Add($entry.FullName.TrimEnd('/'))){throw 'Duplicate archive path.'}
      if((($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960 -or ($entry.ExternalAttributes -band 1024)){throw 'Links in update packages are not supported.'}
      $total+=$entry.Length
      if($entry.Length -gt 104857600 -or $total -gt 314572800){throw 'Expanded update is too large.'}
    }
    [IO.Directory]::CreateDirectory($target)|Out-Null
    foreach($entry in $archive.Entries){
      $file=[IO.Path]::GetFullPath((Join-Path $target $entry.FullName))
      if(!$file.StartsWith([IO.Path]::GetFullPath($target)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Archive path escaped staging.'}
      if($entry.FullName.EndsWith('/')){[IO.Directory]::CreateDirectory($file)|Out-Null;continue}
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file))|Out-Null
      $src=$entry.Open();$dst=[IO.File]::Open($file,[IO.FileMode]::CreateNew)
      try{
        $buffer=New-Object byte[] 65536;$written=0L
        while(($n=$src.Read($buffer,0,$buffer.Length)) -gt 0){$written+=$n;if($written -gt $entry.Length){throw 'Expanded file exceeded its declared size.'};$dst.Write($buffer,0,$n)}
        if($written -ne $entry.Length){throw 'Incomplete extraction.'}
      }finally{$src.Dispose();$dst.Dispose()}
      if((Get-Item -LiteralPath $file).Length -ne $entry.Length){throw 'Incomplete extraction.'}
    }
  }finally{$archive.Dispose()}
}
function Assert-StudioPackage([string]$directory,[string]$version) {
  Assert-StudioPlainPath $directory
  $metadata=Get-Content -LiteralPath (Join-Path $directory 'preview-package.json') -Raw|ConvertFrom-Json
  if($metadata.development -eq $true -or $metadata.windowsUpdateProtocol -ne 1 -or $metadata.version -cne $version -or $metadata.origin -cne $studioOrigin -or $metadata.sourceCommit -cnotmatch '^[a-f0-9]{40}$'){throw 'The package identity or updater protocol is incompatible. A manual transition is required.'}
  $manifest=Get-Content -LiteralPath (Join-Path $directory 'PACKAGE-MANIFEST.json') -Raw|ConvertFrom-Json
  if($manifest.schema -ne 1 -or $manifest.applicationSourceCommit -cne $metadata.sourceCommit){throw 'Package manifest identity mismatch.'}
  $seen=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  foreach($row in $manifest.files){
    Assert-StudioEntry $row.path
    if(!$seen.Add($row.path) -or $row.sha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'Invalid package manifest.'}
    $file=Join-Path $directory $row.path
    if(!(Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Length -ne $row.bytes -or (Get-StudioHash $file) -cne $row.sha256){throw 'Package file verification failed.'}
    if(!$row.path.StartsWith('www/',[StringComparison]::Ordinal)){
      $original=Join-Path $PSScriptRoot $row.path
      if($row.path.Contains('/') -or !(Test-Path -LiteralPath $original -PathType Leaf)){throw 'Unexpected helper file in update.'}
      if($row.path -match '\.(ps1|cmd)$' -and (Get-StudioHash $original) -cne $row.sha256){throw 'This release changes the helper. Use a separately reviewed manual transition.'}
    }
  }
  $actual=@(Get-ChildItem -LiteralPath $directory -File -Recurse)
  if($actual.Count -ne $seen.Count+1){throw 'Unlisted package files.'}
  foreach($file in $actual){$relative=$file.FullName.Substring($directory.Length+1).Replace('\','/');if($relative -ne 'PACKAGE-MANIFEST.json' -and !$seen.Contains($relative)){throw 'Unlisted package file.'}}
  foreach($required in @('www/index.html','www/app.js','www/updates.js','www/update-safety.js','www/website-updates.js','www/windows-updates.js','www/service-worker.js','www/release-config.js','www/release.json','Server.ps1','UpdateCore.ps1','Launcher.ps1','Stop.ps1')){if(!$seen.Contains($required)){throw 'Required update file is missing.'}}
  $release=Get-Content -LiteralPath (Join-Path $directory 'www/release.json') -Raw|ConvertFrom-Json
  $config=Get-Content -LiteralPath (Join-Path $directory 'www/release-config.js') -Raw
  if($release.web.version -cne $version -or $config -notmatch ('version:\s*'''+[regex]::Escape($version)+'''')){throw 'Application version metadata mismatch.'}
  return $metadata
}
function Get-StudioActive {
  if(!(Test-Path -LiteralPath $studioPointer)){return $null}
  Assert-StudioPlainPath $studioPointer
  $pointer=Get-Content -LiteralPath $studioPointer -Raw|ConvertFrom-Json
  if($pointer.current -cnotmatch '^[a-f0-9]{32}$'){throw 'The active update pointer is invalid. No version was selected.'}
  Assert-StudioVersion $pointer.version
  $directory=Join-Path $studioUpdateRoot $pointer.current
  $metadata=Assert-StudioPackage $directory $pointer.version
  return @{root=(Join-Path $directory 'www');metadata=$metadata;pointer=$pointer}
}
function Prepare-StudioUpdate($candidate) {
  if(!$candidate){throw 'No reviewed update is available.'}
  Assert-StudioPlainPath $studioUpdateRoot
  [IO.Directory]::CreateDirectory($studioUpdateRoot)|Out-Null
  $disk=New-Object IO.DriveInfo([IO.Path]::GetPathRoot($studioUpdateRoot));if($disk.AvailableFreeSpace -lt 734003200){throw 'At least 700 MiB of free space is needed to stage an update safely.'}
  $id=[Guid]::NewGuid().ToString('N');$archive=Join-Path $studioUpdateRoot ($id+'.zip');$directory=Join-Path $studioUpdateRoot $id
  # Interrupted attempts stay isolated and are never resumed, reused or auto-deleted.
  Save-StudioDownload $candidate $archive
  Expand-StudioPackage $archive $directory
  $metadata=Assert-StudioPackage $directory $candidate.version
  return @{id=$id;directory=$directory;metadata=$metadata;candidate=$candidate}
}
function Commit-StudioUpdate($prepared) {
  if(!$prepared){throw 'No verified update is prepared.'}
  $metadata=Assert-StudioPackage $prepared.directory $prepared.candidate.version
  $previous=$null;if(Test-Path -LiteralPath $studioPointer){$previous=(Get-Content -LiteralPath $studioPointer -Raw|ConvertFrom-Json).current}
  $pointer=@{schema=1;current=$prepared.id;version=$metadata.version;previous=$previous;previousVersion=$package.version}
  $temporary=Join-Path $studioUpdateRoot ([Guid]::NewGuid().ToString('N')+'.json')
  [IO.File]::WriteAllText($temporary,($pointer|ConvertTo-Json))
  Assert-StudioPlainPath $studioPointer
  if(Test-Path -LiteralPath $studioPointer){[IO.File]::Replace($temporary,$studioPointer,($temporary+'.previous'),$true)}else{[IO.File]::Move($temporary,$studioPointer)}
  return @{root=(Join-Path $prepared.directory 'www');metadata=$metadata;pointer=$pointer}
}
