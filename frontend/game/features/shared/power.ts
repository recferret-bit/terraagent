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

export interface EntityPowerView {
  state: 'online' | 'offline';
  reason?: string;
  component: number;
  flow?: number;
  max?: number;
  overloaded?: boolean;
}

export interface PylonLoadView {
  flow: number;
  max: number;
  overloaded?: boolean;
}

/** Reads per-building power state `{state, reason, component, flow, max, overloaded}` from client or sim view. */
export function readEntityPower(
  view: unknown,
  entityId: number,
  colonyIndex = 0,
): EntityPowerView | undefined {
  const v = (view ?? {}) as Record<string, unknown>;
  const epMap = v.entityPower as Record<number, EntityPowerView> | undefined;
  if (epMap?.[entityId]) return epMap[entityId];

  if (Array.isArray(v.entities)) {
    const ent = (v.entities as Array<{ id: number; power?: EntityPowerView }>).find((e) => e.id === entityId);
    if (ent?.power) return ent.power;
  }

  const colPower = readColonyPower(view, colonyIndex);
  const ep = (colPower?.entityPower as Record<number, { state: 'online' | 'offline'; reason?: string; component: number }> | undefined)?.[entityId];
  if (ep) {
    const pl = (colPower?.pylonLoads as Record<number, { flow: number; max: number; overloaded?: boolean }> | undefined)?.[entityId];
    return {
      state: ep.state,
      ...(ep.reason ? { reason: ep.reason } : {}),
      component: ep.component,
      ...(pl ? { flow: pl.flow, max: pl.max, ...(pl.overloaded !== undefined ? { overloaded: pl.overloaded } : {}) } : {}),
    };
  }
  return undefined;
}

/** Reads per-pylon load `{flow, max, overloaded}` from client or sim view. */
export function readPylonLoad(
  view: unknown,
  entityId: number,
  colonyIndex = 0,
): PylonLoadView | undefined {
  const v = (view ?? {}) as Record<string, unknown>;
  const plMap = v.pylonLoads as Record<number, PylonLoadView> | undefined;
  if (plMap?.[entityId]) return plMap[entityId];

  if (Array.isArray(v.entities)) {
    const ent = (v.entities as Array<{ id: number; pylon?: PylonLoadView }>).find((e) => e.id === entityId);
    if (ent?.pylon) return ent.pylon;
  }

  const colPower = readColonyPower(view, colonyIndex);
  const pl = (colPower?.pylonLoads as Record<number, { flow: number; max: number; overloaded?: boolean }> | undefined)?.[entityId];
  if (pl) {
    return {
      flow: pl.flow,
      max: pl.max,
      ...(pl.overloaded !== undefined ? { overloaded: pl.overloaded } : {}),
    };
  }
  return undefined;
}

/** What the HUD shows of the grid, in whole E/s. */
export interface GridBalance {
  /** Generation (`generationPerS`: founder core + generators); older summaries: `supply`. Store discharge is not income. */
  supply: number;
  /** E/s the colony's consumers ask for (the sim's `rawDemand`, before brownout shedding). */
  requested: number;
  /** E/s shed by the brownout (`rawDemand − demand`): consumers switched off, e.g. an `offline: brownout` Extractor. */
  shed: number;
  /** Generation minus requested demand: negative at night / in a deficit, while the stores or a brownout cover it. */
  net: number;
  /**
   * E/s into (+) or out of (−) the stores (HQ cell first, then Capacitor Banks): `+10` charging by day, `−3` while
   * the stores carry the night. 0 with no store flow (or an older summary).
   */
  stored: number;
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
  const requested = Math.max(demand, num(power?.rawDemand) ?? demand);
  const shed = requested - demand;
  const generation = num(power?.generationPerS);
  const field = (k: string): number => num(power?.[k]) ?? 0;
  const stored = field('hqCellChargePerS') + field('capacitorChargePerS') - field('hqCellDischargePerS') - field('capacitorDischargePerS');
  if (generation === undefined) {
    const postShedNet = num(power?.net) ?? supply - demand;
    return { supply: Math.round(supply), requested: Math.round(requested), shed: Math.round(shed), net: Math.round(postShedNet - shed), stored: 0 };
  }
  return {
    supply: Math.round(generation),
    requested: Math.round(requested),
    shed: Math.round(shed),
    net: Math.round(generation - requested),
    stored: Math.round(stored),
  };
}

/** `+3 E/s` / `−3 E/s` (typographic minus, as every HUD number). */
export function formatSignedEPerS(n: number): string {
  return `${n >= 0 ? '+' : '−'}${Math.abs(n)} E/s`;
}
