// Статистика по дням: { "2026-10-21": { focusMin, blocked, sessions, sites: { "youtube.com": 3 } } }.
// Все функции возвращают новый объект и не меняют входной.

const WEEKDAY = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

export function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function emptyDay() {
  return { focusMin: 0, blocked: 0, sessions: 0, sites: {} };
}

function withDay(stats, date, update) {
  const key = dayKey(date);
  const prev = stats?.[key] ?? emptyDay();
  return { ...stats, [key]: update({ ...prev, sites: { ...prev.sites } }) };
}

export function recordBlock(stats, date, site) {
  return withDay(stats, date, (day) => {
    day.blocked += 1;
    if (site) day.sites[site] = (day.sites[site] ?? 0) + 1;
    return day;
  });
}

/** minutes — сколько минут фокуса добавить, completed — закончен ли полный помидор. */
export function recordFocus(stats, date, minutes, completed = false) {
  const add = Math.max(0, Math.round(minutes));
  if (add === 0 && !completed) return stats ?? {};
  return withDay(stats, date, (day) => {
    day.focusMin += add;
    if (completed) day.sessions += 1;
    return day;
  });
}

/** Последние n дней, от старого к сегодняшнему, пустые дни заполнены нулями. */
export function lastDays(stats, today, n = 7) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = dayKey(date);
    const day = stats?.[key] ?? emptyDay();
    out.push({ key, label: WEEKDAY[date.getDay()], date: date.getDate(), ...day });
  }
  return out;
}

/** Итоги по списку дней. savedMin — оценка: каждая заблокированная попытка экономит minutesPerDistraction. */
export function summarize(days, minutesPerDistraction = 5) {
  const total = { focusMin: 0, blocked: 0, sessions: 0, savedMin: 0, topSites: [] };
  const sites = {};
  for (const day of days) {
    total.focusMin += day.focusMin;
    total.blocked += day.blocked;
    total.sessions += day.sessions;
    for (const [site, n] of Object.entries(day.sites ?? {})) sites[site] = (sites[site] ?? 0) + n;
  }
  total.savedMin = total.blocked * minutesPerDistraction;
  total.topSites = Object.entries(sites)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([site, count]) => ({ site, count }));
  return total;
}

/** Удаляет дни старше keepDays, чтобы хранилище не росло бесконечно. */
export function prune(stats, today, keepDays = 90) {
  const cutoff = dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - keepDays + 1));
  return Object.fromEntries(Object.entries(stats ?? {}).filter(([key]) => key >= cutoff));
}

export function formatMinutes(min) {
  const total = Math.max(0, Math.round(min));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} мин`;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}
