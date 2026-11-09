import 'reflect-metadata';
import { createPlanet, getOpenColonyGoals, queueColonyGoal } from '@terra/sim';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { DeedMintOutboxService } from '../../src/near/deed/deed-mint-outbox.service.js';
import {
  DeedProjectorService,
  quantizeTerraformBp,
  quantizeTradeVolume,
} from '../../src/near/deed/deed-projector.service.js';
import { DeedRepository } from '../../src/near/deed/deed.repository.js';

async function setupProjector(taWaves: string) {
  const flags = new FlagsService({ TA_WAVES: taWaves } as never);
  const repo = new DeedRepository({ NODE_ENV: 'test' } as never);
  const bus = new EventBus();
  const minter = new DeedMintOutboxService(
    flags,
    repo,
    bus,
    undefined,
    undefined,
    { NODE_ENV: 'test' } as never,
  );
  const projector = new DeedProjectorService(
    flags,
    repo,
    bus,
    undefined,
    { NODE_ENV: 'test' } as never,
  );
  minter.onModuleInit();
  projector.onModuleInit();
  await minter.mintForColony({
    colonyId: 'col_0',
    planetId: 'pl_1',
    playerId: 'player_old',
    stage: 1,
    terraformBp: 1000,
  });
  return { flags, repo, bus, minter, projector };
}

describe('DeedProjectorService milestones & wave gating (W20-06 unit)', () => {
  it('with W05 and W08 on, reaching S3 queues stage: 3 and omits walls when W14 is excluded', async () => {
    const { bus, projector } = await setupProjector('W00,W01,W05,W06,W08,W13,W18,W20');
    const queued: Array<{ colonyId: string; stage?: number; walls?: number }> = [];
    projector.onMilestoneQueued((colonyId, _patch, meta) => {
      queued.push({ colonyId, stage: meta.stage, walls: meta.walls });
    });

    bus.emit('planet.event', {
      planetId: 'pl_1',
      tick: 50,
      kind: 'stageReached',
      severity: 'info',
      colonyIds: ['col_0'],
      data: { colonyIndex: 0, stage: 3, previousStage: 2 },
    });

    await vi.waitFor(() => {
      expect(queued).toHaveLength(1);
    });
    expect(queued[0]?.colonyId).toBe('col_0');
    expect(queued[0]?.stage).toBe(3);
    expect('walls' in (projector.getQueuedMilestone('col_0') ?? {})).toBe(false);

    const sanitized = await projector.projectMilestone({
      colonyId: 'col_0',
      planetId: 'pl_1',
      stage: 4,
      walls: 12,
      change: 'Stage 4 test',
    });
    expect(sanitized?.stage).toBe(4);
    expect(sanitized?.walls).toBeUndefined();
  });

  it('quantizes Terraform % in 10% (1000 bp) steps and trade volume in 100 steps', async () => {
    const { projector } = await setupProjector('..20');
    expect(quantizeTerraformBp(1950)).toBe(1000);
    expect(quantizeTerraformBp(2000)).toBe(2000);
    expect(quantizeTradeVolume(250)).toBe(200);

    // 5 small tile events of 200 bp each = 1000 bp (same as initial 1000 bp -> no change until 2000 bp)
    for (let i = 0; i < 9; i++) {
      await projector.handleEvent({
        planetId: 'pl_1',
        kind: 'tilePrepared',
        colonyIds: ['col_0'],
        data: { colonyId: 'col_0', playerId: 'player_old', count: 1 },
      });
    }
    expect(projector.getQueuedMilestone('col_0')).toBeNull();

    // 10th event reaches 2000 bp (20%)
    const tenth = await projector.handleEvent({
      planetId: 'pl_1',
      kind: 'tilePrepared',
      colonyIds: ['col_0'],
      data: { colonyId: 'col_0', playerId: 'player_old', count: 1 },
    });
    expect(tenth?.terraformBp).toBe(2000);
  });

  it('leaves truces, tradeVolume, and stage absent when their producer waves are disabled', async () => {
    const { projector } = await setupProjector('W00,W01,W05,W06,W20');
    const truceRes = await projector.handleEvent({
      planetId: 'pl_1',
      kind: 'truceSigned',
      colonyIds: ['col_0'],
      data: { colonyId: 'col_0' },
    });
    expect(truceRes).toBeNull();

    const meta = await projector.projectMilestone({
      colonyId: 'col_0',
      terraformBp: 3000,
      stage: 3,
      tradeVolume: 500,
      truces: 2,
      change: 'Terraform 30 %',
    });
    expect(meta?.terraformBp).toBe(3000);
    expect(meta?.stage).toBeUndefined();
    expect(meta?.tradeVolume).toBeUndefined();
    expect(meta?.truces).toBeUndefined();
  });
});

describe('DeedProjectorService W08 goal authority transfer (W20-06 unit)', () => {
  it('cancels active HQ goals on deed transfer, revokes old owner authority, and lets new owner queue goals', async () => {
    const { projector } = await setupProjector('..20');
    const state = createPlanet({ seed: 'w20-goal-transfer', planetType: 'temperate' });
    const q1 = queueColonyGoal(state, 0, { goal: 'establish_colony' }, 10);
    expect(q1.ok).toBe(true);
    expect(getOpenColonyGoals(state, 0)).toHaveLength(1);

    const transferred = await projector.transferDeedOwnership({
      colonyId: 'col_0',
      newPlayerId: 'player_new',
      newAccountId: 'col-0.new.terraagent.mock',
      simState: state,
      colonyIndex: 0,
    });
    expect(transferred.previousPlayerId).toBe('player_old');
    expect(transferred.newPlayerId).toBe('player_new');
    expect(transferred.cancelledGoals).toBe(1);
    expect(getOpenColonyGoals(state, 0)).toHaveLength(0);

    await expect(
      projector.assertColonyGoalAuthority('col_0', 'player_old'),
    ).rejects.toMatchObject({ errorCode: 'FORBIDDEN', status: 403 });
    await expect(
      projector.assertColonyGoalAuthority('col_0', 'player_new'),
    ).resolves.toBeUndefined();

    const resumed = queueColonyGoal(state, 0, { goal: 'establish_colony' }, 12);
    expect(resumed.ok).toBe(true);
    expect(getOpenColonyGoals(state, 0)).toHaveLength(1);
  });
});
