import { z } from 'zod';

/**
 * NEAR account id (NEAR §2). Same shape as the server port's `AccountId`: lowercase segments
 * separated by `.`, `-` or `_`. Mock names end in `terraagent.mock` (W23 swaps the suffix).
 */
export const NearAccountId = z.string().min(2).max(64).regex(/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/);
export type NearAccountId = z.infer<typeof NearAccountId>;

/** Mock network suffix. Real adapters use `terraagent.near` / `terraagent.testnet` (W23). */
export const MOCK_ACCOUNT_ROOT = 'terraagent.mock';
export const MOCK_CARGO_CONTRACT = 'res.terraagent.mock';
export const MOCK_RELAYER_ACCOUNT = 'relayer.terraagent.mock';
export const MOCK_MINTER_ACCOUNT = 'minter.terraagent.mock';

/** Player named account: `{name}.terraagent.mock`. */
export const playerAccountId = (name: string): string => `${name}.${MOCK_ACCOUNT_ROOT}`;

/**
 * Colony sub-account: `{colony}.{name}.terraagent.mock`. The colony id is lowercased so a `co_` ULID
 * (uppercase) still forms a valid account id. Uniqueness is preserved.
 */
export const colonyAccountId = (colonyId: string, playerName: string): string =>
  `${colonyId.toLowerCase()}.${playerName}.${MOCK_ACCOUNT_ROOT}`;

/**
 * Idempotency keys (NEAR §1a rule 6). `createNamedAccount` on the landed port takes `opId` only
 * (Q-01-22): the service derives this id from `(provider, subject)`, so a repeat is the same account.
 */
export const namedAccountOpId = (provider: string, subject: string): string => `named-account:${provider}:${subject}`;
export const colonyAccountOpId = (colonyId: string): string => `colony-account:${colonyId}`;
export const storageDepositOpId = (colonyAccountIdValue: string): string => `storage-deposit:${colonyAccountIdValue}`;
export const cargoExportOpId = (colonyId: string, exportSeq: number): string => `cargo-export:${colonyId}:${exportSeq}`;
export const cargoImportOpId = (colonyId: string, importSeq: number): string => `cargo-import:${colonyId}:${importSeq}`;
