import { describe, it, expect } from 'vitest';
import { getSecret, setSecret, ensureSecret, rotateSecret, getRoomAndKey, getRelayUrl } from '../src/config.js';

function fakeStorage(init = {}) {
  const data = { ...init };
  return {
    data,
    get: async (k) => (typeof k === 'string' ? { [k]: data[k] } : Object.fromEntries(Object.keys(k).map((x) => [x, data[x]]))),
    set: async (obj) => { Object.assign(data, obj); },
    remove: async (k) => { delete data[k]; },
  };
}

describe('config', () => {
  it('ensureSecret cria uma vez e reusa depois', async () => {
    const s = fakeStorage();
    const a = await ensureSecret(s);
    expect(a).toBeTruthy();
    expect(await ensureSecret(s)).toBe(a);
    expect(await getSecret(s)).toBe(a);
  });

  it('rotateSecret troca o valor', async () => {
    const s = fakeStorage();
    const a = await ensureSecret(s);
    const b = await rotateSecret(s);
    expect(b).not.toBe(a);
    expect(await getSecret(s)).toBe(b);
  });

  it('getRoomAndKey deriva room e chave usável', async () => {
    const s = fakeStorage();
    await ensureSecret(s);
    const rk = await getRoomAndKey(s);
    expect(rk.roomId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(rk.key).toBeTruthy();
  });

  it('getRoomAndKey é null sem segredo', async () => {
    expect(await getRoomAndKey(fakeStorage())).toBe(null);
  });

  it('getRelayUrl usa default e aceita override', async () => {
    expect(await getRelayUrl(fakeStorage())).toMatch(/^wss:\/\//);
    expect(await getRelayUrl(fakeStorage({ relayUrl: 'wss://meu.dev' }))).toBe('wss://meu.dev');
  });
});
