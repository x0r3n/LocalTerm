'use strict';
const {Client,utils}=require('ssh2');
function resolveRoute(data,hostId){
 const route=[],visiting=new Set(),done=new Set();
 function visit(id){
  if(visiting.has(id))throw Error('Jump host cycle detected. Choose a route without repeated hosts.');
  if(done.has(id))return;
  const host=data.hosts.find(h=>h.id===id);if(!host)throw Error('A selected jump host is missing. Edit the connection route first.');
  visiting.add(id);
  const jumps=host.jumpHostIds??(host.jumpHostId?[host.jumpHostId]:[]);
  if(!Array.isArray(jumps)||jumps.some(value=>typeof value!=='string'||!value)||new Set(jumps).size!==jumps.length)throw Error('Invalid jump host selection.');
  if(visiting.size>8)throw Error('Use at most eight SSH hosts in one route.');
  for(const jump of jumps)visit(jump);
  visiting.delete(id);done.add(id);route.push(host);
  if(route.length>8)throw Error('Use at most eight SSH hosts in one route.');
 }
 visit(hostId);return route;
}
function credentials(data,host){
 if(!host.username?.trim())throw Error(`${host.label}: set an SSH username before connecting.`);
 if(host.migrationBlockers?.length)throw Error(`${host.label}: imported SSH settings still need migration. Review its notes.`);
 const key=host.keyId?data.keys.find(k=>k.id===host.keyId):null;
 if(host.keyId&&!key)throw Error(`${host.label}: the selected private key is missing.`);
 if(key&&utils.parseKey(key.privateKey,key.passphrase||undefined) instanceof Error)throw Error(`${host.label}: invalid private key or passphrase.`);
 return {username:host.username,password:host.password||undefined,privateKey:key?.privateKey,passphrase:key?.passphrase||undefined};
}
async function openRoute({data,hostId,isCurrent,verify,register}){
 const route=resolveRoute(data,hostId);const auth=route.map(host=>credentials(data,host));let previous;
 for(let i=0;i<route.length;i++){
  if(!isCurrent())throw Error('Vault was locked.');
  const host=route[i];let sock;
  if(previous)sock=await new Promise((resolve,reject)=>{
   const closed=()=>reject(Error('Jump host disconnected.'));previous.once('close',closed);
   previous.forwardOut('127.0.0.1',0,host.address,Number(host.port)||22,(error,stream)=>{previous.removeListener('close',closed);if(error)return reject(Error(`${host.label}: jump host could not reach destination: ${error.message}`));if(!isCurrent()){stream.destroy();return reject(Error('Vault was locked.'));}stream.on('error',()=>{});resolve(stream);});
  });
  if(!isCurrent()){sock?.destroy();throw Error('Vault was locked.');}
  const client=new Client();register(client,host);
  await new Promise((resolve,reject)=>{
   const ready=()=>{cleanup();isCurrent()?resolve():reject(Error('Vault was locked.'));};
   const error=e=>{cleanup();reject(Error(`${host.label}: ${e.message}`));};
   const closed=()=>{cleanup();reject(Error(`${host.label}: connection closed.`));};
   const cleanup=()=>{client.removeListener('ready',ready);client.removeListener('error',error);client.removeListener('close',closed);};
   client.once('ready',ready);client.once('error',error);client.once('close',closed);
   try{client.connect({...auth[i],...(sock?{sock}:{host:host.address,port:Number(host.port)||22}),readyTimeout:20000,keepaliveInterval:15000,keepaliveCountMax:3,hostHash:'sha256',hostVerifier:(hash,accept)=>{Promise.resolve().then(()=>verify(host,hash)).then(accept,()=>accept(false));}});}catch(e){cleanup();sock?.destroy();reject(e);}
  });
  previous=client;
 }
 return previous;
}
module.exports={resolveRoute,openRoute};
