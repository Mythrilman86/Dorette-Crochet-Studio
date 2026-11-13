import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
const run=(args)=>{const r=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});if(r.status!==0)process.exit(r.status||1);};
run(['scripts/cache-identity.mjs']);
run(['scripts/build.mjs','web']);run(['scripts/build.mjs','mobile']);
run(['--test',...readdirSync('tests').filter(n=>n.endsWith('.cjs')).map(n=>'tests/'+n),'experimental/pattern-publisher/core.test.mjs']);
if(!process.argv.includes('--node-only')){
 for(const suite of ['protection','backup','written-pattern','experience','editor','creator','build25','build26','build27','cache-failure','public-upgrade','publisher','publisher-quality','install-timing','rc1']){console.log('RUN browser suite: '+suite);run(['scripts/test-'+suite+'-browser.cjs']);console.log('PASS browser suite: '+suite);}
 const checked=spawnSync(process.env.STUDIO_TEST_PYTHON||(process.platform==='win32'?'python':'python3'),['scripts/verify-pdfs.py',process.env.STUDIO_TEST_OUTPUT||'publication-test-output'],{stdio:'inherit'});
 if(checked.status!==0)process.exit(checked.status||1);
}else console.log('Browser suites explicitly SKIPPED (--node-only). Use without this flag for full verification.');
