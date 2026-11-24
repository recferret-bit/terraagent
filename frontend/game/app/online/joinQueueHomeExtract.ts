import {
  CANONICAL_PLANETS,
  canonicalPlanetById,
  type PlanetType,
  type SectorPlacementIntentV1,
} from '@terra/contracts';
import {
  normalizeSectorIntent,
  toSectorPlacementIntentV1,
  type SectorIntentInput,
} from '../../ui/lobby/orbitalPickerModel';
import type { BootOverlay } from './BootOverlay';
import {
  BootError,
  type BootColonySummary,
  type BootPlanetSummary,
  type FetchLike,
  type StorageLike,
} from './bootOnline';

export interface QueuedHomeStatus {
  readonly state: 'QUEUED';
  readonly ticketId: string;
  readonly ticketState: string;
  readonly planetId: string;
  readonly planetType: PlanetType;
  readonly sectorIntent: SectorPlacementIntentV1;
  readonly reservedSectorId: string | null;
  readonly colonyId?: string | null;
  readonly alternativeSectors: readonly string[];
  readonly position: number;
  readonly etaS: number | null;
}

export interface ActiveHomeTargetFilter {
  readonly colonyId?: string;
  readonly planetId?: string;
  readonly planetType?: PlanetType;
  readonly sectorId?: string;
  readonly excludeColonyIds?: ReadonlySet<string>;
}

export interface ExtractedActiveHome {
  readonly state: 'ACTIVE';
  readonly planet: BootPlanetSummary;
  readonly colony: BootColonySummary;
  readonly foundingSectorId?: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function inferQueuePlanetTypeFromId(planetId: string | undefined, fallback: PlanetType = 'desert'): PlanetType {
  if (!planetId) return fallback;
  const canonical = canonicalPlanetById(planetId);
  if (canonical) return canonical.type;
  const lower = planetId.toLowerCase();
  if (lower.includes('ocean') || lower.includes('thalassa')) return 'ocean';
  if (lower.includes('temperate') || lower.includes('granite') || lower.includes('forest')) return 'temperate';
  if (lower.includes('desert') || lower.includes('kharon') || lower.includes('dune')) return 'desert';
  return fallback;
}

export function resolveQueuePlanetId(planetId: string | undefined, planetType: PlanetType): string {
  const trimmed = planetId?.trim();
  if (trimmed) return trimmed;
  return CANONICAL_PLANETS[planetType].id;
}

export function extractQueuedHomeStatus(
  raw: unknown,
  fallback?: { planetType?: PlanetType; planetId?: string; sectorIntent?: SectorIntentInput },
): QueuedHomeStatus | null {
  if (!isObject(raw)) return null;
  const nestedTicket = isObject(raw.ticket) ? raw.ticket : null;
  const rawState = typeof raw.state === 'string' ? raw.state : undefined;
  const isTicketObject =
    rawState === 'QUEUED' ||
    rawState === 'WAITING' ||
    rawState === 'RESERVED' ||
    rawState === 'SPAWNING' ||
    (rawState === undefined && typeof raw.id === 'string' && ('sectorIntent' in raw || 'position' in raw));
  if (!isTicketObject) return null;

  const src = nestedTicket ?? raw;
  const ticketId =
    (typeof src.ticketId === 'string' && src.ticketId) ||
    (typeof src.id === 'string' && src.id) ||
    (typeof raw.ticketId === 'string' && raw.ticketId) ||
    'tkt_pending';
  const ticketState =
    (typeof src.ticketState === 'string' && src.ticketState) ||
    (typeof src.status === 'string' && src.status) ||
    (typeof src.state === 'string' && src.state !== 'QUEUED' ? src.state : undefined) ||
    (typeof raw.ticketState === 'string' && raw.ticketState) ||
    'QUEUED';
  const rawPlanetId =
    (typeof src.planetId === 'string' && src.planetId) ||
    (typeof src.targetPlanetId === 'string' && src.targetPlanetId) ||
    (typeof raw.planetId === 'string' && raw.planetId) ||
    fallback?.planetId;
  const rawPlanetType =
    (typeof src.planetType === 'string' ? (src.planetType as PlanetType) : undefined) ??
    (typeof raw.planetType === 'string' ? (raw.planetType as PlanetType) : undefined) ??
    fallback?.planetType;
  const planetType = inferQueuePlanetTypeFromId(rawPlanetId, rawPlanetType ?? 'desert');
  const planetId = resolveQueuePlanetId(rawPlanetId, planetType);
  const rawSectorIntent = (src.sectorIntent ?? raw.sectorIntent ?? src.sectorId ?? fallback?.sectorIntent) as SectorIntentInput;
  const sectorIntent = toSectorPlacementIntentV1(normalizeSectorIntent(rawSectorIntent));
  const reservedSectorId =
    typeof src.reservedSectorId === 'string'
      ? src.reservedSectorId
      : typeof raw.reservedSectorId === 'string'
        ? raw.reservedSectorId
        : null;
  const colonyId =
    typeof src.colonyId === 'string' && src.colonyId
      ? src.colonyId
      : typeof raw.colonyId === 'string' && raw.colonyId
        ? raw.colonyId
        : null;
  const rawAlt = Array.isArray(src.alternativeSectors)
    ? src.alternativeSectors
    : Array.isArray(raw.alternativeSectors)
      ? raw.alternativeSectors
      : [];
  const alternativeSectors = rawAlt.filter((s): s is string => typeof s === 'string');
  const position =
    typeof src.position === 'number'
      ? src.position
      : typeof raw.position === 'number'
        ? raw.position
        : 1;
  const etaRaw = src.etaS ?? src.estimatedWaitS ?? raw.etaS ?? raw.estimatedWaitS;
  const etaS = typeof etaRaw === 'number' ? etaRaw : null;

  return {
    state: 'QUEUED',
    ticketId,
    ticketState,
    planetId,
    planetType,
    sectorIntent,
    reservedSectorId,
    ...(colonyId ? { colonyId } : {}),
    alternativeSectors,
    position,
    etaS,
  };
}

function buildActiveSummaryFromPair(
  p: Record<string, unknown>,
  c: Record<string, unknown>,
): ExtractedActiveHome | null {
  if (typeof p.id !== 'string' || typeof c.id !== 'string') return null;

  const planetType = inferQueuePlanetTypeFromId(
    p.id,
    typeof p.type === 'string' ? (p.type as PlanetType) : 'desert',
  );
  const canonicalDef = canonicalPlanetById(p.id) ?? CANONICAL_PLANETS[planetType];
  const spawnObj = isObject(c.spawn) ? c.spawn : null;
  const spawnQ = typeof c.spawnQ === 'number' ? c.spawnQ : typeof spawnObj?.q === 'number' ? spawnObj.q : 0;
  const spawnR = typeof c.spawnR === 'number' ? c.spawnR : typeof spawnObj?.r === 'number' ? spawnObj.r : 0;
  const foundingSectorId = typeof c.foundingSectorId === 'string' ? c.foundingSectorId : undefined;
  const landingSlotId = typeof c.landingSlotId === 'string' ? c.landingSlotId : undefined;

  return {
    state: 'ACTIVE',
    planet: {
      id: p.id,
      name: typeof p.name === 'string' && p.name ? p.name : canonicalDef.name,
      type: planetType,
      ...(typeof p.seed === 'string' ? { seed: p.seed } : {}),
      ...(typeof p.radius === 'number' ? { radius: p.radius } : {}),
      state: typeof p.state === 'string' ? p.state : typeof p.lifecycle === 'string' ? p.lifecycle : 'ACTIVE',
    },
    colony: {
      id: c.id,
      colonyIndex: typeof c.colonyIndex === 'number' ? c.colonyIndex : 0,
      name: typeof c.name === 'string' && c.name ? c.name : 'Colony',
      color: typeof c.color === 'number' ? c.color : 0,
      state: typeof c.state === 'string' ? c.state : typeof c.status === 'string' ? c.status : 'ACTIVE',
      ...(foundingSectorId ? { foundingSectorId } : {}),
      ...(landingSlotId ? { landingSlotId } : {}),
      spawnQ,
      spawnR,
      spawn: { q: spawnQ, r: spawnR },
    },
    ...(foundingSectorId ? { foundingSectorId } : {}),
  };
}

export function collectKnownActiveColonyIds(raw: unknown, keepPrimaryOnActive = false): Set<string> {
  const ids = new Set<string>();
  if (!isObject(raw)) return ids;
  const primaryId =
    raw.state === 'ACTIVE' && isObject(raw.colony) && typeof raw.colony.id === 'string'
      ? raw.colony.id
      : null;
  if (primaryId && !keepPrimaryOnActive) {
    ids.add(primaryId);
  }
  if (Array.isArray(raw.activeColonies)) {
    for (const item of raw.activeColonies) {
      if (isObject(item) && isObject(item.colony) && typeof item.colony.id === 'string') {
        if (keepPrimaryOnActive && item.colony.id === primaryId) continue;
        ids.add(item.colony.id);
      }
    }
  }
  return ids;
}

export function extractActiveHomePayload(
  raw: unknown,
  target?: ActiveHomeTargetFilter,
): ExtractedActiveHome | null {
  if (!isObject(raw)) return null;
  if (raw.state !== 'ACTIVE' && !target?.excludeColonyIds && !target?.colonyId) {
    return null;
  }
  const candidates: ExtractedActiveHome[] = [];
  if (raw.state === 'ACTIVE' && isObject(raw.planet) && isObject(raw.colony)) {
    const primary = buildActiveSummaryFromPair(raw.planet, raw.colony);
    if (primary) candidates.push(primary);
  }
  if (Array.isArray(raw.activeColonies)) {
    for (const entry of raw.activeColonies) {
      if (!isObject(entry) || !isObject(entry.planet) || !isObject(entry.colony)) continue;
      const parsed = buildActiveSummaryFromPair(entry.planet, entry.colony);
      if (parsed && !candidates.some((c) => c.colony.id === parsed.colony.id)) {
        candidates.push(parsed);
      }
    }
  }
  if (candidates.length === 0) return null;

  const eligible = target?.excludeColonyIds
    ? candidates.filter((c) => !target.excludeColonyIds!.has(c.colony.id))
    : candidates;
  if (eligible.length === 0) return null;

  if (target?.colonyId) {
    const byId = eligible.find((c) => c.colony.id === target.colonyId);
    if (byId) return byId;
    return null;
  }
  if (target?.planetId && target?.sectorId) {
    const byPlanetAndSec = eligible.find(
      (c) => c.planet.id === target.planetId && (c.colony.foundingSectorId ?? 'sec_0_0') === target.sectorId,
    );
    if (byPlanetAndSec) return byPlanetAndSec;
  }
  if (target?.planetId) {
    const byPlanet = eligible.find((c) => c.planet.id === target.planetId);
    if (byPlanet) return byPlanet;
    if (target.excludeColonyIds && (canonicalPlanetById(target.planetId) !== null || !target.planetType)) return null;
  }
  if (target?.planetType) {
    const byType = eligible.find((c) => c.planet.type === target.planetType);
    if (byType) return byType;
  }
  return raw.state === 'ACTIVE' || Boolean(target?.excludeColonyIds) ? (eligible[0] ?? null) : null;
}

export function buildActiveQueueFilter(params: {
  readonly colonyId?: string;
  readonly newColony?: boolean;
  readonly search: string;
  readonly planetId?: string;
  readonly planetType?: PlanetType;
  readonly sectorIntent?: SectorIntentInput;
  readonly latestQueue: QueuedHomeStatus | null;
  readonly priorActiveColonyIds: ReadonlySet<string>;
}): ActiveHomeTargetFilter {
  const explicitColonyId =
    params.colonyId ??
    (params.newColony
      ? (params.latestQueue?.colonyId ?? undefined)
      : (new URLSearchParams(params.search).get('colonyId') ?? undefined));
  const chosenSec =
    params.latestQueue?.reservedSectorId ??
    (params.latestQueue?.sectorIntent.kind === 'chosen'
      ? params.latestQueue.sectorIntent.sectorId
      : typeof params.sectorIntent === 'string' && params.sectorIntent !== 'auto'
        ? params.sectorIntent
        : typeof params.sectorIntent === 'object' && params.sectorIntent !== null && 'sectorId' in params.sectorIntent && typeof params.sectorIntent.sectorId === 'string'
          ? params.sectorIntent.sectorId
          : undefined);
  const qPid = params.latestQueue?.planetId;
  const planetId = params.newColony
    ? (params.planetId ?? (qPid && canonicalPlanetById(qPid) ? qPid : undefined))
    : (qPid ?? params.planetId);
  const planetType = params.latestQueue?.planetType ?? params.planetType;
  return {
    ...(explicitColonyId ? { colonyId: explicitColonyId } : {}),
    ...(planetId ? { planetId } : {}),
    ...(planetType ? { planetType } : {}),
    ...(chosenSec ? { sectorId: chosenSec } : {}),
    ...(params.newColony ? { excludeColonyIds: params.priorActiveColonyIds } : {}),
  };
}

export async function inspectTrackedNewColonyTicketHelper(params: {
  readonly ticketId: string;
  readonly accessToken: string;
  readonly doFetch: FetchLike;
  readonly storage: StorageLike;
  readonly search: string;
  readonly clearPending: (storage: StorageLike, search?: string) => void;
  readonly bootOverlay?: BootOverlay | null;
  readonly onCancel?: (ticketId: string | null) => void;
  readonly onReturnToOrbit?: () => void;
  readonly fallback: { planetType?: PlanetType; planetId?: string; sectorIntent?: SectorIntentInput };
  readonly priorActiveColonyIds?: ReadonlySet<string>;
  readonly onQueued: (queued: QueuedHomeStatus) => void;
}): Promise<ExtractedActiveHome | 'cancelled' | null> {
  const { ticketId, accessToken, doFetch, storage, search, clearPending, bootOverlay, onCancel, onReturnToOrbit, fallback, onQueued } = params;
  const res = await doFetch(`/v1/match/tickets/${encodeURIComponent(ticketId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: 'include',
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const body = await res.json().catch(() => null);
  if (!isObject(body)) return null;
  const status = typeof body.status === 'string' ? body.status : typeof body.ticketState === 'string' ? body.ticketState : '';
  if (status === 'CANCELLED') {
    clearPending(storage, search);
    bootOverlay?.hideQueueStatus();
    onCancel?.(ticketId);
    onReturnToOrbit?.();
    return 'cancelled';
  }
  if (status === 'FAILED' || status === 'EXPIRED') {
    clearPending(storage, search);
    bootOverlay?.hideQueueStatus();
    throw new BootError(`Queue ticket ${status.toLowerCase()}`, 200, `TICKET_${status}`);
  }
  if ((status === 'SPAWNED' || status === 'ASSIGNED') && typeof body.colonyId === 'string' && body.colonyId) {
    const pinnedRes = await doFetch(`/v1/me/home?colonyId=${encodeURIComponent(body.colonyId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: 'include',
    }).catch(() => null);
    if (pinnedRes?.ok) {
      return extractActiveHomePayload(await pinnedRes.json(), { colonyId: body.colonyId });
    }
  }
  if (status === 'ASSIGNED' && params.priorActiveColonyIds) {
    const homeRes = await doFetch('/v1/me/home', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: 'include',
    }).catch(() => null);
    if (homeRes?.ok) {
      return extractActiveHomePayload(await homeRes.json(), {
        excludeColonyIds: params.priorActiveColonyIds,
        ...(fallback.planetType ? { planetType: fallback.planetType } : {}),
      });
    }
  }
  const queued = extractQueuedHomeStatus(body, fallback);
  if (queued) onQueued(queued);
  return null;
}

export function buildCoordinatorHomeUrl(params: {
  readonly isInitial: boolean;
  readonly planetType?: PlanetType;
  readonly colonyId?: string;
  readonly newColony?: boolean;
  readonly search: string;
  readonly planetId?: string;
  readonly latestQueue: QueuedHomeStatus | null;
}): string {
  const query = new URLSearchParams();
  if (params.planetType) query.set('type', params.planetType);
  const colonyId =
    params.colonyId ??
    (params.newColony
      ? (!params.isInitial && params.latestQueue?.colonyId ? params.latestQueue.colonyId : null)
      : new URLSearchParams(params.search).get('colonyId'));
  if (colonyId) query.set('colonyId', colonyId);
  else if (params.newColony) query.set('new', '1');
  const qPid = params.latestQueue?.planetId;
  const pollPid = params.planetId ?? (qPid && canonicalPlanetById(qPid) ? qPid : undefined);
  if (!colonyId && params.newColony && pollPid) {
    query.set('planetId', pollPid);
  }
  const polledSec =
    params.latestQueue?.reservedSectorId ??
    (params.latestQueue?.sectorIntent.kind === 'chosen' ? params.latestQueue.sectorIntent.sectorId : undefined);
  if (!colonyId && params.newColony && polledSec) query.set('sector', polledSec);
  return '/v1/me/home' + (query.size ? `?${query}` : '');
}
