import {generateKeyPairSync, createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
const path = new URL('../extension/manifest.json', import.meta.url);
const existing = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
// A public key fixes the unpacked extension ID. No private key is stored or shipped.
const key = existing.key || generateKeyPairSync('rsa', {modulusLength: 2048}).publicKey.export({type: 'spki', format: 'der'}).toString('base64');
const id = [...createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16)]
  .map(b => String.fromCharCode(97 + (b >> 4), 97 + (b & 15))).join('');
const manifest = {
  manifest_version: 3, name: 'Seven · 最近标签切换', version: '1.5.0',
  description: 'Option+Tab 切换最近 7 个标签页，Command+Shift+C 复制当前网页链接，一键关闭 12 小时未访问的标签页和重复页。适用于 macOS Chrome，搭配 Seven 辅助程序。',
  minimum_chrome_version: '121', key,
  permissions: ['tabs', 'storage', 'nativeMessaging'],
  host_permissions: ['<all_urls>'],
  background: {service_worker: 'background.js', type: 'module'},
  action: {default_popup: 'popup.html', default_title: 'Seven · 最近 7 个标签页'},
  icons: {'128': 'icon128.png'}, incognito: 'not_allowed'
};
writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(new URL('../extension-id.txt', import.meta.url), id + '\n');
console.log('Extension ID: ' + id);
