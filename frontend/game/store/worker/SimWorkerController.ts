import { ReplicaCore } from '../replica/ReplicaCore';
import { packView } from '../replica/viewCodec';
import type { FromWorker, ToWorker } from './protocol';

export type Post = (msg: FromWorker, transfer: ArrayBuffer[]) => void;

/**
 * The logic of the sim worker without the Worker: message in, messages out through `post`. The worker file is a thin
 * shell around it, so it runs in Vitest (node) and in-process for tests of the main-thread store. The prediction and
 * local-host layers extend this class' message set (`cmd`, `step`) later.
 */
export class SimWorkerController {
  readonly core: ReplicaCore;
  private stopped = false;
  constructor(private readonly post: Post, core: ReplicaCore = new ReplicaCore(), private readonly now: () => number = () => performance.now()) { this.core = core; }

  handle(msg: ToWorker): void {
    if (this.stopped) return;
    switch (msg.t) {
      case 'init': this.post({ t: 'status', status: 'idle' }, []); break;
      case 'welcome': this.onWelcome(msg); break;
      case 'delta': this.onDelta(msg); break;
      case 'stop': this.stopped = true; break;
    }
  }

  private onWelcome(m: Extract<ToWorker, { t: 'welcome' }>): void {
    const t0 = this.now();
    const r = this.core.welcome(m);
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
    const r = this.core.delta(m);
    if (!r.ok) {
      if (r.request) this.post({ t: 'resync', reason: `${r.reason}: ${r.detail}` }, []);
      return;
    }
    this.emitView(t0);
  }

  private emitView(t0: number): void {
    const { view, transfer } = packView(this.core.view(), this.core.tilesChanged());
    this.core.markViewed();
    this.post({ t: 'view', view, applyMs: this.now() - t0 }, transfer);
  }
}
