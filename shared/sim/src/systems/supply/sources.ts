import type { CompiledRow } from '../../data';
import { ENTITY_KIND } from '../../ecs/columns';
import type { CompiledDataLike } from '../../kernel/config';
import { defaultHubData } from '../factories-hub/unit';

/**
 * Where unit supply numbers come from (data only, XC-01): what each unit kind uses and what each building kind provides.
 *
 * - A unit uses `supply` of its row: any row with `kind: 'unit'` and a `unit` name that is an `ENTITY_KIND`
 *   (`worker`, …), plus the HQ (`hq.t1.supply`, 0: the HQ never counts). The first row of a repeated unit name wins.
 * - A building provides `supplyProvided` of its row: any row with a `building` name that is an `ENTITY_KIND`
 *   (Command Hub `hub.t1`, Supply Depot `grid.supplyDepot`, …). Other buildings provide 0.
 * - The colony cap is clamped to `hub.t1.supplyCapMax`.
 */
export interface SupplyProvider {
  kind: number;
  building: string;
  label: string;
  provided: number;
}

export interface SupplySources {
  /** Supply used per alive unit, by `ENTITY_KIND`; kinds absent here use 0. */
  readonly unitSupplyByKind: ReadonlyMap<number, number>;
  /** Supply of a producible unit by its order name (`'worker'`). */
  readonly unitSupplyByName: ReadonlyMap<string, number>;
  /** Cap providers by `ENTITY_KIND`. */
  readonly providers: ReadonlyMap<number, SupplyProvider>;
  /** Ceiling of the colony cap (all providers summed). */
  readonly capMax: number;
}

const ENTITY_KIND_BY_NAME = ENTITY_KIND as Readonly<Record<string, number>>;
const cache = new WeakMap<object, SupplySources>();

/** The data a supply read uses: the step's compiled data when it has the Hub table, else the W00–W03 defaults. */
export function supplyData(data?: CompiledDataLike): CompiledDataLike {
  return data?.tables?.hub ? data : defaultHubData();
}

function tableRows(data: CompiledDataLike): Array<[string, CompiledRow]> {
  const out: Array<[string, CompiledRow]> = [];
  for (const name of Object.keys(data.tables).sort()) {
    const table = data.tables[name] as Record<string, CompiledRow> | undefined;
    if (!table || typeof table !== 'object') continue;
    for (const row of Object.values(table)) if (row && typeof row === 'object') out.push([name, row]);
  }
  return out;
}

function kindOf(name: unknown): number | undefined {
  return typeof name === 'string' ? ENTITY_KIND_BY_NAME[name] : undefined;
}

function collect(data: CompiledDataLike): SupplySources {
  const unitSupplyByKind = new Map<number, number>();
  const unitSupplyByName = new Map<string, number>();
  const providers = new Map<number, SupplyProvider>();
  for (const [table, row] of tableRows(data)) {
    const unitKind = row.kind === 'unit' ? kindOf(row.unit) : undefined;
    if (unitKind !== undefined && typeof row.supply === 'number' && !unitSupplyByName.has(String(row.unit))) {
      unitSupplyByKind.set(unitKind, row.supply);
      unitSupplyByName.set(String(row.unit), row.supply);
    }
    const buildingKind = kindOf(row.building);
    if (buildingKind !== undefined && typeof row.supplyProvided === 'number' && !providers.has(buildingKind)) {
      const label = typeof row.label === 'string' ? row.label : table === 'hub' ? 'Command Hub' : String(row.building);
      providers.set(buildingKind, { kind: buildingKind, building: String(row.building), label, provided: row.supplyProvided });
    }
  }
  const tables = data.tables as Record<string, Record<string, CompiledRow> | undefined>;
  const hq = tables.hq?.t1;
  if (hq && typeof hq.supply === 'number') unitSupplyByKind.set(ENTITY_KIND.hq, hq.supply);
  const hub = tables.hub?.t1;
  const capMax = hub && typeof hub.supplyCapMax === 'number' ? hub.supplyCapMax : 0;
  return { unitSupplyByKind, unitSupplyByName, providers, capMax };
}

/** The supply numbers of `data` (cached per compiled data object). */
export function supplySources(data?: CompiledDataLike): SupplySources {
  const d = supplyData(data);
  let s = cache.get(d);
  if (!s) {
    s = collect(d);
    cache.set(d, s);
  }
  return s;
}

/** Supply one alive entity of `kind` uses (0 for buildings, the HQ and unknown kinds). */
export function unitSupplyOfKind(kind: number, data?: CompiledDataLike): number {
  return supplySources(data).unitSupplyByKind.get(kind) ?? 0;
}

/** Supply a produced unit named `unit` uses, or `undefined` when `data` has no such producible unit. */
export function unitSupplyOfName(unit: string, data?: CompiledDataLike): number | undefined {
  return supplySources(data).unitSupplyByName.get(unit);
}
