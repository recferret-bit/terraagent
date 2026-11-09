import { describe, expect, it } from 'vitest';
import { loadReport } from '../src/bench.js';

describe('W16-47 load report', () => {
  it('reports p95, RSS, pool, and oldest job age for this machine', () => {
    const report = loadReport(20);
    expect(report.hardware.length).toBeGreaterThan(0);
    expect(report.p95Ms).toBeGreaterThanOrEqual(0);
    expect(report.rssMb).toBeGreaterThan(0);
    expect(report.pool).toBe('in-memory 1');
    expect(report.oldestJobAgeMs).toBe(0);
    expect(report.samples).toBe(20);
  });
});
