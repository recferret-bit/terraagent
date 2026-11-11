import type { Feature } from '../../core/registry/types';

export const TRUCE_DURATIONS_HOURS = [2, 6, 24, 72] as const;
export type TruceDurationHours = (typeof TRUCE_DURATIONS_HOURS)[number];
export type TruceStatus = 'active' | 'notice' | 'ended';

export type GameFeature = Feature;

export const TICKS_PER_SECOND = 5;

export interface DiplomacyOfferView {
  offerId: string;
  fromColony: number;
  fromColonyId?: string;
  toColony: number;
  toColonyId?: string;
  hours: TruceDurationHours;
  offeredAtTick: number;
  expiresAtTick: number;
  status?: string;
}

export interface DiplomacyTruceView {
  truceId: string;
  colonyA: number;
  colonyB: number;
  colonyAId?: string;
  colonyBId?: string;
  partnerColony: number;
  partnerColonyId?: string;
  hours: TruceDurationHours;
  signedAtTick: number;
  expiresAtTick: number;
  status: TruceStatus;
  noticeEndsAtTick?: number;
  cancelledBy?: number;
}

export interface DiplomacyColonyView {
  colonyIndex: number;
  colonyId?: string;
  currentTick: number;
  oathbreakerUntil: number | null;
  incomingOffers: DiplomacyOfferView[];
  outgoingOffers: DiplomacyOfferView[];
  truces: DiplomacyTruceView[];
  contacts: number[];
}

export interface DiplomacyPanelActions {
  onRespondTruce(offerId: string, accept: boolean): void;
  onCancelTruce(truceId: string): void;
  onProposeTruce(targetColonyId: string | number, hours: TruceDurationHours): void;
}

export interface DiplomacyPanelOptions {
  actions?: Partial<DiplomacyPanelActions>;
  ownColonyIndex?: number;
  getOwnColonyIndex?: () => number;
  colonyId?: string;
}

import { formatCountdownSeconds } from '../shared/neighborMarkers';

export { formatCountdownSeconds };

export function formatTickRemaining(targetTick: number, currentTick: number): string {
  const remTicks = Math.max(0, targetTick - currentTick);
  const seconds = Math.ceil(remTicks / TICKS_PER_SECOND);
  return formatCountdownSeconds(seconds);
}

function normalizeHours(val: unknown): TruceDurationHours {
  if (val === 2 || val === 6 || val === 24 || val === 72) return val;
  const num = Number(val);
  if (num === 2 || num === 6 || num === 24 || num === 72) return num;
  return 6;
}

function resolveColonyAndTick(snapshot: unknown, ownColonyIdx: number, currentTick?: number): { col: any; tick: number; colId?: string } {
  const s = snapshot as any;
  let tick = typeof currentTick === 'number' && currentTick >= 0 ? currentTick : 0;
  if (typeof s?.tick === 'number') tick = s.tick;
  else if (typeof s?.meta?.tick === 'number') tick = s.meta.tick;

  let col: any = undefined;
  if (Array.isArray(s?.colonies)) {
    col = s.colonies.find((c: any) => c?.index === ownColonyIdx) ?? s.colonies[ownColonyIdx] ?? s.colonies[0];
  } else if (s && typeof s === 'object') {
    if (s.index !== undefined || s.diplomacy !== undefined || s.truces !== undefined) col = s;
    else if (s.colony && typeof s.colony === 'object') col = s.colony;
  }
  const colId = col?.id ? String(col.id) : undefined;
  return { col, tick, colId };
}

function extractOffers(col: any, ownColonyIdx: number, colId: string | undefined, tick: number): { incoming: DiplomacyOfferView[]; outgoing: DiplomacyOfferView[] } {
  const rawList: any[] = [];
  if (Array.isArray(col?.diplomacy?.incomingOffers)) rawList.push(...col.diplomacy.incomingOffers);
  if (Array.isArray(col?.diplomacy?.outgoingOffers)) rawList.push(...col.diplomacy.outgoingOffers);
  if (Array.isArray(col?.diplomacy?.offers)) rawList.push(...col.diplomacy.offers);
  if (Array.isArray(col?.offers)) rawList.push(...col.offers);

  const seen = new Set<string>();
  const incoming: DiplomacyOfferView[] = [];
  const outgoing: DiplomacyOfferView[] = [];

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const offerId = String(item.offerId || item.id || '');
    if (!offerId || seen.has(offerId)) continue;
    seen.add(offerId);

    const fromColony = Number(item.fromColony ?? item.fromColonyIndex ?? 0);
    const toColony = Number(item.toColony ?? item.toColonyIndex ?? 0);
    const fromColonyId = item.fromColonyId ? String(item.fromColonyId) : undefined;
    const toColonyId = item.toColonyId ? String(item.toColonyId) : undefined;
    const expiresAtTick = Number(item.expiresAtTick ?? 0);
    const status = String(item.status || 'pending');

    if (status !== 'pending' || expiresAtTick <= tick) continue;

    const offer: DiplomacyOfferView = {
      offerId,
      fromColony,
      fromColonyId,
      toColony,
      toColonyId,
      hours: normalizeHours(item.hours ?? item.durationHours),
      offeredAtTick: Number(item.offeredAtTick ?? 0),
      expiresAtTick,
      status,
    };

    const isIncoming = toColony === ownColonyIdx || (colId && toColonyId === colId);
    const isOutgoing = fromColony === ownColonyIdx || (colId && fromColonyId === colId);

    if (isIncoming) incoming.push(offer);
    else if (isOutgoing) outgoing.push(offer);
  }
  return { incoming, outgoing };
}

function extractTruces(col: any, ownColonyIdx: number, colId: string | undefined, tick: number): DiplomacyTruceView[] {
  const rawTruces: any[] = [];
  if (Array.isArray(col?.diplomacy?.truces)) rawTruces.push(...col.diplomacy.truces);
  if (Array.isArray(col?.truces)) rawTruces.push(...col.truces);

  const seen = new Set<string>();
  const result: DiplomacyTruceView[] = [];

  for (const item of rawTruces) {
    if (!item || typeof item !== 'object') continue;
    const truceId = String(item.truceId || item.id || '');
    if (!truceId || seen.has(truceId)) continue;
    seen.add(truceId);

    const colA = Number(item.colonyA ?? item.colonyAIndex ?? 0);
    const colB = Number(item.colonyB ?? item.colonyBIndex ?? 0);
    const colAId = item.colonyAId ? String(item.colonyAId) : undefined;
    const colBId = item.colonyBId ? String(item.colonyBId) : undefined;
    const expiresAtTick = Number(item.expiresAtTick ?? 0);
    const status = (item.status as TruceStatus) || 'active';

    if (status === 'ended' || expiresAtTick <= tick) continue;

    const isA = colA === ownColonyIdx || (colId && colAId === colId);
    const isB = colB === ownColonyIdx || (colId && colBId === colId);
    if (!isA && !isB) continue;

    result.push({
      truceId,
      colonyA: colA,
      colonyB: colB,
      colonyAId: colAId,
      colonyBId: colBId,
      partnerColony: isA ? colB : colA,
      partnerColonyId: isA ? colBId : colAId,
      hours: normalizeHours(item.hours ?? item.durationHours),
      signedAtTick: Number(item.signedAtTick ?? 0),
      expiresAtTick,
      status,
      noticeEndsAtTick: typeof item.noticeEndsAtTick === 'number' ? item.noticeEndsAtTick : undefined,
      cancelledBy: typeof item.cancelledBy === 'number' ? item.cancelledBy : undefined,
    });
  }
  return result;
}

export function extractDiplomacyColonyView(
  snapshot: unknown,
  ownColonyIdx = 0,
  currentTick?: number,
): DiplomacyColonyView {
  const { col, tick, colId } = resolveColonyAndTick(snapshot, ownColonyIdx, currentTick);
  const { incoming, outgoing } = extractOffers(col, ownColonyIdx, colId, tick);
  const truces = extractTruces(col, ownColonyIdx, colId, tick);

  let rawOath = col?.diplomacy?.oathbreakerUntil ?? col?.oathbreakerUntil;
  if (rawOath === undefined && col?.diplomacy?.oathbreakerUntilByColony) {
    rawOath = col.diplomacy.oathbreakerUntilByColony[ownColonyIdx] ?? col.diplomacy.oathbreakerUntilByColony[String(ownColonyIdx)];
  }
  const oathbreakerUntil = typeof rawOath === 'number' && rawOath > tick ? rawOath : null;

  const rawContacts = col?.diplomacy?.contacts ?? col?.contacts ?? [];
  const contacts = Array.isArray(rawContacts) ? rawContacts.map((c: unknown) => Number(c)).filter(Number.isInteger) : [];

  return {
    colonyIndex: ownColonyIdx,
    colonyId: colId,
    currentTick: tick,
    oathbreakerUntil,
    incomingOffers: incoming,
    outgoingOffers: outgoing,
    truces,
    contacts,
  };
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
  };

  if (toCol === idx) {
    return {
      ...current,
      incomingOffers: [...current.incomingOffers.filter((o) => o.offerId !== offerId), offerView],
    };
  }
  if (fromCol === idx) {
    return {
      ...current,
      outgoingOffers: [...current.outgoingOffers.filter((o) => o.offerId !== offerId), offerView],
    };
  }
  return current;
}

function handleTruceSigned(current: DiplomacyColonyView, data: Record<string, unknown>, idx: number, tick: number): DiplomacyColonyView {
  const offerId = data.offerId ? String(data.offerId) : undefined;
  const truceId = String(data.truceId || `tr_${Date.now()}`);
  const colA = Number(data.colonyA ?? data.colonyAIndex ?? 0);
  const colB = Number(data.colonyB ?? data.colonyBIndex ?? 0);
  const isParticipant = colA === idx || colB === idx;

  const nextIncoming = offerId ? current.incomingOffers.filter((o) => o.offerId !== offerId) : current.incomingOffers;
  const nextOutgoing = offerId ? current.outgoingOffers.filter((o) => o.offerId !== offerId) : current.outgoingOffers;

  if (!isParticipant) {
    return { ...current, incomingOffers: nextIncoming, outgoingOffers: nextOutgoing };
  }

  const partner = colA === idx ? colB : colA;
  const hours = normalizeHours(data.hours ?? data.durationHours);
  const signedAtTick = Number(data.signedAtTick ?? tick);
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
  const cancelledBy = typeof data.cancelledBy === 'number' ? data.cancelledBy : undefined;
  const noticeEndsAtTick = Number(data.noticeEndsAtTick ?? tick + 600 * TICKS_PER_SECOND);

  const nextTruces = current.truces.map((t) => {
    if (t.truceId !== truceId) return t;
    return { ...t, status: 'notice' as const, noticeEndsAtTick, cancelledBy };
  });

  let oathUntil = current.oathbreakerUntil;
  if (cancelledBy === idx) {
    oathUntil = noticeEndsAtTick + 24 * 3600 * TICKS_PER_SECOND;
  }
  return { ...current, truces: nextTruces, oathbreakerUntil: oathUntil };
}

function handleTruceEnded(current: DiplomacyColonyView, data: Record<string, unknown>, idx: number): DiplomacyColonyView {
  const truceId = String(data.truceId || '');
  const nextTruces = current.truces.filter((t) => t.truceId !== truceId);
  let oathUntil = current.oathbreakerUntil;
  if (typeof data.oathbreakerUntilTick === 'number' && Number(data.cancelledBy) === idx) {
    oathUntil = data.oathbreakerUntilTick;
  }
  return { ...current, truces: nextTruces, oathbreakerUntil: oathUntil };
}

export function applyDiplomacySimEvent(
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
    default:
      return current;
  }
}
