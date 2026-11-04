'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const {generateKeyPairSync}=require('node:crypto');
const {Client,Server}=require('ssh2');
const {ForwardManager,validateRule}=require('../src/forwarding.cjs');
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
async function freePort(){const server=net.createServer();const port=await listen(server);await new Promise(resolve=>server.close(resolve));return port;}
function readUntil(socket,predicate){return new Promise((resolve,reject)=>{let data=Buffer.alloc(0);const timeout=setTimeout(()=>finish(Error('Timed out waiting for tunnel data')),3000);function finish(error){clearTimeout(timeout);socket.off('data',read);socket.off('error',fail);error?reject(error):resolve(data);}function fail(error){finish(error);}function read(chunk){data=Buffer.concat([data,chunk]);if(predicate(data))finish();}socket.on('data',read);socket.once('error',fail);});}
async function exchange(port,message){const socket=net.connect(port,'127.0.0.1');const result=readUntil(socket,b=>b.toString()===message);socket.on('connect',()=>socket.write(message));try{return (await result).toString();}finally{socket.destroy();}}
async function exerciseForwarding(t,viaJump=false){
 const sockets=new Set(),clients=new Set(),listeners=new Set();
 const track=s=>{sockets.add(s);s.on('error',()=>{});s.on('close',()=>sockets.delete(s));return s;};
 const echo=net.createServer(s=>{track(s);s.pipe(s);});const targetPort=await listen(echo);listeners.add(echo);
 const hostKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'});
 const ssh=new Server({hostKeys:[hostKey]},client=>{
  clients.add(client);client.on('error',()=>{});client.on('close',()=>clients.delete(client));
  client.on('authentication',ctx=>ctx.method==='password'&&ctx.password==='test'?ctx.accept():ctx.reject());
  const remoteListeners=new Map();
  client.on('close',()=>{for(const server of remoteListeners.values())server.close();});
  client.on('ready',()=>{
   client.on('tcpip',(accept,reject,info)=>{const remote=track(net.connect(info.destPort,info.destIP));remote.once('connect',()=>{const channel=track(accept());remote.pipe(channel).pipe(remote);});remote.once('error',()=>reject());});
   client.on('request',(accept,reject,name,info)=>{
    const key=info.bindAddr+':'+info.bindPort;
    if(name==='tcpip-forward'){
     const server=net.createServer(socket=>{track(socket);client.forwardOut(info.bindAddr,server.address().port,socket.remoteAddress,socket.remotePort,(error,channel)=>{if(error)return socket.destroy();track(channel);socket.pipe(channel).pipe(socket);});});
     server.on('error',()=>reject());server.listen(info.bindPort,info.bindAddr,()=>{remoteListeners.set(key,server);listeners.add(server);accept(server.address().port);});
    }else if(name==='cancel-tcpip-forward'){remoteListeners.get(key)?.close();remoteListeners.delete(key);accept();}else reject();
   });
  });
 });
 const sshPort=await listen(ssh);listeners.add(ssh);
 let jump;if(viaJump)jump=await require('./helpers/jump-server.cjs').jumpServer(t,{destination:'target.internal',port:sshPort});
 const statuses=[];
 const direct=()=>new Promise((resolve,reject)=>{const client=new Client();client.on('error',reject);client.on('ready',()=>resolve({client,close:()=>client.end()}));client.connect({host:'127.0.0.1',port:sshPort,username:'test',password:'test'});});
 const manager=new ForwardManager({emit:e=>statuses.push(e),openSSH:viaJump?async()=>{const clients=[];const client=await require('../src/ssh-route.cjs').openRoute({data:{hosts:[jump.host,{id:'host',label:'Target',address:'target.internal',port:sshPort,username:'test',password:'test',jumpHostIds:['jump']}],keys:[]},hostId:'host',isCurrent:()=>true,verify:async()=>true,register:c=>{clients.push(c);c.on('error',()=>{});}});return {client,close:()=>clients.forEach(c=>c.destroy())};}:direct});
 t.after(()=>{manager.stopAll();for(const s of sockets)s.destroy();for(const c of clients)c.end();for(const s of listeners)s.close();});
 const base={label:'Test forward',hostId:'host',bindAddress:'127.0.0.1',targetAddress:'127.0.0.1',targetPort};
 const localPort=await freePort(),remotePort=await freePort(),dynamicPort=await freePort();
 await manager.start({...base,id:'local',type:'local',bindPort:localPort});
 await manager.start({...base,id:'remote',type:'remote',bindPort:remotePort});
 await manager.start({...base,id:'socks',type:'dynamic',bindPort:dynamicPort});
 assert.equal(await exchange(localPort,'local tunnel works'),'local tunnel works');
 assert.equal(await exchange(remotePort,'remote tunnel works'),'remote tunnel works');
 const sock=track(net.connect(dynamicPort,'127.0.0.1'));
 const greeting=readUntil(sock,b=>b.length===2);sock.write(Buffer.from([5]));sock.write(Buffer.from([1,0]));assert.deepEqual(await greeting,Buffer.from([5,0]));
 const address=Buffer.from('localhost');const request=Buffer.concat([Buffer.from([5,1,0,3,address.length]),address,Buffer.from([targetPort>>8,targetPort&255])]);
 const reply=readUntil(sock,b=>b.length>=10);sock.write(request.subarray(0,6));sock.write(request.subarray(6));assert.equal((await reply)[1],0);
 const echoed=readUntil(sock,b=>b.toString()==='SOCKS transport works');sock.write('SOCKS transport works');assert.equal((await echoed).toString(),'SOCKS transport works');sock.destroy();
 // Invalid clients cannot request BIND or UDP ASSOCIATE through the proxy.
 const invalid=track(net.connect(dynamicPort,'127.0.0.1'));const g=readUntil(invalid,b=>b.length===2);invalid.write(Buffer.from([5,1,0]));await g;const denied=readUntil(invalid,b=>b.length>=10);invalid.write(Buffer.from([5,3,0,1,127,0,0,1,0,80]));assert.equal((await denied)[1],7);invalid.destroy();
 await assert.rejects(manager.start({...base,id:'local',type:'local',bindPort:localPort}),/already/);
 assert.equal(manager.list().length,3);manager.stopAll();assert.equal(manager.list().length,0);assert.equal(statuses.filter(s=>s.status==='stopped').length,3);
 await new Promise(resolve=>setTimeout(resolve,60));
 for(const port of [localPort,remotePort,dynamicPort])await assert.rejects(exchange(port,'must not connect'),/ECONNREFUSED/);
}
test('Local, Remote and SOCKS5 forwarding carry real traffic and stop all listeners',t=>exerciseForwarding(t));
test('all three forwarding types carry real traffic through a jump host',t=>exerciseForwarding(t,true));
test('port conflicts are surfaced and failed rules can be retried',async t=>{
 const server=net.createServer();const port=await listen(server);t.after(()=>server.close());
 const {EventEmitter}=require('node:events');let closed=0;const statuses=[];
 const manager=new ForwardManager({openSSH:async()=>({client:new EventEmitter(),close:()=>closed++}),emit:e=>statuses.push(e)});
 await assert.rejects(manager.start({id:'busy',label:'Busy',hostId:'h',type:'local',bindAddress:'127.0.0.1',bindPort:port,targetAddress:'localhost',targetPort:80}),/EADDRINUSE/);
 assert.equal(manager.list().length,0);assert.equal(closed,1);assert.equal(statuses.at(-1).status,'error');
});
test('stopping a pending SSH connection never starts a listener',async()=>{
 let resolveSSH,closed=0;const {EventEmitter}=require('node:events');
 const manager=new ForwardManager({openSSH:()=>new Promise(resolve=>resolveSSH=resolve)});
 const pending=manager.start({id:'pending',label:'Pending',hostId:'h',type:'dynamic',bindAddress:'127.0.0.1',bindPort:1080});
 manager.stopAll();resolveSSH({client:new EventEmitter(),close:()=>closed++});await assert.rejects(pending,/stopped/);assert.equal(manager.list().length,0);assert.equal(closed,1);
});
test('forwarding validates saved rules and port ranges',()=>{
 const base={id:'r',label:'R',hostId:'h',type:'local',bindAddress:'127.0.0.1',bindPort:8080,targetAddress:'localhost',targetPort:80};
 assert.throws(()=>validateRule({...base,bindPort:0}),/Listening port/);assert.throws(()=>validateRule({...base,type:'arbitrary'}),/Invalid/);assert.throws(()=>validateRule({...base,targetAddress:''}),/destination/);assert.equal(validateRule({...base,type:'dynamic',targetAddress:'',targetPort:''}).type,'dynamic');
});
