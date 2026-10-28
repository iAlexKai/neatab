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

export function idleLabel(ms) {
  const hours = Math.floor(ms / 3600000);
  if (hours < 24) return `${hours} 小时未访问`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days} 天未访问` : '超过 30 天未访问';
}
