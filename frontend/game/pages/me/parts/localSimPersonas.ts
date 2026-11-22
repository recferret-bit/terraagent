import {
  DEFAULT_PLAYER_NEAR_AI_MODEL,
  validateLocalMockPlayerName,
  type StakingTxRow,
} from '@terra/contracts';

export interface LocalPersonaLedger {
  walletNear: number;
  usdc: number;
  nativeStaked: number;
  stNear: number;
  liNear: number;
  unbonding: number;
  unbondingReadyAtMs: number | null;
  withdrawable: number;
  accruedNear: number;
  lastAccruedAtMs: number;
  stakedSinceMs: number | null;
  lastStakedAtMs: number | null;
  nominatedPlanet: string | null;
  txs: StakingTxRow[];
  aiModel: string;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
}

export interface LocalSimState extends LocalPersonaLedger {
  signedOut: boolean;
  handle: string;
  accountId: string;
  personas?: Record<string, LocalPersonaLedger>;
}

export function createInitialPersonaLedger(nowMs: number): LocalPersonaLedger {
  return {
    walletNear: 1000,
    usdc: 250,
    nativeStaked: 0,
    stNear: 0,
    liNear: 0,
    unbonding: 0,
    unbondingReadyAtMs: null,
    withdrawable: 0,
    accruedNear: 0,
    lastAccruedAtMs: nowMs,
    stakedSinceMs: null,
    lastStakedAtMs: null,
    nominatedPlanet: null,
    txs: [],
    aiModel: DEFAULT_PLAYER_NEAR_AI_MODEL,
    hasApiKey: false,
    apiKeyPreview: null,
  };
}

export function extractPersonaLedger(s: LocalSimState): LocalPersonaLedger {
  return {
    walletNear: s.walletNear,
    usdc: s.usdc,
    nativeStaked: s.nativeStaked,
    stNear: s.stNear,
    liNear: s.liNear,
    unbonding: s.unbonding,
    unbondingReadyAtMs: s.unbondingReadyAtMs,
    withdrawable: s.withdrawable,
    accruedNear: s.accruedNear,
    lastAccruedAtMs: s.lastAccruedAtMs,
    stakedSinceMs: s.stakedSinceMs,
    lastStakedAtMs: s.lastStakedAtMs,
    nominatedPlanet: s.nominatedPlanet,
    txs: [...s.txs],
    aiModel: s.aiModel,
    hasApiKey: s.hasApiKey,
    apiKeyPreview: s.apiKeyPreview,
  };
}

export function toMockAccountId(handle: string): string {
  const slug = handle
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  return `${slug.length >= 2 ? slug : 'pilot'}.terraagent.mock`;
}

/** Switches active local mock persona while snapshotting and restoring per-`accountId` simulated ledgers. */
export function activateLocalPersona(
  s: LocalSimState,
  nextHandle: string,
  nextAccountId: string,
  nowMs: number,
): void {
  const map: Record<string, LocalPersonaLedger> = { ...(s.personas ?? {}) };
  if (s.accountId) {
    map[s.accountId] = extractPersonaLedger(s);
  }
  const target = map[nextAccountId] ?? createInitialPersonaLedger(nowMs);
  Object.assign(s, target, {
    handle: nextHandle,
    accountId: nextAccountId,
    signedOut: false,
    personas: map,
  });
}

/** Sanitizes simulated social/email tokens into a valid `2..32` pilot handle on `?host=local`. */
export function resolveOfflineSocialHandle(provider: unknown, token: unknown): string | null {
  if (provider === 'email' && typeof token === 'string') {
    const rawPrefix = (token.split('@')[0] ?? '')
      .replace(/[^A-Za-z0-9 _.-]+/g, '-')
      .replace(/ {2,}/g, ' ')
      .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
      .slice(0, 32)
      .replace(/[^A-Za-z0-9]+$/g, '');
    const direct = validateLocalMockPlayerName(rawPrefix);
    if (direct.ok) return direct.value;
    const padded = validateLocalMockPlayerName(`${rawPrefix || 'email'}-pilot`.slice(0, 32));
    return padded.ok ? padded.value : 'Email Pilot';
  }
  if (provider === 'google') return 'Google Pilot';
  if (provider === 'x') return 'X Pilot';
  return null;
}
