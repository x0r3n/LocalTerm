'use strict';
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const path=require('node:path');
const run=promisify(execFile);
const fs=require('node:fs/promises');
const {patchUuid}=require('./macho-uuid.cjs');
module.exports=async context=>{
 if(context.electronPlatformName!=='darwin')return;
 const bundle=path.join(context.appOutDir,context.packager.appInfo.productFilename+'.app');
 async function updateApp(dir){const binaries=path.join(dir,'Contents','MacOS');for(const entry of await fs.readdir(binaries)){const file=path.join(binaries,entry);if((await fs.lstat(file)).isFile())await fs.writeFile(file,patchUuid(await fs.readFile(file),context.packager.appInfo.id+':'+context.packager.appInfo.version+':'+path.relative(bundle,file)));}}
 await updateApp(bundle);
 const frameworks=path.join(bundle,'Contents','Frameworks');for(const entry of await fs.readdir(frameworks))if(entry.endsWith('.app'))await updateApp(path.join(frameworks,entry));
 await run('/usr/bin/codesign',['--force','--deep','--sign','-','--identifier',context.packager.appInfo.id,'--timestamp=none',bundle]);
 await run('/usr/bin/codesign',['--verify','--deep','--strict',bundle]);
};
