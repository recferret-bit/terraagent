import { LocalDevError, LocalHostCore, type LocalHostDeps } from './LocalHostCore';
import type { LocalPost, ToLocalHost } from './protocol';

/**
 * Message routing of the local host without the Worker (like `SimWorkerController`): `init` boots the core (async, it
 * reads IndexedDB) and everything that arrives meanwhile waits in a queue. `localHost.worker.ts` is a thin shell.
 */
export class LocalHostController {
  private core: LocalHostCore | null = null;
  private queue: ToLocalHost[] = [];
  private stopped = false;

  constructor(private readonly post: LocalPost, private readonly deps: LocalHostDeps) {}

  /** The booted core (tests). */
  get booted(): LocalHostCore | null { return this.core; }

  handle(msg: ToLocalHost): void {
    if (this.stopped) return;
    if (msg.t === 'init') { void this.boot(msg); return; }
    if (msg.t === 'stop') { this.stopped = true; this.core?.stop(); return; }
    if (!this.core) { this.queue.push(msg); return; }
    this.dispatch(this.core, msg);
  }

  private async boot(msg: Extract<ToLocalHost, { t: 'init' }>): Promise<void> {
    try {
      const core = await LocalHostCore.create(msg.opts, this.deps, this.post);
      if (this.stopped) { core.stop(); return; }
      this.core = core;
      for (const m of this.queue.splice(0)) this.dispatch(core, m);
    } catch (e) {
      this.post({ t: 'error', message: `local host failed to start: ${e instanceof Error ? e.message : String(e)}` }, []);
    }
  }

  private dispatch(core: LocalHostCore, msg: ToLocalHost): void {
    if (msg.t !== 'dev') return core.handle(msg);
    core.devCommand(msg.name, msg.args).then(
      (result) => this.post({ t: 'devResult', reqId: msg.reqId, ok: true, result }, []),
      (e: unknown) => this.post({ t: 'devResult', reqId: msg.reqId, ok: false, code: e instanceof LocalDevError ? e.code : 'internal', message: e instanceof Error ? e.message : String(e) }, []),
    );
  }
}
