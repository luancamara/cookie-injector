# Revisão adversarial — achados confirmados e resoluções (2026-06-26)

Revisão multi-agente (5 lentes: cripto/E2E, ciclo MV3, injeção, relay, integração),
cada achado verificado de forma adversarial. 23 achados; 17 confirmados; 6 rejeitados.
Todos os confirmados foram corrigidos abaixo.

## Confirmados e corrigidos

1. **Anti-replay zerado no reciclo do SW + store-and-forward reentregando** (medium) →
   `src/replay.js` (NonceStore persistente em `chrome.storage.session`, podado por
   `MAX_AGE_MS`), usado em `background.js`; `protocol.checkFreshness` passa `ts` ao `add`.
2. **Frescor sem limite superior (futuro)** (low) → `protocol.js` adiciona `SKEW_MS` (60s)
   e rejeita `payload.ts - now > SKEW_MS`.
3. **Segredo em texto puro no disco** (low) → documentado o trust assumption em
   `src/config.js` e no README (é equivalente à exposição dos próprios cookies).
4. **`setup()` não serializado → churn/duplicação de WS** (medium) → `background.js`
   serializa via cadeia de promessas e `doSetup` pula reconexão se já aberto na mesma sala.
5. **Heartbeat sem detecção de socket meio-aberto** (medium) → `transport.js` rastreia
   `lastRx` e força `close()` (dispara reconexão) após 2 ciclos sem recebimento.
6. **Transplante no cold-start retornava "sem-conexao"** (low) → `transport.whenOpen()` e
   `background.transplant` aguarda a abertura (até 4s) antes de desistir.
7. **`seenNonces` crescia sem limite** (low) → NonceStore poda por janela; alarme também poda.
8. **Alarme recriado a cada wake** (nit) → criado de forma idempotente (`alarms.get` antes).
9. **`onMessage` sem try/catch travava o popup** (low) → wrap try/catch sempre responde.
10. **SameSite=None sem Secure falhava em silêncio** (low) → `injector.setCookie` força
    `secure` quando `sameSite==='no_restriction'` e deriva o scheme depois.
11. **`removeConflictingVariants` apagava variante legítima do mesmo lote** (medium) →
    `injectAll` passa `batchKeys`; variantes presentes no lote são preservadas.
12. **Relay: broadcast dependia do `storage.put`** (low) → repassa primeiro, persiste
    depois com try/catch (`relay/src/worker.js`).
13. **Ciphertext persistia além do TTL** (low) → `setAlarm(now+TTL)` + `alarm()` apaga
    `last`; leitura stale também apaga.
14. **`webSocketClose` com códigos reservados (1005/1006)** (nit) → normaliza para 1000.
15. **Pong não validado** (nit) → coberto pela detecção de liveness do item 5.
16. **`package.json` 1.3.0 ≠ manifest 1.4.0** (nit) → bump para 1.4.0.
17. **JSON exportado não era injetável (dica enganosa)** (low) → `injector.fromExportFormat`
    + caminho JSON em `popup.inject()`; dica do textarea atualizada.

## Rejeitados (sem ação — verificados como não-problema)

- `__Host-`/`__Secure-` já garantidos pelo `parseRaw`.
- CHIPS (particionados) — decisão de escopo documentada, não defeito.
- `trim` de campos — valores de cookie não têm whitespace de borda significativo (RFC 6265).
- `expirationDate` em segundos — confirmado correto.
- Ícone de notificação / falha assíncrona — ícone válido existe; falha tratada no item 9.
- Store-and-forward reentregando ao próprio remetente — suprimido pelo NonceStore (item 1).

## Cobertura de testes adicionada

`test/replay.test.js` (4), skew futuro em `protocol`, None→Secure + variantes do lote +
`fromExportFormat` em `injector`, liveness + `whenOpen` em `transport`. Total: 42 testes.
