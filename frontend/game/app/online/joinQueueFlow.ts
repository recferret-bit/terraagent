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
  DEVICE_SECRET_KEY,
  deviceSecretKey,
  getOrCreateDeviceSecret,
  type BootAuthResult,
  type BootColonySummary,
  type BootPlanetSummary,
  type FetchLike,
  type StorageLike,
} from './bootOnline';

export const PENDING_JOIN_TICKET_KEY = 'ta_pending_join_ticket';
export const DEFAULT_QUEUE_POLL_MS = 1000;

export interface PersistedJoinIntent {
  readonly idempotencyKey: string;
  readonly ticketId?: string;
  readonly planetId: string;
  readonly planetType: PlanetType;
  readonly sectorIntent: SectorPlacementIntentV1;
  readonly createdAtMs: number;
}

export interface QueuedHomeStatus {
  readonly state: 'QUEUED';
  readonly ticketId: string;
  readonly ticketState: string;
  readonly planetId: string;
  readonly planetType: PlanetType;
  readonly sectorIntent: SectorPlacementIntentV1;
  readonly reservedSectorId: string | null;
  readonly alternativeSectors: readonly string[];
  readonly position: number;
  readonly etaS: number | null;
}

export interface JoinQueueOptions {
  readonly fetch?: FetchLike;
  readonly storage?: StorageLike;
  readonly search?: string;
  readonly tryRefresh?: boolean;
  readonly planetType?: PlanetType;
  readonly planetId?: string;
  readonly sectorIntent?: SectorIntentInput;
  /** When true, enqueues a ticket via `POST /v1/match/tickets` if `/v1/me/home` is `NEW` (or `ELIMINATED` / `PLANET_ENDED`). */
  readonly enqueueOnNew?: boolean;
  /** When true, enqueues a ticket via `POST /v1/match/tickets` before polling if no active/queued home exists yet. */
  readonly enqueueTicket?: boolean;
  readonly pollIntervalMs?: number;
  readonly maxPollAttempts?: number;
  readonly wait?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly now?: () => number;
  readonly bootOverlay?: BootOverlay | null;
  readonly showDescentOnAssign?: boolean;
  readonly onStatus?: (status: string) => void;
  readonly onQueueStatus?: (status: QueuedHomeStatus, cancel: () => void) => void;
  readonly onCancel?: (ticketId: string | null) => void;
  readonly onReturnToOrbit?: () => void;
  readonly onAssigned?: (result: BootAuthResult) => void;
  readonly onDescent?: (update: { progress: number; q: number; r: number; colonyId: string; planetId: string }) => void;
}

export function pendingJoinStorageKey(search = '', dev: boolean = import.meta.env.DEV): string {
  const as = dev ? new URLSearchParams(search).get('as')?.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) : '';
  return as ? `${PENDING_JOIN_TICKET_KEY}:${as}` : PENDING_JOIN_TICKET_KEY;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function inferPlanetTypeFromId(planetId: string | undefined, fallback: PlanetType = 'desert'): PlanetType {
  if (!planetId) return fallback;
  const canonical = canonicalPlanetById(planetId);
  if (canonical) return canonical.type;
  const lower = planetId.toLowerCase();
  if (lower.includes('ocean') || lower.includes('thalassa')) return 'ocean';
  if (lower.includes('temperate') || lower.includes('granite') || lower.includes('forest')) return 'temperate';
  if (lower.includes('desert') || lower.includes('kharon') || lower.includes('dune')) return 'desert';
  return fallback;
}

function resolveCanonicalOrCustomPlanetId(planetId: string | undefined, planetType: PlanetType): string {
  if (typeof planetId === 'string' && planetId.trim().length > 0) return planetId.trim();
  return CANONICAL_PLANETS[planetType].id;
}

function samePlacementIntent(a: SectorPlacementIntentV1, b: SectorPlacementIntentV1): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'chosen' && b.kind === 'chosen' ? a.sectorId === b.sectorId : true;
}

export function readPendingJoinIntent(storage: StorageLike, search = ''): PersistedJoinIntent | null {
  try {
    const raw = storage.getItem(pendingJoinStorageKey(search));
    if (!raw || !raw.trim()) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedJoinIntent>;
    if (
      typeof parsed.idempotencyKey !== 'string' ||
      !parsed.idempotencyKey ||
      typeof parsed.planetId !== 'string' ||
      typeof parsed.planetType !== 'string' ||
      !isObject(parsed.sectorIntent)
    ) {
      return null;
    }
    const sectorIntent = toSectorPlacementIntentV1(
      normalizeSectorIntent(parsed.sectorIntent as SectorIntentInput),
    );
    return {
      idempotencyKey: parsed.idempotencyKey,
      ...(typeof parsed.ticketId === 'string' && parsed.ticketId ? { ticketId: parsed.ticketId } : {}),
      planetId: parsed.planetId,
      planetType: parsed.planetType as PlanetType,
      sectorIntent,
      createdAtMs: typeof parsed.createdAtMs === 'number' ? parsed.createdAtMs : 0,
    };
  } catch {
    return null;
  }
}

export function writePendingJoinIntent(storage: StorageLike, intent: PersistedJoinIntent, search = ''): void {
  try {
    storage.setItem(pendingJoinStorageKey(search), JSON.stringify(intent));
  } catch {
    /* ignore storage write errors */
  }
}

export function updatePendingJoinTicketId(
  storage: StorageLike,
  ticketId: string,
  search = '',
  fallback?: { planetId: string; planetType: PlanetType; sectorIntent: SectorPlacementIntentV1 },
): void {
  const existing = readPendingJoinIntent(storage, search);
  if (existing) {
    writePendingJoinIntent(storage, { ...existing, ticketId }, search);
    return;
  }
  if (fallback) {
    const secret = getOrCreateDeviceSecret(storage, deviceSecretKey(search)).slice(0, 12);
    const sectorTag = fallback.sectorIntent.kind === 'chosen' ? fallback.sectorIntent.sectorId : 'auto';
    writePendingJoinIntent(
      storage,
      {
        idempotencyKey: `idem_${secret}_${fallback.planetId}_${sectorTag}`,
        ticketId,
        planetId: fallback.planetId,
        planetType: fallback.planetType,
        sectorIntent: fallback.sectorIntent,
        createdAtMs: Date.now(),
      },
      search,
    );
  }
}

export function clearPendingJoinIntent(storage: StorageLike, search = ''): void {
  const key = pendingJoinStorageKey(search);
  try {
    const removable = storage as StorageLike & { removeItem?: (k: string) => void };
    removable.removeItem?.(key);
    storage.setItem(key, '');
  } catch {
    /* ignore storage clear errors */
  }
}

export function getOrCreatePendingJoinIntent(
  storage: StorageLike,
  input: {
    search?: string;
    planetType?: PlanetType;
    planetId?: string;
    sectorIntent?: SectorIntentInput;
    now?: () => number;
  },
): PersistedJoinIntent {
  const search = input.search ?? '';
  const existing = readPendingJoinIntent(storage, search);
  const hasExplicitTarget = Boolean(input.planetType || input.planetId || input.sectorIntent);
  if (existing && !hasExplicitTarget) {
    return existing;
  }
  const planetType = inferPlanetTypeFromId(input.planetId, input.planetType ?? existing?.planetType ?? 'desert');
  const planetId = resolveCanonicalOrCustomPlanetId(input.planetId ?? existing?.planetId, planetType);
  const sectorIntent = toSectorPlacementIntentV1(
    normalizeSectorIntent(input.sectorIntent ?? existing?.sectorIntent),
  );
  if (
    existing &&
    existing.planetId === planetId &&
    existing.planetType === planetType &&
    samePlacementIntent(existing.sectorIntent, sectorIntent)
  ) {
    return existing;
  }
  const secret = getOrCreateDeviceSecret(storage, deviceSecretKey(search) || DEVICE_SECRET_KEY).slice(0, 12);
  const sectorTag = sectorIntent.kind === 'chosen' ? sectorIntent.sectorId : 'auto';
  const createdAtMs = (input.now ?? Date.now)();
  const next: PersistedJoinIntent = {
    idempotencyKey: `idem_${secret}_${planetId}_${sectorTag}`,
    planetId,
    planetType,
    sectorIntent,
    createdAtMs,
  };
  writePendingJoinIntent(storage, next, search);
  return next;
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
  const planetType = inferPlanetTypeFromId(rawPlanetId, rawPlanetType ?? 'desert');
  const planetId = resolveCanonicalOrCustomPlanetId(rawPlanetId, planetType);
  const rawSectorIntent = (src.sectorIntent ?? raw.sectorIntent ?? src.sectorId ?? fallback?.sectorIntent) as SectorIntentInput;
  const sectorIntent = toSectorPlacementIntentV1(normalizeSectorIntent(rawSectorIntent));
  const reservedSectorId =
    typeof src.reservedSectorId === 'string'
      ? src.reservedSectorId
      : typeof raw.reservedSectorId === 'string'
        ? raw.reservedSectorId
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
    alternativeSectors,
    position,
    etaS,
  };
}

export function extractActiveHomePayload(raw: unknown): {
  state: 'ACTIVE';
  planet: BootPlanetSummary;
  colony: BootColonySummary;
  foundingSectorId?: string;
} | null {
  if (!isObject(raw) || raw.state !== 'ACTIVE') return null;
  const p = isObject(raw.planet) ? raw.planet : null;
  const c = isObject(raw.colony) ? raw.colony : null;
  if (!p || !c || typeof p.id !== 'string' || typeof c.id !== 'string') return null;

  const planetType = inferPlanetTypeFromId(
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

export function formatQueueStatusMessage(status: QueuedHomeStatus): string {
  const sectorLabel = status.sectorIntent.kind === 'chosen' ? status.sectorIntent.sectorId : 'AUTO';
  const etaPart = status.etaS !== null ? ` · ETA ~${status.etaS}s` : '';
  const altPart =
    status.alternativeSectors.length > 0
      ? ` · ALT ${status.alternativeSectors.join(', ')}`
      : '';
  return `QUEUE #${status.position} · ${status.planetId} · ${sectorLabel}${etaPart}${altPart}`;
}

export async function enqueueMatchTicket(
  accessToken: string,
  intent: PersistedJoinIntent,
  doFetch: FetchLike,
): Promise<{ kind: 'ticket'; status: QueuedHomeStatus } | { kind: 'active'; rawHome: unknown }> {
  const sectorPayload =
    intent.sectorIntent.kind === 'chosen'
      ? {
          sectorId: intent.sectorIntent.sectorId,
          sectorIntent: { kind: 'chosen' as const, mode: 'chosen' as const, sectorId: intent.sectorIntent.sectorId },
        }
      : {
          autoSector: true,
          sectorIntent: { kind: 'auto' as const, mode: 'auto' as const },
        };
  const body = {
    mode: 'JOIN_PLANET',
    planetId: intent.planetId,
    planetType: intent.planetType,
    ...sectorPayload,
    idempotencyKey: intent.idempotencyKey,
  };
  const res = await doFetch('/v1/match/tickets', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'Idempotency-Key': intent.idempotencyKey,
    },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (res.status === 409 && isObject(payload)) {
    const code = (payload.code ?? payload.errorCode) as string | undefined;
    if (code === 'already_has_colony' && isObject(payload.home)) {
      return { kind: 'active', rawHome: payload.home };
    }
    if (code === 'already_queued' || code === 'ticket_open') {
      const ticketId =
        isObject(payload.details) && typeof payload.details.ticketId === 'string'
          ? payload.details.ticketId
          : intent.ticketId ?? 'current';
      return {
        kind: 'ticket',
        status: {
          state: 'QUEUED',
          ticketId,
          ticketState: 'QUEUED',
          planetId: intent.planetId,
          planetType: intent.planetType,
          sectorIntent: intent.sectorIntent,
          reservedSectorId: null,
          alternativeSectors: [],
          position: 1,
          etaS: null,
        },
      };
    }
  }
  if (!res.ok) {
    const code = isObject(payload) && typeof payload.errorCode === 'string' ? payload.errorCode : undefined;
    throw new BootError(`POST /v1/match/tickets: ${res.status}${code ? ` ${code}` : ''}`, res.status, code);
  }
  if (extractActiveHomePayload(payload)) {
    return { kind: 'active', rawHome: payload };
  }
  const queued = extractQueuedHomeStatus(payload, {
    planetId: intent.planetId,
    planetType: intent.planetType,
    sectorIntent: intent.sectorIntent,
  }) ?? {
    state: 'QUEUED' as const,
    ticketId: (isObject(payload) && typeof payload.id === 'string' ? payload.id : intent.ticketId) ?? 'tkt_pending',
    ticketState: 'QUEUED',
    planetId: intent.planetId,
    planetType: intent.planetType,
    sectorIntent: intent.sectorIntent,
    reservedSectorId: null,
    alternativeSectors: [],
    position: 1,
    etaS: null,
  };
  return { kind: 'ticket', status: queued };
}

export async function cancelMatchTicketRequest(
  accessToken: string,
  ticketId: string,
  doFetch: FetchLike,
): Promise<void> {
  const target = ticketId.trim() || 'current';
  const res = await doFetch(`/v1/match/tickets/${encodeURIComponent(target)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: 'include',
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.json().catch(() => ({}));
    const code = isObject(body) && typeof body.errorCode === 'string' ? body.errorCode : undefined;
    throw new BootError(`DELETE /v1/match/tickets/${target}: ${res.status}`, res.status, code);
  }
}

export {
  BootCancelledError,
  JoinQueueCoordinator,
  bootOrPollQueuedHome,
  type PreloadedBootContext,
} from './joinQueueCoordinator';


