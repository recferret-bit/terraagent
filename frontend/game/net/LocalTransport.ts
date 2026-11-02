import type { ServerMessage } from '@terra/contracts';
import { DevServerError, type DevServer } from './devServer';
import { Emitter } from './emitter';
import type { ConnectionState, Listener, Outgoing, Transport } from './types';
import type { FromLocalHost, LocalHostOptions, ToLocalHost } from '../store/local/protocol';

/** The line to the local authority: a Worker in the browser, a `LocalHostController` in tests. */
export interface LocalLink {
  post(msg: ToLocalHost): void;
  onMessage(fn: (msg: FromLocalHost) => void): () => void;
  dispose(): void;
}

/** A Worker as a `LocalLink` (the host's byte buffers are transferred, not copied). */
export function workerLink(worker: Pick<Worker, 'postMessage' | 'terminate'> & { onmessage: ((e: MessageEvent<FromLocalHost>) => void) | null }): LocalLink {
  const fns = new Emitter<FromLocalHost>();
  worker.onmessage = (e) => fns.emit(e.data);
  return { post: (m) => worker.postMessage(m), onMessage: (fn) => fns.on(fn), dispose: () => worker.terminate() };
}

/** How long `dispose()` waits for the host's final save before terminating the worker. */
export const DISPOSE_GRACE_MS = 2000;

/**
 * `?host=local` transport (D-31, SIM-X-06): speaks the same protocol as `WsTransport` (`ready`, `welcome`, `delta`, `event`,
 * `cmd.ack`, `cmd.reject`, `pong`) with the authoritative engine on the other end of `link`, so `WorldStore`, prediction,
 * the HUD and the terrain are unchanged. There is nothing to reconnect to: the phases only run connecting → welcomed →
 * streaming. `devServer` is the local implementation of the dev console's server commands.
 */
export class LocalTransport implements Transport {
  private readonly msgs = new Emitter<ServerMessage>();
  private readonly states = new Emitter<ConnectionState>();
  private current: ConnectionState = { phase: 'idle', attempt: 0, downSinceMs: null };
  private off: (() => void) | null = null;
  private nextReq = 1;
  private disposed = false;
  private readonly devPending = new Map<number, { ok(v: unknown): void; fail(e: Error): void }>();

  constructor(private readonly link: LocalLink, private readonly opts: LocalHostOptions) {}

  get state(): ConnectionState { return this.current; }
  onMessage(fn: Listener<ServerMessage>): () => void { return this.msgs.on(fn); }
  onState(fn: Listener<ConnectionState>): () => void { return this.states.on(fn); }

  start(): void {
    if (this.off || this.disposed) return;
    this.off = this.link.onMessage((m) => this.fromHost(m));
    this.setState({ phase: 'connecting' });
    this.link.post({ t: 'init', opts: this.opts });
    this.link.post({ t: 'client', msg: { t: 'hello' } });
  }

  stop(): void {
    this.off?.(); this.off = null;
    this.link.post({ t: 'stop' });
    for (const p of this.devPending.values()) p.fail(new DevServerError('not_connected', 'local host stopped'));
    this.devPending.clear();
    this.setState({ phase: 'idle' });
  }

  /**
   * Stops the host and releases the line (terminates the worker) once the host answered `stopped`, i.e. its final
   * snapshot save settled; a host that does not answer within `DISPOSE_GRACE_MS` is terminated anyway.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const release = () => { if (timer === null) return; clearTimeout(timer); timer = null; offStopped(); this.link.dispose(); };
    const offStopped = this.link.onMessage((m) => { if (m.t === 'stopped') release(); });
    timer = setTimeout(release, DISPOSE_GRACE_MS);
    this.stop();
  }

  send(msg: Outgoing): void {
    if (this.current.phase !== 'welcomed' && this.current.phase !== 'streaming') throw new Error(`cannot send ${msg.t} while ${this.current.phase}`);
    this.link.post({ t: 'client', msg });
  }

  /** Asks the host to write its snapshot now (the page is hiding). */
  saveNow(): void { this.link.post({ t: 'save' }); }

  /** `services.devServer` of the local host: `warp`, `scenario`, `tune`, `local.reset`, `ledger`; anything else is `host_unavailable`. */
  readonly devServer: DevServer = (name, args = {}) => new Promise((ok, fail) => {
    if (!this.off) return fail(new DevServerError('not_connected', 'local host is not running'));
    const reqId = this.nextReq++;
    this.devPending.set(reqId, { ok, fail });
    this.link.post({ t: 'dev', reqId, name, args });
  });

  private setState(patch: Partial<ConnectionState>): void {
    this.current = { ...this.current, ...patch };
    this.states.emit(this.current);
  }

  private fromHost(m: FromLocalHost): void {
    if (m.t === 'devResult') {
      const p = this.devPending.get(m.reqId);
      this.devPending.delete(m.reqId);
      if (p) m.ok ? p.ok(m.result) : p.fail(new DevServerError(m.code, m.message));
    } else if (m.t === 'error') {
      console.warn('[local host]', m.message);
    } else if (m.t === 'server') this.onServer(m.msg);
  }

  private onServer(m: ServerMessage): void {
    if (m.t === 'ready') this.link.post({ t: 'client', msg: { t: 'join', d: { planetId: 'local' } } }); // one planet: the id is not looked at
    else if (m.t === 'welcome') this.setState({ phase: 'welcomed', downSinceMs: null });
    else if (m.t === 'delta' && this.current.phase === 'welcomed') this.setState({ phase: 'streaming' });
    this.msgs.emit(m);
  }
}

/** Wires a real local-host Worker (browser only). */
export const createLocalWorker = (): Worker => new Worker(new URL('../store/local/localHost.worker.ts', import.meta.url), { type: 'module' });
