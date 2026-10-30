import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { coreEnv, defineEnv, envFlagTrue, EnvError, parseEnv, appPort, databaseUrl, zFlag } from '../src';

describe('envFlagTrue', () => {
  it('only the exact string "true" counts', () => {
    expect(envFlagTrue('true')).toBe(true);
    for (const v of ['TRUE', 'True', '1', 'yes', ' true', 'true ', '', undefined, null]) expect(envFlagTrue(v)).toBe(false);
  });
});

describe('parseEnv', () => {
  const game = defineEnv('game', { SIM_THREADS: z.coerce.number().int().min(1).optional(), DEV_TOOLS: zFlag() });

  it('merges sections and applies defaults', () => {
    const env = parseEnv([coreEnv, game], { SIM_THREADS: '3', DEV_TOOLS: 'true' });
    expect(env.SIM_THREADS).toBe(3);
    expect(env.DEV_TOOLS).toBe(true);
    expect(appPort(env)).toBe(4001);
    expect(databaseUrl(env)).toBe('postgresql://terra:terra@127.0.0.1:15434/terraagent');
  });

  it('PORT=abc aborts with an error naming PORT', () => {
    expect(() => parseEnv([coreEnv], { PORT: 'abc' })).toThrow(EnvError);
    expect(() => parseEnv([coreEnv], { PORT: 'abc' })).toThrow(/PORT \(core\)/);
  });

  it('collects issues from every section', () => {
    try {
      parseEnv([coreEnv, game], { PORT: 'abc', SIM_THREADS: '0' });
      expect.unreachable();
    } catch (e) {
      expect((e as EnvError).issues.map((i) => i.key).sort()).toEqual(['PORT', 'SIM_THREADS']);
    }
  });

  it('worktree port base shifts every port', () => {
    const env = parseEnv([coreEnv], { TA_PORT_BASE: '4100' });
    expect(appPort(env)).toBe(4101);
  });
});
