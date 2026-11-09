import { AwaySummarySchema, RESOURCE_KEYS, type AwaySummary, type ResourceKey } from '@terra/contracts';
import type { DigestRecord } from './types';

const ALERTS = 3;
const ALERT_CHARS = 64;

/** Headline for `/me/home`. An open row's `durationS` is `now - opened_at` (the body still says 0). */
export function awaySummary(row: DigestRecord, at: Date): AwaySummary | null {
  const parsed = AwaySummarySchema.safeParse({
    colonyId: row.body.colonyId,
    durationS: durationOf(row, at),
    resourcesNet: nets(row.body.resources),
    built: total(row.body.built),
    lost: total(row.body.lost),
    attacks: row.body.attacks.count,
    repelled: row.body.attacks.repelled,
    alerts: row.body.alerts.slice(0, ALERTS).map((alert) => alert.message.slice(0, ALERT_CHARS)),
  });
  return parsed.success ? parsed.data : null;
}

function durationOf(row: DigestRecord, at: Date): number {
  if (row.closedAt) return row.body.durationS;
  return Math.max(0, Math.floor((at.getTime() - row.openedAt.getTime()) / 1000));
}

function nets(resources: DigestRecord['body']['resources']): Partial<Record<ResourceKey, number>> {
  const out: Partial<Record<ResourceKey, number>> = {};
  for (const key of RESOURCE_KEYS) {
    const delta = resources[key].after - resources[key].before;
    if (delta !== 0) out[key] = delta;
  }
  return out;
}

function total(rows: readonly { count: number }[]): number {
  return rows.reduce((n, row) => n + row.count, 0);
}
