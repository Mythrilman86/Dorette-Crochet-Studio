import {spawnSync} from 'node:child_process';
import {cp,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
const baseline='791ea0f1be4faba1195bf694accc0f1f8b45e786';
const out=resolve(process.argv[2]||'windows-preview-output');
const allowed=name=>["service-worker.js", "styles.css", "experience.js", "release-config.js", "release.json", "release-notes.html", "mobile/package.json", "mobile/package-lock.json", "mobile/android/app/build.gradle", "mobile/ios/App/App.xcodeproj/project.pbxproj", "portable/windows-preview/START HERE.txt", "docs/release-2.7.1.md", "docs/release-2.7.1-installation.md", "scripts/build25-creator-scenario.txt", "scripts/test-build26-browser.cjs", "scripts/build-windows-preview.mjs", "tests/build27-preservation.test.cjs"].includes(name);
const changed=spawnSync('git',['diff','--name-only',baseline],{encoding:'utf8'});
if(changed.status||changed.stdout.trim().split(/\r?\n/).filter(Boolean).some(name=>!allowed(name)))throw Error('Application source differs from the accepted sanitized v2.7.0 base and reviewed v2.7.1 scope; refusing to package unreviewed changes.');
const untracked=spawnSync('git',['ls-files','--others'],{encoding:'utf8'});
if(untracked.status||untracked.stdout.trim().split(/\r?\n/).filter(Boolean).some(name=>name.startsWith('assets/')||(!name.includes('/')&&(/\.(js|css|html|pdf|webmanifest)$/.test(name)||name==='release.json'))))throw Error('Untracked application resources would be packaged; refusing to copy them.');
const run=(args)=>{const r=spawnSync(process.execPath,args,{stdio:'inherit'});if(r.status)throw Error('Build failed');};
run(['scripts/cache-identity.mjs']);run(['scripts/build.mjs','web']);
await mkdir(out,{recursive:true});await cp('dist',join(out,'www'),{recursive:true});await cp('portable/windows-preview',out,{recursive:true});
const git=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});if(git.status)throw Error('Source commit unavailable');
const release=JSON.parse(await readFile('release.json','utf8')),android=await readFile('mobile/android/app/build.gradle','utf8');
const androidVersionCode=Number(android.match(/versionCode (\d+)/)?.[1]);if(!Number.isInteger(androidVersionCode)||androidVersionCode<1)throw Error('Android version code unavailable');
await writeFile(join(out,'preview-package.json'),JSON.stringify({application:'dees-private-windows-preview',version:release.web.version,releaseCandidate:1,androidVersionCode,sourceCommit:git.stdout.trim(),baselineCommit:baseline,packagingCommit:git.stdout.trim(),origin:'http://127.0.0.1:17828',engineModified:true},null,2)+'\n');
async function files(dir){let list=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())list.push(...await files(p));else if(e.isFile())list.push(p);}return list;}
const manifest=[];for(const p of (await files(out)).sort()){if(p.endsWith('PACKAGE-MANIFEST.json'))continue;const b=await readFile(p);manifest.push({path:relative(out,p).replaceAll('\\','/'),bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});}
await writeFile(join(out,'PACKAGE-MANIFEST.json'),JSON.stringify({schema:1,applicationSourceCommit:git.stdout.trim(),files:manifest},null,2)+'\n');console.log('Portable package staged:',out,'files:',manifest.length);
