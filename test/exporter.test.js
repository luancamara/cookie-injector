import { describe, it, expect } from 'vitest';
import { toRecord, collectAllCookies } from '../src/exporter.js';

const fakeCookies = (list) => ({ getAll: async () => list });

describe('exporter', () => {
  it('toRecord mapeia campos nativos', () => {
    const r = toRecord({
      name: 'sid', value: 'v', domain: '.x.com', path: '/', secure: true,
      httpOnly: true, sameSite: 'no_restriction', expirationDate: 111, hostOnly: false, session: false,
    });
    expect(r).toEqual({
      name: 'sid', value: 'v', domain: '.x.com', path: '/', secure: true,
      httpOnly: true, sameSite: 'no_restriction', expirationDate: 111, hostOnly: false, session: false,
    });
  });

  it('cookie de sessão vira expirationDate null', () => {
    expect(toRecord({ name: 'a', value: '1', domain: 'x.com', path: '/', session: true }).expirationDate).toBe(null);
  });

  it('collectAllCookies remove duplicados e ordena', async () => {
    const api = fakeCookies([
      { name: 'b', value: '1', domain: 'z.com', path: '/' },
      { name: 'a', value: '1', domain: 'z.com', path: '/' },
      { name: 'a', value: '1', domain: 'z.com', path: '/' },
    ]);
    const out = await collectAllCookies(api);
    expect(out.map((c) => c.name)).toEqual(['a', 'b']);
  });
});
