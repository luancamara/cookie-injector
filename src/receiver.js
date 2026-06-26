// Orquestra o recebimento: decifra → valida frescor → injeta → notifica.

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
