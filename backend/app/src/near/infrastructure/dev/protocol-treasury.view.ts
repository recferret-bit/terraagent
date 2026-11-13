import type { PrismaClient } from '@terra/db';
import { databaseEnabled } from '../../../core/persistence.js';
import type { AppEnv } from '../../../core/tokens.js';
import { PROTOCOL_ACCOUNT_ID } from '../../../market/orders/market-policy.provider.js';
import { resolveActiveNearNetwork, resolveNearNetworkConfig } from '../network/near-network.config.js';

export interface ProtocolStreamInfo {
  readonly id: string;
  readonly label: string;
  readonly rateSummary: string;
  readonly description: string;
}

export interface TerraAgentProtocolView {
  readonly entityName: 'TerraAgent Protocol';
  readonly nearMode: string;
  readonly network: 'testnet' | 'mainnet';
  readonly protocolAccountId: string;
  readonly relayerAccountId: string;
  readonly feeSchedule: {
    readonly standardPlatformFeeBp: number;
    readonly stakerPlatformFeeBp: number;
    readonly daoCarveOutShareBp: number;
    readonly protocolNetStandardBp: number;
    readonly protocolNetStakerBp: number;
    readonly validatorGrossApyBp: number;
    readonly stakerNetApyBp: number;
    readonly protocolStakingYieldBp: number;
    readonly protocolStakingYieldShareBp: number;
    readonly minStakeForPerksNear: string;
    readonly escrowSlashVictimShareBp: number;
    readonly escrowSlashProtocolShareBp: number;
  };
  readonly balances: Readonly<Record<string, string>>;
  readonly relayerDailyCapNear: number;
  readonly inflows: readonly ProtocolStreamInfo[];
  readonly outflows: readonly ProtocolStreamInfo[];
}

const PROTOCOL_INFLOWS: readonly ProtocolStreamInfo[] = [
  {
    id: 'market_fee',
    label: 'Market Settlement Fee',
    rateSummary: '0.80% standard / 0.40% for >=10 NEAR stakers',
    description: '80% of the 1.00% (or 0.50% staker) platform fee on finalized NEP-413 trades; 20% carves out to the Planet Sputnik DAO.',
  },
  {
    id: 'staking_yield',
    label: 'Validator Staking Yield Share',
    rateSummary: '20% of validator yield (1.80% APY; player keeps 7.20% net APY)',
    description: 'Lossless subscription: principal stays 100% the player’s while 20% of accrued validator yield funds AI & gasless relays.',
  },
  {
    id: 'escrow_slash',
    label: 'Peace & War Escrow Slashing',
    rateSummary: '10% protocol cut (90% paid to betrayed partner / defender)',
    description: 'Triggered when a bonded truce is broken early or a 6h War Bond is canceled/expires without meeting its war objective.',
  },
];

const PROTOCOL_OUTFLOWS: readonly ProtocolStreamInfo[] = [
  {
    id: 'relayer_gas',
    label: 'NEP-366 Gasless Meta-Tx Relayer',
    rateSummary: 'relayer.<root> gas sponsorship',
    description: 'Covers onboarding, Colony Deed updates, NEP-245 cargo exports, and signed delegate actions for F2P & social-auth players.',
  },
  {
    id: 'managed_near_ai',
    label: 'Managed NEAR.AI Autopilot',
    rateSummary: 'z-ai/glm-5.3-flash TEE batching',
    description: 'Funds 24/7 autonomous LLM sweeps for Rival AI colonies and human players staking >= 10 NEAR (custom BYOK keys remain free).',
  },
];

export async function buildProtocolTreasuryView(
  envSource: Record<string, string | undefined>,
  prisma?: PrismaClient,
): Promise<TerraAgentProtocolView> {
  const nearMode = envSource.NEAR_MODE ?? 'mock';
  const activeNet = resolveActiveNearNetwork(null, envSource);
  const cfg = resolveNearNetworkConfig(envSource, activeNet);
  const protocolAccountId = nearMode === 'mock' ? PROTOCOL_ACCOUNT_ID : cfg.accounts.protocol;
  const balances: Record<string, string> = {};

  if (prisma && databaseEnabled(envSource as unknown as AppEnv)) {
    const [chainBals, intentsBals] = await Promise.all([
      prisma.mockChainBalance.findMany({ where: { accountId: PROTOCOL_ACCOUNT_ID } }),
      prisma.mockChainIntentsBalance.findMany({ where: { accountId: PROTOCOL_ACCOUNT_ID } }),
    ]);
    for (const row of chainBals) {
      balances[row.tokenId] = row.amount.toFixed(0);
    }
    for (const row of intentsBals) {
      const prev = BigInt(balances[row.tokenId] ?? '0');
      balances[row.tokenId] = (prev + BigInt(row.amount.toFixed(0))).toString();
    }
  }

  return {
    entityName: 'TerraAgent Protocol',
    nearMode,
    network: activeNet,
    protocolAccountId,
    relayerAccountId: cfg.accounts.relayer,
    feeSchedule: {
      standardPlatformFeeBp: 100,
      stakerPlatformFeeBp: 50,
      daoCarveOutShareBp: 2000,
      protocolNetStandardBp: 80,
      protocolNetStakerBp: 40,
      validatorGrossApyBp: 900,
      stakerNetApyBp: 720,
      protocolStakingYieldBp: 180,
      protocolStakingYieldShareBp: 2000,
      minStakeForPerksNear: '10',
      escrowSlashVictimShareBp: 9000,
      escrowSlashProtocolShareBp: 1000,
    },
    balances,
    relayerDailyCapNear: cfg.relayerDailyCapNear,
    inflows: PROTOCOL_INFLOWS,
    outflows: PROTOCOL_OUTFLOWS,
  };
}
