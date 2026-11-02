import { newId, type ServerMessage } from '@terra/contracts';
import type { Transport } from './types';

/** Outcome of one sim command: acked at a tick, or rejected (`code` is a `RejectCode`, `timeout`, `not_connected` or `host_unavailable`). */
export type CommandResult = { ok: true; appliedAtTick: number } | { ok: false; code: string; detail?: string };

/** Sends a sim command and resolves with its ack/reject. Features reach it through `FeatureServices.sendCommand`. */
/** `opts.predict: false` sends without telling the predictor (dev: the client learns of the result only from the server). */
export type SendCommand = (kind: string, args?: unknown, opts?: { predict?: boolean }) => Promise<CommandResult>;

/** Service for contexts with no transport (the prototype page, a local host that has no such command). */
export const notConnectedSend: SendCommand = async () => ({ ok: false, code: 'not_connected', detail: 'no game server connection' });

export const COMMAND_TIMEOUT_MS = 5000;

interface Pending { resolve(r: CommandResult): void; timer: ReturnType<typeof setTimeout> }

/** Issues `cmd` with a fresh `cm_` id over any `Transport` and matches `cmd.ack` / `cmd.reject` by id. */
export class CommandBus {
  private readonly pending = new Map<string, Pending>();
  private readonly off: () => void;

  /**
   * `onSent` sees every command right after it is sent (the sim worker predicts it, D-31). `onTimedOut` sees a command
   * that got neither ack nor reject in time, so the prediction can drop it (the server may never have received it).
   */
  constructor(
    private readonly transport: Pick<Transport, 'send' | 'onMessage'>,
    private readonly timeoutMs = COMMAND_TIMEOUT_MS,
    private readonly onSent?: (id: string, kind: string, args: unknown) => void,
    private readonly onTimedOut?: (id: string) => void,
  ) {
    this.off = transport.onMessage((m) => this.handleMessage(m));
  }

  handleMessage(m: ServerMessage): void {
    if (m.t !== 'cmd.ack' && m.t !== 'cmd.reject') return;
    const p = this.pending.get(m.d.id);
    if (!p) return;
    this.settle(
      m.d.id,
      p,
      m.t === 'cmd.ack'
        ? { ok: true, appliedAtTick: m.d.appliedAtTick }
        : { ok: false, code: m.d.code, ...(m.d.detail ? { detail: m.d.detail } : {}) },
    );
  }

  /**
   * Bound for use as `FeatureServices.sendCommand`. Never rejects: a transport that cannot send right now (connecting,
   * reconnecting) resolves `not_connected` at once and the command is neither pending nor predicted.
   */
  readonly send: SendCommand = (kind, args = {}, opts) => {
    const id = newId('cm');
    return new Promise<CommandResult>((resolve) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        this.onTimedOut?.(id);
        resolve({ ok: false, code: 'timeout', detail: `no ack for ${kind} within ${this.timeoutMs} ms` });
      }, this.timeoutMs);
      const p: Pending = { resolve, timer };
      this.pending.set(id, p); // before sending: a transport may answer synchronously
      try {
        this.transport.send({ t: 'cmd', id, d: { kind, args } });
      } catch (e) {
        this.settle(id, p, { ok: false, code: 'not_connected', detail: e instanceof Error ? e.message : String(e) });
        return;
      }
      if (opts?.predict !== false) this.onSent?.(id, kind, args);
    });
  };

  private settle(id: string, p: Pending, r: CommandResult): void {
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.resolve(r);
  }

  dispose(): void {
    this.off();
    for (const [id, p] of [...this.pending]) this.settle(id, p, { ok: false, code: 'not_connected', detail: 'command bus disposed' });
  }
}
