'use strict';
const crypto=require('node:crypto');
const {validate}=require('./vault.cjs');
const material=key=>key.privateKey.replace(/\r\n/g,'\n').trim();
const endpoint=h=>JSON.stringify([h.address.trim().toLowerCase(),Number(h.port),h.username]);
function mergeVaults(current,incoming){
 const data=validate(current),source=validate(incoming),keyIds=new Map(),hostIds=new Map(),claimed=new Set(),jumpMappings=[];
 const summary={hostsAdded:0,hostsMerged:0,keysAdded:0,forwardsAdded:0,hostsNeedingSetup:0};
 const occupied=new Set([...data.hosts,...data.keys,...data.forwards].map(x=>x.id));
 const fresh=id=>{let value=id;while(occupied.has(value))value=crypto.randomUUID();occupied.add(value);return value;};
 for(const key of source.keys){let existing=data.keys.find(k=>material(k)===material(key));if(existing){if(!existing.passphrase&&key.passphrase)existing.passphrase=key.passphrase;}else{existing={...key,id:fresh(key.id)};data.keys.push(existing);summary.keysAdded++;}keyIds.set(key.id,existing.id);}
 const frequency=new Map();for(const h of source.hosts)frequency.set(endpoint(h),(frequency.get(endpoint(h))||0)+1);
 for(const host of source.hosts){
  const mapped={...host,keyId:host.keyId?(keyIds.get(host.keyId)||''):''};
  let existing=data.hosts.find(h=>h.sourceApp&&h.sourceApp===host.sourceApp&&h.sourceId&&h.sourceId===host.sourceId);
  if(!existing)existing=data.hosts.find(h=>!claimed.has(h.id)&&!h.sourceId&&endpoint(h)===endpoint(host)&&(h.label.trim().toLowerCase()===host.label.trim().toLowerCase()||frequency.get(endpoint(host))===1));
  if(existing){claimed.add(existing.id);for(const key of ['password','keyId','group','notes','terminalTheme'])if(!existing[key]&&mapped[key])existing[key]=mapped[key];for(const key of ['sourceApp','sourceId','sourceMetadata','requiresMigrationSetup','migrationBlockers'])if(mapped[key]!==undefined)existing[key]=mapped[key];summary.hostsMerged++;}
  else{existing={...mapped,id:fresh(host.id)};data.hosts.push(existing);claimed.add(existing.id);summary.hostsAdded++;}
  if((existing.jumpHostIds===undefined&&existing.jumpHostId===undefined)||!current.hosts.some(h=>h.id===existing.id))jumpMappings.push([existing,host]);hostIds.set(host.id,existing.id);
 }
 for(const [target,host] of jumpMappings){const ids=host.jumpHostIds??(host.jumpHostId?[host.jumpHostId]:undefined);if(ids){target.jumpHostIds=ids.map(id=>hostIds.get(id)||id);delete target.jumpHostId;}}
 for(const host of data.hosts){if(Array.isArray(host.jumpHostIds))host.migrationBlockers=host.migrationBlockers?.filter(text=>!/jump-host/i.test(text));if(host.requiresMigrationSetup&&[...hostIds.values()].includes(host.id))summary.hostsNeedingSetup++;}
 for(const forward of source.forwards){const hostId=hostIds.get(forward.hostId);if(!hostId)continue;const mapped={...forward,hostId};const signature=f=>JSON.stringify([f.hostId,f.type,f.bindAddress,Number(f.bindPort),f.targetAddress||'',Number(f.targetPort)||0]);if(data.forwards.some(f=>signature(f)===signature(mapped)))continue;data.forwards.push({...mapped,id:fresh(forward.id)});summary.forwardsAdded++;}
 return {data:validate(data),summary};
}
module.exports={mergeVaults};
