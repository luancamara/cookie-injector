// Lógica pura do relay (sem APIs Cloudflare) — testável em Node.

export const TTL_MS = 120000;

export function validRoom(room) {
  return typeof room === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(room);
}

export function isFresh(last, now, ttl = TTL_MS) {
  return !!last && typeof last.ts === 'number' && (now - last.ts) <= ttl;
}
