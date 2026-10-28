import {displayHost, idleLabel} from './core.mjs';
const $ = id => document.getElementById(id);
const send = message => chrome.runtime.sendMessage(message);
let items = [];
let lastClosed = [];
let toastTimer;

async function refresh() {
  try {
    const result = await send({type: 'inactive'});
    if (!result?.ok) throw new Error('后台服务暂不可用，请刷新页面');
    items = result.items;
    const windows = [...new Set(items.map(t => t.windowId))];
    $('summary').textContent = items.length ? `${items.length} 个标签页超过 12 小时未访问` : '全部标签页都在使用中';
    $('close-all').disabled = !items.length;
    $('close-all').textContent = items.length ? `全部关闭 (${items.length})` : '全部关闭';
    $('empty').hidden = !!items.length;
    $('list').replaceChildren(...items.map(tab => row(tab, result.now, windows.length > 1 ? windows.indexOf(tab.windowId) + 1 : 0)));
    $('error').hidden = true;
  } catch (error) { showError(String(error)); }
}

function row(tab, now, windowNumber) {
  const li = document.createElement('li');
  const open = document.createElement('button'); open.className = 'tab'; open.title = tab.title;
  const letter = document.createElement('span'); letter.className = 'letter';
  letter.textContent = (displayHost(tab.url) || tab.title).slice(0, 1).toUpperCase();
  const info = document.createElement('span'); info.className = 'info';
  const title = document.createElement('span'); title.className = 'title'; title.textContent = tab.title;
  const host = document.createElement('span'); host.className = 'host';
  host.textContent = [displayHost(tab.url), windowNumber ? `窗口 ${windowNumber}` : ''].filter(Boolean).join(' · ');
  const idle = document.createElement('span'); idle.className = 'idle'; idle.textContent = idleLabel(now - tab.lastActive);
  info.append(title, host); open.append(letter, info, idle);
  open.addEventListener('click', async () => {
    try {
      await chrome.tabs.update(tab.id, {active: true});
      await chrome.windows.update(tab.windowId, {focused: true});
    } catch (error) { showError(String(error)); await refresh(); }
  });
  const close = document.createElement('button'); close.className = 'close';
  close.textContent = '×'; close.title = '关闭'; close.setAttribute('aria-label', `关闭 ${tab.title}`);
  close.addEventListener('click', () => closeTabs([tab.id]));
  li.append(open, close);
  return li;
}

async function closeTabs(ids) {
  try {
    const result = await send({type: 'close-inactive', ids});
    if (!result?.ok) throw new Error(result?.error || '关闭失败');
    if (result.closed.length) toast(result.closed);
    await refresh();
  } catch (error) { showError(String(error)); }
}

function toast(closed) {
  lastClosed = closed;
  $('toast-text').textContent = `已关闭 ${closed.length} 个标签页`;
  $('undo').hidden = false;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; lastClosed = []; }, 8000);
}

function showError(error) { $('error').textContent = error; $('error').hidden = false; }

$('close-all').addEventListener('click', () => closeTabs(items.map(t => t.id)));
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
