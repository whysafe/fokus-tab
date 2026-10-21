import { findMatch, normalizeDomain } from './lib/domains.js';
import { describeSchedule } from './lib/schedule.js';
import { formatMinutes } from './lib/stats.js';
import { formatClock } from './lib/timer.js';

const $ = (id) => document.getElementById(id);
const CIRCUMFERENCE = 2 * Math.PI * 88;

let state = null;
let receivedAt = 0;
let currentSite = null;
let pending = false;

function send(type, extra = {}) {
  pending = true;
  return chrome.runtime.sendMessage({ type, ...extra }).finally(() => { pending = false; }).then((res) => {
    if (res && !res.error) {
      state = res;
      receivedAt = Date.now();
      render();
    }
    return res;
  });
}

// Остаток считаем локально от момента ответа воркера, чтобы часы шли плавно без лишних сообщений.
function remainingNow() {
  if (!state) return 0;
  const { timer } = state;
  if (timer.phase === 'idle') return 0;
  if (timer.pausedMs != null) return timer.pausedMs;
  return Math.max(0, state.remainingMs - (Date.now() - receivedAt));
}

function renderClock() {
  if (!state) return;
  const { timer, settings } = state;
  const idle = timer.phase === 'idle';
  const ms = idle ? settings.workMin * 60_000 : remainingNow();
  $('clock').textContent = formatClock(ms);
  const progress = idle || !timer.durationMs ? 0 : 1 - ms / timer.durationMs;
  $('ringFg').style.strokeDashoffset = String(CIRCUMFERENCE * (1 - progress));
  if (!idle && ms === 0 && !pending) send('state');
}

function render() {
  const { timer, settings, today, blocking, allowLeft } = state;
  const phase = timer.phase;
  document.body.className = phase;
  const paused = timer.pausedMs != null;

  $('phase').textContent = {
    idle: 'Готов к работе',
    work: paused ? 'Пауза' : 'Фокус',
    break: timer.longBreak ? 'Длинный перерыв' : 'Перерыв',
  }[phase];
  const inCycle = (timer.completed % settings.longEvery) + (phase === 'break' ? 0 : 1);
  $('cycle').textContent = phase === 'break'
    ? `готово помидоров: ${timer.completed}`
    : `помидор ${Math.min(inCycle, settings.longEvery)} из ${settings.longEvery}`;

  $('start').hidden = phase !== 'idle';
  $('pause').hidden = phase === 'idle';
  $('skip').hidden = phase === 'idle';
  $('stop').hidden = phase === 'idle';
  $('pause').textContent = paused ? 'Продолжить' : 'Пауза';

  const status = $('status');
  status.textContent = blocking ? 'Блокировка включена' : 'Блокировка выключена';
  status.classList.toggle('on', blocking);

  $('todayFocus').textContent = formatMinutes(today.focusMin);
  $('todayBlocked').textContent = String(today.blocked);
  $('allowLeft').textContent = `${allowLeft} из ${settings.allowLimit}`;
  $('schedule').textContent = describeSchedule(settings.schedule);

  if (currentSite) {
    const listed = findMatch(currentSite, settings.blocklist);
    $('siteRow').hidden = false;
    $('siteName').textContent = currentSite;
    $('addSite').disabled = Boolean(listed);
    $('addSite').textContent = listed ? 'Уже в списке' : 'В блок-лист';
  }
  renderClock();
}

async function detectSite() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url && /^https?:/.test(tab.url)) currentSite = normalizeDomain(tab.url);
}

$('start').addEventListener('click', () => send('start'));
$('pause').addEventListener('click', () => send(state.timer.pausedMs != null ? 'resume' : 'pause'));
$('skip').addEventListener('click', () => send('skip'));
$('stop').addEventListener('click', () => send('stop'));
$('addSite').addEventListener('click', () => send('addSite', { site: currentSite }));
$('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') send('state');
});

await detectSite();
await send('state');
setInterval(renderClock, 250);
setInterval(() => { if (!pending) send('state'); }, 5000);
