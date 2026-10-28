import {displayHost, supportsCopyToast} from './core.mjs';
const $ = id => document.getElementById(id);
const send = message => chrome.runtime.sendMessage(message);
let initial = true;
const extensionVersion = chrome.runtime.getManifest().version;

async function refresh() {
  try {
    const {items, settings, native, inactiveCount, duplicateCount} = await send({type: 'state'});
    if (!items) throw new Error('后台服务暂不可用，请重新打开扩展');
    const outdated = native.connected && !supportsCopyToast(native.version);
    const usable = native.connected && native.trusted && !outdated;
    $('dot').classList.toggle('ready', usable);
    $('status').textContent = outdated ? '辅助程序需要更新' : usable ? '已就绪 · Option + Tab' : native.connected ? '还差一步：开启辅助功能' : '等待本机辅助程序';
    const versions = `扩展 ${extensionVersion} · 辅助程序 ${native.version || '未连接'}`;
    $('detail').textContent = `${versions}。${outdated ? '复制成功提示需要辅助程序 1.2.0 或更新版本' : usable ? '⌘ ⇧ C 复制链接并显示确认提示' : native.connected ? '请开启辅助功能权限' : '请运行交付包中的安装脚本'}`;
    $('setup').hidden = usable;
    $('setup-text').textContent = outdated ? '请运行新版「安装 Seven.command」，更新 Seven.app 后点击重新连接。仅重新加载扩展不会更新辅助程序。' : native.connected ? '在系统设置的辅助功能中允许 ~/Applications/Seven.app。升级后仍未授权时，先移除旧 Seven，再用 + 添加该应用并开启。' : '安装辅助程序后点击重新连接。无需重启 Chrome。';
    $('permission').hidden = !native.connected || outdated;
    $('metrics').disabled = !usable;
    if (initial) { $('scope').value = settings.scope; $('previews').checked = settings.previews; initial = false; }
    $('inactive-count').textContent = String(inactiveCount ?? 0);
    $('inactive-count').classList.toggle('zero', !inactiveCount);
    $('duplicate-count').textContent = duplicateCount ? `${duplicateCount} 个重复` : '无重复';
    $('duplicate-count').classList.toggle('zero', !duplicateCount);
    $('tab-count').textContent = `${items.length} / 7`;
    $('empty').hidden = !!items.length;
    const rows = items.map((tab, i) => {
      const row = document.createElement('button'); row.className = 'tab';
      const letter = document.createElement('span'); letter.className = 'letter';
      letter.textContent = (displayHost(tab.url) || tab.title).slice(0, 1).toUpperCase();
      const info = document.createElement('span'); info.className = 'info';
      const title = document.createElement('span'); title.className = 'title'; title.textContent = tab.title;
      const host = document.createElement('span'); host.className = 'host'; host.textContent = displayHost(tab.url);
      const index = document.createElement('span'); index.className = 'index'; index.textContent = i === 0 ? '当前' : String(i + 1);
      info.append(title, host); row.append(letter, info, index);
      row.title = tab.title;
      row.addEventListener('click', async () => {
        const result = await send({type: 'activate', tabId: tab.id});
        if (result.ok) window.close(); else showError(result.error);
      });
      return row;
    });
    $('tabs').replaceChildren(...rows);
  } catch (error) { showError(String(error)); }
}
function showError(error) { $('error').textContent = error; $('error').hidden = false; }
async function save() {
  await send({type: 'settings', scope: $('scope').value, previews: $('previews').checked});
  await refresh();
}
$('scope').addEventListener('change', save);
$('previews').addEventListener('change', save);
$('permission').addEventListener('click', () => send({type: 'permission'}));
$('reconnect').addEventListener('click', async () => { await send({type: 'reconnect'}); await refresh(); });
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', async () => {
  const page = chrome.runtime.getURL('tabs.html');
  const url = `${page}#${button.dataset.view}`;
  // Match patterns cannot target chrome-extension:// pages, so filter instead of tabs.query({url}).
  const existing = (await chrome.tabs.query({})).find(t => t.url?.startsWith(page));
  if (existing) {
    await chrome.tabs.update(existing.id, {active: true, url});
    await chrome.windows.update(existing.windowId, {focused: true});
  } else await chrome.tabs.create({url});
  window.close();
});
$('metrics').addEventListener('click', () => send({type: 'diagnostics'}));
await refresh();
setInterval(refresh, 2000);
