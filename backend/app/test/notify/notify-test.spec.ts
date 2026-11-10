import { describe, expect, it, vi } from 'vitest';
import { routeDevAttack } from '../../src/notify/notify-test';

const COLONY = 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('dev notify test route', () => {
  it('asks the alert router for one under_attack', async () => {
    const route = vi.fn(async () => ({ sent: 1 }));
    const out = await routeDevAttack({ route }, { colonyId: COLONY, planetId: 'pl_dev', tick: 3 }, 50);
    expect(out).toEqual({ kind: 'under_attack', colonyId: COLONY, sent: 1 });
    expect(route).toHaveBeenCalledWith({
      kind: 'under_attack',
      colonyId: COLONY,
      planetId: 'pl_dev',
      tick: 3,
      eventId: `dev:under_attack:${COLONY}:50`,
      nowMs: 50,
    });
  });
});
