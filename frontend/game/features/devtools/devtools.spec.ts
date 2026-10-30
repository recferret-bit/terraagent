import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry';
import type { CommandResult } from '../../net/commandBus';
import { CommandRunner } from '../../dev/console/runner';
import { DevServerError, hostUnavailableDevServer } from '../../net/devServer';
import devtools from './index';

const run = async (line: string, services: Partial<FeatureContext['services']>, host: FeatureContext['host'] = 'server') => {
  const r = await new CommandRunner([devtools], { flags: new Set(['W00']), host, services: services as FeatureContext['services'] }).run(line);
  return r?.kind === 'text' ? r.text : '';
};
const acking = (res: CommandResult = { ok: true, appliedAtTick: 42 }) => vi.fn(async () => res);

describe('devtools commands', () => {
  it('spawn sends dev.spawn with defaults and prints the ack tick', async () => {
    const sendCommand = acking();
    expect(await run('spawn', { sendCommand })).toBe('dev.spawn ok, applied at tick 42');
    expect(sendCommand).toHaveBeenCalledWith('dev.spawn', { q: 0, r: 0 });
    await run('spawn 3 -2', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.spawn', { q: 3, r: -2 });
  });
  it('nudge and teleport build their args; ping sends dev.ping', async () => {
    const sendCommand = acking();
    await run('nudge 5', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.nudge', { id: 5 });
    await run('nudge 5 0 1', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.nudge', { id: 5, dq: 0, dr: 1 });
    await run('teleport 5 2 3', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.teleport', { id: 5, q: 2, r: 3 });
    await run('ping', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.ping', {});
  });
  it('prints a rejection and a missing connection as errors', async () => {
    expect(await run('teleport 9 1 1', { sendCommand: acking({ ok: false, code: 'unknown_entity' }) })).toBe('error: dev.teleport rejected: unknown_entity');
    expect(await run('spawn', {})).toContain('not_connected');
    expect(await run('teleport 1 2', { sendCommand: acking() })).toBe('error: missing <r>');
  });
  it('chain.ping prints the mock: hash; host_unavailable without a server', async () => {
    const devServer = vi.fn(async () => ({ txHash: 'mock:abc', status: 'success', blockHeight: 7 }));
    expect(await run('chain.ping', { devServer })).toBe('mock:abc  success  block 7');
    expect(devServer).toHaveBeenCalledWith('chain.ping');
    expect(await run('chain.ping', {}, 'local')).toContain('host_unavailable');
    expect(await run('chain.ping', { devServer: hostUnavailableDevServer }, 'local')).toContain('needs the game server');
    expect(new DevServerError('x', 'y').code).toBe('x');
  });
});
