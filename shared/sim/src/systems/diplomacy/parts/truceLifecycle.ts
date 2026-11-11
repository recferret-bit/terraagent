import type { TruceDurationHours } from '@terra/contracts';
import { TICKS_PER_SECOND } from '../../../kernel/constants';
import type { StepContext } from '../../../kernel/context';
import type { PlanetState } from '../../../kernel/state';
import { colonyIsAway, readAwaySettings } from '../../away';
import { respondTruce } from '../operations';
import { offerExpiryTicks } from '../rules';
import {
  isValidTruceDurationHours,
  markColonyContact,
  readDiplomacyBlob,
  resolveColonyIdStr,
  writeDiplomacyBlob,
  type StoredTruceOffer,
} from '../store';

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
          reason: 'eliminated',
          endedAtTick: tick,
        },
      });
    }
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
  const blob = readDiplomacyBlob(state);
  const offerId = `of_${blob.nextOfferSeq++}`;
  const fromColonyId = resolveColonyIdStr(state, fromColony);
  const toColonyId = resolveColonyIdStr(state, toColony);
  const expiresAtTick = tick + offerExpiryTicks(ctx?.data);
  const offer: StoredTruceOffer = {
    offerId,
    fromColony,
    toColony,
    fromColonyId,
    toColonyId,
    fromColonyIndex: fromColony,
    toColonyIndex: toColony,
    hours,
    durationHours: hours,
    offeredAtTick: tick,
    expiresAtTick,
    status: 'pending',
  };
  blob.offers[offerId] = offer;
  writeDiplomacyBlob(state, blob, tick);
  ctx?.emit({
    kind: 'truceOffered',
    severity: 'info',
    colonyIds: [fromColonyId, toColonyId],
    data: {
      offerId,
      fromColony,
      toColony,
      fromColonyId,
      toColonyId,
      fromColonyIndex: fromColony,
      toColonyIndex: toColony,
      hours,
      durationHours: hours,
      expiresAtTick,
    },
  });
  return offer;
}

export function stepDiplomacy(state: PlanetState, ctx: StepContext): void {
  const raw = state.blobs.diplomacy?.value;
  if (!raw) return;
  const blob = readDiplomacyBlob(state);
  const tick = ctx.tick;
  let changed = false;

  for (const offer of Object.values(blob.offers)) {
    if (offer.status === 'pending' && tick >= offer.expiresAtTick) {
      offer.status = 'expired';
      changed = true;
    } else if (
      offer.status === 'pending' &&
      ctx.flags.has('W16') &&
      tick >= offer.offeredAtTick + TICKS_PER_SECOND &&
      colonyIsAway(state, offer.toColonyIndex) &&
      readAwaySettings(state, offer.toColonyIndex).mode !== 'rules_only' &&
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
          reason: 'cancelled',
          ...(truce.cancelledById ? { cancelledBy: truce.cancelledById } : {}),
          endedAtTick: tick,
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
          reason: 'expired',
          endedAtTick: tick,
        },
      });
    }
  }

  for (const [colKey, until] of Object.entries(blob.oathbreakerUntilByColony)) {
    if (tick >= until) {
      delete blob.oathbreakerUntilByColony[Number(colKey)];
      changed = true;
    }
  }

  if (changed) writeDiplomacyBlob(state, blob, tick);
}
