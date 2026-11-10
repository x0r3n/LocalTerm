'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
class LogStore{
 constructor(directory,key){this.directory=directory;this.key=Buffer.from(key,'base64');if(this.key.length!==32)throw Error('Invalid log encryption key.');this.file=path.join(directory,crypto.createHash('sha256').update(this.key).digest('hex')+'.ltlogs');}
 async read(){let bytes;try{bytes=await fs.readFile(this.file);}catch(e){if(e.code==='ENOENT')return [];throw e;}const e=JSON.parse(bytes);if(e.version!==1)throw Error('Unsupported log archive.');const d=crypto.createDecipheriv('aes-256-gcm',this.key,Buffer.from(e.nonce,'base64'));d.setAuthTag(Buffer.from(e.tag,'base64'));const logs=JSON.parse(Buffer.concat([d.update(Buffer.from(e.data,'base64')),d.final()]).toString());if(!Array.isArray(logs))throw Error('Invalid log archive.');return logs;}
 async write(logs){await fs.mkdir(this.directory,{recursive:true,mode:0o700});const nonce=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',this.key,nonce),data=Buffer.concat([c.update(JSON.stringify(logs)),c.final()]);const bytes=JSON.stringify({version:1,nonce:nonce.toString('base64'),tag:c.getAuthTag().toString('base64'),data:data.toString('base64')});const tmp=this.file+'.'+crypto.randomUUID()+'.tmp';try{const h=await fs.open(tmp,'wx',0o600);try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}await fs.rename(tmp,this.file);}finally{await fs.rm(tmp,{force:true});}}
 async archive(destination){await fs.copyFile(this.file,destination,require('node:fs').constants.COPYFILE_EXCL);await fs.chmod(destination,0o600);}
}
module.exports={LogStore};
