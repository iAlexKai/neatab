import {displayHost, idleLabel} from './core.mjs';
const $ = id => document.getElementById(id);
const send = message => chrome.runtime.sendMessage(message);
const VIEWS = {
  all: {heading: '所有标签页', note: '按窗口和标签栏顺序列出当前打开的标签页。地址完全相同的视为重复，只保留最近活跃的一个；正在显示、已固定或正在播放声音的不会被关闭。',
    emptyTitle: '没有打开的标签页', emptyText: ''},
  inactive: {heading: '不活跃标签页', note: '超过 12 小时没有切换到的标签页。正在显示、已固定或正在播放声音的标签页不会列出。',
    emptyTitle: '没有闲置的标签页', emptyText: '最近 12 小时内访问过所有打开的标签页。'}
};
let view = location.hash === '#inactive' ? 'inactive' : 'all';
let state = {all: [], inactive: [], now: Date.now()};
let lastClosed = [];
let toastTimer;

async function refresh() {
  try {
    const [all, inactive] = await Promise.all([send({type: 'all-tabs'}), send({type: 'inactive'})]);
    if (!all?.ok || !inactive?.ok) throw new Error('后台服务暂不可用，请刷新页面');
    state = {all: all.items, inactive: inactive.items, now: all.now};
    render();
    $('error').hidden = true;
  } catch (error) { showError(String(error)); }
}

function render() {
  const duplicates = state.all.filter(t => t.duplicate === 'close');
  const windows = [...new Set(state.all.map(t => t.windowId))];
  const number = id => windows.length > 1 ? windows.indexOf(id) + 1 : 0;
  $('all-count').textContent = state.all.length;
  $('inactive-count').textContent = state.inactive.length;
  for (const name of Object.keys(VIEWS)) $('view-' + name).setAttribute('aria-selected', String(name === view));
  const copy = VIEWS[view];
  $('heading').textContent = copy.heading;
  $('note').textContent = copy.note;
  $('empty-title').textContent = copy.emptyTitle;
  $('empty-text').textContent = copy.emptyText;
  const items = view === 'all' ? state.all : state.inactive;
  const targets = view === 'all' ? duplicates : state.inactive;
  $('summary').textContent = view === 'all'
    ? `${state.all.length} 个标签页${windows.length > 1 ? `，${windows.length} 个窗口` : ''} · ${duplicates.length ? `${duplicates.length} 个重复` : '没有重复'}`
    : items.length ? `${items.length} 个标签页超过 12 小时未访问` : '全部标签页都在使用中';
  const label = view === 'all' ? '关闭重复页' : '全部关闭';
  $('primary').textContent = targets.length ? `${label} (${targets.length})` : label;
  $('primary').disabled = !targets.length;
  $('empty').hidden = !!items.length;
  if (view === 'all') {
    $('list').replaceChildren(...windows.map(id => {
      const group = state.all.filter(t => t.windowId === id).sort((a, b) => a.index - b.index);
      const section = document.createElement('section');
      if (windows.length > 1) {
        const title = document.createElement('h2');
        title.textContent = `窗口 ${number(id)} · ${group.length} 个`;
        section.append(title);
      }
      const ul = document.createElement('ul');
      ul.append(...group.map(tab => row(tab, tagFor(tab), 'close-tab')));
      section.append(ul);
      return section;
    }));
  } else {
    const ul = document.createElement('ul');
    ul.append(...items.map(tab => row(tab, {text: idleLabel(state.now - tab.lastActive)}, 'close-inactive',
      number(tab.windowId))));
    $('list').replaceChildren(ul);
  }
}

function tagFor(tab) {
  if (tab.duplicate === 'close') return {text: '重复 · 将关闭', kind: 'duplicate'};
  if (tab.duplicate === 'keep') return {text: '重复 · 保留', kind: 'keep'};
  if (tab.active) return {text: '当前', kind: ''};
  return null;
}

function row(tab, tag, closeType, windowNumber = 0) {
  const li = document.createElement('li');
  if (tag?.kind) li.className = tag.kind;
  const open = document.createElement('button'); open.className = 'tab'; open.title = tab.title;
  const letter = document.createElement('span'); letter.className = 'letter';
  letter.textContent = (displayHost(tab.url) || tab.title).slice(0, 1).toUpperCase();
  const info = document.createElement('span'); info.className = 'info';
  const title = document.createElement('span'); title.className = 'title'; title.textContent = tab.title;
  const host = document.createElement('span'); host.className = 'host';
  host.textContent = [displayHost(tab.url), tab.pinned ? '已固定' : '', windowNumber ? `窗口 ${windowNumber}` : '']
    .filter(Boolean).join(' · ');
  info.append(title, host); open.append(letter, info);
  if (tag) {
    const label = document.createElement('span'); label.className = 'tag'; label.textContent = tag.text;
    open.append(label);
  }
  open.addEventListener('click', async () => {
    try {
      await chrome.tabs.update(tab.id, {active: true});
      await chrome.windows.update(tab.windowId, {focused: true});
    } catch (error) { showError(String(error)); await refresh(); }
  });
  const close = document.createElement('button'); close.className = 'close';
  close.textContent = '×'; close.title = '关闭'; close.setAttribute('aria-label', `关闭 ${tab.title}`);
  close.addEventListener('click', () => closeTabs(closeType === 'close-tab' ? {type: closeType, id: tab.id}
    : {type: closeType, ids: [tab.id]}));
  li.append(open, close);
  return li;
}

async function closeTabs(message) {
  try {
    const result = await send(message);
    if (!result?.ok) throw new Error(result?.error || '关闭失败');
    if (result.closed.length) toast(result.closed);
    await refresh();
  } catch (error) { showError(String(error)); }
}

function toast(closed) {
  lastClosed = closed;
  $('toast-text').textContent = `已关闭 ${closed.length} 个标签页`;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; lastClosed = []; }, 8000);
}

function showError(error) { $('error').textContent = error; $('error').hidden = false; }

for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => {
  view = button.dataset.view;
  history.replaceState(null, '', '#' + view);
  render();
});
window.addEventListener('hashchange', () => { view = location.hash === '#inactive' ? 'inactive' : 'all'; render(); });
$('primary').addEventListener('click', () => view === 'all'
  ? closeTabs({type: 'close-duplicates', ids: state.all.filter(t => t.duplicate === 'close').map(t => t.id)})
  : closeTabs({type: 'close-inactive', ids: state.inactive.map(t => t.id)}));
$('undo').addEventListener('click', async () => {
  const pending = lastClosed; lastClosed = [];
  clearTimeout(toastTimer); $('toast').hidden = true;
  if (!pending.length) return;
  const result = await send({type: 'restore-closed', items: pending});
  if (result?.restored < pending.length) showError(`${pending.length - result.restored} 个内部页面无法由扩展重新打开`);
  await refresh();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
await refresh();
setInterval(refresh, 30000);
