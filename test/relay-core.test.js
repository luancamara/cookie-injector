import { describe, it, expect } from 'vitest';
import { validRoom, isFresh, TTL_MS } from '../relay/src/room-core.js';

describe('relay room-core', () => {
  it('validRoom aceita base64url 16-64 e rejeita o resto', () => {
    expect(validRoom('A'.repeat(43))).toBe(true);
    expect(validRoom('curto')).toBe(false);
    expect(validRoom('tem espaco e simbolos !!!!!!!!!!')).toBe(false);
    expect(validRoom(null)).toBe(false);
    expect(validRoom('A'.repeat(65))).toBe(false);
  });

  it('isFresh respeita o TTL', () => {
    expect(isFresh({ data: 'x', ts: 1000 }, 1000)).toBe(true);
    expect(isFresh({ data: 'x', ts: 1000 }, 1000 + TTL_MS)).toBe(true);
    expect(isFresh({ data: 'x', ts: 1000 }, 1000 + TTL_MS + 1)).toBe(false);
    expect(isFresh(null, 1000)).toBe(false);
    expect(isFresh(undefined, 1000)).toBe(false);
  });
});
