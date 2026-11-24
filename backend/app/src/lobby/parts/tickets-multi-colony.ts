import type {
  LandingSlotId,
  NormalizedTicketIntentV1,
  PlanetType,
  SectorId,
} from '@terra/contracts';
import type { SectorAntiCheatService } from '../../core/anticheat';
import {
  buildDefaultColonySlotAllowance,
  type ColonySlotAllowanceService,
} from '../../core/home/colony-slot-allowance.service';
import type { HomeRepository } from '../../core/home/home.repository';
import type { LobbyPersistenceService } from '../lobby-persistence.service';
import type { PlanetSectorRecord } from '../lobby-persistence.types';
import { buildActiveHomeSummary } from '../tickets.helpers';
import {
  MatchTicketBadRequestException,
  MatchTicketConflictException,
  type ActiveHomeV1,
} from '../tickets.types';

export interface SeededColonyState {
  readonly id: string;
  readonly playerId: string;
  readonly planetId: string;
  readonly planetType: PlanetType;
  readonly colonyIndex: number;
  readonly name: string;
  readonly color: number;
  readonly foundingSectorId: string;
  readonly landingSlotId?: string;
  readonly spawnQ: number;
  readonly spawnR: number;
  status: 'ACTIVE' | 'ELIMINATED' | 'ENDED';
}

export function isLiveTerminalColony(
  antiCheat: SectorAntiCheatService | undefined,
  colonyId: string,
  planetId: string,
  colonyIndex?: number,
): boolean {
  if (!antiCheat) return false;
  const livePlanet = antiCheat.index.getPlanet(planetId);
  if (livePlanet && (livePlanet.status === 'ENDED' || livePlanet.status === 'ARCHIVED')) return true;
  const liveCol =
    antiCheat.index.getColonyById(colonyId) ??
    (colonyIndex !== undefined ? antiCheat.index.getColonyByPlanetIndex(planetId, colonyIndex) : undefined);
  return Boolean(liveCol?.terminalFromLive && liveCol.status !== 'ACTIVE');
}

async function appendCommittedReservationHomes(opts: {
  readonly playerId: string;
  readonly seenIds: Set<string>;
  readonly repoStatusById: ReadonlyMap<string, string>;
  readonly eliminatedColonyIds: ReadonlySet<string>;
  readonly antiCheat?: SectorAntiCheatService;
  readonly persistence: LobbyPersistenceService;
  readonly homes: ActiveHomeV1[];
}): Promise<void> {
  const { playerId, seenIds, repoStatusById, eliminatedColonyIds, antiCheat, persistence, homes } = opts;
  const worlds = await persistence.listCanonicalWorlds();
  for (const world of worlds) {
    if (world.lifecycle === 'ARCHIVED') continue;
    const reservations = await persistence.listReservations(world.id);
    const sectors = await persistence.listSectors(world.id);
    for (const r of reservations) {
      if (seenIds.has(r.colonyId)) continue;
      const repoStatus = repoStatusById.get(r.colonyId);
      const liveIndexed = antiCheat?.index.getColonyById(r.colonyId);
      const resolvedIdx = liveIndexed?.colonyIndex ?? r.slotIndex;
      if (
        r.playerId === playerId &&
        r.state === 'COMMITTED' &&
        !eliminatedColonyIds.has(r.colonyId) &&
        !isLiveTerminalColony(antiCheat, r.colonyId, r.planetId, liveIndexed?.colonyIndex) &&
        (!repoStatus || repoStatus === 'ACTIVE' || repoStatus === 'ALIVE' || repoStatus === 'FOUNDING')
      ) {
        seenIds.add(r.colonyId);
        homes.push(
          buildActiveHomeSummary(
            {
              id: r.colonyId, playerId: r.playerId, planetId: r.planetId, colonyIndex: resolvedIdx,
              name: `Colony-${playerId.slice(-4)}`, color: resolvedIdx, foundingSectorId: r.sectorId,
              landingSlotId: r.landingSlotId, spawnQ: r.q, spawnR: r.r,
            },
            world,
            sectors,
            world.type,
          ),
        );
      }
    }
  }
}

export async function resolveActivePlayerHomesHelper(opts: {
  readonly playerId: string;
  readonly seededList: readonly SeededColonyState[];
  readonly eliminatedColonyIds: ReadonlySet<string>;
  readonly antiCheat?: SectorAntiCheatService;
  readonly homeRepo: HomeRepository;
  readonly persistence: LobbyPersistenceService;
}): Promise<ActiveHomeV1[]> {
  const { playerId, seededList, eliminatedColonyIds, antiCheat, homeRepo, persistence } = opts;
  const seenIds = new Set<string>();
  const homes: ActiveHomeV1[] = [];

  for (const seeded of seededList) {
    if (
      seeded.status === 'ACTIVE' &&
      !eliminatedColonyIds.has(seeded.id) &&
      !isLiveTerminalColony(antiCheat, seeded.id, seeded.planetId, seeded.colonyIndex)
    ) {
      const world = await persistence.getCanonicalWorldById(seeded.planetId);
      if (!world || world.lifecycle !== 'ARCHIVED') {
        const sectors = await persistence.listSectors(seeded.planetId);
        seenIds.add(seeded.id);
        homes.push(buildActiveHomeSummary(seeded, world, sectors, seeded.planetType));
      }
    }
  }

  const repoColonies = await homeRepo.listColoniesByPlayerId(playerId);
  const repoStatusById = new Map(repoColonies.map((c) => [c.id, c.status]));
  for (const repoColony of repoColonies) {
    if (seenIds.has(repoColony.id)) continue;
    if (
      (repoColony.status === 'ACTIVE' || repoColony.status === 'ALIVE' || repoColony.status === 'FOUNDING') &&
      !eliminatedColonyIds.has(repoColony.id) &&
      !isLiveTerminalColony(antiCheat, repoColony.id, repoColony.planetId, repoColony.colonyIndex)
    ) {
      const repoPlanet = await homeRepo.findPlanetById(repoColony.planetId);
      if (!repoPlanet || (repoPlanet.status !== 'ENDED' && repoPlanet.status !== 'PLANET_ENDED')) {
        const world = await persistence.getCanonicalWorldById(repoColony.planetId);
        if (!world || world.lifecycle !== 'ARCHIVED') {
          const sectors = await persistence.listSectors(repoColony.planetId);
          const fallbackType = (repoPlanet?.type as PlanetType | undefined) ?? world?.type ?? 'desert';
          seenIds.add(repoColony.id);
          homes.push(
            buildActiveHomeSummary(
              {
                id: repoColony.id, playerId: repoColony.playerId, planetId: repoColony.planetId,
                colonyIndex: repoColony.colonyIndex, name: repoColony.name, color: repoColony.color,
                foundingSectorId: (repoColony.foundingSectorId ?? 'sec_0_0') as SectorId,
                ...(repoColony.landingSlotId ? { landingSlotId: repoColony.landingSlotId as LandingSlotId } : {}),
                spawnQ: repoColony.spawnQ, spawnR: repoColony.spawnR,
              },
              world,
              sectors,
              fallbackType,
            ),
          );
        }
      }
    }
  }

  await appendCommittedReservationHomes({
    playerId, seenIds, repoStatusById, eliminatedColonyIds, antiCheat, persistence, homes,
  });
  return homes;
}

export async function assertMultiColonyTicketAdmissionHelper(opts: {
  readonly playerId: string;
  readonly intent: NormalizedTicketIntentV1;
  readonly activeHomes: readonly ActiveHomeV1[];
  readonly sectors: readonly PlanetSectorRecord[];
  readonly slotAllowance?: ColonySlotAllowanceService;
}): Promise<void> {
  const { playerId, intent, activeHomes, sectors, slotAllowance } = opts;
  if (activeHomes.length === 0) return;

  const primaryHome = activeHomes[0]!;
  if (intent.mode === 'TRANSFER') {
    const matchedSource = activeHomes.find(
      (h) =>
        h.planet.id === intent.sourcePlanetId &&
        (!intent.sourceColonyId || h.colony.id === intent.sourceColonyId),
    );
    const refHome = matchedSource ?? primaryHome;
    if (refHome.planet.id === intent.planetId) {
      throw new MatchTicketBadRequestException(
        'same_planet_transfer',
        'TRANSFER must select an eligible different canonical planet',
      );
    }
    if (!intent.sourcePlanetId || !matchedSource) {
      throw new MatchTicketConflictException(
        'already_has_colony',
        'Transfer source does not match active colony',
        { home: primaryHome },
        primaryHome,
      );
    }
    return;
  }

  const allowance = slotAllowance
    ? await slotAllowance.resolveForPlayer(playerId, activeHomes.length)
    : buildDefaultColonySlotAllowance(activeHomes.length);

  if (!allowance.isStaker || activeHomes.length >= allowance.max) {
    const reason = !allowance.isStaker ? 'staking_required' : 'ai_slot_limit';
    const message = !allowance.isStaker
      ? 'Player already has an active colony. Stake 50+ NEAR (Tier 2+) to unlock multiple NEAR.AI colony slots.'
      : `Player already uses all ${allowance.max} NEAR.AI colony slots for Tier ${allowance.tier}.`;
    throw new MatchTicketConflictException(
      'already_has_colony',
      message,
      { home: primaryHome, colonySlots: allowance, reason },
      primaryHome,
    );
  }

  const ownedOnPlanet = activeHomes.filter((h) => h.planet.id === intent.planetId);
  if (ownedOnPlanet.length === 0) return;

  const occupiedSectors = new Set(ownedOnPlanet.map((h) => h.colony.foundingSectorId));
  if (intent.sectorIntent.kind === 'chosen') {
    const chosenSectorId = intent.sectorIntent.sectorId;
    const sameSectorHome = ownedOnPlanet.find(
      (h) => h.colony.foundingSectorId === chosenSectorId,
    );
    if (sameSectorHome) {
      throw new MatchTicketConflictException(
        'sector_already_colonized',
        `You already operate an active colony in sector ${chosenSectorId} on ${intent.planetId}. Choose a different sector or planet.`,
        {
          planetId: intent.planetId,
          sectorId: chosenSectorId,
          colonySlots: allowance,
          home: sameSectorHome,
        },
        sameSectorHome,
      );
    }
    return;
  }

  const landSectors = sectors.filter((s) => s.kind === 'land');
  if (landSectors.length > 0 && landSectors.every((s) => occupiedSectors.has(s.sectorId))) {
    throw new MatchTicketConflictException(
      'sector_already_colonized',
      `You already operate an active colony in every land sector on ${intent.planetId}. Choose another planet.`,
      { planetId: intent.planetId, colonySlots: allowance, home: ownedOnPlanet[0]! },
      ownedOnPlanet[0]!,
    );
  }
}
