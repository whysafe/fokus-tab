import { pickQuote } from './lib/quotes.js';
import { formatClock } from './lib/timer.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const site = params.get('site') ?? '';
const original = location.hash.slice(1);
const reload = performance.getEntriesByType('navigation')[0]?.type === 'reload';

let endsAt = 0;

function render(state) {
  endsAt = state.blocking ? Date.now() + state.blockingRemainingMs : 0;
  const left = state.allowLeft;
  const allow = $('allow');
  allow.textContent = `Ещё ${state.settings.allowMinutes} мин`;
  allow.disabled = left === 0;
  $('note').textContent = left === 0
    ? 'Поблажки на сегодня закончились.'
    : `Поблажек на сегодня: ${left} из ${state.settings.allowLimit}. Заблокировано попыток сегодня: ${state.today.blocked}.`;
  tick();
}

function tick() {
  const ms = endsAt - Date.now();
  $('left').textContent = endsAt ? formatClock(ms) : '—';
  // Фокус закончился: даём воркеру пару секунд снять правила и возвращаем на исходную страницу.
  if (endsAt && ms <= -2000 && original) location.replace(original);
}

$('site').textContent = site || 'Этот сайт';
document.title = `${site || 'Сайт'} заблокирован — Фокус`;
const quote = pickQuote(Math.floor(Date.now() / 60_000));
$('quote').textContent = quote.text;
$('author').textContent = quote.author;

$('back').addEventListener('click', async () => {
  if (history.length > 1) history.back();
  else {
    const tab = await chrome.tabs.getCurrent();
    if (tab) chrome.tabs.remove(tab.id);
  }
});

$('allow').addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'allow', site });
  if (res?.ok) location.replace(original || `https://${site}/`);
  else if (res) render(res);
});

const state = await chrome.runtime.sendMessage({ type: 'blocked', site, reload });
if (state && !state.error) {
  if (!state.blocking && original) location.replace(original);
  else render(state);
}
setInterval(tick, 1000);
