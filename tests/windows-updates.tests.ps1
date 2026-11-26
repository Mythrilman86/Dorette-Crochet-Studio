param([Parameter(Mandatory=$true)][string]$PackageDirectory,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
. (Join-Path $PackageDirectory 'UpdateCore.ps1')
$results=New-Object Collections.Generic.List[object]
function Case([string]$name,[scriptblock]$action){try{& $action;$results.Add(@{name=$name;pass=$true})}catch{$results.Add(@{name=$name;pass=$false;error=$_.Exception.Message})}}
function MustReject([scriptblock]$action){$rejected=$false;try{& $action|Out-Null}catch{$rejected=$true};if(!$rejected){throw 'Expected rejection'}}
function Require($value){if(!$value){throw 'Assertion failed'}}
$stage=Join-Path $OutputDirectory 'PowerShell-Fixtures'
if(Test-Path -LiteralPath $stage){throw 'Test output already exists'}
[IO.Directory]::CreateDirectory($stage)|Out-Null
$studioUpdateRoot=Join-Path $stage 'StudioUpdates';$studioPointer=Join-Path $studioUpdateRoot 'active.json'
$candidate=@{version='2.7.2';sha256=('a'*64);bytes=123;url='https://github.com/Mythrilman86/Dorette-Crochet-Studio/releases/download/v2.7.2/Dees-Crochet-Studio-2.7.2-Windows.zip'}
function Release(){return @{draft=$false;prerelease=$false;tag_name='v2.7.2';body='Fictional release notes';assets=@(@{name='Dees-Crochet-Studio-2.7.2-Windows.zip';browser_download_url=$candidate.url;state='uploaded';digest=('sha256:'+('a'*64));size=123})}}
Case 'newer numeric version' {Require (Test-StudioNewer '2.7.2' '2.7.1')}
Case 'same version produces no update' {Require (!(Test-StudioNewer '2.7.1' '2.7.1'));Require ($null -eq (Select-StudioRelease (Release) '2.7.2'))}
Case 'older version produces no update' {Require (!(Test-StudioNewer '2.6.9' '2.7.1'))}
Case 'invalid version rejects' {MustReject {Test-StudioNewer '2.7.2;evil' '2.7.1'}}
Case 'official stable release accepts' {Require ((Select-StudioRelease (Release) '2.7.1').version -ceq '2.7.2')}
Case 'draft rejects' {$r=Release;$r.draft=$true;MustReject {Select-StudioRelease $r '2.7.1'}}
Case 'prerelease rejects' {$r=Release;$r.prerelease=$true;MustReject {Select-StudioRelease $r '2.7.1'}}
Case 'foreign repository URL rejects' {$r=Release;$r.assets[0].browser_download_url='https://example.invalid/a.zip';MustReject {Select-StudioRelease $r '2.7.1'}}
Case 'missing digest rejects' {$r=Release;$r.assets[0].digest='';MustReject {Select-StudioRelease $r '2.7.1'}}
Case 'ambiguous asset rejects' {$r=Release;$r.assets+=($r.assets[0]);MustReject {Select-StudioRelease $r '2.7.1'}}
Case 'oversized asset rejects' {$r=Release;$r.assets[0].size=104857601;MustReject {Select-StudioRelease $r '2.7.1'}}
function Headers(){return @{'host'='127.0.0.1:17828';'origin'='http://127.0.0.1:17828';'x-dees-request'='1';'x-dees-update'='fictional-token';'sec-fetch-site'='same-origin'}}
Case 'same-origin tokenized POST accepts' {Require (Test-StudioRequest (Headers) 'POST' '/__studio_update/prepare' 'fictional-token')}
Case 'foreign Origin rejects' {$h=Headers;$h.origin='https://evil.invalid';Require (!(Test-StudioRequest $h 'POST' '' 'fictional-token'))}
Case 'missing Origin rejects POST' {$h=Headers;$h.Remove('origin');Require (!(Test-StudioRequest $h 'POST' '' 'fictional-token'))}
Case 'foreign fetch context rejects' {$h=Headers;$h['sec-fetch-site']='cross-site';Require (!(Test-StudioRequest $h 'POST' '' 'fictional-token'))}
Case 'missing nonce rejects' {$h=Headers;$h.Remove('x-dees-update');Require (!(Test-StudioRequest $h 'POST' '' 'fictional-token'))}
Case 'DNS rebinding Host rejects' {$h=Headers;$h.host='evil.invalid:17828';Require (!(Test-StudioRequest $h 'POST' '' 'fictional-token'))}
Case 'simple-form cross-site requests reject' {$h=Headers;$h.Remove('x-dees-request');Require (!(Test-StudioRequest $h 'POST' '' 'fictional-token'))}
Case 'chunked and nonempty-body requests reject' {$h=Headers;$h['transfer-encoding']='chunked';Require (!(Test-StudioRequest $h 'POST' '' 'fictional-token'));$h=Headers;$h['content-length']='1';Require (!(Test-StudioRequest $h 'POST' '' 'fictional-token'))}
Case 'GET capability requires same-origin custom header' {$h=Headers;$h.Remove('origin');Require (Test-StudioRequest $h 'GET' '' 'fictional-token');$h.Remove('sec-fetch-site');Require (!(Test-StudioRequest $h 'GET' '' 'fictional-token'))}
foreach($bad in @('../outside','www/../../outside','/absolute','C:/absolute','www\evil','www/a:stream','www/NUL.txt','www/trailing.','www/trailing ','www//empty')){Case ('unsafe path '+$bad) {MustReject {Assert-StudioEntry $bad}}}
Case 'valid nested resource accepts' {Assert-StudioEntry 'www/assets/creator/model.mjs'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
function BadZip($name,$duplicate=$false){$file=Join-Path $stage ([Guid]::NewGuid().ToString('N')+'.zip');$z=[IO.Compression.ZipFile]::Open($file,'Create');try{for($i=0;$i -lt 11;$i++){$e=$z.CreateEntry(('www/file'+$i+'.txt'));$s=$e.Open();$s.WriteByte(1);$s.Dispose()};$e=$z.CreateEntry($name);if($duplicate){$e=$z.CreateEntry($name)}}finally{$z.Dispose()};return $file}
Case 'archive path traversal rejects before extraction' {$z=BadZip '../outside';$dest=Join-Path $stage 'traversal';MustReject {Expand-StudioPackage $z $dest};Require (!(Test-Path -LiteralPath $dest))}
Case 'archive duplicate paths reject before extraction' {$z=BadZip 'www/duplicate' $true;$dest=Join-Path $stage 'duplicate';MustReject {Expand-StudioPackage $z $dest};Require (!(Test-Path -LiteralPath $dest))}
Case 'corrupted archive rejects' {$z=Join-Path $stage 'corrupt.zip';[IO.File]::WriteAllText($z,'not a ZIP');MustReject {Expand-StudioPackage $z (Join-Path $stage 'corrupt')}}
$fixture=Join-Path $stage 'package';Copy-Item -LiteralPath $PackageDirectory -Destination $fixture -Recurse
function WriteManifest {
 $rows=@(Get-ChildItem -LiteralPath $fixture -File -Recurse|Where-Object {$_.Name -ne 'PACKAGE-MANIFEST.json'}|ForEach-Object {@{path=$_.FullName.Substring($fixture.Length+1).Replace('\','/');bytes=$_.Length;sha256=(Get-StudioHash $_.FullName)}})
 [IO.File]::WriteAllText((Join-Path $fixture 'PACKAGE-MANIFEST.json'),(@{schema=1;applicationSourceCommit='155bf26e431c898e225b37d14c111639f7627d44';files=$rows}|ConvertTo-Json -Depth 6))
}
# A future-version fixture only, never a release candidate or public download.
$m=Get-Content -LiteralPath (Join-Path $fixture 'preview-package.json') -Raw|ConvertFrom-Json;$m.version='2.7.2';$m.development=$false
[IO.File]::WriteAllText((Join-Path $fixture 'preview-package.json'),($m|ConvertTo-Json))
$r=Get-Content -LiteralPath (Join-Path $fixture 'www/release.json') -Raw|ConvertFrom-Json;$r.web.version='2.7.2';[IO.File]::WriteAllText((Join-Path $fixture 'www/release.json'),($r|ConvertTo-Json -Depth 5))
$config=Join-Path $fixture 'www/release-config.js';[IO.File]::WriteAllText($config,((Get-Content -LiteralPath $config -Raw).Replace("version: '2.7.1'","version: '2.7.2'")))
WriteManifest
Case 'complete same-helper future package verifies' {Require ((Assert-StudioPackage $fixture '2.7.2').version -ceq '2.7.2')}
Case 'incorrect package version rejects' {MustReject {Assert-StudioPackage $fixture '2.7.3'}}
Case 'file tampering rejects and unchanged bytes can be reverified' {$file=Join-Path $fixture 'www/index.html';$bytes=[IO.File]::ReadAllBytes($file);try{[IO.File]::AppendAllText($file,'tampered');MustReject {Assert-StudioPackage $fixture '2.7.2'}}finally{[IO.File]::WriteAllBytes($file,$bytes)};Assert-StudioPackage $fixture '2.7.2'|Out-Null}
Case 'unlisted file rejects' {$file=Join-Path $fixture 'unlisted.txt';[IO.File]::WriteAllText($file,'fictional');try{MustReject {Assert-StudioPackage $fixture '2.7.2'}}finally{[IO.File]::Delete($file)}}
Case 'helper replacement rejects even with matching manifest' {$file=Join-Path $fixture 'Server.ps1';$bytes=[IO.File]::ReadAllBytes($file);try{[IO.File]::AppendAllText($file,'# changed helper');WriteManifest;MustReject {Assert-StudioPackage $fixture '2.7.2'}}finally{[IO.File]::WriteAllBytes($file,$bytes);WriteManifest}}
Case 'invalid prepared switch leaves active pointer absent' {MustReject {Commit-StudioUpdate @{directory=$fixture;candidate=@{version='2.7.3'};id=('a'*32)}};Require (!(Test-Path -LiteralPath $studioPointer))}
Case 'atomic switch and startup verification preserve previous versions' {
 [IO.Directory]::CreateDirectory($studioUpdateRoot)|Out-Null;$id='a'*32;Copy-Item -LiteralPath $fixture -Destination (Join-Path $studioUpdateRoot $id) -Recurse
 $package=@{version='2.7.1'};$prepared=@{id=$id;directory=(Join-Path $studioUpdateRoot $id);candidate=@{version='2.7.2'}}
 $active=Commit-StudioUpdate $prepared;Require ($active.pointer.version -ceq '2.7.2');Require ((Get-StudioActive).metadata.version -ceq '2.7.2');Require (Test-Path -LiteralPath (Join-Path $PackageDirectory 'www/index.html'))
 $id2='b'*32;Copy-Item -LiteralPath $fixture -Destination (Join-Path $studioUpdateRoot $id2) -Recurse
 $active=Commit-StudioUpdate @{id=$id2;directory=(Join-Path $studioUpdateRoot $id2);candidate=@{version='2.7.2'}};Require ($active.pointer.previous -ceq $id);Require (Test-Path -LiteralPath (Join-Path $studioUpdateRoot $id))
}
Case 'unwritable pointer simulation fails without overwriting files' {
 $originalPointer=$studioPointer;$studioPointer=Join-Path $stage 'missing-parent/active.json'
 try{MustReject {Commit-StudioUpdate @{id=('a'*32);directory=$fixture;candidate=@{version='2.7.2'}}};Require (!(Test-Path -LiteralPath $studioPointer))}finally{$studioPointer=$originalPointer}
}
Case 'Windows readonly pointer refuses replacement and preserves exact bytes' {
 $before=[IO.File]::ReadAllBytes($studioPointer)
 try{
  [IO.File]::SetAttributes($studioPointer,[IO.FileAttributes]::ReadOnly)
  MustReject {Commit-StudioUpdate @{id=('a'*32);directory=$fixture;candidate=@{version='2.7.2'}}}
  Require ([Convert]::ToBase64String([IO.File]::ReadAllBytes($studioPointer)) -ceq [Convert]::ToBase64String($before))
 }finally{[IO.File]::SetAttributes($studioPointer,[IO.FileAttributes]::Normal)}
}
$result=@{engine=$PSVersionTable.PSVersion.ToString();realWindowsFilesystem=$true;networkDownloadsMocked=$true;tests=$results;passed=@($results|Where-Object {$_.pass}).Count;failed=@($results|Where-Object {!$_.pass}).Count}
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'Windows-Update-Tests.json'),($result|ConvertTo-Json -Depth 6))
$result|Select-Object engine,passed,failed|ConvertTo-Json
if($result.failed){exit 1}
