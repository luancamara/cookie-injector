// Service worker: mantém o WebSocket vivo, recebe e injeta sozinho, e envia o
// transplante quando o popup pede. A injeção automática roda aqui (sem popup aberto).

import { getRoomAndKey, getRelayUrl } from './src/config.js';
import { collectAllCookies } from './src/exporter.js';
import { createTransport } from './src/transport.js';
import { handleIncoming } from './src/receiver.js';
import { encryptJSON, toB64url } from './src/crypto.js';
import { buildPayload } from './src/protocol.js';

const storage = chrome.storage.local;
const seenNonces = new Set();
let transport = null;
let current = null; // { roomId, key }
let status = 'idle';

function notify(info) {
  let message = '';
  if (info.kind === 'received') {
    message = `${info.ok} sessão(ões) injetada(s)` + (info.fail ? ` · ${info.fail} falha(s)` : '');
  } else if (info.kind === 'error') {
    message = info.message;
  }
  if (!message) return;
  try {
    chrome.notifications.create({ type: 'basic', iconUrl: 'icon128.png', title: 'Cookie Injector', message });
  } catch { /* notificações podem estar indisponíveis */ }
}

async function onIncoming(envelope) {
  if (!current) return;
  await handleIncoming(
    { key: current.key, cookiesApi: chrome.cookies, seenNonces, now: Date.now(), notify },
    envelope,
  );
}

async function setup() {
  const rk = await getRoomAndKey(storage);
  if (!rk) {
    status = 'sem-segredo';
    if (transport) { transport.close(); transport = null; }
    current = null;
    return;
  }
  const url = await getRelayUrl(storage);
  if (transport) transport.close();
  current = rk;
  transport = createTransport({
    url,
    roomId: rk.roomId,
    onMessage: onIncoming,
    onStatus: (s) => { status = s; },
  });
  transport.connect();
}

function randomNonce() {
  return toB64url(crypto.getRandomValues(new Uint8Array(12)));
}

async function transplant() {
  if (!current) return { error: 'sem-segredo' };
  if (!(transport && transport.isOpen())) return { error: 'sem-conexao', count: 0 };
  const cookies = await collectAllCookies(chrome.cookies);
  const nonce = randomNonce();
  seenNonces.add(nonce); // se o próprio pacote voltar via store-and-forward, ignora
  const payload = buildPayload(cookies, Date.now(), nonce);
  const env = await encryptJSON(current.key, payload);
  const sent = transport.send(env);
  return { sent: !!sent, count: cookies.length };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'transplant') sendResponse(await transplant());
    else if (msg.type === 'status') sendResponse({ status, connected: !!(transport && transport.isOpen()) });
    else if (msg.type === 'reconnect') { await setup(); sendResponse({ ok: true, status }); }
    else sendResponse({});
  })();
  return true; // resposta assíncrona
});

chrome.runtime.onStartup.addListener(setup);
chrome.runtime.onInstalled.addListener(setup);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.secret || changes.relayUrl)) setup();
});

// Keepalive: o alarme acorda o SW e religa o WS caso tenha sido descarregado.
chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'keepalive' && !(transport && transport.isOpen())) setup();
});

setup();
