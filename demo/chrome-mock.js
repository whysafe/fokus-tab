// Minimal in-page stand-in for the chrome.* APIs the extension uses, so the real
// popup, options page, block page and service worker logic run on a plain web page.
// Storage lives in localStorage; the "service worker" runs in the same page.

const PREFIX = 'fokus-demo:';
const listeners = { message: [], installed: [], startup: [], alarm: [], storage: [] };
const timers = new Map();
let dynamicRules = [];

function read(area) {
  try {
    return JSON.parse(localStorage.getItem(PREFIX + area)) ?? {};
  } catch {
    return {};
  }
}

function write(area, data) {
  try {
    localStorage.setItem(PREFIX + area, JSON.stringify(data));
  } catch {
    // private mode: the demo still works for this page view
  }
}

const memory = { sync: read('sync'), local: read('local') };

function storageArea(area) {
  return {
    async get(keys) {
      const all = structuredClone(memory[area]);
      if (keys == null) return all;
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in all).map((k) => [k, all[k]]));
    },
    async set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: memory[area][k], newValue: structuredClone(v) };
        memory[area][k] = structuredClone(v);
      }
      write(area, memory[area]);
      queueMicrotask(() => listeners.storage.forEach((fn) => fn(changes, area)));
    },
  };
}

const base = new URL('../extension/', import.meta.url);
const noop = async () => {};

globalThis.chrome = {
  runtime: {
    getURL: (path) => new URL(path, base).href,
    onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
    onStartup: { addListener: (fn) => listeners.startup.push(fn) },
    onMessage: { addListener: (fn) => listeners.message.push(fn) },
    sendMessage(msg) {
      return new Promise((resolve) => {
        for (const fn of listeners.message) fn(structuredClone(msg), {}, resolve);
      });
    },
    openOptionsPage: () => { location.href = 'view.html?page=options'; },
  },
  storage: {
    sync: storageArea('sync'),
    local: storageArea('local'),
    onChanged: { addListener: (fn) => listeners.storage.push(fn) },
  },
  alarms: {
    async create(name, info) {
      clearTimeout(timers.get(name));
      const delay = info.when ? info.when - Date.now() : info.periodInMinutes * 60_000;
      const fire = () => {
        listeners.alarm.forEach((fn) => fn({ name }));
        if (info.periodInMinutes) timers.set(name, setTimeout(fire, info.periodInMinutes * 60_000));
      };
      timers.set(name, setTimeout(fire, Math.max(0, delay)));
    },
    async clear(name) {
      clearTimeout(timers.get(name));
      timers.delete(name);
    },
    onAlarm: { addListener: (fn) => listeners.alarm.push(fn) },
  },
  declarativeNetRequest: {
    getDynamicRules: async () => structuredClone(dynamicRules),
    async updateDynamicRules({ removeRuleIds = [], addRules = [] }) {
      dynamicRules = dynamicRules.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules);
    },
  },
  tabs: {
    query: async () => [{ id: 1, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', active: true }],
    update: noop,
    getCurrent: async () => null,
    remove: noop,
  },
  action: { setBadgeText: noop, setBadgeBackgroundColor: noop, setTitle: noop },
  notifications: { create: noop },
};

/** Seven days of plausible history so the statistics page is not empty on first open. */
export function seedDemoData(now = new Date()) {
  if (memory.local.stats) return;
  const focus = [95, 140, 60, 175, 120, 30, 70];
  const blocked = [6, 3, 9, 2, 4, 11, 5];
  const sites = ['youtube.com', 'vk.com', 'reddit.com', 'x.com', 'twitch.tv'];
  const stats = {};
  focus.forEach((min, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (focus.length - 1 - i));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const daySites = {};
    for (let n = 0; n < blocked[i]; n++) {
      const s = sites[(n * 3 + i) % (n % 2 ? 2 : sites.length)];
      daySites[s] = (daySites[s] ?? 0) + 1;
    }
    stats[key] = { focusMin: min, blocked: blocked[i], sessions: Math.floor(min / 25), sites: daySites };
  });
  memory.local.stats = stats;
  write('local', memory.local);
}

export async function boot() {
  for (const fn of listeners.installed) await fn({ reason: 'install' });
}
