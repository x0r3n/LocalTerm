const {Server}=require('ssh2');const net=require('node:net');const {generateKeyPairSync}=require('node:crypto');
async function jumpServer(t,{destination,port,password='jump-secret',username='bastion'}={}){
 const peers=new Set(),sockets=new Set(),requests=[];
 const key=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'});
 const server=new Server({hostKeys:[key]},client=>{
  peers.add(client);client.on('error',()=>{});client.on('close',()=>peers.delete(client));client.on('authentication',ctx=>ctx.username===username&&ctx.method==='password'&&ctx.password===password?ctx.accept():ctx.reject());
  client.on('ready',()=>client.on('tcpip',(accept,reject,info)=>{
   requests.push(info);if(destination&&info.destIP!==destination)return reject();
   const socket=net.connect(port||info.destPort,'127.0.0.1');sockets.add(socket);socket.on('error',()=>reject());socket.once('connect',()=>{const channel=accept();sockets.add(channel);channel.on('error',()=>socket.destroy());channel.on('close',()=>socket.destroy());socket.on('close',()=>channel.destroy());socket.pipe(channel).pipe(socket);});
  }));
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(()=>{for(const s of sockets)s.destroy();for(const c of peers)c.destroy();server.close();});
 return {port:server.address().port,requests,peers,key,host:{id:'jump',label:'Jump',address:'127.0.0.1',port:server.address().port,username,password}};
}
module.exports={jumpServer};
