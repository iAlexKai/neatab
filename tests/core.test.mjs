import test from 'node:test';
import assert from 'node:assert/strict';
import {RecentTabs, cycle, displayHost, supportsCopyLink, supportsCopyToast, inactiveTabs, idleLabel, idleGroup, duplicateTabs, discardCandidates, wouldPromptOnLeave, tabSections, addAway, awayTime, AWAY_KEEP_MS, INACTIVE_MS, DISCARD_MS} from '../extension/core.mjs';

const tabs = Array.from({length: 12}, (_, n) => ({id: n + 1, windowId: n < 8 ? 1 : 2,
  index: n, title: `Tab ${n + 1}`, lastAccessed: 100 - n}));

test('most recent seven; quick switching toggles last two, not tab-strip neighbours', () => {
  const model = new RecentTabs(); model.reconcile(tabs);
  model.touch(8); model.touch(3);
  assert.deepEqual(model.recent().map(t => t.id), [3,8,1,2,4,5,6]);
  model.touch(model.recent()[1].id);
  assert.deepEqual(model.recent().slice(0,2).map(t => t.id), [8,3]);
  model.touch(model.recent()[1].id);
  assert.deepEqual(model.recent().slice(0,2).map(t => t.id), [3,8]);
});
test('reconcile after worker restart preserves live MRU and removes closed/duplicate ids', () => {
  const model = new RecentTabs([4,9,4,999]); model.reconcile(tabs);
  assert.deepEqual(model.recent().map(t => t.id), [4,9,1,2,3,5,6]);
  model.remove(4); model.reconcile(tabs.filter(t => t.id !== 4));
  assert.equal(model.recent()[0].id, 9);
});
test('private tabs never appear and window scope filters before limiting', () => {
  const model = new RecentTabs(); model.reconcile([...tabs, {id:99,incognito:true,lastAccessed:500}]);
  model.touch(99); model.touch(10);
  assert.equal(model.recent()[0].id,10);
  assert.deepEqual(model.recent('window',2).map(t=>t.id),[10,9,11,12]);
  assert.ok(!model.tabs.has(99));
});
test('background-created tab is unavailable in MRU until visited', () => {
  const model = new RecentTabs(); model.reconcile(tabs);
  model.update({id: 50, windowId: 1, active:false});
  assert.ok(!model.recent().some(t => t.id === 50));
  model.touch(50); assert.equal(model.recent()[0].id,50);
});
test('cycling handles reverse wrap, empty and singleton', () => {
  assert.equal(cycle(0,-1,7),6); assert.equal(cycle(6,1,7),0);
  assert.equal(cycle(0,1,0),0); assert.equal(cycle(0,-1,1),0);
});
test('host labels safely handle browser internals and malformed URLs', () => {
  assert.equal(displayHost('chrome://newtab/'),'newtab');
  assert.equal(displayHost('https://example.com/private?q=secret'),'example.com');
  assert.equal(displayHost('not a url'),'');
});
test('an old native helper cannot advertise the new copy shortcut as ready', () => {
  assert.equal(supportsCopyLink('1.0.0'),false);
  assert.equal(supportsCopyLink(''),false);
  assert.equal(supportsCopyLink('1.1.0'),true);
  assert.equal(supportsCopyLink('1.1.1'),true);
  assert.equal(supportsCopyLink('1.10.0'),true);
});
test('copy success toast is not advertised by an older copy-only helper', () => {
  assert.equal(supportsCopyToast('1.1.1'),false);
  assert.equal(supportsCopyToast('1.2.0'),true);
});
test('inactive tabs use the later of lastAccessed and the observed leave time', () => {
  const now = INACTIVE_MS + 1000;
  const list = [{id: 1, lastAccessed: 500}, {id: 2, lastAccessed: 100}, {id: 3, lastAccessed: 0},
    {id: 4, lastAccessed: 100, active: true}, {id: 5, lastAccessed: 100, incognito: true}];
  assert.deepEqual(inactiveTabs(list, {}, now).map(t => t.id), [2, 1]);
  assert.deepEqual(inactiveTabs(list, {1: 5000}, now).map(t => t.id), [2]);
  assert.equal(idleLabel(13 * 3600000), '13 小时未访问');
  assert.equal(idleLabel(50 * 3600000), '2 天未访问');
});
test('duplicates: on-screen copy wins, then latest activity; pinned and audible copies stay open', () => {
  const u = 'https://a.example/x?q=1#h';
  const list = [{id: 1, url: u, lastAccessed: 10}, {id: 2, url: u, lastAccessed: 30}, {id: 3, url: u, lastAccessed: 20, pinned: true},
    {id: 4, url: u, lastAccessed: 5, audible: true}, {id: 5, url: 'https://b.example', active: true}, {id: 6, url: 'https://b.example', lastAccessed: 99},
    {id: 7, url: ''}, {id: 8, url: ''}, {id: 9, url: u, incognito: true}];
  const {keep, close} = duplicateTabs(list, {1: 40});
  assert.deepEqual([...keep].sort(), [1, 3, 4, 5]);
  assert.deepEqual([...close].sort(), [2, 6]);
});
test('idle groups: boundaries belong to the older group', () => {
  const hour = 3600000;
  assert.deepEqual([0, 11.9, 12, 23.9, 24, 47.9, 48, 500].map(h => idleGroup(h * hour).id),
    ['under12', 'under12', 'h12to24', 'h12to24', 'h24to48', 'h24to48', 'over48', 'over48']);
  assert.equal(idleLabel(30000), '刚刚访问');
  assert.equal(idleLabel(25 * 60000), '25 分钟未访问');
});
test('discard candidates: 6 hours idle, loaded, not on screen or audible; pinned included', () => {
  const now = DISCARD_MS + 1000;
  const list = [{id: 1, lastAccessed: 500}, {id: 2, lastAccessed: 100, pinned: true}, {id: 3, lastAccessed: 100, active: true},
    {id: 4, lastAccessed: 100, audible: true}, {id: 5, lastAccessed: 100, discarded: true}, {id: 6, lastAccessed: 100, status: 'unloaded'},
    {id: 7, lastAccessed: 5000}, {id: 8, lastAccessed: 0}];
  assert.deepEqual(discardCandidates(list, {}, now).map(t => t.id), [2, 1]);
  assert.deepEqual(discardCandidates(list, {1: 3000}, now).map(t => t.id), [2]);
});
test('leave check asks the page whether closing would show the leave dialog', () => {
  const run = (handlers, active = true) => {
    globalThis.navigator ??= {};
    const saved = globalThis.navigator.userActivation;
    Object.defineProperty(globalThis.navigator, 'userActivation', {value: {hasBeenActive: active}, configurable: true});
    globalThis.document = {createEvent: () => ({defaultPrevented: false, returnValue: '',
      initEvent(type, bubbles, cancelable) { this.type = type; this.cancelable = cancelable; },
      preventDefault() { this.defaultPrevented = true; }})};
    globalThis.window = {dispatchEvent: event => handlers.forEach(h => h(event))};
    try { return wouldPromptOnLeave(); }
    finally { delete globalThis.document; delete globalThis.window;
      Object.defineProperty(globalThis.navigator, 'userActivation', {value: saved, configurable: true}); }
  };
  assert.equal(run([]), false);
  assert.equal(run([event => { event.preventDefault(); }]), true);
  assert.equal(run([event => { event.returnValue = '有未保存的修改'; }]), true);
  assert.equal(run([event => { if (event.type !== 'beforeunload') event.preventDefault(); }]), false);
  // Chrome never shows the dialog on a page the user has not interacted with.
  assert.equal(run([event => { event.preventDefault(); }], false), false);
});
test('tab sections follow the tab strip and split on each group change',()=>{
  const tab=(id,index,groupId)=>({id,index,groupId});
  const sections=tabSections([tab(5,4,-1),tab(1,0,-1),tab(2,1,7),tab(3,2,7),tab(4,3,8),tab(6,5,undefined)],
    [{id:7,title:'home',color:'red'}]);
  assert.deepEqual(sections.map(s=>s.tabs.map(t=>t.id)),[[1],[2,3],[4],[5,6]]);
  assert.equal(sections[0].group,null);
  assert.equal(sections[1].group.title,'home');
  // A group Chrome did not report (just created) still gets its own section.
  assert.deepEqual(sections[2].group,{id:8});
  assert.equal(sections[3].group,null);
});
test('away intervals merge, prune after the keep window, and are subtracted from inactivity',()=>{
  let away=addAway([],100,200);
  away=addAway(away,150,300);away=addAway(away,400,500);away=addAway(away,500,450);
  assert.deepEqual(away,[[100,300],[400,500]]);
  assert.equal(awayTime(away,0,1000),300);assert.equal(awayTime(away,250,450),100);
  assert.deepEqual(addAway(away,600,700,700+AWAY_KEEP_MS-50),[[600,700]]);
  const h=3600000, now=100*h;
  const tabs=[{id:1,lastAccessed:now-62*h},{id:2,lastAccessed:now-70*h}];
  const weekend=[[now-61*h,now-1*h]];
  assert.deepEqual(inactiveTabs(tabs,{},now,INACTIVE_MS,weekend),[]);
  assert.deepEqual(inactiveTabs(tabs,{},now,9*h,weekend).map(t=>[t.id,t.idle]),[[2,10*h]]);
  assert.deepEqual(inactiveTabs(tabs,{},now,0,weekend).map(t=>t.idle),[10*h,2*h]);
  assert.deepEqual(inactiveTabs(tabs,{},now).map(t=>t.idle),[70*h,62*h]);
});
