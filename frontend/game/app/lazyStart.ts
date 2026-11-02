/**
 * Builds an app part from a lazily loaded chunk and returns its unmount. An unmount (HMR, Return to orbit) before the
 * chunk resolved cancels the build, so no session is created afterwards to run beside the next one (two rAF loops,
 * two sockets; FA-04).
 */
export function lazyStart<M, T extends { dispose(): void }>(load: () => Promise<M>, build: (m: M) => T): () => void {
  let instance: T | null = null;
  let cancelled = false;
  void load().then((m) => { if (!cancelled) instance = build(m); });
  return () => { cancelled = true; instance?.dispose(); instance = null; };
}
