import {
  HomeColonyId,
  NOTIFICATION_KINDS,
  NotificationPayloadSchema,
  type AutoTradeLimit,
  type AutoTradeOrder,
  type NotificationChannel,
  type NotificationKind,
  type NotificationPayload,
} from '@terra/contracts';
import { withinAutoTrade } from '@terra/sim/systems/away/auto-trade';

const KIND_SET = new Set<string>(NOTIFICATION_KINDS);

/** Sim (or direct) event name → CT-36 kind. `trade_offer` has no sim event; it is only the notification kind. */
const SIM_TO_KIND: Readonly<Record<string, NotificationKind>> = {
  underAttack: 'under_attack',
  raidStarted: 'under_attack',
  colonyCritical: 'colony_critical',
  colonyEliminated: 'colony_eliminated',
  energyCollapse: 'energy_collapse',
  rocketReady: 'rocket_ready',
  truceOffered: 'truce_offered',
  awayBudgetExhausted: 'away_budget_exhausted',
  directorAllowanceExhausted: 'away_budget_exhausted',
};

/**
 * A director stop notifies only when the allowance is spent and both W09 and W15 are on.
 * `director_key_revoked` stays the planet event. Other kinds are unchanged.
 */
export function directorBudgetNotifies(
  kind: string,
  data: Readonly<Record<string, unknown>> | undefined,
  w09: boolean,
  w15: boolean,
): boolean {
  if (kind !== 'directorAllowanceExhausted') return true;
  return w09 && w15 && data?.reason === 'allowance_exhausted';
}

const ALERT_COPY: Record<NotificationKind, { readonly title: string; readonly body: string }> = {
  under_attack: { title: 'Under attack', body: 'Hostile forces are hitting the colony.' },
  colony_critical: { title: 'Colony critical', body: 'The Hub is down and the colony can still be saved.' },
  colony_eliminated: { title: 'Colony eliminated', body: 'The colony has been eliminated.' },
  energy_collapse: { title: 'Energy collapse', body: 'The grid has been in brownout too long.' },
  rocket_ready: { title: 'Rocket ready', body: 'The rocket is ready to launch.' },
  truce_offered: { title: 'Truce offered', body: 'Another colony offered a truce.' },
  trade_offer: { title: 'Trade offer', body: 'A trade offer is outside auto-trade limits.' },
  away_budget_exhausted: { title: 'Away budget spent', body: 'Automated spending hit the away budget.' },
};

export interface AlertRouteInput {
  readonly colonyId?: unknown;
  readonly colonyIds?: readonly unknown[];
  readonly eventId?: string;
  readonly kind: string;
  readonly nowMs?: number;
  readonly withinAutoTrade?: boolean;
  /** When both are set, `withinAutoTrade(limit, order)` decides instead of the boolean. */
  readonly limit?: AutoTradeLimit;
  readonly order?: AutoTradeOrder;
  readonly planetId?: string;
  readonly tick?: number;
  readonly channel?: NotificationChannel;
  readonly to?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

/** One of the eight CT-36 kinds, or null when the name is not routed. */
export function notificationKindOf(kind: string): NotificationKind | null {
  if (KIND_SET.has(kind)) return kind as NotificationKind;
  return SIM_TO_KIND[kind] ?? null;
}

/**
 * String colony ids only. A numeric colony index (how `energyCollapse` is emitted today) is not a
 * `HomeColonyId`, so it is skipped rather than addressed as `col_<index>`.
 * For PvP raids (`under_attack`) and diplomacy (`truce_offered`), only the defending target or
 * recipient colony is addressed — never the attacker (`attackerColonyId`) or proposer (`fromColonyId`).
 */
export function colonyTargets(
  input: Pick<AlertRouteInput, 'colonyId' | 'colonyIds' | 'data'> & { readonly kind?: string },
): string[] {
  const kind = input.kind ? notificationKindOf(input.kind) : null;
  const data = input.data;
  const excluded = excludedColonies(kind, data);

  if (kind === 'under_attack' || kind === null) {
    const target = homeColony(data?.targetColonyId);
    if (target) return excluded.has(target) ? [] : [target];
  }
  if (kind === 'truce_offered' || kind === null) {
    const recipient = homeColony(data?.toColonyId);
    if (recipient) return excluded.has(recipient) ? [] : [recipient];
  }

  const found: string[] = [];
  const push = (id: unknown) => {
    const parsed = homeColony(id);
    if (parsed && !excluded.has(parsed) && !found.includes(parsed)) found.push(parsed);
  };
  push(input.colonyId);
  push(data?.colonyId);
  for (const id of input.colonyIds ?? []) push(id);
  return found;
}

function excludedColonies(
  kind: NotificationKind | null,
  data: Readonly<Record<string, unknown>> | undefined,
): ReadonlySet<string> {
  const excluded = new Set<string>();
  const add = (id: unknown) => {
    const parsed = homeColony(id);
    if (parsed) excluded.add(parsed);
  };
  if (kind === 'under_attack' || kind === null) {
    add(data?.attackerColonyId);
    add(data?.byColony);
  }
  if (kind === 'truce_offered' || kind === null) add(data?.fromColonyId);
  if (kind === 'colony_eliminated' || kind === null) add(data?.killerColonyId);
  return excluded;
}

/** `trade_offer` notifies only outside auto-trade. Every other kind is not gated here. */
export function notifiesTradeOffer(input: Pick<AlertRouteInput, 'withinAutoTrade' | 'limit' | 'order'>): boolean {
  if (input.limit && input.order) return !withinAutoTrade(input.limit, input.order);
  return input.withinAutoTrade === false;
}

/** A schema-valid payload, or null when the pieces cannot be sent. */
export function alertNotification(
  kind: NotificationKind,
  colonyId: string,
  input: AlertRouteInput,
  nowMs: number,
): NotificationPayload | null {
  const copy = ALERT_COPY[kind];
  const parsed = NotificationPayloadSchema.safeParse({
    colonyId,
    eventId: clipEventId(input.eventId, kind, input.planetId, input.tick, nowMs),
    kind,
    channel: input.channel === 'telegram' ? 'telegram' : 'webpush',
    to: input.to && input.to.length > 0 && input.to.length <= 500 ? input.to : colonyId,
    title: copy.title,
    body: alertBody(kind, input.data),
    deepLink: `/c/${colonyId}`,
    data: alertData(kind, input),
  });
  return parsed.success ? parsed.data : null;
}

function homeColony(id: unknown): string | null {
  return typeof id === 'string' && HomeColonyId.safeParse(id).success ? id : null;
}

function shortText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 80) : null;
}

function alertBody(kind: NotificationKind, data: Readonly<Record<string, unknown>> | undefined): string {
  const resource = data?.resource;
  if (kind === 'away_budget_exhausted' && (resource === 'metals' || resource === 'minerals' || resource === 'bio')) {
    return `Automated spending hit the away budget for ${resource}.`;
  }
  if (kind === 'under_attack') {
    const attacker = shortText(data?.attackerName) ?? shortText(data?.byColony);
    if (attacker) return `Hostile forces from ${attacker} are hitting the colony.`;
  }
  return ALERT_COPY[kind].body;
}

const EXTRA_DATA_KEYS: Partial<Record<NotificationKind, readonly string[]>> = {
  under_attack: ['attackerColonyId', 'targetColonyId', 'byColony', 'attackerName', 'raidId'],
  colony_critical: ['cause', 'deadlineTick', 'timerS', 'hubEntityId'],
  colony_eliminated: ['cause', 'killerColonyId', 'byColony'],
  truce_offered: ['offerId', 'fromColonyId', 'toColonyId', 'durationHours', 'hours', 'expiresAtTick'],
};

function alertData(kind: NotificationKind, input: AlertRouteInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    sourceKind: input.kind,
    ...(input.planetId ? { planetId: input.planetId } : {}),
    ...(input.tick !== undefined ? { tick: input.tick } : {}),
  };
  const data = input.data;
  if (!data) return out;
  for (const key of EXTRA_DATA_KEYS[kind] ?? []) {
    if (data[key] !== undefined) out[key] = data[key];
  }
  if (kind === 'truce_offered' && out.durationHours === undefined && data.hours !== undefined) {
    out.durationHours = data.hours;
  }
  return out;
}

function clipEventId(
  eventId: string | undefined,
  kind: string,
  planetId: string | undefined,
  tick: number | undefined,
  nowMs: number,
): string {
  const raw = eventId && eventId.length > 0 ? eventId : `${kind}:${planetId ?? 'direct'}:${tick ?? nowMs}`;
  return raw.length <= 128 ? raw : raw.slice(0, 128);
}
