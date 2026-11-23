import { parseWaves } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import {
  CLOSED_DIPLOMACY_RECORDS_KEPT,
  compileData,
  createState,
  enforceDiplomacyRetention,
  ensureColonyRecord,
  hasActiveTruce,
  isTruceReofferCoolingDown,
  peekDiplomacyBlob,
  readDiplomacyBlob,
  seedStream,
  TRUCE_REOFFER_COOLDOWN_TICKS,
  trucesForPair,
  writeDiplomacyBlob,
  type DiplomacyBlobValue,
  type PlanetState,
  type SimEvent,
  type StepContext,
  type StoredTruceOffer,
  type StoredTruceRecord,
  type StoredWarRecord,
} from '../../src';
import { diplomacySystem, proposeTruceHandler } from '../../src/systems/diplomacy';

const flags = parseWaves('..18');
const data = compileData(flags);

function ctxFor(state: PlanetState, events: SimEvent[], tick: number): StepContext {
  return {
    dt: 1,
    tick,
    flags: flags as unknown as ReadonlySet<string>,
    data,
    rng: (s) => seedStream(String(state.meta.seed), `${s}:${tick}`),
    newEntityId: () => state.meta.nextEntityId++,
    emit: (e) => events.push(e as SimEvent),
    events,
    record: () => {},
    postings: [],
  };
}

function makeState(): PlanetState {
  const state = createState({ planetId: 'p_dip_ret', planetType: 'temperate', seed: 'dip-ret', radius: 16 });
  for (let i = 0; i < 4; i++) ensureColonyRecord(state, i, 0).status = 'active';
  return state;
}

const offer = (n: number, status: StoredTruceOffer['status'], from = 0, to = 1): StoredTruceOffer => ({
  offerId: `of_${n}`, fromColony: from, toColony: to, fromColonyId: `col_${from}`, toColonyId: `col_${to}`,
  fromColonyIndex: from, toColonyIndex: to, hours: 6, durationHours: 6, offeredAtTick: n, expiresAtTick: 10_000_000, status,
});
const truce = (n: number, status: StoredTruceRecord['status'], a = 0, b = 1): StoredTruceRecord => ({
  truceId: `tr_${n}`, colonyA: a, colonyB: b, colonyAId: `col_${a}`, colonyBId: `col_${b}`, colonyAIndex: a, colonyBIndex: b,
  hours: 6, durationHours: 6, signedAtTick: n, startedAtTick: n, expiresAtTick: 10_000_000, status,
});
const war = (n: number, status: StoredWarRecord['status']): StoredWarRecord => ({
  warId: `war_${n}`, attackerColony: 2, defenderColony: 3, attackerColonyIndex: 2, defenderColonyIndex: 3,
  attackerColonyId: 'col_2', defenderColonyId: 'col_3', bondToken: 'NEAR', bondAmount: 1, declaredAtTick: n,
  expiresAtTick: 10_000_000, structuresDestroyed: 0, resourcesSiphoned: 0, status,
});

/** A prod-like bloated blob: 593 offers (558 declined), 40 ended truces + 1 active, 30 closed wars + 1 active. */
function bloat(state: PlanetState): void {
  const blob = readDiplomacyBlob(state);
  for (let n = 1; n <= 593; n++) blob.offers[`of_${n}`] = offer(n, n === 593 ? 'pending' : n <= 558 ? 'declined' : n <= 584 ? 'expired' : 'accepted');
  for (let n = 1; n <= 40; n++) blob.truces[`tr_${n}`] = truce(n, 'ended', 0, 2);
  blob.truces.tr_41 = truce(41, 'active');
  for (let n = 1; n <= 30; n++) blob.wars[`war_${n}`] = war(n, n % 2 ? 'expired' : 'completed');
  blob.wars.war_31 = war(31, 'active');
  writeDiplomacyBlob(state, blob, 0);
}

const counts = (b: Readonly<DiplomacyBlobValue>) => ({
  offers: Object.keys(b.offers).length, truces: Object.keys(b.truces).length, wars: Object.keys(b.wars).length,
});

describe('diplomacy retention · closed-record caps and self-heal', () => {
  it('keeps open records plus the newest 16 closed records per kind', () => {
    const state = makeState();
    bloat(state);
    expect(enforceDiplomacyRetention(state, 1)).toBe(true);
    const b = peekDiplomacyBlob(state);
    expect(counts(b)).toEqual({ offers: 17, truces: 17, wars: 17 });
    expect(b.offers.of_593?.status).toBe('pending');
    expect(b.offers.of_577).toBeDefined();
    expect(b.offers.of_576).toBeUndefined(); // 577..592 are the newest 16 closed offers
    expect(b.truces.tr_41?.status).toBe('active');
    expect(b.truces.tr_25).toBeDefined();
    expect(b.truces.tr_24).toBeUndefined();
    expect(b.wars.war_31?.status).toBe('active');
    expect(CLOSED_DIPLOMACY_RECORDS_KEPT).toBe(16);
  });

  it('self-heals inside the diplomacy system silently and is idempotent (no second write)', () => {
    const state = makeState();
    bloat(state);
    const events: SimEvent[] = [];
    diplomacySystem.run(state, ctxFor(state, events, 1));
    expect(events).toHaveLength(0);
    expect(counts(peekDiplomacyBlob(state))).toEqual({ offers: 17, truces: 17, wars: 17 });
    const blobBefore = state.blobs.diplomacy;
    diplomacySystem.run(state, ctxFor(state, events, 2));
    expect(events).toHaveLength(0);
    expect(state.blobs.diplomacy).toBe(blobBefore);
    expect(enforceDiplomacyRetention(state, 3)).toBe(false);
  });

  it('does nothing at or below the cap (boundary: exactly 16 closed)', () => {
    const state = makeState();
    const blob = readDiplomacyBlob(state);
    for (let n = 1; n <= 16; n++) blob.offers[`of_${n}`] = offer(n, 'declined');
    writeDiplomacyBlob(state, blob, 0);
    expect(enforceDiplomacyRetention(state, 1)).toBe(false);
    expect(Object.keys(peekDiplomacyBlob(state).offers)).toHaveLength(16);
  });

  it('pruning ended truces never changes active-truce queries', () => {
    const state = makeState();
    bloat(state);
    expect(hasActiveTruce(state, 0, 1, 5)).toBe(true);
    expect(hasActiveTruce(state, 0, 2, 5)).toBe(false);
    enforceDiplomacyRetention(state, 5);
    expect(hasActiveTruce(state, 1, 0, 5)).toBe(true);
    expect(hasActiveTruce(state, 0, 2, 5)).toBe(false);
    expect(trucesForPair(state, 2, 0)).toHaveLength(16);
  });

  it('the pair index sees truces added by a writer that reuses its blob copy', () => {
    const state = makeState();
    const blob = readDiplomacyBlob(state);
    writeDiplomacyBlob(state, blob, 0);
    expect(hasActiveTruce(state, 2, 3, 1)).toBe(false);
    blob.truces.tr_9 = truce(9, 'active', 2, 3);
    writeDiplomacyBlob(state, blob, 1);
    expect(hasActiveTruce(state, 3, 2, 1)).toBe(true);
  });
});

describe('diplomacy · AI truce re-offer cooldown after a decline', () => {
  function stateWithDecline(declinedAt: number): PlanetState {
    const state = makeState();
    const blob = readDiplomacyBlob(state);
    blob.declinedAtByPair = { '0>1': declinedAt };
    writeDiplomacyBlob(state, blob, declinedAt);
    return state;
  }

  it('cools down for exactly 10 game minutes per directed pair', () => {
    const state = stateWithDecline(1000);
    expect(isTruceReofferCoolingDown(state, 0, 1, 1000)).toBe(true);
    expect(isTruceReofferCoolingDown(state, 0, 1, 1000 + TRUCE_REOFFER_COOLDOWN_TICKS - 1)).toBe(true);
    expect(isTruceReofferCoolingDown(state, 0, 1, 1000 + TRUCE_REOFFER_COOLDOWN_TICKS)).toBe(false);
    expect(isTruceReofferCoolingDown(state, 1, 0, 1000)).toBe(false);
    expect(isTruceReofferCoolingDown(state, 0, 2, 1000)).toBe(false);
  });

  it('rejects automated proposals during the cooldown with rate_limited; players are exempt', () => {
    const state = stateWithDecline(1000);
    const events: SimEvent[] = [];
    const args = { targetColonyIndex: 1, durationHours: 6 };
    for (const source of ['ai', 'bot'] as const) {
      const res = proposeTruceHandler.handle(state, { colonyIndex: 0, source, commandId: `c_${source}`, kind: 'diplomacy.proposeTruce', args }, ctxFor(state, events, 1100));
      expect((res as { code?: string } | undefined)?.code).toBe('rate_limited');
    }
    const player = proposeTruceHandler.handle(state, { colonyIndex: 0, source: 'player', commandId: 'c_p', kind: 'diplomacy.proposeTruce', args }, ctxFor(state, events, 1100));
    expect((player as { code?: string } | undefined)?.code).not.toBe('rate_limited');
  });

  it('stale cooldown entries are pruned by the retention pass', () => {
    const state = stateWithDecline(1000);
    expect(enforceDiplomacyRetention(state, 1000 + TRUCE_REOFFER_COOLDOWN_TICKS - 1)).toBe(false);
    expect(enforceDiplomacyRetention(state, 1000 + TRUCE_REOFFER_COOLDOWN_TICKS)).toBe(true);
    expect(peekDiplomacyBlob(state).declinedAtByPair).toEqual({});
  });
});
