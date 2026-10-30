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

describe('devtools core commands', () => {
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
  it('teleport! sends the command without prediction', async () => {
    const sendCommand = acking();
    expect(await run('teleport! 3 6 0', { sendCommand })).toBe('dev.teleport ok, applied at tick 42');
    expect(sendCommand).toHaveBeenCalledWith('dev.teleport', { id: 3, q: 6, r: 0 }, { predict: false });
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

describe('devtools W02 commands', () => {
  it('fill sends dev.fill with default all or specified resource and amount', async () => {
    const sendCommand = acking();
    expect(await run('fill', { sendCommand })).toBe('dev.fill ok, applied at tick 42');
    expect(sendCommand).toHaveBeenCalledWith('dev.fill', { res: 'all' });

    await run('fill metals.t1', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.fill', { res: 'metals.t1' });

    await run('fill bio 150', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.fill', { res: 'bio', amount: 150 });
  });

  it('time sends dev.time with day, night, or HH:MM', async () => {
    const sendCommand = acking();
    expect(await run('time', { sendCommand })).toBe('dev.time ok, applied at tick 42');
    expect(sendCommand).toHaveBeenCalledWith('dev.time', { target: 'day' });

    await run('time 18:00', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.time', { target: '18:00' });

    await run('time night', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.time', { target: 'night' });
  });

  it('skipnight sends dev.skipnight', async () => {
    const sendCommand = acking();
    expect(await run('skipnight', { sendCommand })).toBe('dev.skipnight ok, applied at tick 42');
    expect(sendCommand).toHaveBeenCalledWith('dev.skipnight', {});
  });

  it('power sends dev.power and dumps power state from view if available', async () => {
    const sendCommand = acking();
    expect(await run('power', { sendCommand })).toBe('dev.power ok, applied at tick 42');
    expect(sendCommand).toHaveBeenCalledWith('dev.power', {});

    await run('power 1', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.power', { colonyIndex: 1 });

    const view = {
      colonies: [
        {
          power: {
            supply: 28,
            demand: 5,
            net: 23,
            founderCorePerS: 8,
            solarGrossPerS: 21,
            solarInternalDrainPerS: 1,
            solarNetPerS: 20,
            rawDemand: 5,
            buildingDemand: 5,
            unitDemand: 0,
            brownout: false,
            shedGroupsActive: [],
            shedEntityIds: [],
            daylight: 1,
            phase: 'day',
            clockText: '12:00',
          },
        },
      ],
    };
    const out = await run('power', { sendCommand, view });
    expect(out).toContain('colony 0 power: +23 E/s (OK)');
    expect(out).toContain('supply: 28 E/s (core: 8, solar: 20 [gross 21, drain 1])');
    expect(out).toContain('demand: 5 E/s (raw: 5, buildings: 5, units: 0)');
    expect(out).toContain('daylight: 1 (day 12:00)');
  });
});
