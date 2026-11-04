'use strict';
const DEFAULTS=Object.freeze({enabled:true,idleMinutes:15,onScreenLock:true,onSuspend:true});
function lockSettings(settings){return {...DEFAULTS,...settings?.autoLock};}
function validateLockSettings(settings){
 const value=settings?.autoLock;if(value===undefined)return;
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.enabled!=='boolean'||typeof value.onScreenLock!=='boolean'||typeof value.onSuspend!=='boolean'||!Number.isInteger(value.idleMinutes)||value.idleMinutes<1||value.idleMinutes>1440)throw Error('Choose an automatic lock timeout between 1 and 1440 minutes.');
}
class AutoLock{
 constructor({getVault,lock,serial,now=Date.now}){Object.assign(this,{getVault,lock,serial,now});this.activity();}
 activity(){this.lastActivity=this.now();}
 shouldLock(reason){const vault=this.getVault();if(!vault.key)return false;const settings=lockSettings(vault.data?.settings);if(!settings.enabled)return false;return reason==='idle'?this.now()-this.lastActivity>=settings.idleMinutes*60000:reason==='screen'?settings.onScreenLock:reason==='suspend'?settings.onSuspend:false;}
 check(reason='idle'){if(!this.shouldLock(reason))return;const key=this.getVault().key;return this.serial(()=>{if(this.getVault().key===key&&this.shouldLock(reason))this.lock();});}
}
module.exports={AutoLock,lockSettings,validateLockSettings};
