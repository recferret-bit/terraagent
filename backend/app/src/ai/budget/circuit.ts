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

/**
 * Five failures open the circuit. After the open window, one probe is allowed.
 * A probe failure opens it again. Rules-only play is the caller's fallback (AI §7).
 */
export class ProviderCircuit {
  private failures = 0;
  private openUntil = 0;
  private probing = false;

  constructor(private readonly settings: CircuitSettings = circuitSettings()) {}

  allow(nowMs: number): boolean {
    if (nowMs >= this.openUntil) {
      this.probing = this.openUntil > 0;
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openUntil = 0;
    this.probing = false;
  }

  recordFailure(nowMs: number): void {
    if (this.probing) {
      this.openUntil = nowMs + this.settings.openMs;
      this.probing = false;
      return;
    }
    this.failures += 1;
    if (this.failures >= this.settings.failuresToOpen) {
      this.openUntil = nowMs + this.settings.openMs;
      this.failures = 0;
    }
  }
}
