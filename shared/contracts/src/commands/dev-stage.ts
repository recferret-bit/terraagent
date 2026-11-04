import { z } from 'zod';
import { defineCommand } from './define';

export const STAGE_OVERRIDES = ['fauna', 'rival', 'resource', 'power', 'storage'] as const;
export type StageOverride = (typeof STAGE_OVERRIDES)[number];
export const StageOverrideSchema = z.enum(STAGE_OVERRIDES);

const DevStageSetSchema = z.strictObject({
  op: z.literal('set'),
  stage: z.number().int().min(0).max(10),
  colonyIndex: z.number().int().nonnegative().optional(),
});

const DevStageSkipDwellSchema = z.strictObject({
  op: z.literal('skip-dwell'),
  colonyIndex: z.number().int().nonnegative().optional(),
});

const DevStageTriggerSchema = z.strictObject({
  op: z.literal('trigger'),
  override: StageOverrideSchema,
  colonyIndex: z.number().int().nonnegative().optional(),
});

export const DevStageArgsSchema = z.union([
  DevStageSetSchema,
  DevStageSkipDwellSchema,
  DevStageTriggerSchema,
]);

export type DevStageArgs = z.infer<typeof DevStageArgsSchema>;

export const command = defineCommand({
  kind: 'dev.stage',
  wave: 'W08',
  origin: 'client',
  dev: true,
  args: DevStageArgsSchema,
  summary: 'Dev command to set colony stage (`set`), skip stage dwell timer (`skip-dwell`), or trigger a safety override (`trigger`).',
});
