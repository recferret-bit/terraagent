import type { CompiledDataLike } from '../../../kernel/config';

/**
 * Parameters of the quote agent: the `agent` row of the `market` data table (`data/market.ts`, registered as `market.agent.*`
 * with units and bounds in `economy/params/register-market.ts`). Nothing here is a default: a missing or malformed row is
 * an error, so a bot can never quote from numbers nobody pinned.
 */
export interface AgentParams {
  /** Mid-price exponent k = `scarcityExponentNum / scarcityExponentDen`. */
  readonly scarcityExponentNum: number;
  readonly scarcityExponentDen: number;
  readonly epsilonUnits: number;
  readonly clampLowBp: number;
  readonly clampHighBp: number;
  readonly bidHalfSpreadBp: number;
  readonly askHalfSpreadBp: number;
  readonly minSavingBp: number;
  readonly reserveMarginBp: number;
  readonly maxOrderUnits: number;
  /** Quote atomic, as a bigint (decimal string in the row). */
  readonly maxOrderQuoteAtomic: bigint;
  readonly referenceMaxAgeS: number;
  readonly minReferenceVolume: number;
}

const INT_FIELDS = [
  'scarcityExponentNum', 'scarcityExponentDen', 'epsilonUnits', 'clampLowBp', 'clampHighBp', 'bidHalfSpreadBp', 'askHalfSpreadBp',
  'minSavingBp', 'reserveMarginBp', 'maxOrderUnits', 'referenceMaxAgeS', 'minReferenceVolume',
] as const;

/** Validates one raw `agent` row; throws a `RangeError` naming the first bad field. */
export function parseAgentParams(row: Readonly<Record<string, unknown>> | undefined): AgentParams {
  if (!row) throw new RangeError('market.agent row is missing (wave W13 off?)');
  const out: Record<string, number | bigint> = {};
  for (const f of INT_FIELDS) {
    const v = row[f];
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new RangeError(`market.agent.${f} must be a non-negative integer`);
    out[f] = v;
  }
  const atomic = row.maxOrderQuoteAtomic;
  if (typeof atomic !== 'string' || !/^\d+$/.test(atomic) || BigInt(atomic) <= 0n) throw new RangeError('market.agent.maxOrderQuoteAtomic must be a positive decimal string');
  out.maxOrderQuoteAtomic = BigInt(atomic);
  const p = out as unknown as AgentParams;
  if (p.scarcityExponentDen < 1) throw new RangeError('market.agent.scarcityExponentDen must be at least 1');
  if (p.epsilonUnits < 1) throw new RangeError('market.agent.epsilonUnits must be at least 1');
  if (p.clampLowBp < 1 || p.clampLowBp > p.clampHighBp) throw new RangeError('market.agent clamp bounds must satisfy 1 <= low <= high');
  if (p.bidHalfSpreadBp >= 10_000) throw new RangeError('market.agent.bidHalfSpreadBp must be below 10000');
  if (p.maxOrderUnits < 1) throw new RangeError('market.agent.maxOrderUnits must be at least 1');
  return p;
}

/** The agent parameters of a host's compiled data (`compileData` applies profile overrides to the `market` table). */
export function agentParamsFromData(data: CompiledDataLike): AgentParams {
  const table = data.tables.market as Record<string, Record<string, unknown>> | undefined;
  return parseAgentParams(table?.agent);
}
