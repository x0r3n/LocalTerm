'use strict';
const {app,BrowserWindow,ipcMain,dialog,powerMonitor,session,clipboard}=require('electron');
const {openRoute}=require('./ssh-route.cjs');
const {Vault}=require('./vault.cjs');
const {Preferences}=require('./preferences.cjs');
const {AutoLock}=require('./auto-lock.cjs');
const {mergeVaults}=require('./import-vault.cjs');
const {installReturnShortcut}=require('./shortcuts.cjs');
const {ForwardManager}=require('./forwarding.cjs');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {StringDecoder}=require('node:string_decoder');
const vault=new Vault(),connections=new Map();
let win, pendingPath, preferences, queue=Promise.resolve(), generation=0;
const serial=fn=>{const job=queue.then(fn);queue=job.catch(()=>{});return job;};
const autoLock=new AutoLock({getVault:()=>vault,lock:()=>lock(),serial});
function emit(event,data){if(win&&!win.isDestroyed())win.webContents.send(event,data);}
function closeSessions(){generation++;forwards.stopAll();for(const s of connections.values()){s.close();}connections.clear();}
function vaultState(){const state=vault.state();return state.locked?{...state,path:pendingPath||state.path}:state;}
function lock(){closeSessions();vault.lock();emit('vault:locked',vaultState());}
async function rememberVault(file,result){pendingPath=file;autoLock.activity();try{await preferences.rememberVault(file);return result;}catch{return {...result,preferenceWarning:'Vault opened, but its path could not be remembered on this computer.'};}}
function unlocked(){if(!vault.key)throw Error('Unlock a vault first.');}
const filters=[{name:'LocalTerm encrypted vault',extensions:['ltvault']}];
async function selectSave(title){return (await dialog.showSaveDialog(win,{title,defaultPath:'My vault.ltvault',filters})).filePath;}
function conn(id){unlocked();const s=connections.get(id);if(!s)throw Error('Session is closed.');return s;}
async function connect({hostId,cols=100,rows=30,terminal=true}) {
 unlocked();const data=structuredClone(vault.data),current=generation,id=crypto.randomUUID();
 const isCurrent=()=>current===generation&&!!vault.key&&!s.closed;
 const s={client:null,stream:null,clients:[],closed:false,close(){if(s.closed)return;s.closed=true;s.stream?.destroy();for(const client of [...s.clients].reverse())client.destroy();connections.delete(id);emit('ssh:closed',{id});}};connections.set(id,s);
 try{
  s.client=await openRoute({data,hostId,isCurrent,register:client=>{s.clients.push(client);client.on('error',e=>{emit('ssh:error',{id,message:e.message});});client.on('close',()=>s.close());},verify:async(host,hash)=>{
   if(!isCurrent())return false;
   const fingerprintKey=`${host.address}:${host.port||22}`,known=vault.data.knownHosts[fingerprintKey];if(known===hash)return true;
   if(known){await dialog.showMessageBox(win,{type:'error',message:'SSH host key changed',detail:`${host.label} · ${fingerprintKey}\nThe server identity differs from the fingerprint saved in your vault. Connection refused. Verify the server and remove its saved fingerprint in the host editor before reconnecting.`,buttons:['Cancel connection']});return false;}
   const fingerprint='SHA256:'+Buffer.from(hash,'hex').toString('base64').replace(/=+$/,'');
   const {response}=await dialog.showMessageBox(win,{type:'warning',message:'Trust this SSH server?',detail:`${host.label} · ${fingerprintKey}\n${fingerprint}\n\nCompare this fingerprint with your server administrator before trusting it.`,buttons:['Cancel','Trust and connect'],defaultId:0,cancelId:0,noLink:true});
   if(response!==1||!isCurrent())return false;
   return serial(async()=>{if(!isCurrent())return false;const latest=vault.data.knownHosts[fingerprintKey];if(latest)return latest===hash;const updated=structuredClone(vault.data);updated.knownHosts[fingerprintKey]=hash;await vault.save(updated);return true;});
  }});
  if(!isCurrent())throw Error('Vault was locked.');
  if(terminal){
   s.stream=await new Promise((resolve,reject)=>{
    const closed=()=>reject(Error('Connection closed.'));s.client.once('close',closed);
    s.client.shell({term:'xterm-256color',cols,rows},(error,stream)=>{s.client.removeListener('close',closed);if(error)return reject(error);if(!isCurrent()){stream.destroy();return reject(Error('Vault was locked.'));}resolve(stream);});
   });
   const stream=s.stream;stream.pause();const decoder=new StringDecoder('utf8');
   stream.on('data',buffer=>emit('ssh:data',{id,data:decoder.write(buffer)}));stream.stderr.on('data',buffer=>emit('ssh:data',{id,data:buffer.toString('utf8')}));stream.on('close',()=>s.close());
  }
  return {id};
 }catch(error){s.close();throw error;}
}

async function sftp(id){const s=conn(id);return new Promise((resolve,reject)=>s.client.sftp((e,v)=>e?reject(e):resolve(v)));}
const forwards=new ForwardManager({openSSH:async hostId=>{const {id}=await connect({hostId,terminal:false});const s=conn(id);return {client:s.client,close:()=>s.close()};},emit:status=>emit('forward:status',status)});
const handlers={
 'vault:state':()=>vaultState(),
 'app:activity':()=>{autoLock.activity();},
 'terminal:copy':p=>{const s=conn(p.id);if(!s.stream)throw Error('Terminal is closed.');if(vault.data.settings?.terminalClipboard?.enabled===false)return; if(typeof p.text!=='string'||p.text.length>1024*1024-64)throw Error('Selected text is too large.');if(p.text)clipboard.writeText(p.text);},
 'terminal:paste':p=>{const s=conn(p.id);if(!s.stream)throw Error('Terminal is closed.');if(vault.data.settings?.terminalClipboard?.enabled===false)return {text:''};const text=clipboard.readText();if(text.length>1024*1024-64)throw Error('Clipboard text is too large.');return {text};},
 'vault:create':p=>serial(async()=>{if(typeof p.password!=='string'||p.password.length<12)throw Error('Use at least 12 characters.');const file=await selectSave('Create encrypted vault');if(!file)return {canceled:true};const state=await vault.create(file,p.password);closeSessions();return rememberVault(file,state);}),
 'vault:open':p=>serial(async()=>{const result=await dialog.showOpenDialog(win,{title:'Open encrypted vault',properties:['openFile'],filters:[...filters,{name:'All files',extensions:['*']}]});if(result.canceled)return {canceled:true};const file=result.filePaths[0];if(!p.password){lock();pendingPath=file;return {locked:true,path:file};}const state=await vault.open(file,p.password);closeSessions();return rememberVault(file,state);}),
 'vault:unlock':p=>serial(async()=>{const file=pendingPath||vault.file;if(!file)throw Error('Choose a vault file first.');const state=await vault.open(file,p.password);closeSessions();return rememberVault(file,state);}),
 'vault:save':p=>serial(()=>{unlocked();const data=structuredClone(p.data);data.knownHosts=structuredClone(vault.data.knownHosts);const old=vault.data;return vault.save(data).then(state=>{for(const running of forwards.list()){const before=old.forwards?.find(r=>r.id===running.ruleId),after=state.data.forwards.find(r=>r.id===running.ruleId);if(JSON.stringify(before)!==JSON.stringify(after)||JSON.stringify(old.hosts)!==JSON.stringify(state.data.hosts)||JSON.stringify(old.keys)!==JSON.stringify(state.data.keys))forwards.stop(running.ruleId);}return state;});}),
 'vault:forgetHost':p=>serial(async()=>{unlocked();const data=structuredClone(vault.data);delete data.knownHosts[p.address+':'+Number(p.port||22)];return vault.save(data);}),
 'vault:import':p=>serial(async()=>{unlocked();const picked=await dialog.showOpenDialog(win,{title:'Import encrypted LocalTerm vault',properties:['openFile'],filters});if(picked.canceled)return {canceled:true};if(picked.filePaths[0]===vault.file)throw Error('Choose the source vault, not the vault already open.');const source=new Vault();try{await source.open(picked.filePaths[0],p.password);const {data,summary}=mergeVaults(vault.data,source.data);const backup=vault.file+'.before-import-'+Date.now()+'.ltvault';await fs.copyFile(vault.file,backup,require('node:fs').constants.COPYFILE_EXCL);await fs.chmod(backup,0o600);const result=await vault.save(data);return {...result,importSummary:summary,backupPath:backup};}finally{source.lock();}}),
 'vault:saveAs':()=>serial(async()=>{unlocked();const file=await selectSave('Save encrypted vault copy');return file?vault.copy(file):{canceled:true};}),
 'vault:password':p=>serial(()=>vault.password(p.password)),
 'vault:lock':()=>serial(()=>{lock();return vaultState();}),
 'key:read':async()=>{unlocked();const r=await dialog.showOpenDialog(win,{title:'Import SSH private key into encrypted vault',properties:['openFile']});if(r.canceled)return {canceled:true};const stat=await fs.stat(r.filePaths[0]);if(stat.size>1024*1024)throw Error('Key file is too large.');return {privateKey:await fs.readFile(r.filePaths[0],'utf8')};},
 'ssh:connect':p=>connect({hostId:p.hostId,cols:p.cols,rows:p.rows}),
 'forward:list':()=>{unlocked();return forwards.list();},
 'forward:start':async p=>{unlocked();const rule=vault.data.forwards?.find(r=>r.id===p.ruleId);if(!rule)throw Error('Forwarding rule not found.');return forwards.start(structuredClone(rule));},
 'forward:stop':p=>{unlocked();return forwards.stop(p.ruleId);},
 'ssh:start':p=>{conn(p.id).stream?.resume();},
 'ssh:data':p=>{const s=conn(p.id);if(typeof p.data!=='string'||p.data.length>1024*1024)throw Error('Invalid terminal input.');s.stream?.write(p.data);},
 'ssh:resize':p=>{conn(p.id).stream?.setWindow(Math.max(1,Math.min(500,p.rows)),Math.max(1,Math.min(1000,p.cols)),0,0);},
 'ssh:close':p=>{const s=connections.get(p.id);s?.close();},
 'sftp:list':async p=>{const ftp=await sftp(p.id);try{return await new Promise((resolve,reject)=>ftp.readdir(p.path||'.',(e,files)=>e?reject(e):resolve(files.map(f=>({name:f.filename,type:f.attrs.isDirectory()?'directory':'file',size:f.attrs.size})))));}finally{ftp.end();}},
 'sftp:download':async p=>{unlocked();const {filePath}=await dialog.showSaveDialog(win,{title:'Download remote file',defaultPath:path.posix.basename(p.path)});if(!filePath)return {canceled:true};const ftp=await sftp(p.id);try{await new Promise((res,rej)=>ftp.fastGet(p.path,filePath,e=>e?rej(e):res()));return {ok:true};}finally{ftp.end();}},
 'sftp:upload':async p=>{unlocked();const r=await dialog.showOpenDialog(win,{title:'Upload file to server',properties:['openFile']});if(r.canceled)return {canceled:true};const file=r.filePaths[0],remote=path.posix.join(p.path||'.',path.basename(file));const ftp=await sftp(p.id);try{const info=await new Promise(res=>ftp.stat(remote,(e,a)=>res(e?null:a)));if(info){const answer=await dialog.showMessageBox(win,{type:'warning',message:'Replace remote file?',detail:remote,buttons:['Cancel','Replace'],defaultId:0,cancelId:0});if(answer.response!==1)return {canceled:true};}await new Promise((res,rej)=>ftp.fastPut(file,remote,e=>e?rej(e):res()));return {ok:true};}finally{ftp.end();}}
};
app.whenReady().then(async()=>{
 app.setName('LocalTerm');preferences=new Preferences(app.getPath('userData'));pendingPath=await preferences.lastVault();
 session.defaultSession.setPermissionRequestHandler((_,__,callback)=>callback(false));
 win=new BrowserWindow({width:1320,height:860,minWidth:950,minHeight:650,backgroundColor:'#101216',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,devTools:!app.isPackaged}});
 installReturnShortcut(win.webContents);
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',e=>e.preventDefault());
 ipcMain.handle('api',async(event,method,payload={})=>{
  if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('Unauthorized frame.');
  if(!Object.hasOwn(handlers,method))throw Error('Unknown operation.');autoLock.activity();
  try{return await handlers[method](payload||{});}catch(e){throw Error(e.message||'Operation failed.');}
 });
 win.loadFile(path.join(__dirname,'index.html'));
 powerMonitor.on('lock-screen',()=>autoLock.check('screen'));powerMonitor.on('suspend',()=>autoLock.check('suspend'));
 setInterval(()=>autoLock.check(),1000).unref();
});
app.on('window-all-closed',()=>{lock();app.quit();});app.on('before-quit',()=>lock());
