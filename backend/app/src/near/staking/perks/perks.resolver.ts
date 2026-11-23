import type { DbClient } from '@terra/db';
import { databaseEnabled } from '../../../core/persistence.js';
import type { AppEnv } from '../../../core/tokens.js';
import { EMPTY_AI_USAGE, type AiUsageSnapshot } from './ai-usage.reader.js';
import { isW28Enabled, resolvePerkLadder } from './legacy-ladder.js';
import { PatronSeatService } from './patron-seat.service.js';
import { resolvePerksDeps, type PerksDeps } from './perks-deps.js';
import { EMPTY_STAKE_CLOCK, readStakeClock, resolveWallet, type StakeClock, type WalletRef } from './stake-clock.reader.js';
import { evaluatePerks, type EvaluatedPerks } from './tier-engine.js';
import { PROTOCOL_STAKING_ACCOUNT_ID } from '../yocto.js';

type EnvBag = Readonly<Record<string, string | undefined>>;

export interface PerksQuery {
  readonly colonyId?: string | null;
  readonly accountId?: string | null;
  readonly playerId?: string | null;
  readonly standardPlatformFeeBp?: number;
  readonly grossApyBp?: number;
  readonly protocolAccountId?: string;
  readonly env?: EnvBag;
  /** Wave gate override; default reads `TA_WAVES` from `env` / `process.env`. */
  readonly w28?: boolean;
  readonly nowMs?: number;
  /**
   * `true` also reads the AI usage counters, today's trade-fee bonus and the Lead Patron seats (the perks endpoint,
   * HUD, Director). The default skips them so the market hot path stays at the position reads it always did.
   */
  readonly full?: boolean;
  readonly deps?: Partial<PerksDeps>;
}

export interface ResolvedPerks {
  readonly perks: EvaluatedPerks;
  readonly wallet: WalletRef;
  readonly clock: StakeClock;
  readonly usage: AiUsageSnapshot;
  readonly nearUsd: number;
}

const NO_WALLET: WalletRef = { walletKey: 'anonymous', accountIds: [], colonyIds: [], playerId: null };

/**
 * Resolves the wallet of a colony / account (all its colonies share one result), reads its ACTIVE stake and clocks,
 * and evaluates the one perks object. Without a database it evaluates an empty stake.
 */
export async function resolveWalletPerks(db: DbClient | null | undefined, q: PerksQuery): Promise<ResolvedPerks> {
  const deps = resolvePerksDeps(q.deps);
  const nowMs = q.nowMs ?? deps.clock();
  const w28 = isW28Enabled(q.env, q.w28);
  const ladder = resolvePerkLadder({ w28, env: q.env, standardPlatformFeeBp: q.standardPlatformFeeBp, grossApyBp: q.grossApyBp });
  const activeDb = db && (databaseEnabled((q.env ?? process.env) as unknown as AppEnv) || !('$connect' in db)) ? db : null;
  const wallet = activeDb ? await resolveWallet(activeDb, q) : NO_WALLET;
  const clock = activeDb ? await readStakeClock(activeDb, wallet) : EMPTY_STAKE_CLOCK;
  const nearUsd = q.full ? await deps.priceProvider.nearUsd() : 0;
  const usage = q.full && activeDb ? await deps.usageReader.read(activeDb, wallet, nowMs) : EMPTY_AI_USAGE;
  const tradeFeeUsd = q.full && activeDb ? await deps.tradeFeeProvider.dailyProtocolTradeFeeUsd(wallet, nowMs) : 0;
  const seats = q.full && activeDb && w28 ? new PatronSeatService(activeDb) : null;
  const leadPatronPlanetIds = seats ? await seats.leadPlanetIdsFor(wallet, nowMs) : [];
  const perks = evaluatePerks({
    ladder,
    ...clock,
    nowMs,
    protocolAccountId: q.protocolAccountId ?? PROTOCOL_STAKING_ACCOUNT_ID,
    nearUsd,
    dailyProtocolTradeFeeUsd: tradeFeeUsd,
    usage,
    leadPatronPlanetIds,
  });
  return { perks, wallet, clock, usage, nearUsd };
}
