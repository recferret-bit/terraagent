import { OpId } from '../../domain/types.js';

/**
 * Deterministic chain-op id: `opId('cargo-export', colonyId, seq)` -> `cargo-export:{colonyId}:{seq}`.
 * Derive it from the game fact (never random, never a timestamp) so a retried enqueue or relay call is the same op.
 * Max 160 characters (column width); also validated against the shared `OpId` schema.
 */
export function opId(kind: string, ...parts: readonly (string | number | bigint)[]): string {
  if (!/^[a-z][a-z0-9-]*$/.test(kind)) throw new Error(`opId kind must be kebab-case, got "${kind}"`);
  if (!parts.length) throw new Error('opId needs at least one part');
  const id = [kind, ...parts.map(String)].join(':');
  if (id.length > MAX_OP_ID_LENGTH) throw new Error(`opId longer than ${MAX_OP_ID_LENGTH} characters: ${id}`);
  return OpId.parse(id);
}

export const MAX_OP_ID_LENGTH = 160;
