import test from 'node:test';
import assert from 'node:assert/strict';
import {RecentTabs, cycle, displayHost, supportsCopyLink, supportsCopyToast, inactiveTabs, idleLabel, duplicateTabs, INACTIVE_MS} from '../extension/core.mjs';

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
