import type { TradeAllowance } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { databaseEnabled } from '../../core/persistence.js';
import type { AppEnv } from '../../core/tokens.js';
import { nearAdapterFor } from '../../near/infrastructure/adapter-selection.js';
import { dayStart, type AllowanceUsage, type ReferencePrice } from '../../market/trade/allowance.js';
import {
  validateAgentGuardrails,
  type AgentDirective,
  type ColonyObservation,
} from './colony-agent-types.js';

export function sanitizeObservationName(raw: string): string {
  const cleaned = raw
    .replace(/[\r\n\t"'`<>\\{}[\]]/g, ' ')
    .replace(/[^A-Za-z0-9 _.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'Colony').slice(0, 32);
}

export function sanitizeObservationForPrompt(obs: ColonyObservation): ColonyObservation {
  return {
    ...obs,
    name: `<untrusted_player_label>${sanitizeObservationName(obs.name)}</untrusted_player_label>`,
  };
}

export function canonicalReferencePrice(pair: string): ReferencePrice {
  const [, quote = 'minerals.t1'] = pair.split('/');
  if (quote === 'USDC') return { num: 1_000_000n, den: 1n };
  if (quote === 'NEAR') return { num: 1_000_000_000_000_000_000_000_000n, den: 1n };
  return { num: 1n, den: 1n };
}

export function shouldAutoFundTradeAccount(obs: ColonyObservation, env?: AppEnv): boolean {
  if (obs.isBot) return true;
  const envMap = (env ?? process.env) as Record<string, string | undefined>;
  if (nearAdapterFor('Intents', envMap) === 'mock') return true;
  return envMap.TA_DEV_AUTO_FUND_AI_TRADES === 'true';
}

export async function evaluateTradeGovernance(
  prisma: PrismaClient | undefined,
  env: AppEnv | undefined,
  params: {
    readonly planetId: string;
    readonly colonyId: string;
    readonly obs: ColonyObservation;
    readonly directive: AgentDirective;
    readonly baseAllowance: TradeAllowance;
    readonly baseUsage: AllowanceUsage;
    readonly nowMs?: number;
  },
): Promise<string | null> {
  const { planetId, colonyId, obs, directive, baseAllowance, baseUsage } = params;
  const pair = directive.tradePair ?? 'metals.t1/minerals.t1';
  let effectiveAllowance = baseAllowance;
  let outstandingOrders = baseUsage.outstandingOrders;
  let committedToday = baseUsage.committedToday;

  const liveDb = prisma && env && databaseEnabled(env) ? prisma : null;
  if (liveDb) {
    const kills = await liveDb.directorKillSwitch.findMany({
      where: {
        scope: { in: ['global', `planet:${planetId}`, `colony:${colonyId}`] },
        enabled: true,
      },
    });
    if (kills.length > 0) return 'KILL_SWITCH_ACTIVE';

    const policy = await liveDb.directorPolicyRecord.findUnique({ where: { colonyId } });
    const doc = policy?.document as { pause?: unknown; killSwitch?: unknown; allowedPairs?: unknown } | undefined;
    if (doc?.pause === true || doc?.killSwitch === true) return 'POLICY_PAUSED';
    if (Array.isArray(doc?.allowedPairs) && doc.allowedPairs.every((p) => typeof p === 'string')) {
      effectiveAllowance = { ...effectiveAllowance, allowedPairs: doc.allowedPairs as string[] };
    }

    if (!obs.isBot && directive.action === 'trade') {
      const dKey = await liveDb.directorKey.findUnique({ where: { colonyId } });
      if (dKey && dKey.revokedAt !== null) return 'DIRECTOR_KEY_REVOKED';
    }

    if (directive.action === 'trade') {
      const start = dayStart(params.nowMs ?? Date.now());
      const [openCount, todaysOrders] = await Promise.all([
        liveDb.marketOrder.count({
          where: { colonyId, state: { in: ['PENDING', 'OPEN', 'PARTIAL'] } },
        }),
        liveDb.marketOrder.findMany({
          where: { colonyId, createdAt: { gte: start } },
          select: { priceAmount: true },
        }),
      ]);
      outstandingOrders = Math.max(outstandingOrders, openCount);
      let dbCommitted = 0n;
      for (const row of todaysOrders) {
        try {
          dbCommitted += BigInt(row.priceAmount.toFixed(0));
        } catch {
          // ignore malformed decimal
        }
      }
      if (dbCommitted > committedToday) committedToday = dbCommitted;
    }
  }

  const usage: AllowanceUsage = {
    outstandingOrders,
    committedToday,
    reference: baseUsage.reference ?? (!obs.isBot ? canonicalReferencePrice(pair) : null),
  };
  return validateAgentGuardrails(directive, obs, effectiveAllowance, usage);
}
