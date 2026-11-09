import { parseWaves, type ServerMessage } from '@terra/contracts';
import { createRegistryPipeline, createState, ensureColonyRecord, SimHost, SIM_VERSION, spawnHiveEntity, spawnHqUnit, TERRAIN, type SimView } from '@terra/sim';
import { LocalHostCore } from '../local/LocalHostCore';
import { memorySnapshotStore } from '../local/snapshotStore';
import { SimWorkerController } from '../worker/SimWorkerController';

export const faunaPoses = (view: SimView) => view.entities.filter(e => e.kind >= 60 && e.kind <= 62)
  .map(e => [e.id, e.x, e.y, e.rot, e.hp, e.state]);

/** Exercises the real worker with prediction disabled and no render-side intervention. */
export function faunaWireFixture(mode: 'server' | 'local', joinedAt = 0, withColony = false) {
  const flags = parseWaves('..07');
  const host = new SimHost(createRegistryPipeline({ flags }));
  const state = createState({ planetId: 'fauna-wire', planetType: 'temperate', seed: 'fauna-wire', radius: 24 });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  host.load(state);
  spawnHiveEntity(state, { species: 'blackAnt', q: 0, r: 0, initialResidents: 3 }, 0, host.pipeline.config.data);
  if (withColony) {
    ensureColonyRecord(state, 0, 0).status = 'active';
    spawnHqUnit(state, { owner: 0, q: -12, r: 0 });
  }
  for (let tick = 0; tick < joinedAt; tick++) host.step(1);
  const worker = new SimWorkerController(() => {});
  worker.handle({ t: 'init', flags: [...flags.list], predict: false });
  const accept = (m: ServerMessage) => {
    if (m.t === 'welcome') worker.handle({ t: 'welcome', state: m.d.state, tick: m.d.tick,
      flags: [...m.d.flags], dataHash: m.d.dataHash, simVersion: m.d.simVersion });
    if (m.t === 'delta') worker.handle({ ...m.d, t: 'delta' });
  };
  const welcome = () => worker.handle({ t: 'welcome', state: host.snapshot({ forClient: true }), tick: host.tick,
    flags: [...flags.list], dataHash: host.pipeline.config.data.hash, simVersion: SIM_VERSION });
  const local = mode === 'local' ? LocalHostCore.open({ name: 'fauna-wire', seed: () => ({ host, setupPostings: [] }) }, flags.list,
    { now: () => 0, wallMs: () => 0, schedule: () => () => {}, store: memorySnapshotStore() },
    m => { if (m.t === 'server') accept(m.msg); }) : null;
  if (local) local.handle({ t: 'client', msg: { t: 'join', d: { planetId: host.state.meta.planetId } } });
  else welcome();
  return {
    host, worker, welcome,
    step(ticks = 1) {
      if (local) local.advance(ticks);
      else {
        const fromTick = host.tick;
        for (let i = 0; i < ticks; i++) host.step(1);
        worker.handle({ t: 'delta', fromTick, toTick: host.tick, diff: host.diffSince(fromTick, { forClient: true }) });
      }
    },
    close: () => local?.stop() ?? Promise.resolve(),
  };
}
