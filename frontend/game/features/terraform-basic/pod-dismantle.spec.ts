import { ENTITY_STATE } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { findEntityAtTile, type InspectableEntity } from './planner';
import { planPrimaryOp } from './primaryOps';

const ent = (kindName: string, extra: Partial<InspectableEntity> = {}): InspectableEntity => ({
  id: extra.id ?? 1, kind: kindName, kindName, owner: 0, q: 0, r: 0, hp: 100, hpMax: 100, footprintW: 1, footprintD: 1, ...extra,
});

describe('pod wreck dismantle (client)', () => {
  const pod = ent('pod', { id: 1 });
  const hq = ent('hq', { id: 2 });

  it('pods are skipped by default (REPAIR / TERRAFORM) and found when asked, ranked before the HQ on the same hex', () => {
    expect(findEntityAtTile([pod, hq], 0, 0, 0)?.kindName).toBe('hq');
    expect(findEntityAtTile([hq, pod], 0, 0, 0, true)?.kindName).toBe('pod');
    expect(findEntityAtTile([pod, ent('harvester', { id: 3 })], 0, 0, 0, true)?.kindName).toBe('harvester');
  });

  it('DISMANTLE of the pod is refused until a Hub is built, then ordered with no refund', () => {
    const before = planPrimaryOp('dismantle', { entities: [pod, hq], colonyId: 0 } as never, 0, 0);
    expect(before.terraform).toBeNull();
    expect(before.outcome).toMatchObject({ ok: false, reason: 'pod_needed' });
    const hub = ent('commandHub', { id: 4, q: 3, r: 0, state: ENTITY_STATE.active, footprintW: 3, footprintD: 3 });
    const after = planPrimaryOp('dismantle', { entities: [pod, hq, hub], colonyId: 0 } as never, 0, 0);
    expect(after.terraform).toEqual({ op: 'dismantle', tiles: [{ q: 0, r: 0 }] });
    expect(after.outcome).toMatchObject({ ok: true, targetId: 1, refund: {} });
  });
});
