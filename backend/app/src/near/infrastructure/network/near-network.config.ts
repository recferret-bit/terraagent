import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NearNetwork, NearPortName } from '../../domain/types.js';
import { nearAdapterFor } from '../adapter-selection.js';

export const MAINNET_USDC_CONTRACT = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
export const TESTNET_USDC_CONTRACT = '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af';

export interface NearNetworkConfig {
  readonly network: Exclude<NearNetwork, 'mock'>;
  readonly rootAccount: string;
  readonly primaryRpcUrl: string;
  readonly fallbackRpcUrl: string;
  readonly explorerBaseUrl: string;
  readonly contracts: {
    readonly res: string;
    readonly deed: string;
    readonly bounty: string;
    readonly staking: string;
    readonly dao: string;
    readonly pilots: string;
    readonly intents: string;
  };
  readonly quoteTokens: {
    readonly wnear: string;
    readonly usdc: string;
  };
  readonly accounts: {
    readonly relayer: string;
    readonly minter: string;
    readonly protocol: string;
  };
  readonly secrets: {
    readonly rootSecretKey?: string;
    readonly relayerSecretKey?: string;
    readonly minterSecretKey?: string;
  };
  readonly fastAuth: {
    readonly issuer: string;
    readonly clientId: string;
  };
  readonly googleClientId?: string;
  readonly oneClickUrl: string;
  readonly oneClickApiKey?: string;
  readonly relayerDailyCapNear: number;
  readonly minRelayerBalanceNear: number;
  readonly maxRelayDepositNear: number;
}

type EnvMap = Readonly<Record<string, string | undefined>>;

/** Resolves whether a port (or global `NEAR_MODE`) targets `'mainnet'` or `'testnet'`. */
export function resolveActiveNearNetwork(
  port: NearPortName | null,
  env: EnvMap = process.env,
): Exclude<NearNetwork, 'mock'> {
  if (port) {
    return nearAdapterFor(port, env) === 'mainnet' ? 'mainnet' : 'testnet';
  }
  return env.NEAR_MODE?.trim() === 'mainnet' ? 'mainnet' : 'testnet';
}

function readKeyFile(credDir: string, accountId: string): string | undefined {
  try {
    const file = path.join(credDir, `${accountId}.json`);
    if (!fs.existsSync(file)) return undefined;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { private_key?: string; secret_key?: string };
    return parsed.private_key ?? parsed.secret_key;
  } catch {
    return undefined;
  }
}

function resolveSecret(env: EnvMap, envKey: string, credDir: string | null, accountId: string): string | undefined {
  const direct = env[envKey]?.trim();
  if (direct) return direct;
  return credDir ? readKeyFile(credDir, accountId) : undefined;
}

/** Resolves NEAR network endpoints, contract account IDs, and optional signing keys from env or `~/.near-credentials`. */
export function resolveNearNetworkConfig(
  env: EnvMap = process.env,
  network: Exclude<NearNetwork, 'mock'> = 'testnet',
): NearNetworkConfig {
  const isMainnet = network === 'mainnet';
  const rootAccount = env.NEAR_ROOT_ACCOUNT?.trim() || (isMainnet ? 'terraagent.near' : 'terraagent.testnet');
  const primaryRpcUrl = env.NEAR_RPC_URL?.trim()
    || (isMainnet ? 'https://free.rpc.fastnear.com' : 'https://test.rpc.fastnear.com');
  const fallbackRpcUrl = env.NEAR_RPC_FALLBACK_URL?.trim()
    || (isMainnet ? 'https://rpc.mainnet.near.org' : 'https://rpc.testnet.near.org');
  const explorerBaseUrl = (
    env.NEAR_EXPLORER_BASE_URL?.trim() || (isMainnet ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io')
  ).replace(/\/+$/, '');

  const relayer = env.NEAR_RELAYER_ACCOUNT?.trim() || `relayer.${rootAccount}`;
  const minter = env.NEAR_MINTER_ACCOUNT?.trim() || `minter.${rootAccount}`;
  const protocol = env.NEAR_PROTOCOL_ACCOUNT?.trim() || `protocol.${rootAccount}`;

  const credDir = env.NEAR_CREDENTIALS_DIR?.trim()
    || (env.NODE_ENV !== 'production' ? path.join(os.homedir(), '.near-credentials', network) : null);

  const rootSecretKey = resolveSecret(env, 'NEAR_ROOT_SECRET_KEY', credDir, rootAccount);
  const relayerSecretKey = resolveSecret(env, 'NEAR_RELAYER_SECRET_KEY', credDir, relayer) ?? rootSecretKey;
  const minterSecretKey = resolveSecret(env, 'NEAR_MINTER_SECRET_KEY', credDir, minter) ?? rootSecretKey;

  const dailyCap = Number(env.NEAR_RELAYER_DAILY_CAP ?? '5');
  const minBalance = Number(env.NEAR_MIN_RELAYER_BALANCE ?? '5');
  const maxRelayDeposit = Number(env.NEAR_RELAYER_MAX_DEPOSIT_NEAR ?? '0.05');

  return {
    network,
    rootAccount,
    primaryRpcUrl,
    fallbackRpcUrl,
    explorerBaseUrl,
    contracts: {
      res: env.NEAR_CONTRACT_RES?.trim() || `res.${rootAccount}`,
      deed: env.NEAR_CONTRACT_DEED?.trim() || `deed.${rootAccount}`,
      bounty: env.NEAR_CONTRACT_BOUNTY?.trim() || `bounty.${rootAccount}`,
      staking: env.NEAR_CONTRACT_STAKING?.trim() || `staking.${rootAccount}`,
      dao: env.NEAR_CONTRACT_DAO?.trim() || `dao.${rootAccount}`,
      pilots: env.NEAR_CONTRACT_PILOTS?.trim() || `pilots.${rootAccount}`,
      intents: env.NEAR_CONTRACT_INTENTS?.trim() || 'intents.near',
    },
    quoteTokens: {
      wnear: env.NEAR_TOKEN_WNEAR?.trim() || (isMainnet ? 'wrap.near' : 'wrap.testnet'),
      usdc: env.NEAR_TOKEN_USDC?.trim() || (isMainnet ? MAINNET_USDC_CONTRACT : TESTNET_USDC_CONTRACT),
    },
    accounts: { relayer, minter, protocol },
    secrets: { rootSecretKey, relayerSecretKey, minterSecretKey },
    fastAuth: {
      issuer: env.NEAR_FASTAUTH_ISSUER?.trim() || 'https://dev-ep2ml1ryu5jcs8pz.us.auth0.com/',
      clientId: env.NEAR_FASTAUTH_CLIENT_ID?.trim() || 'GhPTEx5u0o5Bh16F6LWjPXOXAyQROUNL',
    },
    googleClientId: env.NEAR_GOOGLE_CLIENT_ID?.trim() || undefined,
    oneClickUrl: (env.NEAR_ONECLICK_URL?.trim() || 'https://1click.chaindefuser.com').replace(/\/+$/, ''),
    oneClickApiKey: env.NEAR_ONECLICK_API_KEY?.trim() || undefined,
    relayerDailyCapNear: Number.isFinite(dailyCap) && dailyCap > 0 ? dailyCap : 5,
    minRelayerBalanceNear: Number.isFinite(minBalance) && minBalance >= 0 ? minBalance : 5,
    maxRelayDepositNear: Number.isFinite(maxRelayDeposit) && maxRelayDeposit >= 0 ? maxRelayDeposit : 0.05,
  };
}
