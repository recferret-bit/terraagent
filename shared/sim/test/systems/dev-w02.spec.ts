import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  familyStock,
  getColonyPower,
  insertRow,
  step,
  type SimCommand,
} from '../../src';

let n = 0;
const cmd = (kind: string, args: unknown = {}, colonyIndex: number | null = 0): SimCommand => ({
  commandId: `cmd_${++n}`,
  colonyIndex,
  source: 'dev',
  kind,
  args,
});

function createSetup() {
  const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02', radius: 8 });
  state.colonies.push({
    index: 0,
    id: 'col-0',
    name: 'Alpha',
    color: 0xff6b00,
    status: 'active',
    changedAt: 0,
  });
  const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });

  // Spawn completed Command Hub T1 at (0, 0)
  const hubRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
  state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
  state.entities.cols.owner[hubRow] = 0;
  state.entities.cols.q[hubRow] = 0;
  state.entities.cols.r[hubRow] = 0;
  state.entities.cols.footprintW[hubRow] = 3;
  state.entities.cols.footprintD[hubRow] = 3;
  state.entities.cols.hp[hubRow] = 1500;
  state.entities.cols.hpMax[hubRow] = 1500;
  state.entities.cols.state[hubRow] = ENTITY_STATE.active;

  // Spawn Solar Collector T1 at (3, 0) attached to Hub
  const solarRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
  state.entities.cols.kind[solarRow] = ENTITY_KIND.solar;
  state.entities.cols.owner[solarRow] = 0;
  state.entities.cols.q[solarRow] = 3;
  state.entities.cols.r[solarRow] = 0;
  state.entities.cols.footprintW[solarRow] = 2;
  state.entities.cols.footprintD[solarRow] = 2;
  state.entities.cols.hp[solarRow] = 300;
  state.entities.cols.hpMax[solarRow] = 300;
  state.entities.cols.state[solarRow] = ENTITY_STATE.active;

  return { state, pipeline };
}

describe('W02-30 dev.time and dev.skipnight', () => {
  it('acceptance check: dev.time 18:00 causes night to fall and solar drops to 0', () => {
    const { state, pipeline } = createSetup();

    // Initial step: daytime
    step(state, [], 1, pipeline);
    const initialPower = getColonyPower(state, 0);
    expect(initialPower.phase).toBe('day');
    expect(initialPower.daylight).toBe(1);
    expect(initialPower.solarGrossPerS).toBe(21);
    expect(initialPower.solarNetPerS).toBe(20);

    // dev.time -> 18:00
    const res = step(state, [cmd('dev.time', { target: '18:00' })], 1, pipeline);
    expect(res.outcomes[0].code).toBeUndefined();

    const env = state.blobs.environment?.value as { phase: string; clockText: string; daylight: number };
    expect(env.phase).toBe('night');
    expect(env.clockText).toBe('18:00');
    expect(env.daylight).toBe(0);

    const nightPower = getColonyPower(state, 0);
    expect(nightPower.phase).toBe('night');
    expect(nightPower.clockText).toBe('18:00');
    expect(nightPower.daylight).toBe(0);
    expect(nightPower.solarGrossPerS).toBe(0);
    expect(nightPower.solarNetPerS).toBe(-1);
  });

  it('skipnight jumps back to 06:00 sunrise (daylight = 1.0, solarGross = 21, solarNet = 20)', () => {
    const { state, pipeline } = createSetup();

    // First jump to night 18:00
    step(state, [cmd('dev.time', { target: '18:00' })], 1, pipeline);
    expect(getColonyPower(state, 0).phase).toBe('night');

    // Now skip night
    const res = step(state, [cmd('dev.skipnight', {})], 1, pipeline);
    expect(res.outcomes[0].code).toBeUndefined();

    const env = state.blobs.environment?.value as { phase: string; clockText: string; daylight: number };
    expect(env.phase).toBe('day');
    expect(env.clockText).toBe('06:00');
    expect(env.daylight).toBe(1);

    const morningPower = getColonyPower(state, 0);
    expect(morningPower.phase).toBe('day');
    expect(morningPower.clockText).toBe('06:00');
    expect(morningPower.daylight).toBe(1);
    expect(morningPower.solarGrossPerS).toBe(21);
    expect(morningPower.solarNetPerS).toBe(20);
  });
});

describe('W02-30 dev.fill and dev.power', () => {
  it('fill metals.t1 and fill all fill stock to family cap (500)', () => {
    const { state, pipeline } = createSetup();
    const colony = state.colonies[0];

    // 1. Fill specific resource key
    step(state, [cmd('dev.fill', { res: 'metals.t1' })], 1, pipeline);
    const c1 = ensureColonyLedger(colony);
    expect(c1.stock['metals.t1']).toBe(500);
    expect(familyStock(colony, 'metals')).toBe(500);
    expect(familyStock(colony, 'minerals')).toBe(0);
    expect(familyStock(colony, 'bio')).toBe(0);

    // 2. Fill family with amount
    step(state, [cmd('dev.fill', { res: 'minerals', amount: 200 })], 1, pipeline);
    const c2 = ensureColonyLedger(colony);
    expect(c2.stock['minerals.t1']).toBe(200);
    expect(familyStock(colony, 'minerals')).toBe(200);

    // 3. Fill all fills all families to cap (500)
    step(state, [cmd('dev.fill', { res: 'all' })], 1, pipeline);
    expect(familyStock(colony, 'metals')).toBe(500);
    expect(familyStock(colony, 'minerals')).toBe(500);
    expect(familyStock(colony, 'bio')).toBe(500);
  });

  it('power command evaluates power and emits dev.powerDump event', () => {
    const { state, pipeline } = createSetup();

    const res = step(state, [cmd('dev.power', { colonyIndex: 0 })], 1, pipeline);
    expect(res.outcomes[0].code).toBeUndefined();

    const dumpEvent = res.events.find((e) => e.kind === 'dev.powerDump');
    expect(dumpEvent).toBeDefined();
    expect(dumpEvent?.colonyIds).toEqual([0]);
    expect(dumpEvent?.data).toMatchObject({
      colonyIndex: 0,
      hasHub: true,
      founderCorePerS: 8,
      solarGrossPerS: 21,
      solarNetPerS: 20,
      supply: 28,
      demand: 5,
      net: 23,
      brownout: false,
    });
  });
});
