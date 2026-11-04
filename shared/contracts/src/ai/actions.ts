import { z } from 'zod';
import { CancelGoalArgsSchema } from '../commands/cancel-goal';
import { command as enqueueTask } from '../commands/enqueue-task';
import { command as moveUnit } from '../commands/move-unit';
import { command as placeBuilding } from '../commands/place-building';
import { QueueGoalArgsSchema } from '../commands/queue-goal';
import { command as setHarvestWeights } from '../commands/set-harvest-weights';
import { SetPrioritiesArgsSchema } from '../commands/set-priorities';
import { command as stopUnit } from '../commands/stop-unit';
import { ActionId } from './ids';

/**
 * Directive actions reuse landed command argument schemas (AI §6). An unknown kind is not mapped to a fallback.
 * The list is closed: raid, launch and trade commands are absent until their owning waves expose a schema here.
 */
export const DIRECTIVE_ACTION_KINDS = [
  'queueGoal',
  'cancelGoal',
  'setPriorities',
  'enqueueTask',
  'placeBuilding',
  'moveUnit',
  'stopUnit',
  'setHarvestWeights',
] as const;
export const DirectiveActionKindSchema = z.enum(DIRECTIVE_ACTION_KINDS);
export type DirectiveActionKind = z.infer<typeof DirectiveActionKindSchema>;

function action<const K extends DirectiveActionKind, A extends z.ZodType>(kind: K, args: A) {
  return z.strictObject({
    actionId: ActionId,
    kind: z.literal(kind),
    args,
  });
}

export const DirectiveActionSchema = z.discriminatedUnion('kind', [
  action('queueGoal', QueueGoalArgsSchema),
  action('cancelGoal', CancelGoalArgsSchema),
  action('setPriorities', SetPrioritiesArgsSchema),
  action('enqueueTask', enqueueTask.args),
  action('placeBuilding', placeBuilding.args),
  action('moveUnit', moveUnit.args),
  action('stopUnit', stopUnit.args),
  action('setHarvestWeights', setHarvestWeights.args),
]);
export type DirectiveAction = z.infer<typeof DirectiveActionSchema>;
