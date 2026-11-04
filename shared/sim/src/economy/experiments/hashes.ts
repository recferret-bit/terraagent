import type { ScenarioManifest } from '@terra/contracts';
import { canonical } from '../../data/_hash';
import { sha256Hex } from '../sha256';

/** Bytes as a Latin-1 string (every byte one code unit), so `sha256Hex` (text) can hash a snapshot. */
export function bytesToText(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
}

export const hashText = (text: string): string => `sha256:${sha256Hex(text)}`;
export const hashJson = (value: unknown): string => hashText(canonical(value));

/** Hash of a scenario manifest without its own `hash` field (the pin a manifest and a summary can compare). */
export const scenarioHashOf = (m: ScenarioManifest): string => {
  const { hash: _ignored, ...rest } = m;
  return hashJson(rest);
};

/** The run's state hash: the planet snapshot bytes plus the market harness digest. */
export const stateHashOf = (snapshot: Uint8Array, marketDigest: string): string => hashText(`${hashText(bytesToText(snapshot))}\n${marketDigest}`);
