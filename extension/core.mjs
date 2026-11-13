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

// Time the user was away: screen locked, no input for a while, asleep, or Chrome not running.
// Intervals are [start, end] in ms, kept sorted and merged; ones older than AWAY_KEEP_MS are dropped.
export const AWAY_IDLE_SECONDS = 600;
export const AWAY_KEEP_MS = 60 * 24 * 3600000;

export function addAway(intervals, start, end, now = end) {
  if (!(end > start)) return intervals;
  const merged = [];
  for (const [s, e] of [...intervals, [start, end]].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged.filter(([, e]) => now - e < AWAY_KEEP_MS);
}

export function awayTime(intervals, from, to) {
  let total = 0;
  for (const [s, e] of intervals) total += Math.max(0, Math.min(e, to) - Math.max(s, from));
  return total;
}

// Active, pinned and audible tabs are in use. Unknown activity time is never treated as stale.
// `idle` counts only time the user was at the computer: a weekend away does not age every tab.
export function inactiveTabs(tabs, seen, now, threshold = INACTIVE_MS, away = []) {
  return tabs.filter(t => t.id >= 0 && !t.incognito && !t.active && !t.pinned && !t.audible)
    .map(t => ({...t, lastActive: lastActive(t, seen)}))
    .filter(t => t.lastActive > 0)
    .map(t => ({...t, idle: now - t.lastActive - awayTime(away, t.lastActive, now)}))
    .filter(t => t.idle >= threshold)
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

// One window's tabs in tab-strip order, split into runs of the same Chrome tab group.
// Ungrouped tabs form runs with a null group.
export function tabSections(tabs, groups = []) {
  const known = new Map(groups.map(group => [group.id, group]));
  const sections = [];
  for (const tab of [...tabs].sort((a, b) => a.index - b.index)) {
    const id = tab.groupId >= 0 ? tab.groupId : -1;
    const last = sections.at(-1);
    if (last?.id === id) last.tabs.push(tab);
    else sections.push({id, group: id < 0 ? null : known.get(id) || {id}, tabs: [tab]});
  }
  return sections;
}

// Memory release: tabs unused this long are discarded. The user picks one of these, in minutes.
export const DISCARD_CHOICES = [30, 60, 120, 360];
export const DISCARD_MINUTES = 60;
export const DISCARD_MS = DISCARD_MINUTES * 60000;
// Under macOS memory pressure, tabs unused this long go too, oldest first.
export const PRESSURE_IDLE_MS = {warning: 15 * 60000, critical: 5 * 60000};

// Tabs whose memory can be released: idle long enough, not on screen, not playing sound, still loaded.
// Pinned tabs count too. `fresh` holds tabs restored at browser start and not opened since:
// the user has not touched them, so they go regardless of idle time.
export function discardCandidates(tabs, seen, now, threshold = DISCARD_MS, fresh = new Set()) {
  return tabs.filter(t => t.id >= 0 && !t.incognito && !t.active && !t.audible && !t.discarded && t.status !== 'unloaded')
    .map(t => ({...t, lastActive: lastActive(t, seen)}))
    .filter(t => fresh.has(t.id) || (t.lastActive > 0 && now - t.lastActive >= threshold))
    .sort((a, b) => a.lastActive - b.lastActive);
}

// Runs in the page (main world, every frame): would closing it now show Chrome's "Leave site?"
// dialog? Dispatches a synthetic beforeunload so the page's own handlers decide, exactly as on a
// real close, without closing anything. Chrome only shows that dialog after the user interacted.
export function wouldPromptOnLeave() {
  if (!navigator.userActivation?.hasBeenActive) return false;
  const event = document.createEvent('BeforeUnloadEvent');
  event.initEvent('beforeunload', false, true);
  window.dispatchEvent(event);
  return event.defaultPrevented || !!event.returnValue;
}
