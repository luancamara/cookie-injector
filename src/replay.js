// Armazena nonces vistos de forma PERSISTENTE (sobrevive ao reciclo do service
// worker MV3) e podada pela janela MAX_AGE_MS. Interface compatível com Set
// (.has/.add) para uso direto em protocol.checkFreshness.

import { MAX_AGE_MS } from './protocol.js';

export function createNonceStore(storage, key = 'seenNonces') {
  let map = new Map(); // nonce -> ts

  function prune(now) {
    for (const [n, ts] of map) if (now - ts > MAX_AGE_MS) map.delete(n);
  }

  function persist() {
    try { storage.set({ [key]: Object.fromEntries(map) }); } catch { /* best-effort */ }
  }

  async function load() {
    try {
      const d = await storage.get(key);
      const obj = (d && d[key]) || {};
      map = new Map(Object.entries(obj).map(([n, ts]) => [n, Number(ts)]));
    } catch {
      map = new Map();
    }
    prune(Date.now());
  }

  return {
    load,
    prune,
    has: (nonce) => map.has(nonce),
    add: (nonce, ts = Date.now()) => { prune(ts); map.set(nonce, ts); persist(); },
    get size() { return map.size; },
  };
}
