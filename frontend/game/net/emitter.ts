/** Minimal synchronous listener set. */
export class Emitter<T> {
  private readonly fns = new Set<(v: T) => void>();
  on(fn: (v: T) => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  emit(v: T): void {
    for (const fn of [...this.fns]) fn(v);
  }
}
