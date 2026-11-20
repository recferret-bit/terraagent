import { StakingStatusResponse, type StakingPositionDto } from '@terra/contracts';
import { FlagsService } from '../../../flags/flags.service.js';
import { StakingPort } from '../../application/ports/staking.port.js';
import { AccountClaimService } from '../account-claim.service.js';
import { buildStakerPerksFromYocto, sumDtoStakedYocto } from '../staker-perks.js';
import { StakingPositionSyncService } from '../staking-position-sync.service.js';
import type { ColonyStakeFlow } from './colony-stake.flow.js';
import { resolveProtocolAccountId, type PerksView } from './perks-view.js';
import type { WalletBalances } from './wallet-balances.js';

export interface StakingStatusQuery {
  readonly colonyId?: string;
  readonly accountId?: string;
}

export interface StatusReaderDeps {
  readonly flags: FlagsService;
  readonly staking: StakingPort;
  readonly claimService: AccountClaimService;
  readonly positionSync: StakingPositionSyncService;
  readonly balances: WalletBalances;
  readonly colony: ColonyStakeFlow;
  readonly perks: PerksView;
  readonly env: () => Record<string, string | undefined>;
}

/**
 * `GET /v1/near/staking`. With `W28` on and an `accountId` it is wallet-first: it never looks at a Colony Deed, works with
 * zero colonies and answers without `colonyId`. Otherwise it is the W20 colony view (a `colonyId`, or the default colony),
 * with V2 perks when `W28` is on and the W20 perks when it is off.
 */
export class StakingStatusReader {
  constructor(private readonly d: StatusReaderDeps) {}

  read(query?: StakingStatusQuery): Promise<StakingStatusResponse> {
    const accountId = query?.accountId?.trim();
    if (accountId && this.d.flags.has('W28')) return this.readWallet(accountId, query?.colonyId?.trim());
    return this.readColony(query);
  }

  private async readWallet(accountId: string, colonyId?: string): Promise<StakingStatusResponse> {
    const [pools, positions, walletBalanceNear] = await Promise.all([
      this.d.staking.listPools(),
      this.d.positionSync.syncAccountPositions(accountId, undefined, true),
      this.d.balances.readNear(accountId),
    ]);
    const perks = await this.d.perks.evaluate({ accountId, grossApyBp: pools[0]?.apyBp ?? 900, positions });
    const linkedColony = positions.find((p) => p.colonyId)?.colonyId ?? colonyId;
    return StakingStatusResponse.parse({
      ...(linkedColony ? { colonyId: linkedColony } : {}),
      accountId,
      walletAccountId: accountId,
      walletBalanceNear,
      deedSettled: false,
      // A wallet is self-custodial: there is no custodial colony account to claim.
      accountClaimed: true,
      claimedByAccountId: accountId,
      pools: pools.map((p) => ({ poolId: p.poolId, name: p.name, apyBp: p.apyBp })),
      positions,
      perks,
    });
  }

  private async readColony(query?: StakingStatusQuery): Promise<StakingStatusResponse> {
    const deed = await this.d.colony.resolveDeed(query?.colonyId);
    const colonyId = deed?.colonyId ?? (query?.colonyId?.trim() || 'col_0');
    const claimInfo = await this.d.claimService.isAccountClaimed(colonyId, query?.accountId ?? deed?.accountId);
    const accountId =
      query?.accountId?.trim() || (claimInfo.claimed ? claimInfo.accountId : deed?.accountId ?? claimInfo.accountId);
    const walletAccountId = claimInfo.claimedByAccountId ?? accountId;
    const pools = await this.d.staking.listPools();
    const positions = await this.d.positionSync.syncAccountPositions(accountId, colonyId);
    const walletBalanceNear = await this.d.balances.readNear([accountId, deed?.accountId, claimInfo.claimedByAccountId]);

    return StakingStatusResponse.parse({
      colonyId,
      accountId,
      walletAccountId,
      walletBalanceNear,
      deedSettled: Boolean(deed?.settled),
      accountClaimed: claimInfo.claimed,
      claimedByAccountId: claimInfo.claimedByAccountId,
      pools: pools.map((p) => ({ poolId: p.poolId, name: p.name, apyBp: p.apyBp })),
      positions,
      perks: await this.perksFor(accountId, pools[0]?.apyBp ?? 900, positions),
    });
  }

  private async perksFor(accountId: string, grossApyBp: number, positions: readonly StakingPositionDto[]) {
    if (this.d.flags.has('W28')) return this.d.perks.evaluate({ accountId, grossApyBp, positions });
    const env = this.d.env();
    const perks = buildStakerPerksFromYocto(sumDtoStakedYocto(positions), {
      grossApyBp,
      protocolAccountId: resolveProtocolAccountId(env),
      env,
    });
    return {
      active: perks.active,
      minStakeNear: perks.minStakeNear,
      totalStakedNear: perks.totalStakedNear,
      grossApyBp: perks.grossApyBp,
      netApyBp: perks.netApyBp,
      protocolYieldShareBp: perks.protocolYieldShareBp,
      platformFeeBp: perks.platformFeeBp,
      stakerPlatformFeeBp: perks.stakerPlatformFeeBp,
      standardPlatformFeeBp: perks.standardPlatformFeeBp,
      managedAutopilotUnlocked: perks.managedAutopilotUnlocked,
      protocolAccountId: perks.protocolAccountId,
    };
  }
}
