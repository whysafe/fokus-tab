// Настройки хранятся в chrome.storage.sync и приводятся к безопасному виду при каждом чтении.

import { normalizeDomain } from './domains.js';
import { isWithinSchedule, msUntilScheduleEnd, parseTime } from './schedule.js';
import { remaining } from './timer.js';

export const DEFAULT_SETTINGS = Object.freeze({
  blocklist: ['youtube.com', 'vk.com', 'instagram.com', 'tiktok.com', 'x.com', 'reddit.com', 'twitch.tv', 'dzen.ru'],
  workMin: 25,
  breakMin: 5,
  longBreakMin: 15,
  longEvery: 4,
  autoBreak: true,
  schedule: { enabled: false, days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
  allowMinutes: 5,
  allowLimit: 3,
  minutesPerDistraction: 5,
});

function int(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function withDefaults(raw) {
  const d = DEFAULT_SETTINGS;
  const r = raw && typeof raw === 'object' ? raw : {};
  const list = Array.isArray(r.blocklist) ? r.blocklist : d.blocklist;
  const blocklist = [...new Set(list.map(normalizeDomain).filter(Boolean))];
  const s = r.schedule && typeof r.schedule === 'object' ? r.schedule : {};
  const days = Array.isArray(s.days)
    ? [...new Set(s.days.map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort()
    : [...d.schedule.days];
  return {
    blocklist,
    workMin: int(r.workMin, 1, 180, d.workMin),
    breakMin: int(r.breakMin, 1, 60, d.breakMin),
    longBreakMin: int(r.longBreakMin, 1, 90, d.longBreakMin),
    longEvery: int(r.longEvery, 1, 12, d.longEvery),
    autoBreak: typeof r.autoBreak === 'boolean' ? r.autoBreak : d.autoBreak,
    schedule: {
      enabled: Boolean(s.enabled),
      days,
      start: Number.isNaN(parseTime(s.start)) ? d.schedule.start : s.start,
      end: Number.isNaN(parseTime(s.end)) ? d.schedule.end : s.end,
    },
    allowMinutes: int(r.allowMinutes, 1, 30, d.allowMinutes),
    allowLimit: int(r.allowLimit, 0, 20, d.allowLimit),
    minutesPerDistraction: int(r.minutesPerDistraction, 1, 60, d.minutesPerDistraction),
  };
}

/** Блокировка включена во время рабочей фазы таймера (в том числе на паузе) или по расписанию. */
export function isBlockingActive(timer, schedule, date) {
  return timer.phase === 'work' || isWithinSchedule(schedule, date);
}

/** Сколько ещё продлится блокировка: берётся самый поздний конец из таймера и расписания. */
export function blockingRemainingMs(timer, schedule, date) {
  const fromTimer = timer.phase === 'work' ? remaining(timer, date.getTime()) : 0;
  return Math.max(fromTimer, msUntilScheduleEnd(schedule, date));
}
