import { KeyStore } from '../keystore/keys.js';

export interface SealedTradingSessionKey {
  readonly publicKey: string;
  readonly encryptedSecret: string;
  readonly kekVersion: number;
}

export function generateSealedTradingSessionKey(keys: KeyStore): SealedTradingSessionKey {
  const generated = keys.generate();
  return {
    publicKey: generated.row.publicKey,
    encryptedSecret: generated.row.encryptedSecret,
    kekVersion: generated.row.kekVersion,
  };
}

export function openSealedTradingSessionSeed(
  keys: KeyStore,
  row: {
    readonly tradingSessionPublicKey?: string | null;
    readonly tradingSessionEncryptedSecret?: string | null;
    readonly kekVersion?: number | null;
  },
): Buffer | null {
  const secret = row.tradingSessionEncryptedSecret?.trim();
  if (!secret || secret === 'revoked') return null;
  return keys.open({
    publicKey: row.tradingSessionPublicKey ?? '',
    encryptedSecret: secret,
    kekVersion: row.kekVersion ?? 1,
  });
}
