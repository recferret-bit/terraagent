import { RESOURCE_KEYS, tokenKeyOfVerifierId } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { databaseEnabled } from '../../../core/persistence.js';
import type { AppEnv } from '../../../core/tokens.js';
import { PROTOCOL_ACCOUNT_ID } from '../../../market/orders/market-policy.provider.js';
import { readMainnetVerifierBalances } from '../adapters/real/mainnet-intents-rpc.js';
import {
  resolveActiveNearNetwork,
  resolveNearNetworkConfig,
  type NearNetworkConfig,
} from '../network/near-network.config.js';
import { resolveProtocolFeeSchedule } from '../network/protocol-fee.config.js';
import { NearRpcClient } from '../rpc/near-rpc.client.js';
import { isW28Enabled } from '../../staking/perks/legacy-ladder.js';

export type ProtocolRpcReader = Pick<NearRpcClient, 'config' | 'network' | 'view' | 'withFailover'>;

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
    readonly tierTakerFeeBp?: readonly [number, number, number, number, number];
    readonly daoCarveOutShareBp: number;
    readonly protocolNetStandardBp: number;
    readonly protocolNetStakerBp: number;
    readonly protocolNetTier4Bp?: number;
    readonly leadPatronProtocolShareBp?: number;
    readonly freeTrialTurns?: number;
    readonly validatorGrossApyBp: number;
    readonly stakerNetApyBp: number;
    readonly protocolStakingYieldBp: number;
    readonly protocolStakingYieldShareBp: number;
    readonly minStakeForPerksNear: string;
    readonly escrowSlashVictimShareBp: number;
    readonly escrowSlashProtocolShareBp: number;
  };
  readonly balances: Readonly<Record<string, string>>;
  readonly testnetVerifierLedger?: Readonly<Record<string, string>>;
  readonly relayerDailyCapNear: number;
  readonly inflows: readonly ProtocolStreamInfo[];
  readonly outflows: readonly ProtocolStreamInfo[];
}

function buildInflows(sched: ReturnType<typeof resolveProtocolFeeSchedule>, w28: boolean): readonly ProtocolStreamInfo[] {
  const fmtPct = (bp: number) => `${(bp / 100).toFixed(2)}%`;
  const daoPct = Math.round(sched.daoCarveOutShareBp / 100);
  const protoSharePct = 100 - daoPct;
  const yieldProtoPct = Math.round(sched.protocolStakingYieldShareBp / 100);
  const slashProtoPct = Math.round(sched.escrowSlashProtocolShareBp / 100);
  const slashVictimPct = 100 - slashProtoPct;
  const protoT4Bp = Math.floor((25 * (10_000 - sched.daoCarveOutShareBp)) / 10_000);
  return [
    {
      id: 'market_fee',
      label: 'Market Settlement Fee',
      rateSummary: w28
        ? `${fmtPct(sched.protocolNetStandardBp)} standard / ${fmtPct(sched.protocolNetStakerBp)}–${fmtPct(protoT4Bp)} across Tiers 1–4 (>=${sched.minStakeForPerksNear}–500+ NEAR)`
        : `${fmtPct(sched.protocolNetStandardBp)} standard / ${fmtPct(sched.protocolNetStakerBp)} for >=${sched.minStakeForPerksNear} NEAR stakers`,
      description: w28
        ? `${protoSharePct}% of the ${fmtPct(sched.standardPlatformFeeBp)} (or 0.65%–0.25% 4-tier staker) platform fee on finalized NEP-413 trades; ${daoPct}% carves out to the Planet Council DAO and 15% of Protocol's cut settles to the planet's Tier 4 Lead Patron.`
        : `${protoSharePct}% of the ${fmtPct(sched.standardPlatformFeeBp)} (or ${fmtPct(sched.stakerPlatformFeeBp)} staker) platform fee on finalized NEP-413 trades; ${daoPct}% carves out to the Planet Council DAO.`,
    },
    {
      id: 'staking_yield',
      label: 'Validator Staking Yield Share',
      rateSummary: `${yieldProtoPct}% of validator yield (${fmtPct(sched.protocolStakingYieldBp)} APY; player keeps ${fmtPct(sched.stakerNetApyBp)} net APY)`,
      description: w28
        ? `Wallet-first 4-tier lossless patronage (native NEAR, stNEAR, LiNEAR): principal stays 100% the player's while ${yieldProtoPct}% of accrued validator yield funds AI & gasless relays.`
        : `Lossless subscription: principal stays 100% the player’s while ${yieldProtoPct}% of accrued validator yield funds AI & gasless relays.`,
    },
    {
      id: 'escrow_slash',
      label: 'Peace & War Escrow Slashing',
      rateSummary: `${slashProtoPct}% protocol cut (${slashVictimPct}% paid to betrayed partner / defender)`,
      description: 'Triggered when a bonded truce is broken early or a 6h War Bond is canceled/expires without meeting its war objective.',
    },
  ];
}

function buildOutflows(sched: ReturnType<typeof resolveProtocolFeeSchedule>, w28: boolean): readonly ProtocolStreamInfo[] {
  return [
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
      description: w28
        ? `Funds 24/7 autonomous LLM sweeps for Rival AI colonies, 5 free TEE trial turns for verified pilots, and 1–12 colony slots for wallets staking >= ${sched.minStakeForPerksNear} NEAR (capped at 35% of protocol income for >= 65% margin; custom BYOK keys remain free).`
        : `Funds 24/7 autonomous LLM sweeps for Rival AI colonies and human players staking >= ${sched.minStakeForPerksNear} NEAR (custom BYOK keys remain free).`,
    },
  ];
}

function addBalance(balances: Record<string, string>, tokenId: string, delta: bigint, allowZero = false): void {
  if (!allowZero && delta <= 0n && !(tokenId in balances)) return;
  const prev = BigInt(balances[tokenId] ?? '0');
  balances[tokenId] = (prev + delta).toString();
}

function withRpcTimeout<T>(op: Promise<T>, ms = 3_500): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('rpc_timeout')), ms);
    op.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function hydrateLiveProtocolBalances(
  rpc: ProtocolRpcReader,
  cfg: NearNetworkConfig,
  protocolAccountId: string,
  balances: Record<string, string>,
): Promise<void> {
  const tasks: Promise<void>[] = [
    withRpcTimeout(rpc.withFailover((p) => p.viewAccount({ accountId: protocolAccountId })))
      .then((acct) => addBalance(balances, 'NEAR', BigInt(acct.amount)))
      .catch(() => undefined),
    withRpcTimeout(rpc.view<string>(cfg.contracts.staking, 'get_protocol_yield_balance', {}))
      .then((raw) => {
        const yieldYocto = BigInt(raw ?? '0');
        if (yieldYocto > 0n) balances.STAKING_YIELD_NEAR = yieldYocto.toString();
      })
      .catch(() => undefined),
    withRpcTimeout(
      rpc.view<readonly string[]>(cfg.contracts.res, 'mt_batch_balance_of', {
        account_id: protocolAccountId,
        token_ids: [...RESOURCE_KEYS],
      }),
    )
      .then((amounts) => {
        for (let i = 0; i < RESOURCE_KEYS.length; i += 1) {
          const key = RESOURCE_KEYS[i];
          if (key) addBalance(balances, key, BigInt(amounts?.[i] ?? '0'));
        }
      })
      .catch(() => undefined),
  ];

  if (cfg.network === 'mainnet') {
    tasks.push(
      withRpcTimeout(readMainnetVerifierBalances(rpc as NearRpcClient, protocolAccountId))
        .then((verifierBals) => {
          for (const [tokenKey, amt] of Object.entries(verifierBals)) {
            if (amt !== undefined) addBalance(balances, tokenKey, amt);
          }
        })
        .catch(() => undefined),
    );
  }
  await Promise.all(tasks);
}

async function hydrateDbProtocolBalances(
  prisma: PrismaClient,
  nearMode: string,
  activeNet: 'testnet' | 'mainnet',
  protocolAccountId: string,
  balances: Record<string, string>,
  testnetVerifierLedger: Record<string, string>,
): Promise<void> {
  const accountIds = Array.from(new Set([PROTOCOL_ACCOUNT_ID, protocolAccountId]));
  if (nearMode === 'mock') {
    const [chainBals, intentsBals] = await Promise.all([
      prisma.mockChainBalance.findMany({ where: { accountId: { in: accountIds } } }),
      prisma.mockChainIntentsBalance.findMany({ where: { accountId: { in: accountIds } } }),
    ]);
    for (const row of chainBals) addBalance(balances, row.tokenId, BigInt(row.amount.toFixed(0)), true);
    for (const row of intentsBals) addBalance(balances, row.tokenId, BigInt(row.amount.toFixed(0)), true);
    return;
  }
  if (activeNet !== 'testnet') return;
  const intentsBals = await prisma.mockChainIntentsBalance.findMany({ where: { accountId: { in: accountIds } } });
  for (const row of intentsBals) {
    if (row.tokenId.includes('.mock') || row.tokenId === 'native:near') continue;
    addBalance(testnetVerifierLedger, tokenKeyOfVerifierId(row.tokenId) ?? row.tokenId, BigInt(row.amount.toFixed(0)));
  }
}

export async function buildProtocolTreasuryView(
  envSource: Record<string, string | undefined>,
  prisma?: PrismaClient,
  rpcClient?: ProtocolRpcReader,
): Promise<TerraAgentProtocolView> {
  const nearMode = envSource.NEAR_MODE ?? 'mock';
  const activeNet = resolveActiveNearNetwork(null, envSource);
  const cfg = resolveNearNetworkConfig(envSource, activeNet);
  const protocolAccountId =
    nearMode === 'mock' ? envSource.NEAR_PROTOCOL_ACCOUNT?.trim() || PROTOCOL_ACCOUNT_ID : cfg.accounts.protocol;
  const w28 = isW28Enabled(envSource);
  const sched = resolveProtocolFeeSchedule(envSource, { w28 });
  const balances: Record<string, string> = {};
  const testnetVerifierLedger: Record<string, string> = {};

  if (prisma && databaseEnabled(envSource as unknown as AppEnv)) {
    await hydrateDbProtocolBalances(prisma, nearMode, activeNet, protocolAccountId, balances, testnetVerifierLedger);
  }

  if (nearMode !== 'mock') {
    const rpc =
      rpcClient ??
      (envSource.VITEST !== 'true' && process.env.VITEST !== 'true' ? new NearRpcClient(cfg) : undefined);
    if (rpc) {
      await hydrateLiveProtocolBalances(rpc, cfg, protocolAccountId, balances);
    }
  }

  return {
    entityName: 'TerraAgent Protocol',
    nearMode,
    network: activeNet,
    protocolAccountId,
    relayerAccountId: cfg.accounts.relayer,
    feeSchedule: {
      standardPlatformFeeBp: sched.standardPlatformFeeBp,
      stakerPlatformFeeBp: sched.stakerPlatformFeeBp,
      ...(w28
        ? {
            tierTakerFeeBp: [100, 65, 50, 35, 25] as const,
            protocolNetTier4Bp: Math.floor((25 * (10_000 - sched.daoCarveOutShareBp)) / 10_000),
            leadPatronProtocolShareBp: 1500,
            freeTrialTurns: 5,
          }
        : {}),
      daoCarveOutShareBp: sched.daoCarveOutShareBp,
      protocolNetStandardBp: sched.protocolNetStandardBp,
      protocolNetStakerBp: sched.protocolNetStakerBp,
      validatorGrossApyBp: sched.validatorGrossApyBp,
      stakerNetApyBp: sched.stakerNetApyBp,
      protocolStakingYieldBp: sched.protocolStakingYieldBp,
      protocolStakingYieldShareBp: sched.protocolStakingYieldShareBp,
      minStakeForPerksNear: sched.minStakeForPerksNear,
      escrowSlashVictimShareBp: sched.escrowSlashVictimShareBp,
      escrowSlashProtocolShareBp: sched.escrowSlashProtocolShareBp,
    },
    balances,
    ...(Object.keys(testnetVerifierLedger).length > 0 ? { testnetVerifierLedger } : {}),
    relayerDailyCapNear: cfg.relayerDailyCapNear,
    inflows: buildInflows(sched, w28),
    outflows: buildOutflows(sched, w28),
  };
}
