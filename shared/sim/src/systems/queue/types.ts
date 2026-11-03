import type { ResourceFamily, ResourceKey } from '@terra/contracts';

export type QueueLane = 'construction' | 'units' | 'terraform';
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
  | { kind: 'terraform'; op: string; q: number; r: number };

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
  /** Optional parent HQ goal id (`ColonyGoalEntry.id`) when broken down from an HQ goal (`precedence: 'hq'`, W08-16/17). */
  goalId?: string;
  createdAt: number;
}

export type OrderQueueEntry = QueueEntry;
