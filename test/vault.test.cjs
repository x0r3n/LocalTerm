const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Vault}=require('../src/vault.cjs');
const password='correct horse battery staple';
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'localterm-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return path.join(dir,'portable.ltvault');}
test('hosts, passwords and key contents survive encrypted portable round trip',async t=>{
 const file=await fixture(t),a=new Vault();await a.create(file,password);
 const data=a.state().data;data.hosts.push({id:'h',label:'Production',address:'secret.example.test',port:22,username:'alice',password:'secret-login',keyId:'k',jumpHostIds:['jump']},{id:'jump',label:'Bastion',address:'secret-jump.test',port:22,username:'bastion',password:'jump-secret'});data.keys.push({id:'k',label:'Identity',privateKey:'PRIVATE KEY CONTENT',passphrase:'key-passphrase'});
 data.hosts[0].terminalTheme={preset:'custom',colors:{background:'#7a251e',foreground:'#e7d6ac',cursor:'#ffffff',selectionBackground:'#a24b3d'}};
 data.settings.terminalClipboard={enabled:false};
 data.settings.autoLock={enabled:false,idleMinutes:45,onScreenLock:false,onSuspend:false};
 await a.save(data);const bytes=await fs.readFile(file,'utf8');for(const value of ['secret.example.test','secret-login','PRIVATE KEY CONTENT','alice','key-passphrase','secret-jump.test','jump-secret','jumpHostIds','autoLock','terminalTheme','#7a251e'])assert(!bytes.includes(value));
 const copy=path.join(path.dirname(file),'other.ltvault');await a.copy(copy);a.lock();assert.equal(a.key,null);assert.equal(a.state().data,undefined);
 const b=new Vault();await b.open(copy,password);assert.deepEqual(b.data,data);assert.equal((await fs.stat(file)).mode&0o777,0o600);
});
test('wrong password and authenticated ciphertext tampering are rejected',async t=>{
 const file=await fixture(t),a=new Vault();await a.create(file,password);const b=new Vault();await assert.rejects(b.open(file,'incorrect-password'),/Wrong password/);assert.equal(b.key,null);
 const envelope=JSON.parse(await fs.readFile(file,'utf8'));const ciphertext=Buffer.from(envelope.ciphertext,'base64');ciphertext[5]^=1;envelope.ciphertext=ciphertext.toString('base64');await fs.writeFile(file,JSON.stringify(envelope));await assert.rejects(b.open(file,password),/damaged/);
});
test('external edits are not overwritten, password rotation invalidates old password',async t=>{
 const file=await fixture(t),a=new Vault(),b=new Vault();await a.create(file,password);await b.open(file,password);await a.password('a different long password');await assert.rejects(b.save(b.data),/changed outside/);b.lock();await assert.rejects(b.open(file,password),/Wrong password/);await b.open(file,'a different long password');
});
test('malicious KDF parameters and destructive create/copy are rejected',async t=>{
 const file=await fixture(t),a=new Vault();await a.create(file,password);await assert.rejects(a.create(file,password),/changed outside/);await assert.rejects(a.copy(file),/different file/);
 const envelope=JSON.parse(await fs.readFile(file,'utf8'));envelope.N=2147483648;await fs.writeFile(file,JSON.stringify(envelope));await assert.rejects(new Vault().open(file,password),/Unsupported/);
});
test('forwarding rules stay encrypted and old vault collections migrate without losing hosts',async t=>{
 const {validate}=require('../src/vault.cjs');const legacy={hosts:[{id:'legacy',label:'Existing host',address:'existing.test',username:'root',port:22}],keys:[],snippets:[],knownHosts:{},settings:{}};
 const migrated=validate(legacy);assert.deepEqual(migrated.forwards,[]);assert.deepEqual(migrated.hosts,legacy.hosts);assert.equal(legacy.forwards,undefined);
 const file=await fixture(t),vault=new Vault();await vault.create(file,password);migrated.forwards.push({id:'tunnel',label:'Private database',hostId:'legacy',type:'local',bindAddress:'127.0.0.1',bindPort:15432,targetAddress:'private-db.internal',targetPort:5432});await vault.save(migrated);
 assert(!(await fs.readFile(file,'utf8')).includes('private-db.internal'));vault.lock();await vault.open(file,password);assert.deepEqual(vault.data.forwards,migrated.forwards);
});
