import {readFile,readdir,writeFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative,join} from 'node:path';
const [rootArg,output,expected]=process.argv.slice(2),root=resolve(rootArg||'dist');
async function walk(dir){const rows=[];for(const name of (await readdir(dir)).sort()){const p=join(dir,name),s=await lstat(p);if(s.isSymbolicLink())throw Error('Symlink not publishable');if(s.isDirectory())rows.push(...await walk(p));else if(s.isFile()){const b=await readFile(p);rows.push({path:relative(root,p).replaceAll('\\','/'),bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});}}return rows;}
const files=await walk(root),body=JSON.stringify({schema:1,files}),digest=createHash('sha256').update(body).digest('hex');
if(expected){const prior=JSON.parse(await readFile(expected,'utf8'));if(prior.digest!==digest||JSON.stringify(prior.files)!==JSON.stringify(files))throw Error('Publication artifact changed after validation');}
const result={schema:1,sourceCommit:process.env.STUDIO_SOURCE_COMMIT||'uncommitted-local-verification',digest,files};
if(output)await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({files:files.length,digest,verified:!!expected}));
