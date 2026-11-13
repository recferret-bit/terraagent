import { Buffer } from 'buffer';

interface GlobalWithPolyfills {
  Buffer?: typeof Buffer;
  process?: { env?: Record<string, string | undefined> };
  global?: unknown;
}

/**
 * Installs browser globals (`Buffer`, `process.env`, `global`) required by
 * `@near-wallet-selector/*`, `@meteorwallet/sdk`, and `@peersyst/near-mobile-signer`
 * before those SDKs evaluate.
 */
export function ensureBrowserPolyfills(): typeof Buffer {
  const g = globalThis as unknown as GlobalWithPolyfills;
  if (!g.Buffer) g.Buffer = Buffer;
  if (!g.process) g.process = { env: {} };
  else if (!g.process.env) g.process.env = {};
  if (!g.global) g.global = globalThis;
  return g.Buffer;
}
