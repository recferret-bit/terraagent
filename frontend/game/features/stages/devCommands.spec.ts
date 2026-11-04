import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext, GameView } from '../../core/registry';
import { CommandRunner } from '../../dev/console/runner';
import type { CommandResult } from '../../net/commandBus';
import stagesFeature, { autopilotCommand, goalCommand, stageCommand } from './index';

const run = async (
  line: string,
  services: Partial<FeatureContext['services']>,
  host: FeatureContext['host'] = 'server',
) => {
  const runner = new CommandRunner([stagesFeature], {
    flags: new Set(['W00', 'W02', 'W08']),
    host,
    services: services as FeatureContext['services'],
  });
  const r = await runner.run(line);
  return r?.kind === 'text' ? r.text : '';
};

const acking = (res: CommandResult = { ok: true, appliedAtTick: 42 }) => vi.fn(async () => res);

describe('W08-30 · dev console stageCommand', () => {
  it('help stage lists override names (fauna, rival, resource, power, storage)', async () => {
    expect(stageCommand.help).toContain('fauna');
    expect(stageCommand.help).toContain('rival');
    expect(stageCommand.help).toContain('resource');
    expect(stageCommand.help).toContain('power');
    expect(stageCommand.help).toContain('storage');

    const helpOut = await run('help stage', {});
    expect(helpOut).toContain('fauna');
    expect(helpOut).toContain('rival');
    expect(helpOut).toContain('resource');
    expect(helpOut).toContain('power');
    expect(helpOut).toContain('storage');

    const bareOut = await run('stage', {});
    expect(bareOut).toContain('overrides: fauna, rival, resource, power, storage');

    const stageHelpOut = await run('stage help', {});
    expect(stageHelpOut).toContain('overrides: fauna, rival, resource, power, storage');
  });

  it('stage set 4 sends dev.stage { op: "set", stage: 4 }', async () => {
    const sendCommand = acking();
    const res = await run('stage set 4', { sendCommand });
    expect(sendCommand).toHaveBeenCalledWith('dev.stage', { op: 'set', stage: 4 });
    expect(res).toBe('stage set to S4 (applied at tick 42)');

    await run('stage set 0', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.stage', { op: 'set', stage: 0 });

    await run('stage set 10', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.stage', { op: 'set', stage: 10 });
  });

  it('stage set validates range 0..10', async () => {
    const sendCommand = acking();
    expect(await run('stage set -1', { sendCommand })).toContain('error: usage: stage set <0..10>');
    expect(await run('stage set 11', { sendCommand })).toContain('error: usage: stage set <0..10>');
    expect(await run('stage set abc', { sendCommand })).toContain('error: usage: stage set <0..10>');
    expect(await run('stage set', { sendCommand })).toContain('error: usage: stage set <0..10>');
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('stage skip-dwell sends dev.stage { op: "skip-dwell" }', async () => {
    const sendCommand = acking();
    const res1 = await run('stage skip-dwell', { sendCommand });
    expect(sendCommand).toHaveBeenCalledWith('dev.stage', { op: 'skip-dwell' });
    expect(res1).toBe('stage dwell skipped (applied at tick 42)');

    const res2 = await run('stage skip_dwell', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.stage', { op: 'skip-dwell' });
    expect(res2).toBe('stage dwell skipped (applied at tick 42)');

    const res3 = await run('stage skip', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.stage', { op: 'skip-dwell' });
    expect(res3).toBe('stage dwell skipped (applied at tick 42)');
  });

  it('stage trigger fauna sends dev.stage { op: "trigger", override: "fauna" }', async () => {
    const sendCommand = acking();
    const res = await run('stage trigger fauna', { sendCommand });
    expect(sendCommand).toHaveBeenCalledWith('dev.stage', { op: 'trigger', override: 'fauna' });
    expect(res).toBe("stage override 'fauna' triggered -> S3 First Contact (applied at tick 42)");
  });

  it('stage trigger power advances to S5 Industrial and validates override names', async () => {
    const sendCommand = acking();
    const res = await run('stage trigger power', { sendCommand });
    expect(sendCommand).toHaveBeenCalledWith('dev.stage', { op: 'trigger', override: 'power' });
    expect(res).toBe("stage override 'power' triggered -> S5 Industrial (applied at tick 42)");

    const bad = await run('stage trigger invalid_override', { sendCommand });
    expect(bad).toContain('error: unknown override');
  });

  it('stage reports sim rejection error', async () => {
    const sendCommand = acking({ ok: false, code: 'wave_disabled' });
    const res = await run('stage set 2', { sendCommand });
    expect(res).toBe('error: dev.stage rejected: wave_disabled');
  });
});

describe('W08-30 · dev console goalCommand', () => {
  it('goalCommand exports valid help', () => {
    expect(goalCommand.help).toContain('goal');
  });

  it('goal add grow_economy metals 10 sends queueGoal', async () => {
    const sendCommand = acking();
    const res = await run('goal add grow_economy metals 10', { sendCommand });
    expect(sendCommand).toHaveBeenCalledWith('queueGoal', {
      goal: 'grow_economy',
      params: { resource: 'metals.t1', targetRatePerMin: 10 },
    });
    expect(res).toBe('goal grow_economy queued (applied at tick 42)');
  });

  it('goal add normalizes goal types and handles default params', async () => {
    const sendCommand = acking();
    await run('goal add grow-economy 25', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('queueGoal', {
      goal: 'grow_economy',
      params: { resource: 'metals.t1', targetRatePerMin: 25 },
    });

    await run('goal add secure_power 15', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('queueGoal', {
      goal: 'secure_power',
      params: { targetNetEnergyPerS: 15 },
    });

    await run('goal add establish_colony', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('queueGoal', {
      goal: 'establish_colony',
      params: {},
    });
  });

  it('goal cancel <goalId> sends cancelGoal', async () => {
    const sendCommand = acking();
    const res = await run('goal cancel goal_0_1', { sendCommand });
    expect(sendCommand).toHaveBeenCalledWith('cancelGoal', { goalId: 'goal_0_1' });
    expect(res).toBe('goal goal_0_1 cancelled (applied at tick 42)');

    const err = await run('goal cancel', { sendCommand });
    expect(err).toContain('error: usage: goal cancel <goalId>');
  });

  it('goal clear sends dev.goal { op: "clear" }', async () => {
    const sendCommand = acking();
    const res = await run('goal clear', { sendCommand });
    expect(sendCommand).toHaveBeenCalledWith('dev.goal', { op: 'clear' });
    expect(res).toBe('goals cleared (applied at tick 42)');
  });

  it('goal add reports reject code like goal_limit', async () => {
    const sendCommand = acking({ ok: false, code: 'goal_limit' });
    const res = await run('goal add grow_economy', { sendCommand });
    expect(res).toBe('error: queueGoal rejected: goal_limit');
  });
});

describe('W08-30 · dev console autopilotCommand', () => {
  it('autopilotCommand exports valid help', () => {
    expect(autopilotCommand.help).toContain('autopilot');
  });

  it('autopilot next sends dev.autopilot and formats the decision output (suggestion at S2, auto at S3)', async () => {
    const sendCommand = acking();

    // S2 test (suggestion)
    const viewS2 = {
      colonies: [
        {
          index: 0,
          stage: 2,
          lastAutopilotDecision: {
            need: 'energy',
            weightedBp: 6800,
            mode: 'suggestion',
            target: 'wind',
            lane: 'construction',
          },
        },
      ],
    };

    const resS2 = await run('autopilot next', { sendCommand, view: viewS2 as unknown as GameView });
    expect(sendCommand).toHaveBeenCalledWith('dev.autopilot', { op: 'next' });
    expect(resS2).toContain('energy');
    expect(resS2).toContain('6800 bp');
    expect(resS2).toContain('suggestion');
    expect(resS2).toContain('wind');
    expect(resS2).toContain('construction');
    expect(resS2).toBe('autopilot next: energy (6800 bp) -> suggestion: wind (construction)');

    // S3 test (auto)
    const viewS3 = {
      colonies: [
        {
          index: 0,
          stage: 3,
          lastAutopilotDecision: {
            need: 'energy',
            weightedBp: 6800,
            mode: 'auto',
            target: 'wind',
            lane: 'construction',
          },
        },
      ],
    };

    const resS3 = await run('autopilot next', { sendCommand, view: viewS3 as unknown as GameView });
    expect(resS3).toContain('auto');
    expect(resS3).toBe('autopilot next: energy (6800 bp) -> auto: wind (construction)');
  });

  it('bare autopilot invokes op: "next" and falls back if view decision is not present', async () => {
    const sendCommand = acking();
    const res = await run('autopilot', { sendCommand });
    expect(sendCommand).toHaveBeenCalledWith('dev.autopilot', { op: 'next' });
    expect(res).toBe('dev.autopilot ok (applied at tick 42)');
  });

  it('autopilot reports rejection from sim', async () => {
    const sendCommand = acking({ ok: false, code: 'wave_disabled' });
    const res = await run('autopilot next', { sendCommand });
    expect(res).toBe('error: dev.autopilot rejected: wave_disabled');
  });
});
