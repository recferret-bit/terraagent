import type { ResolvedFlags } from './resolve';

/** Current client flags + change notification; the net layer pushes `welcome.flags` through `update`, features re-filter. */
export class ClientFlagsStore {
  private cur: ResolvedFlags;
  private listeners = new Set<(r: ResolvedFlags) => void>();
  constructor(initial: ResolvedFlags) { this.cur = initial; }
  get current(): ResolvedFlags { return this.cur; }
  /** Enabled wave ids in the shape the feature registry wants. */
  get set(): ReadonlySet<string> { return new Set(this.cur.flags.list); }
  update(next: ResolvedFlags) {
    const same = next.source === this.cur.source && next.flags.list.join() === this.cur.flags.list.join();
    this.cur = next;
    if (!same) for (const l of [...this.listeners]) l(next);
  }
  onChange(fn: (r: ResolvedFlags) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
}
