import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../../db/db.module.js';
import { GamePlanets } from '../../game/game-planets.service.js';
import { resolveMarketAccountId } from './colony-account.js';

export interface MarketColony {
  /** The sim's colony id (the key of orders, stalls and cargo events): `col_<index>` on a dev scenario planet, else the colony row id. */
  readonly colonyId: string;
  readonly colonyIndex: number;
  /** The colony's mock chain account: the one `cargo.export` mints to, where verifier deposits and the faucet go. */
  readonly accountId: string;
}

/**
 * The ONE place that turns (planet, colony index) into the colony the sim and the cargo ledger know (W13-20). Scenario
 * planets seat dev sessions on sim colonies `col_<index>` (no player on the colony), while the player's DB colony row has an
 * `co_...` id; cargo events carry the sim id, so the market precheck, the faucet and the REST snapshot must use it too, with
 * the same inputs `resolveColonyAccountId` gets from `cargoExported`.
 */
@Injectable()
export class MarketColonies {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(GamePlanets) private readonly planets: GamePlanets,
  ) {}

  async resolve(planetId: string, colonyIndex: number, dbColonyId: string | null, playerId: string | null): Promise<MarketColony> {
    const scenario = this.planets.isScenarioColonyPlanet(planetId);
    const colonyId = scenario || !dbColonyId ? `col_${colonyIndex}` : dbColonyId;
    const accountId = await resolveMarketAccountId(this.prisma, colonyId, scenario ? null : playerId, planetId, colonyIndex);
    return { colonyId, colonyIndex, accountId };
  }

  /** A player's colony on a planet: the colony row, else seat 0 for a dev session on a scenario planet; null when none. */
  async ofPlayer(playerId: string, planetId: string, dev: boolean): Promise<MarketColony | null> {
    const row = await this.prisma.colony.findFirst({ where: { playerId, planetId }, orderBy: { createdAt: 'desc' }, select: { id: true, colonyIndex: true } });
    if (row) return this.resolve(planetId, row.colonyIndex, row.id, playerId);
    return dev && this.planets.isScenarioColonyPlanet(planetId) ? this.resolve(planetId, 0, null, playerId) : null;
  }
}
