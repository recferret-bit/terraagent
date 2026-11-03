import { viewColony } from './colony';

/**
 * One reader of a colony's grid power summary (the sim's `ColonyPowerSummary`, `col.power`, mirrored in
 * `blobs.power.byColony`) for every HUD part that shows it (top-bar breakdown, power widget).
 */
export type PowerRecord = Record<string, unknown>;

/** Colony `colonyIndex`'s power summary in a view: `col.power`, else `blobs.power.byColony[i]`, else a flat `view.power`. */
export function readColonyPower(view: unknown, colonyIndex: number): PowerRecord | undefined {
  const v = (view ?? {}) as Record<string, unknown>;
  const col = viewColony(view, colonyIndex) as PowerRecord | undefined;
  const blobs = (v.blobs ?? {}) as Record<string, unknown>;
  const byColony = ((blobs.power ?? {}) as { byColony?: Record<number, unknown> }).byColony ?? {};
  return (col?.power ?? byColony[colonyIndex] ?? v.power) as PowerRecord | undefined;
}

/** What the HUD shows of the grid, in whole E/s. */
export interface GridBalance {
  supply: number;
  /** E/s the colony's consumers ask for (the sim's `rawDemand`, before brownout shedding). */
  requested: number;
  /** E/s shed by the brownout (`rawDemand − demand`): consumers switched off, e.g. an `offline: brownout` Extractor. */
  shed: number;
  /** Supply minus requested demand: negative while the grid cannot carry every consumer. */
  net: number;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * The grid balance a player reads: the sim's post-shed `demand` / `net` hide the shed consumers (a Hub-only grid
 * with an Extractor reports `−5 E/s`, `+3 E/s` while the Extractor is offline), so the HUD shows requested demand
 * (`rawDemand`) and the deficit against it. Display arithmetic over sim fields only; no power rule is evaluated here.
 */
export function gridBalance(power: PowerRecord | undefined): GridBalance {
  const supply = num(power?.supply) ?? 0;
  const demand = num(power?.demand) ?? 0;
  const postShedNet = num(power?.net) ?? supply - demand;
  const requested = Math.max(demand, num(power?.rawDemand) ?? demand);
  const shed = requested - demand;
  return {
    supply: Math.round(supply),
    requested: Math.round(requested),
    shed: Math.round(shed),
    net: Math.round(postShedNet - shed),
  };
}

/** `+3 E/s` / `−3 E/s` (typographic minus, as every HUD number). */
export function formatSignedEPerS(n: number): string {
  return `${n >= 0 ? '+' : '−'}${Math.abs(n)} E/s`;
}
