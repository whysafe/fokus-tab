// Service worker: держит таймер, правила блокировки, бейдж и статистику.
// Состояние живёт в chrome.storage, потому что воркер может быть выгружен в любой момент.

import { activeSites, allowLeft, grant, nextExpiry, normalizeAllow, pruneExpired } from './lib/allow.js';
import { buildRules, findMatch, normalizeDomain } from './lib/domains.js';
import { blockingRemainingMs, isBlockingActive, withDefaults } from './lib/settings.js';
import { dayKey, emptyDay, prune, recordBlock, recordFocus } from './lib/stats.js';
import { msUntilScheduleEnd } from './lib/schedule.js';
import * as timer from './lib/timer.js';

const BLOCKED_PAGE = chrome.runtime.getURL('blocked.html');
const BADGE_COLORS = { work: '#6E56CF', break: '#30A46C', schedule: '#6E56CF' };

// Обработчики сообщений и будильников выполняются строго по очереди, чтобы не затирать состояние друг друга.
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

async function load(now) {
  const [{ settings }, local] = await Promise.all([
    chrome.storage.sync.get('settings'),
    chrome.storage.local.get(['timer', 'allow', 'stats', 'wasBlocking']),
  ]);
  const today = dayKey(new Date(now));
  return {
    settings: withDefaults(settings),
    timer: { ...timer.IDLE, ...local.timer },
    allow: pruneExpired(normalizeAllow(local.allow, today), now),
    stats: local.stats ?? {},
    wasBlocking: Boolean(local.wasBlocking),
  };
}

function save(ctx) {
  return chrome.storage.local.set({ timer: ctx.timer, allow: ctx.allow, stats: ctx.stats, wasBlocking: ctx.wasBlocking });
}

function notify(title, message) {
  chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 1 });
}

function addFocus(ctx, minutes, completed, now) {
  ctx.stats = prune(recordFocus(ctx.stats, new Date(now), minutes, completed), new Date(now));
}

// Если фаза истекла, пока воркер спал, завершаем её сейчас.
function advanceTimer(ctx, now) {
  if (!timer.isRunning(ctx.timer) || timer.remaining(ctx.timer, now) > 0) return;
  const result = timer.finishPhase(ctx.timer, ctx.settings, now);
  addFocus(ctx, result.focusMin, result.completed, now);
  if (result.event === 'work-done') {
    ctx.timer = ctx.settings.autoBreak ? result.state : { ...timer.IDLE, completed: result.state.completed };
    const what = result.state.longBreak ? 'длинный перерыв' : 'перерыв';
    notify('Помидор готов', ctx.settings.autoBreak ? `Отличная работа. Начался ${what}.` : 'Отличная работа. Время отдохнуть.');
  } else if (result.event === 'break-done') {
    ctx.timer = result.state;
    notify('Перерыв окончен', 'Можно начинать следующий помидор.');
  }
}

async function syncRules(domains) {
  const rules = buildRules(domains, BLOCKED_PAGE);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  if (JSON.stringify(existing.map(({ id, priority, action, condition }) => ({ id, priority, action, condition }))) === JSON.stringify(rules)) return;
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing.map((r) => r.id), addRules: rules });
}

// Уже открытые вкладки с запрещёнными сайтами уводим на страницу блокировки в момент включения фокуса.
async function blockOpenTabs(domains) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map((tab) => {
      if (!tab.url || !/^https?:/.test(tab.url)) return null;
      const site = findMatch(new URL(tab.url).hostname, domains);
      if (!site) return null;
      return chrome.tabs.update(tab.id, { url: `${BLOCKED_PAGE}?site=${encodeURIComponent(site)}#${tab.url}` }).catch(() => {});
    }),
  );
}

async function updateBadge(ctx, now, blocking) {
  let text = timer.badgeText(ctx.timer, now);
  let color = BADGE_COLORS[ctx.timer.phase];
  if (!text && blocking) {
    text = 'on';
    color = BADGE_COLORS.schedule;
  }
  await chrome.action.setBadgeText({ text });
  if (color) await chrome.action.setBadgeBackgroundColor({ color });
  const title = blocking ? 'Фокус-вкладка: блокировка включена' : 'Фокус-вкладка';
  await chrome.action.setTitle({ title });
}

async function scheduleAlarms(ctx, now) {
  if (timer.isRunning(ctx.timer)) await chrome.alarms.create('phase', { when: ctx.timer.endsAt });
  else await chrome.alarms.clear('phase');
  const expiry = nextExpiry(ctx.allow, now);
  if (expiry) await chrome.alarms.create('allow', { when: expiry + 500 });
  else await chrome.alarms.clear('allow');
  // Конец интервала расписания: правила снимаются точно вовремя, а не на следующем тике.
  const scheduleLeft = msUntilScheduleEnd(ctx.settings.schedule, new Date(now));
  if (scheduleLeft > 0) await chrome.alarms.create('schedule', { when: now + scheduleLeft + 500 });
  else await chrome.alarms.clear('schedule');
}

async function apply(ctx, now) {
  advanceTimer(ctx, now);
  ctx.allow = pruneExpired(ctx.allow, now);
  const date = new Date(now);
  const blocking = isBlockingActive(ctx.timer, ctx.settings.schedule, date);
  const allowed = new Set(activeSites(ctx.allow, now));
  const domains = blocking ? ctx.settings.blocklist.filter((d) => !allowed.has(d)) : [];
  await syncRules(domains);
  if (blocking && !ctx.wasBlocking) await blockOpenTabs(domains);
  ctx.wasBlocking = blocking;
  await updateBadge(ctx, now, blocking);
  await scheduleAlarms(ctx, now);
  await save(ctx);
  return blocking;
}

function snapshot(ctx, now, blocking) {
  const date = new Date(now);
  return {
    now,
    timer: ctx.timer,
    remainingMs: timer.remaining(ctx.timer, now),
    blocking,
    blockingRemainingMs: blocking ? blockingRemainingMs(ctx.timer, ctx.settings.schedule, date) : 0,
    settings: ctx.settings,
    allowLeft: allowLeft(ctx.allow, ctx.settings.allowLimit),
    allowedSites: activeSites(ctx.allow, now).map((site) => ({ site, until: ctx.allow.until[site] })),
    today: ctx.stats[dayKey(date)] ?? emptyDay(),
  };
}

async function handle(msg) {
  const now = Date.now();
  const ctx = await load(now);
  const extra = {};
  switch (msg?.type) {
    case 'start':
      ctx.timer = timer.startWork(ctx.timer, ctx.settings, now);
      break;
    case 'pause':
      ctx.timer = timer.pause(ctx.timer, now);
      break;
    case 'resume':
      ctx.timer = timer.resume(ctx.timer, now);
      break;
    case 'skip': {
      const result = timer.finishPhase(timer.resume(ctx.timer, now), ctx.settings, now);
      addFocus(ctx, result.focusMin, result.completed, now);
      ctx.timer = result.state;
      break;
    }
    case 'stop': {
      const result = timer.stop(ctx.timer, now);
      addFocus(ctx, result.focusMin, false, now);
      ctx.timer = result.state;
      break;
    }
    case 'blocked':
      if (msg.site && !msg.reload) ctx.stats = recordBlock(ctx.stats, new Date(now), msg.site);
      break;
    case 'allow': {
      const result = grant(ctx.allow, msg.site, now, ctx.settings);
      ctx.allow = result.allow;
      Object.assign(extra, { ok: result.ok, reason: result.reason ?? null, until: result.until ?? null });
      break;
    }
    case 'addSite': {
      const site = normalizeDomain(msg.site);
      if (!site) return { error: 'invalid-site' };
      if (!ctx.settings.blocklist.includes(site)) {
        ctx.settings = { ...ctx.settings, blocklist: [...ctx.settings.blocklist, site] };
        await chrome.storage.sync.set({ settings: ctx.settings });
      }
      extra.site = site;
      break;
    }
    case 'resetStats':
      ctx.stats = {};
      break;
    case 'state':
      break;
    default:
      return { error: 'unknown-message' };
  }
  const blocking = await apply(ctx, now);
  return { ...snapshot(ctx, now, blocking), ...extra };
}

async function refresh() {
  const now = Date.now();
  await apply(await load(now), now);
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    const { settings } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({ settings: withDefaults(settings) });
  }
  await chrome.alarms.create('tick', { periodInMinutes: 0.5 });
  serial(refresh);
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create('tick', { periodInMinutes: 0.5 });
  serial(refresh);
});

chrome.alarms.onAlarm.addListener(() => serial(refresh));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) serial(refresh);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  serial(() => handle(msg)).then(sendResponse, (err) => sendResponse({ error: String(err?.message ?? err) }));
  return true;
});

export { handle, refresh, serial };
