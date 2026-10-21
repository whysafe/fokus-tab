import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeSites, allowLeft, grant, nextExpiry, normalizeAllow } from '../extension/lib/allow.js';
import { DEFAULT_SETTINGS, blockingRemainingMs, isBlockingActive, withDefaults } from '../extension/lib/settings.js';
import { dayKey, formatMinutes, lastDays, prune, recordBlock, recordFocus, summarize } from '../extension/lib/stats.js';
import { IDLE, startWork } from '../extension/lib/timer.js';

const MIN = 60_000;
const opts = { allowMinutes: 5, allowLimit: 2 };

test('allowance: grants, re-uses an open window and stops at the daily limit', () => {
  let allow = normalizeAllow(undefined, '2026-10-21');
  let r = grant(allow, 'youtube.com', 0, opts);
  assert.equal(r.ok, true);
  assert.equal(r.until, 5 * MIN);
  allow = r.allow;
  r = grant(allow, 'youtube.com', MIN, opts); // still open: free
  assert.equal(r.allow.used, 1);
  allow = grant(allow, 'vk.com', MIN, opts).allow;
  assert.equal(allowLeft(allow, opts.allowLimit), 0);
  r = grant(allow, 'reddit.com', 2 * MIN, opts);
  assert.deepEqual([r.ok, r.reason], [false, 'limit']);
  assert.deepEqual(activeSites(allow, 2 * MIN).sort(), ['vk.com', 'youtube.com']);
  assert.equal(nextExpiry(allow, 2 * MIN), 5 * MIN);
});

test('allowance counter resets on a new day', () => {
  const allow = normalizeAllow({ date: '2026-10-20', used: 3, until: {} }, '2026-10-21');
  assert.equal(allow.used, 0);
});

test('stats: focus and blocks are recorded per local day without mutating input', () => {
  const day = new Date(2026, 9, 21, 15);
  const empty = {};
  let stats = recordFocus(empty, day, 24.6, true);
  stats = recordBlock(stats, day, 'vk.com');
  stats = recordBlock(stats, day, 'vk.com');
  assert.deepEqual(empty, {});
  assert.deepEqual(stats[dayKey(day)], { focusMin: 25, blocked: 2, sessions: 1, sites: { 'vk.com': 2 } });
});

test('stats: last seven days are filled with zeros and summarised', () => {
  const today = new Date(2026, 9, 21);
  const stats = recordBlock(recordFocus({}, today, 50), new Date(2026, 9, 18), 'x.com');
  const days = lastDays(stats, today, 7);
  assert.equal(days.length, 7);
  assert.equal(days[6].key, '2026-10-21');
  const sum = summarize(days, 5);
  assert.deepEqual([sum.focusMin, sum.blocked, sum.savedMin], [50, 1, 5]);
  assert.deepEqual(sum.topSites, [{ site: 'x.com', count: 1 }]);
});

test('stats: prune drops days older than the window', () => {
  const stats = { '2026-01-01': {}, '2026-10-20': {} };
  assert.deepEqual(Object.keys(prune(stats, new Date(2026, 9, 21), 90)), ['2026-10-20']);
});

test('formatMinutes', () => {
  assert.equal(formatMinutes(0), '0 мин');
  assert.equal(formatMinutes(60), '1 ч');
  assert.equal(formatMinutes(95), '1 ч 35 мин');
});

test('settings: garbage is clamped back to sane values', () => {
  const s = withDefaults({ workMin: 999, breakMin: 'abc', blocklist: ['https://www.vk.com/', 'nope', 'vk.com'], schedule: { days: [9, 1, '2'], start: 'x' } });
  assert.equal(s.workMin, 180);
  assert.equal(s.breakMin, DEFAULT_SETTINGS.breakMin);
  assert.deepEqual(s.blocklist, ['vk.com']);
  assert.deepEqual(s.schedule.days, [1, 2]);
  assert.equal(s.schedule.start, '09:00');
});

test('blocking follows the work phase or the schedule, whichever ends later', () => {
  const settings = withDefaults({ workMin: 25 });
  const now = new Date(2026, 9, 19, 17, 50); // Monday
  const schedule = { enabled: true, days: [1], start: '09:00', end: '18:00' };
  const running = startWork(IDLE, settings, now.getTime());
  assert.equal(isBlockingActive(IDLE, { ...schedule, enabled: false }, now), false);
  assert.equal(isBlockingActive(IDLE, schedule, now), true);
  assert.equal(blockingRemainingMs(running, schedule, now), 25 * MIN);
  assert.equal(blockingRemainingMs(IDLE, schedule, now), 10 * MIN);
});
