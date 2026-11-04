'use strict';
const crypto = require('node:crypto');
const {resolveRoute}=require('./ssh-route.cjs');
const {validateLockSettings}=require('./auto-lock.cjs');
const { validateRule } = require('./forwarding.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const {promisify} = require('node:util');
const scrypt = promisify(crypto.scrypt);
const KDF = {N:65536,r:8,p:1};
const MAX = 24 * 1024 * 1024;
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
function validate(data) {
 if (!data || !Array.isArray(data.hosts) || !Array.isArray(data.keys) || !Array.isArray(data.snippets) || !data.knownHosts || typeof data.knownHosts !== 'object' || Array.isArray(data.knownHosts)) throw Error('Invalid vault contents.');
 validateLockSettings(data.settings);
 const clipboard=data.settings?.terminalClipboard;if(clipboard!==undefined&&(!clipboard||typeof clipboard!=='object'||Array.isArray(clipboard)||typeof clipboard.enabled!=='boolean'))throw Error('Invalid terminal clipboard settings.');
 const normalized=structuredClone(data);
 if(normalized.forwards===undefined)normalized.forwards=[];
 if(!Array.isArray(normalized.forwards))throw Error('Invalid forwarding rules.');
 for(const rule of normalized.forwards)validateRule(rule);
 for (const collection of ['hosts','keys','snippets','forwards']) {
  const ids = new Set();
  for (const item of normalized[collection]) {
   if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.label !== 'string') throw Error('Invalid or duplicate vault item.');
   ids.add(item.id);
  }
 }
 for (const h of data.hosts) if (typeof h.address !== 'string' || !h.address.trim() || typeof h.username !== 'string' || !Number.isInteger(Number(h.port)) || Number(h.port)<1 || Number(h.port)>65535) throw Error('Each host needs an address, username and valid port.');
 for(const h of normalized.hosts)resolveRoute(normalized,h.id);
 for (const k of data.keys) if (typeof k.privateKey !== 'string') throw Error('Invalid private key.');
 for (const s of data.snippets) if (typeof s.command !== 'string') throw Error('Invalid snippet.');
 return normalized;
}
async function derive(password,salt) {
 if(typeof password!=='string' || password.length<1 || password.length>4096) throw Error('Enter the vault password.');
 return scrypt(password,salt,32,{...KDF,maxmem:128*1024*1024});
}
function seal(data,key,salt) {
 const nonce=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',key,nonce);
 cipher.setAAD(Buffer.from('LocalTerm vault v1'));
 const content=Buffer.from(JSON.stringify(validate(data)));
 if(content.length>MAX/2) throw Error('Vault is too large.');
 const ciphertext=Buffer.concat([cipher.update(content),cipher.final()]); content.fill(0);
 return Buffer.from(JSON.stringify({format:'localterm',version:1,kdf:'scrypt',...KDF,salt:salt.toString('base64'),nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')}));
}
async function decode(bytes,password) {
 if(bytes.length>MAX) throw Error('Vault is too large.');
 let e; try{e=JSON.parse(bytes.toString('utf8'));}catch{throw Error('This is not a LocalTerm vault.');}
 if(e.format!=='localterm'||e.version!==1||e.kdf!=='scrypt'||e.N!==KDF.N||e.r!==KDF.r||e.p!==KDF.p) throw Error('Unsupported vault format or encryption parameters.');
 const read=(v,n)=>{if(typeof v!=='string'|| !/^[A-Za-z0-9+/]*={0,2}$/.test(v))throw Error('Invalid encrypted vault.');const b=Buffer.from(v,'base64');if(n&&b.length!==n)throw Error('Invalid encrypted vault.');return b;};
 const salt=read(e.salt,32),nonce=read(e.nonce,12),tag=read(e.tag,16),ciphertext=read(e.ciphertext);
 const key=await derive(password,salt);
 try {
  const cipher=crypto.createDecipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from('LocalTerm vault v1'));cipher.setAuthTag(tag);
  const plaintext=Buffer.concat([cipher.update(ciphertext),cipher.final()]);
  try{return {data:validate(JSON.parse(plaintext.toString())),key,salt};}finally{plaintext.fill(0);}
 }catch {key.fill(0);throw Error('Wrong password, or this vault is damaged.');}
}
async function atomicWrite(file,bytes,expected) {
 let existing;try{existing=await fs.readFile(file);}catch(e){if(e.code!=='ENOENT')throw e;}
 if(expected===null && existing || typeof expected==='string' && (!existing||digest(existing)!==expected)) throw Error('The file changed outside LocalTerm. Reopen it, or save a copy to avoid overwriting changes.');
 const temporary=path.join(path.dirname(file),`.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
 let handle;
 try{handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await fs.rename(temporary,file);}finally{if(handle)await handle.close();await fs.rm(temporary,{force:true});}
 return digest(bytes);
}
class Vault {
 constructor(){this.lock();}
 lock(){if(this.key)this.key.fill(0);this.key=null;this.salt=null;this.data=null;this.hash=null;}
 state(){return {locked:!this.key,path:this.file||null,...(this.key?{data:structuredClone(this.data)}:{})};}
 async open(file,password){const stat=await fs.stat(file);if(stat.size>MAX)throw Error('Vault is too large.');const bytes=await fs.readFile(file);const result=await decode(bytes,password);this.lock();Object.assign(this,result,{file,hash:digest(bytes)});return this.state();}
 async create(file,password){if(password.length<12)throw Error('Use at least 12 characters for your vault password.');const salt=crypto.randomBytes(32),key=await derive(password,salt);const data={hosts:[],keys:[],snippets:[],forwards:[],knownHosts:{},settings:{}};try{const hash=await atomicWrite(file,seal(data,key,salt),null);this.lock();Object.assign(this,{file,salt,key,data,hash});return this.state();}catch(e){key.fill(0);throw e;}}
 async save(data){if(!this.key)throw Error('Unlock a vault first.');const next=validate(data);this.hash=await atomicWrite(this.file,seal(next,this.key,this.salt),this.hash);this.data=next;return this.state();}
 async copy(file){if(!this.key)throw Error('Unlock a vault first.');if(file===this.file)throw Error('Choose a different file for the copy.');await atomicWrite(file,seal(this.data,this.key,this.salt),null);return this.state();}
 async password(password){if(!this.key)throw Error('Unlock a vault first.');if(password.length<12)throw Error('Use at least 12 characters.');const salt=crypto.randomBytes(32),key=await derive(password,salt);try{const hash=await atomicWrite(this.file,seal(this.data,key,salt),this.hash);this.key.fill(0);Object.assign(this,{key,salt,hash});return this.state();}catch(e){key.fill(0);throw e;}}
}
module.exports={Vault,decode,seal,derive,validate};
