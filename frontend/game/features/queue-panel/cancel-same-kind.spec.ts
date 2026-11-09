import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import type { FeatureContext, GameView } from '../../core/registry/types';
import { installMockDocument } from '../test-dom';
import { QueuePanel } from './QueuePanel';

const order = (id: string, q: number) => ({
  orderId: id,
  taskId: id,
  colonyId: 0,
  op: 'grade',
  jobs: [{ q, r: 0, op: 'grade', progress: 0, baseTimeS: 1, totalEnergyE: 0, energyDrawnE: 0 }],
  skippedCount: 0,
  totalJobs: 1,
  completedJobs: 0,
  isLinkedPrep: false,
});

describe('queue panel: the cancel click ends every order of the same kind', () => {
  let restoreDoc: (() => void) | null = null;
  beforeEach(() => {
    restoreDoc = installMockDocument();
  });
  afterEach(() => {
    restoreDoc?.();
    restoreDoc = null;
  });

  it('three terraform orders: one click sends cancelTask with scope sameKind and clears the lane', () => {
    const commands: Array<{ kind: string; args: unknown }> = [];
    const ctx: FeatureContext = {
      flags: new Set(parseWaves('..03').list),
      host: 'server',
      services: {
        track: () => {},
        async sendCommand(kind: string, args?: unknown) {
          commands.push({ kind, args });
          return { ok: true as const, appliedAtTick: 1 };
        },
      },
    };
    const host = document.createElement('div');
    const panel = new QueuePanel(host, ctx);
    const view = { blobs: { terraformTasks: { byColony: { 0: [order('tf#1', 1), order('tf#2', 2), order('tf#3', 3)] } } } } as unknown as GameView;
    panel.update(view);
    expect(panel.getEntries('terraform')).toHaveLength(3);
    const btn = host.querySelector('[data-cancel-task="tf#2"]') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    btn?.click();
    expect(commands).toEqual([{ kind: 'cancelTask', args: { taskId: 'tf#2', scope: 'sameKind' } }]);
    expect(panel.getEntries('terraform')).toHaveLength(0);
    panel.dispose();
  });
});
