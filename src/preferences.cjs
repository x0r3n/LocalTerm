'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const {randomUUID}=require('node:crypto');
class Preferences{
 constructor(directory){this.directory=directory;this.file=path.join(directory,'preferences.json');}
 async lastVault(){
  try{if((await fs.stat(this.file)).size>65536)return null;const value=JSON.parse(await fs.readFile(this.file,'utf8')).lastVaultPath;return typeof value==='string'&&value.length<32768&&path.isAbsolute(value)&&!value.includes('\0')?value:null;}catch{return null;}
 }
 async rememberVault(file){
  if(typeof file!=='string'||!path.isAbsolute(file))throw Error('Invalid vault path.');
  await fs.mkdir(this.directory,{recursive:true,mode:0o700});const temporary=this.file+'.'+randomUUID()+'.tmp';
  try{const handle=await fs.open(temporary,'wx',0o600);try{await handle.writeFile(JSON.stringify({lastVaultPath:file})+'\n','utf8');await handle.sync();}finally{await handle.close();}await fs.rename(temporary,this.file);}finally{await fs.rm(temporary,{force:true}).catch(()=>{});}
 }
}
module.exports={Preferences};
