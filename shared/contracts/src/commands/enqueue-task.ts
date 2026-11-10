import { z } from 'zod';
import { ColonyTargetIdSchema, RaidTaskPayloadSchema } from '../diplomacy';
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

/** W18: a PvP raid task (`UO-W-08`, `UO-T-05`) dispatched from the "Raid Colony" HQ goal or directly. */
export const EnqueueRaidTask = z.strictObject({
  raid: RaidTaskPayloadSchema,
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
    z
      .strictObject({
        kind: z.literal('raid'),
        targetColonyId: ColonyTargetIdSchema.optional(),
        targetColonyIndex: z.number().int().nonnegative().optional(),
        targetColony: ColonyTargetIdSchema.optional(),
        unitIds: z.array(z.number().int().positive()).min(1).max(64).optional(),
        entityIds: z.array(z.number().int().positive()).min(1).max(64).optional(),
        q: TileCoord.optional(),
        r: TileCoord.optional(),
      })
      .refine(
        (v) =>
          v.targetColonyId !== undefined ||
          v.targetColonyIndex !== undefined ||
          v.targetColony !== undefined,
        { message: 'A raid task requires targetColonyId, targetColonyIndex, or targetColony.' },
      ),
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
    EnqueueRaidTask,
    EnqueueDirectTask,
  ]),
  summary:
    'Enqueues a terraform order (W01), a building construction order (W02), a unit production order (W02), a repair / HQ-goal order (W03), a prestige project order (W13), or a PvP raid order (W18) in the colony queue.',
});
