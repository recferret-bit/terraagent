import { DIGEST_LIST_CAP, type AwayDigestV1 } from '@terra/contracts';
import type { AttackFold } from './types';

/** Keeps the first 20. The 21st appended item is dropped (CT-31). */
export function capList<T>(items: readonly T[]): T[] {
  return items.length <= DIGEST_LIST_CAP ? items.slice() : items.slice(0, DIGEST_LIST_CAP);
}

/**
 * `raidStarted` and `underAttack` increment `attacks.count`. `raidRepelled` increments `attacks.repelled`.
 * Every one of those appends a `byColony` row; past 20 the new row is dropped and the count still moves.
 */
export function foldAttack(body: AwayDigestV1, event: AttackFold): AwayDigestV1 {
  const attacks = {
    count: body.attacks.count + (event.kind === 'raidRepelled' ? 0 : 1),
    repelled: body.attacks.repelled + (event.kind === 'raidRepelled' ? 1 : 0),
    byColony: capList([...body.attacks.byColony, { displayName: attackName(event), count: 1 }]),
  };
  const alerts = event.kind === 'underAttack' ? capList([...body.alerts, underAttackAlert(event)]) : body.alerts;
  return { ...body, attacks, alerts };
}

/** One while-away line. Past 20, the new line is dropped and the earlier lines stay (CT-31). */
export function foldHighlight(body: AwayDigestV1, at: string, summary: string): AwayDigestV1 {
  return {
    ...body,
    ai: { ...body.ai, highlights: capList([...body.ai.highlights, { at, summary }]) },
  };
}

/** Older bodies first, newest last. Counts sum. Lists concatenate, then cap at 20. */
export function mergeBodies(parts: readonly AwayDigestV1[]): AwayDigestV1 {
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!first || !last) throw new Error('merge needs a digest');
  if (parts.length === 1) return first;
  const story = lastStory(parts);
  return {
    colonyId: last.colonyId,
    awayFrom: first.awayFrom,
    awayTo: last.awayTo,
    durationS: parts.reduce((n, b) => n + b.durationS, 0),
    resources: mergeResources(parts),
    energy: { before: first.energy.before, after: last.energy.after },
    built: capList(parts.flatMap((b) => b.built)),
    lost: capList(parts.flatMap((b) => b.lost)),
    robots: mergeRobots(parts),
    territory: { before: first.territory.before, after: last.territory.after },
    attacks: {
      count: parts.reduce((n, b) => n + b.attacks.count, 0),
      repelled: parts.reduce((n, b) => n + b.attacks.repelled, 0),
      byColony: capList(parts.flatMap((b) => b.attacks.byColony)),
    },
    hazards: capList(parts.flatMap((b) => b.hazards)),
    ai: {
      decisions: parts.reduce((n, b) => n + b.ai.decisions, 0),
      rejected: parts.reduce((n, b) => n + b.ai.rejected, 0),
      highlights: capList(parts.flatMap((b) => b.ai.highlights)),
    },
    trades: {
      settled: parts.reduce((n, b) => n + b.trades.settled, 0),
      items: capList(parts.flatMap((b) => b.trades.items)),
    },
    alerts: capList(parts.flatMap((b) => b.alerts)),
    ...(story ? { story } : {}),
  };
}

function attackName(event: AttackFold): string {
  const name = event.species?.trim();
  if (name && name.length <= 64) return name;
  return event.kind === 'underAttack' ? 'hostile' : 'fauna';
}

function underAttackAlert(event: AttackFold): AwayDigestV1['alerts'][number] {
  const where = event.q !== undefined && event.r !== undefined ? ` at ${event.q},${event.r}` : '';
  return { code: 'under_attack', message: `Under attack${where}` };
}

function mergeResources(parts: readonly AwayDigestV1[]): AwayDigestV1['resources'] {
  const first = parts[0]!.resources;
  const last = parts[parts.length - 1]!.resources;
  const resources = { ...last };
  for (const key of Object.keys(first) as (keyof AwayDigestV1['resources'])[]) {
    resources[key] = { before: first[key].before, after: last[key].after };
  }
  return resources;
}

function mergeRobots(parts: readonly AwayDigestV1[]): AwayDigestV1['robots'] {
  const first = parts[0]!.robots;
  const last = parts[parts.length - 1]!.robots;
  return {
    before: first.before,
    after: last.after,
    produced: parts.reduce((n, b) => n + b.robots.produced, 0),
    lost: parts.reduce((n, b) => n + b.robots.lost, 0),
  };
}

function lastStory(parts: readonly AwayDigestV1[]): string | undefined {
  for (let i = parts.length - 1; i >= 0; i--) {
    const story = parts[i]?.story;
    if (story) return story;
  }
  return undefined;
}
