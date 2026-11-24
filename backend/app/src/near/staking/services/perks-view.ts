import { EvaluatedStakerPerksV2, type StakingPositionDto } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import type { StakingPort } from '../../application/ports/staking.port.js';
import { nearAdapterFor } from '../../infrastructure/adapter-selection.js';
import { resolveNearNetworkConfig } from '../../infrastructure/network/near-network.config.js';
import { resolveWalletPerks } from '../perks/perks.resolver.js';
import { buildStakerPerksFromYocto, sumDtoStakedYocto } from '../staker-perks.js';
import { PROTOCOL_STAKING_ACCOUNT_ID } from '../yocto.js';
import { stakingNowMs } from './port-hooks.js';

type EnvBag = Record<string, string | undefined>;

/** `protocol.<root>`: the account that receives the platform fee, the protocol yield cut and the early-exit fee. */
export function resolveProtocolAccountId(envMap: EnvBag): string {
  const kind = nearAdapterFor('Staking', envMap);
  if (kind === 'mock') return envMap.NEAR_PROTOCOL_ACCOUNT?.trim() || PROTOCOL_STAKING_ACCOUNT_ID;
  return resolveNearNetworkConfig(envMap, kind === 'mainnet' ? 'mainnet' : 'testnet').accounts.protocol;
}

export interface PerksViewQuery {
  readonly accountId: string;
  readonly colonyId?: string;
  readonly grossApyBp: number;
  /** The wallet's synced positions: the DB-less fallback reads stake and clocks from them. */
  readonly positions: readonly StakingPositionDto[];
}

/**
 * The V2 perks object the staking endpoints return (tier, fees, quotas, AI allowance), evaluated for the whole wallet at
 * the staking clock, with the stake clocks and `full: true` so the 24h warmup and the Patron seat are right. Unstaking
 * drops the tier at once because only ACTIVE stake counts.
 */
export class PerksView {
  constructor(
    private readonly staking: StakingPort,
    private readonly env: () => EnvBag,
    private readonly db: () => PrismaClient | null,
  ) {}

  async evaluate(query: PerksViewQuery): Promise<EvaluatedStakerPerksV2> {
    const env = this.env();
    const nowMs = stakingNowMs(this.staking);
    const protocolAccountId = resolveProtocolAccountId(env);
    const db = this.db();
    const perks = db
      ? (
          await resolveWalletPerks(db, {
            accountId: query.accountId,
            colonyId: query.colonyId,
            env,
            dbEnabled: true,
            w28: true,
            full: true,
            nowMs,
            grossApyBp: query.grossApyBp,
            protocolAccountId,
          })
        ).perks
      : buildStakerPerksFromYocto(sumDtoStakedYocto(query.positions), {
          env,
          w28: true,
          nowMs,
          grossApyBp: query.grossApyBp,
          protocolAccountId,
          ...clocksOf(query.positions),
        });
    const { totalStakedYocto: _total, stakedYocto: _staked, ...dto } = perks;
    return EvaluatedStakerPerksV2.parse(dto);
  }
}

function clocksOf(positions: readonly StakingPositionDto[]): { stakedSinceMs: number | null; lastStakedAtMs: number | null } {
  let since: number | null = null;
  let last: number | null = null;
  for (const p of positions) {
    if (Number(p.staked) <= 0) continue;
    if (p.stakedSinceMs != null && (since === null || p.stakedSinceMs < since)) since = p.stakedSinceMs;
    if (p.lastStakedAtMs != null && (last === null || p.lastStakedAtMs > last)) last = p.lastStakedAtMs;
  }
  return { stakedSinceMs: since, lastStakedAtMs: last };
}
