// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@terra/contracts';
import type { FeatureServices } from '../../core/registry/types';
import { Emitter } from '../../net/emitter';
import type { ConnectionState, Outgoing, Transport } from '../../net/types';
import type { SocketLike, WsTransportDeps } from '../../net/WsTransport';
import type { FetchLike, StorageLike } from './bootOnline';
import { activeHome } from './homeFixture';
import { OnlineSession } from './OnlineSession';
import { WorldStore, type WorkerLike } from '../../store/WorldStore';

const PLAYER = 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const flush = async (rounds = 6) => { for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0)); };
const mesh = (id: string) => { const g = new THREE.Group(); g.name = id; g.userData = { archetypeId: id, uniforms: {} }; return g; };
const memStorage = (): StorageLike => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }; };
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** Guest + home answers; `colonyIndex` is the server seat. `gate` (when given) holds the guest login until released. */
function authFetch(opts: { colonyIndex?: number; guestStatus?: number; gate?: Promise<void> } = {}): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    if (url === '/v1/auth/guest') {
      await opts.gate;
      if (opts.guestStatus) return json(opts.guestStatus, {});
      return json(200, { accessToken: 'jwt-a', expiresIn: 900, player: { id: PLAYER, handle: 'C', isGuest: true } });
    }
    if (url.startsWith('/v1/me/home')) {
      return json(200, activeHome({ colonyIndex: opts.colonyIndex }));
    }
    return json(404, {});
  }) as FetchLike & { calls: string[] };
  f.calls = calls;
  return f;
}

/** Sockets that open and then close with `closeCode` / `reason` (a terminal code ends the transport). */
function closingSockets(closeCode: number, reason = ''): WsTransportDeps & { opened: number } {
  const deps = {
    opened: 0,
    socket(): SocketLike {
      deps.opened++;
      const s: SocketLike = {
        binaryType: 'arraybuffer', onopen: null, onmessage: null, onclose: null, onerror: null,
        send() { queueMicrotask(() => s.onclose?.({ code: closeCode, reason })); },
        close() {},
      };
      queueMicrotask(() => s.onopen?.());
      return s;
    },
    now: () => Date.now(), setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimer: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>), random: () => 0.5, clientVersion: 'test',
  };
  return deps;
}

class IdleTransport implements Transport {
  msgs = new Emitter<ServerMessage>();
  sent: Outgoing[] = [];
  state: ConnectionState = { phase: 'streaming', attempt: 0, downSinceMs: null };
  start() {} stop() {}
  send(m: Outgoing) { this.sent.push(m); }
  onMessage(fn: (m: ServerMessage) => void) { return this.msgs.on(fn); }
  onState() { return () => {}; }
}

const sessions: OnlineSession[] = [];
function session(mode: 'boot' | 'scenario', opts: ConstructorParameters<typeof OnlineSession>[2]): OnlineSession {
  const app = document.createElement('div');
  document.body.replaceChildren(app);
  const s = new OnlineSession(app, mode, { uiParent: document.body, storage: memStorage(), search: '', makeMesh: mesh, ...opts });
  sessions.push(s);
  return s;
}
afterEach(() => { for (const s of sessions.splice(0)) s.dispose(); });
// jsdom has no canvas backend: the touchdown dust asks for a 2D context; null keeps it off without "Not implemented" noise
beforeAll(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
const q = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

describe('OnlineSession lifecycle', () => {
  it('FA-02: dispose while the HTTP boot is in flight never opens a socket afterwards', async () => {
    let release!: () => void;
    const gate = new Promise<void>((ok) => { release = ok; });
    const ws = closingSockets(4012);
    const s = session('boot', { fetch: authFetch({ gate }), wsDeps: ws });
    await flush();
    s.dispose();
    release();
    await s.whenBooted;
    await flush();
    expect(ws.opened).toBe(0);
    expect(s.transport.state.phase).toBe('idle');
  });

  it('FA-05: a terminal socket before the first view seats the local fallback colony as index 0, offline badge on', async () => {
    const ws = closingSockets(4001); // replaced: terminal at once
    const s = session('boot', { fetch: authFetch({ colonyIndex: 2 }), wsDeps: ws, allowLocalFallback: true });
    const boot = await s.whenBooted;
    expect(boot?.colony.colonyIndex).toBe(2);
    await flush();
    expect(s.transport.state.phase).toBe('terminal');
    expect(s.colonyIndex).toBe(0);
    expect(s.colonyId).toBe('col_0');
    expect(s.bootResult?.mode).toBe('local');
    expect(q('offline-badge')?.hidden).toBe(false);
    expect(q('net-banner')).toBeNull(); // no Retry next to a local host
  }, 15_000);

  it("bye 4003 not_your_planet is shown, never replaced by the dev local fallback", async () => {
    const ws = closingSockets(4003, 'not_your_planet');
    const s = session('boot', { fetch: authFetch({ colonyIndex: 2 }), wsDeps: ws, allowLocalFallback: true });
    await s.whenBooted;
    await flush();
    expect(s.transport.state).toMatchObject({ phase: 'terminal', code: 4003, reason: 'not_your_planet' });
    expect(ws.opened).toBe(1);
    expect(s.bootResult?.mode).toBe('online');
    expect(s.colonyIndex).toBe(2);
    expect(q('net-banner')?.textContent).toContain("Not your colony's planet");
    expect(q('offline-badge')?.hidden).toBe(true);
  });

  it('FA-06: production never falls back; the splash shows the error and Retry boots again', async () => {
    let up = false;
    const ok = authFetch();
    const fetch: FetchLike = async (u, i) => { if (!up) throw new TypeError('Failed to fetch'); return ok(u, i); };
    const ws = closingSockets(4012);
    const s = session('boot', { fetch, wsDeps: ws, allowLocalFallback: false });
    await flush();
    expect(q('orbital-splash-status')?.textContent).toBe("Couldn't reach orbit: /v1/auth/guest: Failed to fetch");
    const retry = q('orbital-splash-retry') as HTMLButtonElement;
    expect(retry).not.toBeNull();
    expect(s.bootResult).toBeNull();
    up = true;
    retry.click();
    const boot = await s.whenBooted;
    expect(boot?.mode).toBe('online');
    expect(q('orbital-splash-retry')).toBeNull();
    expect(q('offline-badge')?.hidden).toBe(true);
  });

  it('FA-06: in a dev build a 4xx is an error splash too; only an unreachable server falls back, with the badge', async () => {
    session('boot', { fetch: authFetch({ guestStatus: 429 }), wsDeps: closingSockets(4012), allowLocalFallback: true });
    await flush();
    expect(q('orbital-splash-status')?.textContent).toBe("Couldn't reach orbit: POST /v1/auth/guest: 429");
    sessions.splice(0).forEach((x) => x.dispose());
    const down: FetchLike = async (u) => (u === '/v1/auth/guest' ? json(502, {}) : json(404, {}));
    const s = session('boot', { fetch: down, wsDeps: closingSockets(4012), allowLocalFallback: true });
    const boot = await s.whenBooted;
    expect(boot?.mode).toBe('local');
    expect(q('offline-badge')?.hidden).toBe(false);
  }, 15_000);

  it('FA-02: dispose on the error splash ends the boot (whenBooted settles null, no socket)', async () => {
    const down: FetchLike = async () => { throw new TypeError('Failed to fetch'); };
    const ws = closingSockets(4012);
    const s = session('boot', { fetch: down, wsDeps: ws, allowLocalFallback: false });
    await flush();
    expect(q('orbital-splash-retry')).not.toBeNull();
    s.dispose();
    expect(await s.whenBooted).toBeNull();
    expect(ws.opened).toBe(0);
  });

});

describe('OnlineSession on the in-process fallback host (FA-07)', () => {
  it('the fallback is the in-process LocalHostCore: it steps on its scheduler, answers commands, the dev console and ledger, and stops on dispose', async () => {
    const down: FetchLike = async () => { throw new TypeError('Failed to fetch'); };
    const s = session('boot', { fetch: down, wsDeps: closingSockets(4012), allowLocalFallback: true });
    const host = (await s.whenBooted)!.localHost!;
    const t0 = host.tick;
    await new Promise((r) => setTimeout(r, 450));
    expect(host.tick).toBeGreaterThan(t0); // 5 TPS on the core's PlanetScheduler, no page setInterval
    expect(await s.commandBus.send('dev.ping', {}, { predict: false })).toMatchObject({ ok: true });
    expect(await s.commandBus.send('moveUnit', { entityId: 'x' }, { predict: false })).toMatchObject({ ok: false, code: 'invalid_args' });
    const services = (s as unknown as { hud: { ctx: { services: Required<Pick<FeatureServices, 'devServer' | 'ledgerQuery'>> } } }).hud.ctx.services;
    expect(await services.devServer('warp', { k: 3 })).toMatchObject({ k: 3 });
    expect((s as unknown as { warp: number }).warp).toBe(3); // the core's dev.warp event reached the session
    await expect(services.devServer('chain.ping', {})).rejects.toMatchObject({ code: 'host_unavailable' });
    expect((await services.ledgerQuery('colony:0', 5)).balances['metals.t1']).toBeGreaterThan(0);
    s.dispose();
    sessions.length = 0;
    const t1 = host.tick;
    await new Promise((r) => setTimeout(r, 250));
    expect(host.tick).toBe(t1);
  }, 15_000);
});

describe('OnlineSession keys, net stats and dispose', () => {
  it('shows replica incompatibility even on a healthy connection and removes its listener and UI on dispose', () => {
    const transport = new IdleTransport();
    const worker: WorkerLike = { onmessage: null, postMessage() {}, terminate() {} };
    const store = new WorldStore(transport, () => worker);
    const s = session('scenario', { transport, store });
    const notice = q('version-mismatch')!;
    expect(notice.hidden).toBe(true);
    worker.onmessage!({ data: { t: 'status', status: 'versionMismatch', detail: 'server sim 3, client 2' } });
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain('Game updated. Reload to continue.');
    const button = notice.querySelector('button')!;
    expect(button.textContent).toBe('Reload');
    worker.onmessage!({ data: { t: 'status', status: 'ready' } });
    expect(notice.hidden).toBe(true);
    worker.onmessage!({ data: { t: 'status', status: 'versionMismatch' } });
    s.dispose();
    expect(q('version-mismatch')).toBeNull();
    expect(button.onclick).toBeNull();
    worker.onmessage!({ data: { t: 'status', status: 'ready' } });
    expect(notice.hidden).toBe(false); // The detached notice no longer subscribes to worker status.
  });

  it('FA-11: Esc pauses on a planet without a pod; keys typed into a text field are ignored', async () => {
    const t = new IdleTransport();
    const s = session('scenario', { transport: t });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(s.pauseOverlay.paused).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(s.pauseOverlay.paused).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(t.sent.filter((m) => m.t === 'cmd')).toEqual([]); // no landPod: nothing is descending
  });

  it('FF-32: a pose correction of the renderer reaches the net stats overlay figure', () => {
    const s = session('scenario', { transport: new IdleTransport() });
    expect(s.netStats.correctionTiles).toBe(0);
    s.entities.onCorrection?.(0.4);
    expect(s.netStats.view({ mode: 'on', pending: 0, p95Ms: 0 }).correctionTiles).toBe(0.4);
  });

  it('FA-03: dispose releases the transport for good (dispose, not stop)', () => {
    const t = new IdleTransport();
    let disposed = 0;
    (t as Transport).dispose = () => { disposed++; };
    session('scenario', { transport: t }).dispose();
    sessions.length = 0;
    expect(disposed).toBe(1);
  });
});
