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

  it('fecha o socket quando não recebe nada por 2 ciclos (meio-aberto)', () => {
    let now = 0;
    const timers = [];
    const setT = (fn) => { timers.push(fn); return timers.length; };
    const t = createTransport({
      url: 'wss://r', roomId: 'ROOM', onMessage: () => {}, onStatus: () => {},
      WebSocketImpl: FakeWS, setTimeoutImpl: setT, clearTimeoutImpl: () => {},
      nowImpl: () => now, heartbeatMs: 100,
    });
    t.connect();
    const sock = FakeWS.last;
    let closed = false;
    sock.close = () => { closed = true; };
    sock.open();                 // agenda o 1º tick do heartbeat
    now = 250;                   // > 2 * 100 sem nada recebido
    timers[timers.length - 1](); // executa o tick
    expect(closed).toBe(true);
  });

  it('whenOpen resolve ao abrir', async () => {
    const t = createTransport({ url: 'wss://r', roomId: 'ROOM', onMessage: () => {}, onStatus: () => {}, WebSocketImpl: FakeWS });
    t.connect();
    const p = t.whenOpen(1000);
    FakeWS.last.open();
    await expect(p).resolves.toBeUndefined();
  });
});
