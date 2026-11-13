import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {RecentTabs, LIMIT, safeURL, inactiveTabs, duplicateTabs, lastActive, INACTIVE_MS, discardCandidates, wouldPromptOnLeave, DISCARD_CHOICES, DISCARD_MINUTES, PRESSURE_IDLE_MS, DISCARD_MS, addAway, AWAY_IDLE_SECONDS} from '../extension/core.mjs';

class Event {
  handlers = [];
  addListener(fn) { this.handlers.push(fn); }
  removeListener(fn) { this.handlers = this.handlers.filter(h => h !== fn); }
  fire(...args) { this.handlers.forEach(fn => fn(...args)); }
}
const flush = async () => { for (let i=0;i<24;i++) await new Promise(resolve => setImmediate(resolve)); };

async function harness(seed = {}) {
  const data = Array.from({length: 10},(_,n)=>({id:n+1,windowId:n<8?1:2,index:n,
    lastAccessed:100-n,title:`Tab ${n+1}`,url:`https://example.com/${n+1}`,active:n===0||n===8,incognito:false}));
  const sent = [], operations = [], timers = new Map(), session = {}, local = structuredClone(seed);
  let timerId = 0;
  const port = {onMessage:new Event(),onDisconnect:new Event(),postMessage:m=>sent.push(structuredClone(m)),disconnect(){this.onDisconnect.fire();}};
  const windows = [{id:1,type:'normal',focused:true,incognito:false},{id:2,type:'normal',focused:false,incognito:false}];
  const query = async q => data.filter(t =>
    (q.windowId === undefined || t.windowId===q.windowId) && (!q.active || t.active)).map(t=>({...t}));
  const alarms = new Map(), pageChecks = {}, groups = [], scripts = [];
  const chrome = {
    alarms:{get:async name=>alarms.get(name),create:async(name,info)=>{alarms.set(name,{name,...info});},
      clear:async name=>alarms.delete(name),onAlarm:new Event()},
    scripting:{executeScript:async({target,world})=>{
      scripts.push(world);
      const check=pageChecks[target.tabId];
      if(check==='throw')throw new Error('Cannot access contents of the page');
      if(typeof check==='function')return check();
      return [{frameId:0,result:check===true}];
    }},
    tabGroups:{query:async()=>groups},
    idle:{setDetectionInterval(){},queryState:async()=>'active',onStateChanged:new Event()},
    runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:new Event(),onStartup:new Event(),connectNative:()=>port,lastError:null},
    storage:{session:{get:async()=>session,set:async v=>Object.assign(session,v)},
      local:{get:async()=>local,set:async v=>Object.assign(local,v),remove:async keys=>[].concat(keys).forEach(k=>delete local[k])}},
    windows:{WINDOW_ID_NONE:-1,getAll:async()=>windows,get:async id=>windows.find(w=>w.id===id),
      update:async(id,change)=>{operations.push(['focus',id]);windows.forEach(w=>w.focused=w.id===id);return {...windows.find(w=>w.id===id),...change};},onFocusChanged:new Event()},
    tabs:{query,get:async id=>{const t=data.find(t=>t.id===id);if(!t)throw new Error('No tab');return {...t};},
      update:async(id,change)=>{operations.push(['activate',id]);const tab=data.find(t=>t.id===id);if(!tab)throw new Error('No tab');data.filter(t=>t.windowId===tab.windowId).forEach(t=>t.active=t.id===id);return {...tab,...change};},
      discard:async id=>{operations.push(['discard',id]);const tab=data.find(t=>t.id===id);if(!tab||tab.active)throw new Error('Cannot discard');tab.discarded=true;return {...tab};},
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
  const context = vm.createContext({chrome,RecentTabs,LIMIT,safeURL,inactiveTabs,duplicateTabs,lastActive,INACTIVE_MS,discardCandidates,wouldPromptOnLeave,DISCARD_CHOICES,DISCARD_MINUTES,PRESSURE_IDLE_MS,addAway,AWAY_IDLE_SECONDS,Promise,console,performance,URL,Date:Clock,Map,Set,Uint8Array,TextEncoder,structuredClone,btoa,
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
  return {chrome,data,windows,port,sent,operations,timers,runTimer,request,session,local,groups,scripts,draws,hooks,alarms,pageChecks,
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
test('idle capture scales to bounded previews and releases both decoded bitmaps',async()=>{
  const h=await harness();await h.runTimer(900);await h.runTimer(12);
  assert.deepEqual(h.operations,[['capture']]);
  assert.equal(h.sent.findLast(m=>m.type==='snapshot').items[0].preview,'data:image/jpeg;base64,/9j/');
  assert.equal(h.bitmapClosed,2); // card image and full-window preview
  const [x,y,width,height]=h.draws.find(d=>d[3]===240);
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
test('inactive view lists every closable tab oldest first; active, pinned and audible are kept',async()=>{
  const h=await harness();
  h.data.forEach(t=>{t.lastAccessed=10000;});
  h.data[2].pinned=true;h.data[3].audible=true;
  h.advance(INACTIVE_MS);
  h.data[4].lastAccessed=h.data[5].lastAccessed=12000; // touched later: not yet 12 hours idle
  const result=await h.request({type:'inactive'});
  assert.deepEqual(result.items.map(t=>t.id),[2,7,8,10,5,6]);
  assert.equal((await h.request({type:'state'})).inactiveCount,4);
});
test('leaving a tab counts as activity even when Chrome lastAccessed is older',async()=>{
  const h=await harness();
  h.data.forEach(t=>{t.lastAccessed=10000;});
  h.advance(INACTIVE_MS-1000);
  h.data[0].active=false;h.data[1].active=true;
  h.chrome.tabs.onActivated.fire({tabId:2,windowId:1});await flush();
  h.advance(2000);
  const {items,now}=await h.request({type:'inactive'});
  const ids=items.filter(t=>now-t.lastActive>=INACTIVE_MS).map(t=>t.id);
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
test('close duplicates keeps the most recently used copy of each URL across windows',async()=>{
  const h=await harness();
  // Same URL as tab 1 (on screen in window 1) and tab 9 (on screen in window 2).
  h.data[3].url=h.data[5].url=h.data[0].url;          // tabs 4, 6 duplicate 1
  h.data[6].url=h.data[7].url=h.data[9].url='https://example.com/dup'; // 7, 8, 10
  h.data[6].lastAccessed=50;h.data[7].lastAccessed=90;h.data[9].lastAccessed=70;
  h.data[2].url=h.data[0].url+'#section';              // different anchor: not a duplicate
  h.data[5].pinned=true;
  const {items}=await h.request({type:'all-tabs'});
  const mark=Object.fromEntries(items.map(t=>[t.id,t.duplicate]));
  assert.deepEqual([mark[1],mark[4],mark[6],mark[3]],['keep','close','keep','']);
  assert.deepEqual([mark[8],mark[7],mark[10]],['keep','close','close']);
  assert.equal((await h.request({type:'state'})).duplicateCount,3);
  const ids=items.filter(t=>t.duplicate==='close').map(t=>t.id);
  h.data[9].url='https://example.com/navigated';       // tab 10 navigated after render: keep it
  const result=await h.request({type:'close-duplicates',ids:[...ids,1,8]});
  assert.deepEqual(h.operations,[['remove',4,7]]);
  assert.deepEqual(result.closed.map(t=>t.url),[h.data[0].url,'https://example.com/dup']);
});
test('leaving a tab makes it the most recent copy to keep',async()=>{
  const h=await harness();
  h.data[1].url=h.data[2].url='https://example.com/same';
  h.data[1].lastAccessed=10;h.data[2].lastAccessed=20;
  h.data[0].active=false;h.data[1].active=true;
  h.chrome.tabs.onActivated.fire({tabId:2,windowId:1});await flush();
  h.data[1].active=false;h.data[0].active=true;
  h.chrome.tabs.onActivated.fire({tabId:1,windowId:1});await flush();
  const mark=Object.fromEntries((await h.request({type:'all-tabs'})).items.map(t=>[t.id,t.duplicate]));
  assert.deepEqual([mark[2],mark[3]],['keep','close']);
});
test('single close only closes an open normal tab, and the manager page is not listed',async()=>{
  const h=await harness();
  h.data.push({id:50,windowId:1,index:20,lastAccessed:1,title:'整理标签页',url:'chrome-extension://test/tabs.html#all',active:false,incognito:false});
  const {items}=await h.request({type:'all-tabs'});
  assert.ok(!items.some(t=>t.id===50));
  assert.deepEqual((await h.request({type:'close-tab',id:999})).closed,[]);
  await h.request({type:'close-tab',id:5});
  assert.deepEqual(h.operations,[['remove',5]]);
});
test('group close only closes tabs still at least as idle as the group, so recent use protects them',async()=>{
  const h=await harness();
  const hour=3600000;
  h.data.forEach(t=>{t.lastAccessed=10000;});
  h.advance(60*hour);
  const now=10000+60*hour;
  h.data[1].lastAccessed=now-50*hour; // tab 2: 48h+
  h.data[2].lastAccessed=now-30*hour; // tab 3: 24–48h
  h.data[3].lastAccessed=now-30*hour; // tab 4: 24–48h, used again below
  h.data[4].lastAccessed=now-2*hour;  // tab 5: under 12h
  await h.request({type:'close-inactive',ids:[2,3,4,5],minIdle:24*hour}).then(r=>{
    assert.deepEqual(h.operations,[['remove',2,3,4]]);
    assert.equal(r.closed.length,3);
  });
  h.data.find(t=>t.id===6).lastAccessed=now-1*hour;  // tab 6 now recent: a 24h group close must skip it
  await h.request({type:'close-inactive',ids:[6,7],minIdle:24*hour});
  assert.deepEqual(h.operations[1],['remove',7]);
  await h.request({type:'close-inactive',ids:[5,6],minIdle:0});
  assert.deepEqual(h.operations[2],['remove',5,6]);
  await h.request({type:'close-inactive',ids:[8],minIdle:'bogus'});
  assert.deepEqual(h.operations[3],['remove',8]); // invalid bound falls back to 12 hours; tab 8 is 60h idle
});
test('auto discard releases tabs idle for an hour, skipping on-screen, audible, leave-prompting and uninspectable pages',async()=>{
  const h=await harness();
  assert.equal(h.alarms.get('auto-discard').periodInMinutes,5);
  h.data.forEach(t=>{t.lastAccessed=10000;});
  h.advance(DISCARD_MS);
  h.data[4].lastAccessed=10000+DISCARD_MS-60000; // tab 5: used 1 minute ago
  h.data[2].audible=true;                         // tab 3: playing sound
  h.data[3].pinned=true;                          // tab 4: pinned tabs are released too
  h.data[6].discarded=true;                       // tab 7: already released
  h.pageChecks[2]=true;                           // tab 2: closing would show "Leave site?"
  h.pageChecks[8]='throw';                        // tab 8: chrome:// page, cannot be inspected
  h.pageChecks[6]=()=>[{frameId:0,result:false},{frameId:3,result:true}]; // tab 6: an iframe would prompt
  h.chrome.alarms.onAlarm.fire({name:'auto-discard'});await flush();
  assert.deepEqual(h.operations.filter(o=>o[0]==='discard').map(o=>o[1]),[4,10]);
  const state=await h.request({type:'state'});
  assert.equal(state.discardSummary.discarded,2);assert.equal(state.discardSummary.prompted,2);assert.equal(state.discardSummary.unchecked,1);
  const all=(await h.request({type:'all-tabs'})).items;
  assert.equal(all.find(t=>t.id===4).discarded,true);
});
test('a tab opened while its page is being checked is not discarded',async()=>{
  const h=await harness();
  h.data.forEach(t=>{t.lastAccessed=10000;});h.advance(DISCARD_MS);
  h.pageChecks[2]=()=>{h.data[0].active=false;h.data[1].active=true;h.data[1].lastAccessed=10000+DISCARD_MS;return [{frameId:0,result:false}];};
  h.chrome.alarms.onAlarm.fire({name:'auto-discard'});await flush();
  const discarded=h.operations.filter(o=>o[0]==='discard').map(o=>o[1]);
  assert.ok(!discarded.includes(2));assert.ok(discarded.includes(3));
});
test('turning auto discard off clears the alarm and stops releasing tabs',async()=>{
  const h=await harness();
  h.data.forEach(t=>{t.lastAccessed=10000;});h.advance(DISCARD_MS);
  await h.request({type:'settings',scope:'all',previews:true,autoDiscard:false});
  assert.equal(h.alarms.has('auto-discard'),false);
  h.chrome.alarms.onAlarm.fire({name:'auto-discard'});await flush();
  assert.deepEqual(h.operations,[]);
  assert.equal((await h.request({type:'state'})).settings.autoDiscard,false);
  await h.request({type:'settings',scope:'all',previews:true});
  assert.equal(h.alarms.has('auto-discard'),true);
});
test('a capture sends one large preview to the helper, outside snapshots, and resends it to a new helper',async()=>{
  const h=await harness();await h.runTimer(900);await h.runTimer(12);
  const full=h.sent.filter(m=>m.type==='full-preview');
  assert.equal(full.length,1);
  assert.deepEqual([full[0].tabId,full[0].url],[1,'https://example.com/1']);
  assert.ok(full[0].data.startsWith('data:image/jpeg;base64,'));
  assert.ok(h.sent.filter(m=>m.type==='snapshot').every(m=>JSON.stringify(m).length<20000));
  const [x,y,width,height]=h.draws.at(-1);
  assert.deepEqual([x,y,width,height],[0,0,1600,900]); // 1920x1080 scaled to 1600 wide
  h.port.onMessage.fire({type:'ready',trusted:true,version:'2.2.0'});await flush();
  assert.equal(h.sent.filter(m=>m.type==='full-preview').length,2);
  await h.request({type:'settings',scope:'all',previews:false});
  h.port.onMessage.fire({type:'ready',trusted:true,version:'2.2.0'});await flush();
  assert.equal(h.sent.filter(m=>m.type==='full-preview').length,2);
});
test('after a native switch the helper is told when the page has landed',async()=>{
  const h=await harness();
  h.port.onMessage.fire({type:'select',tabId:2,token:'t1'});await flush();
  assert.ok(h.sent.some(m=>m.type==='landed'&&m.token==='t1'&&m.tabId===2));
  h.data[2].status='loading';
  h.port.onMessage.fire({type:'select',tabId:3,token:'t2'});await flush();
  assert.ok(!h.sent.some(m=>m.type==='landed'&&m.token==='t2'));
  h.data[2].status='complete';
  h.chrome.tabs.onUpdated.fire(3,{status:'complete'},{...h.data[2]});await flush();
  assert.ok(h.sent.some(m=>m.type==='landed'&&m.token==='t2'));
  assert.ok(!(await h.request({type:'activate',tabId:4})).error);
  await flush();
  assert.ok(!h.sent.some(m=>m.type==='landed'&&m.tabId===4)); // popup clicks have no preview to land
});
test('a captured preview is kept on disk by URL and shown after a restart before the tab is visited',async()=>{
  const first=await harness();await first.runTimer(900);await first.runTimer(12);
  assert.ok(first.local['preview:https://example.com/1'].full);
  assert.deepEqual([...first.local.previewIndex.map(([url])=>url)],['https://example.com/1']);
  // New browser session: tab ids change, the URL is the same and nothing has been captured yet.
  const second=await harness(first.local);second.port.onMessage.fire({type:'ready',trusted:true,version:'1'});
  await flush();await second.runTimer(12);
  assert.ok(!second.operations.some(o=>o[0]==='capture'));
  assert.equal(second.sent.findLast(m=>m.type==='snapshot').items.find(t=>t.id===1).preview,'data:image/jpeg;base64,/9j/');
  assert.ok(second.sent.some(m=>m.type==='full-preview'&&m.tabId===1));
});
test('stored previews are capped, expire, and are erased when previews are turned off',async()=>{
  const seed={previewIndex:[]};
  for(let n=0;n<12;n++){const url=`https://old.example/${n}`;seed['preview:'+url]={data:'x',full:'y',time:9000};seed.previewIndex.push([url,9000]);}
  seed['preview:https://stale.example/']={data:'x',time:-1e9};seed.previewIndex.unshift(['https://stale.example/',-1e9]);
  const h=await harness(seed);await flush();
  assert.equal(h.local['preview:https://stale.example/'],undefined);
  await h.runTimer(900);await h.runTimer(12);await flush();
  assert.equal(h.local.previewIndex.length,LIMIT+3);
  assert.equal(h.local.previewIndex.at(-1)[0],'https://example.com/1');
  assert.equal(h.local['preview:https://old.example/0'],undefined);
  await h.request({type:'settings',scope:'all',previews:false});
  assert.ok(!Object.keys(h.local).some(k=>k.startsWith('preview')));
});
test('all-tabs reports each tab group, and a failed group lookup still lists the tabs',async()=>{
  const h=await harness();
  h.data[1].groupId=7;h.groups.push({id:7,title:'home',color:'red',collapsed:true,windowId:1});
  const result=await h.request({type:'all-tabs'});
  assert.deepEqual(JSON.parse(JSON.stringify(result.groups)),[{id:7,title:'home',color:'red'}]);
  assert.equal(result.items.find(t=>t.id===2).groupId,7);
  assert.equal(result.items.find(t=>t.id===1).groupId,-1);
  h.chrome.tabGroups.query=async()=>{throw new Error('unavailable');};
  const fallback=await h.request({type:'all-tabs'});
  assert.equal(fallback.ok,true);assert.equal(fallback.groups.length,0);assert.equal(fallback.items.length,10);
});
test('the helper learns the page area when a hold starts and after a capture, excluding any side drawer',async()=>{
  const h=await harness();h.data[0].width=1120;h.data[0].height=780;
  h.port.onMessage.fire({type:'busy',value:true});await flush();
  assert.deepEqual(h.sent.findLast(m=>m.type==='viewport'),{type:'viewport',width:1120,height:780});
  h.port.onMessage.fire({type:'busy',value:false});await flush();
  h.data[0].width=1400;
  await h.runTimer(900);
  assert.equal(h.sent.findLast(m=>m.type==='viewport').width,1400);
});
test('a tab with no reported size sends no page area, so the helper keeps its window-width fallback',async()=>{
  const h=await harness();
  h.port.onMessage.fire({type:'busy',value:true});await flush();
  assert.ok(!h.sent.some(m=>m.type==='viewport'));
});
test('time away from the computer does not count toward inactivity',async()=>{
  const h=await harness();const hour=3600000;
  assert.ok(h.alarms.has('heartbeat'));
  h.data.forEach(t=>{t.lastAccessed=10000;});
  h.advance(hour);
  h.chrome.idle.onStateChanged.fire('locked');await flush();   // Friday evening
  h.advance(60*hour);
  h.chrome.idle.onStateChanged.fire('active');await flush();   // Monday morning
  h.advance(hour);
  const {items}=await h.request({type:'inactive'});
  const tab=items.find(t=>t.id===2);
  assert.equal(tab.idle,2*hour);
  assert.equal(tab.lastActive,10000);
  assert.equal((await h.request({type:'state'})).inactiveCount,0);
  // While still away, the open stretch is already left out.
  h.chrome.idle.onStateChanged.fire('idle');await flush();
  h.advance(5*hour);
  assert.equal((await h.request({type:'inactive'})).items.find(t=>t.id===2).idle,2*hour-AWAY_IDLE_SECONDS*1000);
});
test('a heartbeat gap from sleep or a closed Chrome is recorded as time away',async()=>{
  const h=await harness({alive:10000-3*3600000});
  assert.deepEqual(JSON.parse(JSON.stringify(h.local.away)),[[10000-3*3600000,10000]]);
  h.advance(5*60000);await h.chrome.alarms.onAlarm.fire({name:'heartbeat'});await flush();
  assert.equal(h.local.away.length,1);
  h.advance(40*60000);await h.chrome.alarms.onAlarm.fire({name:'heartbeat'});await flush();
  assert.equal(h.local.away.length,2);assert.equal(h.local.alive,10000+45*60000);
});
test('the leave check runs in the page itself and the release time can be chosen',async()=>{
  const h=await harness();const minute=60000;
  h.data.forEach(t=>{t.lastAccessed=10000;});h.advance(40*minute);
  h.chrome.alarms.onAlarm.fire({name:'auto-discard'});await flush();
  assert.equal(h.operations.length,0);                       // default: one hour
  assert.equal((await h.request({type:'state'})).settings.discardAfter,60);
  await h.request({type:'settings',scope:'all',previews:true,discardAfter:30});
  h.chrome.alarms.onAlarm.fire({name:'auto-discard'});await flush();
  assert.ok(h.operations.filter(o=>o[0]==='discard').length>0);
  assert.ok(h.scripts.every(world=>world==='MAIN'));
  await h.request({type:'settings',scope:'all',previews:true,discardAfter:7});
  assert.equal((await h.request({type:'state'})).settings.discardAfter,60); // only the offered choices
});
test('tabs restored at startup are released once loaded, until the user opens them',async()=>{
  const h=await harness();
  h.data.forEach(t=>{t.lastAccessed=10000;});
  h.chrome.runtime.onStartup.fire();await flush();
  h.chrome.tabs.onActivated.fire({tabId:3,windowId:1});await flush();  // opened right away: kept
  await h.runTimer(3000);
  const released=h.operations.filter(o=>o[0]==='discard').map(o=>o[1]);
  assert.ok(released.includes(2)&&released.includes(10));
  assert.ok(!released.includes(1)&&!released.includes(3)&&!released.includes(9)); // on screen, or opened
  assert.equal((await h.request({type:'state'})).discardSummary.trigger,'startup');
});
test('macOS memory pressure releases tabs unused for a short while, at most once a minute',async()=>{
  const h=await harness();const minute=60000;
  h.data.forEach(t=>{t.lastAccessed=10000;});h.advance(10*minute);
  h.port.onMessage.fire({type:'memory-pressure',level:'warning'});await flush();
  assert.equal(h.operations.length,0);                       // 10 minutes is under the 15-minute bar
  h.advance(minute);
  h.port.onMessage.fire({type:'memory-pressure',level:'critical'});await flush();
  const first=h.operations.length;assert.ok(first>0);
  assert.equal((await h.request({type:'state'})).discardSummary.trigger,'pressure');
  h.data.forEach(t=>{t.discarded=false;});
  h.port.onMessage.fire({type:'memory-pressure',level:'critical'});await flush();
  assert.equal(h.operations.length,first);                   // rate limited
  await h.request({type:'settings',scope:'all',previews:true,autoDiscard:false});
  h.advance(2*minute);h.port.onMessage.fire({type:'memory-pressure',level:'critical'});await flush();
  assert.equal(h.operations.length,first);                   // switched off
});
test('an alarm left by an older version that checked every 15 minutes is replaced',async()=>{
  const h=await harness();
  h.alarms.set('auto-discard',{name:'auto-discard',periodInMinutes:15});
  await h.request({type:'settings',scope:'all',previews:true});
  assert.equal(h.alarms.get('auto-discard').periodInMinutes,5);
});
