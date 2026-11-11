import { NearException } from '../domain/errors.js';
import type { DaoMember, DaoPolicy } from './policy.js';

export function memberOf(policy: DaoPolicy, accountId: string): DaoMember | undefined {
  return policy.members.find((member) => member.accountId === accountId);
}

export function assertMember(policy: DaoPolicy, accountId: string): DaoMember {
  const member = memberOf(policy, accountId);
  if (!member) throw new NearException('NOT_A_MEMBER', { details: { accountId } });
  return member;
}

/** A colony that cannot propose is still a member, but `propose` throws `NOT_A_MEMBER`. */
export function assertCanPropose(policy: DaoPolicy, accountId: string): void {
  const member = assertMember(policy, accountId);
  if (!member.canPropose) throw new NearException('NOT_A_MEMBER', { details: { accountId, canPropose: false } });
}

/**
 * Adding a member that is already on the council does not duplicate them.
 * `canPropose` is updated only when the caller passes it; omitted leaves the current flag.
 */
export function withMember(policy: DaoPolicy, accountId: string, canPropose: boolean | undefined): DaoPolicy {
  const existing = memberOf(policy, accountId);
  if (existing) {
    if (canPropose === undefined || existing.canPropose === canPropose) return policy;
    const members = policy.members.map((member) => member.accountId === accountId ? { ...member, canPropose } : member);
    return { ...policy, members };
  }
  return { ...policy, members: [...policy.members, { accountId, canPropose: canPropose ?? true }] };
}

export function withoutMember(policy: DaoPolicy, accountId: string): DaoPolicy {
  if (!memberOf(policy, accountId)) return policy;
  return { ...policy, members: policy.members.filter((member) => member.accountId !== accountId) };
}
