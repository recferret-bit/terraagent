import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  StakerPerksResponse,
  StakingPrestigeResponse,
  STAKING_RULES,
  type PlanetPatronView,
} from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { CoreException } from '../../../core/errors/index.js';
import { APP_ENV, type AppEnv } from '../../../core/tokens.js';
import { PRISMA } from '../../../db/db.module.js';
import { FlagsService } from '../../../flags/flags.service.js';
import { yoctoToNear } from '../yocto.js';
import { PatronSeatService, type PatronSeatRow } from './patron-seat.service.js';
import { resolveWalletPerks } from './perks.resolver.js';
import { buildAiBudgetView } from './tier-engine.js';

const MAX_PRESTIGE_COLONIES = 200;

/** `ISS <handle>.near`: the first label of the wallet id, as the orbit-menu Flagship Carrier name. */
export const carrierNameFor = (accountId: string): string => `ISS ${accountId.split('.')[0] ?? accountId}.near`;

/** Read side of the W28 perks engine for HTTP: the wallet perks card and the cosmetic prestige view. */
@Injectable()
export class StakingPerksService {
  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  assertWaveEnabled(): void {
    if (!this.flags.has('W28')) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
  }

  async perksFor(query: { colonyId?: string; accountId?: string }): Promise<StakerPerksResponse> {
    this.assertWaveEnabled();
    const colonyId = query.colonyId?.trim();
    const accountId = query.accountId?.trim();
    if (!colonyId && !accountId) {
      throw new CoreException('INVALID_REQUEST', { status: 400, message: 'accountId or colonyId is required' });
    }
    const r = await resolveWalletPerks(this.prisma, { colonyId, accountId, env: this.envBag(), w28: true, full: true });
    const { totalStakedYocto: _a, stakedYocto: _b, ...perks } = r.perks;
    return StakerPerksResponse.parse({
      accountId: accountId ?? r.wallet.accountIds[0] ?? null,
      perks,
      aiBudget: buildAiBudgetView(perks, r.usage, r.nearUsd),
    });
  }

  async prestigeFor(planetId: string | undefined): Promise<StakingPrestigeResponse> {
    this.assertWaveEnabled();
    const planet = planetId?.trim();
    if (!planet) throw new CoreException('INVALID_REQUEST', { status: 400, message: 'planetId is required' });
    const db = this.prisma;
    if (!db) return { planetId: planet, leadPatron: null, colonies: [] };
    const seat = await new PatronSeatService(db).refreshPlanet(planet);
    const rows = (await db.colony.findMany({
      where: { planetId: planet },
      orderBy: { colonyIndex: 'asc' },
      take: MAX_PRESTIGE_COLONIES,
      select: { id: true },
    })) as Array<{ id: string }>;
    const tierByWallet = new Map<string, number>();
    const colonies: Array<{ colonyId: string; tier: number }> = [];
    for (const { id } of rows) {
      const r = await resolveWalletPerks(db, { colonyId: id, env: this.envBag(), w28: true });
      const key = r.wallet.walletKey === 'anonymous' ? id : r.wallet.walletKey;
      if (!tierByWallet.has(key)) tierByWallet.set(key, r.perks.tier);
      colonies.push({ colonyId: id, tier: tierByWallet.get(key) ?? 0 });
    }
    return StakingPrestigeResponse.parse({ planetId: planet, leadPatron: seat ? patronView(seat) : null, colonies });
  }

  private envBag(): Record<string, string | undefined> {
    return (this.env ?? process.env) as Record<string, string | undefined>;
  }
}

function patronView(seat: PatronSeatRow): PlanetPatronView {
  return {
    planetId: seat.planetId,
    accountId: seat.accountId,
    carrierName: carrierNameFor(seat.accountId),
    activeStakedNear: yoctoToNear(seat.activeStakedYocto, 6),
    sinceMs: seat.sinceMs,
    protocolFeeShareBp: STAKING_RULES.patronProtocolFeeShareBp,
  };
}
