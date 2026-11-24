import { NearException, type NearErrorCode } from '../../domain/errors.js';

const PANIC_CODE_MAP: readonly [string, NearErrorCode][] = [
  ['NEAR_INSUFFICIENT_BALANCE', 'NEAR_INSUFFICIENT_BALANCE'],
  ['NEAR_INSUFFICIENT_FUNDS', 'NEAR_INSUFFICIENT_BALANCE'],
  ['NEAR_NOT_OWNER', 'NEAR_NOT_OWNER'],
  ['NEAR_NFT_EXISTS', 'NEAR_NFT_EXISTS'],
  ['NEAR_NFT_ALREADY_MINTED', 'NEAR_NFT_EXISTS'],
  ['NEAR_NFT_NOT_FOUND', 'NEAR_NFT_NOT_FOUND'],
  ['NEAR_NFT_INVALID', 'NEAR_NFT_INVALID'],
  ['NEAR_NFT_SOULBOUND', 'NEAR_NFT_INVALID'],
  ['NEAR_ESCROW_NOT_FOUND', 'NEAR_ESCROW_NOT_FOUND'],
  ['NEAR_ESCROW_STATE', 'NEAR_ESCROW_STATE'],
  ['NEAR_ESCROW_ALREADY_CLOSED', 'NEAR_ESCROW_STATE'],
  ['NEAR_ESCROW_EXISTS', 'NEAR_ESCROW_STATE'],
  ['NEAR_ESCROW_INVALID', 'NEAR_ESCROW_STATE'],
  ['NEAR_NAME_TAKEN', 'NEAR_NAME_TAKEN'],
  ['NEAR_ACCOUNT_EXISTS', 'NEAR_ACCOUNT_EXISTS'],
  ['AccountAlreadyExists', 'NEAR_ACCOUNT_EXISTS'],
  ['NEAR_ACCOUNT_NOT_FOUND', 'NEAR_ACCOUNT_NOT_FOUND'],
  ['POOL_NOT_WHITELISTED', 'POOL_NOT_WHITELISTED'],
  ['STAKE_INSUFFICIENT_BALANCE', 'STAKE_INSUFFICIENT_BALANCE'],
  // W28 V2 staking contract panics
  ['STAKE_NO_YIELD', 'NOTHING_TO_COMPOUND'],
  ['STAKE_INVALID_POOL', 'POOL_NOT_WHITELISTED'],
  ['STAKE_INVALID_APY', 'NEAR_INVALID_INPUT'],
  ['STAKE_INVALID_YIELD_BP', 'NEAR_INVALID_INPUT'],
  ['STAKE_INVALID_DEPOSIT', 'NEAR_INVALID_INPUT'],
  ['STAKE_INVALID_RECIPIENT', 'NEAR_INVALID_INPUT'],
  ['STAKE_ONE_YOCTO_REQUIRED', 'NEAR_INVALID_INPUT'],
  ['STAKE_DUPLICATE_OP', 'NEAR_INTENT_NONCE_REUSED'],
  ['STAKE_PRICE_UNKNOWN', 'NEAR_UNAVAILABLE'],
  ['STAKE_PRICE_STALE', 'NEAR_UNAVAILABLE'],
  ['NEAR_INSUFFICIENT_GAS', 'NEAR_INVALID_INPUT'],
  ['DAO_NOT_FOUND', 'DAO_NOT_FOUND'],
  ['NOT_A_MEMBER', 'NOT_A_MEMBER'],
  ['ALREADY_VOTED', 'ALREADY_VOTED'],
  ['TREASURY_INSUFFICIENT', 'TREASURY_INSUFFICIENT'],
  ['PROPOSAL_CLOSED', 'PROPOSAL_CLOSED'],
  ['PROPOSAL_OPEN', 'PROPOSAL_OPEN'],
  ['AccountDoesNotExist', 'NEAR_ACCOUNT_NOT_FOUND'],
  ['does not exist', 'NEAR_ACCOUNT_NOT_FOUND'],
];

/** True when an error represents deterministic chain/contract state rather than an RPC node outage. */
export function isDeterministicChainError(err: unknown): boolean {
  // near-api-js 7 types what a contract or the node's state answered: `ContractMethodNotFoundError` ("Contract method
  // is not found at block height N"), `ContractCodeDoesNotExistError`, ... Every node gives the same answer.
  if (err instanceof Error && /^Contract[A-Za-z]*Error$/.test(err.name)) return true;
  const text = formatErrorText(err);
  if (PANIC_CODE_MAP.some(([needle]) => text.includes(needle))) return true;
  return (
    text.includes('UNKNOWN_TRANSACTION') ||
    text.includes('UNKNOWN_ACCOUNT') ||
    text.includes('Contract panicked') ||
    // A view that ran and failed inside the contract (`GuestPanic` on a bad argument, `MethodNotFound` on an older
    // deployment) answers the same on every node: retrying it across endpoints only hides the real error.
    text.includes('wasm execution failed') ||
    text.includes('FunctionCallError') ||
    text.includes('ActionError') ||
    text.includes('InvalidTxError') ||
    text.includes('DoesNotExist')
  );
}

/** Maps a NEAR RPC or contract execution error into TerraAgent's canonical `NearException`. */
export function toNearException(err: unknown, fallback: NearErrorCode = 'NEAR_UNAVAILABLE'): NearException {
  if (err instanceof NearException) return err;
  const text = formatErrorText(err);
  for (const [needle, code] of PANIC_CODE_MAP) {
    if (text.includes(needle)) {
      return new NearException(code, { message: text.slice(0, 300) });
    }
  }
  return new NearException(fallback, { message: text.slice(0, 300) });
}

export function formatErrorText(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown; data?: unknown }).cause ?? (err as { data?: unknown }).data;
    return cause ? `${err.message} ${JSON.stringify(cause)}` : err.message;
  }
  try {
    return typeof err === 'string' ? err : JSON.stringify(err);
  } catch {
    return String(err);
  }
}
