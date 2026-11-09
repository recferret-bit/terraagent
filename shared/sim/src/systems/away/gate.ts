import type { PriorityKey } from '@terra/contracts';
import type { SimCommand } from '../../kernel/commands';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { awayPolicy } from './policy';
import { readAwaySettings } from './store';
import type { AwayActor, AwayPolicyView } from './types';
import { AWAY_FAMILIES } from './types';

const EXEMPT = new Set(['player', 'dev', 'admin']);
const PRIORITIES = { economy: 50, expansion: 50, defense: 50, power: 50, terraform: 50 } as Record<PriorityKey, number>;

const rejections = new Map<string, number>();

/** How many automated commands this process has rejected for one rule (tests and the server metric). */
export function awayPolicyRejectionCount(rule?: string): number {
  if (!rule) return [...rejections.values()].reduce((s, n) => s + n, 0);
  return rejections.get(rule) ?? 0;
}

export function resetAwayPolicyRejections(): void {
  rejections.clear();
}

function presenceAway(state: PlanetState, colonyIndex: number): boolean {
  const blob = state.blobs.presence?.value as { byColony?: Record<string, { away?: boolean }> } | undefined;
  return blob?.byColony?.[String(colonyIndex)]?.away === true;
}

/** True when the colony's away session is open or the presence blob says away. */
export function colonyIsAway(state: PlanetState, colonyIndex: number): boolean {
  if (readAwaySettings(state, colonyIndex)?.session.open) return true;
  return presenceAway(state, colonyIndex);
}

function budgetOf(state: PlanetState, colonyIndex: number): AwayPolicyView['budget'] {
  const settings = readAwaySettings(state, colonyIndex);
  const out = {} as AwayPolicyView['budget'];
  for (const family of AWAY_FAMILIES) {
    const row = settings?.budget[family];
    const session = settings?.session;
    out[family] = {
      perDirectivePct: row?.perDirectivePct ?? 40,
      perSessionPct: row?.perSessionPct ?? 60,
      stock: { start: session?.start[family] ?? 0, spent: session?.spent[family] ?? 0 },
    };
  }
  return out;
}

function guardPoints(ctx: StepContext): number {
  const row = (ctx.data.tables.director as Record<string, Record<string, unknown>> | undefined)?.budget;
  const bp = row?.awayGuardBp;
  return typeof bp === 'number' ? Math.round(bp / 100) : 10;
}

function viewFor(state: PlanetState, colonyIndex: number, ctx: StepContext): AwayPolicyView {
  const settings = readAwaySettings(state, colonyIndex);
  return {
    away: true,
    guardPoints: guardPoints(ctx),
    mode: settings?.mode ?? 'director',
    awayRaids: settings?.awayRaids ?? false,
    unlockStage: 4,
    priorities: PRIORITIES,
    budget: budgetOf(state, colonyIndex),
    baseline: [],
    queuedTaskIds: [],
    queuedBeacons: [],
    ownedUnitKinds: [],
    lossKinds: [],
    threat: { underAttack: false, brownout: false },
  };
}

/**
 * AW-22 / AW-23. Player, dev and admin commands pass. `system.*` passes so presence can clear away.
 * Any other source is the away policy. A reject is counted under its rule.
 */
export function gateAwayCommand(state: PlanetState, cmd: SimCommand, ctx: StepContext): { code: 'away_policy'; detail: string } | undefined {
  if (!ctx.flags.has('W09')) return undefined;
  if (EXEMPT.has(cmd.source) || cmd.kind.startsWith('system.')) return undefined;
  if (typeof cmd.colonyIndex !== 'number' || !colonyIsAway(state, cmd.colonyIndex)) return undefined;
  const decision = awayPolicy(viewFor(state, cmd.colonyIndex, ctx), {
    kind: cmd.kind,
    actor: cmd.source as AwayActor,
    args: cmd.args,
  });
  if (decision.decision !== 'reject') return undefined;
  rejections.set(decision.rule, (rejections.get(decision.rule) ?? 0) + 1);
  return { code: 'away_policy', detail: decision.rule };
}
