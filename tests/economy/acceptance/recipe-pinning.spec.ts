import { parseWaves, type ResourceKey } from '@terra/contracts';
import {
  applyEnvironmentState, compileData, createRegistryPipeline, createState, creditResource, ensureColonyLedger, ENTITY_KIND, ENTITY_STATE, environmentFromPlanetTime,
  getColonyPrestige, getColonyStock, insertRow, setPlanetTime, step, type SimCommand, type CompiledData,
} from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { FLAGS, WAVES, baseline, candidateOf } from './support';

/**
 * W13-49 acceptance (1), sim half: a recipe patch (the prestige project input) compiled into a candidate profile changes new
 * prestige jobs only; a job that already started keeps the data hash it was priced with, also after the live data swap and after rollback.
 */
const patch = { schemaVersion: 1, requestId: 'acc-1', expectedVersion: 1, ops: [{ op: 'set', path: 'prestige.project.survey_array.cost', value: { 'metals.t1': 100, 'minerals.t1': 40, 'bio.water': 30, 'minerals.t2': 8 } }] };
const candidate = candidateOf(patch);
const dataOf = (p: { overrides: unknown }): CompiledData => compileData(new Set(FLAGS), p.overrides as never);
const RICH: Partial<Record<ResourceKey, number>> = { 'metals.t1': 400, 'minerals.t1': 300, 'bio.water': 200, 'minerals.t2': 40, 'bio.biomass': 100 };
const PROJECT_TICKS = 600;

function colony() {
  const flags = parseWaves(WAVES);
  const state = createState({ planetId: 'p-w13-49', planetType: 'temperate', seed: 'w13-49', radius: 10 });
  const base = dataOf(baseline);
  setPlanetTime(state, { timeOfDay: 12 }, 0, base);
  applyEnvironmentState(state, environmentFromPlanetTime(state, base, false, 0), 0);
  state.colonies[0] = { index: 0, id: 'col_0', name: 'A', color: 0xff6b00, status: 'active', changedAt: 0 };
  const col = ensureColonyLedger(state.colonies[0]);
  for (const [k, v] of Object.entries(RICH)) creditResource(col, k as ResourceKey, v, 0);
  const put = (kind: number, q: number, r: number, w: number, d: number, hp: number, shed: number): void => {
    const cols = state.entities.cols;
    const row = insertRow(state.entities, state.meta.nextEntityId++, 0);
    cols.kind[row] = kind; cols.owner[row] = 0; cols.tier[row] = 1; cols.q[row] = q; cols.r[row] = r;
    cols.footprintW[row] = w; cols.footprintD[row] = d; cols.shedGroup[row] = shed; cols.hp[row] = hp; cols.hpMax[row] = hp;
    cols.state[row] = ENTITY_STATE.active;
  };
  put(ENTITY_KIND.commandHub, 0, 0, 3, 3, 1500, 4);
  put(ENTITY_KIND.solar, 3, 0, 2, 2, 400, 4);
  put(ENTITY_KIND.solar, 0, 3, 2, 2, 400, 4);
  put(ENTITY_KIND.solar, 3, -3, 2, 2, 400, 4);
  let pipeline = createRegistryPipeline({ flags, data: base });
  return {
    state,
    useData: (data: CompiledData): void => { pipeline = createRegistryPipeline({ flags, data }); },
    run: (cmds: SimCommand[] = []): string[] => step(state, cmds, 1, pipeline).outcomes.map((o) => o.code ?? 'ok'),
  };
}
const enqueue = (id: string): SimCommand => ({ commandId: id, kind: 'enqueueTask', colonyIndex: 0, source: 'player', args: { project: { project: 'project.survey_array' } } }) as SimCommand;
const queue = (s: ReturnType<typeof colony>['state']) => s.colonies[0]!.unitQueue as Array<{ pinned?: { dataHash: string } }>;
const metals = (s: ReturnType<typeof colony>['state']): number => getColonyStock(s, 0)['metals.t1'];

describe('recipe change reaches new jobs only; a started job keeps its pinned data hash', () => {
  it('the patched candidate has its own data hash and a different recipe', () => {
    expect(candidate.dataHash).not.toBe(baseline.dataHash);
    expect((dataOf(candidate).tables.prestige as unknown as Record<string, { cost: Record<string, number> }>)['project.survey_array']!.cost['metals.t1']).toBe(100);
  });

  it('job 1 starts on the baseline recipe, the live swap happens mid-job, it still finishes at the baseline price; job 2 pays the new price', () => {
    const t = colony();
    const start = metals(t.state);
    expect(t.run([enqueue('j1')])).toEqual(['ok']);
    for (let i = 0; i < 100; i++) t.run();
    expect(queue(t.state)[0]!.pinned?.dataHash).toBe(baseline.dataHash);
    t.useData(dataOf(candidate)); // activation applied to the host
    for (let i = 0; i < PROJECT_TICKS; i++) t.run();
    expect(getColonyPrestige(t.state, 0).completed).toBe(1);
    expect(start - metals(t.state)).toBe(60); // baseline recipe, not 100
    const afterFirst = metals(t.state);
    expect(t.run([enqueue('j2')])).toEqual(['ok']);
    expect(queue(t.state)[0]!.pinned?.dataHash).toBe(candidate.dataHash);
    for (let i = 0; i < PROJECT_TICKS + 5; i++) t.run();
    expect(afterFirst - metals(t.state)).toBe(100);
    expect(getColonyPrestige(t.state, 0).completed).toBe(2);
  });

  it('rollback restores the baseline recipe for new jobs; the job started under the candidate keeps the candidate hash and price', () => {
    const t = colony();
    t.useData(dataOf(candidate));
    const start = metals(t.state);
    t.run([enqueue('j1')]);
    for (let i = 0; i < 100; i++) t.run();
    t.useData(dataOf(baseline)); // rollback
    expect(queue(t.state)[0]!.pinned?.dataHash).toBe(candidate.dataHash);
    for (let i = 0; i < PROJECT_TICKS; i++) t.run();
    expect(start - metals(t.state)).toBe(100);
    const mid = metals(t.state);
    t.run([enqueue('j2')]);
    expect(queue(t.state)[0]!.pinned?.dataHash).toBe(baseline.dataHash);
    for (let i = 0; i < PROJECT_TICKS + 5; i++) t.run();
    expect(mid - metals(t.state)).toBe(60);
  });
});
