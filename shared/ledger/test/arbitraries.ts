import fc from 'fast-check';
import { createLedgerState, post, type Leg, type LedgerState, type PostResult, type PostingInput } from '../src';
import { SYS } from './helpers';

export const ACCOUNTS = ['sys:mine', 'sys:sink', 'colony:0', 'colony:1', 'colony:2'] as const;
export const ASSETS = ['ore', 'water', 'gold'] as const;

const account = fc.constantFrom(...ACCOUNTS);
const asset = fc.constantFrom(...ASSETS);
/** Sources are drawn more often so colonies hold something to spend. */
const from = fc.oneof({ weight: 2, arbitrary: fc.constant('sys:mine') }, { weight: 3, arbitrary: account });

/** Balanced legs: 1–3 moves of a positive amount between two accounts. */
const balancedLegs: fc.Arbitrary<Leg[]> = fc
  .array(fc.record({ from, to: account, asset, amount: fc.integer({ min: 1, max: 30 }) }), { minLength: 1, maxLength: 3 })
  .map((moves) =>
    moves.flatMap((m) => [
      { account: m.from, asset: m.asset, delta: -m.amount },
      { account: m.to, asset: m.asset, delta: m.amount },
    ]),
  );

/** Arbitrary legs: usually unbalanced, sometimes zero, fractional, short or empty. */
const rawLegs: fc.Arbitrary<Leg[]> = fc.array(
  fc.record({ account, asset, delta: fc.oneof(fc.integer({ min: -30, max: 30 }), fc.constantFrom(0.5, -2.25, NaN)) }),
  { maxLength: 5 },
);

/** A random posting; `withOpIds` draws opIds from a tiny pool so duplicates and conflicts happen. */
export function postingArb(withOpIds: boolean): fc.Arbitrary<PostingInput> {
  return fc.record(
    {
      at: fc.nat({ max: 1000 }),
      reason: fc.constantFrom('mine', 'spend', 'trade'),
      actor: fc.constantFrom('system:mine', 'colony:0', 'player:p1'),
      ref: fc.constantFrom('order:1', 'order:2'),
      opId: withOpIds ? fc.constantFrom('op:1', 'op:2', 'op:3', 'op:4') : fc.constant(undefined),
      legs: fc.oneof({ weight: 3, arbitrary: balancedLegs }, { weight: 1, arbitrary: rawLegs }),
    },
    { requiredKeys: ['at', 'reason', 'actor', 'legs'] },
  );
}

/**
 * A sequence of postings; with opIds, some steps repeat an earlier posting verbatim (a retry) so the duplicate path
 * is exercised as well as conflicts.
 */
export function postings(withOpIds: boolean, maxLength = 60): fc.Arbitrary<PostingInput[]> {
  const step = withOpIds ? fc.oneof({ weight: 4, arbitrary: postingArb(true) }, { weight: 1, arbitrary: fc.nat() }) : postingArb(false);
  return fc.array(step, { maxLength }).map((steps) => {
    const out: PostingInput[] = [];
    for (const s of steps) {
      if (typeof s !== 'number') out.push(s);
      else if (out.length > 0) out.push(structuredClone(out[s % out.length]));
    }
    return out;
  });
}

/** Journal limits worth testing: unlimited (0), tiny tails, and the default. */
export const journalLimit = fc.constantFrom(0, 1, 2, 3, 5, 256);

/** Posts every input into a fresh ledger with the `sys:` policy. */
export function run(inputs: readonly PostingInput[], limit: number): { state: LedgerState; results: PostResult[] } {
  const state = createLedgerState({ journalLimit: limit });
  const results = inputs.map((input) => post(state, input, SYS));
  return { state, results };
}

/** Per-asset sums of `legs`, dropping zeros. */
export function legSums(legs: readonly Leg[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of legs) out[l.asset] = (out[l.asset] ?? 0) + l.delta;
  for (const k of Object.keys(out)) if (out[k] === 0) delete out[k];
  return out;
}
