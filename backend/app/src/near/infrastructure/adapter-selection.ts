import { NEAR_PORT_NAMES, type NearPortName } from '../domain/types.js';

export type NearAdapterKind = 'mock' | 'testnet' | 'mainnet';
type Source = Readonly<Record<string, string | undefined>>;

/** `ChainRead` -> `NEAR_ADAPTER_CHAIN_READ`, `BadgeNft` -> `NEAR_ADAPTER_BADGE_NFT`. */
export const nearAdapterKey = (port: NearPortName): string => `NEAR_ADAPTER_${port.replace(/([a-z\d])([A-Z])/g, '$1_$2').toUpperCase()}`;

const PORT_ALIASES: Partial<Record<NearPortName, string>> = {
  CargoToken: 'NEAR_ADAPTER_CARGO',
  DeedNft: 'NEAR_ADAPTER_DEED',
  BadgeNft: 'NEAR_ADAPTER_BADGE',
  TreasuryDao: 'NEAR_ADAPTER_TREASURY',
};

const TESTNET_MOCK_FALLBACK_PORTS: ReadonlySet<NearPortName> = new Set(['BadgeNft', 'Staking', 'TreasuryDao']);

const parseNearKind = (raw: string | undefined): NearAdapterKind | undefined => {
  if (raw === 'testnet' || raw === 'devnet') return 'testnet';
  if (raw === 'mainnet') return 'mainnet';
  if (raw === 'mock') return 'mock';
  return undefined;
};

/**
 * Selected adapter for a NEAR port (NEAR.md 1a rule 2, D-30, Vertical Slice NEAR_MODE switch).
 * Fail-closed: only the exact strings `testnet`, `devnet` (mapped to `testnet`), `mainnet`, and `mock`
 * count; unset, a typo or different case (`Mainnet`) all mean `mock`. Per-port `NEAR_ADAPTER_<PORT>`
 * (or its short alias) overrides the global `NEAR_MODE` default when explicitly set.
 * Under `NEAR_MODE=testnet` (or `devnet`), the 3 ports that remain mock (`BadgeNft`, `Staking`,
 * `TreasuryDao`) default to `'mock'` unless explicitly overridden via `NEAR_ADAPTER_<PORT>`.
 */
export function nearAdapterFor(port: NearPortName, env: Source): NearAdapterKind {
  const alias = PORT_ALIASES[port];
  const rawPort = env[nearAdapterKey(port)] ?? (alias ? env[alias] : undefined);
  if (rawPort !== undefined && rawPort !== '') {
    return parseNearKind(rawPort) ?? 'mock';
  }
  const mode = parseNearKind(env.NEAR_MODE) ?? 'mock';
  if (mode === 'testnet' && TESTNET_MOCK_FALLBACK_PORTS.has(port)) {
    return 'mock';
  }
  return mode;
}

export const NEAR_PORT_KEYS: readonly { port: NearPortName; key: string }[] = NEAR_PORT_NAMES.map((port) => ({ port, key: nearAdapterKey(port) }));
