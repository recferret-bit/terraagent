import { parseWaves } from '@terra/contracts';
import { compileData, dataRow } from '@terra/sim';

export interface CircuitSettings {
  readonly failuresToOpen: number;
  readonly openMs: number;
}

/** Reads `director.budget` circuit fields. They are design seconds and counts, not ticks. */
export function circuitSettings(): CircuitSettings {
  const row = dataRow(compileData(parseWaves('..16')), 'director', 'budget');
  return {
    failuresToOpen: row.circuitFailures as number,
    openMs: (row.circuitOpenS as number) * 1000,
  };
}

export type CircuitState = 'closed' | 'open' | 'half_open';

/**
 * Five failures open the circuit. After the open window, one probe is allowed (one in flight at a time).
 * A probe failure opens it again for the same window. `trip` opens it at once for its own window (an unfunded or
 * unauthorized key). Rules-only play is the caller's fallback (AI §7).
 */
export class ProviderCircuit {
  private failures = 0;
  private openUntil = 0;
  private openMs: number;
  private probing = false;

  constructor(private readonly settings: CircuitSettings = circuitSettings()) {
    this.openMs = settings.openMs;
  }

  /** Pure read: never takes the probe. */
  state(nowMs: number): CircuitState {
    if (this.openUntil === 0) return 'closed';
    return nowMs < this.openUntil ? 'open' : 'half_open';
  }

  /** When the open window ends (`0` = closed). */
  retryAtMs(): number {
    return this.openUntil;
  }

  /** `true` lets one call through; in `half_open` only the first caller gets the probe until it settles. */
  allow(nowMs: number): boolean {
    const state = this.state(nowMs);
    if (state === 'closed') return true;
    if (state === 'open' || this.probing) return false;
    this.probing = true;
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openUntil = 0;
    this.openMs = this.settings.openMs;
    this.probing = false;
  }

  recordFailure(nowMs: number): void {
    if (this.probing) {
      this.openUntil = nowMs + this.openMs;
      this.probing = false;
      return;
    }
    this.failures += 1;
    if (this.failures >= this.settings.failuresToOpen) {
      this.openMs = this.settings.openMs;
      this.openUntil = nowMs + this.openMs;
      this.failures = 0;
    }
  }

  /** Opens now for `openMs`; a probe that fails later reopens for the same window. */
  trip(nowMs: number, openMs: number): void {
    this.openMs = openMs;
    this.openUntil = nowMs + openMs;
    this.failures = 0;
    this.probing = false;
  }

  /** A probe that settled with neither a success nor a counted failure (caller abort, rejected request). */
  releaseProbe(): void {
    this.probing = false;
  }
}
