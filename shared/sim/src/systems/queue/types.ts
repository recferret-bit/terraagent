import type { ResourceFamily, ResourceKey } from '@terra/contracts';

export type QueueLane = 'construction' | 'units' | 'terraform' | 'hqGoals';
export type QueuePrecedence = 'system' | 'player' | 'hq' | 'ai' | 'auto';
export type QueueEntryState = 'queued' | 'waiting' | 'in_progress' | 'done' | 'cancelled';
export type QueueWaitReason = 'resources' | 'storage' | 'worker' | 'power' | 'site' | 'supply';

export const PRECEDENCE_RANK: Readonly<Record<QueuePrecedence, number>> = {
  system: 5,
  player: 4,
  hq: 3,
  ai: 2,
  auto: 1,
};

export type QueueTaskPayload =
  | { kind: 'build'; building: string; q: number; r: number; tier?: number; rotation?: number }
  | { kind: 'buildUnit'; unit: string; count?: number; repeat?: boolean; producerId?: number }
  | { kind: 'terraform'; op: string; q: number; r: number }
  | { kind: 'repair'; entityId: number; q?: number; r?: number; op?: string }
  /** A building coming down (owner feedback W03 #6): follows its dismantle work job (`terraform-basic/dismantleJob.ts`). */
  | { kind: 'dismantle'; entityId: number; building?: string; q?: number; r?: number }
  | { kind: 'hqGoal'; goal: string; target?: string; q?: number; r?: number; op?: string };

export interface QueueEntry {
  taskId: string;
  colonyIndex: number;
  lane: QueueLane;
  precedence: QueuePrecedence;
  state: QueueEntryState;
  task: QueueTaskPayload;
  cost: Partial<Record<ResourceKey, number>>;
  totalCost?: Partial<Record<ResourceKey, number>>;
  spentCost?: Partial<Record<ResourceKey, number>>;
  paid: boolean;
  progress: number;
  buildTicks: number;
  elapsedTicks: number;
  workRate: number;
  entityId?: number;
  workerEntityId?: number;
  waitReason?: QueueWaitReason;
  waitDetail?: string;
  missingResources?: Partial<Record<ResourceKey, number>>;
  exceedsCap?: Partial<Record<ResourceFamily, number>>;
  etaSeconds?: number | null;
  /** `buildUnit` only: units of the batch (`task.count`) still to build, the current one included (absent = `count`). */
  remainingCount?: number;
  /** Tick since which this entry has been continuously in `waiting` with `waitReason === 'resources'` (W03-13 earmarks). */
  resourceWaitSinceTick?: number;
  /** Earmarked missing resources reserved by this entry after 60 s of resource starvation (W03-13). */
  earmarked?: Partial<Record<ResourceKey, number>>;
  /** Optional parent HQ goal id (`ColonyGoalEntry.id`) when broken down from an HQ goal (`precedence: 'hq'`, W08-16/17). */
  goalId?: string;
  createdAt: number;
}

export type OrderQueueEntry = QueueEntry;
