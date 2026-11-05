/* LocalTerm terminal color definitions, shared by the vault and renderer. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LocalTermThemes=api;})(globalThis,function(){
 'use strict';
 const PRESETS={
  default:{label:'Default',colors:{background:'#0d131c',foreground:'#c9d7e6',cursor:'#76e4b1',selectionBackground:'#355a4a'}},
  'ember-dune':{label:'Ember Dune',colors:{background:'#7a251e',foreground:'#e7d6ac',cursor:'#f2e5bd',selectionBackground:'#a24b3d',black:'#241512',red:'#ef6d5d',green:'#6ebd66',yellow:'#ebc37a',blue:'#799cc9',magenta:'#c98bb8',cyan:'#79c1be',white:'#e7d6ac',brightBlack:'#a47b6c',brightRed:'#ff9b83',brightGreen:'#a2db8e',brightYellow:'#ffdf9e',brightBlue:'#a9c5e8',brightMagenta:'#e4b2d1',brightCyan:'#a5e0d9',brightWhite:'#fff3d4'}},
  emerald:{label:'Emerald',colors:{background:'#071e1b',foreground:'#b8e6ce',cursor:'#49d99e',selectionBackground:'#1c5c48',black:'#102b27',red:'#f08080',green:'#51d494',yellow:'#e7cc80',blue:'#75aee6',magenta:'#c09fe3',cyan:'#75d1c4',white:'#c9e8d7',brightBlack:'#658b7f',brightRed:'#ffaaaa',brightGreen:'#8aefb8',brightYellow:'#f5e2a7',brightBlue:'#a0cafa',brightMagenta:'#d9c2f3',brightCyan:'#a1e8df',brightWhite:'#edfff4'}},
  paper:{label:'Paper',colors:{background:'#e2e5eb',foreground:'#26303d',cursor:'#147d5c',selectionBackground:'#abc4e0',black:'#26303d',red:'#aa3333',green:'#26734d',yellow:'#856219',blue:'#275e9c',magenta:'#83508f',cyan:'#216f7b',white:'#657080',brightBlack:'#546173',brightRed:'#b8483e',brightGreen:'#32825b',brightYellow:'#987324',brightBlue:'#3977b4',brightMagenta:'#965ca1',brightCyan:'#2d8491',brightWhite:'#526174'}}
 };
 for(const preset of Object.values(PRESETS)){Object.freeze(preset.colors);Object.freeze(preset);}Object.freeze(PRESETS);
 const COLOR_KEYS=Object.freeze(['background','foreground','cursor','selectionBackground','selectionForeground']);
 const isColor=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
 function validate(theme){
  if(theme===undefined)return;
  if(!theme||typeof theme!=='object'||Array.isArray(theme)||!['default','ember-dune','emerald','paper','custom'].includes(theme.preset))throw Error('Choose a valid terminal theme.');
  if(theme.preset==='custom'){
   if(!theme.colors||typeof theme.colors!=='object'||Array.isArray(theme.colors)||COLOR_KEYS.slice(0,4).some(k=>!isColor(theme.colors[k]))||Object.entries(theme.colors).some(([k,v])=>!COLOR_KEYS.includes(k)||!isColor(v)))throw Error('Use six-digit hex colors such as #7a251e for the custom theme.');
  }else if(theme.colors!==undefined)throw Error('Custom terminal colors require the Custom theme.');
 }
 function resolve(theme){try{validate(theme);}catch{return {...PRESETS.default.colors};}return theme?.preset==='custom'?{...PRESETS.default.colors,...theme.colors}:{...(PRESETS[theme?.preset]||PRESETS.default).colors};}
 return Object.freeze({PRESETS,COLOR_KEYS,isColor,validate,resolve});
});
