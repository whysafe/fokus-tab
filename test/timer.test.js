import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as timer from '../extension/lib/timer.js';

const settings = { workMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4 };
const MIN = 60_000;

test('startWork sets a 25-minute work phase', () => {
  const s = timer.startWork(timer.IDLE, settings, 1000);
  assert.equal(s.phase, 'work');
  assert.equal(timer.remaining(s, 1000), 25 * MIN);
  assert.equal(timer.badgeText(s, 1000), '25m');
});

test('pause freezes the remaining time and resume continues from it', () => {
  let s = timer.startWork(timer.IDLE, settings, 0);
  s = timer.pause(s, 10 * MIN);
  assert.equal(timer.remaining(s, 99 * MIN), 15 * MIN);
  assert.equal(timer.badgeText(s, 99 * MIN), 'II');
  s = timer.resume(s, 100 * MIN);
  assert.equal(timer.remaining(s, 105 * MIN), 10 * MIN);
});

test('finishing work counts the minutes and starts a break', () => {
  const s = timer.startWork(timer.IDLE, settings, 0);
  const r = timer.finishPhase(s, settings, 25 * MIN);
  assert.equal(r.event, 'work-done');
  assert.equal(r.focusMin, 25);
  assert.equal(r.completed, true);
  assert.equal(r.state.phase, 'break');
  assert.equal(r.state.completed, 1);
  assert.equal(timer.remaining(r.state, 25 * MIN), 5 * MIN);
});

test('every fourth pomodoro gets a long break', () => {
  let s = { ...timer.IDLE, completed: 3 };
  s = timer.startWork(s, settings, 0);
  const r = timer.finishPhase(s, settings, 25 * MIN);
  assert.equal(r.state.completed, 4);
  assert.equal(r.state.longBreak, true);
  assert.equal(timer.remaining(r.state, 25 * MIN), 15 * MIN);
});

test('stop counts partial focus but not a completed session', () => {
  const s = timer.startWork(timer.IDLE, settings, 0);
  const r = timer.stop(s, 12 * MIN);
  assert.equal(r.focusMin, 12);
  assert.equal(r.state.phase, 'idle');
});

test('a finished break returns to idle and keeps the counter', () => {
  const s = { ...timer.startBreak({ ...timer.IDLE, completed: 2 }, settings, 0) };
  const r = timer.finishPhase(s, settings, 5 * MIN);
  assert.equal(r.event, 'break-done');
  assert.equal(r.state.phase, 'idle');
  assert.equal(r.state.completed, 2);
});

test('badge and clock formatting', () => {
  const s = timer.startWork(timer.IDLE, settings, 0);
  assert.equal(timer.badgeText(s, 25 * MIN - 30_000), '<1m');
  assert.equal(timer.badgeText(timer.IDLE, 0), '');
  assert.equal(timer.formatClock(25 * MIN), '25:00');
  assert.equal(timer.formatClock(61_500), '01:02');
  assert.equal(timer.formatClock(2 * 3600_000 + 5000), '2:00:05');
});
