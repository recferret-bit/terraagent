import type { RejectCode, TruceDurationHours } from '@terra/contracts';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import {
  cancelNoticeTicks,
  getColonyHqRowAndTier,
  hostilityCooldownTicks,
  maxActiveTrucesForHqTier,
  oathbreakerDurationTicks,
  offerExpiryTicks,
  validateTruceProposal,
} from './rules';
import {
  getActiveTrucesForColony,
  getLastHostilityTick,
  hasActiveTruce,
  isValidTruceDurationHours,
  readDiplomacyBlob,
  resolveColonyIdStr,
  resolveColonyIndex,
  writeDiplomacyBlob,
  type StoredTruceOffer,
  type StoredTruceRecord,
} from './store';

export type ProposeTruceResult =
  | { ok: true; offer: StoredTruceOffer }
  | { ok: false; code: RejectCode; detail: string };

export type RespondTruceResult =
  | { ok: true; offer: StoredTruceOffer; truce?: StoredTruceRecord }
  | { ok: false; code: RejectCode; detail: string };

export type CancelTruceResult =
  | { ok: true; truce: StoredTruceRecord; noticeEndsAtTick: number; oathbreakerUntilTick: number }
  | { ok: false; code: RejectCode; detail: string };

export function proposeTruce(
  state: PlanetState,
  fromColony: number,
  targetRef: number | string,
  durationHours: TruceDurationHours,
  tick: number = state.meta.tick,
  ctx?: StepContext,
): ProposeTruceResult {
  const toColony = resolveColonyIndex(state, targetRef);
  const check = validateTruceProposal(state, fromColony, toColony, durationHours, tick, ctx?.data);
  if (!check.ok) return check;

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
    hours: durationHours,
    durationHours,
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
      hours: durationHours,
      durationHours,
      expiresAtTick,
    },
  });

  return { ok: true, offer };
}

function findMatchingPendingOffer(
  offers: Record<string, StoredTruceOffer>,
  responderColony: number,
  offerIdOrFromRef: string,
  state: PlanetState,
): StoredTruceOffer | undefined {
  const direct = offers[offerIdOrFromRef];
  if (direct) return direct;
  const fromIdx = resolveColonyIndex(state, offerIdOrFromRef);
  return Object.values(offers).find(
    (o) =>
      o.status === 'pending' &&
      o.toColonyIndex === responderColony &&
      (o.offerId === offerIdOrFromRef || o.fromColonyId === offerIdOrFromRef || (fromIdx >= 0 && o.fromColonyIndex === fromIdx)),
  );
}

function finalizeAcceptedTruce(
  state: PlanetState,
  blob: ReturnType<typeof readDiplomacyBlob>,
  offer: StoredTruceOffer,
  tick: number,
  ctx?: StepContext,
): StoredTruceRecord {
  offer.status = 'accepted';
  const truceId = `tr_${blob.nextTruceSeq++}`;
  const hours = offer.hours;
  const expiresAtTick = tick + hours * 3600 * TICKS_PER_SECOND;
  const truce: StoredTruceRecord = {
    truceId,
    colonyA: offer.fromColonyIndex,
    colonyB: offer.toColonyIndex,
    colonyAId: offer.fromColonyId,
    colonyBId: offer.toColonyId,
    colonyAIndex: offer.fromColonyIndex,
    colonyBIndex: offer.toColonyIndex,
    hours,
    durationHours: hours,
    signedAtTick: tick,
    startedAtTick: tick,
    expiresAtTick,
    status: 'active',
  };
  blob.truces[truceId] = truce;
  writeDiplomacyBlob(state, blob, tick);
  ctx?.emit({
    kind: 'truceSigned',
    severity: 'info',
    colonyIds: [offer.fromColonyId, offer.toColonyId],
    data: {
      truceId,
      offerId: offer.offerId,
      colonyA: offer.fromColonyId,
      colonyB: offer.toColonyId,
      colonyAIndex: offer.fromColonyIndex,
      colonyBIndex: offer.toColonyIndex,
      hours,
      durationHours: hours,
      startedAtTick: tick,
      expiresAtTick,
    },
  });
  return truce;
}

export function respondTruce(
  state: PlanetState,
  responderColony: number,
  offerIdOrFromRef: string,
  accept: boolean,
  tick: number = state.meta.tick,
  ctx?: StepContext,
): RespondTruceResult {
  const blob = readDiplomacyBlob(state);
  const offer = findMatchingPendingOffer(blob.offers, responderColony, offerIdOrFromRef, state);
  if (!offer || offer.status !== 'pending' || offer.toColonyIndex !== responderColony) {
    return { ok: false, code: 'unknown_offer', detail: 'truce offer not found or no longer pending' };
  }
  if (tick >= offer.expiresAtTick) {
    offer.status = 'expired';
    writeDiplomacyBlob(state, blob, tick);
    return { ok: false, code: 'unknown_offer', detail: 'truce offer expired' };
  }

  if (!accept) {
    offer.status = 'declined';
    writeDiplomacyBlob(state, blob, tick);
    return { ok: true, offer };
  }

  const fromColony = offer.fromColonyIndex;
  const toColony = offer.toColonyIndex;
  const fromHq = getColonyHqRowAndTier(state, fromColony);
  const toHq = getColonyHqRowAndTier(state, toColony);
  if (!fromHq.alive || !toHq.alive) {
    return { ok: false, code: 'invalid_args', detail: 'both HQs must be alive to sign a truce' };
  }
  const lastHostility = getLastHostilityTick(state, fromColony, toColony);
  if (lastHostility !== undefined && tick - lastHostility < hostilityCooldownTicks(ctx?.data)) {
    return { ok: false, code: 'recent_hostility', detail: 'hostility within the last 10 minutes' };
  }
  if (hasActiveTruce(state, fromColony, toColony, tick)) {
    return { ok: false, code: 'truce_active', detail: 'truce already active' };
  }

  const fromCap = maxActiveTrucesForHqTier(fromHq.tier, ctx?.data);
  const toCap = maxActiveTrucesForHqTier(toHq.tier, ctx?.data);
  const fromActive = getActiveTrucesForColony(state, fromColony, tick).filter((t) => t.status === 'active').length;
  const toActive = getActiveTrucesForColony(state, toColony, tick).filter((t) => t.status === 'active').length;
  if (fromActive >= fromCap || toActive >= toCap) {
    return { ok: false, code: 'truce_cap', detail: 'active truce cap reached' };
  }

  const truce = finalizeAcceptedTruce(state, blob, offer, tick, ctx);
  return { ok: true, offer, truce };
}

export function cancelTruce(
  state: PlanetState,
  callerColony: number,
  truceIdOrTargetRef: string,
  tick: number = state.meta.tick,
  ctx?: StepContext,
): CancelTruceResult {
  const blob = readDiplomacyBlob(state);
  const targetIdx = resolveColonyIndex(state, truceIdOrTargetRef);
  const truce =
    blob.truces[truceIdOrTargetRef] ??
    Object.values(blob.truces).find(
      (t) =>
        t.status === 'active' &&
        (t.colonyAIndex === callerColony || t.colonyBIndex === callerColony) &&
        (t.truceId === truceIdOrTargetRef ||
          t.colonyAId === truceIdOrTargetRef ||
          t.colonyBId === truceIdOrTargetRef ||
          (targetIdx >= 0 && (t.colonyAIndex === targetIdx || t.colonyBIndex === targetIdx))),
    );

  if (
    !truce ||
    truce.status !== 'active' ||
    (truce.colonyAIndex !== callerColony && truce.colonyBIndex !== callerColony)
  ) {
    return { ok: false, code: 'unknown_truce', detail: 'active truce not found' };
  }

  const callerId = resolveColonyIdStr(state, callerColony);
  const partnerIndex = truce.colonyAIndex === callerColony ? truce.colonyBIndex : truce.colonyAIndex;
  const partnerColonyId = resolveColonyIdStr(state, partnerIndex);
  const noticeEndsAtTick = Math.min(truce.expiresAtTick, tick + cancelNoticeTicks(ctx?.data));
  const oathbreakerUntilTick = tick + oathbreakerDurationTicks(ctx?.data);

  truce.status = 'notice';
  truce.cancelledBy = callerColony;
  truce.cancelledById = callerId;
  truce.noticeEndsAtTick = noticeEndsAtTick;
  blob.oathbreakerUntilByColony[callerColony] = oathbreakerUntilTick;
  writeDiplomacyBlob(state, blob, tick);

  ctx?.emit({
    kind: 'truceNotice',
    severity: 'warn',
    colonyIds: [callerId, partnerColonyId],
    data: {
      truceId: truce.truceId,
      cancelledBy: callerId,
      cancelledByColony: callerColony,
      partnerColonyId,
      noticeEndsAtTick,
      oathbreakerUntilTick,
    },
  });

  return { ok: true, truce, noticeEndsAtTick, oathbreakerUntilTick };
}

export {
  cancelColonyTrucesOnElimination,
  devOfferTruce,
  stepDiplomacy,
} from './parts/truceLifecycle';

