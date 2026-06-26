// Pareamento: guarda o segredo compartilhado e deriva roomId + chave AES.
//
// ⚠️ Trust assumption: o segredo é gravado em chrome.storage.local (texto puro no
// perfil). Ele é um bearer credential — quem ler o perfil (outro processo local,
// backup, malware, laptop roubado) obtém acesso de injeção de cookies em todas as
// máquinas pareadas. A exposição é equivalente à dos próprios cookies (que também
// vivem no perfil). Para reduzir, poderia-se envolver com uma passphrase do usuário
// (PBKDF2/Argon2); fora do escopo do MVP.

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
