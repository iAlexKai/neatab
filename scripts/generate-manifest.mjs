import {generateKeyPairSync, createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
const path = new URL('../extension/manifest.json', import.meta.url);
const existing = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
// A public key fixes the unpacked extension ID. No private key is stored or shipped.
const key = existing.key || generateKeyPairSync('rsa', {modulusLength: 2048}).publicKey.export({type: 'spki', format: 'der'}).toString('base64');
const id = [...createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16)]
  .map(b => String.fromCharCode(97 + (b >> 4), 97 + (b & 15))).join('');
const manifest = {
  manifest_version: 3, name: 'Neatab · 最近标签切换与整理', version: '2.7.0',
  description: '在 Chrome 中获得 Arc 最核心的标签体验：Option+Tab 切换最近标签页，一键关闭重复页和不活跃标签页。',
  minimum_chrome_version: '121', key,
  permissions: ['tabs', 'tabGroups', 'idle', 'storage', 'nativeMessaging', 'alarms', 'scripting'],
  host_permissions: ['<all_urls>'],
  background: {service_worker: 'background.js', type: 'module'},
  action: {default_popup: 'popup.html', default_title: 'Neatab',
    default_icon: {'16': 'icon16.png', '48': 'icon48.png', '128': 'icon128.png'}},
  icons: {'16': 'icon16.png', '48': 'icon48.png', '128': 'icon128.png'}, incognito: 'not_allowed'
};
writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(new URL('../extension-id.txt', import.meta.url), id + '\n');
console.log('Extension ID: ' + id);
