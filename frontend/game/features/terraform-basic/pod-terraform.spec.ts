import { parseWaves } from '@terra/contracts';
import { ParticlePresetRegistry } from '@terra/render/particles';
import {
  buildPipeline,
  createPlanet,
  ENTITY_KIND,
  ENTITY_STATE,
  restore,
  SimHost,
  snapshot,
  spawnColony,
  view,
} from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { packView, unpackView } from '../../store/replica/viewCodec';
import { extractViewEntities, planTerraformTiles } from './planner';
import { planPrimaryOp } from './primaryOps';
import { workStatusText } from './workStatus';

function clientSnapshotOf(host: SimHost) {
  const { view: wire } = packView(view(restore(snapshot(host.state, { forClient: true }))), true);
  return unpackView(wire);
}

describe('Client TERRAFORM preview for landed drop pod', () => {
  it('plans TERRAFORM on a landed own pod pre-Hub and refuses descending/foreign pods', () => {
    const host = new SimHost(buildPipeline(parseWaves('..05').list, {}));
    host.load(createPlanet({ id: 'p1', seed: 'client-pod-tf', type: 'temperate', planetType: 'temperate', radius: 14 }));
    host.submit({
      commandId: 'spawn_0',
      colonyIndex: 0,
      source: 'system',
      kind: 'system.spawnColony',
      args: { colonyId: 'col_0', playerId: 'pl_0', name: 'Base' },
    });

    // While descending, TERRAFORM preview refuses the pod hex.
    host.step(1);
    const data = host.pipeline.config.data;
    const descRow = 0;
    expect(host.state.entities.cols.kind[descRow]).toBe(ENTITY_KIND.pod);
    expect(host.state.entities.cols.state[descRow]).toBe(ENTITY_STATE.descending);
    const pq = host.state.entities.cols.q[descRow]!;
    const pr = host.state.entities.cols.r[descRow]!;
    const descView = clientSnapshotOf(host);
    const descPlan = planPrimaryOp(
      'terraform',
      { view: descView as never, entities: extractViewEntities(descView as never), colonyId: 0, data },
      pq,
      pr,
    );
    expect(descPlan.terraform).toBeNull();
    expect(descPlan.outcome.ok).toBe(false);

    // Once landed, TERRAFORM preview accepts the pod hex and emits a work command.
    for (let i = 0; i < 40; i++) host.step(1);
    const landedView = clientSnapshotOf(host);
    const tfPreview = planTerraformTiles(landedView as never, [{ q: pq, r: pr }], { colonyId: 0, data });
    expect(tfPreview.jobs).toEqual([{ q: pq, r: pr, op: 'work' }]);

    const clickPlan = planPrimaryOp(
      'terraform',
      { view: landedView as never, entities: extractViewEntities(landedView as never), colonyId: 0, data },
      pq,
      pr,
    );
    expect(clickPlan.outcome.ok).toBe(true);
    expect(clickPlan.terraform).toMatchObject({ op: 'work', intent: 'terraform', tiles: [{ q: pq, r: pr }] });

    // Status line and particle target preset render cleanly for the pod terraform job.
    expect(
      workStatusText([
        { jobId: 'j1', colonyId: 0, workerEntityId: 2, mode: 'terraform', terrainKey: 'pod', q: pq, r: pr, progress: 0.5, status: 'in_progress' },
      ]),
    ).toBe(`TERRAFORM DROP POD (${pq},${pr}) 50%`);
    expect(ParticlePresetRegistry.resolveTargetKind({ terrainKey: 'pod', biomeKey: 'oceanForest' })).toBe('repair');

    // Foreign colony preview cannot target colony 0's pod.
    const foreignPreview = planTerraformTiles(landedView as never, [{ q: pq, r: pr }], { colonyId: 1, data });
    expect(foreignPreview.jobs).toEqual([]);
  });
});
