import { ENTITY_STATE } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { REJECT_TEXT } from '../hud-min/rejectText';
import type { InspectableEntity } from './planner';
import { planPrimaryOp } from './primaryOps';

const ent = (kindName: string, extra: Partial<InspectableEntity> = {}): InspectableEntity => ({
  id: extra.id ?? 1, kind: kindName, kindName, owner: 0, q: 0, r: 0, hp: 100, hpMax: 100, footprintW: 1, footprintD: 1, state: ENTITY_STATE.active, ...extra,
});
const plan = (entities: InspectableEntity[], workerId?: number) =>
  planPrimaryOp('dismantle', { entities, colonyId: 0, workerId } as never, 0, 0);

describe('DISMANTLE preview uses the sim rule (owner bug W05: drones are never dismantled)', () => {
  it('a drone is refused with worded text, nothing is sent', () => {
    const p = plan([ent('builder', { id: 5 })]);
    expect(p.terraform).toBeNull();
    expect(p.outcome).toMatchObject({ ok: false, reason: 'cannot_dismantle_unit', status: REJECT_TEXT.cannot_dismantle_unit });
  });

  it('the selected worker standing on a building hex does not target itself: the building is the target', () => {
    const p = plan([ent('builder', { id: 5 }), ent('solar', { id: 6, footprintW: 2, footprintD: 2 })], 5);
    expect(p.outcome).toMatchObject({ ok: true, targetId: 6 });
  });

  it('a site under construction is refused as not finished', () => {
    const p = plan([ent('solar', { id: 6, state: ENTITY_STATE.constructing })]);
    expect(p.outcome).toMatchObject({ ok: false, reason: 'dismantle_unfinished', status: REJECT_TEXT.dismantle_unfinished });
  });

  it('the HQ Drone is still refused as HQ', () => {
    expect(plan([ent('hq', { id: 2 })]).outcome).toMatchObject({ ok: false, reason: 'cannot_dismantle_hq' });
  });
});
