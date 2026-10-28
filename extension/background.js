import { RecentTabs, LIMIT, safeURL, inactiveTabs, duplicateTabs, lastActive } from './core.mjs';

const HOST = 'app.seven.switcher';
const model = new RecentTabs();
const previews = new Map();
let settings = {scope: 'all', previews: true};
let nativePort = null;
let nativeState = {connected: false, trusted: false, version: '', error: ''};
let revision = 0;
let focusedWindow = chrome.windows.WINDOW_ID_NONE;
let profileFocused = false;
let captureTimer;
let lastCapture = 0;
let captureInFlight = false;
let captureGeneration = 0;
let focusGeneration = 0;
const activationGenerations = new Map();
let retryTimer;
let busy = false;
let closed = false;
let publishTimer;
// tabId -> time the user last left it. Session-scoped like tab ids; Chrome's lastAccessed covers the rest.
let seen = {};
const activeByWindow = new Map();
const MANAGER_PAGE = chrome.runtime.getURL('tabs.html');

const ready = initialize();

async function initialize() {
  const [saved, preferences, windows] = await Promise.all([
    chrome.storage.session.get(['order', 'seen', 'active']), chrome.storage.local.get('settings'),
    chrome.windows.getAll({windowTypes: ['normal']})
  ]);
  settings = {...settings, ...preferences.settings};
  model.order = saved.order || [];
  const tabs = (await Promise.all(windows.map(w => chrome.tabs.query({windowId: w.id})))).flat();
  model.reconcile(tabs);
  const live = new Set(tabs.map(t => t.id));
  seen = Object.fromEntries(Object.entries(saved.seen || {}).filter(([id]) => live.has(Number(id))));
  // An activation that woke this worker: the previously active tab was left just now.
  const previous = new Map(saved.active || []);
  for (const tab of tabs.filter(t => t.active)) {
    const before = previous.get(tab.windowId);
    if (Number.isInteger(before) && before !== tab.id && live.has(before)) seen[before] = Date.now();
    activeByWindow.set(tab.windowId, tab.id);
  }
  focusedWindow = windows.find(w => w.focused)?.id ?? windows[0]?.id ?? chrome.windows.WINDOW_ID_NONE;
  profileFocused = windows.some(w => w.focused && !w.incognito);
  const active = tabs.find(t => t.active && t.windowId === focusedWindow);
  if (active) model.touch(active.id);
  connectNative();
  queuePublish();
  scheduleCapture();
}

function connectNative() {
  clearTimeout(retryTimer);
  if (nativePort || closed) return;
  nativeState.error = '';
  try {
    const port = chrome.runtime.connectNative(HOST);
    nativePort = port;
    port.onMessage.addListener(message => {
      if (message.type === 'ready' || message.type === 'status') {
        nativeState = {connected: true, trusted: !!message.trusted,
          version: message.version || '', error: message.error || ''};
        publish();
      } else if (message.type === 'select' && Number.isInteger(message.tabId)) {
        void activate(message.tabId, message.token);
      } else if (message.type === 'copy-url' && typeof message.requestId === 'string' && message.requestId.length <= 64) {
        void copyCurrentURL(message.requestId);
      } else if (message.type === 'busy') {
        busy = !!message.value;
        if (busy) clearTimeout(captureTimer);
        else scheduleCapture();
      }
    });
    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message || '辅助程序已断开';
      nativePort = null;
      nativeState = {connected: false, trusted: false, version: '', error};
      // Never spin on a missing helper. The toolbar can explicitly reconnect.
      retryTimer = setTimeout(connectNative, 30000);
    });
  } catch (error) { nativeState.error = String(error); }
}

function send(message) {
  try { nativePort?.postMessage(message); } catch { /* disconnect callback owns retry */ }
}

async function copyCurrentURL(requestId) {
  await ready;
  const focus = focusGeneration;
  try {
    const windows = await chrome.windows.getAll({windowTypes: ['normal']});
    const window = windows.find(w => w.focused && !w.incognito);
    if (!window || focus !== focusGeneration) throw new Error('没有前台普通窗口');
    const activation = activationGenerations.get(window.id) || 0;
    // Query Chrome at the shortcut, not the truncated/stale seven-card snapshot.
    const [tab] = await chrome.tabs.query({active: true, windowId: window.id});
    if (!tab || tab.incognito || !tab.url || focus !== focusGeneration ||
        activation !== (activationGenerations.get(window.id) || 0)) throw new Error('当前标签已变化');
    const response = {type: 'copy-url-result', requestId, url: tab.url};
    if (new TextEncoder().encode(JSON.stringify(response)).length > 1500000) throw new Error('链接过长');
    send(response);
  } catch (error) {
    send({type: 'copy-url-result', requestId, error: String(error)});
  }
}

function snapshot() {
  const tabs = model.recent(settings.scope, focusedWindow);
  const keep = new Set(tabs.map(t => t.id));
  for (const id of previews.keys()) if (!keep.has(id)) previews.delete(id);
  return {type: 'snapshot', revision: ++revision, limit: LIMIT, enabled: profileFocused,
    liveIds: [...model.tabs.keys()],
    items: tabs.map(t => ({id: t.id, windowId: t.windowId, title: (t.title || '新标签页').slice(0, 500),
      url: (t.url || '').slice(0, 4096), discarded: !!t.discarded, audible: !!t.audible,
      preview: settings.previews && previews.get(t.id)?.url === t.url ? previews.get(t.id).data : null})),
    settings};
}

function queuePublish() {
  clearTimeout(publishTimer);
  publishTimer = setTimeout(publish, 12);
}

function publish() {
  send(snapshot());
  void chrome.storage.session.set({order: model.order, seen, active: [...activeByWindow]}).catch(() => {});
}

function scheduleCapture() {
  clearTimeout(captureTimer);
  if (!settings.previews || busy || focusedWindow < 0) return;
  // Capture only after the user settles, never on the shortcut/commit path.
  captureTimer = setTimeout(() => void capture(), 900);
}

function invalidateCapture() {
  captureGeneration += 1;
  clearTimeout(captureTimer);
}

async function capture() {
  if (busy || !settings.previews || !profileFocused) return;
  const remaining = 1100 - (Date.now() - lastCapture);
  if (captureInFlight || remaining > 0) {
    // Do not lose the new page's preview when its idle timer lands inside the rate limit.
    captureTimer = setTimeout(() => void capture(), Math.max(100, remaining));
    return;
  }
  const generation = captureGeneration;
  const windowId = focusedWindow;
  captureInFlight = true;
  try {
    const window = await chrome.windows.get(windowId).catch(() => null);
    if (!window?.focused) return;
    const [tab] = await chrome.tabs.query({active: true, windowId});
    if (busy || !settings.previews || generation !== captureGeneration) return;
    if (!tab || tab.incognito || !['http:', 'https:', 'file:'].includes(safeURL(tab.url))) return;
    if (!model.recent(settings.scope, focusedWindow).some(t => t.id === tab.id)) return;
    const previous = previews.get(tab.id);
    if (previous?.url === tab.url && Date.now() - previous.time < 15000) return;
    lastCapture = Date.now();
    const data = await chrome.tabs.captureVisibleTab(windowId, {format: 'jpeg', quality: 35});
    // Chrome captures the active tab, so verify activation AND navigation did not race it.
    const [current] = await chrome.tabs.query({active: true, windowId});
    if (busy || !settings.previews || generation !== captureGeneration ||
        current?.id !== tab.id || current?.url !== tab.url || focusedWindow !== windowId) return;
    const compact = await compactPreview(data);
    if (!compact || busy || !settings.previews || generation !== captureGeneration ||
        model.tabs.get(tab.id)?.url !== tab.url) return;
    if (model.recent(settings.scope, focusedWindow).some(t => t.id === tab.id)) {
      previews.set(tab.id, {data: compact, url: tab.url, time: Date.now()});
      queuePublish();
    }
  } catch { /* Restricted pages use a deliberate title/domain card. */ }
  finally { captureInFlight = false; }
}

async function compactPreview(data) {
  // Bound each cached preview to 384 x 240 and 90 KB, including HiDPI displays.
  const response = await fetch(data);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = new OffscreenCanvas(384, 240);
    const ctx = canvas.getContext('2d', {alpha: false});
    const scale = Math.max(384 / bitmap.width, 240 / bitmap.height);
    ctx.drawImage(bitmap, (384 - bitmap.width * scale) / 2, 0,
      bitmap.width * scale, bitmap.height * scale);
    const blob = await canvas.convertToBlob({type: 'image/jpeg', quality: .55});
    if (blob.size > 90000) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return 'data:image/jpeg;base64,' + btoa(binary);
  } finally { bitmap.close(); }
}

async function openTabs() {
  const tabs = await chrome.tabs.query({windowType: 'normal'});
  return tabs.filter(t => !t.incognito && !t.url?.startsWith(MANAGER_PAGE));
}

async function inactiveList() {
  return inactiveTabs(await openTabs(), seen, Date.now());
}

async function allTabs() {
  const tabs = await openTabs();
  const {keep, close} = duplicateTabs(tabs, seen);
  return tabs.map(t => ({id: t.id, windowId: t.windowId, index: t.index, title: (t.title || '新标签页').slice(0, 500),
    url: (t.url || '').slice(0, 4096), active: !!t.active, pinned: !!t.pinned, lastActive: lastActive(t, seen),
    duplicate: close.has(t.id) ? 'close' : keep.has(t.id) ? 'keep' : ''}));
}

async function closeTargets(targets) {
  if (targets.length) await chrome.tabs.remove(targets.map(t => t.id));
  return {ok: true, closed: targets.map(t => ({url: t.url || '', title: t.title || '',
    windowId: t.windowId, index: t.index}))};
}

// Re-check at close time: a tab used or changed since the page rendered is no longer a target.
function requestedIds(ids) {
  return new Set((Array.isArray(ids) ? ids : []).filter(Number.isInteger));
}

async function closeInactive(ids) {
  const requested = requestedIds(ids);
  return closeTargets((await inactiveList()).filter(t => requested.has(t.id)));
}

async function closeDuplicates(ids) {
  const requested = requestedIds(ids);
  const tabs = await openTabs();
  const {close} = duplicateTabs(tabs, seen);
  return closeTargets(tabs.filter(t => close.has(t.id) && requested.has(t.id)));
}

async function closeTab(id) {
  return closeTargets((await openTabs()).filter(t => t.id === id));
}

async function restoreClosed(items) {
  const windows = new Set((await chrome.windows.getAll({windowTypes: ['normal']})).map(w => w.id));
  const valid = (Array.isArray(items) ? items : []).filter(t => typeof t?.url === 'string' && t.url &&
    t.url.length <= 2 * 1024 * 1024 && Number.isInteger(t.index)).sort((a, b) => a.index - b.index);
  let restored = 0;
  for (const item of valid) {
    const target = windows.has(item.windowId) ? {windowId: item.windowId, index: item.index} : {};
    try { await chrome.tabs.create({...target, url: item.url, active: false}); restored += 1; }
    catch { /* Some internal pages cannot be reopened by extensions. */ }
  }
  return {ok: true, restored};
}

async function activate(tabId, token = '') {
  await ready;
  const started = performance.now();
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.incognito || !model.tabs.has(tabId) || (settings.scope === 'window' && tab.windowId !== focusedWindow))
      throw new Error('目标标签页不再位于最近列表');
    // Activate first, then focus its window. No navigation or page reload is requested.
    await chrome.tabs.update(tabId, {active: true});
    if (focusedWindow !== tab.windowId) await chrome.windows.update(tab.windowId, {focused: true});
    focusedWindow = tab.windowId;
    model.update(tab);
    model.touch(tabId);
    send({type: 'committed', token, tabId, elapsedMs: performance.now() - started});
    queuePublish();
    scheduleCapture();
    return {ok: true};
  } catch (error) {
    send({type: 'commit-error', token, message: String(error)});
    // Reconcile instead of making a closed card unexpectedly select a different tab.
    const tabs = await chrome.tabs.query({windowType: 'normal'});
    model.reconcile(tabs);
    queuePublish();
    return {ok: false, error: String(error)};
  }
}

chrome.tabs.onActivated.addListener(info => {
  const generation = (activationGenerations.get(info.windowId) || 0) + 1;
  activationGenerations.set(info.windowId, generation);
  invalidateCapture();
  void ready.then(async () => {
    const left = activeByWindow.get(info.windowId);
    if (Number.isInteger(left) && left !== info.tabId) seen[left] = Date.now();
    activeByWindow.set(info.windowId, info.tabId);
    const tab = await chrome.tabs.get(info.tabId).catch(() => null);
    if (activationGenerations.get(info.windowId) !== generation) return;
    if (!tab || tab.incognito || !model.tabs.has(info.tabId)) {
      if (tab && !tab.incognito) model.update(tab); else return;
    }
    model.update(tab);
    if (info.windowId === focusedWindow) model.touch(info.tabId);
    queuePublish(); scheduleCapture();
  });
});
chrome.windows.onFocusChanged.addListener(windowId => {
  const generation = ++focusGeneration;
  invalidateCapture();
  void ready.then(async () => {
    if (generation !== focusGeneration) return;
    if (windowId < 0) { profileFocused = false; queuePublish(); return; }
    const window = await chrome.windows.get(windowId).catch(() => null);
    if (generation !== focusGeneration) return;
    if (!window || window.type !== 'normal' || window.incognito) {
      profileFocused = false; queuePublish(); return;
    }
    profileFocused = true;
    focusedWindow = windowId;
    const [tab] = await chrome.tabs.query({windowId, active: true});
    if (generation !== focusGeneration) return;
    if (tab) { model.update(tab); model.touch(tab.id); }
    queuePublish(); scheduleCapture();
  });
});
chrome.tabs.onUpdated.addListener((id, changes, tab) => {
  void ready.then(() => {
    if (tab.incognito || !model.tabs.has(id)) return;
    model.update(tab);
    if (changes.url) {
      previews.delete(id);
      if (tab.active && tab.windowId === focusedWindow) invalidateCapture();
    }
    if (['url', 'title', 'audible', 'discarded', 'status'].some(k => k in changes)) queuePublish();
    if (tab.active && changes.status === 'complete') scheduleCapture();
  });
});
chrome.tabs.onCreated.addListener(tab => { void ready.then(() => {
  model.update(tab);
  if (tab.active && tab.windowId === focusedWindow) model.touch(tab.id);
  queuePublish(); scheduleCapture();
}); });
chrome.tabs.onRemoved.addListener(id => { void ready.then(() => {
  model.remove(id); previews.delete(id); delete seen[id]; queuePublish();
}); });
chrome.tabs.onAttached.addListener((id, info) => { void ready.then(async () => {
  const tab = await chrome.tabs.get(id).catch(() => null);
  if (tab) model.update(tab);
  queuePublish();
}); });
chrome.tabs.onReplaced.addListener((added, removed) => { void ready.then(async () => {
  const position = model.order.indexOf(removed);
  model.remove(removed); previews.delete(removed);
  if (removed in seen) { seen[added] = seen[removed]; delete seen[removed]; }
  for (const [windowId, id] of activeByWindow) if (id === removed) activeByWindow.set(windowId, added);
  const tab = await chrome.tabs.get(added).catch(() => null);
  if (tab) { model.update(tab); if (position >= 0) model.order.splice(position, 0, added); }
  queuePublish();
}); });

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Only packaged UI (popup or the inactive-tabs page) can invoke controls. No content scripts exist.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  void ready.then(async () => {
    if (message.type === 'state') {
      const tabs = await openTabs();
      respond({items: snapshot().items, settings, native: nativeState,
        inactiveCount: inactiveTabs(tabs, seen, Date.now()).length, duplicateCount: duplicateTabs(tabs, seen).close.size});
    }
    else if (message.type === 'inactive') respond({ok: true, now: Date.now(),
      items: (await inactiveList()).map(t => ({id: t.id, windowId: t.windowId, title: (t.title || '新标签页').slice(0, 500),
        url: (t.url || '').slice(0, 4096), lastActive: t.lastActive, discarded: !!t.discarded}))});
    else if (message.type === 'all-tabs') respond({ok: true, now: Date.now(), items: await allTabs()});
    else if (message.type === 'close-inactive') respond(await closeInactive(message.ids));
    else if (message.type === 'close-duplicates') respond(await closeDuplicates(message.ids));
    else if (message.type === 'close-tab') respond(await closeTab(message.id));
    else if (message.type === 'restore-closed') respond(await restoreClosed(message.items));
    else if (message.type === 'activate') respond(await activate(message.tabId));
    else if (message.type === 'settings') {
      invalidateCapture();
      settings = {scope: message.scope === 'window' ? 'window' : 'all', previews: message.previews !== false};
      if (!settings.previews) { previews.clear(); clearTimeout(captureTimer); }
      await chrome.storage.local.set({settings}); publish(); scheduleCapture(); respond({ok: true});
    } else if (message.type === 'reconnect') {
      nativePort?.disconnect(); nativePort = null; connectNative(); respond({ok: true});
    } else if (message.type === 'permission') { send({type: 'request-permission'}); respond({ok: true}); }
    else if (message.type === 'diagnostics') { send({type: 'diagnostics'}); respond({ok: true}); }
    else respond({ok: false});
  }).catch(error => respond({ok: false, error: String(error)}));
  return true;
});
