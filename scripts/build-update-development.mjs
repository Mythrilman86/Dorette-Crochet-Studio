// Explicitly unpublished development candidate; keeps all release identities unchanged.
import {spawnSync} from 'node:child_process';
import {cp,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
const out=resolve(process.argv[2]||'update-development-output');
const git=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});
if(git.status||git.stdout.trim()!=='155bf26e431c898e225b37d14c111639f7627d44')throw Error('Development baseline mismatch');
for(const args of [['scripts/cache-identity.mjs'],['scripts/build.mjs','web']]){const r=spawnSync(process.execPath,args,{stdio:'inherit'});if(r.status)throw Error('Build failed');}
await mkdir(out,{recursive:false});await cp('dist',join(out,'www'),{recursive:true});await cp('portable/windows-preview',out,{recursive:true});
await writeFile(join(out,'preview-package.json'),JSON.stringify({application:'dees-private-windows-preview',version:'2.7.1',developmentTarget:'2.7.2',development:true,windowsUpdateProtocol:1,sourceCommit:git.stdout.trim(),origin:'http://127.0.0.1:17828',releaseCandidate:false},null,2));
async function list(dir){const result=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())result.push(...await list(p));else if(e.isFile())result.push(p);else throw Error('No linked package entries');}return result;}
const files=[];for(const p of(await list(out)).sort()){const b=await readFile(p);files.push({path:relative(out,p).replaceAll('\\','/'),bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});}
await writeFile(join(out,'PACKAGE-MANIFEST.json'),JSON.stringify({schema:1,applicationSourceCommit:git.stdout.trim(),development:true,files},null,2));
console.log('Unpublished development package:',out,files.length,'files');
