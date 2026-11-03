import {
  DEPOSIT,
  entityFootprint,
  getBuildingFootprintTiles,
  groundWorkYields,
  hexIndex,
  isTileUneven,
  occupiesGround,
  PREP,
  TERRAIN,
  terraformOwnershipBlock,
  terraformWorldFrom,
  type CompiledDataLike,
  type PlacementWorld,
} from '@terra/sim';
import { formatCost } from '../shared/resources';

/** The ground a TERRAFORM `work` job prepares (the sim's `TERRAFORM_TIME_TABLE` keys). */
export type GroundKey = 'forest' | 'rock' | 'slope' | 'hole' | 'flat';

const GROUND_BY_TERRAIN: ReadonlyMap<number, GroundKey> = new Map([
  [TERRAIN.forest, 'forest'],
  [TERRAIN.rock, 'rock'],
  [TERRAIN.slope, 'slope'],
  [TERRAIN.hole, 'hole'],
  [TERRAIN.flat, 'flat'],
]);

/**
 * One-shot yield of terraforming `key` (forest and rock; none for the rest): the sim's `groundWorkYields` on the host's
 * compiled data (`data`), so a `tune` of the yields shows up. The one place the client reads terraform yields.
 */
export function groundYields(key: GroundKey, data?: CompiledDataLike): Record<string, number> | undefined {
  const y = groundWorkYields(key, data) as Record<string, number>;
  return Object.values(y).some((n) => n > 0) ? { ...y } : undefined;
}

const GROUND_VERB: Readonly<Record<GroundKey, string>> = {
  forest: 'Clear Trees',
  rock: 'Break Rock',
  slope: 'Level slope',
  hole: 'Fill crater',
  flat: 'Flatten ground',
};

/** `Clear Trees (+15 Biomass)`, `Level slope`: what one TERRAFORM job on `key` does. */
export function groundWorkLabel(key: GroundKey, data?: CompiledDataLike): string {
  const y = groundYields(key, data);
  return y ? `${GROUND_VERB[key]} (+${formatCost(y).replace(/ · /g, ', +')})` : GROUND_VERB[key];
}

export type GroundPreview = { ok: true; key: GroundKey } | { ok: false; reason: string; status: string };

const block = (reason: string, status: string): GroundPreview => ({ ok: false, reason, status });

function buildingOn(world: PlacementWorld, q: number, r: number, data?: CompiledDataLike): boolean {
  return world.entities.some(
    (e) => occupiesGround(e) && getBuildingFootprintTiles(e.q, e.r, entityFootprint(e.kind, data)).some((p) => p.q === q && p.r === r),
  );
}

/**
 * The host's TERRAFORM `work` rule for the clicked hex (`classifyGroundWorkTile` + the territory rule of `rules.ts`),
 * run on the replica view: inside the map, own territory (before territory: unclaimed hexes near the pod), no building,
 * no deposit, ground the job can work (forest, rock, slope, hole, Flat that is wild or not level). `null`: the view
 * carries no tile layers. The host stays the judge (it may still reject).
 */
export function previewGroundWork(
  world: PlacementWorld,
  colonyId: number,
  q: number,
  r: number,
  data?: CompiledDataLike,
): GroundPreview | null {
  if (world.tileCount === 0) return null;
  const i = hexIndex(world.radius).indexOf(q, r);
  if (i < 0 || i >= world.tileCount || (world.valid && world.valid[i] === 0)) return block('invalid_args', 'Outside the map');
  if (terraformOwnershipBlock(terraformWorldFrom(world, colonyId, data), colonyId, i, q, r)) {
    return block('not_own_territory', 'Outside your territory');
  }
  if (buildingOn(world, q, r, data)) return block('building_here', 'A building stands on this hex');
  if (world.deposit && world.deposit[i] !== DEPOSIT.none) return block('deposit_here', 'Resource deposit here: harvest it instead');
  const key = GROUND_BY_TERRAIN.get(world.terrain[i]!);
  if (!key) {
    const water = world.terrain[i] === TERRAIN.shallow || world.terrain[i] === TERRAIN.deep;
    return water ? block('water_tile', 'Cannot terraform water tile') : block('site_blocked', 'Cannot terraform this hex');
  }
  if (key === 'flat' && world.prep[i] === PREP.prepared && !isTileUneven(world.radius, i, world.terrain, world.height)) {
    return block('already_prepared', 'Hex is already prepared');
  }
  return { ok: true, key };
}
