import {
  RESOURCE_FAMILIES,
  RESOURCE_FAMILY_OF,
  RESOURCE_KEYS,
  type CargoPendingItem,
  type CargoStatusPayload,
  type ResourceFamily,
  type ResourceKey,
} from '@terra/contracts';
import {
  CARGO_THROUGHPUT_WINDOW_TICKS,
  DEFAULT_CARGO_MINT_CAP_PER_DAY,
  ENTITY_KIND,
  ENTITY_STATE,
  TRADE_HUB_THROUGHPUT_PER_MIN,
} from '@terra/sim';
import { forEachEntity } from '../../store/replica/viewCodec';
import { normalizeKindCode, normalizeStateCode } from '../landfall/selectionHelpers';
import { viewColony } from '../shared/colony';

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

export function formatCargoCount(n: number): string {
  const safe = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  return safe.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function emptyResourceRecord(): Record<ResourceKey, number> {
  const out = {} as Record<ResourceKey, number>;
  for (const key of RESOURCE_KEYS) out[key] = 0;
  return out;
}

function applyResourceMap(target: Record<ResourceKey, number>, source: unknown): void {
  if (!source || typeof source !== 'object') return;
  const rec = source as Record<string, unknown>;
  for (const key of RESOURCE_KEYS) {
    const val = rec[key];
    if (typeof val === 'number' && Number.isFinite(val)) {
      target[key] = Math.max(0, Math.floor(val));
    }
  }
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
    if (normalizeKindCode(raw.kind) !== ENTITY_KIND.tradeHub) return;
    const owner = typeof raw.owner === 'number' ? raw.owner : colonyIndex;
    if (owner !== colonyIndex) return;
    const hp = typeof raw.hp === 'number' ? raw.hp : 650;
    if (hp <= 0) return;
    const id = Number(raw.id ?? raw.entityId ?? 0);
    const rawTier = Number(raw.tier ?? 1);
    const tier: 1 | 2 | 3 = rawTier >= 3 ? 3 : rawTier >= 2 ? 2 : 1;
    const state = raw.state !== undefined ? normalizeStateCode(raw.state) : ENTITY_STATE.active;
    const constructing = state === ENTITY_STATE.constructing || raw.state === 'constructing';
    const isOfflineState =
      constructing ||
      state === ENTITY_STATE.inert ||
      state === ENTITY_STATE.waiting ||
      state === ENTITY_STATE.offlineBrownout ||
      state === ENTITY_STATE.offlineUnpowered ||
      state === ENTITY_STATE.offlineCapped ||
      Boolean(offlineReasons[id]) ||
      shedIds.has(id);
    hubs.push({ id, tier, state, online: !isOfflineState, constructing });
  };

  const entities = rawView.entities;
  if (Array.isArray(entities)) {
    for (const e of entities) if (e && typeof e === 'object') addHub(e as Record<string, unknown>);
  } else if (entities instanceof Float32Array) {
    forEachEntity(entities, rawView.count as number | undefined, (e) => addHub(e as unknown as Record<string, unknown>));
  } else if (entities && typeof entities === 'object') {
    for (const [k, v] of Object.entries(entities as Record<string, unknown>)) {
      if (v && typeof v === 'object') addHub({ id: Number(k), ...(v as Record<string, unknown>) });
    }
  }
  return hubs;
}

function extractColonyCargoStatus(
  status: Partial<CargoStatusPayload> | null | undefined,
  colonyId: string,
  colonyIndex: number,
): Partial<CargoStatusPayload> | undefined {
  if (!status || typeof status !== 'object') return undefined;
  const withColonies = status as Partial<CargoStatusPayload> & {
    colonies?: Record<string, Partial<CargoStatusPayload>>;
  };
  if (withColonies.colonies && typeof withColonies.colonies === 'object') {
    const sub =
      withColonies.colonies[colonyId] ??
      withColonies.colonies[String(colonyIndex)] ??
      withColonies.colonies[`col-${colonyIndex}`];
    if (sub) return sub;
  }
  return status;
}

function resolveMintedAndThroughput(
  rawView: Record<string, unknown>,
  col: Record<string, unknown> | undefined,
  colCargo: Record<string, unknown> | undefined,
  viewStatus: Partial<CargoStatusPayload> | undefined,
  svcStatus: Partial<CargoStatusPayload> | undefined,
): {
  todayMintedByResource: Record<ResourceKey, number>;
  todayMinted: number;
  dailyCap: number;
  throughputUsedPerMin: number;
} {
  const todayMintedByResource = emptyResourceRecord();
  const cargoCaps = (col?.cargoCaps ?? colCargo) as
    | {
        windowEntries?: Array<{ tick?: number; amount?: number }>;
        mintedToday?: Record<string, number>;
        dailyCapOverride?: number;
      }
    | undefined;

  const wasCapReset = typeof colCargo?.capResetAtTick === 'number';
  const mapSources = wasCapReset
    ? [cargoCaps?.mintedToday, colCargo?.mintedToday, colCargo?.todayMinted]
    : [
        cargoCaps?.mintedToday,
        colCargo?.mintedToday,
        colCargo?.todayMinted,
        viewStatus?.mintedToday,
        viewStatus?.todayMinted,
        svcStatus?.mintedToday,
        svcStatus?.todayMinted,
      ];
  for (const src of mapSources) {
    applyResourceMap(todayMintedByResource, src);
  }

  const directToday = (wasCapReset ? [colCargo?.todayMinted] : [svcStatus?.todayMinted, viewStatus?.todayMinted, colCargo?.todayMinted]).find(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
  const maxByRes = Math.max(0, ...Object.values(todayMintedByResource));
  const todayMinted = directToday !== undefined ? Math.max(0, Math.floor(directToday)) : maxByRes;

  const rawDailyCap =
    svcStatus?.dailyCap ??
    svcStatus?.mintCapPerDay ??
    viewStatus?.dailyCap ??
    viewStatus?.mintCapPerDay ??
    (colCargo?.dailyCap as number | undefined) ??
    (colCargo?.mintCapPerDay as number | undefined) ??
    cargoCaps?.dailyCapOverride ??
    DEFAULT_CARGO_MINT_CAP_PER_DAY;
  const dailyCap =
    typeof rawDailyCap === 'number' && Number.isFinite(rawDailyCap) && rawDailyCap > 0
      ? Math.floor(rawDailyCap)
      : DEFAULT_CARGO_MINT_CAP_PER_DAY;

  const currentTick = typeof rawView.tick === 'number' ? rawView.tick : 0;
  let windowSum = 0;
  if (Array.isArray(cargoCaps?.windowEntries)) {
    const cutoff = currentTick - CARGO_THROUGHPUT_WINDOW_TICKS;
    for (const entry of cargoCaps.windowEntries) {
      if (entry && typeof entry.amount === 'number' && entry.amount > 0 && (entry.tick ?? 0) > cutoff) {
        windowSum += entry.amount;
      }
    }
  }

  const rawUsed = wasCapReset || Array.isArray(cargoCaps?.windowEntries)
    ? windowSum
    : (svcStatus?.throughputUsedPerMin ??
        viewStatus?.throughputUsedPerMin ??
        (colCargo?.throughputUsedPerMin as number | undefined) ??
        (colCargo?.throughputUsed as number | undefined) ??
        windowSum);
  const throughputUsedPerMin =
    typeof rawUsed === 'number' && Number.isFinite(rawUsed) ? Math.max(0, Math.floor(rawUsed)) : 0;

  return { todayMintedByResource, todayMinted, dailyCap, throughputUsedPerMin };
}

function resolveColonyFamilyStorage(
  col: Record<string, unknown> | undefined,
  colCargo: Record<string, unknown> | undefined,
  rawView: Record<string, unknown>,
  stock: Record<ResourceKey, number>,
): {
  familyCaps: Record<ResourceFamily, number>;
  familyUsed: Record<ResourceFamily, number>;
  familyReserved: Record<ResourceFamily, number>;
  familyFree: Record<ResourceFamily, number>;
} {
  const familyCaps: Record<ResourceFamily, number> = { metals: 500, minerals: 500, bio: 500 };
  const rawCaps = (col?.caps ?? rawView.caps) as Partial<Record<ResourceFamily, unknown>> | undefined;
  if (rawCaps && typeof rawCaps === 'object') {
    for (const fam of RESOURCE_FAMILIES) {
      const val = rawCaps[fam];
      if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
        familyCaps[fam] = Math.floor(val);
      }
    }
  }

  const familyUsed: Record<ResourceFamily, number> = { metals: 0, minerals: 0, bio: 0 };
  for (const key of RESOURCE_KEYS) {
    const fam = RESOURCE_FAMILY_OF[key];
    familyUsed[fam] += stock[key] ?? 0;
  }

  const familyReserved: Record<ResourceFamily, number> = { metals: 0, minerals: 0, bio: 0 };
  const rawReserved = colCargo?.reservedByFamily as Partial<Record<ResourceFamily, unknown>> | undefined;
  if (rawReserved && typeof rawReserved === 'object') {
    for (const fam of RESOURCE_FAMILIES) {
      const val = rawReserved[fam];
      if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
        familyReserved[fam] = Math.floor(val);
      }
    }
  }

  const familyFree: Record<ResourceFamily, number> = {
    metals: Math.max(0, familyCaps.metals - familyUsed.metals - familyReserved.metals),
    minerals: Math.max(0, familyCaps.minerals - familyUsed.minerals - familyReserved.minerals),
    bio: Math.max(0, familyCaps.bio - familyUsed.bio - familyReserved.bio),
  };

  return { familyCaps, familyUsed, familyReserved, familyFree };
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
  if (tab === 'export') {
    const availableAmount = Math.max(0, Math.floor(resolved.stock[resource] ?? 0));
    const throughputRemaining = Math.max(0, resolved.throughputCapPerMin - resolved.throughputUsedPerMin);
    const byResMap = resolved.todayMintedByResource;
    const anyByRes = byResMap ? Object.values(byResMap).some((v) => typeof v === 'number' && v > 0) : false;
    const mintedForRes = anyByRes
      ? (byResMap?.[resource] ?? 0)
      : (byResMap?.[resource] || resolved.todayMinted || 0);
    const dailyRemaining = Math.max(0, resolved.dailyCap - mintedForRes);
    const capBound = Math.min(throughputRemaining, dailyRemaining);
    const maxAmount = resolved.hubOnline ? Math.max(0, Math.min(availableAmount, capBound)) : 0;

    let limitReason: string | null = null;
    if (!resolved.hubOnline) {
      limitReason = resolved.hubConstructing ? 'Trade Hub constructing — offline' : 'Trade Hub offline';
    } else if (availableAmount <= 0) {
      limitReason = 'No stock available in colony';
    } else if (throughputRemaining <= 0) {
      limitReason = `Throughput cap reached (${formatCargoCount(resolved.throughputCapPerMin)} / min)`;
    } else if (dailyRemaining <= 0) {
      limitReason = `Daily export limit reached (${formatCargoCount(resolved.dailyCap)} / day)`;
    } else if (capBound < availableAmount) {
      limitReason =
        throughputRemaining <= dailyRemaining
          ? `Bounded by throughput cap (${formatCargoCount(throughputRemaining)} / min remaining)`
          : `Bounded by daily export limit (${formatCargoCount(dailyRemaining)} / day remaining)`;
    }

    return { maxAmount, availableAmount, capBound, limitReason };
  }

  const family = RESOURCE_FAMILY_OF[resource];
  const availableAmount = Math.max(0, Math.floor(resolved.inOrbit[resource] ?? 0));
  const capBound = Math.max(0, Math.floor(resolved.familyFree?.[family] ?? 0));
  const maxAmount = resolved.hubOnline ? Math.max(0, Math.min(availableAmount, capBound)) : 0;

  let limitReason: string | null = null;
  if (!resolved.hubOnline) {
    limitReason = resolved.hubConstructing ? 'Trade Hub constructing — offline' : 'Trade Hub offline';
  } else if (availableAmount <= 0) {
    limitReason = 'No cargo in orbit';
  } else if (capBound <= 0) {
    limitReason = 'Colony storage full';
  } else if (capBound < availableAmount) {
    limitReason = `Bounded by free storage (${formatCargoCount(capBound)} free)`;
  }

  return { maxAmount, availableAmount, capBound, limitReason };
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
