import { RESOURCE_KEYS, type ResourceKey, type Stock } from '@terra/contracts';
import type { ColonyState, PlanetState } from '../../kernel/state';

function createEmptyStock(): Stock {
  const out = {} as Stock;
  for (const key of RESOURCE_KEYS) out[key] = 0;
  return out;
}

function resolveColonyIdentity(state: PlanetState, colonyId: number | string): { index: number; id: string } {
  if (typeof colonyId === 'number') {
    const existing = state.colonies[colonyId];
    return { index: colonyId, id: existing?.id ?? `col_${colonyId}` };
  }
  const byId = state.colonies.find((c) => c && c.id === colonyId);
  if (byId) return { index: byId.index, id: byId.id };
  const parsed = Number(colonyId);
  if (Number.isInteger(parsed) && parsed >= 0) {
    const existing = state.colonies[parsed];
    return { index: parsed, id: existing?.id ?? colonyId };
  }
  return { index: 0, id: colonyId };
}

function ensureColonyRecord(state: PlanetState, index: number, id: string, tick: number): ColonyState {
  const existing = state.colonies[index];
  if (existing) return existing;
  const created: ColonyState = {
    index,
    id,
    name: `Colony ${index}`,
    color: 0xff8800,
    status: 'active',
    changedAt: tick,
  };
  state.colonies[index] = created;
  return created;
}

function readBlobStockMap(state: PlanetState): Record<string, Stock> {
  const blob = state.blobs.colonyStock;
  if (!blob) return {};
  const val = (blob.value ?? blob) as Record<string, unknown>;
  const out: Record<string, Stock> = {};
  for (const [k, v] of Object.entries(val)) {
    if (k === 'changedAt' || k === 'value') continue;
    if (typeof v === 'object' && v !== null) {
      out[k] = { ...(v as Stock) };
    }
  }
  return out;
}

/** Returns the colony's current resource stock across all 10 D-34 `ResourceKey` entries. */
export function getColonyStock(state: PlanetState, colonyId: number | string): Stock {
  const { index, id } = resolveColonyIdentity(state, colonyId);
  const base = createEmptyStock();
  const colStock = state.colonies[index]?.stock as Partial<Stock> | undefined;
  const blobMap = readBlobStockMap(state);
  const fromBlob = blobMap[id] ?? blobMap[String(index)];
  return {
    ...base,
    ...(colStock ?? {}),
    ...(fromBlob ?? {}),
  };
}

/** Replaces or initializes the stock map for `colonyId` on both `state.colonies` and `state.blobs.colonyStock`. */
export function setColonyStock(
  state: PlanetState,
  colonyId: number | string,
  stockInput: Partial<Record<ResourceKey, number>>,
  tick: number = state.meta.tick,
): Stock {
  const { index, id } = resolveColonyIdentity(state, colonyId);
  const next: Stock = { ...createEmptyStock(), ...stockInput };
  const col = ensureColonyRecord(state, index, id, tick);
  col.stock = { ...next };
  col.changedAt = tick;

  const map = readBlobStockMap(state);
  map[id] = { ...next };
  map[String(index)] = { ...next };
  state.blobs.colonyStock = {
    changedAt: tick,
    value: map,
    ...map,
  } as unknown as PlanetState['blobs'][string];
  return { ...next };
}

/** Adds `amount` of `resourceKey` to `colonyId`'s stock and stamps `state.colonies` and `state.blobs.colonyStock`. */
export function addColonyResource(
  state: PlanetState,
  colonyId: number | string,
  resourceKey: ResourceKey,
  amount: number,
  tick: number = state.meta.tick,
): Stock {
  const cur = getColonyStock(state, colonyId);
  cur[resourceKey] = (cur[resourceKey] ?? 0) + amount;
  return setColonyStock(state, colonyId, cur, tick);
}
