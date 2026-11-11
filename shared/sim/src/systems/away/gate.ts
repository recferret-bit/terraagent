import type { PriorityKey } from '@terra/contracts';
import type { SimCommand } from '../../kernel/commands';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { isRaidCommand } from './orders';
import { awayPolicy } from './policy';
import { readAwaySettings } from './store';
import type { AwayActor, AwayFamily, AwayPolicyView } from './types';

const EXEMPT = new Set(['player', 'dev', 'admin', 'system']);
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

/** True when the colony's away session is open, the presence blob says away, or `colony.away` is set. */
export function colonyIsAway(state: PlanetState, colonyIndex: number): boolean {
  if (readAwaySettings(state, colonyIndex)?.session.open) return true;
  if (presenceAway(state, colonyIndex)) return true;
  const col = state.colonies[colonyIndex] as Record<string, unknown> | undefined;
  return col?.away === true;
}

/** Resolves whether `colonyIndex` has opted into AI raids (`AW-11`, D-17; default `false`). */
export function resolveColonyAwayRaids(state: PlanetState, colonyIndex: number): boolean {
  const settings = readAwaySettings(state, colonyIndex);
  if (typeof settings?.awayRaids === 'boolean') return settings.awayRaids;
  const col = state.colonies[colonyIndex] as Record<string, unknown> | undefined;
  if (typeof col?.awayRaids === 'boolean') return col.awayRaids;
  const dirCol = (
    state.blobs.director?.value as { byColony?: Record<string, { raids?: boolean }> } | undefined
  )?.byColony?.[String(colonyIndex)];
  if (typeof dirCol?.raids === 'boolean') return dirCol.raids;
  return false;
}

function familyBudget(settings: ReturnType<typeof readAwaySettings>, family: AwayFamily): AwayPolicyView['budget'][AwayFamily] {
  const row = settings?.budget[family];
  const session = settings?.session;
  return {
    perDirectivePct: row?.perDirectivePct ?? 40,
    perSessionPct: row?.perSessionPct ?? 60,
    stock: { start: session?.start[family] ?? 0, spent: session?.spent[family] ?? 0 },
  };
}

function budgetOf(state: PlanetState, colonyIndex: number): AwayPolicyView['budget'] {
  const settings = readAwaySettings(state, colonyIndex);
  return {
    metals: familyBudget(settings, 'metals'),
    minerals: familyBudget(settings, 'minerals'),
    bio: familyBudget(settings, 'bio'),
  };
}

function guardPoints(ctx?: StepContext): number {
  const row = (ctx?.data?.tables?.director as Record<string, Record<string, unknown>> | undefined)?.budget;
  const bp = row?.awayGuardBp;
  return typeof bp === 'number' ? Math.round(bp / 100) : 10;
}

function viewFor(state: PlanetState, colonyIndex: number, ctx?: StepContext): AwayPolicyView {
  const settings = readAwaySettings(state, colonyIndex);
  return {
    away: true,
    guardPoints: guardPoints(ctx),
    mode: settings?.mode ?? 'director',
    awayRaids: resolveColonyAwayRaids(state, colonyIndex),
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
 * Routes AI-issued `raid`, `enqueueTask(raid)`, and `queueGoal(raid_target)` through `awayPolicy` (`AW-11`, `W18-16`).
 * Player, dev, admin, and system commands stay exempt (`AW-23`).
 */
export function checkAiRaidAwayPolicy(
  state: PlanetState,
  colonyIndex: number,
  cmd: Pick<SimCommand, 'kind' | 'source' | 'args'>,
  ctx?: StepContext,
): { code: 'away_policy'; detail: string } | undefined {
  if (EXEMPT.has(cmd.source) || cmd.kind.startsWith('system.')) return undefined;
  if (!isRaidCommand(cmd)) return undefined;
  const decision = awayPolicy(viewFor(state, colonyIndex, ctx), {
    kind: cmd.kind,
    actor: cmd.source as AwayActor,
    args: cmd.args,
  });
  if (decision.decision !== 'reject') return undefined;
  rejections.set(decision.rule, (rejections.get(decision.rule) ?? 0) + 1);
  return { code: 'away_policy', detail: decision.rule };
}

/**
 * AW-22 / AW-23. Player, dev and admin commands pass. `system.*` passes so presence can clear away.
 * Any other source is the away policy. A reject is counted under its rule.
 */
export function gateAwayCommand(state: PlanetState, cmd: SimCommand, ctx: StepContext): { code: 'away_policy'; detail: string } | undefined {
  if (!ctx.flags.has('W09') && !ctx.flags.has('W18')) return undefined;
  if (EXEMPT.has(cmd.source) || cmd.kind.startsWith('system.')) return undefined;
  if (typeof cmd.colonyIndex !== 'number') return undefined;
  if (ctx.flags.has('W18') && isRaidCommand(cmd)) {
    return checkAiRaidAwayPolicy(state, cmd.colonyIndex, cmd, ctx);
  }
  if (!colonyIsAway(state, cmd.colonyIndex)) return undefined;
  const decision = awayPolicy(viewFor(state, cmd.colonyIndex, ctx), {
    kind: cmd.kind,
    actor: cmd.source as AwayActor,
    args: cmd.args,
  });
  if (decision.decision !== 'reject') return undefined;
  rejections.set(decision.rule, (rejections.get(decision.rule) ?? 0) + 1);
  return { code: 'away_policy', detail: decision.rule };
}
