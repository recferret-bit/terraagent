import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { CommandRunner } from '../../dev/console/runner';
import marketDev from './index';

const run = async (line: string, services: Partial<FeatureContext['services']> = {}, host: FeatureContext['host'] = 'server') => {
  const r = await new CommandRunner([marketDev], { flags: new Set(['W13']), host, services: services as FeatureContext['services'] }).run(line);
  return r?.kind === 'text' ? r.text : '';
};
const session = { planetId: () => 'pl_here' };

describe('market dev console commands (W13-30)', () => {
  it('market.seed here sends the joined planet and the pair', async () => {
    const devServer = vi.fn(async () => ({ bids: 5, asks: 5 }));
    expect(await run('market.seed here bio.water/metals.t1', { devServer, session }))
      .toBe('seeded bio.water/metals.t1 on pl_here: 5 bids, 5 asks (fixture bot)');
    expect(devServer).toHaveBeenCalledWith('market.seed', { planetId: 'pl_here', pair: 'bio.water/metals.t1' });
    await run('market.seed pl_x bio.water/USDC', { devServer, session });
    expect(devServer).toHaveBeenLastCalledWith('market.seed', { planetId: 'pl_x', pair: 'bio.water/USDC' });
  });

  it('market.clear and faucet', async () => {
    const devServer = vi.fn(async (name: string) => (name === 'faucet' ? { display: '20.00', label: 'mock USDC', accountId: 'a.mock' } : { cancelled: 10 }));
    expect(await run('market.clear here', { devServer, session })).toBe('cleared 10 fixture orders on pl_here');
    expect(await run('faucet usdc 20', { devServer, session, colonyId: 1 })).toBe('credited 20.00 mock USDC to a.mock');
    expect(devServer).toHaveBeenLastCalledWith('faucet', { token: 'usdc', amount: '20', planetId: 'pl_here', colonyIndex: 1 });
    await run('faucet NEAR 1.5', { devServer, session });
    expect(devServer).toHaveBeenLastCalledWith('faucet', { token: 'near', amount: '1.5', planetId: 'pl_here', colonyIndex: 0 });
  });

  it('usage errors, no planet yet, and no server', async () => {
    const devServer = vi.fn();
    expect(await run('faucet eth 1', { devServer, session })).toBe('error: usage: faucet near|usdc <amount>');
    expect(await run('market.seed here', { devServer, session })).toBe('error: usage: market.seed here|<planetId> <base/quote>');
    expect(await run('market.clear', { devServer, session })).toBe('error: usage: market.clear here|<planetId>');
    expect(await run('market.clear here', { devServer, session: { planetId: () => null } })).toContain('host_unavailable');
    expect(await run('market.seed here a/b', { session }, 'local')).toContain('host_unavailable');
    expect(devServer).not.toHaveBeenCalled();
  });
});
