import { DEPOSIT } from '@terra/sim';
import { describe, expect, it, vi } from 'vitest';
import { depositResource } from '../shared/depositLabel';
import { bindResourceFoundToasts, resourceFoundText } from './resourceFound';

describe('Resource found toast (`resourceSpawned`, the 1 % deposit roll of a terraformed hex)', () => {
  it('names the resource and tier from the sim resources rows', () => {
    expect(depositResource(DEPOSIT.metals, 0)).toEqual({ key: 'metals.t1', label: 'Iron', tier: 1 });
    expect(depositResource('metals', 2)).toEqual({ key: 'metals.t2', label: 'Light Alloys', tier: 2 });
    expect(depositResource('oil', 3)?.key).toBe('bio.t3');
    expect(depositResource(0, 1)).toBeNull();
    expect(resourceFoundText({ deposit: 'minerals', tier: 2, q: 3, r: -1 })).toBe('Resource found: Rare Earths (T2) deposit at (3, -1)');
  });

  it("toasts only the player's colony events of that kind and unsubscribes", () => {
    let emit: (e: never[]) => void = () => undefined;
    const off = vi.fn();
    const store = {
      onServerEvents: (fn: (e: never[]) => void) => ((emit = fn), off),
      latest: { colonies: [{ index: 0, id: 'p0' }, { index: 1, id: 'p1' }] } as never,
    };
    const toast = vi.fn();
    const unbind = bindResourceFoundToasts(store, () => 1, toast);
    const ev = (colonyId: string, kind = 'resourceSpawned') =>
      ({ kind, colonyIds: [colonyId], data: { colonyId, q: 1, r: 2, deposit: 'metals', tier: 1 } }) as never;
    emit([ev('p0'), ev('p1', 'tilePrepared'), ev('p1')]);
    expect(toast.mock.calls).toEqual([['Resource found: Iron (T1) deposit at (1, 2)']]);
    unbind();
    expect(off).toHaveBeenCalled();
  });
});
