import type { JsonRpcProvider } from 'near-api-js';
import type { ApyProbe, ApySample } from './validator-apy.js';
import { StakingRpcError } from './staking-rpc-error.js';

/** NEAR epoch length in blocks (about 12 hours). */
const EPOCH_BLOCKS = 43_200;

interface FailoverRpc {
  withFailover<T>(op: (provider: JsonRpcProvider) => Promise<T>): Promise<T>;
}

const sampleOf = (header: { total_supply: string; timestamp_nanosec: string }): ApySample => ({
  totalSupplyYocto: BigInt(header.total_supply),
  blockTimeMs: Number(BigInt(header.timestamp_nanosec) / 1_000_000n),
});

/**
 * Samples the chain over JSON-RPC: the final block, the block `epochsBack` epochs earlier (a regular node keeps about five
 * epochs) and the current validators' total stake. Failures propagate to `ValidatorApyReader`, which flags its fallback.
 */
export function rpcApyProbe(rpc: FailoverRpc): ApyProbe {
  return {
    async samples(epochsBack) {
      const nowBlock = await rpc.withFailover((p) => p.viewBlock({ finality: 'final' }));
      const earlierHeight = nowBlock.header.height - epochsBack * EPOCH_BLOCKS;
      if (earlierHeight <= 0) throw new StakingRpcError('apy_unavailable', 'chain is younger than the APY window', { operation: 'validator_apy' });
      const [thenBlock, validators] = await Promise.all([
        rpc.withFailover((p) => p.viewBlock({ blockId: earlierHeight })),
        rpc.withFailover((p) => p.viewValidators()),
      ]);
      const totalStakeYocto = validators.current_validators.reduce((sum, v) => sum + BigInt(v.stake), 0n);
      return {
        now: sampleOf(nowBlock.header as never),
        then: sampleOf(thenBlock.header as never),
        totalStakeYocto,
      };
    },
  };
}
