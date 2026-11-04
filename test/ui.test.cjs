'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let JSDOM;
try { ({ JSDOM } = require(process.env.LOCALTERM_JSDOM || 'jsdom')); } catch {}
const uiTest = JSDOM ? test : test.skip;
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function setup({ deferConnect = false, platform = 'darwin', initialHosts = [] } = {}) {
  let resolveConnect; let sessionCount=0; let clipboardText='',finishPaste=null; const forwards=new Map();
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8'), { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://localterm.test' });
  const w = dom.window;
  w.structuredClone = structuredClone;
  const records = []; const listeners = {}; let data = { hosts: structuredClone(initialHosts), keys: [], snippets: [], knownHosts: {}, settings: {} }; let locked = true;
  const snapshot = () => ({ locked, path: '/tmp/example.ltvault', ...(locked ? {} : { data: structuredClone(data) }) });
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  w.confirm = () => true;
  w.ResizeObserver = class { observe() {} disconnect() {} };
  w.Terminal = class { cols = 80; rows = 24; open(element) {element.addEventListener('terminal-input',event=>this.input?.(event.detail));element.addEventListener('terminal-selection',event=>{this.selection=event.detail;this.selectionChanged?.();});} onSelectionChange(callback){this.selectionChanged=callback;} getSelection(){return this.selection||'';} paste(text){records.push(['terminal:paste-input',text]);this.input?.(text);} writeln() {} write() {} loadAddon() {} onData(callback) {this.input=callback;} dispose() {records.push(['terminal:dispose']);} focus() {} };
  w.FitAddon = { FitAddon: class { fit() {} } };
  w.api = { platform, on: (name, callback) => { listeners[name] = callback; return () => {}; }, call: async (name, payload = {}) => {
    records.push([name, payload]);
    if (name === 'terminal:copy'){clipboardText=payload.text;return;}
    if (name === 'terminal:paste')return finishPaste?new Promise(resolve=>finishPaste.resolve=resolve):{text:clipboardText};
    if (name === 'vault:state') return snapshot();
    if (name === 'vault:create') { locked = false; return snapshot(); }
    if (name === 'vault:save') { data = structuredClone(payload.data); return snapshot(); }
    if (name === 'vault:lock') { locked = true; return snapshot(); }
    if (name === 'ssh:connect') return deferConnect ? new Promise(resolve => { resolveConnect = resolve; }) : { id: 'session-'+(++sessionCount) };
    if (['ssh:start','ssh:close','ssh:resize'].includes(name)) return {};
    if(name==='forward:list')return [...forwards.values()];
    if(name==='forward:start'){const status={ruleId:payload.ruleId,status:'running',bindPort:1080};forwards.set(payload.ruleId,status);return status;}
    if(name==='forward:stop'){forwards.delete(payload.ruleId);listeners['forward:status']?.({ruleId:payload.ruleId,status:'stopped'});return {};}
    throw Error('Unexpected API method: ' + name);
  } };
  w.eval(fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8'));
  await tick();
  const submit = id => w.document.getElementById(id).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const click = id => w.document.getElementById(id).click();
  return { dom, w, records, listeners, submit, click, getData: () => data, getClipboard:()=>clipboardText, setClipboard:text=>clipboardText=text, deferPaste:()=>{finishPaste={};return text=>finishPaste.resolve({text});}, completeConnect: () => resolveConnect({ id: 'session-1' }) };
}
uiTest('create vault confirms password and never writes unmatched password', async () => {
  const ui = await setup(); const { w, click, submit, records } = ui; const d = w.document;
  click('create-vault'); assert.equal(d.getElementById('create-dialog').open, true);
  d.getElementById('create-password').value = 'a strong test password'; d.getElementById('create-confirm').value = 'different'; submit('create-form'); await tick();
  assert.equal(records.filter(([name]) => name === 'vault:create').length, 0);
  assert.match(d.getElementById('toast').textContent, /do not match/);
  d.getElementById('create-confirm').value = 'a strong test password'; submit('create-form'); await tick();
  assert.equal(records.filter(([name]) => name === 'vault:create').length, 1);
  assert.equal(d.getElementById('workspace').hidden, false);
  assert.equal(d.getElementById('create-password').value, ''); assert.equal(d.getElementById('create-confirm').value, '');
  ui.dom.window.close();
});
uiTest('host CRUD preserves literal values and lock clears sensitive editors', async () => {
  const ui = await setup(); const { w, click, submit } = ui; const d = w.document;
  click('create-vault'); d.getElementById('create-password').value = d.getElementById('create-confirm').value = 'a strong test password'; submit('create-form'); await tick();
  click('add-item');
  const fields = d.getElementById('editor-fields'); fields.querySelector('[name=label]').value = '<img src=x onerror=alert(1)>'; fields.querySelector('[name=address]').value = 'example.test'; fields.querySelector('[name=password]').value = 'host-secret'; submit('editor-form'); await tick();
  assert.equal(ui.getData().hosts.length, 1); assert.equal(ui.getData().hosts[0].password, 'host-secret');
  assert.equal(d.querySelector('.card h3').textContent, '<img src=x onerror=alert(1)>'); assert.equal(d.querySelectorAll('.card img').length, 0);
  [...d.querySelectorAll('.card button')].find(b => b.textContent === 'Edit').click();
  assert.equal(fields.querySelector('[name=password]').value, 'host-secret'); click('lock'); await tick();
  assert.equal(d.getElementById('workspace').hidden, true); assert.equal(fields.childElementCount, 0); assert.equal(d.querySelectorAll('dialog[open]').length, 0); assert.equal(d.getElementById('items').childElementCount, 0);
  ui.dom.window.close();
});
uiTest('SSH stream starts only after terminal is registered', async () => {
  const ui = await setup(); const { w, click, submit, records } = ui; const d = w.document;
  click('create-vault'); d.getElementById('create-password').value = d.getElementById('create-confirm').value = 'a strong test password'; submit('create-form'); await tick();
  click('add-item'); const fields = d.getElementById('editor-fields'); fields.querySelector('[name=label]').value = 'Demo'; fields.querySelector('[name=address]').value = 'example.test'; submit('editor-form'); await tick();
  [...d.querySelectorAll('.card button')].find(b => b.textContent.startsWith('Connect')).click(); await tick();
  assert.deepEqual(records.filter(([name]) => name.startsWith('ssh:')).map(([name]) => name), ['ssh:connect', 'ssh:start']);
  assert.equal(d.getElementById('sessions').hidden, false); assert.equal(d.querySelectorAll('.terminal-pane').length, 1);
  ui.dom.window.close();
});

uiTest('locking while SSH connection is pending closes late connection', async () => {
  const ui = await setup({ deferConnect: true }); const { w, click, submit, records } = ui; const d = w.document;
  click('create-vault'); d.getElementById('create-password').value = d.getElementById('create-confirm').value = 'a strong test password'; submit('create-form'); await tick();
  click('add-item'); const fields = d.getElementById('editor-fields'); fields.querySelector('[name=label]').value = 'Demo'; fields.querySelector('[name=address]').value = 'example.test'; submit('editor-form'); await tick();
  [...d.querySelectorAll('.card button')].find(b => b.textContent.startsWith('Connect')).click(); await tick();
  click('lock'); await tick(); ui.completeConnect(); await tick();
  assert.equal(records.some(([name]) => name === 'ssh:start'), false);
  assert.equal(records.some(([name]) => name === 'ssh:close'), true);
  assert.equal(d.querySelectorAll('.terminal-pane').length, 0);
  assert.equal(d.getElementById('workspace').hidden, true);
  ui.dom.window.close();
});

async function unlock(ui){ui.click('create-vault');ui.w.document.getElementById('create-password').value=ui.w.document.getElementById('create-confirm').value='a strong test password';ui.submit('create-form');await tick();}
async function addHost(ui,label){ui.w.document.querySelector('[data-view=hosts]').click();ui.click('add-item');const fields=ui.w.document.getElementById('editor-fields');fields.querySelector('[name=label]').value=label;fields.querySelector('[name=address]').value=label.toLowerCase()+'.test';ui.submit('editor-form');await tick();}
async function openHost(ui,label){if(!ui.w.document.getElementById('sessions').hidden)ui.click('back-library');const card=[...ui.w.document.querySelectorAll('.card')].find(c=>c.querySelector('h3').textContent===label);[...card.querySelectorAll('button')].find(b=>b.textContent.startsWith('Connect')).click();await tick();}
uiTest('two and three terminal columns preserve independent session selection, focus and closing',async()=>{
 const ui=await setup();const d=ui.w.document;await unlock(ui);for(const label of ['Alpha','Beta','Gamma'])await addHost(ui,label);
 await openHost(ui,'Alpha');assert.equal(d.getElementById('workspace').classList.contains('terminal-mode'),true);
 const layout=d.getElementById('terminal-layout');layout.value='2';layout.dispatchEvent(new ui.w.Event('change'));
 assert.equal(d.querySelectorAll('.empty-terminal').length,1);
 await openHost(ui,'Beta');layout.value='2';layout.dispatchEvent(new ui.w.Event('change'));assert.equal(d.querySelectorAll('.terminal-pane.active').length,2);assert.equal(layout.value,'2');
 await openHost(ui,'Gamma');d.querySelector('[data-workspace]').click();layout.value='3';layout.dispatchEvent(new ui.w.Event('change'));await new Promise(res=>setTimeout(res,25));
 assert.equal(d.querySelectorAll('.terminal-pane.active').length,3);assert.equal(d.querySelectorAll('.empty-terminal').length,0);assert.match(d.getElementById('terminal-panes').style.gridTemplateColumns,/repeat\(3/);
 const visible=()=>[...d.querySelectorAll('.terminal-pane.active')];const alpha=visible().find(p=>p.querySelector('select').value==='session-1');alpha.dispatchEvent(new ui.w.Event('pointerdown',{bubbles:true}));assert.equal(alpha.classList.contains('focused'),true);
 const select=alpha.querySelector('select');select.value='session-3';select.dispatchEvent(new ui.w.Event('change'));assert.equal(new Set(visible().map(p=>p.querySelector('select').value)).size,3);assert.equal(d.querySelector('.terminal-pane.focused select').value,'session-3');
 for(const pane of visible()){const id=pane.querySelector('select').value;pane.querySelector('.terminal-content').dispatchEvent(new ui.w.CustomEvent('terminal-input',{detail:'typed-'+id}));}await tick();for(const id of ['session-1','session-2','session-3'])assert(ui.records.some(([name,p])=>name==='ssh:data'&&p.id===id&&p.data==='typed-'+id));
 assert(ui.records.some(([name,p])=>name==='ssh:resize'&&p.id==='session-1'));assert(ui.records.some(([name,p])=>name==='ssh:resize'&&p.id==='session-2'));assert(ui.records.some(([name,p])=>name==='ssh:resize'&&p.id==='session-3'));
 d.querySelector('.terminal-pane.focused .pane-close').click();await tick();assert.equal(visible().length,2);assert.equal(d.querySelectorAll('.empty-terminal').length,0);assert.equal(layout.value,'2');
 ui.click('back-library');assert.equal(d.getElementById('workspace').classList.contains('terminal-mode'),false);assert.equal(d.getElementById('library').hidden,false);
 ui.dom.window.close();
});
uiTest('forwarding types save target fields correctly and running rule edits stop the tunnel',async()=>{
 const ui=await setup();const d=ui.w.document;await unlock(ui);await addHost(ui,'Gateway');d.querySelector('[data-view=forwards]').click();ui.click('add-item');let fields=d.getElementById('editor-fields');
 fields.querySelector('[name=label]').value='SOCKS proxy';fields.querySelector('[data-type=dynamic]').click();fields.querySelector('[name=bindPort]').value='1080';assert.equal(fields.querySelector('[name=targetPort]').disabled,true);assert.equal(fields.querySelector('.forward-target').hidden,true);ui.submit('editor-form');await tick();
 assert.equal(ui.getData().forwards.length,1);const rule=ui.getData().forwards[0];assert.equal(rule.type,'dynamic');assert.equal(rule.bindAddress,'127.0.0.1');assert.equal(rule.bindPort,1080);assert.equal('targetAddress' in rule,false);assert.match(d.querySelector('.card .address').textContent,/SOCKS5/);
 [...d.querySelectorAll('.card button')].find(b=>b.textContent==='Start').click();await tick();assert.match(d.querySelector('.forward-state').textContent,/Running/);
 [...d.querySelectorAll('.card button')].find(b=>b.textContent==='Edit').click();fields=d.getElementById('editor-fields');fields.querySelector('[data-type=remote]').click();assert.equal(fields.querySelector('[name=targetPort]').disabled,false);fields.querySelector('[name=targetAddress]').value='localhost';fields.querySelector('[name=targetPort]').value='3000';ui.submit('editor-form');await tick();
 assert(ui.records.some(([name,p])=>name==='forward:stop'&&p.ruleId===rule.id));assert.equal(ui.getData().forwards[0].type,'remote');assert.equal(ui.getData().forwards[0].targetPort,3000);assert.match(d.querySelector('.forward-state').textContent,/Stopped/);
 ui.listeners['forward:status']({ruleId:rule.id,status:'error',message:'Port already in use'});assert.match(d.querySelector('.forward-state').textContent,/Port already in use/);
 [...d.querySelectorAll('.card button')].find(b=>b.textContent==='Start').click();await tick();[...d.querySelectorAll('.card button')].find(b=>b.textContent==='Delete').click();await tick();assert.equal(ui.getData().forwards.length,0);assert.equal(ui.records.filter(([name])=>name==='forward:stop').length,2);
 ui.click('lock');await tick();ui.listeners['forward:status']({ruleId:rule.id,status:'running'});assert.equal(d.getElementById('items').childElementCount,0);ui.dom.window.close();
});
uiTest('dragging tabs docks left/right/top/bottom and center drops swap sessions without reconnecting',async()=>{
 const ui=await setup();const d=ui.w.document;await unlock(ui);for(const label of ['Alpha','Beta','Gamma']){await addHost(ui,label);await openHost(ui,label);}
 const paneFor=id=>[...d.querySelectorAll('.terminal-pane')].find(p=>p.querySelector('select')?.value===id);
 const drag=(id,pane,x,y)=>{const tab=d.querySelector(`[data-session="${id}"]`)||paneFor(id).querySelector('.pane-drag-grip');pane.getBoundingClientRect=()=>({left:0,top:0,width:400,height:400});d.elementFromPoint=()=>pane;tab.dispatchEvent(new ui.w.MouseEvent('pointerdown',{bubbles:true,button:0,clientX:20,clientY:20}));d.dispatchEvent(new ui.w.MouseEvent('pointermove',{bubbles:true,cancelable:true,clientX:x,clientY:y}));assert(pane.dataset.dropZone);d.dispatchEvent(new ui.w.MouseEvent('pointerup',{bubbles:true,clientX:x,clientY:y}));};
 drag('session-1',paneFor('session-3'),390,200);assert.equal(d.querySelectorAll('.terminal-pane.active').length,2);assert.equal(d.getElementById('terminal-layout').value,'custom');assert.equal(paneFor('session-1').style.left,'calc(50% + 3px)');
 drag('session-2',paneFor('session-3'),200,390);assert.equal(d.querySelectorAll('.terminal-pane.active').length,3);assert.equal(paneFor('session-2').style.top,'calc(50% + 3px)');assert.equal(paneFor('session-3').style.top,'calc(0% + 3px)');
 drag('session-1',paneFor('session-2'),200,200);assert.equal(d.querySelectorAll('.terminal-pane.active').length,3);assert.equal(paneFor('session-1').style.top,'calc(50% + 3px)');
 drag('session-2',paneFor('session-3'),200,2);assert.equal(new Set([...d.querySelectorAll('.terminal-pane.active select')].map(s=>s.value)).size,3);assert.equal(paneFor('session-2').style.top,'calc(0% + 3px)');
 drag('session-1',paneFor('session-2'),2,200);assert.equal(d.querySelectorAll('.terminal-pane.active').length,3);assert.equal(d.querySelectorAll('[data-drop-zone]').length,0);assert.equal(d.body.classList.contains('terminal-dragging'),false);assert.equal(ui.records.filter(([name])=>name==='ssh:connect').length,3);
 const layout=d.getElementById('terminal-layout');layout.value='2';layout.dispatchEvent(new ui.w.Event('change'));assert.equal(d.getElementById('terminal-panes').classList.contains('docked'),false);assert.equal(d.querySelectorAll('.terminal-pane.active').length,2);
 ui.dom.window.close();
});
uiTest('cancelled or locked drags clear previews and external drops never rearrange terminals',async()=>{
 const ui=await setup();const d=ui.w.document;await unlock(ui);for(const label of ['Alpha','Beta']){await addHost(ui,label);await openHost(ui,label);}
 const pane=d.querySelector('.terminal-pane.active');pane.getBoundingClientRect=()=>({left:0,top:0,width:400,height:400});const over=()=>new ui.w.MouseEvent('dragover',{bubbles:true,cancelable:true,clientX:390,clientY:200});pane.dispatchEvent(over());assert.equal(pane.dataset.dropZone,undefined);
 const tab=d.querySelector('[data-session="session-1"]');const start=new ui.w.Event('dragstart',{bubbles:true,cancelable:true});Object.defineProperty(start,'dataTransfer',{value:{setData(){}}});tab.dispatchEvent(start);pane.dispatchEvent(over());assert.equal(pane.dataset.dropZone,'right');d.dispatchEvent(new ui.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(pane.dataset.dropZone,undefined);
 tab.dispatchEvent(start);pane.dispatchEvent(over());ui.click('terminal-lock');await tick();assert.equal(d.querySelectorAll('[data-drop-zone]').length,0);assert.equal(d.body.classList.contains('terminal-dragging'),false);assert.equal(d.getElementById('workspace').hidden,true);ui.dom.window.close();
});
uiTest('Cmd+T creates searchable independent host tabs and connects selected host without closing sessions',async()=>{
 const ui=await setup();const d=ui.w.document;await unlock(ui);await addHost(ui,'Alpha');await addHost(ui,'Beta');await openHost(ui,'Alpha');
 const shortcut=()=>d.querySelector('.terminal-content').dispatchEvent(new ui.w.KeyboardEvent('keydown',{key:'t',metaKey:true,bubbles:true,cancelable:true}));shortcut();await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(d.querySelectorAll('[data-picker]').length,1);assert.equal(d.getElementById('host-picker').hidden,false);assert.equal(d.getElementById('terminal-panes').hidden,true);assert.equal(d.activeElement.id,'host-picker-search');assert.equal(d.querySelectorAll('.picker-host').length,2);assert.equal(d.querySelectorAll('[data-session]').length,1);
 const search=d.getElementById('host-picker-search');search.value='bEtA';search.dispatchEvent(new ui.w.Event('input'));assert.equal(d.querySelectorAll('.picker-host').length,1);assert.match(d.querySelector('.picker-host').textContent,/Beta/);
 d.dispatchEvent(new ui.w.KeyboardEvent('keydown',{key:'t',metaKey:true,bubbles:true,cancelable:true}));assert.equal(d.querySelectorAll('[data-picker]').length,2);assert.equal(search.value,'');
 d.querySelectorAll('[data-picker]')[0].click();assert.equal(search.value,'bEtA');search.dispatchEvent(new ui.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await tick();
 assert.equal(ui.records.filter(([name])=>name==='ssh:connect').length,2);assert.equal(ui.records.filter(([name])=>name==='ssh:close').length,0);assert.equal(d.querySelectorAll('[data-session]').length,2);assert.equal(d.querySelectorAll('[data-picker]').length,1);assert.equal(d.getElementById('host-picker').hidden,true);assert.equal(d.getElementById('terminal-panes').hidden,false);
 ui.dom.window.close();
});
uiTest('new host tabs filter addresses/users/groups, close with Escape, and clear on lock',async()=>{
 const ui=await setup();const d=ui.w.document;await unlock(ui);await addHost(ui,'Alpha');await openHost(ui,'Alpha');ui.click('new-terminal-tab');const search=d.getElementById('host-picker-search');
 for(const query of ['alpha.test','root']){search.value=query;search.dispatchEvent(new ui.w.Event('input'));assert.equal(d.querySelectorAll('.picker-host').length,1);}
 search.value='unmatched';search.dispatchEvent(new ui.w.Event('input'));assert.match(d.querySelector('.picker-empty').textContent,/No matching/);search.dispatchEvent(new ui.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(d.getElementById('host-picker').hidden,true);assert.equal(d.querySelectorAll('[data-picker]').length,0);assert.equal(d.querySelectorAll('[data-session]').length,1);
 d.dispatchEvent(new ui.w.KeyboardEvent('keydown',{key:'t',metaKey:true,bubbles:true,cancelable:true}));ui.listeners['ssh:closed']({id:'session-1'});await tick();assert.equal(d.getElementById('host-picker').hidden,false);
 ui.click('lock');await tick();assert.equal(d.querySelectorAll('[data-picker]').length,0);assert.equal(search.value,'');assert.equal(d.getElementById('host-picker-results').childElementCount,0);d.dispatchEvent(new ui.w.KeyboardEvent('keydown',{key:'t',metaKey:true,bubbles:true,cancelable:true}));assert.equal(d.querySelectorAll('[data-picker]').length,0);ui.dom.window.close();
});
uiTest('failed connections keep the new-tab search and existing terminal available for retry',async()=>{
 const ui=await setup();const d=ui.w.document;await unlock(ui);await addHost(ui,'Alpha');await addHost(ui,'Beta');await openHost(ui,'Alpha');
 const original=ui.w.api.call;ui.w.api.call=async(name,payload)=>{if(name==='ssh:connect')throw Error('Authentication failed');return original(name,payload);};ui.click('new-terminal-tab');const search=d.getElementById('host-picker-search');search.value='beta';search.dispatchEvent(new ui.w.Event('input'));d.querySelector('.picker-host').click();await tick();assert.equal(d.getElementById('host-picker').hidden,false);assert.equal(search.value,'beta');assert.match(d.getElementById('toast').textContent,/Authentication failed/);assert.equal(d.querySelectorAll('[data-session]').length,1);assert.equal(d.querySelectorAll('[data-picker]').length,1);d.querySelector('[data-session]').click();assert.equal(d.getElementById('terminal-panes').hidden,false);assert.equal(ui.records.some(([name])=>name==='ssh:close'),false);ui.dom.window.close();
});
uiTest('Windows Ctrl+T and Ctrl+K open and focus the host picker while Mac shortcuts stay distinct',async()=>{
 const ui=await setup({platform:'win32'});const d=ui.w.document;await unlock(ui);await addHost(ui,'Windows host');await openHost(ui,'Windows host');
 d.querySelector('.terminal-content').dispatchEvent(new ui.w.KeyboardEvent('keydown',{key:'t',ctrlKey:true,bubbles:true,cancelable:true}));assert.equal(d.getElementById('host-picker').hidden,false);assert.equal(d.activeElement.id,'host-picker-search');assert.match(d.getElementById('new-terminal-tab').title,/Ctrl\+T/);assert.equal(d.querySelector('.picker-search>span').textContent,'Ctrl+K');
 d.querySelector('.picker-host').focus();d.dispatchEvent(new ui.w.KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true,cancelable:true}));assert.equal(d.activeElement.id,'host-picker-search');const count=d.querySelectorAll('[data-picker]').length;d.dispatchEvent(new ui.w.KeyboardEvent('keydown',{key:'t',metaKey:true,bubbles:true,cancelable:true}));assert.equal(d.querySelectorAll('[data-picker]').length,count);ui.dom.window.close();
});
uiTest('top return button and platform shortcut restore the focused split session without scrolling or reconnecting',async()=>{
 for(const platform of ['darwin','win32']){
  const ui=await setup({platform});const d=ui.w.document;await unlock(ui);assert.equal(d.getElementById('return-session-top').hidden,true);await addHost(ui,'Alpha');await addHost(ui,'Beta');await openHost(ui,'Alpha');const layout=d.getElementById('terminal-layout');layout.value='2';layout.dispatchEvent(new ui.w.Event('change'));await openHost(ui,'Beta');layout.value='2';layout.dispatchEvent(new ui.w.Event('change'));
  const first=[...d.querySelectorAll('.terminal-pane.active')].find(p=>p.querySelector('select').value==='session-1');first.dispatchEvent(new ui.w.Event('pointerdown',{bubbles:true}));ui.click('back-library');d.getElementById('library').scrollTop=9999;const top=d.getElementById('return-session-top');assert.equal(top.hidden,false);assert(top.closest('header'));assert(!d.getElementById('library').contains(top));assert.match(top.textContent,/2/);assert(top.textContent.includes(platform==='darwin'?'⌘R':'Ctrl+R'));
  ui.click('return-session-top');assert.equal(d.getElementById('sessions').hidden,false);assert.equal(d.querySelector('.terminal-pane.focused select').value,'session-1');assert.equal(layout.value,'2');ui.click('back-library');const key=new ui.w.KeyboardEvent('keydown',{key:'r',metaKey:platform==='darwin',ctrlKey:platform==='win32',bubbles:true,cancelable:true});d.getElementById('search').dispatchEvent(key);assert.equal(key.defaultPrevented,true);assert.equal(d.getElementById('sessions').hidden,false);assert.equal(d.querySelector('.terminal-pane.focused select').value,'session-1');
  ui.click('back-library');ui.click('add-item');ui.listeners['session:return']();assert.equal(d.getElementById('library').hidden,false);assert.equal(d.getElementById('editor').open,true);ui.click('cancel-editor');ui.listeners['session:return']();assert.equal(d.getElementById('sessions').hidden,false);assert.equal(ui.records.filter(([name])=>name==='ssh:connect').length,2);assert.equal(ui.records.filter(([name])=>name==='ssh:close').length,0);ui.click('terminal-lock');await tick();assert.equal(top.hidden,true);ui.listeners['session:return']();assert.equal(d.getElementById('workspace').hidden,true);ui.dom.window.close();
 }
});
uiTest('closing either pane of a two-terminal split expands the survivor and resizes it without reconnecting',async()=>{
 for(const closeId of ['session-1','session-2']){const ui=await setup();const d=ui.w.document;await unlock(ui);await addHost(ui,'Alpha');await addHost(ui,'Beta');await openHost(ui,'Alpha');const layout=d.getElementById('terminal-layout');layout.value='2';layout.dispatchEvent(new ui.w.Event('change'));await openHost(ui,'Beta');layout.value='2';layout.dispatchEvent(new ui.w.Event('change'));const before=ui.records.length;
  [...d.querySelectorAll('.terminal-pane.active')].find(p=>p.querySelector('select').value===closeId).querySelector('.pane-close').click();
  await new Promise(resolve=>setTimeout(resolve,30));const survivor=closeId==='session-1'?'session-2':'session-1';assert.equal(layout.value,'1');assert.equal(d.querySelectorAll('.terminal-pane.active').length,1);assert.equal(d.querySelector('.terminal-pane.active select').value,survivor);assert.equal(d.querySelectorAll('.empty-terminal').length,0);assert.equal(d.getElementById('terminal-panes').classList.contains('docked'),false);assert.match(d.getElementById('terminal-panes').style.gridTemplateColumns,/repeat\(1/);assert(ui.records.slice(before).some(([name,p])=>name==='ssh:resize'&&p.id===survivor));assert.equal(ui.records.filter(([name])=>name==='ssh:connect').length,2);ui.dom.window.close();
 }
});
uiTest('closing a docked pane removes its empty branch, then the last survivor fills the terminal area',async()=>{
 const ui=await setup();const d=ui.w.document;await unlock(ui);for(const label of ['Alpha','Beta','Gamma']){await addHost(ui,label);await openHost(ui,label);}
 const paneFor=id=>[...d.querySelectorAll('.terminal-pane')].find(p=>p.querySelector('select')?.value===id);
 const drag=(id,target,x,y)=>{target.getBoundingClientRect=()=>({left:0,top:0,width:400,height:400});d.elementFromPoint=()=>target;d.querySelector(`[data-session="${id}"]`).dispatchEvent(new ui.w.MouseEvent('pointerdown',{bubbles:true,button:0,clientX:20,clientY:20}));d.dispatchEvent(new ui.w.MouseEvent('pointermove',{bubbles:true,cancelable:true,clientX:x,clientY:y}));d.dispatchEvent(new ui.w.MouseEvent('pointerup',{bubbles:true,clientX:x,clientY:y}));};
 drag('session-1',paneFor('session-3'),390,200);drag('session-2',paneFor('session-3'),200,390);paneFor('session-3').querySelector('.pane-close').click();await tick();assert.equal(d.querySelectorAll('.terminal-pane.active').length,2);assert.equal(d.querySelectorAll('.empty-terminal').length,0);for(const pane of d.querySelectorAll('.terminal-pane.active'))assert.equal(pane.style.height,'calc(100% - 6px)');paneFor('session-1').querySelector('.pane-close').click();await tick();assert.equal(d.getElementById('terminal-layout').value,'1');assert.equal(d.querySelectorAll('.terminal-pane.active').length,1);assert.equal(paneFor('session-2').style.width,'');assert.equal(paneFor('session-2').style.height,'');assert.equal(d.getElementById('terminal-panes').classList.contains('docked'),false);ui.dom.window.close();
});
uiTest('closing a visible pane collapses the split without pulling a hidden tab into the layout',async()=>{
 const ui=await setup();const d=ui.w.document;await unlock(ui);for(const label of ['Alpha','Beta','Gamma']){await addHost(ui,label);await openHost(ui,label);}const layout=d.getElementById('terminal-layout');layout.value='2';layout.dispatchEvent(new ui.w.Event('change'));const visible=[...d.querySelectorAll('.terminal-pane.active')];const closed=visible[0].querySelector('select').value,survivor=visible[1].querySelector('select').value;visible[0].querySelector('.pane-close').click();await tick();assert.equal(d.querySelectorAll('[data-session]').length,2);assert.equal(d.querySelectorAll('.terminal-pane.active').length,1);assert.equal(d.querySelector('.terminal-pane.active select').value,survivor);assert.equal(layout.value,'1');assert(ui.records.some(([name,p])=>name==='ssh:close'&&p.id===closed));ui.dom.window.close();
});

uiTest('split workspace survives a new standalone host tab and repeated tab switches',async()=>{
 const ui=await setup();const d=ui.w.document;await unlock(ui);for(const label of ['Alpha','Beta']){await addHost(ui,label);await openHost(ui,label);}
 const layout=d.getElementById('terminal-layout');layout.value='2';layout.dispatchEvent(new ui.w.Event('change'));const workspace=d.querySelector('[data-workspace]').dataset.workspace;
 assert.equal(d.querySelectorAll('[data-workspace]').length,1);assert.equal(d.querySelectorAll('[data-session]').length,0);assert.match(d.querySelector('[data-workspace]').textContent,/Workspace/);
 const first=d.querySelector('.terminal-pane.active');first.dispatchEvent(new ui.w.Event('pointerdown',{bubbles:true}));const focused=first.querySelector('select').value;
 await addHost(ui,'Gamma');ui.click('new-terminal-tab');d.querySelectorAll('.picker-host')[2].click();await tick();
 assert.equal(layout.value,'1');assert.equal(d.querySelectorAll('.terminal-pane.active').length,1);assert.equal(d.querySelector('.terminal-pane.active select').value,'session-3');assert.equal(d.querySelectorAll('[data-session]').length,1);
 for(let i=0;i<3;i++){d.querySelector(`[data-workspace="${workspace}"]`).click();assert.equal(d.querySelectorAll('.terminal-pane.active').length,2);assert.equal(d.querySelector('.terminal-pane.focused select').value,focused);d.querySelector('[data-session="session-3"]').click();assert.equal(layout.value,'1');assert.equal(d.querySelectorAll('.terminal-pane.active').length,1);}
 assert.equal(ui.records.filter(([name])=>name==='ssh:connect').length,3);assert.equal(ui.records.filter(([name])=>name==='ssh:close').length,0);ui.dom.window.close();
});
uiTest('dragging a standalone tab over a workspace groups it and restores custom geometry after switching',async()=>{
 const ui=await setup();const d=ui.w.document;await unlock(ui);for(const label of ['Alpha','Beta']){await addHost(ui,label);await openHost(ui,label);}const layout=d.getElementById('terminal-layout');layout.value='2';layout.dispatchEvent(new ui.w.Event('change'));await addHost(ui,'Gamma');await openHost(ui,'Gamma');
 const tab=d.querySelector('[data-session="session-3"]');tab.dispatchEvent(new ui.w.MouseEvent('pointerdown',{bubbles:true,button:0,clientX:20,clientY:20}));d.elementFromPoint=()=>d.querySelector('[data-workspace]');d.dispatchEvent(new ui.w.MouseEvent('pointermove',{bubbles:true,cancelable:true,clientX:100,clientY:20}));await new Promise(resolve=>setTimeout(resolve,380));assert.equal(d.querySelectorAll('.terminal-pane.active').length,2);assert.equal(d.querySelector('[data-session="session-3"]'),tab);
 const target=d.querySelector('.terminal-pane.active');target.getBoundingClientRect=()=>({left:0,top:0,width:400,height:400});d.elementFromPoint=()=>target;d.dispatchEvent(new ui.w.MouseEvent('pointermove',{bubbles:true,cancelable:true,clientX:200,clientY:390}));d.dispatchEvent(new ui.w.MouseEvent('pointerup',{bubbles:true,clientX:200,clientY:390}));assert.equal(d.querySelectorAll('.terminal-pane.active').length,3);assert.equal(d.querySelectorAll('[data-session]').length,0);assert.equal(layout.value,'custom');
 const geometry=[...d.querySelectorAll('.terminal-pane.active')].map(p=>p.style.cssText);await addHost(ui,'Delta');await openHost(ui,'Delta');d.querySelector('[data-workspace]').click();assert.deepEqual([...d.querySelectorAll('.terminal-pane.active')].map(p=>p.style.cssText),geometry);assert.equal(ui.records.filter(([name])=>name==='ssh:connect').length,4);ui.dom.window.close();
});
uiTest('closing a hidden grouped pane preserves standalone tab and collapses the group to its survivor',async()=>{
 const ui=await setup();const d=ui.w.document;await unlock(ui);for(const label of ['Alpha','Beta']){await addHost(ui,label);await openHost(ui,label);}const layout=d.getElementById('terminal-layout');layout.value='2';layout.dispatchEvent(new ui.w.Event('change'));await addHost(ui,'Gamma');await openHost(ui,'Gamma');
 const hidden=[...d.querySelectorAll('.terminal-pane')].find(p=>p.querySelector('select')?.value==='session-1');hidden.querySelector('.pane-close').click();await tick();assert.equal(d.querySelector('.terminal-pane.active select').value,'session-3');assert.equal(d.querySelectorAll('[data-workspace]').length,0);d.querySelector('[data-session="session-2"]').click();assert.equal(layout.value,'1');assert.equal(d.querySelectorAll('.terminal-pane.active').length,1);ui.click('terminal-lock');await tick();assert.equal(d.querySelectorAll('[data-workspace]').length,0);ui.dom.window.close();
});
uiTest('independent workspaces keep their members and closing one leaves the other connected',async()=>{
 const ui=await setup();const d=ui.w.document;await unlock(ui);const layout=d.getElementById('terminal-layout');
 for(const label of ['Alpha','Beta']){await addHost(ui,label);await openHost(ui,label);}layout.value='2';layout.dispatchEvent(new ui.w.Event('change'));const first=d.querySelector('[data-workspace]').dataset.workspace;
 for(const label of ['Gamma','Delta']){await addHost(ui,label);await openHost(ui,label);}layout.value='2';layout.dispatchEvent(new ui.w.Event('change'));assert.equal(d.querySelectorAll('[data-workspace]').length,2);
 const visible=()=>[...d.querySelectorAll('.terminal-pane.active select')].map(p=>p.value).sort();assert.deepEqual(visible(),['session-3','session-4']);d.querySelector(`[data-workspace="${first}"]`).click();assert.deepEqual(visible(),['session-1','session-2']);d.querySelector(`[data-workspace="${first}"] span`).click();await tick();await tick();assert.equal(d.querySelectorAll('[data-workspace]').length,1);assert.deepEqual(visible(),['session-3','session-4']);assert.equal(ui.records.filter(([name])=>name==='ssh:close').length,2);ui.dom.window.close();
});
uiTest('mouse release after dragging never activates an unrelated tab and the next deliberate click still works',async()=>{
 const ui=await setup();const d=ui.w.document;await unlock(ui);for(const label of ['Alpha','Beta','Gamma']){await addHost(ui,label);await openHost(ui,label);}
 const source=d.querySelector('[data-session="session-1"]'),target=d.querySelector('.terminal-pane.active');target.getBoundingClientRect=()=>({left:0,top:0,width:400,height:400});d.elementFromPoint=()=>target;
 source.dispatchEvent(new ui.w.MouseEvent('pointerdown',{bubbles:true,button:0,clientX:20,clientY:20}));d.dispatchEvent(new ui.w.MouseEvent('pointermove',{bubbles:true,cancelable:true,clientX:390,clientY:200}));assert.equal(d.querySelector('[data-session="session-1"]'),source);d.dispatchEvent(new ui.w.MouseEvent('pointerup',{bubbles:true,cancelable:true,clientX:390,clientY:200}));assert.equal(d.querySelectorAll('.terminal-pane.active').length,2);
 const other=d.querySelector('[data-session="session-2"]');other.dispatchEvent(new ui.w.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));assert.equal(d.querySelectorAll('.terminal-pane.active').length,2);other.dispatchEvent(new ui.w.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));assert.equal(d.querySelectorAll('.terminal-pane.active').length,1);assert.equal(d.querySelector('.terminal-pane.active select').value,'session-2');assert.equal(ui.records.filter(([name])=>name==='ssh:connect').length,3);ui.dom.window.close();
});
uiTest('passing over a tab does not switch views and leaving cancels the pending drag hover',async()=>{
 const ui=await setup();const d=ui.w.document;await unlock(ui);for(const label of ['Alpha','Beta']){await addHost(ui,label);await openHost(ui,label);}
 const source=d.querySelector('[data-session="session-2"]'),other=d.querySelector('[data-session="session-1"]'),pane=d.querySelector('.terminal-pane.active');source.dispatchEvent(new ui.w.MouseEvent('pointerdown',{bubbles:true,button:0,clientX:20,clientY:20}));d.elementFromPoint=()=>other;d.dispatchEvent(new ui.w.MouseEvent('pointermove',{bubbles:true,cancelable:true,clientX:100,clientY:20}));assert.equal(d.querySelector('.terminal-pane.active select').value,'session-2');d.elementFromPoint=()=>pane;d.dispatchEvent(new ui.w.MouseEvent('pointermove',{bubbles:true,cancelable:true,clientX:200,clientY:200}));await new Promise(resolve=>setTimeout(resolve,380));assert.equal(d.querySelector('.terminal-pane.active select').value,'session-2');d.dispatchEvent(new ui.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(d.body.classList.contains('terminal-dragging'),false);assert.equal(d.querySelectorAll('[data-drop-zone]').length,0);ui.dom.window.close();
});
uiTest('host editor saves ordered jump selections and supports reverting to a direct route',async()=>{
 const ui=await setup();const d=ui.w.document;await unlock(ui);for(const label of ['First jump','Second jump','Target'])await addHost(ui,label);const edit=label=>[...d.querySelectorAll('.card')].find(c=>c.querySelector('h3').textContent===label).querySelector('.card-actions button.subtle').click();edit('Target');const fields=d.getElementById('editor-fields'),select=fields.querySelector('[aria-label="Add jump host"]');assert(![...select.options].some(o=>o.textContent.startsWith('Target')));const data=ui.getData(),ids=data.hosts.slice(0,2).map(h=>h.id);for(const id of ids){select.value=id;select.dispatchEvent(new ui.w.Event('change'));}assert.equal(fields.querySelectorAll('.jump-host-row').length,2);ui.submit('editor-form');await tick();assert.deepEqual(ui.getData().hosts[2].jumpHostIds,ids);edit('Target');assert.equal(fields.querySelectorAll('.jump-host-row').length,2);fields.querySelector('.jump-host-row .subtle').click();fields.querySelector('.jump-host-row .subtle').click();ui.submit('editor-form');await tick();assert.deepEqual(ui.getData().hosts[2].jumpHostIds,[]);ui.dom.window.close();
});
uiTest('imported jump metadata proposes matching hosts and saving clears only the jump migration blocker',async()=>{
 const ui=await setup({initialHosts:[{id:'a',label:'Bastion',address:'jump.test',username:'root',port:22,sourceApp:'Termius',sourceId:'source-jump'},{id:'b',label:'Imported target',address:'private.test',username:'root',port:22,sourceMetadata:{jumpHostIds:['source-jump']},migrationBlockers:['SSH jump-host chain needs configuration.','Hardware-backed authentication unsupported.']}]});const d=ui.w.document;await unlock(ui);[...d.querySelectorAll('.card')][1].querySelector('.card-actions button.subtle').click();assert.match(d.querySelector('.jump-host-list').textContent,/Bastion/);ui.submit('editor-form');await tick();assert.deepEqual(ui.getData().hosts[1].jumpHostIds,[ui.getData().hosts[0].id]);assert.deepEqual(ui.getData().hosts[1].migrationBlockers,['Hardware-backed authentication unsupported.']);ui.dom.window.close();
});
uiTest('jump host choices are alphabetical and searchable without reordering the chosen route',async()=>{
 const hosts=[['z','Zulu','gateway.test','ops'],['b','beta','second.test','admin'],['a','Alpha','first.test','root'],['t','Target','private.test','user']].map(([id,label,address,username])=>({id,label,address,username,port:22,group:id==='b'?'Datacenter':''}));
 const ui=await setup({initialHosts:hosts});const d=ui.w.document;await unlock(ui);[...d.querySelectorAll('.card')].find(c=>c.querySelector('h3').textContent==='Target').querySelector('.card-actions button.subtle').click();const select=d.querySelector('[aria-label="Add jump host"]'),search=d.querySelector('[aria-label="Search jump hosts"]');const options=()=>[...select.options].filter(o=>o.value).map(o=>o.value);assert.deepEqual(options(),['a','b','z']);select.value='z';select.dispatchEvent(new ui.w.Event('change'));select.value='a';select.dispatchEvent(new ui.w.Event('change'));search.value='DATACENTER';search.dispatchEvent(new ui.w.Event('input'));assert.deepEqual(options(),['b']);search.value='second.test';search.dispatchEvent(new ui.w.Event('input'));assert.deepEqual(options(),['b']);search.value='admin';search.dispatchEvent(new ui.w.Event('input'));assert.deepEqual(options(),['b']);search.value='unmatched';search.dispatchEvent(new ui.w.Event('input'));assert.equal(select.disabled,true);assert.match(d.querySelector('.jump-host-editor [role=status]').textContent,/No matching/);search.value='';search.dispatchEvent(new ui.w.Event('input'));assert.equal(select.disabled,false);ui.submit('editor-form');await tick();assert.deepEqual(ui.getData().hosts.find(h=>h.id==='t').jumpHostIds,['z','a']);ui.dom.window.close();
});
uiTest('remote session exit removes its split pane and the last exit returns to the host library',async()=>{
 const ui=await setup();const d=ui.w.document;await unlock(ui);for(const label of ['Alpha','Beta']){await addHost(ui,label);await openHost(ui,label);}const layout=d.getElementById('terminal-layout');layout.value='2';layout.dispatchEvent(new ui.w.Event('change'));ui.listeners['ssh:closed']({id:'session-1'});await tick();assert.equal(d.querySelectorAll('.terminal-pane').length,1);assert.equal(layout.value,'1');assert.equal(d.querySelector('.terminal-pane.active select').value,'session-2');ui.listeners['ssh:closed']({id:'session-2'});await tick();assert.equal(d.querySelectorAll('.terminal-pane').length,0);assert.equal(d.getElementById('sessions').hidden,true);assert.equal(d.getElementById('library').hidden,false);assert.equal(d.getElementById('return-session-top').hidden,true);assert.equal(ui.records.filter(([name])=>name==='ssh:close').length,0);ui.dom.window.close();
});
uiTest('a background remote exit preserves the host picker or host library currently in use',async()=>{
 for(const surface of ['picker','library']){const ui=await setup();const d=ui.w.document;await unlock(ui);await addHost(ui,'Alpha');await openHost(ui,'Alpha');if(surface==='picker'){ui.click('new-terminal-tab');const input=d.getElementById('host-picker-search');input.value='alpha';input.dispatchEvent(new ui.w.Event('input'));}else ui.click('back-library');ui.listeners['ssh:closed']({id:'session-1'});await tick();if(surface==='picker'){assert.equal(d.getElementById('host-picker').hidden,false);assert.equal(d.getElementById('host-picker-search').value,'alpha');assert.equal(d.querySelectorAll('[data-picker]').length,1);}else assert.equal(d.getElementById('library').hidden,false);assert.equal(d.querySelectorAll('.terminal-pane').length,0);ui.dom.window.close();}
});
uiTest('manual close racing the server close disposes the session once without a second close request',async()=>{
 const ui=await setup();const d=ui.w.document;await unlock(ui);await addHost(ui,'Alpha');await openHost(ui,'Alpha');const original=ui.w.api.call;ui.w.api.call=async(name,payload)=>{if(name==='ssh:close')ui.listeners['ssh:closed']({id:payload.id});return original(name,payload);};d.querySelector('[data-session] span').click();await tick();ui.listeners['ssh:closed']({id:'session-1'});await tick();assert.equal(ui.records.filter(([name])=>name==='ssh:close').length,1);assert.equal(ui.records.filter(([name])=>name==='terminal:dispose').length,1);assert.equal(d.querySelectorAll('.terminal-pane').length,0);assert.equal(d.getElementById('library').hidden,false);ui.dom.window.close();
});
uiTest('right-click Duplicate opens a fresh connection to the clicked host and keeps the original alive',async()=>{
 const ui=await setup();const d=ui.w.document;await unlock(ui);for(const label of ['Alpha','Beta']){await addHost(ui,label);await openHost(ui,label);}const sourceId=ui.getData().hosts[0].id;const tab=d.querySelector('[data-session="session-1"]');const event=new ui.w.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:120,clientY:40});tab.dispatchEvent(event);assert.equal(event.defaultPrevented,true);const menu=d.getElementById('terminal-context-menu');assert.equal(menu.hidden,false);assert.equal(menu.querySelector('[role=menuitem]').textContent,'Duplicate');menu.querySelector('button').click();await tick();assert.equal(menu.hidden,true);assert.equal(ui.records.filter(([name])=>name==='ssh:connect').length,3);assert.equal(ui.records.filter(([name])=>name==='ssh:connect').at(-1)[1].hostId,sourceId);assert.equal(d.querySelectorAll('.terminal-pane').length,3);assert.equal(d.querySelector('.terminal-pane.active select').value,'session-3');assert.equal(d.getElementById('terminal-layout').value,'1');assert.equal(ui.records.filter(([name])=>name==='ssh:close').length,0);ui.dom.window.close();
});
uiTest('workspace and pane context menus duplicate the selected member without changing the saved split',async()=>{
 const ui=await setup();const d=ui.w.document;await unlock(ui);for(const label of ['Alpha','Beta']){await addHost(ui,label);await openHost(ui,label);}const layout=d.getElementById('terminal-layout');layout.value='2';layout.dispatchEvent(new ui.w.Event('change'));const first=[...d.querySelectorAll('.terminal-pane.active')].find(p=>p.querySelector('select').value==='session-1');first.dispatchEvent(new ui.w.Event('pointerdown',{bubbles:true}));d.querySelector('[data-workspace]').dispatchEvent(new ui.w.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));d.getElementById('terminal-context-menu').querySelector('button').click();await tick();assert.equal(d.querySelectorAll('.terminal-pane.active').length,1);d.querySelector('[data-workspace]').click();assert.equal(d.querySelectorAll('.terminal-pane.active').length,2);const beta=[...d.querySelectorAll('.terminal-pane.active')].find(p=>p.querySelector('select').value==='session-2');beta.querySelector('.pane-heading').dispatchEvent(new ui.w.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));d.getElementById('terminal-context-menu').querySelector('button').click();await tick();assert.equal(ui.records.filter(([name])=>name==='ssh:connect').at(-1)[1].hostId,ui.getData().hosts[1].id);assert.equal(d.querySelectorAll('[data-workspace]').length,1);assert.equal(ui.records.filter(([name])=>name==='ssh:close').length,0);ui.dom.window.close();
});
uiTest('terminal context menu dismisses on Escape, outside pointer and vault lock and ignores stale sessions',async()=>{
 const ui=await setup();const d=ui.w.document;await unlock(ui);await addHost(ui,'Alpha');await openHost(ui,'Alpha');const menu=d.getElementById('terminal-context-menu'),open=()=>d.querySelector('[data-session]').dispatchEvent(new ui.w.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));open();d.dispatchEvent(new ui.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(menu.hidden,true);open();d.body.dispatchEvent(new ui.w.MouseEvent('pointerdown',{bubbles:true,button:0}));assert.equal(menu.hidden,true);open();const staleButton=menu.querySelector('button');ui.click('terminal-lock');await tick();assert.equal(menu.hidden,true);staleButton.click();await tick();assert.equal(ui.records.filter(([name])=>name==='ssh:connect').length,1);assert.equal(menu.childElementCount,0);ui.dom.window.close();
});

uiTest('Vault settings saves automatic locking preferences and restores them on reopen',async()=>{
 const ui=await setup();await unlock(ui);const d=ui.w.document;ui.click('vault-menu');assert.equal(d.getElementById('auto-lock-enabled').checked,true);assert.equal(d.getElementById('auto-lock-minutes').value,'15');
 d.getElementById('auto-lock-minutes').value='45';d.getElementById('auto-lock-screen').checked=false;ui.submit('auto-lock-form');await tick();assert.equal(ui.getData().settings.autoLock.idleMinutes,45);assert.equal(ui.getData().settings.autoLock.onScreenLock,false);
 ui.click('close-settings');ui.click('vault-menu');assert.equal(d.getElementById('auto-lock-minutes').value,'45');assert.equal(d.getElementById('auto-lock-screen').checked,false);
 d.getElementById('auto-lock-enabled').checked=false;d.getElementById('auto-lock-enabled').dispatchEvent(new ui.w.Event('change'));assert.equal(d.getElementById('auto-lock-minutes').disabled,true);ui.submit('auto-lock-form');await tick();assert.equal(ui.getData().settings.autoLock.enabled,false);assert.equal(ui.getData().settings.autoLock.idleMinutes,45);ui.dom.window.close();
});

for(const platform of ['darwin','win32'])uiTest(`terminal selection copies and right-click pastes into clicked split pane (${platform})`,async()=>{
 const ui=await setup({platform});await unlock(ui);for(const label of ['Alpha','Beta']){await addHost(ui,label);await openHost(ui,label);}const d=ui.w.document;const layout=d.getElementById('terminal-layout');layout.value='2';layout.dispatchEvent(new ui.w.Event('change'));const panes=[...d.querySelectorAll('.terminal-pane.active')];const alpha=panes.find(p=>p.querySelector('select').value==='session-1');const content=alpha.querySelector('.terminal-content');content.dispatchEvent(new ui.w.CustomEvent('terminal-selection',{detail:'selected text\nsecond line'}));await tick();assert.equal(ui.getClipboard(),'selected text\nsecond line');content.dispatchEvent(new ui.w.CustomEvent('terminal-selection',{detail:''}));await tick();assert.equal(ui.getClipboard(),'selected text\nsecond line');ui.setClipboard('clipboard payload');const event=new ui.w.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2});content.dispatchEvent(event);await tick();assert.equal(event.defaultPrevented,true);const sent=ui.records.filter(([name])=>name==='ssh:data').at(-1)[1];assert.equal(sent.id,'session-1');assert.equal(sent.data,'clipboard payload');assert.equal(d.getElementById('terminal-context-menu').hidden,true);ui.dom.window.close();
});
uiTest('clipboard settings persist, apply to existing terminals, and leave tab Duplicate available',async()=>{
 const ui=await setup();await unlock(ui);await addHost(ui,'Alpha');await openHost(ui,'Alpha');const d=ui.w.document;ui.click('back-library');ui.click('vault-menu');assert.equal(d.getElementById('terminal-clipboard-enabled').checked,true);d.getElementById('terminal-clipboard-enabled').checked=false;ui.submit('terminal-clipboard-form');await tick();assert.equal(ui.getData().settings.terminalClipboard.enabled,false);ui.click('close-settings');ui.click('vault-menu');assert.equal(d.getElementById('terminal-clipboard-enabled').checked,false);ui.click('close-settings');ui.click('return-session-top');const content=d.querySelector('.terminal-content');const count=ui.records.length;content.dispatchEvent(new ui.w.CustomEvent('terminal-selection',{detail:'should not copy'}));const event=new ui.w.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2});content.dispatchEvent(event);await tick();assert.equal(event.defaultPrevented,false);assert.equal(ui.records.slice(count).some(([name])=>name.startsWith('terminal:')),false);d.querySelector('[data-session]').dispatchEvent(new ui.w.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));assert.equal(d.getElementById('terminal-context-menu').hidden,false);ui.dom.window.close();
});
uiTest('pending clipboard paste is discarded after vault lock or session close',async()=>{
 for(const close of ['lock','close']){const ui=await setup();await unlock(ui);await addHost(ui,'Alpha');await openHost(ui,'Alpha');const content=ui.w.document.querySelector('.terminal-content');const finish=ui.deferPaste();content.dispatchEvent(new ui.w.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));await tick();if(close==='lock')ui.click('terminal-lock');else ui.listeners['ssh:closed']({id:'session-1'});await tick();finish('must not be sent');await tick();assert.equal(ui.records.some(([name])=>name==='terminal:paste-input'),false);ui.dom.window.close();}
});
