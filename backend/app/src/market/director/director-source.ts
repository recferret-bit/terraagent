import { Inject, Injectable } from '@nestjs/common';
import { pairId, RESOURCE_FAMILY_OF, RESOURCE_KEYS, type AutoTradeLimit, type ResourceKey } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import {
  compileData,
  dataRow,
  ensureColonyLedger,
  readAutoTradeLimits,
  restore,
  targetFromBand,
  type AutoTradeForecastInput,
  type CompiledData,
  type PlanetState,
  type Ratio,
} from '@terra/sim';
import { colonyIsAway } from '@terra/sim/systems/away/gate';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { GamePlanets } from '../../game/game-planets.service.js';
import { PriceBoardService } from '../board/price-board.service.js';

export interface DirectorResourceView {
  /** Measured stock and limits. `quantity` and `side` are chosen by `proposeDirectorTrade`. */
  readonly forecast: Omit<AutoTradeForecastInput, 'quantity' | 'side'>;
  readonly reference: Ratio | null;
  readonly ownUnitCost: Ratio | null;
  readonly target: number;
}

export interface DirectorColonyView {
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly planetId: string;
  readonly playerId: string;
  readonly away: boolean;
  readonly tick: number;
  readonly rows: readonly DirectorResourceView[];
}

/** Where the loop reads a colony. The away sweep uses `listAway`; tests pass a fixed view. */
export abstract class DirectorColonySource {
  abstract load(colonyId: string): Promise<DirectorColonyView | null>;
  abstract listAway(): Promise<readonly string[]>;
}

type RefMap = ReadonlyMap<string, Ratio>;

function targetFor(data: CompiledData, resource: ResourceKey, cap: number): number {
  try {
    const row = dataRow(data, 'market', `resource.${resource}`);
    const lo = row.targetBandLoBp;
    const hi = row.targetBandHiBp;
    if (typeof lo === 'number' && typeof hi === 'number')
      return Number(targetFromBand(BigInt(Math.max(0, cap)), lo, hi));
  } catch {
    // A missing market row means the quote target is half the cap, not a made-up price.
  }
  return Math.floor(Math.max(0, cap) / 2);
}

function oneRow(
  resource: ResourceKey,
  limit: AutoTradeLimit,
  stock: number,
  storageCap: number,
  refs: RefMap,
  target: number,
): DirectorResourceView {
  const reference = refs.get(pairId(resource, 'USDC')) ?? null;
  return {
    forecast: {
      resource,
      stock,
      storageCap,
      queued: 0,
      reserved: 0,
      serviceWindow: 0,
      reserveFloor: limit.minStock,
      reserveHorizon: 0,
      sessionSpent: 0,
      partner: 'guild',
      limit,
    },
    reference,
    ownUnitCost: reference,
    target,
  };
}

function rowsFrom(
  state: PlanetState,
  index: number,
  refs: RefMap,
  flags: { has(wave: string): boolean },
): DirectorResourceView[] {
  const limits = readAutoTradeLimits(state, index);
  const colony = state.colonies[index];
  if (!limits || !colony) return [];
  const ledger = ensureColonyLedger(colony);
  const data = compileData(flags);
  const rows: DirectorResourceView[] = [];
  for (const resource of RESOURCE_KEYS) {
    const limit = limits[resource];
    if (!limit) continue;
    const stock = Math.floor(ledger.stock[resource] ?? 0);
    const storageCap = Math.floor(ledger.caps[RESOURCE_FAMILY_OF[resource]] ?? 0);
    rows.push(oneRow(resource, limit, stock, storageCap, refs, targetFor(data, resource, storageCap)));
  }
  return rows;
}

/** Live planets only. Stock is the ledger; queues are not subtracted (BE-74). Session spend comes from the key, not this view. */
@Injectable()
export class SimDirectorSource extends DirectorColonySource {
  constructor(
    @Inject(GamePlanets) private readonly planets: GamePlanets,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(PriceBoardService) private readonly board: PriceBoardService,
    @Inject(FlagsService) private readonly flags: FlagsService,
  ) {
    super();
  }

  async listAway(): Promise<readonly string[]> {
    const ids: string[] = [];
    for (const planetId of this.planets.loadedIds()) ids.push(...(await this.awayIds(planetId)));
    return ids;
  }

  async load(colonyId: string): Promise<DirectorColonyView | null> {
    const colony = await this.prisma.colony.findUnique({ where: { id: colonyId } });
    if (!colony || !this.planets.isLoaded(colony.planetId)) return null;
    const state = await this.restore(colony.planetId);
    if (!state || !state.colonies[colony.colonyIndex]) return null;
    return {
      colonyId,
      colonyIndex: colony.colonyIndex,
      planetId: colony.planetId,
      playerId: colony.playerId,
      away: colonyIsAway(state, colony.colonyIndex),
      tick: state.meta.tick,
      rows: rowsFrom(state, colony.colonyIndex, await this.references(colony.planetId), this.flags.flags),
    };
  }

  private async awayIds(planetId: string): Promise<string[]> {
    const state = await this.restore(planetId);
    if (!state) return [];
    const ids: string[] = [];
    for (let index = 0; index < state.colonies.length; index++) {
      if (!state.colonies[index] || !colonyIsAway(state, index)) continue;
      const row = await this.prisma.colony.findUnique({
        where: { planetId_colonyIndex: { planetId, colonyIndex: index } },
        select: { id: true },
      });
      if (row) ids.push(row.id);
    }
    return ids;
  }

  private async restore(planetId: string): Promise<PlanetState | null> {
    try {
      const full = await this.planets.fullState(planetId);
      return restore(full.bytes);
    } catch {
      return null;
    }
  }

  private async references(planetId: string): Promise<RefMap> {
    try {
      const rows = await this.board.board(planetId);
      const out = new Map<string, Ratio>();
      for (const row of rows) if (row.vwap) out.set(row.pair, { num: BigInt(row.vwap.num), den: BigInt(row.vwap.den) });
      return out;
    } catch {
      return new Map();
    }
  }
}
