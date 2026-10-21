// «Ещё 5 минут»: временный доступ к заблокированному сайту с лимитом в день.
// Состояние: { date: "2026-10-21", used: 1, until: { "youtube.com": 1761040000000 } }.

export function normalizeAllow(allow, today) {
  const until = allow?.until ?? {};
  if (allow?.date !== today) return { date: today, used: 0, until };
  return { date: today, used: allow.used ?? 0, until };
}

export function pruneExpired(allow, now) {
  const until = Object.fromEntries(Object.entries(allow.until).filter(([, ts]) => ts > now));
  return { ...allow, until };
}

export function activeSites(allow, now) {
  return Object.entries(allow.until)
    .filter(([, ts]) => ts > now)
    .map(([site]) => site);
}

export function allowLeft(allow, limit) {
  return Math.max(0, limit - allow.used);
}

/** Ближайший момент, когда истечёт какой-нибудь доступ, или null. */
export function nextExpiry(allow, now) {
  const times = Object.values(allow.until).filter((ts) => ts > now);
  return times.length ? Math.min(...times) : null;
}

/** Выдать доступ к сайту на allowMinutes. Повторный запрос к уже открытому сайту лимит не тратит. */
export function grant(allow, site, now, { allowMinutes, allowLimit }) {
  if (!site) return { ok: false, reason: 'no-site', allow };
  if ((allow.until[site] ?? 0) > now) return { ok: true, allow, until: allow.until[site] };
  if (allow.used >= allowLimit) return { ok: false, reason: 'limit', allow };
  const until = now + allowMinutes * 60_000;
  return { ok: true, until, allow: { ...allow, used: allow.used + 1, until: { ...allow.until, [site]: until } } };
}
