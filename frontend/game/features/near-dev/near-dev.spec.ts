import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry';
import { CommandRunner } from '../../dev/console/runner';
import nearDev from './index';

const run = async (line: string, services: Partial<FeatureContext['services']> = {}, host: FeatureContext['host'] = 'server') => {
  const r = await new CommandRunner([nearDev], { flags: new Set(['W06']), host, services: services as FeatureContext['services'] }).run(line);
  return r?.kind === 'text' ? r.text : '';
};

describe('near-dev commands', () => {
  it('near.mock.fail sends the rate and confirms it', async () => {
    const devServer = vi.fn(async () => ({ port: 'relayer', rate: 1 }));
    expect(await run('near.mock.fail relayer 1', { devServer })).toBe('fail rate for relayer is 1');
    expect(devServer).toHaveBeenCalledWith('near.mock.fail', { port: 'relayer', rate: 1 });
    expect(await run('near.mock.fail relayer 0', { devServer })).toBe('fail rate for relayer is 0');
  });

  it('rejects a bad arity and a missing server', async () => {
    expect(await run('near.mock.fail relayer')).toBe('error: usage: near.mock.fail <port> <rate>');
    expect(await run('near.mock.latency relayer 0')).toBe('error: usage: near.mock.latency <port> <minMs> <maxMs>');
    expect(await run('account.reset')).toBe('error: usage: account.reset <player>');
    expect(await run('account.upgrade google')).toBe('error: usage: account.upgrade <provider> <subject>');
    expect(await run('near.mock.fail relayer 1', {}, 'local')).toContain('host_unavailable');
  });

  it('latency, reset and upgrade confirm in one line', async () => {
    const devServer = vi.fn(async (name: string) => {
      if (name === 'near.mock.latency') return { port: 'relayer', minMs: 0, maxMs: 20 };
      if (name === 'account.reset') return { playerId: 'pr_a' };
      return { playerId: 'pr_b', accountId: 'ada.terraagent.mock', accessToken: 'tok' };
    });
    expect(await run('near.mock.latency relayer 0 20', { devServer })).toBe('latency for relayer is 0..20 ms');
    expect(devServer).toHaveBeenCalledWith('near.mock.latency', { port: 'relayer', minMs: 0, maxMs: 20 });
    expect(await run('account.reset pr_a', { devServer })).toBe('reset pr_a: sessions cleared');
    expect(devServer).toHaveBeenCalledWith('account.reset', { player: 'pr_a' });
    expect(await run('account.upgrade google ada', { devServer })).toBe('google ada → pr_b ada.terraagent.mock');
    expect(devServer).toHaveBeenCalledWith('account.upgrade', { provider: 'google', subject: 'ada' });
    expect(await run('account.upgrade facebook ada', { devServer })).toBe('error: usage: account.upgrade <provider> <subject>');
    expect(await run('near.mock.latency relayer 20 0', { devServer })).toBe('error: usage: near.mock.latency <port> <minMs> <maxMs>');
  });

  it('near.ports and near.quote inspect active adapters and 1Click dry quotes', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/v1/near/status')) {
        return new Response(
          JSON.stringify({
            nearMode: 'testnet',
            rootAccount: 'terraagent.testnet',
            health: { ok: true, latencyMs: 31 },
            ports: [{ port: 'CargoToken', mode: 'testnet', target: 'res.terraagent.testnet' }],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ source: '1click', amountIn: '100', amountOut: '450', minAmountOut: '445' }),
        { status: 200 },
      );
    });
    expect(await run('near.ports')).toContain('NEAR_MODE=testnet root=terraagent.testnet rpc=ok(31ms) | CargoToken:testnet');
    expect(await run('near.quote 100')).toBe('quote[1click] in=100 -> out=450 (min=445)');
    expect(await run('near.ports', {}, 'local')).toContain('host_unavailable');
    vi.restoreAllMocks();
  });
});
