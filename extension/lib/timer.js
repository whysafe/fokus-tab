// Помодоро-таймер как набор чистых переходов состояния.
// phase: 'idle' | 'work' | 'break'; paused хранит остаток времени, пока таймер стоит на паузе.

export const IDLE = Object.freeze({ phase: 'idle', endsAt: 0, durationMs: 0, pausedMs: null, longBreak: false, completed: 0 });

const MIN = 60_000;

function base(state) {
  return { ...IDLE, ...state };
}

export function isRunning(state) {
  return state.phase !== 'idle' && state.pausedMs == null;
}

export function remaining(state, now) {
  if (state.phase === 'idle') return 0;
  if (state.pausedMs != null) return state.pausedMs;
  return Math.max(0, state.endsAt - now);
}

/** Сколько минут работы уже прошло в текущей фазе work. */
export function workedMinutes(state, now) {
  if (state.phase !== 'work') return 0;
  return (state.durationMs - remaining(state, now)) / MIN;
}

export function startWork(state, settings, now) {
  const durationMs = settings.workMin * MIN;
  return { ...base(state), phase: 'work', endsAt: now + durationMs, durationMs, pausedMs: null, longBreak: false };
}

export function startBreak(state, settings, now) {
  const s = base(state);
  const longBreak = s.completed > 0 && s.completed % settings.longEvery === 0;
  const durationMs = (longBreak ? settings.longBreakMin : settings.breakMin) * MIN;
  return { ...s, phase: 'break', endsAt: now + durationMs, durationMs, pausedMs: null, longBreak };
}

export function pause(state, now) {
  if (!isRunning(state)) return state;
  return { ...state, pausedMs: remaining(state, now) };
}

export function resume(state, now) {
  if (state.phase === 'idle' || state.pausedMs == null) return state;
  return { ...state, endsAt: now + state.pausedMs, pausedMs: null };
}

/**
 * Завершение фазы по времени или кнопкой «Пропустить».
 * Возвращает новое состояние и сколько минут фокуса засчитать.
 */
export function finishPhase(state, settings, now) {
  const s = base(state);
  if (s.phase === 'work') {
    const focusMin = workedMinutes(s, now);
    const done = { ...s, completed: s.completed + 1 };
    return { state: startBreak(done, settings, now), focusMin, completed: true, event: 'work-done' };
  }
  if (s.phase === 'break') {
    return { state: { ...IDLE, completed: s.completed }, focusMin: 0, completed: false, event: 'break-done' };
  }
  return { state: s, focusMin: 0, completed: false, event: null };
}

/** Полная остановка: незаконченный помидор засчитывается по прошедшим минутам, но не как сессия. */
export function stop(state, now) {
  const s = base(state);
  return { state: { ...IDLE, completed: s.completed }, focusMin: workedMinutes(s, now) };
}

/** Текст бейджа на иконке: "25m", "<1m", "II" на паузе. */
export function badgeText(state, now) {
  if (state.phase === 'idle') return '';
  if (state.pausedMs != null) return 'II';
  const ms = remaining(state, now);
  if (ms <= 0) return '';
  if (ms < MIN) return '<1m';
  return `${Math.ceil(ms / MIN)}m`;
}

export function formatClock(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}
