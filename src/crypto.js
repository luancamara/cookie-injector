// Módulo puro E2E: HKDF (derivação de room/chave) + AES-GCM (cifra do payload).
// Sem dependências de chrome.* nem rede — testável em Node (webcrypto global).

const enc = new TextEncoder();
const dec = new TextDecoder();
const ROOM_INFO = enc.encode('cookie-injector/room/v1');
const ENC_INFO = enc.encode('cookie-injector/enc/v1');
const SALT = enc.encode('cookie-injector/hkdf-salt/v1');

export function toB64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomSecret() {
  return toB64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function hkdfBits(secret, info, bits) {
  const base = await crypto.subtle.importKey('raw', fromB64url(secret), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info }, base, bits),
  );
}

export async function deriveRoomId(secret) {
  return toB64url(await hkdfBits(secret, ROOM_INFO, 256));
}

export async function deriveKey(secret) {
  const base = await crypto.subtle.importKey('raw', fromB64url(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: SALT, info: ENC_INFO },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptJSON(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = enc.encode(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return toB64url(out);
}

export async function decryptJSON(key, envelope) {
  const raw = fromB64url(envelope);
  const iv = raw.slice(0, 12);
  const ct = raw.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(dec.decode(pt));
}
