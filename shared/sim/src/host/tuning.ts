import { compileData, exportOverrides, mergeOverrides, setOverride, type BalanceOverrides, type RowValue } from '../data';
import type { SimEvent } from '../kernel/events';
import type { Pipeline } from '../kernel/step';
import { createRegistryPipeline } from '../systems/registry';
import type { SimModule } from '../systems/define';

/** Per-planet balance state (D-35): `base` = file ⊕ scenario overrides, `live` = dev-console tunes on top. */
export interface PlanetTuning {
  readonly flags: readonly string[];
  readonly base: BalanceOverrides;
  live: BalanceOverrides;
}

export type TuneRequest =
  | { readonly op: 'set'; readonly path: string; readonly value: unknown }
  | { readonly op: 'reset' }
  | { readonly op: 'export' };

export const effectiveOverrides = (t: PlanetTuning): BalanceOverrides => mergeOverrides(t.base, t.live);

/** Engine pipeline for a planet with the given overrides (throws on unknown table/row/field). */
export function buildPipeline(flags: readonly string[], overrides: BalanceOverrides, modules?: readonly SimModule[]): Pipeline {
  return createRegistryPipeline({ flags, data: compileData(new Set(flags), overrides), ...(modules ? { modules } : {}) });
}

export interface TuneOutcome {
  /** New live overrides + pipeline to install, absent for `export`. */
  readonly next?: { readonly live: BalanceOverrides; readonly pipeline: Pipeline };
  readonly text?: string;
  readonly event?: Omit<SimEvent, 'atTick'>;
}

/**
 * Computes the result of a tune request without touching the planet: the caller installs `next` (so a bad path leaves
 * the running pipeline untouched) and publishes `event`.
 */
export function tune(t: PlanetTuning, req: TuneRequest, modules?: readonly SimModule[]): TuneOutcome {
  if (req.op === 'export') return { text: exportOverrides(effectiveOverrides(t)) };
  const live = req.op === 'reset' ? {} : setOverride(t.live, req.path, req.value as RowValue);
  const pipeline = buildPipeline(t.flags, mergeOverrides(t.base, live), modules);
  const hash = pipeline.config.data.hash;
  const value = req.op === 'set' ? readValue(live, req.path) : undefined;
  return {
    next: { live, pipeline },
    event: {
      kind: 'dev.tuned', severity: 'info', colonyIds: [],
      data: req.op === 'set' ? { op: 'set', path: req.path, value, dataHash: hash } : { op: 'reset', dataHash: hash },
    },
  };
}

function readValue(o: BalanceOverrides, path: string): unknown {
  const [t, r, f] = path.split('.') as [string, string, string];
  return o[t]?.[r]?.[f];
}
