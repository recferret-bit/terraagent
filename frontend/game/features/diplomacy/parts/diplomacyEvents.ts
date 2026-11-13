import {
  TICKS_PER_SECOND,
  type DiplomacyColonyView,
  type DiplomacyOfferView,
  type DiplomacyTruceView,
  type DiplomacyWarView,
  type TruceDurationHours,
} from '../types';

function normalizeHours(val: unknown): TruceDurationHours {
  if (val === 2 || val === 6 || val === 24 || val === 72) return val;
  const num = Number(val);
  if (num === 2 || num === 6 || num === 24 || num === 72) return num;
  return 6;
}

function parseBond(data: Record<string, unknown>): { bondToken?: string; bondAmount?: number } {
  const amt = typeof data.bondAmount === 'number' && data.bondAmount > 0 ? data.bondAmount : undefined;
  if (!amt) return {};
  const tok = typeof data.bondToken === 'string' && data.bondToken.length > 0 ? data.bondToken : 'NEAR';
  return { bondToken: tok, bondAmount: amt };
}

function handleTruceOffered(current: DiplomacyColonyView, data: Record<string, unknown>, idx: number, tick: number): DiplomacyColonyView {
  const offerId = String(data.offerId || '');
  if (!offerId) return current;
  const fromCol = Number(data.fromColony ?? data.fromColonyIndex ?? 0);
  const toCol = Number(data.toColony ?? data.toColonyIndex ?? 0);
  const hours = normalizeHours(data.hours ?? data.durationHours);
  const expiresAtTick = Number(data.expiresAtTick ?? tick + 600 * TICKS_PER_SECOND);
  const offeredAtTick = Number(data.offeredAtTick ?? tick);

  const offerView: DiplomacyOfferView = {
    offerId,
    fromColony: fromCol,
    toColony: toCol,
    fromColonyId: data.fromColonyId ? String(data.fromColonyId) : undefined,
    toColonyId: data.toColonyId ? String(data.toColonyId) : undefined,
    hours,
    offeredAtTick,
    expiresAtTick,
    status: 'pending',
    ...parseBond(data),
  };

  if (toCol === idx) {
    return { ...current, incomingOffers: [...current.incomingOffers.filter((o) => o.offerId !== offerId), offerView] };
  }
  if (fromCol === idx) {
    return { ...current, outgoingOffers: [...current.outgoingOffers.filter((o) => o.offerId !== offerId), offerView] };
  }
  return current;
}

function handleTruceSigned(current: DiplomacyColonyView, data: Record<string, unknown>, idx: number, tick: number): DiplomacyColonyView {
  const offerId = data.offerId ? String(data.offerId) : undefined;
  const truceId = String(data.truceId || `tr_${Date.now()}`);
  const colA = Number(data.colonyAIndex ?? data.colonyA ?? 0);
  const colB = Number(data.colonyBIndex ?? data.colonyB ?? 0);
  const isParticipant = colA === idx || colB === idx;

  const nextIncoming = offerId ? current.incomingOffers.filter((o) => o.offerId !== offerId) : current.incomingOffers;
  const nextOutgoing = offerId ? current.outgoingOffers.filter((o) => o.offerId !== offerId) : current.outgoingOffers;
  if (!isParticipant) return { ...current, incomingOffers: nextIncoming, outgoingOffers: nextOutgoing };

  const partner = colA === idx ? colB : colA;
  const hours = normalizeHours(data.hours ?? data.durationHours);
  const signedAtTick = Number(data.signedAtTick ?? data.startedAtTick ?? tick);
  const expiresAtTick = Number(data.expiresAtTick ?? signedAtTick + hours * 3600 * TICKS_PER_SECOND);

  const newTruce: DiplomacyTruceView = {
    truceId,
    colonyA: colA,
    colonyB: colB,
    colonyAId: data.colonyAId ? String(data.colonyAId) : undefined,
    colonyBId: data.colonyBId ? String(data.colonyBId) : undefined,
    partnerColony: partner,
    partnerColonyId: colA === idx ? (data.colonyBId ? String(data.colonyBId) : undefined) : (data.colonyAId ? String(data.colonyAId) : undefined),
    hours,
    signedAtTick,
    expiresAtTick,
    status: 'active',
    ...parseBond(data),
  };

  return {
    ...current,
    incomingOffers: nextIncoming,
    outgoingOffers: nextOutgoing,
    truces: [...current.truces.filter((t) => t.truceId !== truceId), newTruce],
  };
}

function handleTruceNotice(current: DiplomacyColonyView, data: Record<string, unknown>, idx: number, tick: number): DiplomacyColonyView {
  const truceId = String(data.truceId || '');
  const cancelledBy = typeof data.cancelledBy === 'number' ? data.cancelledBy : typeof data.cancelledByColony === 'number' ? data.cancelledByColony : undefined;
  const noticeEndsAtTick = Number(data.noticeEndsAtTick ?? tick + 600 * TICKS_PER_SECOND);

  const nextTruces = current.truces.map((t) =>
    t.truceId !== truceId ? t : { ...t, status: 'notice' as const, noticeEndsAtTick, cancelledBy },
  );
  let oathUntil = current.oathbreakerUntil;
  if (cancelledBy === idx) {
    oathUntil = typeof data.oathbreakerUntilTick === 'number' ? data.oathbreakerUntilTick : noticeEndsAtTick + 24 * 3600 * TICKS_PER_SECOND;
  }
  return { ...current, truces: nextTruces, oathbreakerUntil: oathUntil };
}

function handleTruceEnded(current: DiplomacyColonyView, data: Record<string, unknown>, idx: number): DiplomacyColonyView {
  const truceId = String(data.truceId || '');
  const nextTruces = current.truces.filter((t) => t.truceId !== truceId);
  let oathUntil = current.oathbreakerUntil;
  if (typeof data.oathbreakerUntilTick === 'number' && (Number(data.cancelledBy) === idx || Number(data.cancelledByColony) === idx)) {
    oathUntil = data.oathbreakerUntilTick;
  }
  return { ...current, truces: nextTruces, oathbreakerUntil: oathUntil };
}

function handleWarDeclared(current: DiplomacyColonyView, data: Record<string, unknown>, idx: number, tick: number): DiplomacyColonyView {
  const warId = String(data.warId || '');
  if (!warId) return current;
  const attacker = Number(data.attackerColonyIndex ?? data.attackerColony ?? 0);
  const defender = Number(data.defenderColonyIndex ?? data.defenderColony ?? 0);
  if (attacker !== idx && defender !== idx) return current;

  const warView: DiplomacyWarView = {
    warId,
    attackerColony: attacker,
    defenderColony: defender,
    partnerColony: attacker === idx ? defender : attacker,
    role: attacker === idx ? 'attacker' : 'defender',
    bondToken: typeof data.bondToken === 'string' ? data.bondToken : 'NEAR',
    bondAmount: Number(data.bondAmount ?? 5),
    declaredAtTick: Number(data.declaredAtTick ?? tick),
    expiresAtTick: Number(data.expiresAtTick ?? tick + 6 * 3600 * TICKS_PER_SECOND),
    structuresDestroyed: 0,
    resourcesSiphoned: 0,
    status: 'active',
  };
  const prev = current.wars ?? [];
  return { ...current, wars: [...prev.filter((w) => w.warId !== warId), warView] };
}

function handleWarEnded(current: DiplomacyColonyView, data: Record<string, unknown>): DiplomacyColonyView {
  const warId = String(data.warId || '');
  if (!warId) return current;
  return { ...current, wars: (current.wars ?? []).filter((w) => w.warId !== warId) };
}

export function applyDiplomacySimEventInternal(
  current: DiplomacyColonyView,
  event: { kind: string; data?: Record<string, unknown> },
  ownColonyIdx?: number,
  currentTick?: number,
): DiplomacyColonyView {
  const idx = ownColonyIdx ?? current.colonyIndex;
  const tick = currentTick ?? current.currentTick;
  const data = event.data || {};

  switch (event.kind) {
    case 'truceOffered':
      return handleTruceOffered(current, data, idx, tick);
    case 'truceSigned':
      return handleTruceSigned(current, data, idx, tick);
    case 'truceNotice':
      return handleTruceNotice(current, data, idx, tick);
    case 'truceEnded':
      return handleTruceEnded(current, data, idx);
    case 'warDeclared':
      return handleWarDeclared(current, data, idx, tick);
    case 'warEnded':
      return handleWarEnded(current, data);
    default:
      return current;
  }
}
