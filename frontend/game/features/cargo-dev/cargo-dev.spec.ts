import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry';
import { CommandRunner } from '../../dev/console/runner';
import type { CommandResult } from '../../net/commandBus';
import cargoDev from './index';

const acking = (res: CommandResult = { ok: true, appliedAtTick: 42 }) => vi.fn(async () => res);

const run = async (
  line: string,
  services: Partial<FeatureContext['services']>,
  host: FeatureContext['host'] = 'server',
) => {
  const runner = new CommandRunner([cargoDev], {
    flags: new Set(['W10']),
    host,
    services: services as FeatureContext['services'],
  });
  const r = await runner.run(line);
  return r?.kind === 'text' ? r.text : '';
};

describe('cargo-dev console commands (W10-26)', () => {
  it('cargo.grant with 2 args defaults to colony 0 and sends dev.cargoGrant', async () => {
    const sendCommand = acking();
    const text = await run('cargo.grant metals.t1 500', { sendCommand });
    expect(text).toBe('Granted 500 metals.t1 in orbit for colony 0');
    expect(sendCommand).toHaveBeenCalledWith('dev.cargoGrant', {
      colonyIndex: 0,
      resource: 'metals.t1',
      amount: 500,
    });
  });

  it('cargo.grant with 3 args parses colony name and index', async () => {
    const sendCommand = acking();
    const text1 = await run('cargo.grant col-1 minerals.t1 200', { sendCommand });
    expect(text1).toBe('Granted 200 minerals.t1 in orbit for colony col-1');
    expect(sendCommand).toHaveBeenCalledWith('dev.cargoGrant', {
      colonyIndex: 1,
      resource: 'minerals.t1',
      amount: 200,
    });

    const text2 = await run('cargo.grant 2 bio.water 50', { sendCommand });
    expect(text2).toBe('Granted 50 bio.water in orbit for colony 2');
    expect(sendCommand).toHaveBeenCalledWith('dev.cargoGrant', {
      colonyIndex: 2,
      resource: 'bio.water',
      amount: 50,
    });
  });

  it('cargo.grant rejects invalid args', async () => {
    const sendCommand = acking();
    expect(await run('cargo.grant metals.t1', { sendCommand })).toContain('usage:');
    expect(await run('cargo.grant unknown.res 100', { sendCommand })).toContain('usage:');
    expect(await run('cargo.grant metals.t1 -5', { sendCommand })).toContain('usage:');
  });

  it('cargo.cap.reset sends dev.cargoCapReset', async () => {
    const sendCommand = acking();
    const text1 = await run('cargo.cap.reset', { sendCommand });
    expect(text1).toBe('Reset cargo mint caps for colony 0');
    expect(sendCommand).toHaveBeenCalledWith('dev.cargoCapReset', { colonyIndex: 0 });

    const text2 = await run('cargo.cap.reset col-3', { sendCommand });
    expect(text2).toBe('Reset cargo mint caps for colony 3');
    expect(sendCommand).toHaveBeenCalledWith('dev.cargoCapReset', { colonyIndex: 3 });
  });

  it('tradehub.spawn sends dev.tradehubSpawn with or without q, r', async () => {
    const sendCommand = acking();
    const text1 = await run('tradehub.spawn', { sendCommand });
    expect(text1).toBe('Spawned online Trade Hub T1');
    expect(sendCommand).toHaveBeenCalledWith('dev.tradehubSpawn', { colonyIndex: 0 });

    const text2 = await run('tradehub.spawn 3 -2', { sendCommand });
    expect(text2).toBe('Spawned online Trade Hub T1');
    expect(sendCommand).toHaveBeenCalledWith('dev.tradehubSpawn', {
      colonyIndex: 0,
      q: 3,
      r: -2,
    });
  });
});
