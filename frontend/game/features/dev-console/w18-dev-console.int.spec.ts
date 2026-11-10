import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  colonyHasAliveHq,
  colonyHasAliveHub,
  createRegistryPipeline,
  createState,
  ensureColonyLedger,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  getColonyQueue,
  insertRow,
  PREP,
  readDiplomacyBlob,
  SimHost,
  spawnHqUnit,
  TERRAIN,
} from '@terra/sim';
import type { FeatureContext } from '../../core/registry';
import { CommandRunner } from '../../dev/console/runner';
import type { CommandResult } from '../../net/commandBus';
import devConsole from './index';

function createHostHarness(waves = '..18') {
  const flags = parseWaves(waves);
  const pipeline = createRegistryPipeline({ flags });
  const host = new SimHost(pipeline);
  const state = createState({
    planetId: 'pl-w18-dev-int',
    planetType: 'temperate',
    seed: 'w18-dev-int',
    radius: 14,
  });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.prepared);

  const col0 = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
  col0.id = 'col_0';
  col0.status = 'active';
  col0.stock['metals.t1'] = 600;
  col0.stock['minerals.t1'] = 600;
  col0.stock['bio.biomass'] = 300;
  col0.stock['bio.water'] = 300;

  const hubId = state.meta.nextEntityId++;
  const hubRow = insertRow(state.entities, hubId, 0);
  state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
  state.entities.cols.owner[hubRow] = 0;
  state.entities.cols.q[hubRow] = 0;
  state.entities.cols.r[hubRow] = 0;
  state.entities.cols.hp[hubRow] = 1500;
  state.entities.cols.hpMax[hubRow] = 1500;
  state.entities.cols.state[hubRow] = ENTITY_STATE.active;
  state.entities.cols.footprintW[hubRow] = 3;
  state.entities.cols.footprintD[hubRow] = 3;
  col0.hubEntityId = hubId;

  const hqId = spawnHqUnit(state, { owner: 0, q: 4, r: 0, tick: 0 });

  const col1 = ensureColonyLedger(ensureColonyRecord(state, 1, 0));
  col1.id = 'col_1';
  col1.status = 'active';

  host.load(state);

  let cmdCounter = 0;
  const sendCommand = async (kind: string, args: unknown): Promise<CommandResult> => {
    cmdCounter++;
    host.submit({
      commandId: `cmd_${cmdCounter}`,
      colonyIndex: 0,
      source: 'dev',
      kind,
      args,
    });
    const res = host.step(1);
    const outcome = res.outcomes[0];
    if (outcome?.code) {
      return { ok: false, code: outcome.code, detail: outcome.detail };
    }
    return { ok: true, appliedAtTick: outcome ? outcome.appliedAtTick : host.tick };
  };

  const ctx: FeatureContext = {
    flags: new Set(flags.list),
    host: 'server',
    services: {
      track: () => {},
      sendCommand,
      colonyId: 0,
    } as FeatureContext['services'],
  };

  const runner = new CommandRunner([devConsole], ctx);

  return { host, state, runner, hubId, hqId };
}

describe('W18-25 CommandRunner + SimHost integration', () => {
  it('running killHq in CommandRunner destroys colony 0 HQ in SimHost and queues HQ reprint', async () => {
    const { state, runner } = createHostHarness('..18');

    expect(colonyHasAliveHq(state, 0)).toBe(true);

    const out = await runner.run('killHq');
    expect(out?.kind).toBe('text');
    expect((out as { text: string }).text).toMatch(/^dev\.killHq ok, applied at tick \d+$/);

    expect(colonyHasAliveHq(state, 0)).toBe(false);

    const unitsQueue = getColonyQueue(state, 0, 'units');
    expect(unitsQueue.length).toBe(1);
    expect(unitsQueue[0].task).toEqual({ kind: 'buildUnit', unit: 'hq', tier: 1, count: 1 });
    expect(unitsQueue[0].buildTicks).toBe(300);
  });

  it('running offerTruce 1 6 in CommandRunner creates a pending truce offer from colony 1 to colony 0 in SimHost', async () => {
    const { state, runner } = createHostHarness('..18');

    const out = await runner.run('offerTruce 1 6');
    expect(out?.kind).toBe('text');
    expect((out as { text: string }).text).toMatch(/^dev\.offerTruce ok, applied at tick \d+$/);

    const blob = readDiplomacyBlob(state);
    const pendingOffers = Object.values(blob.offers).filter(
      (o) => o.fromColony === 1 && o.toColony === 0 && o.status === 'pending',
    );
    expect(pendingOffers.length).toBe(1);
    expect(pendingOffers[0].hours).toBe(6);
    expect(pendingOffers[0].durationHours).toBe(6);
  });

  it('running setShield 0 and killHub execute against SimHost and return ok, applied at tick ...', async () => {
    const { state, runner } = createHostHarness('..18');

    const outShield = await runner.run('setShield 0');
    expect(outShield?.kind).toBe('text');
    expect((outShield as { text: string }).text).toMatch(/^dev\.setShield ok, applied at tick \d+$/);

    expect(colonyHasAliveHub(state, 0)).toBe(true);

    const outKillHub = await runner.run('killHub');
    expect(outKillHub?.kind).toBe('text');
    expect((outKillHub as { text: string }).text).toMatch(/^dev\.killHub ok, applied at tick \d+$/);

    expect(colonyHasAliveHub(state, 0)).toBe(false);
  });
});
