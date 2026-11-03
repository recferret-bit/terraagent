// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CommandDock } from '../../core/hud/CommandDock';
import { colonyWorkJobs, workStatusText } from './workStatus';
import { mountTerraformBasic } from './index';

const job = (over: Record<string, unknown>) => ({
  jobId: 'cm_1', colonyId: 0, mode: 'terraform', terrainKey: 'forest', q: 3, r: 1, progress: 0.4, status: 'in_progress',
  chain: true, chainSeq: 0, ...over,
});
const viewWith = (byId: Record<string, unknown>) => ({ blobs: { workJobs: { byId } } }) as never;

describe('TERRAFORM status line reads the colony work jobs (blobs.workJobs)', () => {
  it('own jobs only; chain hex, progress, waiting reason and other busy workers', () => {
    const view = viewWith({
      a: job({ jobId: 'cm_1~2', chainSeq: 2 }),
      b: job({ jobId: 'x', colonyId: 1 }),
      c: job({ jobId: 'cm_2', mode: 'repair', q: 0, r: 0, progress: 1, status: 'waiting', waitReason: 'resources' }),
    });
    const jobs = colonyWorkJobs(view, 0);
    expect(jobs.map((j) => j.jobId)).toEqual(['cm_1~2', 'cm_2']);
    expect(workStatusText(jobs)).toBe('TERRAFORM TREES (3,1) 40% · hex 3 · +1 more');
    expect(workStatusText([jobs[1]!])).toBe('REPAIR (0,0) 100% · waiting (resources)');
    expect(workStatusText([])).toBeNull();
  });

  it('the menu shows the running chain, then that it ended', () => {
    const container = document.createElement('div');
    const tf = mountTerraformBasic(container, { sendCommand: () => undefined });
    const status = container.querySelector('[data-testid="tf-status"]')!;
    tf.strokeTile(3, 1);
    expect(status.textContent).toMatch(/^Terraform ordered/);
    tf.update(viewWith({ a: job({}) }));
    expect(status.textContent).toBe('TERRAFORM TREES (3,1) 40% · hex 1');
    tf.update(viewWith({}));
    expect(status.textContent).toMatch(/^Terraform chain ended/);
    tf.dispose();
  });
});

describe('Command dock gating', () => {
  it('G / R / Z arm only while the Terraform tab is open; closing the tab disarms the tool', () => {
    const slot = document.createElement('div');
    document.body.appendChild(slot);
    const dock = new CommandDock(slot, {} as never, new Set(['build', 'terraform'] as const));
    const tf = mountTerraformBasic(dock.containerFor('terraform'), {});
    const press = (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    for (const key of ['g', 'r', 'z']) press(key); // the Build tab is active
    expect(tf.isArmed()).toBe(false);
    dock.selectTab('terraform');
    dock.setCollapsed(true);
    press('g');
    expect(tf.isArmed()).toBe(false);
    dock.setCollapsed(false);
    press('z');
    expect([tf.isArmed(), tf.getSelectedOp()]).toEqual([true, 'dismantle']);
    dock.selectTab('build');
    tf.update({});
    expect(tf.isArmed()).toBe(false);
    tf.dispose();
    dock.dispose();
    slot.remove();
  });
});

describe('REPAIR / TERRAFORM status while the worker chains', () => {
  it('REPAIR by a chaining worker says it comes after the current hex; TERRAFORM says it replaces the chain', async () => {
    const { planPrimaryOp } = await import('./primaryOps');
    const entities = [
      { id: 2, kind: 'hq', kindName: 'hq', owner: 0, q: 0, r: 0, hp: 200, hpMax: 200, footprintW: 1, footprintD: 1 },
      { id: 3, kind: 'solar', kindName: 'solar', owner: 0, q: 4, r: 4, hp: 100, hpMax: 400, footprintW: 2, footprintD: 2 },
    ];
    const view = viewWith({ a: job({ workerEntityId: 2 }) });
    const ctx = { view, entities, colonyId: 0, workerId: 2 };
    expect(planPrimaryOp('repair', ctx, 4, 4).outcome.status).toMatch(/after the current hex; the terraform chain resumes after$/);
    expect(planPrimaryOp('terraform', ctx, 7, 7).outcome.status).toMatch(/\(replaces the worker's chain\)$/);
    expect(planPrimaryOp('repair', { ...ctx, workerId: 9 }, 4, 4).outcome.status).toBe('Repair ordered (40% base cost for full repair)');
  });
});
