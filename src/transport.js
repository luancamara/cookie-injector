// Cliente WebSocket resiliente: heartbeat + reconexão com backoff.
// O WebSocket e os timers são injetáveis para permitir testes determinísticos.

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
  function close() {
    closedByUser = true;
    stopHeartbeat();
    if (reconnectTimer) clearTimeoutImpl(reconnectTimer);
    if (ws) try { ws.close(); } catch {}
  }
  function isOpen() { return !!ws && ws.readyState === 1; }

  return { connect, send, close, isOpen };
}
