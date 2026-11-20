import { Logger } from '@nestjs/common';
import { STAKING_RULES } from '@terra/contracts';
import { classifyStakingRpcFailure, StakingRpcError } from './staking-rpc-error.js';

/** Two chain samples a trailing APY needs: block total supply and the active validators' total stake. */
export interface ApySample {
  readonly totalSupplyYocto: bigint;
  readonly blockTimeMs: number;
}

/** Chain reads behind the APY; the default one talks JSON-RPC, tests inject a fake. */
export interface ApyProbe {
  /** Newest final block, and the block `epochsBack` epochs earlier. */
  samples(epochsBack: number): Promise<{ readonly now: ApySample; readonly then: ApySample; readonly totalStakeYocto: bigint }>;
}

export type ApySource = 'live' | 'cached' | 'sim';

export interface ValidatorApy {
  readonly apyBp: number;
  /** `live`: sampled now. `cached`: last good sample (the probe failed). `sim`: no sample ever, the `Sim APY` constant. */
  readonly source: ApySource;
  readonly sampledAtMs: number | null;
  /** Why the live sample is missing (`source` is not `live`). */
  readonly error?: string;
}

const MAX_APY_BP = 5_000;
const TREASURY_SHARE_BP = 1_000n;

/**
 * Trailing validator APY from chain data: annualised inflation (supply growth over the sampled epochs) divided by the staked
 * share of the supply, less the protocol treasury's 10 %. Cached for `ttlMs`; when the probe fails the last good value (or the
 * `Sim APY` constant) is served and flagged, never silently.
 */
export class ValidatorApyReader {
  private readonly log = new Logger(ValidatorApyReader.name);
  private last: { apy: ValidatorApy; at: number } | null = null;

  constructor(
    private readonly probe: ApyProbe,
    private readonly nowMs: () => number = Date.now,
    private readonly ttlMs = 6 * 3_600_000,
    private readonly epochsBack = 4,
  ) {}

  async read(): Promise<ValidatorApy> {
    const now = this.nowMs();
    if (this.last && this.last.apy.source === 'live' && now - this.last.at < this.ttlMs) return this.last.apy;
    try {
      const apyBp = await this.sample();
      const apy: ValidatorApy = { apyBp, source: 'live', sampledAtMs: now };
      this.last = { apy, at: now };
      return apy;
    } catch (err) {
      const failure = err instanceof StakingRpcError ? err : classifyStakingRpcFailure(err, { operation: 'validator_apy' });
      this.log.warn(`validator APY probe failed, serving a fallback: ${failure.message}`);
      const prior = this.last?.apy;
      if (prior && prior.sampledAtMs !== null) return { apyBp: prior.apyBp, source: 'cached', sampledAtMs: prior.sampledAtMs, error: failure.code };
      return { apyBp: STAKING_RULES.simGrossApyBp, source: 'sim', sampledAtMs: null, error: failure.code };
    }
  }

  private async sample(): Promise<number> {
    const { now, then, totalStakeYocto } = await this.probe.samples(this.epochsBack);
    const elapsedMs = now.blockTimeMs - then.blockTimeMs;
    if (elapsedMs <= 0 || then.totalSupplyYocto <= 0n || totalStakeYocto <= 0n || now.totalSupplyYocto < then.totalSupplyYocto) {
      throw new StakingRpcError('apy_unavailable', 'inconsistent supply / stake samples', { operation: 'validator_apy' });
    }
    // growth / elapsed * year, in 1e6 fixed point, then scaled by supply / stake and net of the treasury share.
    const growth = now.totalSupplyYocto - then.totalSupplyYocto;
    const yearMs = 365n * 86_400_000n;
    const inflationPpm = (growth * 1_000_000n * yearMs) / (then.totalSupplyYocto * BigInt(elapsedMs));
    const stakedApyPpm = (inflationPpm * now.totalSupplyYocto) / totalStakeYocto;
    const netPpm = (stakedApyPpm * (10_000n - TREASURY_SHARE_BP)) / 10_000n;
    const bp = Number(netPpm / 100n);
    if (!Number.isFinite(bp) || bp <= 0) {
      throw new StakingRpcError('apy_unavailable', `computed APY ${bp} bp is not usable`, { operation: 'validator_apy' });
    }
    return Math.min(bp, MAX_APY_BP);
  }
}
