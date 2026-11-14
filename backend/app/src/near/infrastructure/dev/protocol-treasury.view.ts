import { RESOURCE_KEYS } from '@terra/contracts';
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

function buildInflows(sched: ReturnType<typeof resolveProtocolFeeSchedule>): readonly ProtocolStreamInfo[] {
  const fmtPct = (bp: number) => `${(bp / 100).toFixed(2)}%`;
  const daoPct = Math.round(sched.daoCarveOutShareBp / 100);
  const protoSharePct = 100 - daoPct;
  const yieldProtoPct = Math.round(sched.protocolStakingYieldShareBp / 100);
  const slashProtoPct = Math.round(sched.escrowSlashProtocolShareBp / 100);
  const slashVictimPct = 100 - slashProtoPct;
  return [
    {
      id: 'market_fee',
      label: 'Market Settlement Fee',
      rateSummary: `${fmtPct(sched.protocolNetStandardBp)} standard / ${fmtPct(sched.protocolNetStakerBp)} for >=${sched.minStakeForPerksNear} NEAR stakers`,
      description: `${protoSharePct}% of the ${fmtPct(sched.standardPlatformFeeBp)} (or ${fmtPct(sched.stakerPlatformFeeBp)} staker) platform fee on finalized NEP-413 trades; ${daoPct}% carves out to the Planet Sputnik DAO.`,
    },
    {
      id: 'staking_yield',
      label: 'Validator Staking Yield Share',
      rateSummary: `${yieldProtoPct}% of validator yield (${fmtPct(sched.protocolStakingYieldBp)} APY; player keeps ${fmtPct(sched.stakerNetApyBp)} net APY)`,
      description: `Lossless subscription: principal stays 100% the player’s while ${yieldProtoPct}% of accrued validator yield funds AI & gasless relays.`,
    },
    {
      id: 'escrow_slash',
      label: 'Peace & War Escrow Slashing',
      rateSummary: `${slashProtoPct}% protocol cut (${slashVictimPct}% paid to betrayed partner / defender)`,
      description: 'Triggered when a bonded truce is broken early or a 6h War Bond is canceled/expires without meeting its war objective.',
    },
  ];
}

function buildOutflows(sched: ReturnType<typeof resolveProtocolFeeSchedule>): readonly ProtocolStreamInfo[] {
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
      description: `Funds 24/7 autonomous LLM sweeps for Rival AI colonies and human players staking >= ${sched.minStakeForPerksNear} NEAR (custom BYOK keys remain free).`,
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
  const sched = resolveProtocolFeeSchedule(envSource);
  const balances: Record<string, string> = {};

  if (prisma && databaseEnabled(envSource as unknown as AppEnv)) {
    const accountIds = Array.from(new Set([PROTOCOL_ACCOUNT_ID, protocolAccountId]));
    if (nearMode === 'mock') {
      const [chainBals, intentsBals] = await Promise.all([
        prisma.mockChainBalance.findMany({ where: { accountId: { in: accountIds } } }),
        prisma.mockChainIntentsBalance.findMany({ where: { accountId: { in: accountIds } } }),
      ]);
      for (const row of chainBals) {
        addBalance(balances, row.tokenId, BigInt(row.amount.toFixed(0)), true);
      }
      for (const row of intentsBals) {
        addBalance(balances, row.tokenId, BigInt(row.amount.toFixed(0)), true);
      }
    } else if (activeNet === 'testnet') {
      const intentsBals = await prisma.mockChainIntentsBalance.findMany({
        where: { accountId: { in: accountIds } },
      });
      for (const row of intentsBals) {
        addBalance(balances, row.tokenId, BigInt(row.amount.toFixed(0)), true);
      }
    }
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
    relayerDailyCapNear: cfg.relayerDailyCapNear,
    inflows: buildInflows(sched),
    outflows: buildOutflows(sched),
  };
}
