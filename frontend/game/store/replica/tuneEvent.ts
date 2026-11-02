import type { SimEventWire } from '@terra/contracts';
import { setOverride, type BalanceOverrides, type RowValue } from '@terra/sim';

/** The data of a `dev.tuned` event (a live `tune` on the host, D-35). */
export interface TunedData { op: 'set' | 'reset'; path?: string; value?: unknown; dataHash: string }

/** The `dev.tuned` events among `events` (delta window or a bare `event`). */
export const tunedEvents = (events: readonly SimEventWire[]): TunedData[] =>
  events.filter((e) => e.kind === 'dev.tuned').map((e) => e.data as unknown as TunedData);

/**
 * The welcome's effective overrides with one live tune applied, or null when the client cannot rebuild them: a
 * `reset` (the client only knows base ⊕ live, not the base) or a path / value it rejects. Null → ask for a fresh
 * welcome, which carries the host's overrides. The caller still checks the compiled hash against `dataHash`.
 */
export function applyTuned(overrides: BalanceOverrides | undefined, t: TunedData): BalanceOverrides | null {
  if (t.op !== 'set' || !t.path) return null;
  try { return setOverride(overrides ?? {}, t.path, t.value as RowValue); } catch { return null; }
}
