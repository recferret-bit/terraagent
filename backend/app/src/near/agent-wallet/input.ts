import { agentWalletReceiverAllowed, type AddLimitedKeyInput } from '../application/ports/agent-wallet.port.js';
import { NearException } from '../domain/errors.js';
import { AccountId, TokenAmount } from '../domain/types.js';

const PART = '([a-z\\d]+[-_])*[a-z\\d]+';
const NAME = new RegExp(`^${PART}(\\.${PART})*$`);

/** `{name}.{parent}`, within the NEAR account-id rules (2–64 chars, lowercase segments). */
export function composeSubAccountId(parent: string, name: string): string {
  const id = `${name}.${parent}`;
  if (!NAME.test(name) || !AccountId.safeParse(parent).success || !AccountId.safeParse(id).success) {
    throw new NearException('NEAR_INVALID_INPUT', { message: `Sub-account "${id}" is outside NEAR account-id rules` });
  }
  return id;
}

export function parseTokenAmount(amount: string): bigint {
  if (!TokenAmount.safeParse(amount).success) {
    throw new NearException('NEAR_INVALID_INPUT', { message: `Invalid token amount "${amount}"` });
  }
  return BigInt(amount);
}

export function assertKeyRef(accountId: string, publicKey: string): void {
  if (!AccountId.safeParse(accountId).success) {
    throw new NearException('NEAR_INVALID_INPUT', { message: `Invalid account id "${accountId}"` });
  }
  if (publicKey.length < 1 || publicKey.length > 128) {
    throw new NearException('NEAR_INVALID_INPUT', { message: 'Public key length is outside 1..128' });
  }
}

export function assertTokenId(token: string): void {
  if (token.length < 1 || token.length > 96)
    throw new NearException('NEAR_INVALID_INPUT', { message: `Invalid token "${token}"` });
}

/** Rejects a bad key before any receipt is written. `res.` is allowed even though it is not a full account id. */
export function assertAddLimitedKey(input: AddLimitedKeyInput): void {
  assertKeyRef(input.accountId, input.publicKey);
  if (!agentWalletReceiverAllowed(input.receiverId)) {
    throw new NearException('NEAR_RELAY_RECEIVER_NOT_ALLOWED', {
      message: `Receiver ${input.receiverId} is not allowed on a limited key`,
    });
  }
  if (input.receiverId.length > 64) {
    throw new NearException('NEAR_INVALID_INPUT', { message: `Receiver ${input.receiverId} is too long` });
  }
  parseTokenAmount(input.allowance);
  assertTokenList(input.tokens);
}

function assertTokenList(tokens: AddLimitedKeyInput['tokens']): void {
  if (!tokens) return;
  const seen = new Set<string>();
  for (const row of tokens) {
    assertTokenId(row.token);
    parseTokenAmount(row.allowance);
    if (seen.has(row.token)) throw new NearException('NEAR_INVALID_INPUT', { message: `Duplicate token ${row.token}` });
    seen.add(row.token);
  }
}
