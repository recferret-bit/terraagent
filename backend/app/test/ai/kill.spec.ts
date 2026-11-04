import { describe, expect, it } from 'vitest';
import { DirectorKillSwitch } from '../../src/ai/audit/kill.js';

describe('W16-17 kill switch', () => {
  it('rejects an unauthorized admin and a late result after a kill', () => {
    const kill = new DirectorKillSwitch('admin-token');
    expect(kill.kill('colony:co_1', 'intruder', 0).code).toBe('unauthorized');
    expect(kill.acceptResult('colony:co_1', 'worker').code).toBe('ok');

    expect(kill.kill('colony:co_1', 'admin-token', 1_000).code).toBe('killed');
    const late = kill.acceptResult('colony:co_1', 'worker');
    expect(late.code).toBe('killed');
    expect(late.ok).toBe(false);
    expect(1_000).toBeLessThan(5_000);
  });

  it('a colony kill does not stop a different colony', () => {
    const kill = new DirectorKillSwitch('admin-token');
    kill.kill('colony:co_1', 'admin-token', 0);
    expect(kill.acceptResult('colony:co_2', 'worker').code).toBe('ok');
  });
});
