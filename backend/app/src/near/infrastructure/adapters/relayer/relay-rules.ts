import { z } from 'zod';
import { CoreException } from '../../../../core/errors';
import { NearException } from '../../../domain/errors';
import { AccountId, OpId } from '../../../domain/types';
import { mockTxHashFor } from '../../mock/tx-hash';

const CONTRACT_PREFIXES = ['res.', 'deed.', 'bounty.', 'dao.', 'pilots.', 'staking.'] as const;
const DEFAULT_ALLOWED_ROOTS = ['terraagent.mock', 'terraagent.testnet', 'terraagent.near'] as const;
const DAO_NAME = /^[a-z0-9][a-z0-9_-]{0,40}$/;

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

function resolveAllowedRoots(allowedRoot?: string | readonly string[]): readonly string[] {
  if (!allowedRoot) return DEFAULT_ALLOWED_ROOTS;
  const list = typeof allowedRoot === 'string' ? [allowedRoot] : allowedRoot;
  const cleaned = list.map((r) => r.trim().toLowerCase()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : DEFAULT_ALLOWED_ROOTS;
}

function prefixedContract(receiverId: string, roots: readonly string[]): boolean {
  const lower = receiverId.toLowerCase();
  return CONTRACT_PREFIXES.some((prefix) => {
    if (!lower.startsWith(prefix)) return false;
    const suffix = lower.slice(prefix.length);
    return roots.includes(suffix) && AccountId.safeParse(suffix).success;
  });
}

function planetCouncilSubDao(receiverId: string, roots: readonly string[]): boolean {
  const lower = receiverId.toLowerCase();
  const dot = lower.indexOf('.');
  if (dot < 1) return false;
  const planet = lower.slice(0, dot);
  const rest = lower.slice(dot + 1);
  if (!DAO_NAME.test(planet) || !rest.startsWith('dao.')) return false;
  const root = rest.slice('dao.'.length);
  return roots.includes(root) && AccountId.safeParse(root).success;
}

/** `{name}.sputnik-dao.near`, `{name}.sputnik-dao.testnet`, or `{name}.sputnik-dao.mock`. */
function sputnikDao(receiverId: string, allowedRoot?: string | readonly string[]): boolean {
  const lower = receiverId.toLowerCase();
  const dot = lower.indexOf('.');
  if (dot < 1) return false;
  const name = lower.slice(0, dot);
  const rest = lower.slice(dot + 1);
  if (!DAO_NAME.test(name)) return false;
  if (allowedRoot) {
    const roots = resolveAllowedRoots(allowedRoot);
    const allowNear = roots.some((r) => r.endsWith('.near'));
    const allowTestnet = roots.some((r) => r.endsWith('.testnet'));
    const allowMock = roots.some((r) => r.endsWith('.mock'));
    return (
      (allowNear && rest === 'sputnik-dao.near') ||
      (allowTestnet && rest === 'sputnik-dao.testnet') ||
      (allowMock && rest === 'sputnik-dao.mock')
    );
  }
  return rest === 'sputnik-dao.near' || rest === 'sputnik-dao.testnet' || rest === 'sputnik-dao.mock';
}

/**
 * Cost-control allow-list (NEAR §4). Pins prefixed contracts (`res.<root>`, `deed.<root>`, etc.)
 * and `{planet}.dao.<root>` to TerraAgent roots so third-party accounts like `res.evil.near` are rejected.
 */
export function receiverAllowed(receiverId: string, allowedRoot?: string | readonly string[]): boolean {
  const lower = receiverId.trim().toLowerCase();
  const roots = resolveAllowedRoots(allowedRoot);
  if (roots.includes(lower) && AccountId.safeParse(lower).success) return true;
  const allowIntentsMainnet = !allowedRoot || roots.some((r) => r.endsWith('.near') || r === 'intents.near');
  return (
    (allowIntentsMainnet && lower === 'intents.near') ||
    prefixedContract(lower, roots) ||
    planetCouncilSubDao(lower, roots) ||
    sputnikDao(lower, allowedRoot)
  );
}

/**
 * Validate, then reject a receiver outside the allow-list.
 * `MockRelayerAdapter.submitMetaTx` calls this before `MockChainBase.call`.
 */
export function assertRelayAllowed(input: unknown, allowedRoot?: string | readonly string[]): RelaySubmit {
  const parsed = parseRelaySubmit(input);
  if (!receiverAllowed(parsed.receiverId, allowedRoot)) throw new NearException('NEAR_RELAY_RECEIVER_NOT_ALLOWED');
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
