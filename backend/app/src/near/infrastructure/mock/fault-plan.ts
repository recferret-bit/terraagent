import { NearException } from '../../domain/errors.js';

/**
 * Deterministic fault injection for the mock chain (W13 test knobs; see `near/testing/README.md`). Unlike `MOCK_FAIL_RATE`
 * (a probability) a rule fires exactly `times` times for the calls it matches, in call order, then disarms itself.
 *
 * - `fail_before`: throws before anything is written (no receipt, no balance change); a retry with the same opId runs normally.
 * - `fail_after`: the write commits, then `NEAR_UNAVAILABLE` is thrown, so the caller cannot know it happened (unknown outcome);
 *   a retry with the same opId returns the stored receipt.
 * - `insufficient_funds`: throws `NEAR_INSUFFICIENT_BALANCE` before anything is written.
 * - `duplicate`: the call is delivered twice with the same opId; the second delivery must replay the receipt (a double effect
 *   would show up in the balances).
 * - `hold`: the call blocks (nothing written) until the test calls `release()`: delayed finality.
 */
export const FAULT_KINDS = ['fail_before', 'fail_after', 'insufficient_funds', 'duplicate', 'hold'] as const;
export type FaultKind = (typeof FAULT_KINDS)[number];

export interface FaultRule {
  readonly kind: FaultKind;
  /** Port name (`Intents`, `CargoToken`, ...), case-insensitive. `*` or omitted matches every port. */
  readonly port?: string;
  /** Port method (`execute`, `deposit`, `withdraw`, ...). Omitted matches every method. */
  readonly method?: string;
  /** Matches opIds that start with this prefix (`trade:` selects all settlement batches). Omitted matches every opId. */
  readonly opIdPrefix?: string;
  /** How many matching calls the rule fires on (default 1). */
  readonly times?: number;
  /** Skip this many matching calls first (default 0): "fail the second trade". */
  readonly skip?: number;
}

export interface FaultCall { readonly port: string; readonly method: string; readonly opId?: string }

export interface FaultHandle {
  readonly rule: FaultRule;
  /** How many times the rule has fired. */
  fired(): number;
  /** `hold` rules: lets every blocked call (and later ones) through. Other kinds: disarms the rule. */
  release(): void;
  /** Resolves when `n` calls are blocked by a `hold` rule (test synchronisation). */
  waitHeld(n?: number): Promise<void>;
}

interface Armed { rule: FaultRule; skipLeft: number; timesLeft: number; fired: number; gate: Promise<void>; open: () => void; waiters: Array<{ n: number; resolve: () => void }>; held: number; released: boolean }

const lc = (s: string | undefined): string | undefined => s?.toLowerCase();

/** Consumed by `MockChainBase` and the in-memory fakes via `plan.take(call)`. */
export class FaultPlan {
  private readonly rules: Armed[] = [];

  inject(rule: FaultRule): FaultHandle {
    if (!FAULT_KINDS.includes(rule.kind)) throw new Error(`unknown fault kind ${String(rule.kind)}`);
    const times = rule.times ?? 1;
    const skip = rule.skip ?? 0;
    if (!Number.isInteger(times) || times < 1) throw new Error('fault times must be an integer >= 1');
    if (!Number.isInteger(skip) || skip < 0) throw new Error('fault skip must be an integer >= 0');
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    const armed: Armed = { rule, skipLeft: skip, timesLeft: times, fired: 0, gate, open, waiters: [], held: 0, released: false };
    this.rules.push(armed);
    return {
      rule,
      fired: () => armed.fired,
      release: () => { armed.timesLeft = 0; armed.released = true; armed.open(); this.prune(); },
      waitHeld: (n = 1) => (armed.held >= n ? Promise.resolve() : new Promise<void>((resolve) => { armed.waiters.push({ n, resolve }); })),
    };
  }

  /** The first armed rule matching the call fires once (earlier injected rules win); null when none matches. */
  take(call: FaultCall): { kind: FaultKind; hold?: Promise<void> } | null {
    for (const a of this.rules) {
      if (a.timesLeft <= 0 || !matches(a.rule, call)) continue;
      if (a.skipLeft > 0) { a.skipLeft -= 1; continue; }
      a.timesLeft -= 1;
      a.fired += 1;
      if (a.rule.kind === 'hold') {
        a.held += 1;
        for (const w of a.waiters.filter((x) => a.held >= x.n)) w.resolve();
        a.waiters = a.waiters.filter((x) => a.held < x.n);
        return { kind: 'hold', hold: a.gate };
      }
      this.prune();
      return { kind: a.rule.kind };
    }
    return null;
  }

  /** Throws the failure of a `fail_before` / `insufficient_funds` fault; awaits a `hold`; returns the pending post-effect fault. */
  async before(call: FaultCall): Promise<'fail_after' | 'duplicate' | null> {
    const f = this.take(call);
    if (f?.kind === 'hold') await f.hold;
    return f ? FaultPlan.raise(f.kind, call) : null;
  }

  /** Synchronous variant for the in-memory fakes; a `hold` rule cannot block there and is ignored (it still counts as fired). */
  beforeSync(call: FaultCall): 'fail_after' | 'duplicate' | null {
    const f = this.take(call);
    return f ? FaultPlan.raise(f.kind, call) : null;
  }

  private static raise(kind: FaultKind, call: FaultCall): 'fail_after' | 'duplicate' | null {
    if (kind === 'fail_before') throw new NearException('NEAR_MOCK_INJECTED_FAILURE', { message: `fault: ${call.port}.${call.method} failed before submit`, details: { ...call, fault: 'fail_before' } });
    if (kind === 'insufficient_funds') throw new NearException('NEAR_INSUFFICIENT_BALANCE', { message: `fault: ${call.port}.${call.method} forced insufficient funds`, details: { ...call, fault: 'insufficient_funds' } });
    return kind === 'fail_after' || kind === 'duplicate' ? kind : null;
  }

  /** Call after a successful write with the value `before` returned: throws for `fail_after`. */
  static after(pending: 'fail_after' | 'duplicate' | null, call: FaultCall): void {
    if (pending === 'fail_after') throw new NearException('NEAR_UNAVAILABLE', { message: `fault: ${call.port}.${call.method} outcome unknown (applied)`, details: { ...call, fault: 'fail_after' } });
  }

  /** Disarms everything and releases blocked calls. */
  reset(): void {
    for (const a of this.rules) { a.released = true; a.open(); }
    this.rules.length = 0;
  }

  private prune(): void {
    for (let i = this.rules.length - 1; i >= 0; i--) if (this.rules[i]!.timesLeft <= 0 && (this.rules[i]!.rule.kind !== 'hold' || this.rules[i]!.released)) this.rules.splice(i, 1);
  }
}

/** The DB mock names a call by its chain method; rules may use the port method name (`execute`) instead. */
const CHAIN_METHOD: Record<string, string> = { execute: 'execute_intents', deposit: 'mt_transfer_call', withdraw: 'mt_withdraw' };

function matches(r: FaultRule, c: FaultCall): boolean {
  const port = lc(r.port);
  if (port && port !== '*' && port !== lc(c.port)) return false;
  if (r.method && r.method !== c.method && !(lc(c.port) === 'intents' && CHAIN_METHOD[r.method] === c.method)) return false;
  if (r.opIdPrefix !== undefined && !(c.opId ?? '').startsWith(r.opIdPrefix)) return false;
  return true;
}
