import type { PlanetState } from '../kernel/state';
import type { MoveRequest, TreasuryCtx, TreasuryReject } from './treasury';

/**
 * Reports a treasury change a system expected to succeed but that was rejected (a terraform yield, a construction
 * refund): a `treasuryRejected` warn event, so the refusal is visible instead of silently changing nothing. Normal
 * outcomes (a build waiting on `insufficient_funds`) are not reported. Without an event sink (tests) it does nothing.
 */
export function reportTreasuryReject(ctx: TreasuryCtx, state: PlanetState, req: MoveRequest, reject: TreasuryReject): void {
  const colonyId = state.colonies[req.colony]?.id ?? `col_${req.colony}`;
  ctx.emit?.({
    kind: 'treasuryRejected',
    severity: 'warn',
    colonyIds: [colonyId],
    data: {
      colonyId,
      reason: req.reason,
      code: reject.code,
      ...(reject.resource !== undefined ? { resource: reject.resource } : {}),
      ...(reject.detail !== undefined ? { detail: reject.detail } : {}),
      ...(req.ref !== undefined ? { ref: req.ref } : {}),
    },
  });
}
