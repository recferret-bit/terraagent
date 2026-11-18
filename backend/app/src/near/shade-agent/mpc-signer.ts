import { createHash } from 'node:crypto';

export const DEFAULT_MPC_SIGNER_TESTNET = 'v1.signer-prod.testnet';
export const DEFAULT_MPC_SIGNER_MAINNET = 'v1.signer';

export function resolveMpcSignerContract(network: 'testnet' | 'mainnet' = 'testnet'): string {
  return network === 'mainnet' ? DEFAULT_MPC_SIGNER_MAINNET : DEFAULT_MPC_SIGNER_TESTNET;
}

/**
 * Deterministic NEP-491 MPC epsilon derivation:
 * `sha256("near-mpc-recovery v0.1.0 epsilon derivation:" + predecessorId + "," + path)`.
 */
export function deriveEpsilon(predecessorId: string, path: string): Buffer {
  return createHash('sha256')
    .update(`near-mpc-recovery v0.1.0 epsilon derivation:${predecessorId},${path}`)
    .digest();
}

export function deriveEpsilonHex(predecessorId: string, path: string): string {
  return `0x${deriveEpsilon(predecessorId, path).toString('hex')}`;
}

export interface MpcSignRequestDescriptor {
  readonly receiverId: string;
  readonly methodName: 'sign';
  readonly args: {
    readonly request: {
      readonly payload: number[];
      readonly path: string;
      readonly key_version: number;
    };
  };
  readonly depositYocto: string;
  readonly gasTgas: number;
  readonly epsilonHex: string;
}

export function buildMpcSignRequest(opts: {
  readonly network?: 'testnet' | 'mainnet';
  readonly predecessorId: string;
  readonly path: string;
  readonly payloadHex: string;
  readonly keyVersion?: number;
}): MpcSignRequestDescriptor {
  const cleanHex = opts.payloadHex.trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]{64}$/i.test(cleanHex)) {
    throw new Error('MPC sign payloadHex must be a 32-byte (64-hex-char) hash');
  }
  const bytes = Array.from(Buffer.from(cleanHex, 'hex'));
  return {
    receiverId: resolveMpcSignerContract(opts.network ?? 'testnet'),
    methodName: 'sign',
    args: {
      request: {
        payload: bytes,
        path: opts.path,
        key_version: opts.keyVersion ?? 0,
      },
    },
    depositYocto: '1',
    gasTgas: 250,
    epsilonHex: deriveEpsilonHex(opts.predecessorId, opts.path),
  };
}
