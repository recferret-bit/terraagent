import {
  PlanetSectorsLiveStateV1Schema,
  type PlanetSectorsLiveStateV1,
  type SectorLiveSummaryV1,
  type SectorParticipantStateV1,
} from '@terra/contracts';
import type { Prisma, PrismaClient } from '@terra/db';
import type { SectorSyncPayload } from '../sector-extract';

function normalizePlanetKind(raw: string): 'desert' | 'ocean' | 'temperate' {
  if (raw === 'desert' || raw === 'ocean' || raw === 'temperate') return raw;
  const lower = raw.toLowerCase();
  if (lower.includes('desert') || lower.includes('dune')) return 'desert';
  if (lower.includes('ocean')) return 'ocean';
  return 'temperate';
}

function planetLookFor(kind: 'desert' | 'ocean' | 'temperate'): string {
  if (kind === 'desert') return 'dune';
  if (kind === 'ocean') return 'oceanForest';
  return 'forestRock';
}

const asJsonValue = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

function asNumberRecord(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return out;
}

function asUnknownRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return { ...(raw as Record<string, unknown>) };
}

function groupParticipantsBySector(
  participants: readonly SectorParticipantStateV1[],
): Map<string, SectorParticipantStateV1[]> {
  const bySector = new Map<string, SectorParticipantStateV1[]>();
  for (const p of participants) {
    const list = bySector.get(p.sectorId) ?? [];
    list.push(p);
    bySector.set(p.sectorId, list);
  }
  return bySector;
}

export function buildCachedLivePlanetState(
  planetId: string,
  payload: SectorSyncPayload,
  updatedAt: Date,
): PlanetSectorsLiveStateV1 {
  const iso = updatedAt.toISOString();
  const participants: SectorParticipantStateV1[] = payload.participants.map((p) => ({
    id: `${planetId}:${p.colonyId}`,
    planetId,
    sectorId: p.sectorId,
    colonyId: p.colonyId,
    colonyIndex: p.colonyIndex,
    playerId: p.playerId,
    actorKind: p.actorKind,
    isBot: p.isBot,
    handle: p.handle,
    botPersona: p.botPersona,
    status: p.status,
    stage: p.stage,
    aiEnabled: p.aiEnabled,
    alive: p.alive,
    hqQ: p.hqQ,
    hqR: p.hqR,
    unitCount: p.unitCount,
    buildingCount: p.buildingCount,
    stock: { ...p.stock },
    caps: { ...p.caps },
    power: { ...p.power },
    queue: [...p.queue],
    goals: [...p.goals],
    entities: [...p.entities],
    lastInputAtTick: p.lastInputAtTick,
    lastTick: p.lastTick,
    updatedAt: iso,
  }));
  const bySector = groupParticipantsBySector(participants);
  const sectors: SectorLiveSummaryV1[] = payload.sectors.map((s) => ({
    planetId,
    sectorId: s.sectorId,
    kind: s.kind,
    macroQ: s.macroQ,
    macroR: s.macroR,
    centerQ: s.centerQ,
    centerR: s.centerR,
    foundingCapacity: s.foundingCapacity,
    reservedSeats: 0,
    foundedSeats: s.foundedSeats,
    activeHumans: s.activeHumans,
    activeBots: s.activeBots,
    lastSyncedTick: s.lastSyncedTick,
    lastSyncedAt: iso,
    participants: bySector.get(s.sectorId) ?? [],
  }));
  return PlanetSectorsLiveStateV1Schema.parse({ planetId, tick: payload.tick, sectors, participants });
}

export async function queryDbLivePlanetState(
  prisma: PrismaClient,
  planetId: string,
): Promise<PlanetSectorsLiveStateV1 | null> {
  const [sectorsDb, participantsDb] = await Promise.all([
    prisma.planetSector.findMany({ where: { planetId }, orderBy: [{ macroQ: 'asc' }, { macroR: 'asc' }] }),
    prisma.sectorParticipantState.findMany({ where: { planetId }, orderBy: [{ colonyIndex: 'asc' }] }),
  ]);
  if (sectorsDb.length === 0 && participantsDb.length === 0) return null;

  const participants: SectorParticipantStateV1[] = participantsDb.map((row) => ({
    id: row.id,
    planetId: row.planetId,
    sectorId: row.sectorId,
    colonyId: row.colonyId,
    colonyIndex: row.colonyIndex,
    playerId: row.playerId,
    actorKind: row.actorKind === 'bot' ? 'bot' : 'player',
    isBot: row.isBot,
    handle: row.handle,
    botPersona: row.botPersona,
    status: row.status,
    stage: row.stage,
    aiEnabled: row.aiEnabled,
    alive: row.alive,
    hqQ: row.hqQ,
    hqR: row.hqR,
    unitCount: row.unitCount,
    buildingCount: row.buildingCount,
    stock: asNumberRecord(row.stockJson),
    caps: asNumberRecord(row.capsJson),
    power: asUnknownRecord(row.powerJson),
    queue: Array.isArray(row.queueJson) ? row.queueJson : [],
    goals: Array.isArray(row.goalsJson) ? row.goalsJson : [],
    entities: Array.isArray(row.entitiesJson) ? row.entitiesJson : [],
    lastInputAtTick: row.lastInputAtTick,
    lastTick: row.lastTick,
    updatedAt: row.updatedAt.toISOString(),
  }));
  const bySector = groupParticipantsBySector(participants);
  let maxTick = 0;
  const sectors: SectorLiveSummaryV1[] = sectorsDb.map((s) => {
    if (s.lastSyncedTick > maxTick) maxTick = s.lastSyncedTick;
    return {
      planetId: s.planetId,
      sectorId: s.sectorId,
      kind: s.kind,
      macroQ: s.macroQ,
      macroR: s.macroR,
      centerQ: s.centerQ,
      centerR: s.centerR,
      foundingCapacity: s.foundingCapacity,
      reservedSeats: s.reservedSeats,
      foundedSeats: s.foundedSeats,
      activeHumans: s.activeHumans,
      activeBots: s.activeBots,
      lastSyncedTick: s.lastSyncedTick,
      lastSyncedAt: s.lastSyncedAt ? s.lastSyncedAt.toISOString() : null,
      participants: bySector.get(s.sectorId) ?? [],
    };
  });
  for (const p of participants) if (p.lastTick > maxTick) maxTick = p.lastTick;
  return PlanetSectorsLiveStateV1Schema.parse({ planetId, tick: maxTick, sectors, participants });
}

async function upsertParticipantDb(
  tx: Prisma.TransactionClient,
  planetId: string,
  p: SectorSyncPayload['participants'][number],
): Promise<void> {
  await tx.sectorParticipantState.upsert({
    where: { planetId_colonyId: { planetId, colonyId: p.colonyId } },
    update: {
      sectorId: p.sectorId, colonyIndex: p.colonyIndex, playerId: p.playerId,
      actorKind: p.actorKind, isBot: p.isBot, handle: p.handle, botPersona: p.botPersona,
      status: p.status, stage: p.stage, aiEnabled: p.aiEnabled, alive: p.alive,
      hqQ: p.hqQ, hqR: p.hqR, unitCount: p.unitCount, buildingCount: p.buildingCount,
      stockJson: asJsonValue(p.stock), capsJson: asJsonValue(p.caps),
      powerJson: asJsonValue(p.power), queueJson: asJsonValue(p.queue),
      goalsJson: asJsonValue(p.goals), entitiesJson: asJsonValue(p.entities),
      ...(p.lastInputAtTick !== null ? { lastInputAtTick: p.lastInputAtTick } : {}),
      lastTick: p.lastTick,
    },
    create: {
      id: `${planetId}:${p.colonyId}`,
      planetId, sectorId: p.sectorId, colonyId: p.colonyId, colonyIndex: p.colonyIndex,
      playerId: p.playerId, actorKind: p.actorKind, isBot: p.isBot, handle: p.handle,
      botPersona: p.botPersona, status: p.status, stage: p.stage, aiEnabled: p.aiEnabled,
      alive: p.alive, hqQ: p.hqQ, hqR: p.hqR, unitCount: p.unitCount,
      buildingCount: p.buildingCount, stockJson: asJsonValue(p.stock),
      capsJson: asJsonValue(p.caps), powerJson: asJsonValue(p.power),
      queueJson: asJsonValue(p.queue), goalsJson: asJsonValue(p.goals),
      entitiesJson: asJsonValue(p.entities), lastInputAtTick: p.lastInputAtTick, lastTick: p.lastTick,
    },
  });
  await tx.colony.updateMany({
    where: { planetId, colonyIndex: p.colonyIndex },
    data: {
      stage: p.stage, status: p.status, foundingSectorId: p.sectorId,
      ...(p.isBot ? { isBot: true, botPersona: p.botPersona } : {}),
    },
  });
}

export async function persistSectorSyncPayload(
  prisma: PrismaClient,
  payload: SectorSyncPayload,
): Promise<void> {
  const now = new Date();
  const kind = normalizePlanetKind(payload.planetType);
  await prisma.$transaction(async (tx) => {
    await tx.planet.upsert({
      where: { id: payload.planetId },
      // `core.planet.seatsTaken` is owned by HomeRepository (`core.colony` count) and LobbyPersistenceService;
      // a pre-landing or bot-only `sectorSync` must never overwrite seated colony counts back to 0.
      update: { updatedAt: now },
      create: {
        id: payload.planetId, name: payload.planetId, type: kind, look: planetLookFor(kind),
        seed: payload.seed || payload.planetId, state: 'RUNNING', lifecycle: 'LIVE',
        capacity: payload.capacity, seatsTaken: payload.alivePlayers,
      },
    });
    for (const s of payload.sectors) {
      await tx.planetSector.upsert({
        where: { planetId_sectorId: { planetId: payload.planetId, sectorId: s.sectorId } },
        update: {
          foundedSeats: s.foundedSeats, activeHumans: s.activeHumans, activeBots: s.activeBots,
          lastSyncedTick: s.lastSyncedTick, lastSyncedAt: now,
        },
        create: {
          id: `${payload.planetId}:${s.sectorId}`,
          planetId: payload.planetId, sectorId: s.sectorId, kind: s.kind,
          macroQ: s.macroQ, macroR: s.macroR, centerQ: s.centerQ, centerR: s.centerR,
          radius: s.radius, foundingCapacity: s.foundingCapacity, validatedCapacity: s.foundingCapacity,
          foundedSeats: s.foundedSeats, activeHumans: s.activeHumans, activeBots: s.activeBots,
          lastSyncedTick: s.lastSyncedTick, lastSyncedAt: now,
        },
      });
    }
    const activeColonyIds: string[] = [];
    for (const p of payload.participants) {
      activeColonyIds.push(p.colonyId);
      await upsertParticipantDb(tx, payload.planetId, p);
    }
    if (activeColonyIds.length > 0) {
      await tx.sectorParticipantState.deleteMany({
        where: { planetId: payload.planetId, colonyId: { notIn: activeColonyIds } },
      });
    }
  });
}
