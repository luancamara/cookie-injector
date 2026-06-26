// Injeção de cookies (formato canônico) reusando as regras maduras do popup original.

const SAME_SITE_TOKEN = { none: 'no_restriction', lax: 'lax', strict: 'strict' };

async function removeConflictingVariants(cookiesApi, name, host, path, justSetDomain, batchKeys) {
  let existing;
  try { existing = await cookiesApi.getAll({ name, domain: host }); } catch { return; }
  const variants = new Set(['.' + host, host]);
  for (const e of existing) {
    if (e.name !== name || e.path !== path) continue;
    if (e.domain === justSetDomain) continue;                  // não remove o que acabamos de gravar
    if (!variants.has(e.domain)) continue;                     // só variantes do mesmo host
    // Preserva variantes que pertencem ao próprio lote sendo injetado (ex.: host-only
    // E de-domínio do mesmo name/path coexistem legitimamente).
    if (batchKeys && batchKeys.has(e.name + '|' + e.domain + '|' + (e.path || '/'))) continue;
    const scheme = e.secure ? 'https://' : 'http://';
    try { await cookiesApi.remove({ url: scheme + e.domain.replace(/^\./, '') + e.path, name: e.name }); } catch { /* ignora */ }
  }
}

export async function setCookie(cookiesApi, spec, batchKeys) {
  const host = spec.domain.replace(/^\./, '');
  const path = spec.path || '/';
  const sameSite = (spec.sameSite && spec.sameSite !== 'unspecified') ? spec.sameSite : null;
  // SameSite=None (no_restriction) exige Secure, senão chrome.cookies.set falha (retorna null).
  let secure = !!spec.secure;
  if (sameSite === 'no_restriction') secure = true;
  const scheme = secure ? 'https://' : 'http://';
  const details = {
    url: scheme + host + path,
    name: spec.name,
    value: spec.value,
    path,
    secure,
    httpOnly: !!spec.httpOnly,
  };
  if (!spec.hostOnly) details.domain = spec.domain;
  if (sameSite) details.sameSite = sameSite;
  if (typeof spec.expirationDate === 'number') details.expirationDate = spec.expirationDate;
  const result = await cookiesApi.set(details);
  if (result) await removeConflictingVariants(cookiesApi, spec.name, host, path, result.domain, batchKeys);
  return result;
}

export async function injectAll(cookiesApi, specs, onResult) {
  const batchKeys = new Set(specs.map((s) => s.name + '|' + s.domain + '|' + (s.path || '/')));
  let ok = 0, fail = 0;
  for (const spec of specs) {
    try {
      const r = await setCookie(cookiesApi, spec, batchKeys);
      if (r) { ok++; onResult?.(spec, true); }
      else { fail++; onResult?.(spec, false); }
    } catch (e) { fail++; onResult?.(spec, false, e); }
  }
  return { ok, fail };
}

// Converte o objeto do parser de DevTools (sameSite token + `expires` string).
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

// Converte o formato do "Exportar JSON" (sameSite 'None'/'Lax'/'Strict', expirationDate
// ISO string ou 'session') para o formato canônico do injector.
export function fromExportFormat(c) {
  let expirationDate = null;
  if (typeof c.expirationDate === 'number') {
    expirationDate = c.expirationDate;
  } else if (typeof c.expirationDate === 'string' && !/^session$/i.test(c.expirationDate)) {
    const t = Date.parse(c.expirationDate);
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
