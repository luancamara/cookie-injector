import { describe, it, expect, vi } from 'vitest';
import { handleIncoming } from '../src/receiver.js';
import { deriveKey, randomSecret, encryptJSON } from '../src/crypto.js';
import { buildPayload } from '../src/protocol.js';

function fakeApi() {
  const store = [];
  return { store, set: vi.fn(async (d) => { store.push(d); return d; }), getAll: vi.fn(async () => store), remove: vi.fn(async () => ({})) };
}
const cookie = { name: 'a', value: '1', domain: 'x.com', path: '/', secure: false, httpOnly: false, sameSite: 'unspecified', expirationDate: null, hostOnly: true };

describe('receiver', () => {
  it('decifra, valida e injeta', async () => {
    const secret = randomSecret();
    const key = await deriveKey(secret);
    const env = await encryptJSON(key, buildPayload([cookie], 1000, 'n1'));
    const notify = vi.fn();
    const res = await handleIncoming({ key, cookiesApi: fakeApi(), seenNonces: new Set(), now: 1000, notify }, env);
    expect(res).toEqual({ ok: 1, fail: 0 });
    expect(notify).toHaveBeenCalled();
  });

  it('rejeita quando a chave não confere', async () => {
    const env = await encryptJSON(await deriveKey(randomSecret()), buildPayload([cookie], 1000, 'n1'));
    const res = await handleIncoming({ key: await deriveKey(randomSecret()), cookiesApi: fakeApi(), seenNonces: new Set(), now: 1000 }, env);
    expect(res).toEqual({ rejected: 'decrypt' });
  });

  it('rejeita replay', async () => {
    const key = await deriveKey(randomSecret());
    const env = await encryptJSON(key, buildPayload([cookie], 1000, 'n1'));
    const seen = new Set();
    await handleIncoming({ key, cookiesApi: fakeApi(), seenNonces: seen, now: 1000 }, env);
    const res = await handleIncoming({ key, cookiesApi: fakeApi(), seenNonces: seen, now: 1000 }, env);
    expect(res).toEqual({ rejected: 'replay' });
  });
});
