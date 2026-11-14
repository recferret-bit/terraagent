import { envFlagTrue, type EnvSection } from '@terra/config';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { discoverAdapters } from '../../ports/adapters.js';
import { bindPorts } from '../../ports/binding.js';
import { guardedEnv } from '../../ports/prod-guard.js';
import { PORTS } from '../application/ports/index.js';
import { IntentsBalanceReadPort } from '../application/ports/intents-balance-read.port.js';
import type { NearPortName } from '../domain/types.js';
import { NearStakingPoolsEnvSchema } from '../staking/staking-pools.config.js';
import { nearAdapterFor, NEAR_PORT_KEYS } from './adapter-selection.js';
import { NearStatusController } from './dev/near-status.controller.js';
import { Nep413AuthService } from '../identity/nep413-auth.service.js';

/** Adapters are discovered from `./adapters/**\/*.adapter.ts` at load; see `near/README.md`. */
export const nearAdapters = await discoverAdapters(fileURLToPath(new URL('./adapters/', import.meta.url)));

const nearPorts = PORTS.filter((p) => NEAR_PORT_KEYS.some((k) => k.port === p.name));
const keyOf = (name: string) => NEAR_PORT_KEYS.find((k) => k.port === name)!.key;

/** Env section (guard runs before Nest starts); exported so tests can parse it against a fixture adapter list. */
export const nearEnvFor = (adapters: Parameters<typeof guardedEnv>[4]): EnvSection => {
  const base = guardedEnv('near', {
    ...Object.fromEntries(NEAR_PORT_KEYS.map((k) => [k.key, z.string().optional()])),
    NEAR_MODE: z.string().optional(),
    NEAR_ADAPTER_CARGO: z.string().optional(),
    NEAR_ADAPTER_DEED: z.string().optional(),
    NEAR_ADAPTER_BADGE: z.string().optional(),
    NEAR_ADAPTER_TREASURY: z.string().optional(),
    // Optional: boot must not require a KEK. `loadKekRing` still refuses the dev key in production when a key is sealed (BE-34).
    NEAR_KEK: z.string().optional(),
    NEAR_KEK_VERSION: z.string().optional(),
    NEAR_KEK_RING: z.string().optional(),
    NEAR_STAKING_POOLS: NearStakingPoolsEnvSchema,
    NEAR_ROOT_ACCOUNT: z.string().optional(),
    NEAR_RPC_URL: z.string().optional(),
    NEAR_RPC_FALLBACK_URL: z.string().optional(),
    NEAR_EXPLORER_BASE_URL: z.string().optional(),
    NEAR_CONTRACT_RES: z.string().optional(),
    NEAR_CONTRACT_DEED: z.string().optional(),
    NEAR_CONTRACT_BOUNTY: z.string().optional(),
    NEAR_CONTRACT_STAKING: z.string().optional(),
    NEAR_CONTRACT_DAO: z.string().optional(),
    NEAR_CONTRACT_PILOTS: z.string().optional(),
    NEAR_USE_PILOTS_FACTORY: z.string().optional(),
    NEAR_CONTRACT_INTENTS: z.string().optional(),
    NEAR_TOKEN_WNEAR: z.string().optional(),
    NEAR_TOKEN_USDC: z.string().optional(),
    NEAR_RELAYER_ACCOUNT: z.string().optional(),
    NEAR_MINTER_ACCOUNT: z.string().optional(),
    NEAR_PROTOCOL_ACCOUNT: z.string().optional(),
    NEAR_ROOT_SECRET_KEY: z.string().optional(),
    NEAR_RELAYER_SECRET_KEY: z.string().optional(),
    NEAR_MINTER_SECRET_KEY: z.string().optional(),
    NEAR_PROTOCOL_SECRET_KEY: z.string().optional(),
    NEAR_DAO_SECRET_KEY: z.string().optional(),
    NEAR_PLATFORM_FEE_BP: z.string().optional(),
    NEAR_STAKER_PLATFORM_FEE_BP: z.string().optional(),
    NEAR_DAO_FEE_SHARE_BP: z.string().optional(),
    NEAR_STAKER_MIN_NEAR: z.string().optional(),
    NEAR_PROTOCOL_STAKING_YIELD_BP: z.string().optional(),
    NEAR_ESCROW_SLASH_PROTOCOL_BP: z.string().optional(),
    NEAR_CREDENTIALS_DIR: z.string().optional(),
    NEAR_FASTAUTH_ISSUER: z.string().optional(),
    NEAR_FASTAUTH_CLIENT_ID: z.string().optional(),
    NEAR_GOOGLE_CLIENT_ID: z.string().optional(),
    NEAR_ONECLICK_URL: z.string().optional(),
    NEAR_ONECLICK_API_KEY: z.string().optional(),
    NEAR_RELAYER_DAILY_CAP: z.string().optional(),
    NEAR_MIN_RELAYER_BALANCE: z.string().optional(),
    NEAR_RELAYER_MAX_DEPOSIT_NEAR: z.string().optional(),
    NEAR_ALLOW_MAINNET: z.string().optional(),
  }, 'NEAR_ALLOW_MOCK_IN_PROD',
    nearPorts.map((p) => ({ name: p.name, token: p.token, key: keyOf(p.name), kind: (s) => nearAdapterFor(p.name as NearPortName, s) })), adapters);

  const schema = base.schema.superRefine((v, ctx) => {
    const source = v as Record<string, string | undefined>;
    const mainnetPorts = nearPorts
      .filter((p) => nearAdapterFor(p.name as NearPortName, source) === 'mainnet')
      .map((p) => p.name);
    const allowMainnet = envFlagTrue(source.NEAR_ALLOW_MAINNET) || source.NEAR_ALLOW_MAINNET?.trim() === '1';
    if (mainnetPorts.length > 0 && !allowMainnet) {
      ctx.addIssue({
        code: 'custom',
        path: ['NEAR_ALLOW_MAINNET'],
        message: `mainnet adapters selected for ${mainnetPorts.join(', ')} — set NEAR_ALLOW_MAINNET=1 (or true) to explicitly enable mainnet execution`,
      });
    }
  });
  return { name: base.name, schema } as unknown as EnvSection;
};

/** The only place NEAR ports are bound: one `{ provide: XPort, useClass: <selected adapter> }` per registered port. */
export const nearInfrastructureModuleFor = (adapters: Parameters<typeof bindPorts>[2]) =>
  bindPorts('NearInfrastructureModule', [
    ...nearPorts.map((p) => ({ name: p.name, token: p.token, select: (env: Record<string, unknown>) => nearAdapterFor(p.name as NearPortName, env as Record<string, string>) })),
    // Read-only companion of `Intents` (not a 12th port: no env key, no prod-guard entry); follows `NEAR_ADAPTER_INTENTS`.
    { name: 'IntentsBalanceRead', token: IntentsBalanceReadPort, select: (env: Record<string, unknown>) => nearAdapterFor('Intents', env as Record<string, string>) },
  ], adapters, {
    controllers: [NearStatusController],
    providers: [Nep413AuthService],
    exports: [Nep413AuthService],
  });

export const NearInfrastructureModule = nearInfrastructureModuleFor(nearAdapters);
export const nearEnv = nearEnvFor(nearAdapters);
