// Shared boundary types for the NEAR ports (docs/spec/NEAR.md 1a, D-30 rule 7: every boundary has a zod schema).
import { z } from 'zod';

/** NEAR account id: 2-64 chars, lowercase alnum segments separated by single `.`, `-` or `_`. */
export const AccountId = z.string().min(2).max(64).regex(/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/);
export type AccountId = z.infer<typeof AccountId>;

/** Deterministic outbox id, e.g. `cargo-export:{colonyId}:{exportSeq}`; a retry with the same id never double-spends. */
export const OpId = z.string().min(1).max(200);
export type OpId = z.infer<typeof OpId>;

/** Non-negative integer as a decimal string in base units (PR-04: never a JS number). */
export const TokenAmount = z.string().regex(/^(0|[1-9]\d*)$/);
export type TokenAmount = z.infer<typeof TokenAmount>;

export const NearNetwork = z.enum(['mock', 'testnet', 'mainnet']);
export type NearNetwork = z.infer<typeof NearNetwork>;

export const ChainReceipt = z.object({
  /** `mock:…` for mock adapters. */
  txHash: z.string().min(1),
  receiptId: z.string().optional(),
  blockHeight: z.number().int().nonnegative().optional(),
  status: z.enum(['pending', 'success', 'failure']),
  network: NearNetwork,
  errorCode: z.string().optional(),
  /** Unix ms. */
  at: z.number().int().nonnegative(),
});
export type ChainReceipt = z.infer<typeof ChainReceipt>;

export const NEAR_PORT_NAMES = [
  'Identity', 'Relayer', 'CargoToken', 'Intents', 'AgentWallet', 'DeedNft', 'BadgeNft',
  'Staking', 'TreasuryDao', 'Escrow', 'ChainRead',
] as const;
/** Port name used by `NEAR_ADAPTER_<PORT>` selection. */
export const NearPortName = z.enum(NEAR_PORT_NAMES);
export type NearPortName = z.infer<typeof NearPortName>;

export const ChainHealth = z.object({
  ok: z.boolean(),
  network: NearNetwork,
  latencyMs: z.number().nonnegative(),
  detail: z.string().optional(),
});
export type ChainHealth = z.infer<typeof ChainHealth>;

/** NFT mint input shared by DeedNftPort and BadgeNftPort. */
export const NftMintInput = z.object({
  opId: OpId,
  collection: z.string().min(1),
  ownerAccountId: AccountId,
  tokenId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()),
});
export type NftMintInput = z.infer<typeof NftMintInput>;

export const NftMintResult = z.object({ tokenId: z.string().min(1), receipt: ChainReceipt });
export type NftMintResult = z.infer<typeof NftMintResult>;

export const NftUpdateMetadataInput = z.object({
  opId: OpId,
  collection: z.string().min(1),
  tokenId: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()),
});
export type NftUpdateMetadataInput = z.infer<typeof NftUpdateMetadataInput>;

export const NftTokenRef = z.object({ collection: z.string().min(1), tokenId: z.string().min(1) });
export type NftTokenRef = z.infer<typeof NftTokenRef>;
