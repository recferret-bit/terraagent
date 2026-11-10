import {
  RESOURCE_FAMILIES,
  RESOURCE_FAMILY_OF,
  RESOURCE_KEYS,
  type CargoPendingItem,
  type CargoStatusPayload,
  type ResourceFamily,
  type ResourceKey,
} from '@terra/contracts';
import { TRADE_HUB_THROUGHPUT_PER_MIN } from '@terra/sim';
import { forEachEntity } from '../../store/replica/viewCodec';
import { viewColony } from '../shared/colony';
import {
  applyResourceMap,
  computeExportBounds,
  computeImportBounds,
  emptyResourceRecord,
  extractColonyCargoStatus,
  formatCargoCount,
  parseScannedHubEntity,
  resolveColonyFamilyStorage,
  resolveMintedAndThroughput,
} from './parts/cargoViewParts';

export { formatCargoCount };

export type TradeHubTab = 'export' | 'import';

export interface OrbitSubResourceDef {
  readonly key: ResourceKey;
  readonly label: string;
  readonly family: ResourceFamily;
}

export interface OrbitFamilyGroupDef {
  readonly family: ResourceFamily;
  readonly label: string;
  readonly resources: readonly OrbitSubResourceDef[];
}

export const SUB_RESOURCE_LABELS: Readonly<Record<ResourceKey, string>> = {
  'metals.t1': 'Metals T1',
  'metals.t2': 'Metals T2',
  'metals.t3': 'Metals T3',
  'minerals.t1': 'Minerals T1',
  'minerals.t2': 'Minerals T2',
  'minerals.t3': 'Minerals T3',
  'bio.water': 'Water',
  'bio.biomass': 'Biomass',
  'bio.t2': 'Bio T2',
  'bio.t3': 'Bio T3',
};

const FAMILY_TITLES: Readonly<Record<ResourceFamily, string>> = {
  metals: 'Metals',
  minerals: 'Minerals',
  bio: 'Bio',
};

export const ORBIT_FAMILY_GROUPS: readonly OrbitFamilyGroupDef[] = RESOURCE_FAMILIES.map((family) => ({
  family,
  label: FAMILY_TITLES[family],
  resources: RESOURCE_KEYS.filter((k) => RESOURCE_FAMILY_OF[k] === family).map((key) => ({
    key,
    label: SUB_RESOURCE_LABELS[key],
    family,
  })),
}));

export interface ResolvedTradeHubCargoView {
  colonyIndex: number;
  colonyId: string;
  hubEntityId: number | null;
  hubTier: number;
  hubOnline: boolean;
  hubConstructing: boolean;
  statusText: string;
  throughputUsedPerMin: number;
  throughputCapPerMin: number;
  todayMinted: number;
  todayMintedByResource: Record<ResourceKey, number>;
  dailyCap: number;
  inOrbit: Record<ResourceKey, number>;
  stock: Record<ResourceKey, number>;
  pending: CargoPendingItem[];
  familyCaps: Record<ResourceFamily, number>;
  familyUsed: Record<ResourceFamily, number>;
  familyReserved: Record<ResourceFamily, number>;
  familyFree: Record<ResourceFamily, number>;
}

export interface TransferBounds {
  maxAmount: number;
  availableAmount: number;
  capBound: number;
  limitReason: string | null;
}

export interface ScannedHubEntity {
  id: number;
  tier: 1 | 2 | 3;
  state: number;
  online: boolean;
  constructing: boolean;
}

export function scanColonyTradeHubs(
  rawView: Record<string, unknown>,
  col: Record<string, unknown> | undefined,
  colonyIndex: number,
): ScannedHubEntity[] {
  const hubs: ScannedHubEntity[] = [];
  const powerBlob = (rawView.blobs as { power?: { byColony?: Record<number, Record<string, unknown>> } } | undefined)
    ?.power?.byColony?.[colonyIndex];
  const power = (col?.power as Record<string, unknown> | undefined) ?? powerBlob;
  const offlineReasons = (power?.offlineReasons as Record<number, string> | undefined) ?? {};
  const shedIds = new Set<number>(Array.isArray(power?.shedEntityIds) ? (power.shedEntityIds as number[]) : []);

  const addHub = (raw: Record<string, unknown>) => {
    const parsed = parseScannedHubEntity(raw, colonyIndex, offlineReasons, shedIds);
    if (parsed) hubs.push(parsed);
  };

  const entities = rawView.entities;
  if (Array.isArray(entities)) {
    for (const e of entities) {
      if (e && typeof e === 'object') addHub(e as Record<string, unknown>);
    }
    return hubs;
  }
  if (entities instanceof Float32Array) {
    forEachEntity(entities, rawView.count as number | undefined, (e) => addHub(e as unknown as Record<string, unknown>));
    return hubs;
  }
  if (entities && typeof entities === 'object') {
    for (const [k, v] of Object.entries(entities as Record<string, unknown>)) {
      if (v && typeof v === 'object') addHub({ id: Number(k), ...(v as Record<string, unknown>) });
    }
  }
  return hubs;
}

export function resolveTradeHubCargoView(
  view?: unknown,
  cargoStatus?: Partial<CargoStatusPayload> | null,
  colonyIndex = 0,
  selectedEntityId: number | null = null,
): ResolvedTradeHubCargoView {
  const rawView = (view && typeof view === 'object' ? view : {}) as Record<string, unknown>;
  const col = (viewColony(rawView, colonyIndex) ?? (rawView.colony as Record<string, unknown> | undefined)) as
    | Record<string, unknown>
    | undefined;
  const colonyId = typeof col?.id === 'string' && col.id ? col.id : `col-${colonyIndex}`;
  const colCargo = (col?.cargo ?? rawView.cargo) as Record<string, unknown> | undefined;
  const viewStatus = extractColonyCargoStatus(
    rawView.cargoStatus as Partial<CargoStatusPayload> | undefined,
    colonyId,
    colonyIndex,
  );
  const svcStatus = extractColonyCargoStatus(cargoStatus, colonyId, colonyIndex);

  const inOrbit = emptyResourceRecord();
  for (const src of [col?.inOrbit, colCargo, colCargo?.inOrbit, colCargo?.balances, viewStatus?.inOrbit, svcStatus?.inOrbit]) {
    applyResourceMap(inOrbit, src);
  }

  const stock = emptyResourceRecord();
  applyResourceMap(stock, col?.stock ?? rawView.stock);

  const hubs = scanColonyTradeHubs(rawView, col, colonyIndex);
  const selectedHub =
    (selectedEntityId !== null ? hubs.find((h) => h.id === selectedEntityId) : undefined) ??
    hubs.find((h) => h.online) ??
    hubs[0];

  const rawTier = svcStatus?.hubTier ?? viewStatus?.hubTier ?? (colCargo?.hubTier as number | undefined) ?? selectedHub?.tier ?? 1;
  const hubTier = rawTier >= 3 ? 3 : rawTier >= 2 ? 2 : 1;
  const explicitOnline = svcStatus?.hubOnline ?? viewStatus?.hubOnline ?? (colCargo?.hubOnline as boolean | undefined);
  const hubConstructing = Boolean(selectedHub?.constructing);
  const hubOnline = selectedHub !== undefined ? selectedHub.online && explicitOnline !== false : explicitOnline !== undefined ? Boolean(explicitOnline) : true;

  const onlineHubCapSum = hubs.filter((h) => h.online).reduce((acc, h) => acc + (TRADE_HUB_THROUGHPUT_PER_MIN[h.tier] ?? 250), 0);
  const defaultCap = hubOnline ? (onlineHubCapSum > 0 ? onlineHubCapSum : (TRADE_HUB_THROUGHPUT_PER_MIN[hubTier] ?? 250)) : 0;
  const rawCap = svcStatus?.throughputCapPerMin ?? viewStatus?.throughputCapPerMin ?? (colCargo?.throughputCapPerMin as number | undefined) ?? (colCargo?.throughputCap as number | undefined) ?? defaultCap;
  const throughputCapPerMin = typeof rawCap === 'number' && Number.isFinite(rawCap) ? Math.max(0, Math.floor(rawCap)) : defaultCap;

  const { todayMintedByResource, todayMinted, dailyCap, throughputUsedPerMin } = resolveMintedAndThroughput(rawView, col, colCargo, viewStatus, svcStatus);
  const pending = (svcStatus?.pending ?? viewStatus?.pending ?? (colCargo?.pending as CargoPendingItem[] | undefined) ?? []) as CargoPendingItem[];
  const { familyCaps, familyUsed, familyReserved, familyFree } = resolveColonyFamilyStorage(col, colCargo, rawView, stock);

  return {
    colonyIndex,
    colonyId,
    hubEntityId: selectedHub?.id ?? selectedEntityId,
    hubTier,
    hubOnline,
    hubConstructing,
    statusText: hubOnline ? 'ONLINE' : 'OFFLINE — UNPOWERED',
    throughputUsedPerMin,
    throughputCapPerMin,
    todayMinted,
    todayMintedByResource,
    dailyCap,
    inOrbit,
    stock,
    pending,
    familyCaps,
    familyUsed,
    familyReserved,
    familyFree,
  };
}

export function computeTransferBounds(
  resolved: ResolvedTradeHubCargoView,
  tab: TradeHubTab,
  resource: ResourceKey,
): TransferBounds {
  return tab === 'export'
    ? computeExportBounds(resolved, resource)
    : computeImportBounds(resolved, resource);
}

export function formatTransferPreview(
  resolved: ResolvedTradeHubCargoView,
  tab: TradeHubTab,
  resource: ResourceKey,
  amount: number,
  bounds: TransferBounds,
): { previewText: string; limitReason: string | null } {
  const safeAmount = Math.max(0, Math.floor(amount));
  const label = SUB_RESOURCE_LABELS[resource];
  const curStock = resolved.stock[resource] ?? 0;
  const curOrbit = resolved.inOrbit[resource] ?? 0;

  let effectiveReason = bounds.limitReason;
  if (!effectiveReason && resolved.hubOnline && safeAmount > bounds.capBound) {
    effectiveReason =
      tab === 'export'
        ? `Bounded by throughput cap (${formatCargoCount(bounds.capBound)} / min remaining)`
        : `Bounded by free storage (${formatCargoCount(bounds.capBound)} free)`;
  }

  if (tab === 'export') {
    const remStock = Math.max(0, curStock - safeAmount);
    const nextOrbit = curOrbit + safeAmount;
    const previewText = `Export ${safeAmount} ${label} → Orbit (${remStock} remaining in stock · Stock ${curStock} → ${remStock}, Orbit ${curOrbit} → ${nextOrbit})`;
    return { previewText, limitReason: effectiveReason };
  }

  const family = RESOURCE_FAMILY_OF[resource];
  const freeStorage = resolved.familyFree[family] ?? 0;
  if (safeAmount > freeStorage && resolved.hubOnline) {
    const clamped = Math.max(0, freeStorage);
    const nextStock = curStock + clamped;
    const nextOrbit = Math.max(0, curOrbit - clamped);
    const previewText = `Import ${clamped} of ${safeAmount} ${label} → Colony (clamped to ${freeStorage} free storage · Stock ${curStock} → ${nextStock}, Orbit ${curOrbit} → ${nextOrbit})`;
    const clampReason = effectiveReason ?? `Bounded by free storage (${formatCargoCount(freeStorage)} free)`;
    return { previewText, limitReason: clampReason };
  }

  const nextStock = curStock + safeAmount;
  const nextOrbit = Math.max(0, curOrbit - safeAmount);
  const previewText = `Import ${safeAmount} ${label} → Colony (free storage: ${freeStorage} · Stock ${curStock} → ${nextStock}, Orbit ${curOrbit} → ${nextOrbit})`;
  return { previewText, limitReason: effectiveReason };
}
