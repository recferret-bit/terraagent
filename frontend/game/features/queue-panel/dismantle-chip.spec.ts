import { describe, expect, it } from 'vitest';
import type { QueueEntry } from '@terra/sim';
import { dismantleJobOf } from '../landfall/selectionHelpers';
import { formatChipStatus, resolveChipTitleAndIcon } from './queueChipHelpers';

/** Owner feedback W03 #6: a dismantle is builder work the construction lane and the inspector show as it advances. */
const entry = (over: Partial<QueueEntry> = {}): QueueEntry => ({
  taskId: 'd1', colonyIndex: 0, lane: 'construction', precedence: 'player', state: 'in_progress',
  task: { kind: 'dismantle', entityId: 7, building: 'solar', q: 2, r: 1 },
  cost: {}, paid: false, progress: 0.42, buildTicks: 45, elapsedTicks: 19, workRate: 1, createdAt: 0, ...over,
});

describe('dismantle chip and inspector', () => {
  it('titles the chip by the building and shows "Dismantling n%" once a worker is on it', () => {
    expect(resolveChipTitleAndIcon(entry())).toEqual({ title: 'Dismantle Solar Array T1', icon: '⛏' });
    expect(formatChipStatus(entry())).toBe('Dismantling 42%');
    expect(formatChipStatus(entry({ waitReason: 'worker', waitDetail: 'waiting: worker (en route)' }))).toBe('waiting: worker (en route)');
  });

  it('finds the dismantle job of a building in the view (never a helper record)', () => {
    const view = {
      blobs: {
        workJobs: {
          byId: {
            d1: { mode: 'dismantle', targetEntityId: 7, progress: 0.3 },
            'd1+5': { mode: 'dismantle', targetEntityId: 9, helpOf: 'd1', progress: 0 },
          },
        },
      },
    };
    expect(dismantleJobOf(view, 7)).toEqual({ progress: 0.3 });
    expect(dismantleJobOf(view, 9)).toBeNull();
    expect(dismantleJobOf({}, 7)).toBeNull();
  });
});
