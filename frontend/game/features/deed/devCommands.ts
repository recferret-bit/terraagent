import type { DevCommandDef, FeatureContext } from '../../core/registry/types';
import { serverFor, usage } from '../shared/devCommand';

const SHOW_USAGE = 'deed.show [colony]';
const BUMP_USAGE = 'deed.bump <field> <value>';
const SETTLE_USAGE = 'deed.settle [colony]';
const STAKE_FUND_USAGE = 'stake.fund [account] <near>';
const CLAIM_USAGE = 'account.claim [--mock]';
const TIME_WARP_USAGE = 'time.warp <seconds | N epochs>';

const BUMP_FIELDS = new Set([
  'terraform',
  'stage',
  'walls',
  'tradeVolume',
  'truces',
  'rank',
]);

function sessionPlanetId(ctx: FeatureContext): string | undefined {
  return ctx.services.session?.planetId() ?? undefined;
}

export const deedShowCmd: DevCommandDef = {
  name: 'deed.show',
  help: `${SHOW_USAGE}  Server: print Colony Deed metadata, version, and chain status`,
  async run(a, ctx) {
    if (a.length > 1) usage(SHOW_USAGE);
    const colony = a[0]?.trim() || undefined;
    const planetId = sessionPlanetId(ctx);
    const res = (await serverFor(ctx, 'deed.show')('deed.show', {
      ...(colony ? { colony } : {}),
      ...(planetId ? { planetId } : {}),
    })) as {
      tokenId?: string;
      colonyId?: string;
      version?: number;
      status?: string;
      settled?: boolean;
      stage?: number;
      terraformBp?: number;
      pendingState?: string;
    };
    const pct = Math.round(((res.terraformBp ?? 0) as number) / 100);
    return `${res.tokenId ?? 'deed'} (${res.colonyId ?? 'col_0'}) v${res.version ?? 1} ${res.settled ? 'settled' : (res.status ?? 'active')} · Stage ${res.stage ?? 0} · Terraform ${pct}% (${res.pendingState ?? 'confirmed'})`;
  },
};

export const deedBumpCmd: DevCommandDef = {
  name: 'deed.bump',
  help: `${BUMP_USAGE}  Server: queue a Colony Deed milestone update (e.g. deed.bump terraform 10)`,
  async run(a, ctx) {
    if (a.length < 2 || a.length > 3) usage(BUMP_USAGE);
    const field = a[0]?.trim() ?? '';
    const value = Number(a[1]);
    if (!BUMP_FIELDS.has(field) || !Number.isFinite(value)) usage(BUMP_USAGE);
    const colony = a[2]?.trim() || undefined;
    const planetId = sessionPlanetId(ctx);
    const res = (await serverFor(ctx, 'deed.bump')('deed.bump', {
      field,
      value,
      ...(colony ? { colony } : {}),
      ...(planetId ? { planetId } : {}),
    })) as {
      tokenId?: string;
      change?: string;
      pendingState?: string;
      retries?: number;
    };
    void ctx.services.getDeedPanel?.()?.refreshFromServer(false);
    return `deed.bump ${field} ${value}: ${res.change ?? `${field} ${value}`} (${res.pendingState ?? 'pending'}${res.retries ? ` retries=${res.retries}` : ''})`;
  },
};

export const deedSettleCmd: DevCommandDef = {
  name: 'deed.settle',
  help: `${SETTLE_USAGE}  Server: seal Colony Deed as Settled (one-way)`,
  async run(a, ctx) {
    if (a.length > 1) usage(SETTLE_USAGE);
    const colony = a[0]?.trim() || undefined;
    const planetId = sessionPlanetId(ctx);
    const res = (await serverFor(ctx, 'deed.settle')('deed.settle', {
      ...(colony ? { colony } : {}),
      ...(planetId ? { planetId } : {}),
    })) as {
      tokenId?: string;
      version?: number;
      txHash?: string;
    };
    void ctx.services.getDeedPanel?.()?.refreshFromServer(false);
    void ctx.services.getStakingPanel?.()?.refreshFromServer();
    return `settled ${res.tokenId ?? 'deed-col_0'} (v${res.version ?? 2}) tx=${res.txHash ?? 'mock:settle'}`;
  },
};

export const stakeFundCmd: DevCommandDef = {
  name: 'stake.fund',
  help: `${STAKE_FUND_USAGE}  Server: fund a mock NEAR wallet for staking`,
  async run(a, ctx) {
    if (a.length < 1 || a.length > 2) usage(STAKE_FUND_USAGE);
    const account = a.length === 2 ? a[0]?.trim() : undefined;
    const rawNear = (a.length === 2 ? a[1] : a[0])?.trim() ?? '';
    const nearNum = Number(rawNear);
    if (!rawNear || !Number.isFinite(nearNum) || nearNum <= 0) usage(STAKE_FUND_USAGE);
    if (a.length === 2 && !account) usage(STAKE_FUND_USAGE);

    const res = (await serverFor(ctx, 'stake.fund')('stake.fund', {
      ...(account ? { account } : {}),
      near: rawNear,
    })) as {
      accountId?: string;
      walletBalanceNear?: string;
    };
    void ctx.services.getStakingPanel?.()?.refreshFromServer();
    return `funded ${res.accountId ?? account ?? 'wallet'}: balance ${res.walletBalanceNear ?? rawNear} NEAR`;
  },
};

export const accountClaimCmd: DevCommandDef = {
  name: 'account.claim',
  help: `${CLAIM_USAGE}  Server: claim the colony NEAR account with a mock NEP-413 signature`,
  async run(a, ctx) {
    let colony: string | undefined;
    for (const token of a) {
      if (token === '--mock') continue;
      if (token.startsWith('--')) usage(CLAIM_USAGE);
      if (!colony) colony = token;
      else usage(CLAIM_USAGE);
    }
    const res = (await serverFor(ctx, 'account.claim')('account.claim', {
      ...(colony ? { colony } : {}),
      mock: true,
    })) as {
      accountId?: string;
      claimedByAccountId?: string;
      txHash?: string;
    };
    void ctx.services.getDeedPanel?.()?.refreshFromServer(false);
    void ctx.services.getStakingPanel?.()?.refreshFromServer();
    return `claimed ${res.accountId ?? 'col_0.terraagent.mock'} -> ${res.claimedByAccountId ?? 'pilot.mock'} (tx=${res.txHash ?? 'mock:claim'})`;
  },
};

export const timeWarpCmd: DevCommandDef = {
  name: 'time.warp',
  help: `${TIME_WARP_USAGE}  Server: advance deed debounce and staking clocks by <seconds> (or '<n> epochs')`,
  async run(a, ctx) {
    if (a.length < 1 || a.length > 2) usage(TIME_WARP_USAGE);
    const num = Number(a[0]);
    if (!Number.isFinite(num) || num <= 0) usage(TIME_WARP_USAGE);
    const unit = a[1]?.trim().toLowerCase();
    if (unit && unit !== 'epochs' && unit !== 'epoch' && unit !== 's' && unit !== 'sec') {
      usage(TIME_WARP_USAGE);
    }
    const seconds = unit === 'epochs' || unit === 'epoch' ? num * 43_200 : num;
    const res = (await serverFor(ctx, 'time.warp')('time.warp', { seconds })) as {
      seconds?: number;
      flushedDeeds?: number;
    };
    void ctx.services.getDeedPanel?.()?.refreshFromServer(false);
    void ctx.services.getStakingPanel?.()?.refreshFromServer();
    return `warped ${res.seconds ?? seconds}s (flushed=${res.flushedDeeds ?? 0})`;
  },
};

export const DEED_DEV_COMMANDS: readonly DevCommandDef[] = [
  deedShowCmd,
  deedBumpCmd,
  deedSettleCmd,
  stakeFundCmd,
  accountClaimCmd,
  timeWarpCmd,
];
