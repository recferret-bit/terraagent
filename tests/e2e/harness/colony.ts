import type { Page } from '@playwright/test';

/**
 * Read / command helpers over the online session's debug handle (`window.__online`) shared by the economy suites
 * (W02, W03): colony 0's synced view, a raw sim command, and a flat snapshot of the entity table.
 */

export interface OnlineEntityPower {
  state: 'online' | 'offline';
  reason?: string;
  component: number;
  flow?: number;
  max?: number;
  overloaded?: boolean;
}

export interface OnlinePylonLoad {
  flow: number;
  max: number;
  overloaded?: boolean;
}

export interface OnlineColonySupply {
  used: number;
  units: number;
  reserved: number;
  cap: number;
  available: number;
  max: number;
  sources: Array<{ building: string; label: string; count: number; each: number; total: number }>;
}

export interface OnlineColonyView {
  stock?: Record<string, number>;
  /** W13-41 whole-unit stock: the fractional part of each resource, in millionths of a unit (`col.residual`). */
  residual?: Record<string, number>;
  caps?: Record<string, number>;
  earmarks?: Record<string, number>;
  supply?: OnlineColonySupply;
  power?: {
    supply?: number;
    demand?: number;
    rawDemand?: number;
    net?: number;
    founderCorePerS?: number;
    solarGrossPerS?: number;
    solarNetPerS?: number;
    windNetPerS?: number;
    capacitorStoredE?: number;
    capacitorDischargePerS?: number;
    hqCellStoredE?: number;
    hqCellCapacityE?: number;
    hqCellDischargePerS?: number;
    hqCellChargePerS?: number;
    brownout?: boolean;
    shedGroupsActive?: number[];
    shedEntityIds?: number[];
    offlineReasons?: Record<string, string>;
    entityPower?: Record<string, OnlineEntityPower>;
    pylonLoads?: Record<string, OnlinePylonLoad>;
    phase?: string;
    clockText?: string;
    daylight?: number;
  };
  queue?: Array<{
    taskId: string;
    lane: string;
    precedence?: string;
    state: string;
    waitReason?: string;
    waitDetail?: string;
    earmarked?: Record<string, number>;
    subEntityIds?: number[];
    spentCost?: Record<string, number>;
  }>;
}

export interface SimAck { ok: boolean; appliedAtTick?: number; code?: string; detail?: string }

interface OnlineDebugWindow {
  __online: {
    store: {
      latest: {
        tick: number;
        count: number;
        entities: Float32Array;
        colonies: OnlineColonyView[];
      } | null;
    };
    commands: { send(kind: string, args?: unknown): Promise<SimAck> };
  };
}

/** Entity kinds the suites look for (`ENTITY_KIND` in `shared/sim/src/ecs/columns.ts`). */
export const KIND = {
  hq: 3,
  metalsExtractor: 5,
  solar: 6,
  worker: 7,
  pylon: 9,
  mineralsQuarry: 14,
  waterExtractor: 15,
} as const;
/** `ENTITY_STATE.constructing`: a building site, not a finished building. */
export const STATE_CONSTRUCTING = 4;

export interface EntityRow { id: number; kind: number; q: number; r: number; hp: number; hpMax: number; state: number }

/** Colony 0's synced view (stock, caps, power, supply, queue), or null before the first view. */
export const getColony0 = (page: Page): Promise<OnlineColonyView | null> =>
  page.evaluate(() => (window as unknown as OnlineDebugWindow).__online.store.latest?.colonies?.[0] ?? null);

/** Sends one sim command through the session's command bus; resolves with the host's ack / reject. */
export const sendSimCmd = (page: Page, kind: string, args: unknown): Promise<SimAck> =>
  page.evaluate(([k, a]) => (window as unknown as OnlineDebugWindow).__online.commands.send(k, a), [kind, args] as const);

/** Every entity row of the latest view (id, kind, tile, hp, state). */
export const getEntitiesSnapshot = (page: Page): Promise<EntityRow[]> =>
  page.evaluate(() => {
    const s = (window as unknown as OnlineDebugWindow).__online.store.latest;
    if (!s) return [];
    const stride = s.count > 0 ? s.entities.length / s.count : 12;
    const out: Array<{ id: number; kind: number; q: number; r: number; hp: number; hpMax: number; state: number }> = [];
    for (let i = 0; i < s.count; i++) {
      const o = i * stride;
      out.push({
        id: s.entities[o]!,
        kind: s.entities[o + 1]!,
        q: s.entities[o + 3]!,
        r: s.entities[o + 4]!,
        hp: s.entities[o + 8]!,
        hpMax: s.entities[o + 9]!,
        state: s.entities[o + 10]!,
      });
    }
    return out;
  });
