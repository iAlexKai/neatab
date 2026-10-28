import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {RecentTabs, LIMIT, safeURL, inactiveTabs, INACTIVE_MS} from '../extension/core.mjs';

class Event {
  handlers = [];
  addListener(fn) { this.handlers.push(fn); }
  fire(...args) { this.handlers.forEach(fn => fn(...args)); }
}
const flush = async () => { for (let i=0;i<24;i++) await new Promise(resolve => setImmediate(resolve)); };

async function harness() {
  const data = Array.from({length: 10},(_,n)=>({id:n+1,windowId:n<8?1:2,index:n,
    lastAccessed:100-n,title:`Tab ${n+1}`,url:`https://example.com/${n+1}`,active:n===0||n===8,incognito:false}));
  const sent = [], operations = [], timers = new Map(), session = {}, local = {};
  let timerId = 0;
  const port = {onMessage:new Event(),onDisconnect:new Event(),postMessage:m=>sent.push(structuredClone(m)),disconnect(){this.onDisconnect.fire();}};
  const windows = [{id:1,type:'normal',focused:true,incognito:false},{id:2,type:'normal',focused:false,incognito:false}];
  const query = async q => data.filter(t =>
    (q.windowId === undefined || t.windowId===q.windowId) && (!q.active || t.active)).map(t=>({...t}));
  const chrome = {
    runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:new Event(),connectNative:()=>port,lastError:null},
    storage:{session:{get:async()=>session,set:async v=>Object.assign(session,v)},
      local:{get:async()=>local,set:async v=>Object.assign(local,v)}},
    windows:{WINDOW_ID_NONE:-1,getAll:async()=>windows,get:async id=>windows.find(w=>w.id===id),
      update:async(id,change)=>{operations.push(['focus',id]);windows.forEach(w=>w.focused=w.id===id);return {...windows.find(w=>w.id===id),...change};},onFocusChanged:new Event()},
    tabs:{query,get:async id=>{const t=data.find(t=>t.id===id);if(!t)throw new Error('No tab');return {...t};},
      update:async(id,change)=>{operations.push(['activate',id]);const tab=data.find(t=>t.id===id);if(!tab)throw new Error('No tab');data.filter(t=>t.windowId===tab.windowId).forEach(t=>t.active=t.id===id);return {...tab,...change};},
      remove:async ids=>{operations.push(['remove',...ids]);for(const id of ids){const i=data.findIndex(t=>t.id===id);if(i>=0)data.splice(i,1);}},
      create:async props=>{operations.push(['create',props.url,props.windowId,props.index]);return {id:100+operations.length,...props};},
      captureVisibleTab:async()=>{operations.push(['capture']);return 'data:image/jpeg;base64,AAAA';},
      onActivated:new Event(),onUpdated:new Event(),onCreated:new Event(),onRemoved:new Event(),onAttached:new Event(),onReplaced:new Event()}
  };
  let bitmapClosed = 0;
  const draws = [];
  const hooks = {};
  let now = 10000;
  class Clock extends Date { static now() { return now; } }
  class Canvas {
    constructor(width,height){this.width=width;this.height=height;}
    getContext(){return {drawImage:(...args)=>draws.push(args.slice(1))};}
    async convertToBlob(){
      if (hooks.beforeEncode) await hooks.beforeEncode();
      return {size:3,arrayBuffer:async()=>Uint8Array.from([255,216,255]).buffer};
    }
  }
  const context = vm.createContext({chrome,RecentTabs,LIMIT,safeURL,inactiveTabs,console,performance,URL,Date:Clock,Map,Set,Uint8Array,TextEncoder,structuredClone,btoa,
    fetch:async()=>({blob:async()=>({})}),OffscreenCanvas:Canvas,
    createImageBitmap:async()=>({width:1920,height:1080,close(){bitmapClosed++;}}),
    setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId;},clearTimeout:id=>timers.delete(id)});
  const code = readFileSync(new URL('../extension/background.js',import.meta.url),'utf8').replace(/^import .*\n/,'');
  vm.runInContext(code,context);
  await flush();
  const runTimer = async delay => {
    const match=[...timers].find(([,v])=>v.delay===delay);
    if(match){timers.delete(match[0]);await match[1].fn();await flush();}
  };
  const request = (message,sender={id:'test',url:'chrome-extension://test/popup.html'}) => new Promise(resolve=>{
    let accepted=false;
    for(const fn of chrome.runtime.onMessage.handlers) accepted=fn(message,sender,resolve)||accepted;
    if(!accepted)resolve(undefined);
  });
  return {chrome,data,windows,port,sent,operations,timers,runTimer,request,session,draws,hooks,
    advance(ms){now+=ms;},get bitmapClosed(){return bitmapClosed;}};
}

test('native bridge publishes seven, activation does not navigate and supports another window', async()=>{
  const h=await harness(); h.port.onMessage.fire({type:'ready',trusted:true,version:'1'}); await flush();
  const snapshot=h.sent.findLast(m=>m.type==='snapshot');
  assert.equal(snapshot.items.length,7); assert.equal(snapshot.items[0].id,1); assert.equal(snapshot.enabled,true);
  h.chrome.windows.onFocusChanged.fire(2); await flush();
  h.chrome.tabs.onActivated.fire({tabId:10,windowId:2}); await flush();
  h.chrome.windows.onFocusChanged.fire(1); await flush();
  h.port.onMessage.fire({type:'select',tabId:10,token:'a'}); await flush();
  assert.deepEqual(h.operations,[['activate',10],['focus',2]]);
  assert.ok(h.sent.some(m=>m.type==='committed'&&m.token==='a'));
  await h.runTimer(12);
  assert.equal(h.sent.findLast(m=>m.type==='snapshot').items[0].id,10);
});
test('close selected tab during hold cannot activate another tab accidentally', async()=>{
  const h=await harness(); const index=h.data.findIndex(t=>t.id===2); h.data.splice(index,1);
  h.chrome.tabs.onRemoved.fire(2);await flush();
  h.port.onMessage.fire({type:'select',tabId:2,token:'closed'}); await flush();
  assert.ok(h.sent.some(m=>m.type==='commit-error'&&m.token==='closed'));
  assert.deepEqual(h.operations,[]);
});
test('profile loses focus: its native host disables itself',async()=>{
  const h=await harness(); h.chrome.windows.onFocusChanged.fire(-1); await flush(); await h.runTimer(12);
  assert.equal(h.sent.findLast(m=>m.type==='snapshot').enabled,false);
});
test('incognito focus disables this host and never emits private metadata',async()=>{
  const h=await harness();h.windows.push({id:3,type:'normal',incognito:true,focused:false});
  h.chrome.windows.onFocusChanged.fire(3);await flush();await h.runTimer(12);
  assert.equal(h.sent.findLast(m=>m.type==='snapshot').enabled,false);
});
test('no webpage or unrelated extension can request native permissions or tab activation',async()=>{
  const h=await harness();
  assert.equal(await h.request({type:'permission'},{id:'other',url:'chrome-extension://other/popup.html'}),undefined);
  assert.equal(await h.request({type:'activate',tabId:2},{id:'test',url:'https://evil.example',tab:{id:1}}),undefined);
  assert.deepEqual(h.operations,[]);assert.ok(!h.sent.some(m=>m.type==='request-permission'));
});
test('preview capture is cancelled during a held shortcut and setting persists',async()=>{
  const h=await harness();assert.ok([...h.timers.values()].some(t=>t.delay===900));
  h.port.onMessage.fire({type:'busy',value:true});await flush();
  assert.ok(![...h.timers.values()].some(t=>t.delay===900));
  h.port.onMessage.fire({type:'busy',value:false});await flush();
  assert.ok([...h.timers.values()].some(t=>t.delay===900));
  const result=await h.request({type:'settings',scope:'window',previews:false});
  assert.equal(result.ok,true);assert.ok(![...h.timers.values()].some(t=>t.delay===900));
  const state=await h.request({type:'state'});assert.equal(state.settings.previews,false);
  assert.ok(state.items.every(t=>t.windowId===1));
});
test('idle capture scales to bounded preview and releases its decoded bitmap',async()=>{
  const h=await harness();await h.runTimer(900);await h.runTimer(12);
  assert.deepEqual(h.operations,[['capture']]);
  assert.equal(h.sent.findLast(m=>m.type==='snapshot').items[0].preview,'data:image/jpeg;base64,/9j/');
  assert.equal(h.bitmapClosed,1);
  const [x,y,width,height]=h.draws[0];
  assert.equal(y,0);assert.equal(height,240);assert.ok(x<=0&&x+width>=384);
});
test('tab switch or navigation racing a screenshot never attaches it to the wrong tab',async()=>{
  const h=await harness();
  h.chrome.tabs.captureVisibleTab=async()=>{h.data[0].url='https://example.com/new-page';return 'data:image/jpeg;base64,AAAA';};
  await h.runTimer(900);await h.runTimer(12);
  assert.equal(h.sent.findLast(m=>m.type==='snapshot').items[0].preview,null);
  assert.equal(h.bitmapClosed,0);
});
test('disabling previews during encoding cannot repopulate the cleared cache',async()=>{
  const h=await harness();
  let release;
  h.hooks.beforeEncode=()=>new Promise(resolve=>{release=resolve;});
  await h.runTimer(900);
  assert.equal(typeof release,'function');
  await h.request({type:'settings',scope:'all',previews:false});
  release();await flush();
  assert.equal(h.bitmapClosed,1);
  await h.request({type:'settings',scope:'all',previews:true});
  const state=await h.request({type:'state'});
  assert.ok(state.items.every(t=>t.preview===null));
});
test('navigation during encoding cannot show a preview of the old document',async()=>{
  const h=await harness();
  let release;
  h.hooks.beforeEncode=()=>new Promise(resolve=>{release=resolve;});
  await h.runTimer(900);
  h.data[0].url='https://example.com/new-document';
  h.chrome.tabs.onUpdated.fire(1,{url:h.data[0].url,status:'loading'},{...h.data[0]});
  await flush();release();await flush();
  const state=await h.request({type:'state'});
  assert.equal(state.items[0].url,'https://example.com/new-document');
  assert.equal(state.items[0].preview,null);
});
test('a late window-focus query cannot replace the current window',async()=>{
  const h=await harness();
  await h.request({type:'settings',scope:'window',previews:false});
  const get=h.chrome.windows.get;
  let release;
  h.chrome.windows.get=id=>id===2?new Promise(resolve=>{release=()=>resolve(h.windows[1]);}):get(id);
  h.chrome.windows.onFocusChanged.fire(2);await flush();
  h.chrome.windows.onFocusChanged.fire(1);await flush();
  release();await flush();
  const state=await h.request({type:'state'});
  assert.ok(state.items.every(t=>t.windowId===1));
});
test('late tab metadata cannot reorder a newer activation',async()=>{
  const h=await harness();
  const get=h.chrome.tabs.get;
  let release;
  h.chrome.tabs.get=id=>id===2?new Promise(resolve=>{release=()=>resolve({...h.data[1]});}):get(id);
  h.chrome.tabs.onActivated.fire({tabId:2,windowId:1});await flush();
  h.chrome.tabs.onActivated.fire({tabId:3,windowId:1});await flush();
  release();await flush();
  const state=await h.request({type:'state'});
  assert.equal(state.items[0].id,3);
});
test('rate limiting defers a settled tab preview instead of silently dropping it',async()=>{
  const h=await harness();await h.runTimer(900);
  h.advance(500);
  h.data[0].active=false;h.data[1].active=true;
  h.chrome.tabs.onActivated.fire({tabId:2,windowId:1});await flush();
  await h.runTimer(900);
  assert.equal(h.operations.filter(x=>x[0]==='capture').length,1);
  assert.ok([...h.timers.values()].some(t=>t.delay===600));
  h.advance(600);await h.runTimer(600);
  const state=await h.request({type:'state'});
  assert.equal(state.items[0].id,2);
  assert.ok(state.items[0].preview);
  assert.equal(h.operations.filter(x=>x[0]==='capture').length,2);
});
test('copy shortcut queries the foreground page and preserves its full URL without switching tabs',async()=>{
  const h=await harness();
  const link='https://example.com/路径?token='+('x'.repeat(6000))+'&name=中文#section';
  h.windows[0].focused=false;h.windows[1].focused=true;
  h.data[8].url=link; // Deliberately leave the MRU snapshot stale in the old window.
  h.port.onMessage.fire({type:'copy-url',requestId:'copy-1'});await flush();
  const result=h.sent.findLast(m=>m.type==='copy-url-result');
  assert.equal(result.requestId,'copy-1');assert.equal(result.url,link);
  assert.deepEqual(h.operations,[]);
  assert.equal((await h.request({type:'state'})).items[0].id,1);
});
test('copy cannot export a private tab or a background window URL',async()=>{
  const h=await harness();
  h.windows[0].focused=false;h.windows.push({id:3,focused:true,type:'normal',incognito:true});
  h.port.onMessage.fire({type:'copy-url',requestId:'private'});await flush();
  const result=h.sent.findLast(m=>m.type==='copy-url-result');
  assert.ok(result.error);assert.equal(result.url,undefined);
});
test('a focus change during a copy query returns an error instead of the old page URL',async()=>{
  const h=await harness();
  const query=h.chrome.tabs.query;let release;
  h.chrome.tabs.query=q=>q.active?new Promise(resolve=>{release=async()=>resolve(await query(q));}):query(q);
  h.port.onMessage.fire({type:'copy-url',requestId:'stale'});await flush();
  h.chrome.windows.onFocusChanged.fire(-1);await flush();
  await release();await flush();
  const result=h.sent.findLast(m=>m.type==='copy-url-result');
  assert.ok(result.error);assert.equal(result.url,undefined);
});
test('copying an empty URL does not return text that would clear the clipboard',async()=>{
  const h=await harness();h.data[0].url='';
  h.port.onMessage.fire({type:'copy-url',requestId:'empty'});await flush();
  const result=h.sent.findLast(m=>m.type==='copy-url-result');
  assert.ok(result.error);assert.equal(result.url,undefined);
});
test('tabs left more than 12 hours ago are listed oldest first; active, pinned and audible are kept',async()=>{
  const h=await harness();
  h.data.forEach(t=>{t.lastAccessed=10000;});
  h.data[2].pinned=true;h.data[3].audible=true;
  h.advance(INACTIVE_MS);
  h.data[4].lastAccessed=h.data[5].lastAccessed=12000; // touched later: not yet 12 hours idle
  const result=await h.request({type:'inactive'});
  assert.deepEqual(result.items.map(t=>t.id),[2,7,8,10]);
  assert.equal((await h.request({type:'state'})).inactiveCount,4);
});
test('leaving a tab counts as activity even when Chrome lastAccessed is older',async()=>{
  const h=await harness();
  h.data.forEach(t=>{t.lastAccessed=10000;});
  h.advance(INACTIVE_MS-1000);
  h.data[0].active=false;h.data[1].active=true;
  h.chrome.tabs.onActivated.fire({tabId:2,windowId:1});await flush();
  h.advance(2000);
  const ids=(await h.request({type:'inactive'})).items.map(t=>t.id);
  assert.ok(!ids.includes(1));assert.ok(ids.includes(3));
});
test('close all re-checks targets and only closes tabs still inactive, then undo reopens them in place',async()=>{
  const h=await harness();
  h.data.forEach(t=>{t.lastAccessed=10000;});h.advance(INACTIVE_MS);
  const ids=(await h.request({type:'inactive'})).items.map(t=>t.id);
  h.data[2].active=true; // the user switched to tab 3 after the page rendered
  const result=await h.request({type:'close-inactive',ids:[...ids,1,999,'x']});
  assert.deepEqual(h.operations,[['remove',2,4,5,6,7,8,10]]);
  assert.ok(h.data.some(t=>t.id===3)&&h.data.some(t=>t.id===1));
  const restored=await h.request({type:'restore-closed',items:result.closed});
  assert.equal(restored.restored,7);
  assert.deepEqual(h.operations[1],['create','https://example.com/2',1,1]);
});
test('a web page cannot close tabs through the inactive-tab controls',async()=>{
  const h=await harness();h.data.forEach(t=>{t.lastAccessed=10000;});h.advance(INACTIVE_MS);
  assert.equal(await h.request({type:'close-inactive',ids:[2]},{id:'test',url:'https://evil.example',tab:{id:1}}),undefined);
  assert.deepEqual(h.operations,[]);
});
