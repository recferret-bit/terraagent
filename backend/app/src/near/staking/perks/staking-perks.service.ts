import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  StakerPerksResponse,
  StakingPrestigeResponse,
  STAKING_RULES,
  type PlanetPatronView,
} from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { CoreException } from '../../../core/errors/index.js';
import { databaseEnabled } from '../../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../../core/tokens.js';
import { PRISMA } from '../../../db/db.module.js';
import { FlagsService } from '../../../flags/flags.service.js';
import { nearAdapterFor } from '../../infrastructure/adapter-selection.js';
import { StakingPositionSyncService } from '../staking-position-sync.service.js';
import { yoctoToNear } from '../yocto.js';
import { PatronSeatService, type PatronSeatRow } from './patron-seat.service.js';
import { resolveWalletPerks } from './perks.resolver.js';
import { playerLinkedWallet, resolveWallet } from './stake-clock.reader.js';
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
    @Optional() @Inject(StakingPositionSyncService) private readonly positionSync?: StakingPositionSyncService,
  ) {}

  private db(): PrismaClient | undefined {
    return this.prisma && (databaseEnabled(this.env) || !('$connect' in this.prisma)) ? this.prisma : undefined;
  }

  assertWaveEnabled(): void {
    if (!this.flags.has('W28')) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
  }

  /**
   * `playerId` (the Bearer session) stands in for `accountId` when the caller names none: the HUD pill of a pilot who
   * linked a wallet asks for "my perks" without knowing the wallet id. `nowMs` is the staking clock (mock warps move it).
   */
  async perksFor(query: { colonyId?: string; accountId?: string; playerId?: string | null; nowMs?: number }): Promise<StakerPerksResponse> {
    this.assertWaveEnabled();
    const db = this.db();
    const colonyId = query.colonyId?.trim();
    const playerId = query.playerId?.trim() || null;
    const sessionWallet = !query.accountId?.trim() && playerId && db
      ? (await playerLinkedWallet(db, playerId))?.accountId
      : undefined;
    const accountId = query.accountId?.trim() || sessionWallet;
    if (!colonyId && !accountId && !playerId) {
      throw new CoreException('INVALID_REQUEST', { status: 400, message: 'accountId or colonyId is required' });
    }
    if (nearAdapterFor('Staking', this.envBag()) !== 'mock' && this.positionSync && db) {
      const wallet = await resolveWallet(db, { colonyId: sessionWallet ? undefined : colonyId, accountId, playerId }).catch(() => null);
      const targets = wallet && wallet.accountIds.length > 0 ? wallet.accountIds : accountId ? [accountId] : [];
      await Promise.all(targets.map((acct) => this.positionSync!.syncAccountPositions(acct, undefined, acct === accountId).catch(() => [])));
    }
    const r = await resolveWalletPerks(db, {
      colonyId: sessionWallet ? undefined : colonyId,
      accountId,
      playerId,
      env: this.envBag(),
      w28: true,
      full: true,
      nowMs: query.nowMs,
    });
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
    const db = this.db();
    if (!db) return { planetId: planet, leadPatron: null, colonies: [] };
    const seat = await new PatronSeatService(db).refreshPlanet(planet);
    const rows = (await db.colony.findMany({
      where: { planetId: planet },
      orderBy: { colonyIndex: 'asc' },
      take: MAX_PRESTIGE_COLONIES,
      select: { id: true, colonyIndex: true },
    })) as Array<{ id: string; colonyIndex: number }>;
    const tierByWallet = new Map<string, number>();
    const colonies: Array<{ colonyId: string; colonyIndex: number; tier: number }> = [];
    for (const { id, colonyIndex } of rows) {
      const r = await resolveWalletPerks(db, { colonyId: id, env: this.envBag(), w28: true });
      const key = r.wallet.walletKey === 'anonymous' ? id : r.wallet.walletKey;
      if (!tierByWallet.has(key)) tierByWallet.set(key, r.perks.tier);
      colonies.push({ colonyId: id, colonyIndex, tier: tierByWallet.get(key) ?? 0 });
    }
    return StakingPrestigeResponse.parse({ planetId: planet, leadPatron: seat ? patronView(seat) : null, colonies });
  }

  private envBag(): Record<string, string | undefined> {
    return (this.env ?? process.env) as Record<string, string | undefined>;
  }
}

export function patronView(seat: PatronSeatRow): PlanetPatronView {
  return {
    planetId: seat.planetId,
    accountId: seat.accountId,
    carrierName: carrierNameFor(seat.accountId),
    activeStakedNear: yoctoToNear(seat.activeStakedYocto, 6),
    sinceMs: seat.sinceMs,
    protocolFeeShareBp: STAKING_RULES.patronProtocolFeeShareBp,
  };
}
