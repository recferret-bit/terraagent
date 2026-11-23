import { STAKING_ASSETS, type StakingAsset } from '@terra/contracts';
import type { DbClient } from '@terra/db';

type Dec = { toFixed(n: number): string } | null | undefined;
const y = (d: Dec): bigint => (d ? BigInt(d.toFixed(0)) : 0n);

export type AssetBreakdown = Record<StakingAsset, bigint>;

const ZERO_BREAKDOWN: AssetBreakdown = Object.freeze({ near: 0n, stNEAR: 0n, LiNEAR: 0n });

function toAsset(raw: string | null | undefined): StakingAsset {
  return STAKING_ASSETS.find((a) => a === raw) ?? 'near';
}

function applyUnstakeDebit(bal: AssetBreakdown, asset: StakingAsset, amount: bigint): void {
  const direct = amount <= bal[asset] ? amount : bal[asset];
  bal[asset] -= direct;
  let rem = amount - direct;
  if (rem <= 0n) return;
  for (const other of STAKING_ASSETS) {
    if (other === asset || bal[other] <= 0n) continue;
    const take = rem <= bal[other] ? rem : bal[other];
    bal[other] -= take;
    rem -= take;
    if (rem <= 0n) break;
  }
}

/**
 * Computes net staked principal per asset (`near` / `stNEAR` / `LiNEAR`) for each `(accountId, poolId)` from
 * `chain.staking_tx`, so mock pools sharing one validator row preserve exact Native vs LST splits.
 */
export async function readPoolTxAssetNets(
  db: DbClient,
  accountIds?: readonly string[],
): Promise<Map<string, AssetBreakdown>> {
  const out = new Map<string, AssetBreakdown>();
  if (typeof db.stakingTx?.findMany !== 'function') return out;
  if (accountIds && accountIds.length === 0) return out;
  const rows = (await db.stakingTx.findMany({
    ...(accountIds ? { where: { accountId: { in: [...accountIds] } } } : {}),
    orderBy: { createdAt: 'asc' },
    select: { accountId: true, poolId: true, kind: true, asset: true, amountYocto: true },
  })) as Array<{ accountId: string; poolId: string; kind: string; asset: string; amountYocto: Dec }>;

  for (const r of rows) {
    const key = `${r.accountId}::${r.poolId}`;
    let bal = out.get(key);
    if (!bal) {
      bal = { near: 0n, stNEAR: 0n, LiNEAR: 0n };
      out.set(key, bal);
    }
    const amt = y(r.amountYocto);
    if (amt <= 0n) continue;
    const asset = toAsset(r.asset);
    if (r.kind === 'stake' || r.kind === 'stake_profits' || r.kind === 'compound') {
      bal[asset] += amt;
    } else if (r.kind === 'unstake') {
      applyUnstakeDebit(bal, asset, amt);
    }
  }
  return out;
}

/** Splits `staked` across `near` / `stNEAR` / `LiNEAR` while guaranteeing `near + stNEAR + LiNEAR === staked`. */
export function splitStakedByAsset(
  staked: bigint,
  rowAssetRaw: string | null | undefined,
  txNet?: AssetBreakdown,
): AssetBreakdown {
  if (staked <= 0n) return { ...ZERO_BREAKDOWN };
  const fallbackAsset = toAsset(rowAssetRaw);
  if (!txNet) return { ...ZERO_BREAKDOWN, [fallbackAsset]: staked };
  const sum = txNet.near + txNet.stNEAR + txNet.LiNEAR;
  if (sum <= 0n) return { ...ZERO_BREAKDOWN, [fallbackAsset]: staked };
  if (sum === staked) return { near: txNet.near, stNEAR: txNet.stNEAR, LiNEAR: txNet.LiNEAR };

  const out: AssetBreakdown = {
    near: (staked * txNet.near) / sum,
    stNEAR: (staked * txNet.stNEAR) / sum,
    LiNEAR: (staked * txNet.LiNEAR) / sum,
  };
  const rem = staked - (out.near + out.stNEAR + out.LiNEAR);
  if (rem > 0n) {
    const primary: StakingAsset =
      txNet[fallbackAsset] > 0n
        ? fallbackAsset
        : txNet.near >= txNet.stNEAR && txNet.near >= txNet.LiNEAR
          ? 'near'
          : txNet.stNEAR >= txNet.LiNEAR
            ? 'stNEAR'
            : 'LiNEAR';
    out[primary] += rem;
  }
  return out;
}
