import { DIGEST_LIST_CAP, type AwayDigestV1 } from '@terra/contracts';
import type { AlertFold, AttackFold, LossFold } from './types';

/** Keeps the first 20. The 21st appended item is dropped (CT-31). */
export function capList<T>(items: readonly T[]): T[] {
  return items.length <= DIGEST_LIST_CAP ? items.slice() : items.slice(0, DIGEST_LIST_CAP);
}

/**
 * `raidStarted` and `underAttack` increment `attacks.count`. `raidRepelled` increments `attacks.repelled`.
 * Every attack appends a `byColony` row (repelled skips duplicate when its raid start already appended);
 * past 20 the new row is dropped and the count still moves.
 */
export function foldAttack(body: AwayDigestV1, event: AttackFold): AwayDigestV1 {
  const name = attackName(event);
  const skipRepelledDup =
    event.kind === 'raidRepelled' &&
    body.attacks.byColony.length > 0 &&
    (body.attacks.byColony.some((row) => row.displayName === name) || !hasExplicitAttacker(event));
  const byColony = skipRepelledDup
    ? body.attacks.byColony
    : capList([...body.attacks.byColony, { displayName: name, count: 1 }]);
  const attacks = {
    count: body.attacks.count + (event.kind === 'raidRepelled' ? 0 : 1),
    repelled: body.attacks.repelled + (event.kind === 'raidRepelled' ? 1 : 0),
    byColony,
  };
  const alerts = event.kind === 'underAttack' ? capList([...body.alerts, underAttackAlert(event)]) : body.alerts;
  return { ...body, attacks, alerts };
}

export function foldLoss(body: AwayDigestV1, loss: LossFold): AwayDigestV1 {
  if (loss.kind === 'unitDestroyed') {
    return {
      ...body,
      robots: { ...body.robots, lost: body.robots.lost + loss.count },
    };
  }
  const item = {
    kind: loss.buildingKind ?? 'building',
    tier: loss.tier ?? 1,
    count: loss.count,
    cause: loss.cause,
  };
  return { ...body, lost: capList([...body.lost, item]) };
}

export function foldAlert(body: AwayDigestV1, alert: AlertFold): AwayDigestV1 {
  const label = alert.kind === 'colonyCritical' ? 'Colony critical' : 'Colony eliminated';
  const rawMessage = alert.cause ? `${label} (${alert.cause})` : label;
  const message = rawMessage.slice(0, 200);
  return {
    ...body,
    alerts: capList([...body.alerts, { code: 'under_attack', message }]),
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

function hasExplicitAttacker(event: AttackFold): boolean {
  return Boolean(
    event.attackerName?.trim() ||
      event.byColony?.trim() ||
      event.attackerColonyId?.trim() ||
      event.species?.trim(),
  );
}

function attackName(event: AttackFold): string {
  for (const candidate of [event.attackerName, event.byColony, event.species, event.attackerColonyId]) {
    const name = candidate?.trim();
    if (name && name.length <= 64) return name;
  }
  return event.kind === 'underAttack' || event.pvp ? 'hostile' : 'fauna';
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
