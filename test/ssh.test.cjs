const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const net=require('node:net');
const {createRequire}=require('node:module');
const {generateKeyPairSync}=require('node:crypto');
const {Server,utils}=require('ssh2');
const {EventEmitter}=require('node:events');
test('desktop IPC SSH trust, streaming UTF-8, SFTP, and changed-identity rejection',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'localterm-ssh-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const userKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'});
 const parsedUserKey=utils.parseKey(userKey);
 const hostKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'});
 const server=new Server({hostKeys:[hostKey]},client=>{
  client.on('error',()=>{});
  client.on('authentication',ctx=>{if(ctx.username==='alice'&&ctx.method==='password'&&ctx.password==='test-secret')return ctx.accept();if(ctx.username==='alice'&&ctx.method==='publickey'&&ctx.key.data.equals(parsedUserKey.getPublicSSH())&&(!ctx.signature||parsedUserKey.verify(ctx.blob,ctx.signature,ctx.hashAlgo)===true))return ctx.accept();ctx.reject();});
  client.on('ready',()=>client.on('session',accept=>{
   const session=accept();session.on('pty',accept=>accept());session.on('window-change',accept=>accept?.());
   session.on('shell',accept=>{const stream=accept();stream.write('Welcome to local test server\r\n');stream.on('data',data=>{if(data.toString()==='exit'||data.includes(4)){stream.exit(0);stream.end();return;}if(data.toString()==='unicode'){const bytes=Buffer.from('héllő');stream.write(bytes.subarray(0,2));setTimeout(()=>stream.write(bytes.subarray(2)),10);}else stream.write(data);});});
   session.on('sftp',accept=>{const ftp=accept();ftp.on('OPENDIR',(id)=>ftp.handle(id,Buffer.from('directory')));ftp.on('READDIR',(id)=>{if(!ftp.listed){ftp.listed=true;ftp.name(id,[{filename:'readme.txt',longname:'readme.txt',attrs:{mode:0o100644,size:12,uid:0,gid:0,atime:1,mtime:1}}]);}else ftp.status(id,1);});ftp.on('CLOSE',id=>ftp.status(id,0));});
  }));
 });
 await new Promise(res=>server.listen(0,'127.0.0.1',res));t.after(()=>server.close());
 const events=new EventEmitter();let apiHandler,ready;const dialogs=[];
 class Window {constructor(){this.webContents={mainFrame:{},send:(name,data)=>events.emit(name,data),setWindowOpenHandler(){},on(){}};}isDestroyed(){return false;}loadFile(){} }
 let clipboardText='';const electron={clipboard:{writeText:text=>clipboardText=text,readText:()=>clipboardText},app:{whenReady:()=>({then:fn=>{ready=Promise.resolve().then(fn);}}),setName(){},getPath:()=>dir,on(){},quit(){}},BrowserWindow:Window,ipcMain:{handle:(_,handler)=>apiHandler=handler},dialog:{showMessageBox:async(_,opts)=>{dialogs.push(opts);return {response:1};},showSaveDialog:async()=>({filePath:path.join(dir,'test.ltvault')})},powerMonitor:{on(){}},session:{defaultSession:{setPermissionRequestHandler(){}}}};
 const filename=path.resolve(__dirname,'../src/main.cjs');const req=createRequire(filename),context={require:n=>n==='electron'?electron:req(n),__dirname:path.dirname(filename),setTimeout,setInterval,Buffer,console,structuredClone,module:{exports:{}}};
 vm.runInNewContext((await fs.readFile(filename,'utf8'))+'\nmodule.exports={vault,getWindow:()=>win};',context,{filename});await ready;
 const {vault,getWindow}=context.module.exports;const invoke=(method,payload)=>apiHandler({sender:getWindow().webContents,senderFrame:getWindow().webContents.mainFrame},method,payload);
 await invoke('vault:create',{password:'integration test password'});
 const data=vault.state().data;data.hosts.push({id:'host',label:'Test',address:'127.0.0.1',port:server.address().port,username:'alice',password:'test-secret'});await invoke('vault:save',{data});
 let output='';events.on('ssh:data',p=>output+=p.data);
 const {id}=await invoke('ssh:connect',{hostId:'host'});assert.equal(dialogs.length,1);assert.match(dialogs[0].detail,/SHA256:/);await invoke('ssh:start',{id});await new Promise(res=>setTimeout(res,80));assert.match(output,/Welcome/);
 await invoke('terminal:copy',{id,text:'selection'});assert.equal(clipboardText,'selection');clipboardText='paste payload';assert.equal((await invoke('terminal:paste',{id})).text,'paste payload');await assert.rejects(invoke('terminal:copy',{id:'missing',text:'bad'}),/closed/);
 const disabled=vault.state().data;disabled.settings.terminalClipboard={enabled:false};await invoke('vault:save',{data:disabled});await invoke('terminal:copy',{id,text:'disabled'});assert.equal(clipboardText,'paste payload');assert.equal((await invoke('terminal:paste',{id})).text,'');disabled.settings.terminalClipboard.enabled=true;await invoke('vault:save',{data:disabled});
 await assert.rejects(invoke('terminal:copy',{id,text:'x'.repeat(1024*1024)}),/too large/);
 await invoke('ssh:data',{id,data:'unicode'});await new Promise(res=>setTimeout(res,100));assert.match(output,/héllő/);
 const files=await invoke('sftp:list',{id,path:'.'});assert.equal(files[0].name,'readme.txt');assert.equal(files[0].type,'file');
 const keyed=vault.state().data;keyed.keys.push({id:'identity',label:'Test identity',privateKey:userKey});keyed.hosts.push({...keyed.hosts[0],id:'keyed',password:'',keyId:'identity'});await invoke('vault:save',{data:keyed});const keySession=await invoke('ssh:connect',{hostId:'keyed'});await invoke('ssh:start',{id:keySession.id});assert.equal(dialogs.length,1,'known host fingerprint reused for key login');
 for(const [sessionId,input] of [[keySession.id,'exit'],[(await invoke('ssh:connect',{hostId:'host'})).id,'\x04']]){
  const closed=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Exit did not close SSH')),2000);const onClose=payload=>{if(payload.id!==sessionId)return;clearTimeout(timer);events.off('ssh:closed',onClose);resolve();};events.on('ssh:closed',onClose);});await invoke('ssh:start',{id:sessionId});await invoke('ssh:data',{id:sessionId,data:input});await closed;await assert.rejects(invoke('sftp:list',{id:sessionId,path:'.'}),/closed/);
 }
 const jump2=await require('./helpers/jump-server.cjs').jumpServer(t,{destination:'target.internal',port:server.address().port,username:'second',password:'second-secret'});
 const jump1=await require('./helpers/jump-server.cjs').jumpServer(t,{destination:'second.internal',port:jump2.port});
 const routed=vault.state().data;routed.hosts.push({...jump1.host,id:'jump1'},{...jump2.host,id:'jump2',address:'second.internal',jumpHostIds:['jump1']},{id:'routed',label:'Private destination',address:'target.internal',port:server.address().port,username:'alice',keyId:'identity',jumpHostIds:['jump2']});await invoke('vault:save',{data:routed});
 const routedSession=await invoke('ssh:connect',{hostId:'routed'});await invoke('ssh:start',{id:routedSession.id});assert.equal(dialogs.length,4,'each hop has its own SSH identity verification');assert.equal((await invoke('sftp:list',{id:routedSession.id,path:'.'}))[0].name,'readme.txt');assert.equal(jump1.requests[0].destIP,'second.internal');assert.equal(jump2.requests[0].destIP,'target.internal');
 await invoke('ssh:close',{id:routedSession.id});await new Promise(resolve=>setTimeout(resolve,70));assert.equal(jump1.peers.size,0);assert.equal(jump2.peers.size,0);
 const changedJump=vault.state().data;changedJump.knownHosts['127.0.0.1:'+jump1.port]='00'.repeat(32);await vault.save(changedJump);await assert.rejects(invoke('ssh:connect',{hostId:'routed'}),/verification|closed/i);assert.match(dialogs.at(-1).message,/changed/);
 await invoke('vault:forgetHost',{address:'127.0.0.1',port:jump1.port});
 // Lock while an intermediate-host trust prompt is pending: every transport closes.
 const normalPrompt=electron.dialog.showMessageBox;let finishPrompt,promptShown;const shown=new Promise(resolve=>promptShown=resolve);
 electron.dialog.showMessageBox=async()=>{promptShown();return new Promise(resolve=>finishPrompt=resolve);};
 const pending=assert.rejects(invoke('ssh:connect',{hostId:'routed'}),/closed|locked|verification/i);await shown;await invoke('vault:lock');finishPrompt({response:1});await pending;await new Promise(resolve=>setTimeout(resolve,40));assert.equal(jump1.peers.size,0);electron.dialog.showMessageBox=normalPrompt;await invoke('vault:unlock',{password:'integration test password'});
 const reserve=net.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const proxyPort=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
 const tunneling=vault.state().data;tunneling.forwards=[{id:'dynamic-rule',label:'Proxy',type:'dynamic',hostId:'host',bindAddress:'127.0.0.1',bindPort:proxyPort}];await invoke('vault:save',{data:tunneling});
 const tunnel=await invoke('forward:start',{ruleId:'dynamic-rule'});assert.equal(tunnel.status,'running');assert.equal((await invoke('forward:list')).length,1);
 await invoke('vault:lock');assert.equal(vault.key,null);await assert.rejects(invoke('terminal:paste',{id}),/Unlock/);await assert.rejects(invoke('terminal:copy',{id,text:'locked'}),/Unlock/);await assert.rejects(new Promise((resolve,reject)=>{const socket=net.connect(proxyPort,'127.0.0.1');socket.once('connect',()=>{socket.destroy();resolve();});socket.once('error',reject);}),/ECONNREFUSED/);await invoke('vault:unlock',{password:'integration test password'});
 const data2=vault.state().data;data2.knownHosts['127.0.0.1:'+server.address().port]='00'.repeat(32);await vault.save(data2);
 await assert.rejects(invoke('ssh:connect',{hostId:'host'}),/verification|closed/i);assert.match(dialogs.at(-1).message,/changed/);await invoke('vault:lock');
});
