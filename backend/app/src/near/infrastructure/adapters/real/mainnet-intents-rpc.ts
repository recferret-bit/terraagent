import { randomBytes, sign as edSign, type KeyObject } from 'node:crypto';
import {
  MARKET_TOKEN_KEYS,
  MARKET_TOKENS,
  MarketTokenKey,
  RESOURCE_KEYS,
  fromChainUnits,
  tokenKeyOfVerifierId,
  type ResourceKey,
} from '@terra/contracts';
import { NearException } from '../../../domain/errors.js';
import type { ChainReceipt } from '../../../domain/types.js';
import type {
  IntentsDepositInput,
  IntentsSimulation,
  IntentsWithdrawInput,
  SignedIntent,
} from '../../../application/ports/intents.port.js';
import {
  INTENTS_VERIFYING_CONTRACT,
  canonicalTokenDiffMessage,
  nep413SigningHash,
} from '../../../intents/nep413-token-diff.js';
import { encodeBase58 } from '../../../keystore/base58.js';
import type { NearNetworkConfig } from '../../network/near-network.config.js';
import type { NearRpcClient } from '../../rpc/near-rpc.client.js';

let cachedSalt: { bytes: Buffer; fetchedAt: number } | null = null;
const SALT_TTL_MS = 30_000;

/** Translates TerraAgent market token keys or `.mock` verifier IDs into live `intents.near` multi-token IDs. */
export function toMainnetVerifierTokenId(rawToken: string, cfg: NearNetworkConfig): string {
  const directKey = MarketTokenKey.safeParse(rawToken);
  const key = directKey.success ? directKey.data : tokenKeyOfVerifierId(rawToken);
  if (key) {
    if (key === 'USDC') return `nep141:${cfg.quoteTokens.usdc}`;
    if (key === 'NEAR') return `nep141:${cfg.quoteTokens.wnear}`;
    if ((RESOURCE_KEYS as readonly string[]).includes(key)) {
      return `nep245:${cfg.contracts.res}:${key}`;
    }
  }
  if (rawToken === 'native:near') return `nep141:${cfg.quoteTokens.wnear}`;
  if (rawToken === 'nep141:usdc.mock') return `nep141:${cfg.quoteTokens.usdc}`;
  const mockCargo = /^nep245:res\.terraagent\.mock:(.+)$/.exec(rawToken);
  if (mockCargo?.[1]) return `nep245:${cfg.contracts.res}:${mockCargo[1]}`;
  return rawToken;
}

export function normalizeMainnetDeltas(
  deltas: Readonly<Record<string, string>>,
  cfg: NearNetworkConfig,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [token, amount] of Object.entries(deltas)) {
    const mapped = toMainnetVerifierTokenId(token, cfg);
    out[mapped] = out[mapped] ? (BigInt(out[mapped]!) + BigInt(amount)).toString() : amount;
  }
  return out;
}

/** Fetches 4-byte `current_salt` from `intents.near` and builds a 32-byte base64 NEP-413 nonce. */
export async function buildMainnetSaltNonce(rpc: NearRpcClient): Promise<string> {
  let saltBytes: Buffer | null =
    cachedSalt && Date.now() - cachedSalt.fetchedAt < SALT_TTL_MS ? cachedSalt.bytes : null;

  if (!saltBytes) {
    try {
      const raw = await rpc.view<string | number[]>(rpc.config.contracts.intents, 'current_salt', {});
      if (typeof raw === 'string' && /^[0-9a-fA-F]{8}$/.test(raw.trim())) {
        saltBytes = Buffer.from(raw.trim(), 'hex');
      } else if (Array.isArray(raw) && raw.length === 4) {
        saltBytes = Buffer.from(raw);
      }
      if (saltBytes?.length === 4) {
        cachedSalt = { bytes: saltBytes, fetchedAt: Date.now() };
      }
    } catch {
      /* fall back to random prefix if offline in static unit tests */
    }
  }

  const prefix = saltBytes?.length === 4 ? saltBytes : randomBytes(4);
  return Buffer.concat([prefix, randomBytes(28)]).toString('base64');
}

export function toMainnetSignedPayload(intent: SignedIntent, recipient = INTENTS_VERIFYING_CONTRACT) {
  return {
    standard: 'nep413',
    payload: {
      message: canonicalTokenDiffMessage(intent.diff.accountId, intent.diff.deltas, intent.deadlineMs),
      nonce: intent.nonce,
      recipient,
    },
    public_key: intent.publicKey,
    signature: intent.signature,
  };
}

function mapIntentsErrorText(rawText: string): IntentsSimulation['errorCode'] {
  const lower = rawText.toLowerCase();
  if (lower.includes('insufficient') || lower.includes('balance')) return 'NEAR_INSUFFICIENT_BALANCE';
  if (lower.includes('nonce')) return 'NEAR_INTENT_NONCE_REUSED';
  if (lower.includes('expired') || lower.includes('deadline')) return 'NEAR_INTENT_EXPIRED';
  if (lower.includes('signature') || lower.includes('public_key') || lower.includes('unregistered')) {
    return 'NEAR_INTENT_BAD_SIGNATURE';
  }
  return 'NEAR_INTENT_DIFF_NOT_ZERO';
}

export async function simulateMainnetIntents(
  rpc: NearRpcClient,
  intents: readonly SignedIntent[],
): Promise<IntentsSimulation> {
  const effects = intents.map((i) => i.diff);
  const recipient = rpc.config.contracts.intents;
  try {
    await rpc.view<unknown>(recipient, 'simulate_intents', {
      signed: intents.map((i) => toMainnetSignedPayload(i, recipient)),
    });
    return { ok: true, effects };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, errorCode: mapIntentsErrorText(msg), effects };
  }
}

export async function ensureMainnetIntentsKeyRegistered(
  rpc: NearRpcClient,
  accountId: string,
  signerSecretKey: string,
  publicKey: string,
): Promise<void> {
  const hasKey = await rpc
    .view<boolean>(rpc.config.contracts.intents, 'has_public_key', {
      account_id: accountId,
      public_key: publicKey,
    })
    .catch(() => false);
  if (hasKey) return;

  await rpc.call({
    signerAccountId: accountId,
    signerSecretKey,
    contractId: rpc.config.contracts.intents,
    methodName: 'add_public_key',
    args: { public_key: publicKey },
    gasTgas: 30,
    depositYocto: 1n,
  });
}

export async function depositToMainnetIntents(
  rpc: NearRpcClient,
  params: {
    readonly input: IntentsDepositInput;
    readonly signerSecretKey: string;
    readonly signerPublicKey: string;
  },
): Promise<ChainReceipt> {
  const { input } = params;
  await ensureMainnetIntentsKeyRegistered(rpc, input.accountId, params.signerSecretKey, params.signerPublicKey);
  const verifierTokenId = toMainnetVerifierTokenId(input.tokenId, rpc.config);

  if (verifierTokenId.startsWith('nep245:')) {
    const rest = verifierTokenId.slice('nep245:'.length);
    const sep = rest.indexOf(':');
    if (sep <= 0) {
      throw new NearException('NEAR_UNAVAILABLE', { message: `Invalid NEP-245 verifier token: ${verifierTokenId}` });
    }
    const contractId = rest.slice(0, sep);
    const subTokenId = rest.slice(sep + 1);
    const { receipt } = await rpc.call({
      signerAccountId: input.accountId,
      signerSecretKey: params.signerSecretKey,
      contractId,
      methodName: 'mt_transfer_call',
      args: {
        receiver_id: rpc.config.contracts.intents,
        token_id: subTokenId,
        amount: input.amount,
        msg: input.accountId,
      },
      gasTgas: 80,
      depositYocto: 1n,
    });
    return receipt;
  }

  const ftContract = verifierTokenId.startsWith('nep141:')
    ? verifierTokenId.slice('nep141:'.length)
    : verifierTokenId;
  const { receipt } = await rpc.call({
    signerAccountId: input.accountId,
    signerSecretKey: params.signerSecretKey,
    contractId: ftContract,
    methodName: 'ft_transfer_call',
    args: {
      receiver_id: rpc.config.contracts.intents,
      amount: input.amount,
      msg: input.accountId,
    },
    gasTgas: 80,
    depositYocto: 1n,
  });
  return receipt;
}

export async function withdrawFromMainnetIntents(
  rpc: NearRpcClient,
  params: {
    readonly input: IntentsWithdrawInput;
    readonly privateKey: KeyObject;
    readonly publicKey: string;
    readonly fallbackSignerSecretKey?: string;
  },
): Promise<ChainReceipt> {
  const { input } = params;
  const verifierTokenId = toMainnetVerifierTokenId(input.tokenId, rpc.config);
  const nonce = await buildMainnetSaltNonce(rpc);
  const deadline = new Date(Date.now() + 5 * 60_000).toISOString();

  const withdrawIntent = verifierTokenId.startsWith('nep245:')
    ? (() => {
        const rest = verifierTokenId.slice('nep245:'.length);
        const sep = rest.indexOf(':');
        return {
          intent: 'mt_withdraw',
          token: rest.slice(0, sep),
          token_ids: [rest.slice(sep + 1)],
          amounts: [input.amount],
          receiver_id: input.to,
        };
      })()
    : {
        intent: 'ft_withdraw',
        token: verifierTokenId.startsWith('nep141:') ? verifierTokenId.slice('nep141:'.length) : verifierTokenId,
        amount: input.amount,
        receiver_id: input.to,
      };

  const recipient = rpc.config.contracts.intents;
  const message = JSON.stringify({
    signer_id: input.accountId,
    deadline,
    intents: [withdrawIntent],
  });
  const sig = edSign(null, nep413SigningHash({ message, nonce, recipient }), params.privateKey);
  const signedItem = {
    standard: 'nep413',
    payload: { message, nonce, recipient },
    public_key: params.publicKey,
    signature: `ed25519:${encodeBase58(sig)}`,
  };

  return broadcastExecuteIntents(rpc, [signedItem], params.fallbackSignerSecretKey, input.accountId);
}

export async function executeMainnetIntents(
  rpc: NearRpcClient,
  intents: readonly SignedIntent[],
): Promise<ChainReceipt> {
  const recipient = rpc.config.contracts.intents;
  const signed = intents.map((i) => toMainnetSignedPayload(i, recipient));
  return broadcastExecuteIntents(rpc, signed);
}

async function broadcastExecuteIntents(
  rpc: NearRpcClient,
  signed: readonly unknown[],
  fallbackSecret?: string,
  fallbackAccount?: string,
): Promise<ChainReceipt> {
  const relayerSecret = rpc.config.secrets.relayerSecretKey ?? rpc.config.secrets.minterSecretKey ?? fallbackSecret;
  const relayerAccount = rpc.config.secrets.relayerSecretKey
    ? rpc.config.accounts.relayer
    : rpc.config.secrets.minterSecretKey
      ? rpc.config.accounts.minter
      : fallbackAccount;
  if (!relayerSecret || !relayerAccount) {
    throw new NearException('NEAR_UNAVAILABLE', {
      message: 'Missing NEAR_RELAYER_SECRET_KEY / NEAR_MINTER_SECRET_KEY for mainnet execute_intents',
    });
  }
  const { receipt } = await rpc.call({
    signerAccountId: relayerAccount,
    signerSecretKey: relayerSecret,
    contractId: rpc.config.contracts.intents,
    methodName: 'execute_intents',
    args: { signed },
    gasTgas: 150,
  });
  return receipt;
}

export async function readMainnetVerifierChainBalance(
  rpc: NearRpcClient,
  accountId: string,
  token: string,
): Promise<bigint> {
  const key = MarketTokenKey.safeParse(token);
  if (!key.success && !token.includes(':') && !(token in MARKET_TOKENS)) return 0n;
  const tokenId = toMainnetVerifierTokenId(token, rpc.config);
  const raw = await rpc.view<string | null>(rpc.config.contracts.intents, 'mt_balance_of', {
    account_id: accountId,
    token_id: tokenId,
  });
  return raw ? BigInt(raw) : 0n;
}

export async function readMainnetVerifierBalances(
  rpc: NearRpcClient,
  accountId: string,
): Promise<Partial<Record<MarketTokenKey, bigint>>> {
  const tokenIds = MARKET_TOKEN_KEYS.map((k) => toMainnetVerifierTokenId(k, rpc.config));
  const amounts = await rpc.view<readonly string[]>(rpc.config.contracts.intents, 'mt_batch_balance_of', {
    account_id: accountId,
    token_ids: tokenIds,
  });
  const out: Partial<Record<MarketTokenKey, bigint>> = {};
  for (let i = 0; i < MARKET_TOKEN_KEYS.length; i += 1) {
    const key = MARKET_TOKEN_KEYS[i] as MarketTokenKey | ResourceKey;
    const chainVal = BigInt(amounts?.[i] ?? '0');
    const atomic = fromChainUnits(key, chainVal);
    if (atomic > 0n) out[key] = atomic;
  }
  return out;
}
