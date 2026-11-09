import { z } from 'zod';
import { TerraformOp, TileCoord, TilePos } from '../ws/sim';
import { defineCommand } from './define';

/** What a `work` order means on its tile (W02): repair a damaged own entity, or terraform the ground. */
export const WorkIntent = z.enum(['terraform', 'repair']);
export type WorkIntent = z.infer<typeof WorkIntent>;

export const EnqueueTerraformTask = z.strictObject({
  terraform: z.strictObject({
    op: TerraformOp,
    tiles: z.array(TilePos).min(1).max(256),
    workerId: z.number().int().nonnegative().optional(),
    entityId: z.number().int().nonnegative().optional(),
    /**
     * `op: 'work'` only: `'repair'` repairs a damaged own entity on the tile (none → reject), `'terraform'` ignores
     * damaged entities and terraforms the ground (the worker then keeps clearing the nearest obstacles). Absent: repair
     * a damaged target if there is one, else terraform.
     */
    intent: WorkIntent.optional(),
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
    tier: z.number().int().min(1).max(3).optional(),
    count: z.number().int().min(1).max(100).optional(),
    repeat: z.boolean().optional(),
    producerId: z.number().int().nonnegative().optional(),
  }),
});

export const EnqueueRepairTask = z.strictObject({
  repair: z.strictObject({
    entityId: z.number().int().positive(),
    q: TileCoord.optional(),
    r: TileCoord.optional(),
  }),
});

export const EnqueueHqGoalTask = z.strictObject({
  hqGoal: z.strictObject({
    goal: z.string().min(1).max(64),
    target: z.string().max(64).optional(),
    q: TileCoord.optional(),
    r: TileCoord.optional(),
  }),
});

/** W13: a prestige project selected at the Command Hub (`prestige` data row id, e.g. `project.survey_array`). */
export const EnqueueProjectTask = z.strictObject({
  project: z.strictObject({ project: z.string().min(1).max(64) }),
});

export const EnqueueDirectTask = z.strictObject({
  taskId: z.string().min(1).max(64).optional(),
  precedence: z.enum(['explicit', 'autoSitePrep', 'queued', 'standing', 'system', 'player', 'hq', 'ai', 'auto']).optional(),
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
      tier: z.number().int().min(1).max(3).optional(),
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
      workerId: z.number().int().nonnegative().optional(),
      entityId: z.number().int().nonnegative().optional(),
      /** `op: 'work'` only: as `terraform.intent` (the same order path, `enqueueWorkOrder`). */
      intent: WorkIntent.optional(),
    }),
    z.strictObject({
      kind: z.literal('repair'),
      entityId: z.number().int().positive(),
      q: TileCoord.optional(),
      r: TileCoord.optional(),
    }),
    z.strictObject({
      kind: z.literal('hqGoal'),
      goal: z.string().min(1).max(64),
      target: z.string().max(64).optional(),
      q: TileCoord.optional(),
      r: TileCoord.optional(),
    }),
    z.strictObject({ kind: z.literal('project'), project: z.string().min(1).max(64) }),
  ]),
});

export const command = defineCommand({
  kind: 'enqueueTask',
  wave: 'W01',
  origin: 'client',
  args: z.union([
    EnqueueTerraformTask,
    EnqueueBuildTask,
    EnqueueBuildUnitTask,
    EnqueueRepairTask,
    EnqueueHqGoalTask,
    EnqueueProjectTask,
    EnqueueDirectTask,
  ]),
  summary:
    'Enqueues a terraform order (W01), a building construction order (W02), a unit production order (W02), or a repair / HQ-goal order (W03; a Power Pylon is a plain `build` order), or a prestige project order (W13) in the colony queue.',
});
