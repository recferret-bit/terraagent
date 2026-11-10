import type { FlagSet } from '@terra/contracts';
import {
  agentParamsFromData,
  compileData,
  readMarketPolicy,
  readMinNotionalAtomic,
  type AgentParams,
} from '@terra/sim';

export interface DirectorMarketTerms {
  readonly params: AgentParams;
  readonly platformFeeBp: number;
  readonly maxStallFeeBp: number;
  readonly lotUnits: number;
  readonly minNotionalAtomic: bigint;
  readonly ttlS: number;
}

/** Market policy the director prices and places with. One compile per loop, not a second price table. */
export function loadDirectorTerms(flags: FlagSet): DirectorMarketTerms | null {
  const data = compileData(flags);
  const policy = readMarketPolicy(data);
  const ttlS = policy.ttlOptionsS[0];
  if (ttlS === undefined) return null;
  return {
    params: agentParamsFromData(data),
    platformFeeBp: policy.platformFeeBp,
    maxStallFeeBp: policy.stallFeeMaxBp,
    lotUnits: policy.baseLotUnits,
    minNotionalAtomic: readMinNotionalAtomic(data, 'USDC'),
    ttlS,
  };
}
