// Protocolo do payload transplantado + verificação de frescor (anti-replay). Puro.

export const PROTOCOL_VERSION = 1;
export const MAX_AGE_MS = 120000;   // janela máxima para o passado
export const SKEW_MS = 60000;       // tolerância de relógio adiantado (futuro)

export function buildPayload(cookies, now, nonce) {
  return { v: PROTOCOL_VERSION, ts: now, nonce, cookies };
}

// seenNonces: objeto com .has(nonce) e .add(nonce, ts) — Set simples ou NonceStore.
export function checkFreshness(payload, now, seenNonces) {
  if (!payload || payload.v !== PROTOCOL_VERSION) return { ok: false, reason: 'version' };
  if (typeof payload.ts !== 'number' || now - payload.ts > MAX_AGE_MS || payload.ts - now > SKEW_MS) {
    return { ok: false, reason: 'expired' };
  }
  if (!payload.nonce || seenNonces.has(payload.nonce)) return { ok: false, reason: 'replay' };
  seenNonces.add(payload.nonce, now);
  return { ok: true };
}
