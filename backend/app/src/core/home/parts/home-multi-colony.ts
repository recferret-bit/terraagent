import type { ActiveColonyEntry, ColonySlotAllowance, HomeResponse } from '@terra/contracts';
import type { LobbyPersistenceService } from '../../../lobby/lobby-persistence.service';
import type { CanonicalWorldRecord } from '../../../lobby/lobby-persistence.types';
import { normalizeColonyStatus } from '../../anticheat';
import { CoreException } from '../../errors';
import {
  buildDefaultColonySlotAllowance,
  type ColonySlotAllowanceService,
} from '../colony-slot-allowance.service';
import type { HardModeHomeClock } from '../hard-mode-home';
import {
  buildEnrichedPlanetSummary,
  enrichColonyWithReservation,
  isPlanetEndedOrArchived,
  listCommittedReservationColonies,
  buildBasicColonySummary,
  type ColonySeatAssignment,
} from '../home-resolve.helpers';
import type { ColonyRecord, HomeRepository, PlanetRecord } from '../home.repository';
import type { SectorAntiCheatService } from '../../anticheat';
import { markPlanetIndexLanded } from './home-seating';

export interface ActiveColonyBundle {
  readonly colony: ColonyRecord;
  readonly planet: PlanetRecord;
  readonly world: CanonicalWorldRecord | null;
}

export async function collectActiveColonyBundles(opts: {
  readonly repo: HomeRepository;
  readonly lobbyPersistence?: LobbyPersistenceService;
  readonly hardMode?: HardModeHomeClock;
  readonly applyOverrides: (col: ColonyRecord) => ColonyRecord;
  readonly applyPlanetOverrides: (pl: PlanetRecord) => PlanetRecord;
  readonly playerId: string;
  readonly handle?: string;
}): Promise<ActiveColonyBundle[]> {
  const { repo, lobbyPersistence, hardMode, applyOverrides, applyPlanetOverrides, playerId, handle } = opts;
  const seen = new Set<string>();
  const out: ActiveColonyBundle[] = [];

  const repoRows = await repo.listColoniesByPlayerId(playerId);
  for (const raw of repoRows) {
    const col = await enrichColonyWithReservation(applyOverrides(raw), lobbyPersistence);
    if (seen.has(col.id)) continue;
    if (normalizeColonyStatus(col.status) !== 'ACTIVE') continue;
    const rawPlanet = (await repo.findPlanetById(col.planetId)) ?? (await repo.upsertDevPlanet(col.planetId));
    const planet = applyPlanetOverrides(rawPlanet);
    const world = lobbyPersistence ? await lobbyPersistence.getCanonicalWorldById(planet.id) : null;
    if (isPlanetEndedOrArchived(planet, world)) continue;
    if (hardMode?.get(planet.id, col.id)) continue;
    seen.add(col.id);
    out.push({ colony: col, planet, world });
  }

  const committed = await listCommittedReservationColonies(lobbyPersistence, playerId, { handle });
  for (const item of committed) {
    if (seen.has(item.colony.id)) continue;
    const col = applyOverrides(item.colony);
    if (normalizeColonyStatus(col.status) !== 'ACTIVE') continue;
    const planet = applyPlanetOverrides(item.planet);
    const world = lobbyPersistence ? await lobbyPersistence.getCanonicalWorldById(planet.id) : null;
    if (isPlanetEndedOrArchived(planet, world)) continue;
    if (hardMode?.get(planet.id, col.id)) continue;
    seen.add(col.id);
    out.push({ colony: col, planet, world });
  }

  return out;
}

export function buildOccupiedSectorsMap(bundles: readonly ActiveColonyBundle[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const b of bundles) {
    const sec = (b.colony.foundingSectorId ?? 'sec_0_0').trim() || 'sec_0_0';
    let set = map.get(b.planet.id);
    if (!set) map.set(b.planet.id, (set = new Set<string>()));
    set.add(sec);
  }
  return map;
}

export function matchActiveBundle(
  bundles: readonly ActiveColonyBundle[],
  requestedPlanetId?: string,
  requestedSectorId?: string,
): ActiveColonyBundle | null {
  const pid = requestedPlanetId?.trim();
  const sid = requestedSectorId?.trim();
  if (!pid && !sid) return bundles[0] ?? null;
  return (
    bundles.find(
      (b) =>
        (!pid || b.planet.id === pid) &&
        (!sid || (b.colony.foundingSectorId ?? 'sec_0_0') === sid),
    ) ?? null
  );
}

export async function assertNewColonyAllowed(opts: {
  readonly playerId: string;
  readonly activeBundles: readonly ActiveColonyBundle[];
  readonly slotAllowance?: ColonySlotAllowanceService;
  readonly requestedPlanetId?: string;
  readonly requestedSectorId?: string;
}): Promise<ColonySlotAllowance> {
  const { playerId, activeBundles, slotAllowance, requestedPlanetId, requestedSectorId } = opts;
  const allowance = slotAllowance
    ? await slotAllowance.resolveForPlayer(playerId, activeBundles.length)
    : buildDefaultColonySlotAllowance(activeBundles.length);

  const pid = requestedPlanetId?.trim();
  const sid = requestedSectorId?.trim();
  if (pid && sid) {
    const sameSector = activeBundles.find(
      (b) => b.planet.id === pid && (b.colony.foundingSectorId ?? 'sec_0_0') === sid,
    );
    if (sameSector) {
      throw new CoreException('SECTOR_ALREADY_COLONIZED', {
        status: 409,
        message: `You already operate an active colony in sector ${sid} on ${pid}. Choose another sector or planet.`,
        details: { code: 'sector_already_colonized', planetId: pid, sectorId: sid, colonyId: sameSector.colony.id },
      });
    }
  }

  if (activeBundles.length === 0) return allowance;

  if (!allowance.isStaker) {
    throw new CoreException('STAKING_REQUIRED', {
      status: 403,
      message: 'Multiple colonies require NEAR staking (Tier 2 · 50+ NEAR for 3 NEAR.AI colony slots).',
      details: { code: 'staking_required', colonySlots: allowance },
    });
  }

  if (activeBundles.length >= allowance.max) {
    throw new CoreException('AI_SLOT_LIMIT', {
      status: 409,
      message: `All ${allowance.max} NEAR.AI colony slots for Tier ${allowance.tier} are already in use.`,
      details: { code: 'ai_slot_limit', colonySlots: allowance },
    });
  }

  return allowance;
}

export async function attachHomeColonyRoster(opts: {
  readonly home: HomeResponse;
  readonly playerId: string;
  readonly activeBundles: readonly ActiveColonyBundle[];
  readonly slotAllowance?: ColonySlotAllowanceService;
  readonly lobbyPersistence?: LobbyPersistenceService;
}): Promise<HomeResponse> {
  const { home, playerId, activeBundles, slotAllowance, lobbyPersistence } = opts;
  const colonySlots = slotAllowance
    ? await slotAllowance.resolveForPlayer(playerId, activeBundles.length)
    : buildDefaultColonySlotAllowance(activeBundles.length);

  const activeColonies: ActiveColonyEntry[] = await Promise.all(
    activeBundles.map(async (b) => {
      const { summary } = await buildEnrichedPlanetSummary(b.planet, lobbyPersistence);
      return { colony: buildBasicColonySummary(b.colony), planet: summary };
    }),
  );

  return {
    ...home,
    colonySlots,
    activeColonies,
  };
}

export async function adoptLateLandingHelper(opts: {
  readonly assignment: ColonySeatAssignment;
  readonly repo: HomeRepository;
  readonly landedIndices: Map<string, Set<number>>;
  readonly listActiveBundles: (playerId: string, handle?: string) => Promise<ActiveColonyBundle[]>;
  readonly slotAllowance?: ColonySlotAllowanceService;
  readonly antiCheat?: SectorAntiCheatService;
}): Promise<boolean> {
  const { assignment, repo, landedIndices, listActiveBundles, slotAllowance, antiCheat } = opts;
  const { player, colony, planet } = assignment;
  if (await repo.findColonyById(colony.id)) {
    markPlanetIndexLanded(landedIndices, colony.planetId, colony.colonyIndex);
    return false;
  }
  const activeBundles = await listActiveBundles(player.id, player.handle);
  const targetSector = (colony.foundingSectorId ?? 'sec_0_0').trim() || 'sec_0_0';
  const sameSector = activeBundles.some(
    (b) => b.planet.id === colony.planetId && (b.colony.foundingSectorId ?? 'sec_0_0') === targetSector,
  );
  if (sameSector) {
    markPlanetIndexLanded(landedIndices, colony.planetId, colony.colonyIndex);
    return false;
  }
  if (activeBundles.length > 0) {
    const allowance = slotAllowance
      ? await slotAllowance.resolveForPlayer(player.id, activeBundles.length)
      : undefined;
    if (!allowance || !allowance.isStaker || activeBundles.length >= allowance.max) {
      markPlanetIndexLanded(landedIndices, colony.planetId, colony.colonyIndex);
      return false;
    }
  }
  const created = await repo.createColony({ ...colony });
  antiCheat?.recordColonyBase(created.colony, planet, true);
  return true;
}
