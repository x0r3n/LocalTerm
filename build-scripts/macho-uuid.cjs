'use strict';
const crypto=require('node:crypto');
function patchUuid(bytes,identity){
 const data=Buffer.from(bytes);if(data.length<32||data.readUInt32LE(0)!==0xfeedfacf)throw Error('Expected a thin 64-bit Mach-O executable.');
 const end=32+data.readUInt32LE(20);if(end>data.length)throw Error('Invalid Mach-O command table.');let offset=32,changed=false;
 for(let i=0;i<data.readUInt32LE(16);i++){
  if(offset+8>end)throw Error('Invalid Mach-O command.');const cmd=data.readUInt32LE(offset),size=data.readUInt32LE(offset+4);if(size<8||offset+size>end)throw Error('Invalid Mach-O command size.');
  if(cmd===0x1b){if(size!==24||changed)throw Error('Invalid Mach-O UUID command.');const uuid=crypto.createHash('sha256').update(identity).update(data.subarray(offset+8,offset+24)).digest().subarray(0,16);uuid[6]=(uuid[6]&15)|0x50;uuid[8]=(uuid[8]&63)|0x80;uuid.copy(data,offset+8);changed=true;}offset+=size;
 }
 if(!changed)throw Error('Mach-O executable has no UUID.');return data;
}
module.exports={patchUuid};
