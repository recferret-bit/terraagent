import type { HomeResponse, SectorId } from '@terra/contracts';
import type { ColonySlotAllowanceService } from '../../home/colony-slot-allowance.service';
import type { ColonyRecord, HomeRepository, PlanetRecord } from '../../home/home.repository';
import { inferAuthoritativeBaseSector, normalizeColonyStatus } from '../anticheat.hash';
import type {
  AntiCheatTransport,
  ColonyBaseBinding,
  JoinRejectReason,
  JoinSectorVerdict,
} from '../anticheat.types';
import type { VerifySectorJoinInput } from '../sector-anticheat.service';
import type { SectorHashIndex } from '../sector-hash-index';

export type FailJoinFn = (
  transport: AntiCheatTransport,
  reason: JoinRejectReason,
  httpStatus: number,
  errorCode: string,
  detail: string,
  expectedPlanetId?: string,
  expectedSectorId?: SectorId,
) => JoinSectorVerdict;

function upsertHomeColonyBinding(
  index: SectorHashIndex,
  playerId: string,
  col: Extract<HomeResponse, { state: 'ACTIVE' }>['colony'],
  planetId: string,
): ColonyBaseBinding | null {
  if (normalizeColonyStatus(col.status ?? col.state ?? 'ACTIVE') !== 'ACTIVE') return null;
  const existing = index.getColonyById(col.id);
  if (existing && existing.status !== 'ACTIVE') return null;
  const planetState = index.getPlanet(planetId);
  const baseSectorId = inferAuthoritativeBaseSector({
    foundingSectorId: col.foundingSectorId,
    spawnQ: col.spawnQ,
    spawnR: col.spawnR,
    sectorRadius: planetState?.sectorRadius,
    hasMultiSectorGrid: planetState?.hasMultiSectorGrid,
  });
  const updated = index.upsertColonyBase({
    playerId,
    colonyId: col.id,
    planetId: col.planetId,
    colonyIndex: col.colonyIndex ?? 0,
    name: col.name,
    foundingSectorId: baseSectorId,
    spawnQ: col.spawnQ,
    spawnR: col.spawnR,
    status: 'ACTIVE',
  });
  return updated.status === 'ACTIVE' ? updated : null;
}

export async function resolvePlayerActiveBases(opts: {
  readonly index: SectorHashIndex;
  readonly homeRepo?: HomeRepository;
  readonly recordColonyBase: (colony: ColonyRecord, planet?: PlanetRecord | null, authoritative?: boolean) => ColonyBaseBinding;
  readonly playerId: string;
  readonly resolvedHome?: HomeResponse;
}): Promise<ColonyBaseBinding[]> {
  const { index, homeRepo, recordColonyBase, playerId, resolvedHome } = opts;
  const byId = new Map<string, ColonyBaseBinding>();
  const add = (b: ColonyBaseBinding | null | undefined) => {
    if (b && b.status === 'ACTIVE' && !byId.has(b.colonyId)) byId.set(b.colonyId, b);
  };

  if (resolvedHome?.state === 'ACTIVE') {
    add(upsertHomeColonyBinding(index, playerId, resolvedHome.colony, resolvedHome.planet.id));
    for (const entry of resolvedHome.activeColonies ?? []) {
      add(upsertHomeColonyBinding(index, playerId, entry.colony, entry.planet.id));
    }
  }

  for (const b of index.listActiveBasesByPlayer(playerId)) add(b);

  if (homeRepo) {
    const repoRows = await homeRepo.listColoniesByPlayerId(playerId);
    for (const row of repoRows) {
      if (normalizeColonyStatus(row.status) !== 'ACTIVE') continue;
      const known = index.getColonyById(row.id);
      if (known?.terminalFromLive && known.status !== 'ACTIVE') continue;
      const planet = await homeRepo.findPlanetById(row.planetId);
      if (!planet || (planet.status !== 'ENDED' && planet.status !== 'PLANET_ENDED')) {
        add(recordColonyBase(row, planet, false));
      }
    }
  }

  return [...byId.values()];
}

export type MultiColonyJoinEvaluation =
  | { readonly kind: 'matched'; readonly verdict: JoinSectorVerdict }
  | { readonly kind: 'rejected'; readonly verdict: JoinSectorVerdict }
  | { readonly kind: 'allow_new'; readonly occupiedSectorsOnTarget: ReadonlySet<SectorId> };

function okVerdict(b: ColonyBaseBinding): JoinSectorVerdict {
  return {
    ok: true,
    planetId: b.planetId,
    sectorId: b.baseSectorId,
    colonyId: b.colonyId,
    colonyIndex: b.colonyIndex,
    bindingHash: b.bindingHash,
  };
}

async function evaluateNewColonySlotJoin(opts: {
  readonly input: VerifySectorJoinInput;
  readonly activeBases: readonly ColonyBaseBinding[];
  readonly targetPlanetId?: string;
  readonly trimmedSector?: string;
  readonly slotAllowance?: ColonySlotAllowanceService;
  readonly failJoin: FailJoinFn;
}): Promise<MultiColonyJoinEvaluation> {
  const { input, activeBases, targetPlanetId, trimmedSector, slotAllowance, failJoin } = opts;
  const primary = activeBases[0]!;

  if (trimmedSector && targetPlanetId) {
    const sameSector = activeBases.find((b) => b.planetId === targetPlanetId && b.baseSectorId === trimmedSector);
    if (sameSector) {
      return {
        kind: 'rejected',
        verdict: failJoin(
          input.transport,
          'not_your_sector',
          409,
          'SECTOR_ALREADY_COLONIZED',
          `You already operate an active colony in sector ${trimmedSector} on ${targetPlanetId}`,
          targetPlanetId,
          sameSector.baseSectorId,
        ),
      };
    }
  }

  const allowance = slotAllowance ? await slotAllowance.resolveForPlayer(input.playerId, activeBases.length) : null;
  if (!allowance || !allowance.isStaker || activeBases.length >= allowance.max) {
    if (input.newColony) {
      const code = !allowance?.isStaker ? 'STAKING_REQUIRED' : 'AI_SLOT_LIMIT';
      const status = !allowance?.isStaker ? 403 : 409;
      const msg = !allowance?.isStaker
        ? 'Multiple colonies require NEAR staking (Tier 2 · 50+ NEAR for 3 NEAR.AI colony slots)'
        : `All ${allowance.max} NEAR.AI colony slots for Tier ${allowance.tier} are in use`;
      return { kind: 'rejected', verdict: failJoin(input.transport, 'not_your_planet', status, code, msg, primary.planetId, primary.baseSectorId) };
    }
    if (input.targetPlanetId && !activeBases.some((b) => b.planetId === input.targetPlanetId)) {
      return {
        kind: 'rejected',
        verdict: failJoin(input.transport, 'not_your_planet', 409, 'COLONY_PLANET_LOCKED', `Active colony is located on planet ${primary.planetId}`, primary.planetId, primary.baseSectorId),
      };
    }
    const ref = activeBases.find((b) => !input.targetPlanetId || b.planetId === input.targetPlanetId) ?? primary;
    return {
      kind: 'rejected',
      verdict: failJoin(input.transport, 'not_your_sector', 409, 'COLONY_SECTOR_LOCKED', `Active base is located in sector ${ref.baseSectorId}; cannot join ${trimmedSector}`, ref.planetId, ref.baseSectorId),
    };
  }

  const occupiedSectorsOnTarget = new Set<SectorId>(
    targetPlanetId ? activeBases.filter((b) => b.planetId === targetPlanetId).map((b) => b.baseSectorId) : [],
  );
  return { kind: 'allow_new', occupiedSectorsOnTarget };
}

export async function evaluateMultiColonyJoin(opts: {
  readonly input: VerifySectorJoinInput;
  readonly activeBases: readonly ColonyBaseBinding[];
  readonly targetPlanetId?: string;
  readonly slotAllowance?: ColonySlotAllowanceService;
  readonly failJoin: FailJoinFn;
}): Promise<MultiColonyJoinEvaluation> {
  const { input, activeBases, targetPlanetId, slotAllowance, failJoin } = opts;
  const trimmedSector = input.requestedSectorId?.trim() || undefined;
  const primary = activeBases[0]!;

  if (input.requestedColonyId) {
    const match = activeBases.find((b) => b.colonyId === input.requestedColonyId);
    if (!match) {
      return {
        kind: 'rejected',
        verdict: failJoin(input.transport, 'not_your_colony', 403, 'NOT_YOUR_COLONY', 'Requested colonyId does not match caller active colony', primary.planetId, primary.baseSectorId),
      };
    }
    if (input.targetPlanetId && input.targetPlanetId !== match.planetId) {
      return {
        kind: 'rejected',
        verdict: failJoin(input.transport, 'not_your_planet', 409, 'COLONY_PLANET_LOCKED', `Active colony is located on planet ${match.planetId}`, match.planetId, match.baseSectorId),
      };
    }
    if (trimmedSector && trimmedSector !== match.baseSectorId) {
      return {
        kind: 'rejected',
        verdict: failJoin(input.transport, 'not_your_sector', 409, 'COLONY_SECTOR_LOCKED', `Active base is located in sector ${match.baseSectorId}; cannot join ${trimmedSector}`, match.planetId, match.baseSectorId),
      };
    }
    return { kind: 'matched', verdict: okVerdict(match) };
  }

  if (!input.allowNewJoin) {
    const onPlanet = input.targetPlanetId ? activeBases.filter((b) => b.planetId === input.targetPlanetId) : activeBases;
    if (onPlanet.length === 0) {
      return {
        kind: 'rejected',
        verdict: failJoin(input.transport, 'not_your_planet', 409, 'COLONY_PLANET_LOCKED', `Active colony is located on planet ${primary.planetId}`, primary.planetId, primary.baseSectorId),
      };
    }
    if (trimmedSector) {
      const inSector = onPlanet.find((b) => b.baseSectorId === trimmedSector);
      if (!inSector) {
        const ref = onPlanet[0]!;
        return {
          kind: 'rejected',
          verdict: failJoin(input.transport, 'not_your_sector', 409, 'COLONY_SECTOR_LOCKED', `Active base is located in sector ${ref.baseSectorId}; cannot join ${trimmedSector}`, ref.planetId, ref.baseSectorId),
        };
      }
      return { kind: 'matched', verdict: okVerdict(inSector) };
    }
    return { kind: 'matched', verdict: okVerdict(onPlanet[0]!) };
  }

  if (!input.newColony) {
    const matched = activeBases.find(
      (b) => (!input.targetPlanetId || b.planetId === input.targetPlanetId) && (!trimmedSector || b.baseSectorId === trimmedSector),
    );
    if (matched) return { kind: 'matched', verdict: okVerdict(matched) };
  }

  return evaluateNewColonySlotJoin({ input, activeBases, targetPlanetId, trimmedSector, slotAllowance, failJoin });
}
