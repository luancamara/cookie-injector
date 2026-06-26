// Injeção de cookies (formato canônico) reusando as regras maduras do popup original.

const SAME_SITE_TOKEN = { none: 'no_restriction', lax: 'lax', strict: 'strict' };

async function removeConflictingVariants(cookiesApi, name, host, path, justSetDomain) {
  let existing;
  try { existing = await cookiesApi.getAll({ name, domain: host }); } catch { return; }
  const variants = new Set(['.' + host, host]);
  for (const e of existing) {
    if (e.name !== name || e.path !== path) continue;
    if (e.domain === justSetDomain) continue;
    if (!variants.has(e.domain)) continue;
    const scheme = e.secure ? 'https://' : 'http://';
    try { await cookiesApi.remove({ url: scheme + e.domain.replace(/^\./, '') + e.path, name: e.name }); } catch { /* ignora */ }
  }
}

export async function setCookie(cookiesApi, spec) {
  const host = spec.domain.replace(/^\./, '');
  const scheme = spec.secure ? 'https://' : 'http://';
  const path = spec.path || '/';
  const details = {
    url: scheme + host + path,
    name: spec.name,
    value: spec.value,
    path,
    secure: !!spec.secure,
    httpOnly: !!spec.httpOnly,
  };
  if (!spec.hostOnly) details.domain = spec.domain;
  if (spec.sameSite && spec.sameSite !== 'unspecified') details.sameSite = spec.sameSite;
  if (typeof spec.expirationDate === 'number') details.expirationDate = spec.expirationDate;
  const result = await cookiesApi.set(details);
  if (result) await removeConflictingVariants(cookiesApi, spec.name, host, path, result.domain);
  return result;
}

export async function injectAll(cookiesApi, specs, onResult) {
  let ok = 0, fail = 0;
  for (const spec of specs) {
    try {
      const r = await setCookie(cookiesApi, spec);
      if (r) { ok++; onResult?.(spec, true); }
      else { fail++; onResult?.(spec, false); }
    } catch (e) { fail++; onResult?.(spec, false, e); }
  }
  return { ok, fail };
}

export function fromDevtoolsParsed(c) {
  let expirationDate = null;
  if (c.expires && !/^session$/i.test(c.expires)) {
    const t = Date.parse(c.expires);
    if (!isNaN(t)) expirationDate = t / 1000;
  }
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
    sameSite: SAME_SITE_TOKEN[String(c.sameSite || '').toLowerCase()] || 'unspecified',
    expirationDate,
    hostOnly: !!c.hostOnly,
  };
}
