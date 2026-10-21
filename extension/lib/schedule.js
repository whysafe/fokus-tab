// Расписание рабочих часов: дни недели (0 = воскресенье, как в Date#getDay)
// и интервал "HH:MM"–"HH:MM". Интервал может переходить через полночь (22:00–02:00).

const DAY_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** "09:30" -> 570 минут от полуночи. "24:00" допустимо как конец дня. Иначе NaN. */
export function parseTime(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return NaN;
  if (h === 24 && min === 0) return 1440;
  if (h > 23) return NaN;
  return h * 60 + min;
}

export function formatTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function bounds(schedule) {
  if (!schedule?.enabled || !Array.isArray(schedule.days) || schedule.days.length === 0) return null;
  const start = parseTime(schedule.start);
  const end = parseTime(schedule.end);
  if (Number.isNaN(start) || Number.isNaN(end) || start === end) return null;
  return { start, end, overnight: start > end };
}

/** Активно ли расписание в момент date (локальное время). */
export function isWithinSchedule(schedule, date) {
  const b = bounds(schedule);
  if (!b) return false;
  const day = date.getDay();
  const now = date.getHours() * 60 + date.getMinutes();
  if (!b.overnight) return schedule.days.includes(day) && now >= b.start && now < b.end;
  // Ночной интервал: вечерняя часть относится к текущему дню, утренняя к предыдущему.
  if (now >= b.start) return schedule.days.includes(day);
  if (now < b.end) return schedule.days.includes((day + 6) % 7);
  return false;
}

/** Сколько миллисекунд осталось до конца текущего интервала расписания (0, если не активно). */
export function msUntilScheduleEnd(schedule, date) {
  if (!isWithinSchedule(schedule, date)) return 0;
  const b = bounds(schedule);
  const now = date.getHours() * 60 + date.getMinutes();
  const end = new Date(date.getTime());
  end.setHours(Math.floor(b.end / 60), b.end % 60, 0, 0);
  if (b.overnight && now >= b.start) end.setDate(end.getDate() + 1);
  return Math.max(0, end.getTime() - date.getTime());
}

/** Дни в порядке Пн..Вс, подряд идущие от трёх дней сворачиваются в диапазон. */
export function describeDays(days) {
  const set = new Set(days);
  const ordered = WEEK_ORDER.filter((d) => set.has(d));
  if (ordered.length === 7) return 'ежедневно';
  const parts = [];
  let run = [];
  const flush = () => {
    if (run.length >= 3) parts.push(`${DAY_SHORT[run[0]]}–${DAY_SHORT[run[run.length - 1]]}`);
    else parts.push(...run.map((d) => DAY_SHORT[d]));
    run = [];
  };
  for (const d of ordered) {
    const prev = run[run.length - 1];
    if (run.length && WEEK_ORDER.indexOf(d) !== WEEK_ORDER.indexOf(prev) + 1) flush();
    run.push(d);
  }
  if (run.length) flush();
  return parts.join(', ');
}

/** "Пн–Пт, 09:00–18:00" или "выключено". */
export function describeSchedule(schedule) {
  const b = bounds(schedule);
  if (!b) return 'выключено';
  return `${describeDays(schedule.days)}, ${formatTime(b.start)}–${formatTime(b.end)}`;
}

export { DAY_SHORT, WEEK_ORDER };
