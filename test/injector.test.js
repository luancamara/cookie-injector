import { describe, it, expect, vi } from 'vitest';
import { setCookie, injectAll, fromDevtoolsParsed } from '../src/injector.js';

function fakeApi() {
  const store = [];
  return {
    store,
    set: vi.fn(async (d) => { const c = { ...d, domain: d.domain || d.url.replace(/^https?:\/\//, '').split('/')[0] }; store.push(c); return c; }),
    getAll: vi.fn(async () => store),
    remove: vi.fn(async () => ({})),
  };
}

describe('injector', () => {
  it('setCookie grava com url e domain corretos (host-only sem domain)', async () => {
    const api = fakeApi();
    const r = await setCookie(api, { name: 'a', value: '1', domain: 'x.com', path: '/', secure: true, httpOnly: false, sameSite: 'lax', expirationDate: null, hostOnly: true });
    expect(r).toBeTruthy();
    const d = api.set.mock.calls[0][0];
    expect(d.url).toBe('https://x.com/');
    expect(d.domain).toBeUndefined();
    expect(d.sameSite).toBe('lax');
  });

  it('cookie de domínio inclui domain e expirationDate', async () => {
    const api = fakeApi();
    await setCookie(api, { name: 'a', value: '1', domain: '.x.com', path: '/', secure: true, httpOnly: true, sameSite: 'no_restriction', expirationDate: 222, hostOnly: false });
    const d = api.set.mock.calls[0][0];
    expect(d.domain).toBe('.x.com');
    expect(d.expirationDate).toBe(222);
  });

  it('injectAll conta sucessos e falhas', async () => {
    const api = fakeApi();
    api.set.mockImplementationOnce(async () => null).mockImplementationOnce(async (d) => ({ ...d }));
    const res = await injectAll(api, [
      { name: 'a', value: '1', domain: 'x.com', path: '/', secure: false, httpOnly: false, sameSite: 'unspecified', expirationDate: null, hostOnly: true },
      { name: 'b', value: '2', domain: 'x.com', path: '/', secure: false, httpOnly: false, sameSite: 'unspecified', expirationDate: null, hostOnly: true },
    ]);
    expect(res).toEqual({ ok: 1, fail: 1 });
  });

  it('fromDevtoolsParsed converte token e expires', () => {
    const spec = fromDevtoolsParsed({ name: 'a', value: '1', domain: '.x.com', path: '/', secure: true, httpOnly: true, sameSite: 'None', expires: '2027-01-01T00:00:00.000Z', hostOnly: false });
    expect(spec.sameSite).toBe('no_restriction');
    expect(spec.expirationDate).toBe(Date.parse('2027-01-01T00:00:00.000Z') / 1000);
  });
});
