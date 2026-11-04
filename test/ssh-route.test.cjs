'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {resolveRoute,openRoute}=require('../src/ssh-route.cjs');const {validate}=require('../src/vault.cjs');
const host=(id,jumps=[])=>({id,label:id,address:id+'.internal',port:22,username:'alice',jumpHostIds:jumps});const data=hosts=>({hosts,keys:[],snippets:[],forwards:[],knownHosts:{},settings:{}});
test('jump routes expand nested and ordered hops while keeping direct hosts compatible',()=>{
 const d=data([host('a'),host('b',['a']),host('c',['a','b']),host('target',['c'])]);assert.deepEqual(resolveRoute(d,'target').map(h=>h.id),['a','b','c','target']);assert.deepEqual(resolveRoute(data([{...host('direct'),jumpHostIds:undefined}]),'direct').map(h=>h.id),['direct']);assert.deepEqual(resolveRoute(data([host('a'),{...host('b'),jumpHostIds:undefined,jumpHostId:'a'}]),'b').map(h=>h.id),['a','b']);
});
test('vault validation refuses cycles, missing jump hosts, duplicates and oversized routes',()=>{
 assert.throws(()=>validate(data([host('a',['b']),host('b',['a'])])),/cycle/);assert.throws(()=>validate(data([host('a',['missing'])])),/missing/);assert.throws(()=>validate(data([host('a',['a'])])),/cycle/);assert.throws(()=>validate(data([host('a'),host('b',['a','a'])])),/Invalid jump/);assert.throws(()=>validate(data(Array.from({length:9},(_,i)=>host('h'+i,i?['h'+(i-1)]:[])))),/eight/);
});
test('route authentication is validated before opening any hop and canceled routes never connect',async()=>{
 let registered=0;const options={isCurrent:()=>true,verify:async()=>true,register:()=>registered++};
 await assert.rejects(openRoute({...options,data:data([host('jump'),{...host('target',['jump']),username:''}]),hostId:'target'}),/username/);await assert.rejects(openRoute({...options,data:data([{...host('jump'),keyId:'missing'},host('target',['jump'])]),hostId:'target'}),/private key is missing/);await assert.rejects(openRoute({...options,data:data([host('target')]),hostId:'target',isCurrent:()=>false}),/locked/);assert.equal(registered,0);
});
