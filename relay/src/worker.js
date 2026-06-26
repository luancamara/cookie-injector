// Relay Cloudflare: Worker faz upgrade WS e roteia para um Durable Object por sala.
// O relay NUNCA decifra nada — só repassa bytes cifrados (E2E).

import { DurableObject } from 'cloudflare:workers';
import { validRoom, isFresh, TTL_MS } from './room-core.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const room = url.searchParams.get('room');
    if (!validRoom(room)) return new Response('bad room', { status: 400 });
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const id = env.ROOM.idFromName(room);
    return env.ROOM.get(id).fetch(request);
  },
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Responde o heartbeat sem acordar o DO (mantém hibernação e custo ~zero).
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'),
    );
  }

  async fetch() {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    // store-and-forward: entrega o último pacote válido a quem acabou de conectar.
    const last = await this.ctx.storage.get('last');
    if (isFresh(last, Date.now())) {
      try { server.send(JSON.stringify({ type: 'pkt', data: last.data })); } catch {}
    } else if (last) {
      try { await this.ctx.storage.delete('last'); } catch {}
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    let m;
    try { m = JSON.parse(message); } catch { return; }
    if (!m || m.type !== 'pkt') return;
    // Repassa primeiro (função principal do relay); persistir não pode bloquear/derrubar a entrega.
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === ws) continue;
      try { peer.send(JSON.stringify({ type: 'pkt', data: m.data })); } catch {}
    }
    try {
      await this.ctx.storage.put('last', { data: m.data, ts: Date.now() });
      await this.ctx.storage.setAlarm(Date.now() + TTL_MS); // expira o ciphertext em repouso
    } catch { /* falha de storage não impede a entrega */ }
  }

  async alarm() {
    try { await this.ctx.storage.delete('last'); } catch {}
  }

  async webSocketClose(ws, code, reason) {
    // 1005/1006 são reservados e não podem ser passados a close(); normaliza para 1000.
    const safe = (typeof code === 'number' && code >= 1000 && code !== 1005 && code !== 1006) ? code : 1000;
    try { ws.close(safe, reason); } catch {}
  }

  async webSocketError(ws) {
    try { ws.close(1011, 'error'); } catch {}
  }
}
