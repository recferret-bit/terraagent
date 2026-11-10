import { newId, type FlagSet, type SimCommandV1 } from '@terra/contracts';
import { TICK_MS } from '@terra/sim';
import { proposalDeadlineMs, type TreasuryProject } from './costs.js';
import { storedProposalMeta } from './council-view.js';

/** How often the app asks `finalizeDue` (the deadline itself is 6 h, not this poll). */
export const FINALIZE_POLL_MS = 60_000;

export interface FinalizeDueResult {
  readonly expired: number;
  readonly approved: number;
  readonly effects: number;
}

export const EMPTY_FINALIZE: FinalizeDueResult = { expired: 0, approved: 0, effects: 0 };

/** Narrow `GamePlanets` surface. A missing planet answers `{ ok: false }` and the command stays on the proposal. */
export interface TreasurySimPort {
  submit(planetId: string, cmd: SimCommandV1): Promise<{ ok: boolean; code?: string }>;
  isLoaded?(planetId: string): boolean;
  fullState?(planetId: string, timeoutMs?: number): Promise<{ tick: number }>;
}

/** `payload.deadlineMs` when propose stored it, otherwise `submitTime` plus `proposalTtlH`. */
export function deadlineMsOf(kind: unknown, submitTimeMs: number, flags: FlagSet): number {
  const stored = storedProposalMeta(kind).deadlineMs;
  if (stored !== undefined && stored > 0) return stored;
  return proposalDeadlineMs(flags, submitTimeMs);
}

/** Real hours to sim ticks (`TICK_MS` is 200). `durationH` 0 stays on the current tick. */
export function effectUntilTick(nowTick: number, durationH: number): number {
  const extra = durationH > 0 ? Math.round((durationH * 3_600_000) / TICK_MS) : 0;
  const tick = Number.isFinite(nowTick) && nowTick > 0 ? Math.floor(nowTick) : 0;
  return tick + extra;
}

/** Module command `system.treasuryEffect`. Clients cannot send this kind. */
export function treasuryEffectCommand(project: TreasuryProject, untilTick: number): SimCommandV1 {
  const params: { magnitudeBp?: number; visits?: number } = {};
  if (project.magnitudeBp > 0) params.magnitudeBp = Math.min(10_000, Math.round(project.magnitudeBp));
  if (project.visits > 0) params.visits = Math.min(8, Math.round(project.visits));
  return {
    colonyIndex: null,
    source: 'system',
    commandId: newId('cm'),
    kind: 'system.treasuryEffect',
    args: {
      kind: project.kind,
      untilTick,
      ...(params.magnitudeBp !== undefined || params.visits !== undefined ? { params } : {}),
    },
  };
}
