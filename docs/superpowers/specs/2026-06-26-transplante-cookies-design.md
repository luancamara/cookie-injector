# Transplante automático de sessões entre máquinas — Design

Data: 2026-06-26
Status: Aprovado (autônomo via `/goal`)
Projeto: Cookie Injector (extensão Chrome MV3)

## Objetivo

Permitir que, a partir de uma máquina de origem (ex.: MacBook), **todos os cookies
do perfil** sejam transplantados para outra máquina do mesmo dono — de forma
**automática**, sem nenhum clique no destino. No destino, a extensão recebe e injeta
sozinha. No máximo um passo único de **pareamento** ("a permissão") é feito antes.

### Não-objetivos (escopo descartado nesta entrega)

- Mover o **perfil inteiro** do Chrome (favoritos, histórico, senhas, extensões,
  abas). Inviável por extensão (sandbox) e por criptografia presa à máquina no disco
  (`Chrome Safe Storage` no Keychain / DPAPI). Caminho oficial para isso é o Chrome
  Sync, que **não** sincroniza cookies — exatamente o buraco que esta ferramenta cobre.
- Capturar `localStorage`/`IndexedDB` (logins fora de cookie). Fica como melhoria futura.
- Cookies **particionados (CHIPS)**. Ficam de fora do MVP (exigiriam varrer partition keys).
- Enviar para **outras pessoas** / multi-peer seletivo. O desenho é só para as máquinas
  do próprio dono. Compartilhar com terceiros equivaleria a compartilhar login.

## Decisões-âncora

1. **Escopo:** exportar/importar **todos** os cookies do perfil (`chrome.cookies.getAll({})`).
2. **Transporte:** automático, push, iniciado **sempre** pela origem; zero clique no destino.
3. **Confiança:** só entre as máquinas do dono. Um **segredo compartilhado** único.
4. **Backend:** Cloudflare **Workers + Durable Object** (relay WebSocket), custo ~zero.

## Arquitetura

Três peças:

- **Extensão** (mesmo código nas duas pontas; papéis diferentes em runtime).
- **Relay**: Cloudflare Worker faz upgrade para WebSocket e roteia para um Durable
  Object por `roomId`. O DO mantém os sockets da sala, faz broadcast do pacote cifrado
  e guarda o último pacote com TTL (store-and-forward para destino offline).
- **Segredo compartilhado**: gerado forte/aleatório na 1ª máquina, copiado uma vez para
  as demais (pareamento via texto + QR).

### Derivação de chaves (E2E)

Do segredo, via **HKDF-SHA256**, derivam-se duas coisas **separadas**:

- `roomId = HKDF(secret, info="cookie-injector/room/v1")` → identifica o canal no relay.
- `aesKey = HKDF(secret, info="cookie-injector/enc/v1")` → chave **AES-GCM 256**.

Como as `info` são distintas, conhecer o `roomId` (que trafega em claro até o relay)
**não** revela a `aesKey`. O relay nunca vê conteúdo em claro.

## Fluxo

### Pareamento (uma vez)

1. Máquina A gera `secret` (32 bytes aleatórios, base64url) e exibe como texto + QR.
2. Você copia/escaneia em B (e nas demais). Cada máquina guarda `secret` em
   `chrome.storage.local` e deriva `roomId`/`aesKey`.

### Envio (origem, 1 clique)

1. Usuário clica **"Transplantar sessões"** no popup.
2. SW lê `chrome.cookies.getAll({})`, normaliza para o formato de export já existente.
3. Serializa → JSON → cifra com **AES-GCM** (nonce aleatório de 12 bytes + timestamp).
4. Conecta ao relay (`wss://…/room?room=<roomId>`) e envia o blob cifrado.

### Recebimento (destino, zero clique)

1. SW do destino mantém **WebSocket aberto** com o relay da sala (heartbeat ~20s para
   não morrer; `chrome.alarms` de ~30–60s para religar se cair; reabre em
   `onStartup`/`onInstalled`).
2. Ao chegar pacote: verifica nonce/timestamp (anti-replay), **descriptografa**,
   **injeta** cada cookie reusando `setCookie`/`removeConflictingVariants` atuais.
3. Dispara `chrome.notifications`: "N sessões recebidas e injetadas".
4. Se o destino estava offline, o DO entregou o último pacote ao reconectar (dentro do TTL).

## Componentes (unidades isoladas e testáveis)

### Extensão

- `src/config.js` — pareamento: gera/guarda `secret`, expõe `getRoomId()`/`getKey()`.
  Depende de: `crypto.js`, `chrome.storage`.
- `src/crypto.js` — **puro** (sem rede/sem chrome.*): HKDF, AES-GCM encrypt/decrypt,
  base64url, geração de aleatórios. Usa `globalThis.crypto.subtle`. 100% testável em Node.
- `src/exporter.js` — lê e normaliza cookies (`getAll` → formato export). Só leitura.
- `src/transport.js` — cliente WebSocket: conectar, heartbeat, reconectar com backoff,
  `onMessage`, `send`. Não conhece cookies nem cripto (recebe/manda bytes).
- `src/receiver.js` — orquestra recebimento: decifra (crypto) → injeta (cookies) → notifica.
- `src/injector.js` — `setCookie` + `removeConflictingVariants` extraídos do `popup.js`
  (reuso entre injeção manual e automática).
- `background.js` (service worker) — novo. Mantém o WS vivo, recebe, injeta, notifica.
  Onde a injeção automática roda (sem popup aberto).
- `popup.js`/`popup.html` — UI: mantém tudo de hoje + seção "Transplante" (parear,
  ver/rotacionar segredo, status de conexão, botão "Transplantar sessões").

### Relay (Cloudflare)

- `relay/src/worker.js` — entrypoint: valida `room`, faz `Upgrade: websocket`, encaminha
  ao Durable Object correspondente (`env.ROOM.idFromName(roomId)`).
- `relay/src/room.js` — Durable Object: aceita sockets (Hibernatable WebSockets),
  broadcast do pacote para os outros membros da sala, buffer do último pacote com TTL.
  **Nunca** decifra. Autenticação = posse do `roomId`.
- `relay/wrangler.toml` — config do Worker + binding do Durable Object + migração.

## Segurança

- **E2E real:** comprometer o relay não vaza sessão (não tem a chave).
- **Sala fechada:** só quem tem o `secret` deriva o `roomId` e entra.
- **Origem inicia:** nada sai sem clique na origem.
- **Anti-replay:** nonce + timestamp; destino injeta o mais recente e ignora repetidos/expirados.
- **TTL:** DO descarta pacotes parados após poucos minutos.
- **Segredo = senha-mestra:** guardado em `chrome.storage.local`, exibido só sob demanda,
  com botão **rotacionar** (gera novo e exige re-parear as máquinas).
- **Caveat registrado:** mandar para terceiros = compartilhar login. Desenho é para as
  máquinas do próprio dono.

## Cobertura de cookies e bordas

- `getAll({})` traz cookies de todos os domínios acessíveis, inclusive `HttpOnly` com valor.
- Injeção reusa regras já maduras: host-only, `__Host-`/`__Secure-`, SameSite, sobrescrita
  de variantes conflitantes (não-destrutiva em falha).
- Comportamento no destino: **sobrescrever** (espelhar as sessões do dono).
- Particionados (CHIPS): fora do MVP.

## Manutenção do que já existe

Tudo o de hoje permanece: exportar/listar/injetar/excluir por domínio, colar do DevTools.
O transplante automático é uma seção nova. A extração de `setCookie`/variantes para
`injector.js` é refactor de baixo risco coberto por testes.

## Permissões (manifest)

Adicionar: `"alarms"`, `"notifications"`. Manter: `cookies`, `storage`, `clipboardRead`,
`host_permissions` http/https. O `background.service_worker` passa a existir. Conexão
WSS ao relay não exige host permission (é `connect`), mas a origem do relay será
documentada.

## Tratamento de erros e feedback

- Falha de conexão: backoff exponencial com teto; status visível no popup.
- Falha de decifragem (segredo divergente): notifica "segredo não confere — reparear".
- Injeção parcial: log por cookie (✓/✗), notificação com total ok/falha.
- Origem recebe `ack` do relay ("entregue/bufferizado").

## Testes

- **Puros (Node + vitest):** `crypto` (round-trip cifra→decifra, HKDF determinístico),
  `exporter` (normalização), `injector` (com `chrome.cookies` mockado).
- **Relay:** `wrangler dev`/Miniflare — conectar dois sockets, validar broadcast + TTL.
- **E2E manual:** dois perfis do Chrome com a extensão; parear; transplantar; conferir injeção.

## Fases

- **Fase 1 (MVP):** relay (Worker+DO) + WS + E2E + envio 1-clique na origem + recebimento
  automático no destino + pareamento por segredo (texto/QR) + injeção reusando lógica atual.
- **Fase 2 (polimento):** keepalive/reconexão robustos, notificações, rotação de segredo,
  status de conexão no popup, `ack` de entrega.
- **Futuro:** CHIPS, localStorage/IndexedDB, multi-peer seletivo.

## Deploy

- Relay via `wrangler deploy` (Cloudflare). O sandbox de rede deste ambiente **não**
  alcança a API da Cloudflare; o deploy de produção provavelmente precisa de
  token/credencial do dono ou ser rodado por ele. Build e testes locais (Miniflare) são
  feitos aqui. **Ponto de sinalização humana.**
- Extensão: carregada sem compactação (`chrome://extensions`), como hoje.
