import { describe, expect, it } from 'vitest';
import { JobClaims } from '../src/claim.js';

describe('W16-31 job claims', () => {
  it('lets one worker hold a job and rejects a second worker and a stale fence', () => {
    const claims = new JobClaims();
    expect(claims.claim('job_1', 'worker-a', 2)).toBe('claimed');
    expect(claims.claim('job_1', 'worker-b', 2)).toBe('busy');
    expect(claims.claim('job_1', 'worker-b', 1)).toBe('stale');
    expect(claims.finish('job_1', 'worker-b', 2)).toBe('stale');
    expect(claims.finish('job_1', 'worker-a', 2)).toBe('done');
    expect(claims.claim('job_1', 'worker-a', 3)).toBe('stale');
  });
});
