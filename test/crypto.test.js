import { describe, it, expect } from 'vitest';
import {
  randomSecret, deriveRoomId, deriveKey, encryptJSON, decryptJSON, toB64url, fromB64url,
} from '../src/crypto.js';

describe('crypto', () => {
  it('randomSecret é base64url de ~43 chars e diferente a cada chamada', () => {
    const a = randomSecret(), b = randomSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(42);
    expect(a).not.toBe(b);
  });

  it('b64url round-trip', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255]);
    expect(Array.from(fromB64url(toB64url(bytes)))).toEqual(Array.from(bytes));
  });

  it('deriveRoomId é determinístico e depende do segredo', async () => {
    const s = randomSecret();
    expect(await deriveRoomId(s)).toBe(await deriveRoomId(s));
    expect(await deriveRoomId(s)).not.toBe(await deriveRoomId(randomSecret()));
  });

  it('encryptJSON/decryptJSON faz round-trip e o envelope não vaza o texto', async () => {
    const key = await deriveKey(randomSecret());
    const obj = { v: 1, ts: 123, nonce: 'abc', cookies: [{ name: 'sid', value: 'segredo-xyz' }] };
    const env = await encryptJSON(key, obj);
    expect(env).not.toContain('segredo-xyz');
    expect(await decryptJSON(key, env)).toEqual(obj);
  });

  it('chave errada falha ao decifrar', async () => {
    const env = await encryptJSON(await deriveKey(randomSecret()), { a: 1 });
    await expect(decryptJSON(await deriveKey(randomSecret()), env)).rejects.toBeTruthy();
  });
});
