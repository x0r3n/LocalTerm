const {contextBridge,ipcRenderer}=require('electron');
const events=new Set(['ssh:data','ssh:closed','ssh:error','vault:locked','forward:status','session:return','files:progress']);
contextBridge.exposeInMainWorld('api',{platform:process.platform,call:(method,payload)=>ipcRenderer.invoke('api',method,payload),on:(event,callback)=>{if(!events.has(event))throw Error('Unknown event');const listener=(_,payload)=>callback(payload);ipcRenderer.on(event,listener);return ()=>ipcRenderer.removeListener(event,listener);}});
