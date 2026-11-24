import type { EcosystemTvlView, StakingAsset } from '@terra/contracts';
import type { DbClient } from '@terra/db';
import { yoctoToNear } from '../yocto.js';
import { readPoolTxAssetNets, splitStakedByAsset } from './asset-split.js';

/** `StakingPosition.asset` → the ecosystem row it feeds (pool→provider: native pools are whitelisted validators). */
const ENTRIES: ReadonlyArray<{ id: EcosystemTvlView['entries'][number]['id']; asset: StakingAsset; label: string }> = [
  { id: 'metapool', asset: 'stNEAR', label: 'Meta Pool stNEAR' },
  { id: 'linear', asset: 'LiNEAR', label: 'LiNEAR' },
  { id: 'validator', asset: 'near', label: 'Whitelisted validators' },
];

/** Pure: builds the TVL breakdown from yocto totals per asset (all three rows always present). */
export function buildEcosystemView(byAsset: Readonly<Partial<Record<StakingAsset, bigint>>>): EcosystemTvlView {
  const amounts = ENTRIES.map((e) => ({ ...e, yocto: byAsset[e.asset] && byAsset[e.asset]! > 0n ? byAsset[e.asset]! : 0n }));
  const total = amounts.reduce((s, e) => s + e.yocto, 0n);
  return {
    totalNear: yoctoToNear(total, 6),
    entries: amounts.map((e) => ({
      id: e.id,
      label: e.label,
      asset: e.asset,
      tvlNear: yoctoToNear(e.yocto, 6),
      sharePct: total > 0n ? Number((e.yocto * 10_000n) / total) / 100 : 0,
    })),
  };
}

/** TerraAgent TVL delegated across Meta Pool / LiNEAR / validators, from the `StakingPosition` read model by asset. */
export async function readEcosystemTvl(db: DbClient | null | undefined): Promise<EcosystemTvlView> {
  if (!db) return buildEcosystemView({});
  if (typeof db.stakingPosition?.findMany === 'function') {
    const [rawPosRows, txNets] = await Promise.all([
      db.stakingPosition.findMany({ select: { colonyId: true, accountId: true, poolId: true, asset: true, stakedSnapshot: true, updatedAt: true } }) as Promise<
        Array<{ colonyId?: string; accountId: string; poolId: string; asset?: string | null; stakedSnapshot: { toFixed(n: number): string } | null; updatedAt?: Date | null }>
      >,
      readPoolTxAssetNets(db),
    ]);
    const deduped = new Map<string, (typeof rawPosRows)[number]>();
    let anonIdx = 0;
    for (const r of rawPosRows) {
      const key = r.accountId && r.poolId
        ? `acct:${r.accountId}::pool:${r.poolId}`
        : r.accountId
          ? `acct:${r.accountId}::row:${anonIdx++}`
          : `col:${r.colonyId ?? anonIdx++}::pool:${r.poolId ?? ''}`;
      const prev = deduped.get(key);
      if (!prev || (r.updatedAt?.getTime() ?? 0) >= (prev.updatedAt?.getTime() ?? 0)) {
        deduped.set(key, r);
      }
    }
    const byAsset: Partial<Record<StakingAsset, bigint>> = {};
    for (const r of deduped.values()) {
      const staked = BigInt(r.stakedSnapshot?.toFixed(0) ?? '0');
      const split = splitStakedByAsset(staked, r.asset, txNets.get(`${r.accountId}::${r.poolId}`));
      if (split.near > 0n) byAsset.near = (byAsset.near ?? 0n) + split.near;
      if (split.stNEAR > 0n) byAsset.stNEAR = (byAsset.stNEAR ?? 0n) + split.stNEAR;
      if (split.LiNEAR > 0n) byAsset.LiNEAR = (byAsset.LiNEAR ?? 0n) + split.LiNEAR;
    }
    return buildEcosystemView(byAsset);
  }
  if (typeof db.stakingPosition?.groupBy !== 'function') return buildEcosystemView({});
  type Row = { asset: string; _sum: { stakedSnapshot: { toFixed(n: number): string } | null } };
  const groupBy = db.stakingPosition.groupBy.bind(db.stakingPosition) as unknown as (a: object) => Promise<Row[]>;
  const rows = await groupBy({ by: ['asset'], _sum: { stakedSnapshot: true } });
  const byAsset: Partial<Record<StakingAsset, bigint>> = {};
  for (const r of rows) {
    const asset = ENTRIES.find((e) => e.asset === r.asset)?.asset;
    if (asset) byAsset[asset] = (byAsset[asset] ?? 0n) + BigInt(r._sum.stakedSnapshot?.toFixed(0) ?? '0');
  }
  return buildEcosystemView(byAsset);
}
