import {
  AwayDigestV1Schema,
  DIGEST_RETENTION_DAYS,
  RESOURCE_KEYS,
  type AwayDigestV1,
  type ResourceKey,
} from '@terra/contracts';
import type { DigestBaseline } from './types';

const DAY_MS = 86_400_000;

/** `opened_at` strictly older than this is purged. Equal to this instant is kept (not "older than 7 days"). */
export function digestCutoff(now: Date): Date {
  return new Date(now.getTime() - DIGEST_RETENTION_DAYS * DAY_MS);
}

export function emptyDigest(colonyId: string, atIso: string): AwayDigestV1 {
  const resources = {} as AwayDigestV1['resources'];
  for (const key of RESOURCE_KEYS) resources[key] = { before: 0, after: 0 };
  return {
    colonyId,
    awayFrom: atIso,
    awayTo: atIso,
    durationS: 0,
    resources,
    energy: { before: 0, after: 0 },
    built: [],
    lost: [],
    robots: { before: 0, after: 0, produced: 0, lost: 0 },
    territory: { before: 0, after: 0 },
    attacks: { count: 0, repelled: 0, byColony: [] },
    hazards: [],
    ai: { decisions: 0, rejected: 0, highlights: [] },
    trades: { settled: 0, items: [] },
    alerts: [],
  };
}

/** True when every baseline number is still zero, so a later snapshot may fill it (BE-59). */
export function isZeroBaseline(body: AwayDigestV1): boolean {
  if (body.energy.before !== 0 || body.energy.after !== 0) return false;
  if (body.robots.before !== 0 || body.robots.after !== 0) return false;
  if (body.territory.before !== 0 || body.territory.after !== 0) return false;
  return RESOURCE_KEYS.every((key) => body.resources[key].before === 0 && body.resources[key].after === 0);
}

/** Writes the away-start numbers into both sides. Later folds keep `produced` / `lost`. */
export function stampBaseline(body: AwayDigestV1, base: DigestBaseline): AwayDigestV1 {
  const resources = { ...body.resources };
  for (const key of RESOURCE_KEYS) {
    const n = num(base.resources[key as ResourceKey]);
    resources[key] = { before: n, after: n };
  }
  const robots = whole(base.robots);
  const territory = whole(base.territory);
  return {
    ...body,
    resources,
    energy: { before: base.energy, after: base.energy },
    robots: { ...body.robots, before: robots, after: robots },
    territory: { before: territory, after: territory },
  };
}

export function checkedDigest(body: AwayDigestV1): AwayDigestV1 {
  return AwayDigestV1Schema.parse(body);
}

/** Null when `colonyId` is not a home id, so the row is not opened. */
export function draftDigest(colonyId: string, atIso: string): AwayDigestV1 | null {
  const parsed = AwayDigestV1Schema.safeParse(emptyDigest(colonyId, atIso));
  return parsed.success ? parsed.data : null;
}

function num(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function whole(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}
