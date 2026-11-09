import type { PriorityKey } from '@terra/contracts';

export type AwayActor = 'player' | 'ai' | 'system' | 'bot' | 'dev' | 'near' | 'admin';
export type AwayFamily = 'metals' | 'minerals' | 'bio';
export const AWAY_FAMILIES = ['metals', 'minerals', 'bio'] as const;

/** AW-01..07. `present` / `player` mean the away rules do not apply. */
export type AwayAllowRule = 'AW-01' | 'AW-02' | 'AW-03' | 'AW-04' | 'AW-05' | 'AW-06' | 'AW-07' | 'present' | 'player';

export interface AwayFamilyBudgetView {
  readonly perDirectivePct: number;
  readonly perSessionPct: number;
  readonly stock: { readonly start: number; readonly spent: number };
}

export interface AwayBaselineBuilding {
  readonly kind: string;
  readonly tier: number;
  readonly q: number;
  readonly r: number;
  readonly destroyed: boolean;
}

export interface AwayPolicyView {
  readonly away: boolean;
  readonly guardPoints: number;
  readonly mode: 'director' | 'rules_only';
  readonly awayRaids: boolean;
  readonly unlockStage: number;
  readonly priorities: Readonly<Record<PriorityKey, number>>;
  readonly budget: Readonly<Record<AwayFamily, AwayFamilyBudgetView>>;
  readonly baseline: readonly AwayBaselineBuilding[];
  readonly queuedTaskIds: readonly string[];
  readonly queuedBeacons: readonly { readonly q: number; readonly r: number }[];
  readonly ownedUnitKinds: readonly string[];
  readonly lossKinds: readonly string[];
  readonly threat: { readonly underAttack: boolean; readonly brownout: boolean };
}

/** A command the pure policy sees. `cost` is the directive's resource spend, not a wire field. */
export interface AwayCommand {
  readonly kind: string;
  readonly actor: AwayActor;
  readonly args: unknown;
  readonly cost?: Partial<Record<AwayFamily, number>>;
}

export type AwayDecision =
  | { readonly decision: 'allow'; readonly rule: AwayAllowRule }
  | { readonly decision: 'abstain' };

export interface BuildOrder {
  readonly building: string;
  readonly q: number;
  readonly r: number;
  readonly tier: number;
  readonly taskId?: string;
}
