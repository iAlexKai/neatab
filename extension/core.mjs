export const LIMIT = 7;

export function supportsCopyLink(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) return false;
  const [major, minor] = version.split('.').map(Number);
  return major > 1 || (major === 1 && minor >= 1);
}

export function supportsCopyToast(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) return false;
  const [major, minor] = version.split('.').map(Number);
  return major > 1 || (major === 1 && minor >= 2);
}

export class RecentTabs {
  constructor(saved = []) {
    this.order = saved.filter(Number.isInteger);
    this.tabs = new Map();
  }

  reconcile(tabs) {
    this.tabs = new Map(tabs.filter(t => t.id >= 0 && !t.incognito).map(t => [t.id, t]));
    this.order = this.order.filter(id => this.tabs.has(id));
    const untracked = [...this.tabs.values()].filter(t => !this.order.includes(t.id));
    untracked.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0) || a.index - b.index);
    this.order.push(...untracked.map(t => t.id));
    this.order = [...new Set(this.order)];
  }

  update(tab) {
    if (tab.incognito) return;
    this.tabs.set(tab.id, {...this.tabs.get(tab.id), ...tab});
  }

  touch(id) {
    if (!this.tabs.has(id)) return false;
    this.order = [id, ...this.order.filter(value => value !== id)];
    return true;
  }

  remove(id) {
    this.tabs.delete(id);
    this.order = this.order.filter(value => value !== id);
  }

  recent(scope = 'all', windowId) {
    return this.order.map(id => this.tabs.get(id)).filter(t => t &&
      (scope !== 'window' || t.windowId === windowId)).slice(0, LIMIT);
  }
}

// A switch session freezes order. Merely highlighting a card never changes MRU.
export function cycle(index, direction, length) {
  return length ? ((index + direction) % length + length) % length : 0;
}

export function safeURL(value) {
  try { return new URL(value).protocol; } catch { return ''; }
}

export function displayHost(url) {
  try { const u = new URL(url); return u.hostname || u.protocol.replace(':', ''); }
  catch { return ''; }
}

export const INACTIVE_HOURS = 12;
export const INACTIVE_MS = INACTIVE_HOURS * 3600000;

// Last time the user was on this tab: when it was last left, or Chrome's lastAccessed fallback.
export function lastActive(tab, seen = {}) {
  return Math.max(tab.lastAccessed || 0, seen[tab.id] || 0);
}

// Active, pinned and audible tabs are in use. Unknown activity time is never treated as stale.
export function inactiveTabs(tabs, seen, now, threshold = INACTIVE_MS) {
  return tabs.filter(t => t.id >= 0 && !t.incognito && !t.active && !t.pinned && !t.audible)
    .map(t => ({...t, lastActive: lastActive(t, seen)}))
    .filter(t => t.lastActive > 0 && now - t.lastActive >= threshold)
    .sort((a, b) => a.lastActive - b.lastActive || a.windowId - b.windowId || a.index - b.index);
}

// Idle buckets on the inactive view, oldest first. `min` is the bucket's lower bound.
export const IDLE_GROUPS = [
  {id: 'over48', label: '48 小时以上', min: 48 * 3600000},
  {id: 'h24to48', label: '24 – 48 小时', min: 24 * 3600000},
  {id: 'h12to24', label: '12 – 24 小时', min: INACTIVE_MS},
  {id: 'under12', label: '12 小时以内', min: 0}
];

export function idleGroup(ms) {
  return IDLE_GROUPS.find(group => ms >= group.min) || IDLE_GROUPS.at(-1);
}

export function idleLabel(ms) {
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return ms < 60000 ? '刚刚访问' : `${Math.floor(ms / 60000)} 分钟未访问`;
  if (hours < 24) return `${hours} 小时未访问`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days} 天未访问` : '超过 30 天未访问';
}

// Tabs with the identical full URL (query and # included). Per URL the most recently used tab is
// kept: one on screen first, then the latest activity. Pinned, audible or on-screen copies stay open.
export function duplicateTabs(tabs, seen = {}) {
  const groups = new Map();
  for (const tab of tabs) {
    if (tab.id < 0 || tab.incognito || !tab.url) continue;
    const group = groups.get(tab.url);
    if (group) group.push(tab); else groups.set(tab.url, [tab]);
  }
  const keep = new Set(), close = new Set();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [first, ...rest] = group.map(t => ({...t, lastActive: lastActive(t, seen)})).sort((a, b) =>
      (!!b.active - !!a.active) || (b.lastActive - a.lastActive) || (a.windowId - b.windowId) || (a.index - b.index));
    keep.add(first.id);
    for (const t of rest) (t.active || t.pinned || t.audible ? keep : close).add(t.id);
  }
  return {keep, close};
}
