import type { AccountId, ChainReceipt, OpId, TokenAmount } from '../../domain/types.js';

export interface CreateSubAccountInput { readonly opId: OpId; readonly parent: AccountId; readonly name: string }
export interface CreateSubAccountResult { readonly accountId: AccountId; readonly receipt: ChainReceipt }
/**
 * `allowance` is the NEAR gas allowance of the function-call key. Per-token principal lives in
 * {@link TokenAllowanceInput} and is not spent by signing (NEAR-81, W15-03).
 */
export interface AddLimitedKeyInput {
  readonly opId: OpId;
  readonly accountId: AccountId;
  readonly publicKey: string;
  readonly allowance: TokenAmount;
  readonly receiverId: AccountId;
  readonly methodNames: readonly string[];
  /** Principal caps. Absent means the key can sign but cannot reserve cargo or cash. */
  readonly tokens?: readonly TokenAllowanceInput[];
}
export interface TokenAllowanceInput { readonly token: string; readonly allowance: TokenAmount }
export interface RevokeKeyInput { readonly opId: OpId; readonly accountId: AccountId; readonly publicKey: string }

export interface KeyStatusQuery { readonly accountId: AccountId; readonly publicKey: string }

/** `available` is `allowance - reserved - spent`. All three are persisted and survive restart. */
export interface TokenAllowanceView {
  readonly token: string;
  readonly allowance: TokenAmount;
  readonly reserved: TokenAmount;
  readonly spent: TokenAmount;
  readonly available: TokenAmount;
}

export interface KeyStatus {
  readonly accountId: AccountId;
  readonly publicKey: string;
  readonly revoked: boolean;
  readonly receiverId: AccountId;
  readonly methodNames: readonly string[];
  readonly tokens: readonly TokenAllowanceView[];
  /** Gas allowance of the function-call key. Signing does not reduce `tokens`. */
  readonly gasAllowance: TokenAmount;
  readonly gasSpent: TokenAmount;
}

export interface AllowanceOpInput {
  readonly opId: OpId;
  readonly accountId: AccountId;
  readonly publicKey: string;
  readonly token: string;
  readonly amount: TokenAmount;
}

export interface AllowanceOpResult { readonly status: KeyStatus; readonly receipt: ChainReceipt }

/** Receivers a limited key may name (NEAR §1a rule 5). `res.*` is the cargo contracts; `intents.near` is the verifier. */
export function agentWalletReceiverAllowed(receiverId: string): boolean {
  return receiverId === 'intents.near' || receiverId.startsWith('res.');
}

export abstract class AgentWalletPort {
  abstract createSubAccount(input: CreateSubAccountInput): Promise<CreateSubAccountResult>;
  abstract addLimitedKey(input: AddLimitedKeyInput): Promise<ChainReceipt>;
  abstract revokeKey(input: RevokeKeyInput): Promise<ChainReceipt>;
  /** Current principal and gas ledger for one key. Unknown keys reject; revoked keys return `revoked: true`. */
  abstract keyStatus(input: KeyStatusQuery): Promise<KeyStatus>;
  /** Hold principal at placement. Idempotent on `opId`. Throws `NEAR_ALLOWANCE_EXHAUSTED` when available is short. */
  abstract reserveAllowance(input: AllowanceOpInput): Promise<AllowanceOpResult>;
  /** Move reserved principal to spent on final settlement. Idempotent on `opId`. Does not run on sign. */
  abstract consumeAllowance(input: AllowanceOpInput): Promise<AllowanceOpResult>;
  /** Return unused reserved principal. Idempotent on `opId`. */
  abstract releaseAllowance(input: AllowanceOpInput): Promise<AllowanceOpResult>;
}
