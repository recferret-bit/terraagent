import { z } from 'zod';
import { TerraformOp, TileCoord, TilePos } from '../ws/sim';
import { defineCommand } from './define';

export const EnqueueTerraformTask = z.strictObject({
  terraform: z.strictObject({
    op: TerraformOp,
    tiles: z.array(TilePos).min(1).max(256),
  }),
});

export const EnqueueBuildTask = z.strictObject({
  build: z.strictObject({
    building: z.string().min(1).max(64),
    q: TileCoord,
    r: TileCoord,
    tier: z.number().int().min(1).max(3).optional(),
    rotation: z.number().int().min(0).max(5).optional(),
  }),
});

export const EnqueueBuildUnitTask = z.strictObject({
  buildUnit: z.strictObject({
    unit: z.string().min(1).max(64),
    count: z.number().int().min(1).max(100).optional(),
    repeat: z.boolean().optional(),
    producerId: z.number().int().nonnegative().optional(),
  }),
});

export const EnqueueDirectTask = z.strictObject({
  taskId: z.string().min(1).max(64).optional(),
  precedence: z.enum(['explicit', 'autoSitePrep', 'queued', 'standing']).optional(),
  costOverride: z.record(z.string(), z.number().nonnegative()).optional(),
  task: z.union([
    z.strictObject({
      kind: z.literal('build'),
      building: z.string().min(1).max(64),
      q: TileCoord,
      r: TileCoord,
      rot: z.number().int().min(0).max(5).optional(),
      rotation: z.number().int().min(0).max(5).optional(),
      tier: z.number().int().min(1).max(3).optional(),
    }),
    z.strictObject({
      kind: z.literal('buildUnit'),
      unit: z.string().min(1).max(64),
      count: z.number().int().min(1).max(100).optional(),
      repeat: z.boolean().optional(),
      producerId: z.number().int().nonnegative().optional(),
      hubEntityId: z.number().int().nonnegative().optional(),
    }),
    z.strictObject({
      kind: z.literal('terraform'),
      op: TerraformOp,
      q: TileCoord,
      r: TileCoord,
    }),
  ]),
});

export const command = defineCommand({
  kind: 'enqueueTask',
  wave: 'W01',
  origin: 'client',
  args: z.union([EnqueueTerraformTask, EnqueueBuildTask, EnqueueBuildUnitTask, EnqueueDirectTask]),
  summary:
    'Enqueues a terraform order (W01), a building construction order (W02), or a unit production order (W02) in the colony queue.',
});
