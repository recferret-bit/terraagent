import { expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  applyDiff, createRegistryPipeline, createState, decodeDiff, FaunaMotionReplica, getMotion,
  issueUnitCommand, restore, rowOf, SimHost, spawnFaunaBug, spawnHqUnit, TERRAIN,
} from '../../src';
import { makeDirectiveStepCtx } from '../../src/systems/fauna/directivePayloads';

function fixture() {
  const host = new SimHost(createRegistryPipeline({ flags: parseWaves('..07') }));
  const state = createState({ planetId: 'pressure', planetType: 'temperate', seed: 'pressure', radius: 64 });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  host.load(state);
  const units = Array.from({ length: 80 }, (_, i) => spawnHqUnit(state, { owner: 0, q: -35, r: i % 5 }));
  const bug = spawnFaunaBug(state, { species: 'blackAnt', q: -20, r: -5 }, 0, host.pipeline.config.data);
  const orders = (reverse = false) => {
    const ctx = makeDirectiveStepCtx(state, host.tick, host.pipeline.config.data);
    units.forEach((id, i) => issueUnitCommand(state, rowOf(state.entities, id),
      { kind: 'move', source: 'player', q: reverse ? -35 : 35, r: i % 5 }, ctx));
    issueUnitCommand(state, rowOf(state.entities, bug), { kind: 'move', source: 'player', q: reverse ? -20 : 20, r: -5 }, ctx);
  };
  return { host, state, bug, orders };
}

it.each([[false, 1], [true, 1], [false, 3], [true, 3]] as const)('reconstructs fauna while colony paths consume the shared budget (orders after welcome=%s, batch=%s)', (afterWelcome, batch) => {
  const { host, state, bug, orders } = fixture();
  if (!afterWelcome) { orders(); host.step(1); expect(getMotion(state, bug)?.status).toBe('pending'); }
  const client = restore(host.snapshot({ forClient: true }));
  const replica = new FaunaMotionReplica();
  const data = host.pipeline.config.data;
  replica.welcome(client, data);
  if (afterWelcome) orders();
  let routeFrames = 0, omittedFrames = 0;
  for (let i = 0; i < 16; i++) {
    const from = host.tick;
    for (let tick = 0; tick < batch; tick++) host.step(1);
    const bytes = host.diffSince(from, { forClient: true });
    const diff = decodeDiff(bytes);
    if (diff.faunaMotion) routeFrames++;
    if (!Array.from(diff.entities.cols.id).includes(bug)) omittedFrames++;
    applyDiff(client, bytes);
    replica.apply(bytes, client, data);
    const sr = rowOf(state.entities, bug), cr = rowOf(client.entities, bug);
    expect([client.entities.cols.x[cr], client.entities.cols.y[cr]], `tick ${host.tick}`).toEqual([state.entities.cols.x[sr], state.entities.cols.y[sr]]);
  }
  expect(routeFrames).toBeGreaterThan(0);
  expect(routeFrames).toBeLessThan(5);
  expect(omittedFrames).toBeGreaterThan(10);
});

it('route cancellation and arrival replace the pending route without resurrecting its command', () => {
  const { host, state, bug, orders } = fixture();
  orders(); host.step(1);
  const client = restore(host.snapshot({ forClient: true }));
  const replica = new FaunaMotionReplica();
  const data = host.pipeline.config.data;
  replica.welcome(client, data);
  for (let i = 0; i < 14; i++) {
    const ctx = makeDirectiveStepCtx(state, host.tick + 1, data);
    if (i === 0) issueUnitCommand(state, rowOf(state.entities, bug), { kind: 'stop', source: 'player' }, ctx);
    if (i === 2) issueUnitCommand(state, rowOf(state.entities, bug), { kind: 'move', source: 'player', q: -19, r: -5 }, ctx);
    const from = host.tick;
    host.step(1);
    const bytes = host.diffSince(from, { forClient: true });
    applyDiff(client, bytes);
    replica.apply(bytes, client, data);
    const sr = rowOf(state.entities, bug), cr = rowOf(client.entities, bug);
    expect([client.entities.cols.x[cr], client.entities.cols.y[cr]], `cancel/arrival tick ${host.tick}`).toEqual([state.entities.cols.x[sr], state.entities.cols.y[sr]]);
  }
  expect(getMotion(client, bug)).toBeNull();
});
