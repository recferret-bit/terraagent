import type { CompiledDataLike } from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import { viewColony } from '../shared/colony';
import { depositResource } from '../shared/depositLabel';

/** The parts of a sim event this reads (`SimEventWire`). */
interface SimEventLike {
  kind: string;
  colonyIds?: ReadonlyArray<string | number>;
  data?: Record<string, unknown>;
}

export interface ResourceFoundSource {
  /** Player-facing sim events (`WorldStore.onServerEvents`: server deltas and the browser-local host alike). */
  onServerEvents?(fn: (events: readonly SimEventLike[]) => void): () => void;
  latest?: GameView | null;
  simData?(): CompiledDataLike | null;
}

/** `Resource found: Light Alloys (T2) deposit at (3, -1)`, or `null` when the event is not a known deposit. */
export function resourceFoundText(data: Record<string, unknown> | undefined, simData?: CompiledDataLike | null): string | null {
  const res = depositResource(String(data?.deposit ?? ''), Number(data?.tier ?? 0), simData);
  if (!res) return null;
  return `Resource found: ${res.label} (T${res.tier}) deposit at (${Number(data?.q)}, ${Number(data?.r)})`;
}

/** Whether `e` is addressed to colony `index` of `view` (its record id, `col_<index>` or the bare index). */
function isForColony(e: SimEventLike, view: GameView | null | undefined, index: number): boolean {
  const ids = new Set<string>([String(index), `col_${index}`]);
  const recId = (viewColony(view, index) as { id?: unknown } | undefined)?.id;
  if (recId !== undefined) ids.add(String(recId));
  const targets = [...(e.colonyIds ?? []), e.data?.colonyId].filter((x) => x !== undefined).map(String);
  return targets.some((t) => ids.has(t));
}

/**
 * Toasts the player's `resourceSpawned` events (the 1 % deposit roll of a terraformed hex). Returns the unsubscribe;
 * a no-op when the store carries no event stream.
 */
export function bindResourceFoundToasts(
  store: ResourceFoundSource | undefined,
  getColonyId: () => number,
  toast: (message: string) => void,
): () => void {
  const off = store?.onServerEvents?.((events) => {
    for (const e of events) {
      if (e.kind !== 'resourceSpawned' || !isForColony(e, store.latest, getColonyId())) continue;
      const text = resourceFoundText(e.data, store.simData?.());
      if (text) toast(text);
    }
  });
  return off ?? (() => undefined);
}
