// Protocolo do payload transplantado + verificação de frescor (anti-replay). Puro.

export const PROTOCOL_VERSION = 1;
export const MAX_AGE_MS = 120000;

export function buildPayload(cookies, now, nonce) {
  return { v: PROTOCOL_VERSION, ts: now, nonce, cookies };
}

export function checkFreshness(payload, now, seenNonces) {
  if (!payload || payload.v !== PROTOCOL_VERSION) return { ok: false, reason: 'version' };
  if (typeof payload.ts !== 'number' || now - payload.ts > MAX_AGE_MS) return { ok: false, reason: 'expired' };
  if (!payload.nonce || seenNonces.has(payload.nonce)) return { ok: false, reason: 'replay' };
  seenNonces.add(payload.nonce);
  return { ok: true };
}
