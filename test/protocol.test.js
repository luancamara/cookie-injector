import { describe, it, expect } from 'vitest';
import { buildPayload, checkFreshness, MAX_AGE_MS, PROTOCOL_VERSION } from '../src/protocol.js';

describe('protocol', () => {
  it('buildPayload monta envelope versionado', () => {
    const p = buildPayload([{ name: 'a' }], 1000, 'n1');
    expect(p).toEqual({ v: PROTOCOL_VERSION, ts: 1000, nonce: 'n1', cookies: [{ name: 'a' }] });
  });

  it('aceita payload fresco e novo', () => {
    const seen = new Set();
    expect(checkFreshness(buildPayload([], 5000, 'n1'), 5000, seen)).toEqual({ ok: true });
    expect(seen.has('n1')).toBe(true);
  });

  it('rejeita replay (nonce repetido)', () => {
    const seen = new Set();
    const p = buildPayload([], 5000, 'n1');
    checkFreshness(p, 5000, seen);
    expect(checkFreshness(p, 5000, seen)).toEqual({ ok: false, reason: 'replay' });
  });

  it('rejeita expirado', () => {
    const r = checkFreshness(buildPayload([], 1000, 'n1'), 1000 + MAX_AGE_MS + 1, new Set());
    expect(r).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejeita versão incompatível', () => {
    const r = checkFreshness({ v: 999, ts: 1000, nonce: 'n1', cookies: [] }, 1000, new Set());
    expect(r).toEqual({ ok: false, reason: 'version' });
  });
});
