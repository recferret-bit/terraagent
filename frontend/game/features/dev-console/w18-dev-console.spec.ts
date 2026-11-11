import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry';
import { CommandRunner } from '../../dev/console/runner';
import type { CommandResult } from '../../net/commandBus';
import diplomacyFeature from '../diplomacy';
import devConsole from './index';

const acking = (res: CommandResult = { ok: true, appliedAtTick: 42 }) => vi.fn(async () => res);

const run = async (
  line: string,
  services: Partial<FeatureContext['services']>,
  flags: string[] = ['W00', 'W01', 'W18'],
  host: FeatureContext['host'] = 'server',
) => {
  const runner = new CommandRunner([devConsole], {
    flags: new Set(flags),
    host,
    services: services as FeatureContext['services'],
  });
  const r = await runner.run(line);
  return r?.kind === 'text' ? r.text : '';
};

describe('W18-25 dev-console: killHq, killHub, setShield, offerTruce positive cases', () => {
  it('killHq sends dev.killHq with empty args, colonyIndex, or colonyId', async () => {
    const sendCommand = acking();

    const out1 = await run('killHq', { sendCommand });
    expect(out1).toBe('dev.killHq ok, applied at tick 42');
    expect(sendCommand).toHaveBeenLastCalledWith('dev.killHq', {});

    const out2 = await run('killHq 1', { sendCommand });
    expect(out2).toBe('dev.killHq ok, applied at tick 42');
    expect(sendCommand).toHaveBeenLastCalledWith('dev.killHq', { colonyIndex: 1 });

    const out3 = await run('killHq col_1', { sendCommand });
    expect(out3).toBe('dev.killHq ok, applied at tick 42');
    expect(sendCommand).toHaveBeenLastCalledWith('dev.killHq', { colonyId: 'col_1' });
  });

  it('killHub sends dev.killHub with empty args or colonyIndex', async () => {
    const sendCommand = acking();

    const out1 = await run('killHub', { sendCommand });
    expect(out1).toBe('dev.killHub ok, applied at tick 42');
    expect(sendCommand).toHaveBeenLastCalledWith('dev.killHub', {});

    const out2 = await run('killHub 1', { sendCommand });
    expect(out2).toBe('dev.killHub ok, applied at tick 42');
    expect(sendCommand).toHaveBeenLastCalledWith('dev.killHub', { colonyIndex: 1 });
  });

  it('setShield sends dev.setShield with hours and optional colony', async () => {
    const sendCommand = acking();

    const out1 = await run('setShield 0', { sendCommand });
    expect(out1).toBe('dev.setShield ok, applied at tick 42');
    expect(sendCommand).toHaveBeenLastCalledWith('dev.setShield', { hours: 0 });

    const out2 = await run('setShield 6', { sendCommand });
    expect(out2).toBe('dev.setShield ok, applied at tick 42');
    expect(sendCommand).toHaveBeenLastCalledWith('dev.setShield', { hours: 6 });

    const out3 = await run('setShield 2 1', { sendCommand });
    expect(out3).toBe('dev.setShield ok, applied at tick 42');
    expect(sendCommand).toHaveBeenLastCalledWith('dev.setShield', { hours: 2, colonyIndex: 1 });
  });

  it('offerTruce sends dev.offerTruce with fromColony, duration, and default hours = 6', async () => {
    const sendCommand = acking();

    const out1 = await run('offerTruce 1 6', { sendCommand });
    expect(out1).toBe('dev.offerTruce ok, applied at tick 42');
    expect(sendCommand).toHaveBeenLastCalledWith('dev.offerTruce', {
      fromColony: 1,
      toColony: 0,
      hours: 6,
      durationHours: 6,
    });

    const out2 = await run('offerTruce col_1 24', { sendCommand });
    expect(out2).toBe('dev.offerTruce ok, applied at tick 42');
    expect(sendCommand).toHaveBeenLastCalledWith('dev.offerTruce', {
      fromColony: 'col_1',
      toColony: 0,
      hours: 24,
      durationHours: 24,
    });

    const out3 = await run('offerTruce 1', { sendCommand });
    expect(out3).toBe('dev.offerTruce ok, applied at tick 42');
    expect(sendCommand).toHaveBeenLastCalledWith('dev.offerTruce', {
      fromColony: 1,
      toColony: 0,
      hours: 6,
      durationHours: 6,
    });
  });
});

describe('W18-25 dev-console: negative cases and rejection handling', () => {
  it('setShield validates hours >= 0 and required argument', async () => {
    const sendCommand = acking();

    expect(await run('setShield', { sendCommand })).toBe('error: missing <h>');
    expect(await run('setShield -1', { sendCommand })).toBe('error: <h> must be >= 0');
    expect(await run('setShield abc', { sendCommand })).toContain('must be a number');
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('offerTruce validates required colony and numeric hours', async () => {
    const sendCommand = acking();

    expect(await run('offerTruce', { sendCommand })).toBe('error: missing <colony>');
    expect(await run('offerTruce 1 abc', { sendCommand })).toContain('must be a number');
    expect(await run('offerTruce 1 -2', { sendCommand })).toBe('error: <h> must be > 0');
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('handles server rejections for wave_disabled and invalid_target', async () => {
    const rejectedWave = acking({ ok: false, code: 'wave_disabled', detail: 'requires W18' });
    expect(await run('killHq', { sendCommand: rejectedWave })).toBe(
      'error: dev.killHq rejected: wave_disabled (requires W18)',
    );

    const rejectedTarget = acking({ ok: false, code: 'invalid_target' });
    expect(await run('killHq 1', { sendCommand: rejectedTarget })).toBe(
      'error: dev.killHq rejected: invalid_target',
    );
    expect(await run('killHub 1', { sendCommand: rejectedTarget })).toBe(
      'error: dev.killHub rejected: invalid_target',
    );
  });

  it('registers commands without duplicate warnings when both dev-console and diplomacy features are loaded', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx: FeatureContext = {
      flags: new Set(['W00', 'W01', 'W18']),
      host: 'server',
      services: {} as FeatureContext['services'],
    };
    const runner = new CommandRunner([devConsole, diplomacyFeature], ctx);
    expect(runner.names()).toContain('killHq');
    expect(runner.names()).toContain('killHub');
    expect(runner.names()).toContain('setShield');
    expect(runner.names()).toContain('offerTruce');
    expect(runner.names()).toContain('dev.offerTruce');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
