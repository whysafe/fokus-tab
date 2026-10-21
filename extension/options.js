import { parseList } from './lib/domains.js';
import { DAY_SHORT, WEEK_ORDER, describeSchedule } from './lib/schedule.js';
import { withDefaults } from './lib/settings.js';
import { formatMinutes, lastDays, summarize } from './lib/stats.js';

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const NUMBER_FIELDS = ['workMin', 'breakMin', 'longBreakMin', 'longEvery', 'allowMinutes', 'allowLimit', 'minutesPerDistraction'];

let settings = withDefaults(null);
let stats = {};
let metric = 'focusMin';
let saveTimer = 0;

function save() {
  settings = withDefaults(settings);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = 0;
    await chrome.storage.sync.set({ settings });
    $('saved').textContent = 'Сохранено';
    setTimeout(() => { $('saved').textContent = ''; }, 1500);
  }, 300);
}

// ---------- Настройки ----------

function renderBlocklist() {
  const list = $('blocklist');
  list.replaceChildren(...settings.blocklist.map((domain) => {
    const li = document.createElement('li');
    li.textContent = domain;
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '×';
    del.title = `Убрать ${domain}`;
    del.addEventListener('click', () => {
      settings.blocklist = settings.blocklist.filter((d) => d !== domain);
      renderBlocklist();
      save();
    });
    li.append(del);
    return li;
  }));
}

function renderDays() {
  const box = $('days');
  box.replaceChildren(...WEEK_ORDER.map((day) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = DAY_SHORT[day];
    b.classList.toggle('on', settings.schedule.days.includes(day));
    b.setAttribute('aria-pressed', String(b.classList.contains('on')));
    b.addEventListener('click', () => {
      const days = new Set(settings.schedule.days);
      if (days.has(day)) days.delete(day);
      else days.add(day);
      settings.schedule = { ...settings.schedule, days: [...days] };
      renderDays();
      save();
    });
    return b;
  }));
  $('schedText').textContent = `Сейчас: ${describeSchedule(settings.schedule)}`;
}

function renderForm() {
  for (const key of NUMBER_FIELDS) $(key).value = settings[key];
  $('autoBreak').checked = settings.autoBreak;
  $('schedEnabled').checked = settings.schedule.enabled;
  $('schedStart').value = settings.schedule.start;
  $('schedEnd').value = settings.schedule.end;
  $('perDistraction').textContent = settings.minutesPerDistraction;
  renderBlocklist();
  renderDays();
}

for (const key of NUMBER_FIELDS) {
  $(key).addEventListener('change', (e) => {
    settings[key] = Number(e.target.value);
    save();
    e.target.value = withDefaults(settings)[key];
    if (key === 'minutesPerDistraction') renderStats();
  });
}
$('autoBreak').addEventListener('change', (e) => { settings.autoBreak = e.target.checked; save(); });
$('schedEnabled').addEventListener('change', (e) => {
  settings.schedule = { ...settings.schedule, enabled: e.target.checked };
  renderDays();
  save();
});
for (const [id, key] of [['schedStart', 'start'], ['schedEnd', 'end']]) {
  $(id).addEventListener('change', (e) => {
    if (!e.target.value) return;
    settings.schedule = { ...settings.schedule, [key]: e.target.value };
    renderDays();
    save();
  });
}

$('addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const { domains, invalid } = parseList($('newSite').value);
  $('addError').textContent = invalid.length ? `Не похоже на адрес сайта: ${invalid.join(', ')}` : '';
  const fresh = domains.filter((d) => !settings.blocklist.includes(d));
  if (fresh.length) {
    settings.blocklist = [...settings.blocklist, ...fresh];
    renderBlocklist();
    save();
  }
  if (!invalid.length) $('newSite').value = '';
});

// ---------- Статистика ----------

function niceMax(value) {
  if (value <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (value <= step * pow) return step * pow;
  return 10 * pow;
}

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

function renderChart(days) {
  const svg = $('chart');
  const W = 640, H = 220, left = 40, right = 8, top = 22, bottom = 30;
  const values = days.map((d) => d[metric]);
  const max = niceMax(Math.max(...values, 1));
  const plotH = H - top - bottom;
  const slot = (W - left - right) / days.length;
  const barW = Math.min(46, slot * 0.56);
  const nodes = [];

  const defs = el('defs');
  const grad = el('linearGradient', { id: 'todayGrad', x1: '0', y1: '0', x2: '0', y2: '1' });
  const color = metric === 'blocked' ? 'var(--amber)' : 'var(--accent-2)';
  const color2 = metric === 'blocked' ? '#c46a0a' : 'var(--accent)';
  grad.append(el('stop', { offset: '0', 'stop-color': color }), el('stop', { offset: '1', 'stop-color': color2 }));
  defs.append(grad);
  nodes.push(defs);

  for (let i = 0; i <= 4; i++) {
    const y = top + plotH - (plotH * i) / 4;
    nodes.push(el('line', { class: 'grid-line', x1: left, x2: W - right, y1: y, y2: y }));
    nodes.push(el('text', { class: 'axis', x: left - 8, y: y + 4, 'text-anchor': 'end' }, String(Math.round((max * i) / 4))));
  }

  days.forEach((day, i) => {
    const v = values[i];
    const h = (v / max) * plotH;
    const x = left + slot * i + (slot - barW) / 2;
    const isToday = i === days.length - 1;
    const cls = ['bar', metric === 'blocked' ? 'blocked' : '', isToday ? 'today' : ''].join(' ').trim();
    const bar = el('rect', { class: cls, x, y: top + plotH - h, width: barW, height: Math.max(h, v > 0 ? 3 : 0), rx: 6 });
    bar.append(el('title', {}, `${day.date} · ${metric === 'blocked' ? `${v} попыток` : formatMinutes(v)}`));
    nodes.push(bar);
    if (v > 0) nodes.push(el('text', { class: 'value', x: x + barW / 2, y: top + plotH - h - 6, 'text-anchor': 'middle' }, String(v)));
    nodes.push(el('text', { class: `axis${isToday ? ' label-today' : ''}`, x: x + barW / 2, y: H - 10, 'text-anchor': 'middle' }, isToday ? 'Сегодня' : `${day.label} ${day.date}`));
  });
  svg.replaceChildren(...nodes);
}

function renderTopSites(top) {
  const list = $('topSites');
  if (!top.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Пока ни одной попытки. Так держать.';
    list.replaceChildren(li);
    return;
  }
  const max = top[0].count;
  list.replaceChildren(...top.map(({ site, count }) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = site;
    const track = document.createElement('span');
    track.className = 'track';
    const fill = document.createElement('span');
    fill.className = 'fill';
    fill.style.width = `${(count / max) * 100}%`;
    fill.style.display = 'block';
    track.append(fill);
    const num = document.createElement('span');
    num.className = 'count';
    num.textContent = String(count);
    li.append(name, track, num);
    return li;
  }));
}

function renderStats() {
  const days = lastDays(stats, new Date(), 7);
  const week = summarize(days, settings.minutesPerDistraction);
  $('kTodayFocus').textContent = formatMinutes(days[days.length - 1].focusMin);
  $('kWeekFocus').textContent = formatMinutes(week.focusMin);
  $('kSaved').textContent = formatMinutes(week.savedMin);
  $('kBlocked').textContent = String(week.blocked);
  $('kSessions').textContent = String(week.sessions);
  $('perDistraction').textContent = settings.minutesPerDistraction;
  renderChart(days);
  renderTopSites(week.topSites);
}

for (const btn of document.querySelectorAll('.seg button')) {
  btn.addEventListener('click', () => {
    metric = btn.dataset.metric;
    for (const b of document.querySelectorAll('.seg button')) b.classList.toggle('active', b === btn);
    renderStats();
  });
}

$('resetStats').addEventListener('click', async () => {
  if (!confirm('Удалить всю статистику? Настройки останутся.')) return;
  await chrome.runtime.sendMessage({ type: 'resetStats' });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.stats) {
    stats = changes.stats.newValue ?? {};
    renderStats();
  }
  // Изменения с другого устройства или из попапа. Пока пользователь печатает здесь, форму не трогаем.
  if (area === 'sync' && changes.settings && !saveTimer) {
    settings = withDefaults(changes.settings.newValue);
    renderForm();
    renderStats();
  }
});

const [{ settings: stored }, local] = await Promise.all([chrome.storage.sync.get('settings'), chrome.storage.local.get('stats')]);
settings = withDefaults(stored);
stats = local.stats ?? {};
renderForm();
renderStats();
