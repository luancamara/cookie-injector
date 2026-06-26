// Lê todos os cookies do perfil e normaliza para o formato canônico.

export function toRecord(c) {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
    sameSite: c.sameSite || 'unspecified',
    expirationDate: c.session ? null : (typeof c.expirationDate === 'number' ? c.expirationDate : null),
    hostOnly: !!c.hostOnly,
    session: !!c.session,
  };
}

export async function collectAllCookies(cookiesApi = globalThis.chrome?.cookies) {
  const all = await cookiesApi.getAll({});
  const seen = new Set();
  const out = [];
  for (const c of all) {
    const key = c.name + '|' + c.domain + '|' + (c.path || '/');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(toRecord(c));
  }
  out.sort((a, b) => (a.domain + a.name).localeCompare(b.domain + b.name));
  return out;
}
