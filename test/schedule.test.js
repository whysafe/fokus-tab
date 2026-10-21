import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeDays, describeSchedule, isWithinSchedule, msUntilScheduleEnd, parseTime } from '../extension/lib/schedule.js';

// 2026-10-19 is a Monday.
const at = (day, hh, mm = 0) => new Date(2026, 9, 19 + day, hh, mm);
const workdays = { enabled: true, days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' };
const night = { enabled: true, days: [5], start: '22:00', end: '02:00' };

test('parseTime accepts HH:MM and 24:00, rejects garbage', () => {
  assert.equal(parseTime('09:30'), 570);
  assert.equal(parseTime('24:00'), 1440);
  assert.ok(Number.isNaN(parseTime('25:00')));
  assert.ok(Number.isNaN(parseTime('9.30')));
  assert.ok(Number.isNaN(parseTime(undefined)));
});

test('daytime schedule respects days and the end is exclusive', () => {
  assert.equal(isWithinSchedule(workdays, at(0, 9)), true);
  assert.equal(isWithinSchedule(workdays, at(0, 17, 59)), true);
  assert.equal(isWithinSchedule(workdays, at(0, 18)), false);
  assert.equal(isWithinSchedule(workdays, at(0, 8, 59)), false);
  assert.equal(isWithinSchedule(workdays, at(5, 12)), false); // Saturday
});

test('overnight interval: the morning part belongs to the previous day', () => {
  assert.equal(isWithinSchedule(night, at(4, 23)), true); // Friday 23:00
  assert.equal(isWithinSchedule(night, at(5, 1)), true); // Saturday 01:00, started on Friday
  assert.equal(isWithinSchedule(night, at(5, 23)), false); // Saturday evening is not scheduled
  assert.equal(isWithinSchedule(night, at(4, 1)), false); // Friday 01:00 belongs to Thursday
});

test('disabled or broken schedules are never active', () => {
  assert.equal(isWithinSchedule({ ...workdays, enabled: false }, at(0, 10)), false);
  assert.equal(isWithinSchedule({ ...workdays, days: [] }, at(0, 10)), false);
  assert.equal(isWithinSchedule({ ...workdays, start: '10:00', end: '10:00' }, at(0, 10)), false);
});

test('time until the end of the interval', () => {
  assert.equal(msUntilScheduleEnd(workdays, at(0, 17, 30)), 30 * 60_000);
  assert.equal(msUntilScheduleEnd(night, at(4, 23)), 3 * 3600_000);
  assert.equal(msUntilScheduleEnd(workdays, at(0, 20)), 0);
});

test('human-readable descriptions', () => {
  assert.equal(describeDays([1, 2, 3, 4, 5]), 'Пн–Пт');
  assert.equal(describeDays([0, 1, 2, 3, 4, 5, 6]), 'ежедневно');
  assert.equal(describeDays([1, 3, 6, 0]), 'Пн, Ср, Сб, Вс');
  assert.equal(describeSchedule(workdays), 'Пн–Пт, 09:00–18:00');
  assert.equal(describeSchedule({ ...workdays, enabled: false }), 'выключено');
});
