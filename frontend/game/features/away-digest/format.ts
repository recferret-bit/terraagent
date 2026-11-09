import type { AwayDigestV1, AwayResources } from '@terra/contracts';

const ALERT_CAP = 3;

/** Digest identity: one dismiss covers this colony's return from this away start. */
export function awayIdentity(d: Pick<AwayDigestV1, 'colonyId' | 'awayFrom'>): string {
  return `${d.colonyId}\u0000${d.awayFrom}`;
}

/** Minutes and seconds (`600` → `10 min`). Hours are included when the away is longer than one. */
export function formatAwayDuration(durationS: number): string {
  const total = Math.max(0, Math.floor(durationS));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0 || hours === 0) parts.push(`${minutes} min`);
  if (seconds > 0) parts.push(`${seconds} s`);
  return parts.join(' ');
}

export function formatNet(net: number): string {
  const text = Number.isInteger(net) ? String(net) : String(Math.round(net * 100) / 100);
  return net > 0 ? `+${text}` : text;
}

/** `after - before` for keys that moved. Zero nets are omitted. */
export function resourceNets(resources: AwayResources): { key: string; net: number }[] {
  const nets: { key: string; net: number }[] = [];
  for (const key of Object.keys(resources) as (keyof AwayResources)[]) {
    const net = resources[key].after - resources[key].before;
    if (net !== 0) nets.push({ key, net });
  }
  return nets;
}

export function alertLines(alerts: AwayDigestV1['alerts']): string[] {
  return alerts.slice(0, ALERT_CAP).map((alert) => alert.message);
}

/** Non-empty story paragraph, or null when the provider sent nothing. */
export function storyText(story: string | undefined): string | null {
  if (!story) return null;
  return story;
}
