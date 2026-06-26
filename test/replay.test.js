import { describe, it, expect } from 'vitest';
import { createNonceStore } from '../src/replay.js';
import { MAX_AGE_MS } from '../src/protocol.js';

function fakeStorage(init = {}) {
  const data = { ...init };
  return {
    data,
    get: async (k) => ({ [k]: data[k] }),
    set: async (o) => { Object.assign(data, o); },
  };
}

describe('replay nonce store', () => {
  it('detecta replay e persiste no storage', async () => {
    const s = fakeStorage();
    const store = createNonceStore(s);
    await store.load();
    expect(store.has('n1')).toBe(false);
    store.add('n1', 1000);
    expect(store.has('n1')).toBe(true);
    expect(s.data.seenNonces.n1).toBe(1000);
  });

  it('sobrevive a reinício do service worker (recarrega do storage)', async () => {
    const s = fakeStorage();
    const now = Date.now();
    const a = createNonceStore(s); await a.load(); a.add('n1', now);
    const b = createNonceStore(s); await b.load();
    expect(b.has('n1')).toBe(true);
  });

  it('poda nonces antigos ao carregar', async () => {
    const s = fakeStorage({ seenNonces: { old: 0 } }); // ts 0 << agora
    const store = createNonceStore(s);
    await store.load();
    expect(store.has('old')).toBe(false);
  });

  it('add poda entradas além de MAX_AGE_MS relativas ao novo ts', async () => {
    const s = fakeStorage();
    const store = createNonceStore(s);
    await store.load();
    store.add('old', 1000);
    store.add('new', 1000 + MAX_AGE_MS + 1);
    expect(store.has('old')).toBe(false);
    expect(store.has('new')).toBe(true);
  });
});
