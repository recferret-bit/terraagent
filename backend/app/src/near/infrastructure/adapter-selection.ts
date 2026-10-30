import { NEAR_PORT_NAMES, type NearPortName } from '../domain/types.js';

export type NearAdapterKind = 'mock' | 'testnet' | 'mainnet';
type Source = Readonly<Record<string, string | undefined>>;

/** `ChainRead` -> `NEAR_ADAPTER_CHAIN_READ`, `BadgeNft` -> `NEAR_ADAPTER_BADGE_NFT`. */
export const nearAdapterKey = (port: NearPortName): string => `NEAR_ADAPTER_${port.replace(/([a-z\d])([A-Z])/g, '$1_$2').toUpperCase()}`;

/**
 * Selected adapter for a NEAR port (NEAR.md 1a rule 2, D-30). Fail-closed: only the exact strings `testnet` and `mainnet`
 * count; unset, a typo or different case (`Mainnet`) all mean `mock`. A plain function over the env source, so it is
 * readable before DI (boot guard, scripts).
 */
export function nearAdapterFor(port: NearPortName, env: Source): NearAdapterKind {
  const v = env[nearAdapterKey(port)];
  return v === 'testnet' || v === 'mainnet' ? v : 'mock';
}

export const NEAR_PORT_KEYS: readonly { port: NearPortName; key: string }[] = NEAR_PORT_NAMES.map((port) => ({ port, key: nearAdapterKey(port) }));
