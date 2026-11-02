import { describe, expect, it, vi } from 'vitest';
import type { JournalEntry } from '@terra/ledger';
import { createPlanet, rowOf, SimHost, spawnHqUnit, stepTerraformWorkWithCell } from '@terra/sim';
import type { FeatureContext } from '../../core/registry';
import { CommandRunner } from '../../dev/console/runner';
import type { CommandResult } from '../../net/commandBus';
import { DevServerError, type LedgerReply } from '../../net/devServer';
import devConsole from './index';
import { formatEntry } from './ledger';

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
    expect(await run('grant metals 2.5', { sendCommand })).toBe('error: <n> must be a whole number, got "2.5"');
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('grant passes negative whole amounts through (withdraw)', async () => {
    const sendCommand = acking();
    await run('grant water -30', { sendCommand });
    expect(sendCommand).toHaveBeenCalledWith('dev.grant', { resource: 'bio.water', amount: -30 });
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
    // Tiles and ids are whole numbers: the console says so instead of sending a command the host rejects (FF-30)
    expect(await run('tp 1.5 2', { sendCommand })).toBe('error: <q> must be a whole number, got "1.5"');
    expect(await run('tp 1.5 2 3', { sendCommand })).toBe('error: <id> must be a whole number, got "1.5"');
    expect(sendCommand).toHaveBeenCalledTimes(2);
  });

  it('land sends dev.land with or without coords', async () => {
    const sendCommand = acking();
    const out = await run('land', { sendCommand });
    expect(out).toBe('dev.land ok, applied at tick 42');
    expect(sendCommand).toHaveBeenCalledWith('dev.land', {});

    await run('land 2 -4', { sendCommand });
    expect(sendCommand).toHaveBeenLastCalledWith('dev.land', { q: 2, r: -4 });
    // One coordinate used to land silently on the default slot (FF-30)
    expect(await run('land 5', { sendCommand })).toBe('error: land takes no coordinates or both <q> <r>');
    expect(await run('land 1 2.5', { sendCommand })).toBe('error: <r> must be a whole number, got "2.5"');
    expect(sendCommand).toHaveBeenCalledTimes(2);
  });

  it('grant accepts the one resource alias table (lower-cased one-word labels, FF-29)', async () => {
    const sendCommand = acking();
    for (const [alias, key] of [['metals', 'metals.t1'], ['minerals', 'minerals.t1'], ['biomass', 'bio.biomass'], ['water', 'bio.water']]) {
      await run(`grant ${alias} 5`, { sendCommand });
      expect(sendCommand).toHaveBeenLastCalledWith('dev.grant', { resource: key, amount: 5 });
    }
  });

  it('handles rejections and disconnected state', async () => {
    const sendCommand = acking({ ok: false, code: 'no_hq', detail: 'HQ not spawned' });
    expect(await run('cell 0', { sendCommand })).toBe('error: dev.cell rejected: no_hq (HQ not spawned)');

    expect(await run('reveal', {})).toContain('not_connected');
  });
});

const ledgerEntry = (seq: number, at: number, reason: string, actor: string, legs: JournalEntry['legs'], ref?: string): JournalEntry => ({
  seq,
  at,
  reason,
  actor,
  ...(ref ? { ref } : {}),
  legs,
});

/** What the host holds (server Postgres / browser host memory); the command only sees `LedgerReply`s for one account. */
const SAMPLE_BALANCES: Record<string, Record<string, number>> = {
  'colony:0': { 'metals.t1': 598, 'minerals.t1': 350, 'bio.t2': 0 },
  'colony:1': { 'metals.t1': 10 },
  'sys:cargo': { 'metals.t1': -600, 'minerals.t1': -350 },
  'sys:construction': { 'metals.t1': 2 },
  'sys:dev': { 'metals.t1': -10 },
};
const SAMPLE_JOURNAL: JournalEntry[] = [
  ledgerEntry(11, 0, 'landing.cargo', 'system:landing', [
    { account: 'colony:0', asset: 'metals.t1', delta: 600 },
    { account: 'sys:cargo', asset: 'metals.t1', delta: -600 },
    { account: 'colony:0', asset: 'minerals.t1', delta: 350 },
    { account: 'sys:cargo', asset: 'minerals.t1', delta: -350 },
  ]),
  ledgerEntry(12, 340, 'construction.spend', 'player:p1', [
    { account: 'colony:0', asset: 'metals.t1', delta: -2 },
    { account: 'sys:construction', asset: 'metals.t1', delta: 2 },
  ], 'order:7'),
  ledgerEntry(13, 345, 'dev.grant', 'dev:console', [
    { account: 'colony:1', asset: 'metals.t1', delta: 10 },
    { account: 'sys:dev', asset: 'metals.t1', delta: -10 },
  ]),
];

/** A host answering like `GET /v1/dev/planets/:planetId/ledger?account=&limit=` (last `limit` entries, oldest first). */
const hostQuery = () =>
  vi.fn(async (account: string, limit: number): Promise<LedgerReply> => ({
    planetId: 'pl_1',
    account,
    balances: { ...(SAMPLE_BALANCES[account] ?? {}) },
    entries: SAMPLE_JOURNAL.filter((e) => e.legs.some((l) => l.account === account)).slice(-limit),
  }));

describe('dev-console ledger command', () => {
  const owner = (i: number) => ({ getOwnerColonyIndex: () => i }) as unknown as FeatureContext['services']['landfall'];

  it('formats one entry per line with seq, tick, reason, actor, ref and signed legs', () => {
    expect(formatEntry(SAMPLE_JOURNAL[1]!)).toBe(
      '#12 t=340 construction.spend player:p1 order:7  colony:0 metals.t1 -2 · sys:construction metals.t1 +2',
    );
  });

  it("asks the host for the player's colony account and prints its non-zero balance", async () => {
    const ledgerQuery = hostQuery();
    const out = await run('ledger', { ledgerQuery });
    expect(ledgerQuery).toHaveBeenCalledWith('colony:0', 10);
    expect(out.split('\n')).toEqual([
      '#11 t=0 landing.cargo system:landing  colony:0 metals.t1 +600 · sys:cargo metals.t1 -600 · colony:0 minerals.t1 +350 · sys:cargo minerals.t1 -350',
      '#12 t=340 construction.spend player:p1 order:7  colony:0 metals.t1 -2 · sys:construction metals.t1 +2',
      'balance colony:0: metals.t1 598 · minerals.t1 350',
    ]);
    const other = await run('ledger', { ledgerQuery, landfall: owner(1) });
    expect(ledgerQuery).toHaveBeenLastCalledWith('colony:1', 10);
    expect(other).toBe('#13 t=345 dev.grant dev:console  colony:1 metals.t1 +10 · sys:dev metals.t1 -10\nbalance colony:1: metals.t1 10');
  });

  it('takes a count and an account, or the account alone', async () => {
    const ledgerQuery = hostQuery();
    expect((await run('ledger 1', { ledgerQuery })).split('\n')[0]).toMatch(/^#12 /);
    expect(ledgerQuery).toHaveBeenLastCalledWith('colony:0', 1);
    expect(await run('ledger 5 sys:construction', { ledgerQuery })).toBe(
      '#12 t=340 construction.spend player:p1 order:7  colony:0 metals.t1 -2 · sys:construction metals.t1 +2\nbalance sys:construction: metals.t1 2',
    );
    expect(ledgerQuery).toHaveBeenLastCalledWith('sys:construction', 5);
    expect(await run('ledger sys:dev', { ledgerQuery })).toMatch(/^#13 .*\nbalance sys:dev: metals.t1 -10$/);
    expect(await run('ledger 3 colony:9', { ledgerQuery })).toBe("no entries for colony:9 in the host's journal\nbalance colony:9: (empty)");
  });

  it('rejects a bad count, a page without a host ledger and a failing host', async () => {
    const ledgerQuery = hostQuery();
    expect(await run('ledger 1.5', { ledgerQuery })).toBe('error: <n> must be a whole number, got "1.5"');
    expect(await run('ledger 0', { ledgerQuery })).toBe('error: <n> must be at least 1');
    expect(ledgerQuery).not.toHaveBeenCalled();
    expect(await run('ledger', {})).toContain('host_unavailable');
    const down = vi.fn(async () => { throw new DevServerError('not_found', '404 no such planet'); });
    expect(await run('ledger', { ledgerQuery: down })).toContain('not_found');
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
