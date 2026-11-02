import type { CompiledRow } from '../data';
import { ENTITY_KIND } from '../ecs/columns';
import type { PlanetState, PlanetType } from '../kernel/state';
import { resolveHarvesterRow } from '../systems/harvest/unit';
import type { HqJob, HqUnitView } from '../systems/hq';

/**
 * W00 view: a minimal read-only projection for render/HUD. Tile arrays are shared with the state (no copy; do not
 * mutate); entities and colonies are fresh plain objects. Features extend it by adding fields here.
 */
export interface ViewEntity {
  id: number; kind: number; owner: number; tier: number;
  q: number; r: number; x: number; y: number; rot: number;
  hp: number; hpMax: number; state: number; progress: number;
  cell?: number; cellMax?: number; targetQ?: number; targetR?: number;
  footprintW?: number; footprintD?: number; shedGroup?: number;
  unit?: string;
  label?: string;
  archetype?: string;
  supply?: number;
  powerDrainPerS?: number;
  speedTilesPerS?: number;
  viewRadius?: number;
  radius?: number;
  harvestRatePerS?: number;
  workRate?: number;
  maxBuildTier?: number;
}
export interface ViewColony {
  index: number; id: string; name: string; color: number; status: string;
  stock?: Record<string, number>;
  caps?: Record<string, number>;
  hq?: HqUnitView;
  currentJob?: HqJob;
  queueCount?: number;
  [field: string]: unknown;
}
export interface SimView {
  tick: number;
  planet: { id: string; type: PlanetType; radius: number };
  tiles: {
    count: number;
    terrain: Uint8Array;
    prep: Uint8Array;
    deposit: Uint8Array;
    richness?: Float32Array;
    height: Float32Array;
    owner: Int8Array;
    explored: Uint8Array;
  };
  entities: ViewEntity[];
  colonies: ViewColony[];
  blobs?: Record<string, unknown>;
}

export function view(state: PlanetState): SimView {
  const e = state.entities, c = e.cols, L = state.grid.layers;
  const entities: ViewEntity[] = [];
  let harvesterRow: CompiledRow | null = null;
  for (let i = 0; i < e.count; i++) {
    const kind = c.kind[i];
    const ent: ViewEntity = {
      id: c.id[i], kind, owner: c.owner[i], tier: c.tier[i],
      q: c.q[i], r: c.r[i], x: c.x[i], y: c.y[i], rot: c.rot[i],
      hp: c.hp[i], hpMax: c.hpMax[i], state: c.state[i], progress: c.progress[i],
      cell: c.cell?.[i] ?? 0, cellMax: c.cellMax?.[i] ?? 0,
      targetQ: c.targetQ?.[i] ?? 0, targetR: c.targetR?.[i] ?? 0,
      footprintW: c.footprintW?.[i] ?? 0, footprintD: c.footprintD?.[i] ?? 0,
      shedGroup: c.shedGroup?.[i] ?? 0,
    };
    if (kind === ENTITY_KIND.harvester) {
      if (!harvesterRow) harvesterRow = resolveHarvesterRow();
      ent.unit = 'harvester';
      ent.label = String(harvesterRow.label ?? 'Harvester Drone');
      ent.archetype = String(harvesterRow.archetype ?? 'robot.miner');
      ent.supply = Number(harvesterRow.supply ?? 1);
      ent.powerDrainPerS = Number(harvesterRow.powerDrainPerS ?? 1.5);
      ent.speedTilesPerS = Number(harvesterRow.designSpeedTilesPerS ?? 1.5);
      ent.viewRadius = Number(harvesterRow.viewRadius ?? 7);
      ent.radius = Number(harvesterRow.radius ?? 0.4);
      ent.harvestRatePerS = Number(harvesterRow.harvestRatePerS ?? 0.5);
      ent.workRate = c.workRate?.[i] ?? 1.0;
      ent.maxBuildTier = Number(harvesterRow.maxBuildTier ?? 0);
    }
    entities.push(ent);
  }
  const blobs: Record<string, unknown> = {};
  for (const [k, b] of Object.entries(state.blobs)) blobs[k] = b.value;
  const hqBlob = state.blobs.hq?.value as (HqUnitView & { byColony?: Record<number, HqUnitView> }) | undefined;
  const colonies: ViewColony[] = state.colonies.map((k) => {
    const hq = (k.hq as HqUnitView | undefined) ?? hqBlob?.byColony?.[k.index];
    const out: ViewColony = { ...k };
    if (hq) {
      out.hq = hq;
      out.currentJob = (k.currentJob as HqJob | undefined) ?? hq.currentJob;
      out.queueCount = (k.queueCount as number | undefined) ?? hq.queueCount;
    }
    return out;
  });
  return {
    tick: state.meta.tick,
    planet: { id: state.meta.planetId, type: state.meta.planetType, radius: state.grid.radius },
    tiles: {
      count: state.grid.count,
      terrain: L.terrain as Uint8Array,
      prep: L.prep as Uint8Array,
      deposit: L.deposit as Uint8Array,
      richness: L.richness as Float32Array,
      height: L.height as Float32Array,
      owner: L.owner as Int8Array,
      explored: L.explored as Uint8Array,
    },
    entities,
    colonies,
    blobs,
  };
}
