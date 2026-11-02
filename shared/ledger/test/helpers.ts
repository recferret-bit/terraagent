import type { Leg, NegativePolicy, PostingInput } from '../src';

/** System accounts (sources/sinks) may go negative; everything else may not. */
export const SYS: NegativePolicy = (account) => account.startsWith('sys:');

export const leg = (account: string, asset: string, delta: number): Leg => ({ account, asset, delta });

/** A posting of `legs` with fixed metadata; `extra` overrides any field. */
export function posting(legs: Leg[], extra: Partial<PostingInput> = {}): PostingInput {
  return { at: 1, reason: 'test.move', actor: 'tester', legs, ...extra };
}

/** Moves `amount` of `asset` from `from` to `to`. */
export function move(from: string, to: string, asset: string, amount: number, extra: Partial<PostingInput> = {}): PostingInput {
  return posting([leg(from, asset, -amount), leg(to, asset, amount)], extra);
}
