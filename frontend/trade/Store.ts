import { setPanel, type PanelId, type TradeState } from './model/state';

/** Single mutable cell holding the immutable `TradeState`; subscribers re-render on every change. */
export class Store {
  private listeners = new Set<(s: TradeState, changed: ReadonlySet<PanelId | 'all'>) => void>();
  constructor(private state: TradeState) {}

  get(): TradeState { return this.state; }

  set(next: TradeState, changed: ReadonlyArray<PanelId | 'all'> = ['all']): void {
    this.state = next;
    const set = new Set(changed);
    for (const l of this.listeners) l(next, set);
  }

  update(fn: (s: TradeState) => TradeState, changed: ReadonlyArray<PanelId | 'all'> = ['all']): void { this.set(fn(this.state), changed); }

  subscribe(fn: (s: TradeState, changed: ReadonlySet<PanelId | 'all'>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Runs a loader for one panel: loading -> ready / error, keeping the data the loader applies. */
  async load(id: PanelId, run: (s: TradeState) => Promise<(s: TradeState) => TradeState>, quiet = false): Promise<void> {
    if (!quiet && this.state.panels[id].status !== 'ready') this.set(setPanel(this.state, id, { status: 'loading' }), [id]);
    try {
      const apply = await run(this.state);
      this.set(setPanel(apply(this.state), id, { status: 'ready' }), [id]);
    } catch (err) {
      this.set(setPanel(this.state, id, { status: 'error', error: err instanceof Error ? err.message : 'Failed to load.' }), [id]);
    }
  }
}
