import {
  RESOURCE_FAMILIES,
  RESOURCE_FAMILY_OF,
  RESOURCE_KEYS,
  type CargoStatusPayload,
  type ResourceFamily,
  type ResourceKey,
} from '@terra/contracts';
import {
  CARGO_THROUGHPUT_WINDOW_TICKS,
  DEFAULT_CARGO_MINT_CAP_PER_DAY,
  ENTITY_KIND,
  ENTITY_STATE,
} from '@terra/sim';
import { normalizeKindCode, normalizeStateCode } from '../../shared/selectionMeta';
import type { ResolvedTradeHubCargoView, ScannedHubEntity, TransferBounds } from '../cargoView';

export function formatCargoCount(n: number): string {
  const safe = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  return safe.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function emptyResourceRecord(): Record<ResourceKey, number> {
  const out = {} as Record<ResourceKey, number>;
  for (const key of RESOURCE_KEYS) out[key] = 0;
  return out;
}

export function applyResourceMap(target: Record<ResourceKey, number>, source: unknown): void {
  if (!source || typeof source !== 'object') return;
  const rec = source as Record<string, unknown>;
  for (const key of RESOURCE_KEYS) {
    const val = rec[key];
    if (typeof val === 'number' && Number.isFinite(val)) {
      target[key] = Math.max(0, Math.floor(val));
    }
  }
}

export function parseScannedHubEntity(
  raw: Record<string, unknown>,
  colonyIndex: number,
  offlineReasons: Record<number, string>,
  shedIds: ReadonlySet<number>,
): ScannedHubEntity | null {
  if (normalizeKindCode(raw.kind) !== ENTITY_KIND.tradeHub) return null;
  const owner = typeof raw.owner === 'number' ? raw.owner : colonyIndex;
  if (owner !== colonyIndex) return null;
  const hp = typeof raw.hp === 'number' ? raw.hp : 650;
  if (hp <= 0) return null;
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
  return { id, tier, state, online: !isOfflineState, constructing };
}

export function extractColonyCargoStatus(
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

export function resolveMintedAndThroughput(
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
  for (const src of mapSources) applyResourceMap(todayMintedByResource, src);

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

export function resolveColonyFamilyStorage(
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

function resolveExportLimitReason(
  resolved: ResolvedTradeHubCargoView,
  availableAmount: number,
  throughputRemaining: number,
  dailyRemaining: number,
  capBound: number,
): string | null {
  if (!resolved.hubOnline) {
    return resolved.hubConstructing ? 'Trade Hub constructing — offline' : 'Trade Hub offline';
  }
  if (availableAmount <= 0) return 'No stock available in colony';
  if (throughputRemaining <= 0) {
    return `Throughput cap reached (${formatCargoCount(resolved.throughputCapPerMin)} / min)`;
  }
  if (dailyRemaining <= 0) {
    return `Daily export limit reached (${formatCargoCount(resolved.dailyCap)} / day)`;
  }
  if (capBound < availableAmount) {
    return throughputRemaining <= dailyRemaining
      ? `Bounded by throughput cap (${formatCargoCount(throughputRemaining)} / min remaining)`
      : `Bounded by daily export limit (${formatCargoCount(dailyRemaining)} / day remaining)`;
  }
  return null;
}

export function computeExportBounds(
  resolved: ResolvedTradeHubCargoView,
  resource: ResourceKey,
): TransferBounds {
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
  const limitReason = resolveExportLimitReason(resolved, availableAmount, throughputRemaining, dailyRemaining, capBound);
  return { maxAmount, availableAmount, capBound, limitReason };
}

function resolveImportLimitReason(
  resolved: ResolvedTradeHubCargoView,
  availableAmount: number,
  capBound: number,
): string | null {
  if (!resolved.hubOnline) {
    return resolved.hubConstructing ? 'Trade Hub constructing — offline' : 'Trade Hub offline';
  }
  if (availableAmount <= 0) return 'No cargo in orbit';
  if (capBound <= 0) return 'Colony storage full';
  if (capBound < availableAmount) {
    return `Bounded by free storage (${formatCargoCount(capBound)} free)`;
  }
  return null;
}

export function computeImportBounds(
  resolved: ResolvedTradeHubCargoView,
  resource: ResourceKey,
): TransferBounds {
  const family = RESOURCE_FAMILY_OF[resource];
  const availableAmount = Math.max(0, Math.floor(resolved.inOrbit[resource] ?? 0));
  const capBound = Math.max(0, Math.floor(resolved.familyFree?.[family] ?? 0));
  const maxAmount = resolved.hubOnline ? Math.max(0, Math.min(availableAmount, capBound)) : 0;
  const limitReason = resolveImportLimitReason(resolved, availableAmount, capBound);
  return { maxAmount, availableAmount, capBound, limitReason };
}
