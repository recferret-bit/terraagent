import { NearException } from '../../../domain/errors';

type LaneJob<T> = (nonce: bigint, bump: () => bigint) => Promise<T>;

/**
 * Per-signer async mutex plus an in-memory access-key nonce.
 * `run` for one signer waits for that signer's previous `run`; other signers do not wait.
 * The first nonce handed out is `1n`. `bump` (and the next `run`) continue from there.
 */
export class SignerLane {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly nextNonce = new Map<string, bigint>();

  run<T>(signerId: string, fn: LaneJob<T>): Promise<T> {
    const previous = this.tails.get(signerId) ?? Promise.resolve();
    const run = previous.then(() => {
      const nonce = this.allocate(signerId);
      return fn(nonce, () => this.allocate(signerId));
    });
    // A rejection must not stick in the tail, or every later action for this signer would reject.
    this.tails.set(signerId, run.then(() => undefined, () => undefined));
    return run;
  }

  /** Hands out the cached nonce and advances it. A successful action does not call this again. */
  private allocate(signerId: string): bigint {
    const nonce = this.nextNonce.get(signerId) ?? 1n;
    this.nextNonce.set(signerId, nonce + 1n);
    return nonce;
  }
}

/** `MOCK_FAIL_RATE` injection, or a chain `InvalidNonce` (the message is the real RPC's wording). */
function isRetryable(error: unknown): boolean {
  if (error instanceof NearException && error.errorCode === 'NEAR_MOCK_INJECTED_FAILURE') return true;
  if (typeof error !== 'object' || error === null || !('message' in error)) return false;
  const message = (error as { message: unknown }).message;
  return typeof message === 'string' && message.includes('InvalidNonce');
}

/**
 * One extra try on a retryable error. The second failure is `NEAR_RELAY_FAILED`.
 * Anything else is rethrown as-is. This does not assign nonces: the caller passes a new one on the second call.
 */
export async function withOneRetry<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (!isRetryable(error)) throw error;
    try {
      return await attempt();
    } catch {
      throw new NearException('NEAR_RELAY_FAILED');
    }
  }
}

/**
 * One relayed action: hold the signer's lane, try `nonce`, and on a retryable failure try `bump()` once.
 * A first-try success leaves the cache at `nonce + 1n` (the next `run`). A retry has already consumed the next one.
 */
export async function runRelayed<T>(lane: SignerLane, signerId: string, attempt: (nonce: bigint) => Promise<T>): Promise<T> {
  return lane.run(signerId, (nonce, bump) => {
    let first = true;
    return withOneRetry(() => {
      const n = first ? nonce : bump();
      first = false;
      return attempt(n);
    });
  });
}
