import type { ColonyState, PlanetState } from '@terra/sim';
import {
  ENTITY_KIND,
  ENTITY_STATE,
  getColonyGoals,
  getColonyQueue,
  getRivalColonyMeta,
  isRivalAiColony,
  resolveTileSector,
} from '@terra/sim';

export interface SectorSyncEntitySummary {
  readonly id: number;
  readonly kind: number;
  readonly q: number;
  readonly r: number;
  readonly hp: number;
  readonly hpMax: number;
  readonly state: number;
}

export interface SectorSyncParticipant {
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly sectorId: string;
  readonly playerId: string | null;
  readonly actorKind: 'player' | 'bot';
  readonly isBot: boolean;
  readonly handle: string;
  readonly botPersona: string | null;
  readonly status: string;
  readonly stage: number;
  readonly aiEnabled: boolean;
  readonly alive: boolean;
  readonly hqQ: number | null;
  readonly hqR: number | null;
  readonly unitCount: number;
  readonly buildingCount: number;
  readonly stock: Record<string, number>;
  readonly caps: Record<string, number>;
  readonly power: Record<string, unknown>;
  readonly queue: unknown[];
  readonly goals: unknown[];
  readonly entities: SectorSyncEntitySummary[];
  readonly lastInputAtTick: number | null;
  readonly lastTick: number;
}

export interface SectorSyncSector {
  readonly sectorId: string;
  readonly kind: string;
  readonly macroQ: number;
  readonly macroR: number;
  readonly centerQ: number;
  readonly centerR: number;
  readonly radius: number;
  readonly foundingCapacity: number;
  readonly activeHumans: number;
  readonly activeBots: number;
  readonly foundedSeats: number;
  readonly lastSyncedTick: number;
}

export interface SectorSyncPayload {
  readonly planetId: string;
  readonly planetType: string;
  readonly seed: string;
  readonly capacity: number;
  readonly tick: number;
  readonly alivePlayers: number;
  readonly aliveBots: number;
  readonly participants: readonly SectorSyncParticipant[];
  readonly sectors: readonly SectorSyncSector[];
}

interface EntityColonyBucket {
  units: number;
  buildings: number;
  hqQ: number | null;
  hqR: number | null;
  rank: number;
  entities: SectorSyncEntitySummary[];
}

const UNIT_KINDS = new Set<number>([
  ENTITY_KIND.hq,
  ENTITY_KIND.worker,
  ENTITY_KIND.recon,
  ENTITY_KIND.demoTank,
  ENTITY_KIND.demoArtillery,
]);

function mapColonyStatus(col: ColonyState): string {
  if (col.status === 'eliminated') return 'ELIMINATED';
  if (col.status === 'settled') return 'ENDED';
  if ((col as { away?: unknown }).away === true) return 'AWAY';
  return 'ACTIVE';
}

function resolveParticipantSectorId(state: PlanetState, col: ColonyState, anchorQ: number | null, anchorR: number | null): string {
  const explicit = (col as { foundingSectorId?: unknown }).foundingSectorId;
  if (typeof explicit === 'string' && explicit.startsWith('sec_')) return explicit;
  const legacy = (col as { sectorId?: unknown }).sectorId;
  if (typeof legacy === 'string' && legacy.startsWith('sec_')) return legacy;
  const slotId = typeof col.landingSlotId === 'string' ? col.landingSlotId : '';
  const slotMatch = /^slot_(sec_-?\d+_-?\d+)_\d+$/.exec(slotId);
  if (slotMatch?.[1]) return slotMatch[1];
  if (anchorQ !== null && anchorR !== null) {
    const resolved = resolveTileSector(state, anchorQ, anchorR);
    if (resolved?.sectorId) return resolved.sectorId;
  }
  return 'sec_0_0';
}

function collectEntityStatsByColony(state: PlanetState): Map<number, EntityColonyBucket> {
  const stats = new Map<number, EntityColonyBucket>();
  const cols = state.entities.cols;
  for (let row = 0; row < state.entities.count; row++) {
    const owner = cols.owner[row] ?? -1;
    const hp = cols.hp[row] ?? 0;
    const st = cols.state[row] ?? 0;
    if (owner < 0 || hp <= 0 || st === ENTITY_STATE.inert) continue;
    let entry = stats.get(owner);
    if (!entry) {
      entry = { units: 0, buildings: 0, hqQ: null, hqR: null, rank: 0, entities: [] };
      stats.set(owner, entry);
    }
    const kind = cols.kind[row] ?? -1;
    const q = Math.round(cols.q[row] ?? 0);
    const r = Math.round(cols.r[row] ?? 0);
    if (UNIT_KINDS.has(kind)) entry.units++;
    else entry.buildings++;
    const rank = kind === ENTITY_KIND.hub ? 3 : kind === ENTITY_KIND.hq ? 2 : kind === ENTITY_KIND.pod ? 1 : 0;
    if (rank > entry.rank) { entry.rank = rank; entry.hqQ = q; entry.hqR = r; }
    if (entry.entities.length < 128) {
      entry.entities.push({ id: cols.id[row]!, kind, q, r, hp: Math.round(hp), hpMax: Math.round(cols.hpMax[row] ?? hp), state: st });
    }
  }
  return stats;
}

function numericRecord(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return out;
}

function buildParticipant(
  state: PlanetState,
  col: ColonyState,
  st: EntityColonyBucket | undefined,
  powerBlob: Record<number, Record<string, unknown>> | undefined,
  lastInputTickByColony?: ReadonlyMap<number, number>,
): SectorSyncParticipant | null {
  const isBot = col.isBot === true || (col as { isAiColony?: unknown }).isAiColony === true || isRivalAiColony(state, col.index);
  const hasEntities = (st?.units ?? 0) + (st?.buildings ?? 0) > 0;
  const hasIdentity = typeof col.playerId === 'string' && col.playerId.length > 0;
  if (col.status === 'founding' && !isBot && !hasEntities && !hasIdentity) return null;

  const meta = getRivalColonyMeta(state, col.index);
  const hqQ = st?.hqQ ?? (typeof col.spawnQ === 'number' ? col.spawnQ : meta?.anchorQ ?? null);
  const hqR = st?.hqR ?? (typeof col.spawnR === 'number' ? col.spawnR : meta?.anchorR ?? null);
  const sectorId = resolveParticipantSectorId(state, col, hqQ, hqR);
  const status = mapColonyStatus(col);
  const alive = status !== 'ELIMINATED' && status !== 'ENDED';
  const rawHandle = (col as { handle?: unknown }).handle;
  const handle = typeof rawHandle === 'string' && rawHandle ? rawHandle : col.name || `Colony ${col.index + 1}`;
  const rawPersona = (col as { botPersona?: unknown }).botPersona;
  const botPersona = meta?.persona ?? (typeof rawPersona === 'string' && rawPersona ? rawPersona : null);
  const stage = Math.max(typeof col.stage === 'number' ? col.stage : 1, typeof col.unlockStage === 'number' ? col.unlockStage : 1);

  return {
    colonyId: col.id || `col_${col.index}`,
    colonyIndex: col.index,
    sectorId,
    playerId: typeof col.playerId === 'string' && col.playerId ? col.playerId : null,
    actorKind: isBot ? 'bot' : 'player',
    isBot,
    handle,
    botPersona,
    status,
    stage,
    aiEnabled: Boolean(col.aiEnabled) || isBot,
    alive,
    hqQ,
    hqR,
    unitCount: st?.units ?? 0,
    buildingCount: st?.buildings ?? 0,
    stock: numericRecord((col as { stock?: unknown }).stock),
    caps: numericRecord((col as { caps?: unknown }).caps),
    power: { ...((col.power as Record<string, unknown> | undefined) ?? powerBlob?.[col.index] ?? {}) },
    queue: [...getColonyQueue(state, col.index)],
    goals: [...getColonyGoals(state, col.index)],
    entities: st?.entities ?? [],
    lastInputAtTick: lastInputTickByColony?.get(col.index) ?? null,
    lastTick: state.meta.tick,
  };
}

function buildSectorSummaries(
  state: PlanetState,
  participants: readonly SectorSyncParticipant[],
  capacity: number,
): SectorSyncSector[] {
  const tick = state.meta.tick;
  const counts = new Map<string, { humans: number; bots: number; seats: number }>();
  for (const p of participants) {
    const c = counts.get(p.sectorId) ?? { humans: 0, bots: 0, seats: 0 };
    c.seats++;
    if (p.alive) {
      if (p.isBot) c.bots++;
      else c.humans++;
    }
    counts.set(p.sectorId, c);
  }

  const atlas = state.blobs.atlas?.value as {
    sectorRadius?: number;
    sectors?: Array<{ sectorId?: string; kind?: string; macroCoord?: { sq?: number; sr?: number }; center?: { q?: number; r?: number }; foundingCapacity?: number }>;
  } | undefined;
  const rawSectors = atlas?.sectors?.length
    ? atlas.sectors
    : [{ sectorId: 'sec_0_0', kind: 'land', macroCoord: { sq: 0, sr: 0 }, center: { q: 0, r: 0 }, foundingCapacity: capacity }];

  const out: SectorSyncSector[] = rawSectors
    .filter((s): s is NonNullable<typeof s> & { sectorId: string } => Boolean(s?.sectorId))
    .map((s) => {
      const c = counts.get(s.sectorId) ?? { humans: 0, bots: 0, seats: 0 };
      return {
        sectorId: s.sectorId,
        kind: s.kind ?? 'land',
        macroQ: s.macroCoord?.sq ?? 0,
        macroR: s.macroCoord?.sr ?? 0,
        centerQ: s.center?.q ?? 0,
        centerR: s.center?.r ?? 0,
        radius: atlas?.sectorRadius ?? state.grid.radius,
        foundingCapacity: s.foundingCapacity ?? capacity,
        activeHumans: c.humans,
        activeBots: c.bots,
        foundedSeats: c.seats,
        lastSyncedTick: tick,
      };
    });

  for (const [sectorId, c] of counts) {
    if (out.some((s) => s.sectorId === sectorId)) continue;
    out.push({
      sectorId, kind: 'land', macroQ: 0, macroR: 0, centerQ: 0, centerR: 0, radius: state.grid.radius,
      foundingCapacity: capacity, activeHumans: c.humans, activeBots: c.bots, foundedSeats: c.seats, lastSyncedTick: tick,
    });
  }
  return out;
}

export function extractSectorSyncPayload(
  planetId: string,
  state: PlanetState,
  lastInputTickByColony?: ReadonlyMap<number, number>,
): SectorSyncPayload {
  const entityStats = collectEntityStatsByColony(state);
  const powerBlob = (state.blobs.power?.value as { byColony?: Record<number, Record<string, unknown>> } | undefined)?.byColony;
  const participants: SectorSyncParticipant[] = [];
  let alivePlayers = 0;
  let aliveBots = 0;

  for (const col of state.colonies) {
    if (!col || col.index < 0) continue;
    const p = buildParticipant(state, col, entityStats.get(col.index), powerBlob, lastInputTickByColony);
    if (!p) continue;
    participants.push(p);
    if (p.alive) {
      if (p.isBot) aliveBots++;
      else alivePlayers++;
    }
  }

  const metaCapacity = (state.meta as { capacity?: number }).capacity;
  const capacity = typeof metaCapacity === 'number' ? metaCapacity : 8;
  return {
    planetId,
    planetType: state.meta.planetType,
    seed: String(state.meta.seed ?? planetId),
    capacity,
    tick: state.meta.tick,
    alivePlayers,
    aliveBots,
    participants,
    sectors: buildSectorSummaries(state, participants, capacity),
  };
}
