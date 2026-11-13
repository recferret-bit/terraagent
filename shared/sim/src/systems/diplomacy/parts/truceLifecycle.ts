import type { TruceDurationHours } from '@terra/contracts';
import { TICKS_PER_SECOND } from '../../../kernel/constants';
import type { StepContext } from '../../../kernel/context';
import type { PlanetState } from '../../../kernel/state';
import { colonyIsAway, readAwaySettings } from '../../away';
import { createAndEmitTruceOffer, respondTruce } from '../operations';
import {
  isValidTruceDurationHours,
  markColonyContact,
  readDiplomacyBlob,
  writeDiplomacyBlob,
  type DiplomacyBlobValue,
  type StoredTruceOffer,
  type StoredTruceRecord,
} from '../store';
import { cancelColonyWarsOnElimination, stepWars } from './warBonds';

function truceBondEventFields(truce: StoredTruceRecord): Record<string, unknown> {
  return truce.bondAmount && truce.bondAmount > 0 && truce.bondToken
    ? { bondAmount: truce.bondAmount, bondToken: truce.bondToken }
    : {};
}

export function cancelColonyTrucesOnElimination(
  state: PlanetState,
  eliminatedColony: number,
  tick: number = state.meta.tick,
  ctx?: StepContext,
): void {
  const blob = readDiplomacyBlob(state);
  let changed = false;
  for (const offer of Object.values(blob.offers)) {
    if (
      offer.status === 'pending' &&
      (offer.fromColonyIndex === eliminatedColony || offer.toColonyIndex === eliminatedColony)
    ) {
      offer.status = 'expired';
      changed = true;
    }
  }
  for (const truce of Object.values(blob.truces)) {
    if (
      (truce.status === 'active' || truce.status === 'notice') &&
      (truce.colonyAIndex === eliminatedColony || truce.colonyBIndex === eliminatedColony)
    ) {
      truce.status = 'ended';
      truce.endReason = 'eliminated';
      changed = true;
      ctx?.emit({
        kind: 'truceEnded',
        severity: 'info',
        colonyIds: [truce.colonyAId, truce.colonyBId],
        data: {
          truceId: truce.truceId,
          colonyA: truce.colonyAId,
          colonyB: truce.colonyBId,
          colonyAIndex: truce.colonyAIndex,
          colonyBIndex: truce.colonyBIndex,
          reason: 'eliminated',
          endedAtTick: tick,
          ...truceBondEventFields(truce),
        },
      });
    }
  }
  if (cancelColonyWarsOnElimination(blob, eliminatedColony, tick, ctx)) {
    changed = true;
  }
  if (changed) writeDiplomacyBlob(state, blob, tick);
}

export function devOfferTruce(
  state: PlanetState,
  fromColony: number,
  toColony: number,
  durationHours: number,
  tick: number = state.meta.tick,
  ctx?: StepContext,
): StoredTruceOffer | null {
  if (fromColony < 0 || toColony < 0 || fromColony === toColony) return null;
  const hours: TruceDurationHours = isValidTruceDurationHours(durationHours) ? durationHours : 6;
  markColonyContact(state, fromColony, toColony, tick);
  return createAndEmitTruceOffer(state, fromColony, toColony, hours, tick, ctx);
}

function stepActiveTruces(blob: DiplomacyBlobValue, tick: number, ctx: StepContext): boolean {
  let changed = false;
  for (const truce of Object.values(blob.truces)) {
    if (truce.status === 'notice' && tick >= (truce.noticeEndsAtTick ?? truce.expiresAtTick)) {
      truce.status = 'ended';
      truce.endReason = 'cancelled';
      changed = true;
      ctx.emit({
        kind: 'truceEnded',
        severity: 'warn',
        colonyIds: [truce.colonyAId, truce.colonyBId],
        data: {
          truceId: truce.truceId,
          colonyA: truce.colonyAId,
          colonyB: truce.colonyBId,
          colonyAIndex: truce.colonyAIndex,
          colonyBIndex: truce.colonyBIndex,
          reason: 'cancelled',
          ...(truce.cancelledById ? { cancelledBy: truce.cancelledById } : {}),
          ...(truce.cancelledBy !== undefined ? { cancelledByColony: truce.cancelledBy } : {}),
          endedAtTick: tick,
          ...truceBondEventFields(truce),
        },
      });
    } else if (truce.status === 'active' && tick >= truce.expiresAtTick) {
      truce.status = 'ended';
      truce.endReason = 'expired';
      changed = true;
      ctx.emit({
        kind: 'truceEnded',
        severity: 'info',
        colonyIds: [truce.colonyAId, truce.colonyBId],
        data: {
          truceId: truce.truceId,
          colonyA: truce.colonyAId,
          colonyB: truce.colonyBId,
          colonyAIndex: truce.colonyAIndex,
          colonyBIndex: truce.colonyBIndex,
          reason: 'expired',
          endedAtTick: tick,
          ...truceBondEventFields(truce),
        },
      });
    }
  }
  return changed;
}

export function stepDiplomacy(state: PlanetState, ctx: StepContext): void {
  const raw = state.blobs.diplomacy?.value;
  if (!raw) return;
  const blob = readDiplomacyBlob(state);
  const tick = ctx.tick;
  let changed = false;

  for (const offer of Object.values(blob.offers)) {
    const requiresHumanNearBond =
      Boolean(offer.bondAmount && offer.bondAmount > 0 && offer.bondToken === 'NEAR');
    if (offer.status === 'pending' && tick >= offer.expiresAtTick) {
      offer.status = 'expired';
      changed = true;
    } else if (
      offer.status === 'pending' &&
      !requiresHumanNearBond &&
      ctx.flags.has('W16') &&
      tick >= offer.offeredAtTick + TICKS_PER_SECOND &&
      colonyIsAway(state, offer.toColonyIndex) &&
      readAwaySettings(state, offer.toColonyIndex)?.mode !== 'rules_only' &&
      state.colonies[offer.toColonyIndex]?.aiAllowed !== false
    ) {
      if (changed) {
        writeDiplomacyBlob(state, blob, tick);
        changed = false;
      }
      respondTruce(state, offer.toColonyIndex, offer.offerId, true, tick, ctx);
      Object.assign(blob, readDiplomacyBlob(state));
    }
  }

  if (stepActiveTruces(blob, tick, ctx)) changed = true;
  if (stepWars(blob, tick, ctx)) changed = true;

  for (const [colKey, until] of Object.entries(blob.oathbreakerUntilByColony)) {
    if (tick >= until) {
      delete blob.oathbreakerUntilByColony[Number(colKey)];
      changed = true;
    }
  }

  if (changed) writeDiplomacyBlob(state, blob, tick);
}
