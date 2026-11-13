import {displayHost, supportsCopyToast} from './core.mjs';
const $ = id => document.getElementById(id);
const send = message => chrome.runtime.sendMessage(message);
let initial = true;
const extensionVersion = chrome.runtime.getManifest().version;
const HELPER_URL = 'https://github.com/iAlexKai/neatab#install';

async function refresh() {
  try {
    const {items, settings, native, inactiveCount, duplicateCount, discardSummary} = await send({type: 'state'});
    if (!items) throw new Error('后台服务暂不可用，请重新打开扩展');
    const outdated = native.connected && !supportsCopyToast(native.version);
    const usable = native.connected && native.trusted && !outdated;
    $('dot').classList.toggle('ready', usable);
    $('status').textContent = outdated ? '辅助程序需要更新' : usable ? '已就绪 · Option + Tab' : native.connected ? '还差一步：开启辅助功能' : '等待本机辅助程序';
    const versions = `扩展 ${extensionVersion} · 辅助程序 ${native.version || '未连接'}`;
    $('detail').textContent = `${versions}。${outdated ? '复制成功提示需要辅助程序 1.2.0 或更新版本' : usable ? '⌘ ⇧ C 复制链接并显示确认提示' : native.connected ? '请开启辅助功能权限' : 'Option + Tab 与 ⌘ ⇧ C 需要 macOS 辅助程序'}`;
    $('setup').hidden = usable;
    $('setup-text').textContent = outdated ? '请下载新版辅助程序并运行「安装 Neatab.command」，然后点击重新连接。' : native.connected ? '在系统设置的辅助功能中允许 ~/Applications/Neatab.app。升级后仍未授权时，先移除旧 Neatab，再用 + 添加该应用并开启。' : '下载并运行免费的 Neatab 辅助程序安装包，然后点击重新连接，无需重启 Chrome。标签整理功能不需要辅助程序。';
    $('permission').hidden = !native.connected || outdated;
    $('download').hidden = native.connected && !outdated;
    $('metrics').disabled = !usable;
    if (initial) {
      $('scope').value = settings.scope; $('previews').checked = settings.previews;
      $('auto-discard').checked = settings.autoDiscard !== false;
      $('discard-after').value = String(settings.discardAfter); initial = false;
    }
    $('discard-after').disabled = !$('auto-discard').checked;
    if (discardSummary?.time) $('discard-detail').textContent = discardText(discardSummary);
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
const TRIGGERS = {idle: '定时检查', startup: '启动后', pressure: '内存紧张时'};
function discardText({discarded, prompted, unchecked, trigger}) {
  const skipped = [prompted ? `${prompted} 个会提示离开` : '', unchecked ? `${unchecked} 个无法检查` : ''].filter(Boolean);
  return `${TRIGGERS[trigger] || '上次'}释放 ${discarded} 个` + (skipped.length ? `；跳过 ${skipped.join('、')}` : '') + '。点开时重新加载';
}
function showError(error) { $('error').textContent = error; $('error').hidden = false; }
async function save() {
  await send({type: 'settings', scope: $('scope').value, previews: $('previews').checked,
    autoDiscard: $('auto-discard').checked, discardAfter: Number($('discard-after').value)});
  await refresh();
}
$('scope').addEventListener('change', save);
$('previews').addEventListener('change', save);
$('auto-discard').addEventListener('change', save);
$('discard-after').addEventListener('change', save);
$('permission').addEventListener('click', () => send({type: 'permission'}));
$('download').addEventListener('click', () => chrome.tabs.create({url: HELPER_URL}));
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
