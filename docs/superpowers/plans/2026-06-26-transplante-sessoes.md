# Transplante automático de sessões — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transplantar todos os cookies de um perfil Chrome para outra máquina do mesmo dono, automaticamente (push, zero clique no destino), via relay Cloudflare Worker+Durable Object com criptografia ponta-a-ponta.

**Architecture:** Extensão MV3 (mesmo código nas duas pontas) mantém um WebSocket persistente com um relay (Worker→Durable Object por sala). A origem lê `chrome.cookies.getAll({})`, cifra com AES-GCM (chave derivada via HKDF de um segredo compartilhado) e envia; o destino recebe no service worker, descriptografa e injeta sozinho. O relay só repassa bytes cifrados.

**Tech Stack:** JavaScript ESM (sem bundler), Chrome Extensions MV3, Web Crypto API (SubtleCrypto), Cloudflare Workers + Durable Objects (SQLite, free tier), Vitest (testes Node), Wrangler/Miniflare (relay).

## Global Constraints

- Manifest V3; ESM nativo (`"type": "module"` no service worker, `<script type="module">` no popup). Sem bundler/build step.
- Módulos puros (`crypto`, `protocol`) NÃO importam `chrome.*` nem rede — testáveis em Node 24 (webcrypto global).
- Módulos que tocam `chrome.*` recebem a API por parâmetro (default `globalThis.chrome`) para permitir mock nos testes.
- Criptografia: AES-GCM 256, IV aleatório de 12 bytes, HKDF-SHA256. `info` de derivação: room = `"cookie-injector/room/v1"`, enc = `"cookie-injector/enc/v1"`.
- Anti-replay: payload com `{ v:1, ts, nonce, cookies }`; janela máxima de frescor = 120000 ms; nonces vistos guardados em memória do SW.
- Segredo = 32 bytes aleatórios em base64url, guardado em `chrome.storage.local` chave `secret`.
- Formato canônico de cookie (wire e injeção): `{ name, value, domain, path, secure, httpOnly, sameSite, expirationDate, hostOnly, session }` com `sameSite` no enum do Chrome (`'no_restriction'|'lax'|'strict'|'unspecified'`) e `expirationDate` em segundos (number) ou `null`.
- Relay free-tier: Durable Object com migração `new_sqlite_classes`.
- Commits frequentes, um por tarefa. Mensagens em pt-BR, prefixo convencional (`feat:`/`refactor:`/`test:`/`docs:`/`chore:`).

---

### Task 0: Tooling de testes e estrutura

**Files:**
- Create: `package.json`
- Create: `vitest.config.js`
- Create: `src/.gitkeep`
- Create: `test/.gitkeep`
- Modify: `.gitignore` (add `node_modules`)

**Interfaces:**
- Produces: scripts `npm test` (vitest run), estrutura `src/` e `test/`.

- [ ] **Step 1: Criar package.json**

```json
{
  "name": "cookie-injector",
  "version": "1.3.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 2: Criar vitest.config.js**

```js
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.js'] },
});
```

- [ ] **Step 3: Garantir node_modules no .gitignore**

Edição: acrescentar uma linha `node_modules` ao `.gitignore` (se ainda não existir). Criar `src/.gitkeep` e `test/.gitkeep` vazios.

- [ ] **Step 4: Instalar e rodar vitest vazio**

Run: `npm install && npx vitest run --passWithNoTests`
Expected: instala vitest; saída "No test files found" sem erro (exit 0).

- [ ] **Step 5: Commit**

```bash
git add package.json vitest.config.js .gitignore src/.gitkeep test/.gitkeep
git commit -m "chore: tooling de testes (vitest) e estrutura src/test"
```

---

### Task 1: crypto.js (módulo puro E2E)

**Files:**
- Create: `src/crypto.js`
- Test: `test/crypto.test.js`

**Interfaces:**
- Produces:
  - `randomSecret(): string` — 32 bytes aleatórios em base64url.
  - `deriveRoomId(secret: string): Promise<string>` — base64url de HKDF(info room), determinístico.
  - `deriveKey(secret: string): Promise<CryptoKey>` — AES-GCM 256 de HKDF(info enc).
  - `encryptJSON(key: CryptoKey, obj: any): Promise<string>` — envelope base64url = base64url(iv(12)||ciphertext).
  - `decryptJSON(key: CryptoKey, envelope: string): Promise<any>`.
  - `toB64url(bytes: Uint8Array): string`, `fromB64url(s: string): Uint8Array`.

- [ ] **Step 1: Escrever testes que falham**

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run test/crypto.test.js`
Expected: FAIL (módulo/símbolos inexistentes).

- [ ] **Step 3: Implementar src/crypto.js**

```js
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
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info }, base, bits));
}

export async function deriveRoomId(secret) {
  return toB64url(await hkdfBits(secret, ROOM_INFO, 256));
}

export async function deriveKey(secret) {
  const base = await crypto.subtle.importKey('raw', fromB64url(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: SALT, info: ENC_INFO },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export async function encryptJSON(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = enc.encode(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0); out.set(ct, iv.length);
  return toB64url(out);
}

export async function decryptJSON(key, envelope) {
  const raw = fromB64url(envelope);
  const iv = raw.slice(0, 12), ct = raw.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(dec.decode(pt));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run test/crypto.test.js`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/crypto.js test/crypto.test.js
git commit -m "feat: módulo crypto E2E (HKDF + AES-GCM) com testes"
```

---

### Task 2: protocol.js (payload + anti-replay, puro)

**Files:**
- Create: `src/protocol.js`
- Test: `test/protocol.test.js`

**Interfaces:**
- Produces:
  - `buildPayload(cookies: object[], now: number, nonce: string): {v,ts,nonce,cookies}`.
  - `PROTOCOL_VERSION = 1`, `MAX_AGE_MS = 120000`.
  - `checkFreshness(payload, now, seenNonces: Set<string>): {ok:boolean, reason?:string}` — marca o nonce como visto quando ok.

- [ ] **Step 1: Escrever testes que falham**

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run test/protocol.test.js` → FAIL.

- [ ] **Step 3: Implementar src/protocol.js**

```js
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
```

- [ ] **Step 4: Rodar e ver passar** → `npx vitest run test/protocol.test.js` PASS.

- [ ] **Step 5: Commit**

```bash
git add src/protocol.js test/protocol.test.js
git commit -m "feat: protocolo de payload com anti-replay e testes"
```

---

### Task 3: exporter.js (lê todos os cookies)

**Files:**
- Create: `src/exporter.js`
- Test: `test/exporter.test.js`

**Interfaces:**
- Consumes: API `chrome.cookies` (passada como argumento).
- Produces:
  - `toRecord(cookie): canonicalRecord` — mapeia cookie nativo → formato canônico.
  - `collectAllCookies(cookiesApi = globalThis.chrome?.cookies): Promise<canonicalRecord[]>` — `getAll({})`, dedup por `name|domain|path`, ordenado.

- [ ] **Step 1: Escrever testes que falham**

```js
import { describe, it, expect } from 'vitest';
import { toRecord, collectAllCookies } from '../src/exporter.js';

const fakeCookies = (list) => ({ getAll: async () => list });

describe('exporter', () => {
  it('toRecord mapeia campos nativos', () => {
    const r = toRecord({
      name: 'sid', value: 'v', domain: '.x.com', path: '/', secure: true,
      httpOnly: true, sameSite: 'no_restriction', expirationDate: 111, hostOnly: false, session: false,
    });
    expect(r).toEqual({
      name: 'sid', value: 'v', domain: '.x.com', path: '/', secure: true,
      httpOnly: true, sameSite: 'no_restriction', expirationDate: 111, hostOnly: false, session: false,
    });
  });

  it('cookie de sessão vira expirationDate null', () => {
    expect(toRecord({ name: 'a', value: '1', domain: 'x.com', path: '/', session: true }).expirationDate).toBe(null);
  });

  it('collectAllCookies remove duplicados e ordena', async () => {
    const api = fakeCookies([
      { name: 'b', value: '1', domain: 'z.com', path: '/' },
      { name: 'a', value: '1', domain: 'z.com', path: '/' },
      { name: 'a', value: '1', domain: 'z.com', path: '/' },
    ]);
    const out = await collectAllCookies(api);
    expect(out.map((c) => c.name)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** → FAIL.

- [ ] **Step 3: Implementar src/exporter.js**

```js
export function toRecord(c) {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
    sameSite: c.sameSite || 'unspecified',
    expirationDate: c.session ? null : (typeof c.expirationDate === 'number' ? c.expirationDate : null),
    hostOnly: !!c.hostOnly,
    session: !!c.session,
  };
}

export async function collectAllCookies(cookiesApi = globalThis.chrome?.cookies) {
  const all = await cookiesApi.getAll({});
  const seen = new Set();
  const out = [];
  for (const c of all) {
    const key = c.name + '|' + c.domain + '|' + (c.path || '/');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(toRecord(c));
  }
  out.sort((a, b) => (a.domain + a.name).localeCompare(b.domain + b.name));
  return out;
}
```

- [ ] **Step 4: Rodar e ver passar** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/exporter.js test/exporter.test.js
git commit -m "feat: exporter de todos os cookies (formato canônico) com testes"
```

---

### Task 4: injector.js (injeção, refatorado do popup)

**Files:**
- Create: `src/injector.js`
- Test: `test/injector.test.js`

**Interfaces:**
- Consumes: API `chrome.cookies`.
- Produces:
  - `setCookie(cookiesApi, spec): Promise<cookie|null>` — `spec` no formato canônico; grava e limpa variantes conflitantes só após sucesso.
  - `injectAll(cookiesApi, specs, onResult): Promise<{ok:number, fail:number}>` — itera; `onResult(spec, ok, err)` opcional.
  - `fromDevtoolsParsed(parsed): spec` — converte o objeto do parser de DevTools (sameSite token + `expires` string) para o formato canônico.

- [ ] **Step 1: Escrever testes que falham**

```js
import { describe, it, expect, vi } from 'vitest';
import { setCookie, injectAll, fromDevtoolsParsed } from '../src/injector.js';

function fakeApi() {
  const store = [];
  return {
    store,
    set: vi.fn(async (d) => { const c = { ...d, domain: d.domain || d.url.replace(/^https?:\/\//, '').split('/')[0] }; store.push(c); return c; }),
    getAll: vi.fn(async () => store),
    remove: vi.fn(async () => ({})),
  };
}

describe('injector', () => {
  it('setCookie grava com url e domain corretos (host-only sem domain)', async () => {
    const api = fakeApi();
    const r = await setCookie(api, { name: 'a', value: '1', domain: 'x.com', path: '/', secure: true, httpOnly: false, sameSite: 'lax', expirationDate: null, hostOnly: true });
    expect(r).toBeTruthy();
    const d = api.set.mock.calls[0][0];
    expect(d.url).toBe('https://x.com/');
    expect(d.domain).toBeUndefined();
    expect(d.sameSite).toBe('lax');
  });

  it('cookie de domínio inclui domain e expirationDate', async () => {
    const api = fakeApi();
    await setCookie(api, { name: 'a', value: '1', domain: '.x.com', path: '/', secure: true, httpOnly: true, sameSite: 'no_restriction', expirationDate: 222, hostOnly: false });
    const d = api.set.mock.calls[0][0];
    expect(d.domain).toBe('.x.com');
    expect(d.expirationDate).toBe(222);
  });

  it('injectAll conta sucessos e falhas', async () => {
    const api = fakeApi();
    api.set.mockImplementationOnce(async () => null).mockImplementationOnce(async (d) => ({ ...d }));
    const res = await injectAll(api, [
      { name: 'a', value: '1', domain: 'x.com', path: '/', secure: false, httpOnly: false, sameSite: 'unspecified', expirationDate: null, hostOnly: true },
      { name: 'b', value: '2', domain: 'x.com', path: '/', secure: false, httpOnly: false, sameSite: 'unspecified', expirationDate: null, hostOnly: true },
    ]);
    expect(res).toEqual({ ok: 1, fail: 1 });
  });

  it('fromDevtoolsParsed converte token e expires', () => {
    const spec = fromDevtoolsParsed({ name: 'a', value: '1', domain: '.x.com', path: '/', secure: true, httpOnly: true, sameSite: 'None', expires: '2027-01-01T00:00:00.000Z', hostOnly: false });
    expect(spec.sameSite).toBe('no_restriction');
    expect(spec.expirationDate).toBe(Date.parse('2027-01-01T00:00:00.000Z') / 1000);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** → FAIL.

- [ ] **Step 3: Implementar src/injector.js**

```js
const SAME_SITE_TOKEN = { none: 'no_restriction', lax: 'lax', strict: 'strict' };

async function removeConflictingVariants(cookiesApi, name, host, path, justSetDomain) {
  let existing;
  try { existing = await cookiesApi.getAll({ name, domain: host }); } catch { return; }
  const variants = new Set(['.' + host, host]);
  for (const e of existing) {
    if (e.name !== name || e.path !== path) continue;
    if (e.domain === justSetDomain) continue;
    if (!variants.has(e.domain)) continue;
    const scheme = e.secure ? 'https://' : 'http://';
    try { await cookiesApi.remove({ url: scheme + e.domain.replace(/^\./, '') + e.path, name: e.name }); } catch { /* ignora */ }
  }
}

export async function setCookie(cookiesApi, spec) {
  const host = spec.domain.replace(/^\./, '');
  const scheme = spec.secure ? 'https://' : 'http://';
  const path = spec.path || '/';
  const details = {
    url: scheme + host + path,
    name: spec.name,
    value: spec.value,
    path,
    secure: !!spec.secure,
    httpOnly: !!spec.httpOnly,
  };
  if (!spec.hostOnly) details.domain = spec.domain;
  if (spec.sameSite && spec.sameSite !== 'unspecified') details.sameSite = spec.sameSite;
  if (typeof spec.expirationDate === 'number') details.expirationDate = spec.expirationDate;
  const result = await cookiesApi.set(details);
  if (result) await removeConflictingVariants(cookiesApi, spec.name, host, path, result.domain);
  return result;
}

export async function injectAll(cookiesApi, specs, onResult) {
  let ok = 0, fail = 0;
  for (const spec of specs) {
    try {
      const r = await setCookie(cookiesApi, spec);
      if (r) { ok++; onResult?.(spec, true); }
      else { fail++; onResult?.(spec, false); }
    } catch (e) { fail++; onResult?.(spec, false, e); }
  }
  return { ok, fail };
}

export function fromDevtoolsParsed(c) {
  let expirationDate = null;
  if (c.expires && !/^session$/i.test(c.expires)) {
    const t = Date.parse(c.expires);
    if (!isNaN(t)) expirationDate = t / 1000;
  }
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
    sameSite: SAME_SITE_TOKEN[String(c.sameSite || '').toLowerCase()] || 'unspecified',
    expirationDate,
    hostOnly: !!c.hostOnly,
  };
}
```

- [ ] **Step 4: Rodar e ver passar** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/injector.js test/injector.test.js
git commit -m "feat: módulo injector (setCookie/injectAll/fromDevtoolsParsed) com testes"
```

---

### Task 5: config.js (segredo + derivação)

**Files:**
- Create: `src/config.js`
- Test: `test/config.test.js`

**Interfaces:**
- Consumes: `crypto.js`; storage tipo `chrome.storage.local` (passado como argumento).
- Produces:
  - `getSecret(storage): Promise<string|null>`, `setSecret(storage, secret): Promise<void>`.
  - `ensureSecret(storage): Promise<string>` — cria e salva se ausente.
  - `rotateSecret(storage): Promise<string>` — gera novo e salva.
  - `getRoomAndKey(storage): Promise<{roomId, key}|null>` — null se sem segredo.
  - `getRelayUrl(storage): Promise<string>` — default `DEFAULT_RELAY_URL` de `constants.js`, override storage `relayUrl`.

- [ ] **Step 1: Criar src/constants.js**

```js
// Atualize para o domínio real após o deploy do relay (Task 8).
export const DEFAULT_RELAY_URL = 'wss://cookie-injector-relay.example.workers.dev';
```

- [ ] **Step 2: Escrever testes que falham**

```js
import { describe, it, expect } from 'vitest';
import { getSecret, setSecret, ensureSecret, rotateSecret, getRoomAndKey, getRelayUrl } from '../src/config.js';

function fakeStorage(init = {}) {
  const data = { ...init };
  return {
    data,
    get: async (k) => (typeof k === 'string' ? { [k]: data[k] } : Object.fromEntries(Object.keys(k).map((x) => [x, data[x]]))),
    set: async (obj) => { Object.assign(data, obj); },
    remove: async (k) => { delete data[k]; },
  };
}

describe('config', () => {
  it('ensureSecret cria uma vez e reusa depois', async () => {
    const s = fakeStorage();
    const a = await ensureSecret(s);
    expect(a).toBeTruthy();
    expect(await ensureSecret(s)).toBe(a);
    expect(await getSecret(s)).toBe(a);
  });

  it('rotateSecret troca o valor', async () => {
    const s = fakeStorage();
    const a = await ensureSecret(s);
    const b = await rotateSecret(s);
    expect(b).not.toBe(a);
    expect(await getSecret(s)).toBe(b);
  });

  it('getRoomAndKey deriva room e chave usável', async () => {
    const s = fakeStorage();
    await ensureSecret(s);
    const rk = await getRoomAndKey(s);
    expect(rk.roomId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(rk.key).toBeTruthy();
  });

  it('getRoomAndKey é null sem segredo', async () => {
    expect(await getRoomAndKey(fakeStorage())).toBe(null);
  });

  it('getRelayUrl usa default e aceita override', async () => {
    expect(await getRelayUrl(fakeStorage())).toMatch(/^wss:\/\//);
    expect(await getRelayUrl(fakeStorage({ relayUrl: 'wss://meu.dev' }))).toBe('wss://meu.dev');
  });
});
```

- [ ] **Step 3: Rodar e ver falhar** → FAIL.

- [ ] **Step 4: Implementar src/config.js**

```js
import { randomSecret, deriveRoomId, deriveKey } from './crypto.js';
import { DEFAULT_RELAY_URL } from './constants.js';

export async function getSecret(storage) {
  const d = await storage.get('secret');
  return (d && d.secret) || null;
}

export async function setSecret(storage, secret) {
  await storage.set({ secret });
}

export async function ensureSecret(storage) {
  const cur = await getSecret(storage);
  if (cur) return cur;
  const s = randomSecret();
  await setSecret(storage, s);
  return s;
}

export async function rotateSecret(storage) {
  const s = randomSecret();
  await setSecret(storage, s);
  return s;
}

export async function getRoomAndKey(storage) {
  const secret = await getSecret(storage);
  if (!secret) return null;
  const [roomId, key] = await Promise.all([deriveRoomId(secret), deriveKey(secret)]);
  return { roomId, key };
}

export async function getRelayUrl(storage) {
  const d = await storage.get('relayUrl');
  return (d && d.relayUrl) || DEFAULT_RELAY_URL;
}
```

- [ ] **Step 5: Rodar e ver passar** → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/constants.js src/config.js test/config.test.js
git commit -m "feat: config de segredo/derivação (room+chave) e relay url, com testes"
```

---

### Task 6: receiver.js (orquestra recebimento)

**Files:**
- Create: `src/receiver.js`
- Test: `test/receiver.test.js`

**Interfaces:**
- Consumes: `crypto.decryptJSON`, `protocol.checkFreshness`, `injector.injectAll`.
- Produces:
  - `handleIncoming(ctx, envelope): Promise<{ok,fail}|{rejected:string}>` onde `ctx = { key, cookiesApi, seenNonces, now, notify? }`.
    - decifra; se falhar → `{rejected:'decrypt'}` (notify 'segredo não confere').
    - checa frescor; se falhar → `{rejected:reason}`.
    - injeta; retorna `{ok,fail}` e notifica total.

- [ ] **Step 1: Escrever testes que falham**

```js
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
    const secret = randomSecret(); const key = await deriveKey(secret);
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
```

- [ ] **Step 2: Rodar e ver falhar** → FAIL.

- [ ] **Step 3: Implementar src/receiver.js**

```js
import { decryptJSON } from './crypto.js';
import { checkFreshness } from './protocol.js';
import { injectAll } from './injector.js';

export async function handleIncoming(ctx, envelope) {
  const { key, cookiesApi, seenNonces, now, notify } = ctx;
  let payload;
  try {
    payload = await decryptJSON(key, envelope);
  } catch {
    notify?.({ kind: 'error', reason: 'decrypt', message: 'Segredo não confere — repareie as máquinas.' });
    return { rejected: 'decrypt' };
  }
  const fresh = checkFreshness(payload, now, seenNonces);
  if (!fresh.ok) {
    notify?.({ kind: 'error', reason: fresh.reason, message: 'Pacote ignorado (' + fresh.reason + ').' });
    return { rejected: fresh.reason };
  }
  const res = await injectAll(cookiesApi, payload.cookies);
  notify?.({ kind: 'received', ...res, total: payload.cookies.length });
  return res;
}
```

- [ ] **Step 4: Rodar e ver passar** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/receiver.js test/receiver.test.js
git commit -m "feat: receiver (decifra→valida→injeta→notifica) com testes"
```

---

### Task 7: transport.js (cliente WebSocket resiliente)

**Files:**
- Create: `src/transport.js`
- Test: `test/transport.test.js`

**Interfaces:**
- Produces:
  - `createTransport({ url, roomId, onMessage, onStatus, WebSocketImpl?, setTimeoutImpl?, clearTimeoutImpl?, heartbeatMs?, backoffMaxMs? }): { connect, send, close, isOpen }`.
    - `connect()` abre `new WebSocketImpl(url + '?room=' + roomId)`.
    - ao abrir: `onStatus('open')`, inicia heartbeat (envia `{"type":"ping"}` a cada `heartbeatMs`).
    - mensagens `{"type":"pong"}` são ignoradas; `{"type":"pkt","data":...}` chamam `onMessage(data)`.
    - ao fechar: `onStatus('closed')` e reconecta com backoff exponencial (até `backoffMaxMs`).
    - `send(dataStr)` envia `{"type":"pkt","data":dataStr}` se aberto; senão retorna false.

- [ ] **Step 1: Escrever testes que falham**

```js
import { describe, it, expect, vi } from 'vitest';
import { createTransport } from '../src/transport.js';

class FakeWS {
  constructor(url) { this.url = url; this.sent = []; FakeWS.last = this; this.readyState = 0; }
  send(s) { this.sent.push(s); }
  close() { this.readyState = 3; this.onclose?.({}); }
  open() { this.readyState = 1; this.onopen?.({}); }
  msg(obj) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

describe('transport', () => {
  it('conecta na url com room e marca open', () => {
    const onStatus = vi.fn();
    const t = createTransport({ url: 'wss://r', roomId: 'ROOM', onMessage: () => {}, onStatus, WebSocketImpl: FakeWS });
    t.connect();
    expect(FakeWS.last.url).toBe('wss://r?room=ROOM');
    FakeWS.last.open();
    expect(onStatus).toHaveBeenCalledWith('open');
    expect(t.isOpen()).toBe(true);
  });

  it('entrega pkt via onMessage e ignora pong', () => {
    const onMessage = vi.fn();
    const t = createTransport({ url: 'wss://r', roomId: 'ROOM', onMessage, onStatus: () => {}, WebSocketImpl: FakeWS });
    t.connect(); FakeWS.last.open();
    FakeWS.last.msg({ type: 'pong' });
    FakeWS.last.msg({ type: 'pkt', data: 'ENVELOPE' });
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith('ENVELOPE');
  });

  it('send embrulha em pkt quando aberto', () => {
    const t = createTransport({ url: 'wss://r', roomId: 'ROOM', onMessage: () => {}, onStatus: () => {}, WebSocketImpl: FakeWS });
    t.connect(); FakeWS.last.open();
    expect(t.send('ABC')).toBe(true);
    expect(JSON.parse(FakeWS.last.sent.at(-1))).toEqual({ type: 'pkt', data: 'ABC' });
  });

  it('reconecta após close', () => {
    let timer = null;
    const setT = (fn) => { timer = fn; return 1; };
    const t = createTransport({ url: 'wss://r', roomId: 'ROOM', onMessage: () => {}, onStatus: () => {}, WebSocketImpl: FakeWS, setTimeoutImpl: setT, clearTimeoutImpl: () => {} });
    t.connect(); const first = FakeWS.last; first.open();
    first.close();
    expect(typeof timer).toBe('function');
    timer();
    expect(FakeWS.last).not.toBe(first);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** → FAIL.

- [ ] **Step 3: Implementar src/transport.js**

```js
export function createTransport(opts) {
  const {
    url, roomId, onMessage, onStatus,
    WebSocketImpl = globalThis.WebSocket,
    setTimeoutImpl = globalThis.setTimeout.bind(globalThis),
    clearTimeoutImpl = globalThis.clearTimeout.bind(globalThis),
    heartbeatMs = 20000,
    backoffMaxMs = 30000,
  } = opts;

  let ws = null;
  let hbTimer = null;
  let reconnectTimer = null;
  let backoff = 1000;
  let closedByUser = false;

  function heartbeat() {
    stopHeartbeat();
    hbTimer = setTimeoutImpl(function tick() {
      if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify({ type: 'ping' })); } catch {} }
      hbTimer = setTimeoutImpl(tick, heartbeatMs);
    }, heartbeatMs);
  }
  function stopHeartbeat() { if (hbTimer) { clearTimeoutImpl(hbTimer); hbTimer = null; } }

  function scheduleReconnect() {
    if (closedByUser) return;
    if (reconnectTimer) clearTimeoutImpl(reconnectTimer);
    reconnectTimer = setTimeoutImpl(() => { backoff = Math.min(backoff * 2, backoffMaxMs); connect(); }, backoff);
  }

  function connect() {
    closedByUser = false;
    ws = new WebSocketImpl(url + '?room=' + roomId);
    ws.onopen = () => { backoff = 1000; onStatus?.('open'); heartbeat(); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'pkt') onMessage?.(m.data);
    };
    ws.onclose = () => { stopHeartbeat(); onStatus?.('closed'); scheduleReconnect(); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  function send(dataStr) {
    if (ws && ws.readyState === 1) { ws.send(JSON.stringify({ type: 'pkt', data: dataStr })); return true; }
    return false;
  }
  function close() { closedByUser = true; stopHeartbeat(); if (reconnectTimer) clearTimeoutImpl(reconnectTimer); if (ws) try { ws.close(); } catch {} }
  function isOpen() { return !!ws && ws.readyState === 1; }

  return { connect, send, close, isOpen };
}
```

- [ ] **Step 4: Rodar e ver passar** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/transport.js test/transport.test.js
git commit -m "feat: transport WebSocket com heartbeat e reconexão, testado com WS fake"
```

---

### Task 8: Relay Cloudflare (Worker + Durable Object)

**Files:**
- Create: `relay/wrangler.toml`
- Create: `relay/src/worker.js`
- Create: `relay/package.json`
- Test: `relay/test/room.test.js`

**Interfaces:**
- Produces: endpoint WSS `wss://<host>/?room=<roomId>`; broadcast do `{type:'pkt',data}` para os outros sockets da sala; store-and-forward do último pkt com TTL; echo de `{type:'ping'}`→`{type:'pong'}`.

- [ ] **Step 1: Criar relay/package.json**

```json
{
  "name": "cookie-injector-relay",
  "private": true,
  "type": "module",
  "scripts": { "dev": "wrangler dev", "deploy": "wrangler deploy", "test": "vitest run" },
  "devDependencies": { "vitest": "^2.1.9", "wrangler": "^4.0.0", "@cloudflare/vitest-pool-workers": "^0.8.0" }
}
```

- [ ] **Step 2: Criar relay/wrangler.toml**

```toml
name = "cookie-injector-relay"
main = "src/worker.js"
compatibility_date = "2025-01-01"

[[durable_objects.bindings]]
name = "ROOM"
class_name = "Room"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Room"]
```

- [ ] **Step 3: Implementar relay/src/worker.js**

```js
const TTL_MS = 120000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const room = url.searchParams.get('room');
    if (!room || !/^[A-Za-z0-9_-]{16,64}$/.test(room)) return new Response('bad room', { status: 400 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const id = env.ROOM.idFromName(room);
    return env.ROOM.get(id).fetch(request);
  },
};

export class Room {
  constructor(state) { this.state = state; }

  async fetch() {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.state.acceptWebSocket(server);

    // store-and-forward: entrega o último pacote válido ao recém-conectado.
    const last = await this.state.storage.get('last');
    if (last && Date.now() - last.ts <= TTL_MS) {
      try { server.send(JSON.stringify({ type: 'pkt', data: last.data })); } catch {}
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'ping') { try { ws.send(JSON.stringify({ type: 'pong' })); } catch {} return; }
    if (m.type === 'pkt') {
      await this.state.storage.put('last', { data: m.data, ts: Date.now() });
      for (const peer of this.state.getWebSockets()) {
        if (peer === ws) continue;
        try { peer.send(JSON.stringify({ type: 'pkt', data: m.data })); } catch {}
      }
    }
  }

  async webSocketClose(ws, code, reason, wasClean) { try { ws.close(code, reason); } catch {} }
}
```

- [ ] **Step 4: Teste do relay (room.test.js)**

```js
import { env, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

// Teste de unidade do broadcast/armazenamento via instância do DO.
describe('Room DO', () => {
  it('guarda o último pkt com timestamp', async () => {
    const id = env.ROOM.idFromName('a'.repeat(20));
    const stub = env.ROOM.get(id);
    await runInDurableObject(stub, async (instance, state) => {
      await instance.webSocketMessage({ send() {} }, JSON.stringify({ type: 'pkt', data: 'XYZ' }));
      const last = await state.storage.get('last');
      expect(last.data).toBe('XYZ');
      expect(typeof last.ts).toBe('number');
    });
  });
});
```

Criar `relay/vitest.config.js`:

```js
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
export default defineWorkersConfig({
  test: { poolOptions: { workers: { wrangler: { configPath: './wrangler.toml' } } } },
});
```

- [ ] **Step 5: Instalar e rodar testes do relay**

Run: `cd relay && npm install && npx vitest run`
Expected: PASS (teste do DO). Se o pool de workers exigir ajuste de versão, fixar `wrangler`/pool compatíveis e re-rodar.

- [ ] **Step 6: Smoke local opcional**

Run: `cd relay && npx wrangler dev` (não bloquear o plano se a rede do ambiente impedir; documentar).
Expected: sobe em `http://localhost:8787`. Conexão real é validada no E2E manual.

- [ ] **Step 7: Commit**

```bash
git add relay/
git commit -m "feat: relay Cloudflare (Worker + Durable Object) com store-and-forward e teste"
```

---

### Task 9: manifest.json (permissões + service worker)

**Files:**
- Modify: `manifest.json`

**Interfaces:**
- Produces: `background.service_worker = "background.js"` (`type: module`); permissões `alarms`, `notifications` adicionadas.

- [ ] **Step 1: Atualizar manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Cookie Injector",
  "version": "1.4.0",
  "description": "Injeta cookies em qualquer domínio e transplanta sessões entre máquinas via relay E2E",
  "permissions": ["cookies", "storage", "clipboardRead", "alarms", "notifications"],
  "host_permissions": ["http://*/*", "https://*/*"],
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_popup": "popup.html" }
}
```

- [ ] **Step 2: Verificar carregamento**

Carregar sem compactação em `chrome://extensions` (recarregar). Sem erros no service worker (vazio por enquanto será criado na Task 10).
Nota: completar este passo após a Task 10 para evitar erro de SW ausente.

- [ ] **Step 3: Commit**

```bash
git add manifest.json
git commit -m "feat: manifest v1.4.0 com service worker e permissões alarms/notifications"
```

---

### Task 10: background.js (service worker — wiring)

**Files:**
- Create: `background.js`

**Interfaces:**
- Consumes: `config`, `exporter`, `injector` (via receiver), `transport`, `receiver`, `crypto.encryptJSON`, `protocol.buildPayload`.
- Produces: conexão WS persistente; handler `chrome.runtime.onMessage` para `{type:'transplant'}`, `{type:'status'}`; reconexão por `chrome.alarms`; reconexão em `onStartup`/`onInstalled`; reconfiguração em `chrome.storage.onChanged` (secret/relayUrl).

- [ ] **Step 1: Implementar background.js**

```js
import { getRoomAndKey, getRelayUrl } from './src/config.js';
import { collectAllCookies } from './src/exporter.js';
import { createTransport } from './src/transport.js';
import { handleIncoming } from './src/receiver.js';
import { encryptJSON } from './src/crypto.js';
import { buildPayload } from './src/protocol.js';

const storage = chrome.storage.local;
const seenNonces = new Set();
let transport = null;
let current = null; // { roomId, key }
let status = 'idle';

function notify(info) {
  let message = '';
  if (info.kind === 'received') message = `${info.ok} sessão(ões) injetada(s)` + (info.fail ? ` · ${info.fail} falha(s)` : '');
  else if (info.kind === 'error') message = info.message;
  if (!message) return;
  try {
    chrome.notifications.create({ type: 'basic', iconUrl: 'icon128.png', title: 'Cookie Injector', message });
  } catch {}
}

async function onIncoming(envelope) {
  if (!current) return;
  await handleIncoming({ key: current.key, cookiesApi: chrome.cookies, seenNonces, now: Date.now(), notify }, envelope);
}

async function setup() {
  const rk = await getRoomAndKey(storage);
  if (!rk) { status = 'sem-segredo'; return; }
  const url = await getRelayUrl(storage);
  if (transport) transport.close();
  current = rk;
  transport = createTransport({
    url, roomId: rk.roomId,
    onMessage: onIncoming,
    onStatus: (s) => { status = s; },
  });
  transport.connect();
}

async function randomNonce() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...b));
}

async function transplant() {
  if (!current) return { error: 'sem-segredo' };
  const cookies = await collectAllCookies(chrome.cookies);
  const payload = buildPayload(cookies, Date.now(), await randomNonce());
  const env = await encryptJSON(current.key, payload);
  // marca como visto para não reinjetar o próprio pacote (broadcast volta? não — relay não devolve ao remetente)
  const ok = transport && transport.send(env);
  return { sent: !!ok, count: cookies.length };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'transplant') sendResponse(await transplant());
    else if (msg.type === 'status') sendResponse({ status, connected: !!(transport && transport.isOpen()) });
    else if (msg.type === 'reconnect') { await setup(); sendResponse({ ok: true }); }
    else sendResponse({});
  })();
  return true; // resposta assíncrona
});

chrome.runtime.onStartup.addListener(setup);
chrome.runtime.onInstalled.addListener(setup);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.secret || changes.relayUrl)) setup();
});

// Keepalive: alarme religa o WS se o SW tiver sido descarregado.
chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'keepalive' && !(transport && transport.isOpen())) setup();
});

setup();
```

- [ ] **Step 2: Verificar no Chrome**

Recarregar a extensão; abrir o service worker (Inspecionar) e confirmar que não há exceções. `chrome.runtime` responde a `{type:'status'}` (testado pela UI na próxima task).
Nota: `icon128.png` é opcional; se ausente, a notificação pode falhar silenciosamente — adicionar um ícone simples ou remover `iconUrl`. Incluir um `icon128.png` 1x1 placeholder OU trocar para notificação sem ícone caso o Chrome exija. Decisão: incluir `icon128.png` placeholder (Task 11 cuida do asset).

- [ ] **Step 3: Commit**

```bash
git add background.js
git commit -m "feat: service worker — conexão WS persistente, transplante e recebimento automático"
```

---

### Task 11: popup (UI de pareamento + transplante) e ícone

**Files:**
- Modify: `popup.html`
- Modify: `popup.js`
- Create: `icon128.png` (placeholder)

**Interfaces:**
- Consumes: `config` (ensureSecret/getSecret/setSecret/rotateSecret), `chrome.runtime.sendMessage` (`transplant`/`status`/`reconnect`), `injector.fromDevtoolsParsed` para o caminho manual existente.
- Produces: seção "Transplante de sessões" com: status de conexão, "Parear" (mostra segredo + QR), campo para colar segredo de outra máquina, "Rotacionar segredo", botão "Transplantar sessões".

- [ ] **Step 1: Gerar icon128.png placeholder**

Run:
```bash
cd /Users/luancamara/cookie-injector
node -e "const b=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');require('fs').writeFileSync('icon128.png',b)"
```
Expected: cria `icon128.png` (1x1, suficiente para `iconUrl`).

- [ ] **Step 2: Adicionar seção no popup.html**

Inserir antes do `<hr>` existente um bloco:

```html
<h3>Transplante de sessões <span id="conn" class="ver"></span></h3>
<div class="row">
  <button id="transplant">Transplantar sessões</button>
  <button id="pair">Parear / ver segredo</button>
  <span id="transplantStatus" class="muted"></span>
</div>
<div id="pairBox" style="display:none">
  <textarea id="secretOut" readonly style="height:48px" placeholder="seu segredo aparece aqui"></textarea>
  <div id="qr" style="margin:6px 0"></div>
  <input id="secretIn" type="text" placeholder="cole aqui o segredo de outra máquina para entrar no mesmo canal">
  <div class="row">
    <button id="applySecret">Usar este segredo</button>
    <button id="rotate">Rotacionar segredo</button>
  </div>
</div>
<hr>
```

- [ ] **Step 3: Adicionar lógica no popup.js**

Acrescentar ao final (usando imports ESM — garantir `<script type="module" src="popup.js">` no html):

```js
import { ensureSecret, getSecret, setSecret, rotateSecret } from './src/config.js';

const storageLocal = chrome.storage.local;
const connEl = document.getElementById('conn');
const transplantStatusEl = document.getElementById('transplantStatus');
const pairBox = document.getElementById('pairBox');
const secretOut = document.getElementById('secretOut');

async function refreshStatus() {
  chrome.runtime.sendMessage({ type: 'status' }, (r) => {
    if (chrome.runtime.lastError) { connEl.textContent = '· SW dormindo'; return; }
    connEl.textContent = r && r.connected ? '· conectado' : '· offline';
  });
}

document.getElementById('transplant').addEventListener('click', () => {
  transplantStatusEl.textContent = 'enviando…';
  chrome.runtime.sendMessage({ type: 'transplant' }, (r) => {
    if (chrome.runtime.lastError || !r) { transplantStatusEl.textContent = 'erro: SW indisponível'; return; }
    if (r.error) transplantStatusEl.textContent = 'erro: ' + r.error;
    else transplantStatusEl.textContent = r.sent ? `enviado (${r.count} cookies)` : `falha ao enviar (${r.count} lidos) — sem conexão`;
  });
});

document.getElementById('pair').addEventListener('click', async () => {
  pairBox.style.display = pairBox.style.display === 'none' ? 'block' : 'none';
  if (pairBox.style.display === 'block') {
    const s = await ensureSecret(storageLocal);
    secretOut.value = s;
    renderQR(s);
  }
});

document.getElementById('applySecret').addEventListener('click', async () => {
  const v = document.getElementById('secretIn').value.trim();
  if (!/^[A-Za-z0-9_-]{20,}$/.test(v)) { transplantStatusEl.textContent = 'segredo inválido'; return; }
  await setSecret(storageLocal, v);
  chrome.runtime.sendMessage({ type: 'reconnect' }, () => {});
  secretOut.value = v; renderQR(v);
  transplantStatusEl.textContent = 'segredo aplicado — reconectando';
});

document.getElementById('rotate').addEventListener('click', async () => {
  const s = await rotateSecret(storageLocal);
  secretOut.value = s; renderQR(s);
  chrome.runtime.sendMessage({ type: 'reconnect' }, () => {});
  transplantStatusEl.textContent = 'novo segredo — repareie as outras máquinas';
});

function renderQR(text) {
  // QR via API pública opcional; fallback: instrui copiar o texto.
  const el = document.getElementById('qr');
  el.textContent = 'Copie o segredo acima para a outra máquina (campo "cole aqui").';
  el.title = text;
}

refreshStatus();
setInterval(refreshStatus, 3000);
```

Trocar no `popup.html` a tag final para módulo: `<script type="module" src="popup.js"></script>`.

- [ ] **Step 4: Migrar o caminho manual para o injector compartilhado**

No `popup.js`, substituir a função local `setCookie` e `removeConflictingVariants` por import de `./src/injector.js` e usar `fromDevtoolsParsed` no `inject()`:

```js
import { setCookie as injSetCookie, fromDevtoolsParsed } from './src/injector.js';
// dentro de inject(): const set = await injSetCookie(chrome.cookies, fromDevtoolsParsed(c));
```
Remover as definições duplicadas de `setCookie`/`removeConflictingVariants`/`SAME_SITE` do `popup.js` (agora vêm do módulo). Manter `parseRaw` e o resto da UI.

- [ ] **Step 5: Verificar no Chrome**

Recarregar a extensão. Abrir o popup: status mostra conectado/offline; "Parear" mostra um segredo; "Transplantar sessões" responde. Caminho manual (colar do DevTools) continua injetando.

- [ ] **Step 6: Commit**

```bash
git add popup.html popup.js icon128.png
git commit -m "feat: UI de transplante (pareamento, status, envio) e reuso do injector no caminho manual"
```

---

### Task 12: Documentação (README)

**Files:**
- Modify: `README.md`

**Interfaces:**
- Produces: seção explicando o transplante automático, pareamento, deploy do relay e avisos de segurança.

- [ ] **Step 1: Acrescentar seção ao README**

Conteúdo (resumo, adaptar do design): o que é o transplante; como parear (gerar segredo na máquina A, colar em B); como funciona (relay E2E, origem inicia, destino injeta sozinho); como subir o relay (`cd relay && wrangler deploy`, depois setar `relayUrl` ou editar `src/constants.js`); avisos (segredo = senha-mestra; é tudo das suas sessões; uso entre máquinas próprias).

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README do transplante automático de sessões e deploy do relay"
```

---

### Task 13: Deploy do relay + ligação final

**Files:**
- Modify: `src/constants.js` (URL real do relay)

**Interfaces:**
- Produces: relay em produção e extensão apontando para ele.

- [ ] **Step 1: Deploy do relay**

Run: `cd relay && npx wrangler deploy`
Expected: publica e imprime a URL `https://cookie-injector-relay.<conta>.workers.dev`.
**SINALIZAÇÃO HUMANA:** este ambiente não alcança a API da Cloudflare (sandbox de rede). O deploy precisa do dono autenticado (`wrangler login`/token). Se bloqueado, pausar e pedir ao usuário rodar o deploy ou fornecer credencial.

- [ ] **Step 2: Atualizar a URL na extensão**

Editar `src/constants.js`: `DEFAULT_RELAY_URL = 'wss://cookie-injector-relay.<conta>.workers.dev'`.

- [ ] **Step 3: Commit**

```bash
git add src/constants.js
git commit -m "chore: aponta a extensão para a URL de produção do relay"
```

- [ ] **Step 4: E2E manual (checklist)**

Dois perfis do Chrome com a extensão carregada: parear (segredo de A colado em B); em A clicar "Transplantar sessões"; em B confirmar notificação e sessões injetadas (recarregar um site logado). Validar offline→online (fechar B, transplantar em A, abrir B dentro do TTL → injeta).

---

## Self-Review

**Spec coverage:** escopo (todos cookies → Task 3), transporte automático push (Tasks 7/8/10), confiança por segredo (Task 5/11), backend Worker+DO (Task 8), E2E (Task 1), anti-replay/TTL (Tasks 2/6/8), manutenção do manual (Task 11 step 4), permissões (Task 9), feedback/notificações (Task 10), testes (Tasks 1–8), deploy + sinalização humana (Task 13). Sem lacunas.

**Placeholder scan:** `icon128.png` e `DEFAULT_RELAY_URL` são placeholders intencionais resolvidos em Tasks 11/13. Sem TODOs ocultos.

**Type consistency:** formato canônico de cookie idêntico entre `exporter.toRecord`, `injector.setCookie` e `receiver`. `sameSite` enum consistente; `expirationDate` em segundos em todo o fluxo automático; o caminho manual converte via `fromDevtoolsParsed`. `createTransport` envia/recebe `{type:'pkt',data}` igual no relay.
