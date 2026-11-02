import { z } from 'zod';
import { CoreException } from '../../../../core/errors';
import { NearException } from '../../../domain/errors';
import { AccountId, OpId } from '../../../domain/types';
import { mockTxHashFor } from '../../mock/tx-hash';

const CONTRACT_PREFIXES = ['res.', 'deed.', 'bounty.'] as const;
const DAO_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** Shape of `RelayerPort.submitMetaTx`. Invalid input is `VALIDATION_ERROR`, never a relay code. */
const RelaySubmitSchema = z.object({
  opId: OpId,
  signerId: AccountId,
  receiverId: AccountId,
  signedDelegate: z.string().min(1).max(8000),
});

export type RelaySubmit = z.infer<typeof RelaySubmitSchema>;

function parseRelaySubmit(input: unknown): RelaySubmit {
  const parsed = RelaySubmitSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  const message = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ');
  throw new CoreException('VALIDATION_ERROR', { status: 400, message });
}

function prefixedContract(receiverId: string): boolean {
  return CONTRACT_PREFIXES.some((prefix) => {
    if (!receiverId.startsWith(prefix)) return false;
    return AccountId.safeParse(receiverId.slice(prefix.length)).success;
  });
}

/** `{name}.sputnik-dao.near` or `{name}.sputnik-dao.mock`. */
function planetDao(receiverId: string): boolean {
  const dot = receiverId.indexOf('.');
  if (dot < 1) return false;
  const name = receiverId.slice(0, dot);
  const rest = receiverId.slice(dot + 1);
  return DAO_NAME.test(name) && (rest === 'sputnik-dao.near' || rest === 'sputnik-dao.mock');
}

/** Cost-control allow-list (NEAR §4). Checked before any database call. */
export function receiverAllowed(receiverId: string): boolean {
  return receiverId === 'intents.near' || prefixedContract(receiverId) || planetDao(receiverId);
}

/**
 * Validate, then reject a receiver outside the allow-list.
 * `MockRelayerAdapter.submitMetaTx` calls this before `MockChainBase.call`.
 */
export function assertRelayAllowed(input: unknown): RelaySubmit {
  const parsed = parseRelaySubmit(input);
  if (!receiverAllowed(parsed.receiverId)) throw new NearException('NEAR_RELAY_RECEIVER_NOT_ALLOWED');
  return parsed;
}

/** `mock:` hash of the action. `opId` is not part of it, so a retry of the same action collides on purpose. */
export function relayTxHash(input: {
  signerId: string;
  receiverId: string;
  signedDelegate: string;
  opId?: string;
}): string {
  return mockTxHashFor(`${input.signerId}\n${input.receiverId}\n${input.signedDelegate}`);
}
