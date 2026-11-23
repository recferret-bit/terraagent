import type { StakingPoolView } from '../application/ports/staking.port.js';

/** Whitelisted liquid-staking token contracts per network (mirrors the Rust `staking` contract whitelist). */
export const LST_CONTRACTS: Readonly<Record<'testnet' | 'mainnet', Readonly<Record<'stNEAR' | 'LiNEAR', string>>>> = {
  testnet: { stNEAR: 'meta-v2.pool.testnet', LiNEAR: 'linear-protocol.testnet' },
  mainnet: { stNEAR: 'meta-pool.near', LiNEAR: 'linear-protocol.near' },
};

export const lstContractFor = (network: 'testnet' | 'mainnet', asset: 'stNEAR' | 'LiNEAR'): string => LST_CONTRACTS[network][asset];

export function resolveLstPoolView(
  network: 'testnet' | 'mainnet',
  poolId: string,
  defaultApyBp: number,
): { readonly pool: StakingPoolView; readonly asset: 'stNEAR' | 'LiNEAR' } | null {
  const lower = poolId.toLowerCase();
  if (lower === LST_CONTRACTS[network].stNEAR) {
    return { pool: { poolId: LST_CONTRACTS[network].stNEAR, name: 'Meta Pool (stNEAR)', apyBp: defaultApyBp }, asset: 'stNEAR' };
  }
  if (lower === LST_CONTRACTS[network].LiNEAR) {
    return { pool: { poolId: LST_CONTRACTS[network].LiNEAR, name: 'LiNEAR Protocol', apyBp: defaultApyBp }, asset: 'LiNEAR' };
  }
  const rnear = network === 'mainnet' ? 'rnear.near' : 'rnear.testnet';
  if (lower === rnear) {
    return { pool: { poolId: rnear, name: 'rNEAR', apyBp: defaultApyBp }, asset: 'stNEAR' };
  }
  return null;
}

export const isMethodNotFoundRpcError = (err: unknown): boolean =>
  /MethodNotFound|MethodResolveError|method .* not found/i.test(err instanceof Error ? err.message : String(err));
