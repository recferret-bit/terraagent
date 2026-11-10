import { describe, expect, it } from 'vitest';
import {
  AWAY_DIRECTIVE_PCT_DEFAULT,
  AWAY_POLICY_VERSION,
  AWAY_SESSION_PCT_DEFAULT,
  AwayDigestV1Schema,
  NOTIFICATION_KINDS,
  NotificationPayloadSchema,
  NotificationSubscriptionSchema,
  SetAutopilotArgsSchema,
  commandDef,
  eventDef,
  parseCommandArgs,
  parseWaves,
  type AwayDigestV1,
} from '../src';

const COLONY = 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const PLAYER = 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV';

/** The acceptance sample: per-family budgets, metals session at 30 %. */
const sample = {
  mode: 'rules_only' as const,
  awayRaids: false,
  awayBudget: {
    metals: { perDirectivePct: AWAY_DIRECTIVE_PCT_DEFAULT, perSessionPct: 30 },
    minerals: { perDirectivePct: AWAY_DIRECTIVE_PCT_DEFAULT, perSessionPct: AWAY_SESSION_PCT_DEFAULT },
    bio: { perDirectivePct: AWAY_DIRECTIVE_PCT_DEFAULT, perSessionPct: AWAY_SESSION_PCT_DEFAULT },
  },
};

const zero = { before: 0, after: 0 };
const resources = {
  'metals.t1': zero, 'metals.t2': zero, 'metals.t3': zero,
  'minerals.t1': zero, 'minerals.t2': zero, 'minerals.t3': zero,
  'bio.water': zero, 'bio.biomass': zero, 'bio.t2': zero, 'bio.t3': zero,
};

function digest(extra: Partial<AwayDigestV1> = {}): AwayDigestV1 {
  return {
    colonyId: COLONY,
    awayFrom: '2026-11-09T12:00:00.000Z',
    awayTo: '2026-11-09T12:10:00.000Z',
    durationS: 600,
    resources,
    energy: zero,
    built: [],
    lost: [],
    robots: { before: 1, after: 1, produced: 0, lost: 0 },
    territory: { before: 7, after: 7 },
    attacks: { count: 0, repelled: 0, byColony: [] },
    hazards: [],
    ai: { decisions: 0, rejected: 0, highlights: [] },
    trades: { settled: 0, items: [] },
    alerts: [],
    ...extra,
  };
}

describe('W09-01 setAutopilot', () => {
  it('keeps the AW-20 defaults that the away data row copies', () => {
    expect(AWAY_DIRECTIVE_PCT_DEFAULT).toBe(40);
    expect(AWAY_SESSION_PCT_DEFAULT).toBe(60);
    expect(AWAY_POLICY_VERSION).toBe(1);
  });

  it('parses the sample with a per-resource budget', () => {
    expect(commandDef('setAutopilot').wave).toBe('W09');
    expect(commandDef('setAutopilot').origin).toBe('client');
    const parsed = SetAutopilotArgsSchema.parse(sample);
    expect(parsed.awayBudget?.metals?.perSessionPct).toBe(30);
    expect(parseCommandArgs('setAutopilot', sample).success).toBe(true);
  });

  it('rejects a budget percent above 100 and below 0', () => {
    const over = { awayBudget: { metals: { perSessionPct: 101 } } };
    expect(parseCommandArgs('setAutopilot', over).success).toBe(false);
    const under = { awayBudget: { bio: { perDirectivePct: -1 } } };
    expect(parseCommandArgs('setAutopilot', under).success).toBe(false);
  });

  it('accepts the 0 and 100 boundaries and a metals-only patch', () => {
    expect(parseCommandArgs('setAutopilot', { awayBudget: { metals: { perSessionPct: 0 } } }).success).toBe(true);
    expect(parseCommandArgs('setAutopilot', { awayBudget: { minerals: { perDirectivePct: 100 } } }).success).toBe(true);
    expect(parseCommandArgs('setAutopilot', { mode: 'director', awayRaids: true }).success).toBe(true);
  });

  it('accepts an away mercenary patch and rejects a fractional or negative max spend', () => {
    expect(parseCommandArgs('setAutopilot', { hireMercenaries: true, mercenaryMaxSpend: 100 }).success).toBe(true);
    expect(parseCommandArgs('setAutopilot', { hireMercenaries: false }).success).toBe(true);
    expect(parseCommandArgs('setAutopilot', { mercenaryMaxSpend: 0 }).success).toBe(true);
    expect(parseCommandArgs('setAutopilot', { mercenaryMaxSpend: 50.5 }).success).toBe(false);
    expect(parseCommandArgs('setAutopilot', { mercenaryMaxSpend: -1 }).success).toBe(false);
    expect(parseCommandArgs('setAutopilot', { mercenaryMaxSpend: 1_000_001 }).success).toBe(false);
  });

  it('rejects an empty command, a fractional percent, oil as a family, and unknown keys', () => {
    expect(parseCommandArgs('setAutopilot', {}).success).toBe(false);
    expect(parseCommandArgs('setAutopilot', { awayBudget: { metals: { perSessionPct: 30.5 } } }).success).toBe(false);
    expect(parseCommandArgs('setAutopilot', { awayBudget: { oil: { perSessionPct: 30 } } }).success).toBe(false);
    expect(parseCommandArgs('setAutopilot', { autoTrade: {} }).success).toBe(false);
    expect(parseCommandArgs('setAutopilot', { awayBudget: {} }).success).toBe(false);
  });
});

describe('W09-01 system.presence and flag', () => {
  it('registers system.presence on W09 and rejects a missing away flag', () => {
    expect(commandDef('system.presence').origin).toBe('module');
    expect(parseCommandArgs('system.presence', { colonyId: COLONY, away: true }).success).toBe(true);
    expect(parseCommandArgs('system.presence', { colonyId: COLONY }).success).toBe(false);
    expect(parseCommandArgs('system.presence', { colonyId: 'nope', away: false }).success).toBe(false);
  });

  it('turns W09 on at ..09 and off at ..08', () => {
    expect(parseWaves('all').has('W09')).toBe(true);
    expect(parseWaves('..09').has('W09')).toBe(true);
    expect(parseWaves('..08').has('W09')).toBe(false);
  });
});

describe('W09-01 events, digest, notify schemas', () => {
  it('lists exactly the eight CT-36 kinds', () => {
    expect([...NOTIFICATION_KINDS]).toEqual([
      'under_attack', 'colony_critical', 'colony_eliminated', 'energy_collapse',
      'rocket_ready', 'truce_offered', 'trade_offer', 'away_budget_exhausted',
    ]);
    expect(NOTIFICATION_KINDS).not.toContain('deed_settled');
    expect(NotificationPayloadSchema.safeParse({
      colonyId: COLONY,
      eventId: 'deed-settled:co_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      kind: 'deed_settled',
      channel: 'telegram',
      to: PLAYER,
      title: 'Colony Deed Settled',
      body: 'sealed',
    }).success).toBe(true);
  });

  it('parses the away events and rejects an unknown resource family', () => {
    const away = { colonyId: COLONY, atTick: 10 };
    expect(eventDef('colonyAway').wave).toBe('W09');
    expect(eventDef('colonyAway').data.safeParse(away).success).toBe(true);
    expect(eventDef('colonyBack').data.safeParse(away).success).toBe(true);
    expect(eventDef('awayBudgetExhausted').data.safeParse({ ...away, resource: 'metals' }).success).toBe(true);
    expect(eventDef('awayBudgetExhausted').data.safeParse({ ...away, resource: 'oil' }).success).toBe(false);
    expect(eventDef('colonyCritical').data.safeParse({ ...away, cause: 'hub_destroyed' }).success).toBe(true);
    expect(eventDef('colonyEliminated').data.safeParse({ ...away, cause: 'timer' }).success).toBe(true);
    expect(eventDef('colonyEliminated').data.safeParse({ ...away, cause: 'nope' }).success).toBe(false);
  });

  it('accepts a digest at the list cap and rejects one past it', () => {
    const item = { displayName: 'Raider', count: 1 };
    expect(AwayDigestV1Schema.safeParse(digest({
      attacks: { count: 20, repelled: 20, byColony: Array.from({ length: 20 }, () => item) },
    })).success).toBe(true);
    expect(AwayDigestV1Schema.safeParse(digest({
      attacks: { count: 21, repelled: 0, byColony: Array.from({ length: 21 }, () => item) },
    })).success).toBe(false);
  });

  it('rejects a story over 600 characters and a payload missing its idempotency key', () => {
    expect(AwayDigestV1Schema.safeParse(digest({ story: 'x'.repeat(600) })).success).toBe(true);
    expect(AwayDigestV1Schema.safeParse(digest({ story: 'x'.repeat(601) })).success).toBe(false);
    const payload = {
      colonyId: COLONY, eventId: 'evt_1', kind: 'under_attack' as const, channel: 'webpush' as const,
      to: 'https://push.example/sub', title: 'Under attack', body: 'A raid reached the Hub.',
    };
    expect(NotificationPayloadSchema.safeParse(payload).success).toBe(true);
    expect(NotificationPayloadSchema.safeParse({ ...payload, eventId: '' }).success).toBe(false);
    expect(NotificationPayloadSchema.safeParse({ ...payload, kind: 'email' }).success).toBe(false);
  });

  it('requires an endpoint for web push and a chat id for telegram', () => {
    const base = { id: 'sub_1', playerId: PLAYER, createdAt: '2026-11-09T12:00:00.000Z' };
    expect(NotificationSubscriptionSchema.safeParse({
      ...base, channel: 'webpush', endpoint: 'https://push.example/sub', keys: { p256dh: 'k', auth: 'a' },
    }).success).toBe(true);
    expect(NotificationSubscriptionSchema.safeParse({ ...base, channel: 'webpush' }).success).toBe(false);
    expect(NotificationSubscriptionSchema.safeParse({ ...base, channel: 'telegram', chatId: '42' }).success).toBe(true);
    expect(NotificationSubscriptionSchema.safeParse({ ...base, channel: 'telegram' }).success).toBe(false);
    expect(NotificationSubscriptionSchema.safeParse({
      ...base, channel: 'webpush', endpoint: 'https://push.example/sub', kinds: { trade_offer: false, email: true },
    }).success).toBe(false);
  });
});

