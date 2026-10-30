import { describe, expect, it, vi } from 'vitest';
import { createPlanet, rowOf, SimHost, spawnHqUnit, stepTerraformWorkWithCell } from '@terra/sim';
import type { FeatureContext } from '../../core/registry';
import { CommandRunner } from '../../dev/console/runner';
import type { CommandResult } from '../../net/commandBus';
import devConsole from './index';

const run = async (
  line: string,
  services: Partial<FeatureContext['services']>,
  flags: string[] = ['W00', 'W01'],
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

const acking = (res: CommandResult = { ok: true, appliedAtTick: 42 }) => vi.fn(async () => res);

describe('dev-console grant and cell commands', () => {
  it('grant sends dev.grant with resource key and amount', async () => {
    const sendCommand = acking();
    const out = await run('grant metals.t1 500', { sendCommand });
    expect(out).toBe('dev.grant ok, applied at tick 42');
    expect(sendCommand).toHaveBeenCalledWith('dev.grant', { resource: 'metals.t1', amount: 500 });

    await run('grant metals 200', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.grant', { resource: 'metals.t1', amount: 200 });

    await run('grant minerals 100', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.grant', { resource: 'minerals.t1', amount: 100 });

    await run('grant biomass 50', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.grant', { resource: 'bio.biomass', amount: 50 });

    await run('grant water 30', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.grant', { resource: 'bio.water', amount: 30 });
  });

  it('grant validates arguments', async () => {
    const sendCommand = acking();
    expect(await run('grant', { sendCommand })).toBe('error: missing <res>');
    expect(await run('grant metals', { sendCommand })).toBe('error: missing <n>');
    expect(await run('grant metals abc', { sendCommand })).toContain('must be a number');
  });

  it('cell sends dev.cell with energy', async () => {
    const sendCommand = acking();
    const out = await run('cell 0', { sendCommand });
    expect(out).toBe('dev.cell ok, applied at tick 42');
    expect(sendCommand).toHaveBeenCalledWith('dev.cell', { energy: 0 });

    await run('cell 800', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.cell', { energy: 800 });

    expect(await run('cell', { sendCommand })).toBe('error: missing <E>');
    expect(await run('cell nope', { sendCommand })).toContain('must be a number');
  });
});

describe('dev-console reveal, seed, tp, land commands', () => {
  it('reveal sends dev.reveal with empty args', async () => {
    const sendCommand = acking();
    const out = await run('reveal', { sendCommand });
    expect(out).toBe('dev.reveal ok, applied at tick 42');
    expect(sendCommand).toHaveBeenCalledWith('dev.reveal', {});
  });

  it('seed sends dev.seed with seed string', async () => {
    const sendCommand = acking();
    const out = await run('seed test-seed', { sendCommand });
    expect(out).toBe('dev.seed ok, applied at tick 42');
    expect(sendCommand).toHaveBeenCalledWith('dev.seed', { seed: 'test-seed' });

    expect(await run('seed', { sendCommand })).toBe('error: missing <s>');
  });

  it('tp sends dev.teleport for 2 args (defaulting to entityId: 0) and 3 args', async () => {
    const sendCommand = acking();
    const out = await run('tp 4 -3', { sendCommand });
    expect(out).toBe('dev.teleport ok, applied at tick 42');
    expect(sendCommand).toHaveBeenCalledWith('dev.teleport', { entityId: 0, q: 4, r: -3 });

    await run('tp 12 5 -1', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.teleport', { entityId: 12, q: 5, r: -1 });

    expect(await run('tp 4', { sendCommand })).toBe('error: missing <r>');
  });

  it('land sends dev.land with or without coords', async () => {
    const sendCommand = acking();
    const out = await run('land', { sendCommand });
    expect(out).toBe('dev.land ok, applied at tick 42');
    expect(sendCommand).toHaveBeenCalledWith('dev.land', {});

    await run('land 2 -4', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.land', { q: 2, r: -4 });
  });

  it('handles rejections and disconnected state', async () => {
    const sendCommand = acking({ ok: false, code: 'no_hq', detail: 'HQ not spawned' });
    expect(await run('cell 0', { sendCommand })).toBe('error: dev.cell rejected: no_hq (HQ not spawned)');

    expect(await run('reveal', {})).toContain('not_connected');
  });
});

describe('dev-console acceptance: cell 0 trickle rate', () => {
  it('Acceptance check: type cell 0 -> drops HQ cell to 0 and slows Grade to 3 E/s trickle rate', async () => {
    const host = new SimHost({ flags: ['W00', 'W01'] });
    host.load(createPlanet({ type: 'temperate', seed: 'console-acceptance', radius: 10 }));
    const hqId = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    const slot = rowOf(host.state.entities, hqId);

    const sendCommand = async (kind: string, args: unknown): Promise<CommandResult> => {
      host.submit({
        colonyIndex: 0,
        source: 'dev',
        commandId: 'cmd_cell_0',
        kind,
        args,
      });
      const res = host.step(1);
      const outcome = res.outcomes[0];
      return outcome?.code
        ? { ok: false, code: outcome.code }
        : { ok: true, appliedAtTick: outcome ? outcome.appliedAtTick : host.tick };
    };

    const out = await run('cell 0', { sendCommand });
    expect(out).toContain('dev.cell ok');

    // First tick after cell 0 draws the 0.6 E that recharged in that step, returning cell to 0
    const firstStep = stepTerraformWorkWithCell(host.state, slot, { baseTimeS: 3, totalEnergyE: 20 });
    expect(host.state.entities.cols.cell[slot]).toBe(0);
    expect(firstStep.energyDrawnE).toBeCloseTo(0.6, 5);
    expect(firstStep.progressDelta).toBeCloseTo(0.03, 5);

    // Remaining ticks at 3 E/s trickle rate (0.6 E/tick -> 0.03 progress/tick) total 34 ticks
    let trickleProgress = firstStep.progressDelta;
    let trickleTicks = 1;
    while (trickleProgress < 1 - 1e-6 && trickleTicks < 100) {
      host.step(1);
      const stepRes = stepTerraformWorkWithCell(host.state, slot, { baseTimeS: 3, totalEnergyE: 20 });
      expect(stepRes.energyDrawnE).toBeCloseTo(0.6, 5);
      expect(stepRes.progressDelta).toBeCloseTo(0.03, 5);
      expect(host.state.entities.cols.cell[slot]).toBe(0);
      trickleProgress += stepRes.progressDelta;
      trickleTicks++;
    }
    expect(trickleTicks).toBe(34);
    expect(trickleProgress).toBeGreaterThanOrEqual(1.0);
    expect(trickleTicks * 0.2).toBeCloseTo(6.8, 5);
  });
});
