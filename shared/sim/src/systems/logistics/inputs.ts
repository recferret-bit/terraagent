import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import type { CompiledRow } from '../../data';
import type { LogisticsBuilding, LogisticsNode, LogisticsUnit, UnitReadiness } from '../../economy/logistics';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { UnitBook } from '../../units/book';
import { isActiveCapacityProvider } from '../economy/ledger';
import { w01Row } from '../rows';

type Kind = keyof typeof ENTITY_KIND;
interface LoadRow { weight: number; consumption: Record<string, number> }

const OFFLINE: ReadonlySet<number> = new Set([
  ENTITY_STATE.constructing, ENTITY_STATE.offlineBrownout, ENTITY_STATE.offlineUnpowered, ENTITY_STATE.offlineOverload,
  ENTITY_STATE.offlineNoGrid, ENTITY_STATE.offlineNoFuel, ENTITY_STATE.offlineCapped, ENTITY_STATE.descending,
]);

/** Logistics unit readiness from the entity state (data-free mapping of existing states; W07 combat units will map `combat`). */
export function readinessOf(st: number): UnitReadiness | null {
  if (st === ENTITY_STATE.descending || st === ENTITY_STATE.constructing) return null;
  if (st === ENTITY_STATE.moving) return 'moving';
  if (st === ENTITY_STATE.working || st === ENTITY_STATE.harvesting || st === ENTITY_STATE.repairing) return 'combat';
  if (st === ENTITY_STATE.inert) return 'reserve';
  return 'ready';
}

/** Rows `building.*` / `unit.*` of the logistics table keyed by entity kind code. */
function loadRows(data: CompiledDataLike, prefix: 'building.' | 'unit.'): Map<number, LoadRow> {
  const table = (data.tables['logistics'] ?? {}) as Record<string, CompiledRow>;
  const out = new Map<number, LoadRow>();
  for (const [id, row] of Object.entries(table)) {
    if (!id.startsWith(prefix)) continue;
    out.set(ENTITY_KIND[row.kind as Kind], { weight: Number(row.weight), consumption: row.consumption as Record<string, number> });
  }
  return out;
}

export interface ColonyInputs {
  buildings: LogisticsBuilding[];
  units: LogisticsUnit[];
  nodes: LogisticsNode[];
  /** Every live entity id of the colony that has a logistics row (any state): the owners of persistent reserves. */
  liveIds: Set<string>;
}

/** Operating buildings, units and supply nodes of one colony (domain = the colony's own supply network). */
export function collectInputs(state: PlanetState, colony: number, data: CompiledDataLike): ColonyInputs {
  const b = loadRows(data, 'building.'), u = loadRows(data, 'unit.');
  const hub = w01Row(data, 'logistics', 'node.commandHub.t1'), depot = w01Row(data, 'logistics', 'node.supplyDepot.t1');
  const e = state.entities, c = e.cols;
  const out: ColonyInputs = { buildings: [], units: [], nodes: [], liveIds: new Set() };
  const domainId = String(colony);
  for (let r = 0; r < e.count; r++) {
    if (c.owner[r] !== colony || c.hp[r] <= 0) continue;
    const id = String(c.id[r]), tile = { q: c.q[r], r: c.r[r] }, kind = c.kind[r], st = c.state[r];
    const node = kind === ENTITY_KIND.commandHub ? { row: hub, kind: 'commandHub' as const } : kind === ENTITY_KIND.supplyDepot ? { row: depot, kind: 'supplyDepot' as const } : null;
    if (node) {
      out.nodes.push({
        id, domainId, tile, kind: node.kind, throughputPerWindow: Number(node.row.throughputPerWindow), reachTiles: Number(node.row.reachTiles),
        commissioned: st !== ENTITY_STATE.constructing, powered: isActiveCapacityProvider(state, r), operational: !OFFLINE.has(st) || st === ENTITY_STATE.offlineCapped,
      });
    }
    const br = b.get(kind);
    if (br) {
      out.liveIds.add(id);
      out.buildings.push({ id, domainId, tile, weight: br.weight, consumption: br.consumption, operatingBp: OFFLINE.has(st) ? 0 : 10000 });
    }
    const ur = u.get(kind);
    const readiness = ur ? (state.blobs.units && new UnitBook(state).peek(c.id[r])?.reserve ? 'reserve' : readinessOf(st)) : null;
    if (ur) out.liveIds.add(id);
    if (ur && readiness) out.units.push({ id, domainId, tile, weight: ur.weight, consumption: ur.consumption, readiness });
  }
  return out;
}
