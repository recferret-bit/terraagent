/**
 * Authoritative proposal ingress (AI §7). Memory only: no Prisma write.
 * The first `accept` for a `requestId` stores its actions. A second accept with that id
 * is `{ ok: true, duplicate: true }` and does not add actions. `results` returns that one list.
 * A fence below the colony's latest accepted fence, or an `intentRevision` below `noteIntent`,
 * is `{ ok: false, outcome: 'superseded' }` and is not stored.
 */

export interface ProposalSubmit {
  readonly requestId: string;
  readonly colonyId: string;
  readonly fence: number;
  readonly intentRevision: number;
  readonly actions: readonly unknown[];
}

export type ProposalAccept =
  | { readonly ok: true; readonly duplicate: true }
  | { readonly ok: true }
  | { readonly ok: false; readonly outcome: 'superseded' };

const superseded = (): ProposalAccept => ({ ok: false, outcome: 'superseded' });

export class ProposalOutbox {
  private readonly stored = new Map<string, readonly unknown[]>();
  private readonly fenceByColony = new Map<string, number>();
  private readonly intentByColony = new Map<string, number>();

  accept(input: ProposalSubmit): ProposalAccept {
    if (this.stored.has(input.requestId)) return { ok: true, duplicate: true };
    if (this.stale(input)) return superseded();
    this.keep(input);
    return { ok: true };
  }

  /** Raises the colony's required intent revision. A lower value does not lower it. */
  noteIntent(colonyId: string, revision: number): void {
    const required = this.intentByColony.get(colonyId) ?? 0;
    if (revision > required) this.intentByColony.set(colonyId, revision);
  }

  /** The action list stored for this request, or undefined when none was accepted. */
  results(requestId: string): readonly unknown[] | undefined {
    return this.stored.get(requestId);
  }

  private stale(input: ProposalSubmit): boolean {
    const fence = this.fenceByColony.get(input.colonyId);
    if (fence !== undefined && input.fence < fence) return true;
    const required = this.intentByColony.get(input.colonyId) ?? 0;
    return input.intentRevision < required;
  }

  private keep(input: ProposalSubmit): void {
    this.stored.set(input.requestId, cloneActions(input.actions));
    const fence = this.fenceByColony.get(input.colonyId);
    if (fence === undefined || input.fence > fence) this.fenceByColony.set(input.colonyId, input.fence);
  }
}

function cloneActions(actions: readonly unknown[]): readonly unknown[] {
  return actions.map((action) => structuredClone(action));
}
