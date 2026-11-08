/** @terra/contracts: zod schemas for every message that crosses a boundary (PROTOCOL.md). Isomorphic. */
export * from './ids';
export * from './envelope';
export * from './errors';
export * from './flags';
export * from './ws';
export { defineCommand, type CommandDef } from './commands/define';
export { defineEvent, type EventDef } from './events/define';
export * from './commands/index.generated';
export * from './events/index.generated';
export {
  GOAL_KINDS,
  GoalKindSchema,
  GoalParamsSchema,
  QueueGoalArgsSchema,
  command as queueGoal,
  type GoalKind,
  type GoalParams,
  type QueueGoalArgs,
} from './commands/queue-goal';
export { CancelGoalArgsSchema, command as cancelGoal, type CancelGoalArgs } from './commands/cancel-goal';
export { ReorderGoalArgsSchema, command as reorderGoal, type ReorderGoalArgs } from './commands/reorder-goal';
export { AcceptSuggestionArgsSchema, command as acceptSuggestion, type AcceptSuggestionArgs } from './commands/accept-suggestion';
export {
  PRIORITY_KEYS,
  PriorityKeySchema,
  SetPrioritiesArgsSchema,
  command as setPriorities,
  type PriorityKey,
  type SetPrioritiesArgs,
} from './commands/set-priorities';
export { SetAiEnabledArgsSchema, command as setAiEnabled, type SetAiEnabledArgs } from './commands/set-ai-enabled';
export {
  STAGE_OVERRIDES,
  StageOverrideSchema,
  DevStageArgsSchema,
  type StageOverride,
  type DevStageArgs,
} from './commands/dev-stage';
export { StageReachedDataSchema, event as stageReached, type StageReachedData } from './events/stage-reached';
export { StageUnlockedDataSchema, event as stageUnlocked, type StageUnlockedData } from './events/stage-unlocked';
export { SuggestionOfferedDataSchema, event as suggestionOffered, type SuggestionOfferedData } from './events/suggestion-offered';
export { GoalProgressDataSchema, event as goalProgress, type GoalProgressData } from './events/goal-progress';
export { GoalDoneDataSchema, event as goalDone, type GoalDoneData } from './events/goal-done';
export {
  STANCE_KINDS,
  StanceKindSchema,
  SetStanceArgsSchema,
  command as setStance,
  type StanceKind,
  type SetStanceArgs,
} from './commands/set-stance';
export { SetRallyArgsSchema, command as setRally, type SetRallyArgs } from './commands/set-rally';
export { AttackMoveArgsSchema, command as attackMove, type AttackMoveArgs } from './commands/attack-move';
export { AttackTargetArgsSchema, command as attackTarget, type AttackTargetArgs } from './commands/attack-target';
export {
  WEAPON_TYPES,
  WeaponTypeSchema,
  ProjectileFiredDataSchema,
  event as projectileFired,
  type WeaponType,
  type ProjectileFiredData,
} from './events/projectile-fired';
export { ProjectileImpactDataSchema, event as projectileImpact, type ProjectileImpactData } from './events/projectile-impact';
export { UnitDestroyedDataSchema, event as unitDestroyed, type UnitDestroyedData } from './events/unit-destroyed';
export { BuildingDestroyedDataSchema, event as buildingDestroyed, type BuildingDestroyedData } from './events/building-destroyed';
export { UnderAttackDataSchema, event as underAttack, type UnderAttackData } from './events/under-attack';
export { RaidStartedDataSchema, event as raidStarted, type RaidStartedData } from './events/raid-started';
export { RaidRepelledDataSchema, event as raidRepelled, type RaidRepelledData } from './events/raid-repelled';
export { NestDestroyedDataSchema, event as nestDestroyed, type NestDestroyedData } from './events/nest-destroyed';
export { FaunaKilledDataSchema, event as faunaKilled, type FaunaKilledData } from './events/fauna-killed';
export * from './rest';
export * from './precheck';
export * from './progression';
export * from './profile';
export * from './maps';
export * from './lobby';
