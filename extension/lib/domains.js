// Нормализация доменов из блок-листа и сборка правил declarativeNetRequest.

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

/** "https://www.YouTube.com/watch?v=1" -> "youtube.com". Кириллица переводится в punycode. Неверный ввод -> null. */
export function normalizeDomain(input) {
  let value = String(input ?? '').trim().toLowerCase();
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(value)) value = `http://${value}`;
  let host;
  try {
    host = new URL(value).hostname;
  } catch {
    return null;
  }
  host = host.replace(/\.$/, '').replace(/^www\./, '');
  return DOMAIN_RE.test(host) ? host : null;
}

/** Разбирает текст (строки, запятые, пробелы) в список уникальных доменов и список ошибочных строк. */
export function parseList(text) {
  const domains = [];
  const invalid = [];
  for (const raw of String(text ?? '').split(/[\s,;]+/)) {
    if (!raw) continue;
    const d = normalizeDomain(raw);
    if (!d) invalid.push(raw);
    else if (!domains.includes(d)) domains.push(d);
  }
  return { domains, invalid };
}

/** Совпадает ли хост с доменом из списка, включая поддомены (m.youtube.com -> youtube.com). */
export function matchesDomain(hostname, domain) {
  const host = String(hostname).toLowerCase().replace(/\.$/, '');
  return host === domain || host.endsWith(`.${domain}`);
}

export function findMatch(hostname, domains) {
  return domains.find((d) => matchesDomain(hostname, d)) ?? null;
}

export function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Одно правило на домен: открытие страницы (main_frame) перенаправляется на blocked.html.
 * Исходный адрес передаётся в hash (\0 — весь URL), чтобы после «5 минут» вернуть пользователя туда же.
 */
export function buildRules(domains, blockedPageUrl) {
  return domains.map((domain, i) => ({
    id: i + 1,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: { regexSubstitution: `${blockedPageUrl}?site=${encodeURIComponent(domain)}#\\0` },
    },
    condition: {
      regexFilter: `^https?://([a-z0-9-]+\\.)*${escapeRegex(domain)}(:[0-9]+)?([/?#].*)?$`,
      resourceTypes: ['main_frame'],
    },
  }));
}
