import {
  dailyAiBudgetUsd,
  dailyAiCallLimit,
  earlyExitFeeBp,
  effectiveTakerFee,
  MANAGED_AI_MODEL,
  NEAR_AI_AVAILABLE_MODELS,
  nextStakingTier,
  SCRIPT_AI_MODEL,
  STAKING_RULES,
  STAKING_TIERS,
  stakingTierFor,
  validateLocalMockPlayerName,
  type PerformanceWindow,
  type PlayerAiSettings,
  type StakingAsset,
  type StakingOverviewResponse,
  type StakingPerformanceResponse,
  type StakingTxRow,
} from '@terra/contracts';
import type { MeFetchFn } from './api';
import {
  activateLocalPersona,
  createInitialPersonaLedger,
  extractPersonaLedger,
  resolveOfflineSocialHandle,
  toMockAccountId,
  type LocalSimState,
} from './parts/localSimPersonas';
import { netApyBp, projectIncome } from './sections/staking/stakingMath';
import { makeW12AchievementsFixture, makeW12ProfileFixture } from './testFixtures';

const STORAGE_KEY = 'ta_me_local_sim_v1';
const DEFAULT_HANDLE = 'Local Commander';
const LOCAL_PLAYER_ID = 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const LOCAL_ACCOUNT = 'local-commander.terraagent.mock';
const LOCAL_POOL = 'astro-stakers.pool.mock';
const LOCAL_PLANET = 'pl_w12_forest';

const initialState = (nowMs: number): LocalSimState => ({
  signedOut: false,
  handle: DEFAULT_HANDLE,
  accountId: LOCAL_ACCOUNT,
  ...createInitialPersonaLedger(nowMs),
});

export function isLocalSimSignedOut(): boolean {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return false;
    return (JSON.parse(raw) as { signedOut?: unknown }).signedOut === true;
  } catch {
    return false;
  }
}

export function isBrowserLocalHost(search?: string): boolean {
  const raw = search ?? (typeof location !== 'undefined' ? location.search : '');
  try {
    return new URLSearchParams(raw).get('host') === 'local';
  } catch {
    return false;
  }
}

const fmt6 = (n: number): string => Math.max(0, Number.isFinite(n) ? n : 0).toFixed(6).replace(/\.?0+$/, '') || '0';

function settle(s: LocalSimState, nowMs: number): void {
  const total = s.nativeStaked + s.stNear + s.liNear;
  const elapsedMs = Math.max(0, nowMs - s.lastAccruedAtMs) * STAKING_RULES.localRewardMultiplier;
  const netBp = netApyBp(STAKING_RULES.simGrossApyBp, STAKING_RULES.protocolYieldShareBp);
  if (total > 0 && elapsedMs > 0) {
    s.accruedNear += (total * (netBp / 10_000) * elapsedMs) / (365 * 86_400_000);
  }
  if (s.unbonding > 0 && s.unbondingReadyAtMs !== null && nowMs >= s.unbondingReadyAtMs) {
    s.withdrawable += s.unbonding;
    s.unbonding = 0;
    s.unbondingReadyAtMs = null;
  }
  s.lastAccruedAtMs = nowMs;
}

function buildPerformance(s: LocalSimState, window: PerformanceWindow, nowMs: number): StakingPerformanceResponse {
  settle(s, nowMs);
  const total = s.nativeStaked + s.stNear + s.liNear;
  const nearUsd = STAKING_RULES.estNearUsd;
  const grossBp = STAKING_RULES.simGrossApyBp;
  const netBp = netApyBp(grossBp, STAKING_RULES.protocolYieldShareBp);
  const tier = stakingTierFor(total);
  const next = nextStakingTier(tier);
  const staked = total > 0;
  const fee = effectiveTakerFee({ tier, stakedSinceMs: staked ? s.stakedSinceMs : null, nowMs, feeWarmupMs: STAKING_RULES.localFeeWarmupMs });
  const exitFee = staked ? earlyExitFeeBp(s.lastStakedAtMs, nowMs, STAKING_RULES.localEarlyExitWindowMs) : 0;
  const budgetUsd = tier.aiColonySlots > 0 ? dailyAiBudgetUsd({ activeStakedNear: total, nearUsd, grossApyBp: grossBp, dailyProtocolTradeFeeUsd: 0 }) : 0;
  const callLimit = tier.aiColonySlots > 0 ? dailyAiCallLimit(budgetUsd) : 0;
  const aiMode = tier.aiColonySlots > 0 ? 'tee' : 'trial';
  const aiModel = tier.aiColonySlots > 0 || aiMode === 'trial' ? MANAGED_AI_MODEL : SCRIPT_AI_MODEL;
  const leadPlanets = tier.id >= 4 && s.nominatedPlanet ? [s.nominatedPlanet] : [];
  const lst = [
    ...(s.stNear > 0 ? [{ asset: 'stNEAR' as const, amount: fmt6(s.stNear), nearValue: fmt6(s.stNear) }] : []),
    ...(s.liNear > 0 ? [{ asset: 'LiNEAR' as const, amount: fmt6(s.liNear), nearValue: fmt6(s.liNear) }] : []),
  ];
  const winDays = window === '1y' ? 365 : window === '90d' ? 90 : 30;
  const realizedVal = s.accruedNear + s.txs.filter((t) => t.kind === 'compound').reduce((acc, t) => acc + Number(t.amountNear), 0);
  const projEnd = realizedVal + (total * (netBp / 10_000) * winDays) / 365;
  return {
    accountId: s.accountId,
    asOfMs: nowMs,
    price: { nearUsd, source: 'est', asOfMs: nowMs },
    apy: { grossApyBp: grossBp, netApyBp: netBp, protocolYieldShareBp: STAKING_RULES.protocolYieldShareBp, source: 'sim' },
    balances: {
      walletNear: fmt6(s.walletNear),
      activeStakedNear: fmt6(s.nativeStaked),
      unbondingNear: fmt6(s.unbonding),
      withdrawableNear: fmt6(s.withdrawable),
      accruedYieldNear: fmt6(s.accruedNear),
      lst,
      totalStakedUsd: total * nearUsd,
    },
    timers: {
      stakedSinceMs: staked ? s.stakedSinceMs : null,
      feeWarmupReadyAtMs: staked ? fee.warmupReadyAtMs : null,
      earlyExitFreeAtMs: exitFee > 0 && s.lastStakedAtMs !== null ? s.lastStakedAtMs + STAKING_RULES.localEarlyExitWindowMs : null,
      earlyExitFeeBp: exitFee,
      unbondingReadyAtMs: s.unbondingReadyAtMs,
    },
    income: { stakingYieldNear: realizedVal, stakingYieldUsd: realizedVal * nearUsd, marketFeeSavingsUsd: 0, stallRoyaltiesUsd: 0, patronRevenueUsd: 0, selfFillsExcluded: 0 },
    projection: projectIncome(total, netBp, nearUsd),
    effectiveApyBp: staked ? netBp : 0,
    perks: {
      version: 2, active: tier.id >= 1, minStakeNear: '10', totalStakedNear: fmt6(total),
      grossApyBp: grossBp, netApyBp: netBp, protocolYieldShareBp: STAKING_RULES.protocolYieldShareBp,
      platformFeeBp: tier.id === 0 ? 100 : fee.takerFeeBp, stakerPlatformFeeBp: tier.takerFeeBp, standardPlatformFeeBp: 100,
      managedAutopilotUnlocked: tier.id >= 1, protocolAccountId: 'protocol.terraagent.mock',
      tier: tier.id, tierKey: tier.key, tierName: tier.name, feeTier: fee.feeTier.id,
      activeStakedNear: fmt6(total), unbondingNear: fmt6(s.unbonding), aiModel, aiMode,
      maxAiColonySlots: tier.aiColonySlots, activeAiColonySlots: tier.aiColonySlots > 0 ? 1 : 0,
      dailyAiCallLimit: callLimit, dailyAiCallsUsed: 0, dailyAiBudgetUsd: budgetUsd, freeTrialTurnsRemaining: 5,
      feeWarmupReadyAtMs: staked ? fee.warmupReadyAtMs : null, earlyExitFeeBp: exitFee,
      earlyExitFreeAtMs: exitFee > 0 && s.lastStakedAtMs !== null ? s.lastStakedAtMs + STAKING_RULES.localEarlyExitWindowMs : null,
      stakedSinceMs: staked ? s.stakedSinceMs : null, gasMultiplier: tier.gasMultiplier, sweepSeconds: tier.sweepSeconds,
      botKeys: tier.botKeys, guildRadarLeadMs: tier.guildRadarLeadMs, daoVoteWeightBp: tier.daoVoteWeightBp,
      stallRoyaltyBonusBp: tier.stallRoyaltyBonusBp, leadPatronPlanetIds: leadPlanets, nextTierMinNear: next ? next.minStakeNear : null,
    },
    aiBudget: {
      model: aiModel, mode: aiMode, dailyBudgetUsd: budgetUsd, dailyBudgetUsedUsd: 0, dailyCallLimit: callLimit,
      dailyCallsUsed: 0, tradeBonusCalls: 0, freeTrialTurnsRemaining: 5, freeTrialTurnsTotal: 5, trialEligible: true,
      colonySlotsUsed: tier.aiColonySlots > 0 ? 1 : 0, colonySlotsMax: tier.aiColonySlots,
    },
    ecosystem: {
      totalNear: fmt6(125_000 + total),
      entries: [
        { id: 'metapool', label: 'Meta Pool · stNEAR', asset: 'stNEAR', tvlNear: fmt6(65_000 + s.stNear), sharePct: 52 },
        { id: 'linear', label: 'LiNEAR', asset: 'LiNEAR', tvlNear: fmt6(35_000 + s.liNear), sharePct: 28 },
        { id: 'validator', label: 'Validators', asset: 'near', tvlNear: fmt6(25_000 + s.nativeStaked), sharePct: 20 },
      ],
    },
    series: {
      window,
      points: [
        { tMs: Math.max(0, nowMs - 60_000), valueNear: 0, kind: 'realized' },
        { tMs: nowMs, valueNear: realizedVal, kind: 'realized' },
        { tMs: nowMs + winDays * 86_400_000, valueNear: projEnd, kind: 'projected' },
      ],
    },
    txs: s.txs.slice(0, 25),
  };
}

function recordTx(s: LocalSimState, kind: StakingTxRow['kind'], amount: number, asset: StakingAsset, nowMs: number): string {
  const txHash = `local_${kind}_${nowMs.toString(36)}_${s.txs.length + 1}`;
  s.txs.unshift({ txHash, kind, amountNear: fmt6(amount), asset, atMs: nowMs, explorerUrl: null });
  return txHash;
}

function debitStakedBuckets(s: LocalSimState, asset: StakingAsset, amount: number): void {
  const keyOf = (a: StakingAsset): 'nativeStaked' | 'stNear' | 'liNear' =>
    a === 'stNEAR' ? 'stNear' : a === 'LiNEAR' ? 'liNear' : 'nativeStaked';
  const order: readonly StakingAsset[] = [asset, ...(['near', 'stNEAR', 'LiNEAR'] as const).filter((a) => a !== asset)];
  let rem = amount;
  for (const a of order) {
    if (rem <= 0) break;
    const k = keyOf(a);
    const take = Math.min(s[k], rem);
    s[k] = Math.max(0, s[k] - take);
    rem -= take;
  }
}

function handleLocalStakingPost(path: string, body: Record<string, unknown>, s: LocalSimState, nowMs: number): { status: number; payload: unknown } {
  settle(s, nowMs);
  const asset = (body.asset === 'stNEAR' || body.asset === 'LiNEAR' ? body.asset : 'near') as StakingAsset;
  const amt = Number(body.amount ?? 0);
  const totalBefore = s.nativeStaked + s.stNear + s.liNear;
  if (path.endsWith('/dev/chain/faucet')) {
    s.walletNear += 500;
    s.usdc += 100;
    return { status: 200, payload: { ok: true, accountId: s.accountId, addedNear: '500', addedUsdc: '100.00', walletBalanceNear: fmt6(s.walletNear), defaultPlanetId: LOCAL_PLANET } };
  }
  if (path.endsWith('/near/stake')) {
    if (!(amt > 0) || s.walletNear < amt) return { status: 400, payload: { message: `Insufficient local wallet balance (${fmt6(s.walletNear)} NEAR available). Use + Local Faucet.` } };
    s.walletNear -= amt;
    if (asset === 'stNEAR') s.stNear += amt;
    else if (asset === 'LiNEAR') s.liNear += amt;
    else s.nativeStaked += amt;
    if (totalBefore <= 0 || s.stakedSinceMs === null) s.stakedSinceMs = nowMs;
    s.lastStakedAtMs = nowMs;
    return { status: 200, payload: { txHash: recordTx(s, 'stake', amt, asset, nowMs) } };
  }
  if (path.endsWith('/near/unstake')) {
    if (!(amt > 0) || totalBefore + 1e-9 < amt) {
      return { status: 400, payload: { message: `Insufficient staked balance (${fmt6(totalBefore)} NEAR total staked).` } };
    }
    debitStakedBuckets(s, asset, amt);
    const feeBp = earlyExitFeeBp(s.lastStakedAtMs, nowMs, STAKING_RULES.localEarlyExitWindowMs);
    const fee = (amt * feeBp) / 10_000;
    s.unbonding += amt - fee;
    s.unbondingReadyAtMs = nowMs + STAKING_RULES.localUnbondingMs;
    if (s.nativeStaked + s.stNear + s.liNear <= 1e-9) {
      s.nativeStaked = 0;
      s.stNear = 0;
      s.liNear = 0;
      s.stakedSinceMs = null;
      s.lastStakedAtMs = null;
    }
    const txHash = recordTx(s, 'unstake', amt, asset, nowMs);
    if (fee > 0) recordTx(s, 'early_exit_fee', fee, asset, nowMs);
    return { status: 200, payload: { txHash } };
  }
  if (path.endsWith('/near/withdraw')) {
    if (!(s.withdrawable > 0)) return { status: 409, payload: { message: 'Unbonding (1m) has not finished yet.' } };
    const payout = s.withdrawable + s.accruedNear;
    s.walletNear += payout;
    s.withdrawable = 0;
    s.accruedNear = 0;
    return { status: 200, payload: { txHash: recordTx(s, 'withdraw', payout, asset, nowMs) } };
  }
  if (path.endsWith('/near/stake/compound')) {
    if (!(s.accruedNear > 0)) return { status: 409, payload: { message: 'No accrued yield to compound yet.' } };
    const comp = s.accruedNear;
    const compAsset: StakingAsset = s.nativeStaked <= 0 && s.stNear > 0 ? 'stNEAR' : s.nativeStaked <= 0 && s.liNear > 0 ? 'LiNEAR' : 'near';
    if (compAsset === 'stNEAR') s.stNear += comp;
    else if (compAsset === 'LiNEAR') s.liNear += comp;
    else s.nativeStaked += comp;
    s.accruedNear = 0;
    return { status: 200, payload: { txHash: recordTx(s, 'compound', comp, compAsset, nowMs) } };
  }
  if (path.endsWith('/near/stake/profits')) {
    const usdcAmt = Number(body.amountUsdc ?? 0);
    if (!(usdcAmt > 0) || s.usdc < usdcAmt) return { status: 400, payload: { message: `Insufficient local USDC profits ($${s.usdc.toFixed(2)} available). Use + Local Faucet.` } };
    const outNear = usdcAmt / STAKING_RULES.estNearUsd;
    s.usdc -= usdcAmt;
    s.stNear += outNear;
    if (totalBefore <= 0 || s.stakedSinceMs === null) s.stakedSinceMs = nowMs;
    s.lastStakedAtMs = nowMs;
    const txHash = recordTx(s, 'stake_profits', outNear, 'stNEAR', nowMs);
    return {
      status: 200,
      payload: {
        quote: { amountInUsdc: String(body.amountUsdc), amountInAtomic: String(Math.round(usdcAmt * 1e6)), amountOutNear: fmt6(outNear), nearUsd: STAKING_RULES.estNearUsd, source: 'mock', dry: false },
        txHash, position: null, walletBalanceNear: fmt6(s.walletNear),
      },
    };
  }
  if (path.endsWith('/near/staking/patron/nominate')) {
    const planetId = String(body.planetId ?? '').trim();
    if (!planetId) return { status: 400, payload: { message: 'Enter a public planet ID to nominate.' } };
    s.nominatedPlanet = planetId;
    const isLead = s.nativeStaked + s.stNear + s.liNear >= 500;
    return { status: 200, payload: { accountId: s.accountId, planetId, isLeadPatron: isLead, leadPatron: isLead ? { planetId, accountId: s.accountId, carrierName: `ISS ${s.accountId}`, activeStakedNear: fmt6(s.nativeStaked + s.stNear + s.liNear), sinceMs: nowMs, protocolFeeShareBp: 1500 } : null } };
  }
  return { status: 404, payload: { message: 'Not found' } };
}

function handleLocalAuthAndMe(
  pathname: string,
  method: string,
  body: Record<string, unknown>,
  s: LocalSimState,
  nowMs: number,
  save: (next: LocalSimState) => void,
): { status: number; payload: unknown } | null {
  if (pathname === '/v1/auth/logout') {
    s.signedOut = true;
    save(s);
    return { status: 200, payload: { ok: true } };
  }
  if (pathname === '/v1/dev/mock-oauth/login' && method === 'POST') {
    const checked = validateLocalMockPlayerName(body.playerName);
    if (!checked.ok) return { status: 400, payload: { message: checked.message, error: { message: checked.message } } };
    activateLocalPersona(s, checked.value, toMockAccountId(checked.value), nowMs);
    save(s);
    return { status: 200, payload: { accessToken: 'local-mode-token', expiresIn: 900, accountId: s.accountId, player: { id: LOCAL_PLAYER_ID, handle: s.handle, isGuest: false } } };
  }
  if (pathname === '/v1/auth/social' && method === 'POST') {
    const socialHandle = resolveOfflineSocialHandle(body.provider, body.token);
    if (socialHandle) {
      activateLocalPersona(s, socialHandle, toMockAccountId(socialHandle), nowMs);
    } else {
      s.signedOut = false;
    }
    save(s);
    return { status: 200, payload: { accessToken: 'local-mode-token', expiresIn: 900, accountId: s.accountId, player: { id: LOCAL_PLAYER_ID, handle: s.handle, isGuest: false } } };
  }
  if (pathname === '/v1/auth/refresh') {
    if (s.signedOut) return { status: 401, payload: { errorCode: 'UNAUTHORIZED', message: 'Signed out' } };
    return { status: 200, payload: { accessToken: 'local-mode-token', accountId: s.accountId, player: { id: LOCAL_PLAYER_ID, handle: s.handle, isGuest: false } } };
  }
  if (!pathname.startsWith('/v1/me/')) return null;
  if (s.signedOut) return { status: 401, payload: { errorCode: 'UNAUTHORIZED', message: 'Sign in required' } };
  if (pathname === '/v1/me/profile/handle' && method === 'PUT') {
    const checked = validateLocalMockPlayerName(body.handle);
    if (!checked.ok) return { status: 400, payload: { message: checked.message } };
    s.handle = checked.value;
    save(s);
    return { status: 200, payload: { handle: s.handle } };
  }
  if (pathname === '/v1/me/profile') {
    settle(s, nowMs);
    const total = s.nativeStaked + s.stNear + s.liNear;
    const aiSettings: PlayerAiSettings = {
      hasApiKey: s.hasApiKey, apiKeyPreview: s.apiKeyPreview, model: s.aiModel,
      availableModels: [...NEAR_AI_AVAILABLE_MODELS], stakerAutopilotActive: total >= 10, stakedNear: fmt6(total),
    };
    const base = makeW12ProfileFixture(s.handle);
    return { status: 200, payload: { ...base, identity: { ...base.identity, playerId: LOCAL_PLAYER_ID, handle: s.handle, accountId: s.accountId, isGuest: false }, aiSettings } };
  }
  if (pathname === '/v1/me/achievements') return { status: 200, payload: makeW12AchievementsFixture() };
  if (pathname === '/v1/me/ai-settings' && method === 'PUT') {
    if (typeof body.model === 'string') s.aiModel = body.model;
    if (body.apiKey === null) { s.hasApiKey = false; s.apiKeyPreview = null; }
    else if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
      const k = body.apiKey.trim();
      s.hasApiKey = true;
      s.apiKeyPreview = `${k.slice(0, 4)}••••${k.slice(-4)}`;
    }
    save(s);
    const total = s.nativeStaked + s.stNear + s.liNear;
    return { status: 200, payload: { hasApiKey: s.hasApiKey, apiKeyPreview: s.apiKeyPreview, model: s.aiModel, availableModels: [...NEAR_AI_AVAILABLE_MODELS], stakerAutopilotActive: total >= 10, stakedNear: fmt6(total) } };
  }
  if (pathname === '/v1/me/ai-settings/verify') {
    const total = s.nativeStaked + s.stNear + s.liNear;
    if (!s.hasApiKey && total < 10) return { status: 400, payload: { ok: false, message: 'Save a BYOK key or stake ≥10 NEAR in Staking to unlock TEE verification.' } };
    return { status: 200, payload: { ok: true, model: s.hasApiKey ? s.aiModel : MANAGED_AI_MODEL, managedStaker: !s.hasApiKey, attestation: null } };
  }
  return null;
}

function handleLocalStakingGet(u: URL, s: LocalSimState, nowMs: number, save: (next: LocalSimState) => void): { status: number; payload: unknown } | null {
  if (u.pathname === '/v1/near/staking/overview') {
    const amount = Math.max(0, Number(u.searchParams.get('amount') ?? STAKING_RULES.defaultPreviewNear) || 0);
    const netBp = netApyBp(STAKING_RULES.simGrossApyBp, STAKING_RULES.protocolYieldShareBp);
    const ov: StakingOverviewResponse = {
      asOfMs: nowMs, network: 'mock',
      price: { nearUsd: STAKING_RULES.estNearUsd, source: 'est', asOfMs: nowMs },
      apy: { grossApyBp: STAKING_RULES.simGrossApyBp, netApyBp: netBp, protocolYieldShareBp: STAKING_RULES.protocolYieldShareBp, source: 'sim' },
      tiers: [...STAKING_TIERS],
      rules: {
        feeWarmupMs: STAKING_RULES.localFeeWarmupMs, earlyExitWindowMs: STAKING_RULES.localEarlyExitWindowMs,
        earlyExitFeeBp: STAKING_RULES.earlyExitFeeBp, freeTrialTurns: STAKING_RULES.freeTrialTurns,
        standardTakerFeeBp: STAKING_TIERS[0]!.takerFeeBp, unbondingMs: STAKING_RULES.localUnbondingMs,
        rewardRateMultiplier: STAKING_RULES.localRewardMultiplier,
      },
      projection: projectIncome(amount, netBp, STAKING_RULES.estNearUsd),
      ecosystem: buildPerformance(s, '30d', nowMs).ecosystem,
    };
    return { status: 200, payload: ov };
  }
  if (u.pathname === '/v1/near/staking') {
    return { status: 200, payload: { accountId: s.accountId, pools: [{ poolId: LOCAL_POOL }], positions: [{ pool: LOCAL_POOL, staked: fmt6(s.nativeStaked) }] } };
  }
  if (u.pathname === '/v1/near/staking/performance') {
    const w = (u.searchParams.get('window') ?? '30d') as PerformanceWindow;
    const perf = buildPerformance(s, w === '90d' || w === '1y' ? w : '30d', nowMs);
    save(s);
    return { status: 200, payload: perf };
  }
  return null;
}

/** Creates a self-contained in-browser `MeFetchFn` for `/me.html?host=local` with 1-minute staking cycles. */
export function createLocalModeFetch(now: () => number = Date.now): MeFetchFn {
  let mem: LocalSimState | null = null;
  const load = (): LocalSimState => {
    if (mem) return mem;
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (raw) {
        mem = { ...initialState(now()), ...(JSON.parse(raw) as Partial<LocalSimState>) };
        return mem;
      }
    } catch { /* ignore */ }
    mem = initialState(now());
    return mem;
  };
  const save = (s: LocalSimState): void => {
    if (s.accountId) {
      s.personas = { ...(s.personas ?? {}), [s.accountId]: extractPersonaLedger(s) };
    }
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  };
  const reply = (status: number, payload: unknown) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => payload });

  return async (input, init) => {
    const u = new URL(input, 'http://local.terra');
    const nowMs = now();
    const s = load();
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    const authOrMe = handleLocalAuthAndMe(u.pathname, method, body, s, nowMs, save);
    if (authOrMe) return reply(authOrMe.status, authOrMe.payload);

    const stakingGet = method === 'GET' ? handleLocalStakingGet(u, s, nowMs, save) : null;
    if (stakingGet) return reply(stakingGet.status, stakingGet.payload);

    if (method === 'POST') {
      const res = handleLocalStakingPost(u.pathname, body, s, nowMs);
      save(s);
      return reply(res.status, res.payload);
    }
    return reply(404, { message: 'Not found' });
  };
}
