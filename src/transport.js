// Cliente WebSocket resiliente: heartbeat + detecção de socket meio-aberto +
// reconexão com backoff. WebSocket/timers/relógio injetáveis para testes.

export function createTransport(opts) {
  const {
    url, roomId, onMessage, onStatus,
    WebSocketImpl = globalThis.WebSocket,
    setTimeoutImpl = globalThis.setTimeout.bind(globalThis),
    clearTimeoutImpl = globalThis.clearTimeout.bind(globalThis),
    nowImpl = () => Date.now(),
    heartbeatMs = 20000,
    backoffMaxMs = 30000,
  } = opts;

  let ws = null;
  let hbTimer = null;
  let reconnectTimer = null;
  let backoff = 1000;
  let closedByUser = false;
  let lastRx = 0;
  let openWaiters = [];

  function resolveOpen() {
    const ws2 = openWaiters; openWaiters = [];
    for (const w of ws2) w.resolve();
  }

  function heartbeat() {
    stopHeartbeat();
    hbTimer = setTimeoutImpl(function tick() {
      if (ws && ws.readyState === 1) {
        // Sem nada recebido por 2 ciclos (inclui o pong de auto-resposta) => socket
        // provavelmente meio-aberto: força close para disparar a reconexão.
        if (nowImpl() - lastRx > 2 * heartbeatMs) { try { ws.close(); } catch {} return; }
        try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
      }
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
    lastRx = nowImpl();
    ws.onopen = () => { backoff = 1000; lastRx = nowImpl(); onStatus?.('open'); resolveOpen(); heartbeat(); };
    ws.onmessage = (ev) => {
      lastRx = nowImpl();
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

  function whenOpen(timeoutMs = 5000) {
    if (ws && ws.readyState === 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = { resolve };
      openWaiters.push(waiter);
      setTimeoutImpl(() => {
        const i = openWaiters.indexOf(waiter);
        if (i >= 0) { openWaiters.splice(i, 1); reject(new Error('timeout')); }
      }, timeoutMs);
    });
  }

  function close() {
    closedByUser = true;
    stopHeartbeat();
    if (reconnectTimer) clearTimeoutImpl(reconnectTimer);
    if (ws) try { ws.close(); } catch {}
  }
  function isOpen() { return !!ws && ws.readyState === 1; }

  return { connect, send, close, isOpen, whenOpen };
}
