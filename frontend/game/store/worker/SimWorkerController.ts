import type { SimHost } from '@terra/sim';
import { ReplicaCore } from '../replica/ReplicaCore';
import { packView } from '../replica/viewCodec';
import { Predictor } from '../prediction/Predictor';
import type { FromWorker, ToWorker } from './protocol';

export type Post = (msg: FromWorker, transfer: ArrayBuffer[]) => void;

/**
 * The logic of the sim worker without the Worker: message in, messages out through `post`. The worker file is a thin
 * shell around it, so it runs in Vitest (node) and in-process for tests of the main-thread store. The confirmed state
 * lives in `core`; `predictor` adds the player's pending commands on top (SIM-X-03). Views come from the predictor
 * (identical to the replica while nothing is pending, or with prediction off). The local-host layer extends this
 * message set (`step`) later.
 */
export class SimWorkerController {
  readonly core: ReplicaCore;
  readonly predictor: Predictor;
  private stopped = false;
  /** The last view was predicted and carried tile layers the replica does not have: the next view must resend them. */
  private predictedTilesSent = false;
  private reportedOff = false;
  constructor(private readonly post: Post, core: ReplicaCore = new ReplicaCore(), private readonly now: () => number = () => performance.now()) {
    this.core = core;
    this.predictor = new Predictor(core, { now: () => this.now() });
  }

  handle(msg: ToWorker): void {
    if (this.stopped) return;
    switch (msg.t) {
      case 'init': this.predictor.enabled = msg.predict !== false; this.post({ t: 'status', status: 'idle' }, []); break;
      case 'welcome': this.onWelcome(msg); break;
      case 'delta': this.onDelta(msg); break;
      case 'cmdSent': this.predictor.submit(msg); this.emitIfReady(); break;
      case 'ack': this.predictor.onAck(msg.id, msg.appliedAtTick); this.emitIfReady(); break;
      case 'reject': this.onReject(msg); break;
      case 'clock': this.predictor.setServerOffset(msg.serverNowMs - this.now()); break;
      case 'stop': this.stopped = true; break;
    }
  }

  private onWelcome(m: Extract<ToWorker, { t: 'welcome' }>): void {
    const t0 = this.now();
    const r = this.predictor.welcome(m);
    if (!r.ok) {
      this.post({ t: 'status', status: this.core.status, detail: `${r.reason}: ${r.detail}` }, []);
      if (r.reason === 'badSnapshot') this.post({ t: 'resync', reason: r.detail }, []);
      return;
    }
    this.post({ t: 'status', status: 'ready' }, []);
    this.emitView(t0);
  }

  private onDelta(m: Extract<ToWorker, { t: 'delta' }>): void {
    const t0 = this.now();
    const r = this.predictor.onDelta(m);
    if (!r.ok) {
      if (r.request) this.post({ t: 'resync', reason: `${r.reason}: ${r.detail}` }, []);
      return;
    }
    this.emitView(t0);
  }

  private onReject(m: Extract<ToWorker, { t: 'reject' }>): void {
    const r = this.predictor.onReject(m.id, m.code);
    if (r) this.post({ t: 'cmdRejected', id: r.cmd.id, kind: r.cmd.kind, code: r.code }, []);
    this.emitIfReady();
  }

  private emitIfReady(): void {
    if (this.core.loaded) this.emitView(this.now());
  }

  private emitView(t0: number): void {
    const host = this.predictor.host();
    const confirmedTick = this.core.tick;
    const predictedChanged = this.predictedTilesChanged(host, confirmedTick);
    const withTiles = this.core.tilesChanged() || this.predictedTilesSent || predictedChanged;
    const { view, transfer } = packView(host.view(), withTiles);
    this.predictedTilesSent = predictedChanged;
    this.core.markViewed();
    const pred = { on: this.predictor.enabled, pending: this.predictor.pending.length, p95Ms: this.predictor.steps.p95() };
    this.post({ t: 'view', view, applyMs: this.now() - t0, pred }, transfer);
    const events = this.predictor.takeRenderEvents();
    if (events.length) this.post({ t: 'renderEvents', events }, []);
    const off = this.predictor.autoOff;
    if (off && !this.reportedOff) {
      this.reportedOff = true;
      this.post({ t: 'status', status: 'predictionOff', p95Ms: off.p95Ms, detail: `step p95 ${off.p95Ms.toFixed(2)} ms over the limit` }, []);
    }
  }

  /** True when the predicted steps touched tiles after the confirmed tick. */
  private predictedTilesChanged(host: SimHost, confirmedTick: number): boolean {
    if (host === this.core.simHost) return false;
    const stamp = host.state.grid.layers.changedAt;
    for (let i = 0; i < stamp.length; i++) if (stamp[i] > confirmedTick) return true;
    return false;
  }
}
