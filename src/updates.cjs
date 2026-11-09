'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const API='https://api.github.com/repos/x0r3n/LocalTerm/releases/latest';
function newer(tag,current){const parse=s=>/^v?(\d+)\.(\d+)\.(\d+)$/.exec(s)?.slice(1).map(Number);const a=parse(tag),b=parse(current);if(!a||!b)return false;for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;}
function assetFor(release,platform,arch){const version=release.tag_name.replace(/^v/,'');const name=platform==='darwin'&&arch==='arm64'?`LocalTerm-${version}-Mac-AppleSilicon.zip`:platform==='win32'&&arch==='x64'?`LocalTerm-${version}-Windows-x64-Portable.exe`:null;const a=release.assets?.find(a=>a.name===name);if(!a||!/^sha256:[a-f0-9]{64}$/.test(a.digest||'')||!a.browser_download_url?.startsWith('https://github.com/x0r3n/LocalTerm/releases/download/'))return null;return a;}
async function response(url){const r=await fetch(url,{headers:{'User-Agent':'LocalTerm-updater','Accept':'application/vnd.github+json'},signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error(`GitHub returned HTTP ${r.status}.`);return r;}
class Updates{
 constructor({app,dialog,getWindow,beforeQuit=async()=>{}}){Object.assign(this,{app,dialog,getWindow,beforeQuit});this.busy=false;this.checkedThisRun=false;}
 async check(manual=false){
  if(this.busy)return;this.busy=true;let installing=false;
  try{
   const file=path.join(this.app.getPath('userData'),'update-check.json');const today=new Date().toLocaleDateString('en-CA');
   if(!manual){if(this.checkedThisRun)return;this.checkedThisRun=true;let last;try{last=JSON.parse(await fs.readFile(file,'utf8')).day;}catch{}if(last===today)return;}
   const release=await (await response(API)).json();
   if(!manual){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify({day:today}),{mode:0o600});}
   if(release.draft||release.prerelease||!newer(release.tag_name,this.app.getVersion())){if(manual)await this.message('LocalTerm is up to date.',`Installed version: ${this.app.getVersion()}`);return;}
   const asset=assetFor(release,process.platform,process.arch);
   if(!asset){await this.message('A new version is available.',`${release.tag_name} is available, but no compatible verified update package was found.`);return;}
   const answer=await this.dialog.showMessageBox(this.getWindow(),{type:'info',message:`LocalTerm ${release.tag_name} is available`,detail:`Installed: ${this.app.getVersion()}\nDownload and install the update? Open connections will close and LocalTerm will restart. Your vault file stays in its current location.`,buttons:['Later','Update now'],defaultId:0,cancelId:0});
   if(answer.response===1){installing=true;await this.install(asset);}
  }catch(e){if(manual||installing)await this.message('Update failed',e.message);else console.error('Update check failed:',e.message);}finally{this.busy=false;}
 }
 async message(message,detail){await this.dialog.showMessageBox(this.getWindow(),{type:'info',message,detail});}
 async install(asset){
  if(!this.app.isPackaged)throw Error('Updates can only be installed in a packaged application.');
  const dir=await fs.mkdtemp(path.join(this.app.getPath('temp'),'localterm-update-'));
  const downloaded=path.join(dir,asset.name);const r=await response(asset.browser_download_url);
  const handle=await fs.open(downloaded,'wx',0o600);const hash=crypto.createHash('sha256');let size=0;
  try{for await(const chunk of r.body){size+=chunk.length;if(size>1024*1024*1024)throw Error('Update package is too large.');hash.update(chunk);await handle.writeFile(chunk);this.getWindow()?.setProgressBar?.(asset.size?size/asset.size:2);}await handle.sync();}finally{await handle.close();this.getWindow()?.setProgressBar?.(-1);}
  if(size!==asset.size||hash.digest('hex')!==asset.digest.slice(7))throw Error('Update verification failed. The installed application was not changed.');
  let child;
  if(process.platform==='darwin'){
   const target=path.resolve(process.execPath,'../../..');if(!target.endsWith('.app'))throw Error('Cannot find the installed application bundle.');
   await fs.access(path.dirname(target),require('node:fs').constants.W_OK);
   const unpack=path.join(dir,'unpacked');await run('/usr/bin/ditto',['-x','-k',downloaded,unpack]);
   async function find(folder,depth=0){if(depth>3)return null;for(const entry of await fs.readdir(folder,{withFileTypes:true})){if(!entry.isDirectory())continue;const p=path.join(folder,entry.name);if(entry.name==='LocalTerm.app')return p;const found=await find(p,depth+1);if(found)return found;}return null;}
   const source=await find(unpack);if(!source)throw Error('The update contains no LocalTerm application.');
   const helper=path.join(dir,'install.sh');await fs.writeFile(helper,`#!/bin/sh\nwhile kill -0 "$1" 2>/dev/null; do sleep 1; done\nbackup="$3.previous-$(date +%s)"\nif [ -e "$backup" ]; then exit 1; fi\nif mv "$3" "$backup"; then\n if /usr/bin/ditto "$2" "$3"; then /usr/bin/open "$3"; else rm -rf "$3"; mv "$backup" "$3"; /usr/bin/open "$3"; fi\nfi\n`);
   child=spawn('/bin/sh',[helper,String(process.pid),source,target],{detached:true,stdio:'ignore'});
  }else if(process.platform==='win32'){
   const target=process.env.PORTABLE_EXECUTABLE_FILE||process.execPath;
   await fs.access(path.dirname(target),require('node:fs').constants.W_OK);
   const helper=path.join(dir,'install.ps1');await fs.writeFile(helper,`param([int]$ParentId,[string]$Source,[string]$Target)\nWait-Process -Id $ParentId -ErrorAction SilentlyContinue\nStart-Sleep -Seconds 2\n$Backup=$Target+'.previous-'+[DateTimeOffset]::Now.ToUnixTimeSeconds()\ntry { if(Test-Path -LiteralPath $Backup){throw 'A previous backup exists'}; Move-Item -LiteralPath $Target -Destination $Backup -ErrorAction Stop; Copy-Item -LiteralPath $Source -Destination $Target -ErrorAction Stop; Start-Process -FilePath $Target } catch { if(Test-Path -LiteralPath $Backup){Move-Item -LiteralPath $Backup -Destination $Target -Force; Start-Process -FilePath $Target} }\n`);
   child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,String(process.pid),downloaded,target],{detached:true,stdio:'ignore',windowsHide:true});
  }else throw Error('This platform is not supported.');
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();await this.beforeQuit();this.app.quit();
 }
}
module.exports={Updates,newer,assetFor};
