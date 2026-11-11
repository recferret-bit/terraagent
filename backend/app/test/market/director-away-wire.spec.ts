import 'reflect-metadata';
import { DIGEST_DIRECTOR_TRADE, type AutoTradeLimit, type NotificationPayload } from '@terra/contracts';
import type { SimEvent } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { AwayDigestService } from '../../src/game/digest/service.js';
import { MemoryDigestStore } from '../../src/game/digest/memory-store.js';
import type { GamePlanets } from '../../src/game/game-planets.service.js';
import { DirectorDigestRecorder } from '../../src/market/director/digest-recorder.js';
import { DirectorLoopService } from '../../src/market/director/director-loop.service.js';
import {
  DirectorMarketPort,
  type DirectorFill,
  type DirectorPlace,
} from '../../src/market/director/director-market.js';
import { DirectorColonySource, type DirectorColonyView } from '../../src/market/director/director-source.js';
import type { DirectorKeyRepository } from '../../src/near/director-key/director-key.repository.js';
import { InMemoryAgentWallet } from '../../src/near/testing/in-memory-agent-wallet.js';
import { AlertRouter } from '../../src/notify/alert-router.js';
import type { MockNotifyPut, MockNotifyRow, MockNotifyStore } from '../../src/notify/mock-notify.store.js';
import { MockNotifier } from '../../src/notify/mock-notifier.js';
import { MemoryPresence } from '../../src/notify/presence.js';
import { NotifierPort, type Notification, type NotificationResult } from '../../src/ports/notifier.port.js';

const COLONY = 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const SOLD = 'Director sold 300 metals to the Guild.';
const limit: AutoTradeLimit = {
  maxPerTrade: 300,
  maxPerSession: 600,
  minStock: 200,
  partners: 'guild',
  sellAboveStoragePct: 80,
};
const tight: AutoTradeLimit = { ...limit, maxPerSession: 300 };

class MemSource extends DirectorColonySource {
  constructor(private readonly row: DirectorColonyView) {
    super();
  }
  load(): Promise<DirectorColonyView | null> {
    return Promise.resolve(this.row);
  }
  listAway(): Promise<readonly string[]> {
    return Promise.resolve(this.row.away ? [this.row.colonyId] : []);
  }
}

class MemMarket extends DirectorMarketPort {
  place(order: DirectorPlace): Promise<DirectorFill> {
    void order;
    return Promise.resolve({ status: 'filled', tradeId: 'trade-300', counterparty: 'Guild' });
  }
}

class MemKeys {
  constructor(private readonly row: { colonyId: string; accountId: string; publicKey: string; revokedAt: null }) {}
  find(): Promise<typeof this.row> {
    return Promise.resolve(this.row);
  }
  save(): Promise<void> {
    return Promise.resolve();
  }
}

class CapturedNotes implements MockNotifyStore {
  constructor(private readonly notes: NotificationPayload[]) {}
  async put(payload: NotificationPayload): Promise<MockNotifyPut> {
    const hit = this.notes.find(
      (row) => row.colonyId === payload.colonyId && row.eventId === payload.eventId && row.channel === payload.channel,
    );
    if (hit) return { row: toRow(hit), inserted: false };
    this.notes.push(payload);
    return { row: toRow(payload), inserted: true };
  }
}

class StorePort extends NotifierPort {
  constructor(private readonly inner: MockNotifier) {
    super();
  }
  send(note: Notification): Promise<NotificationResult> {
    return this.inner.send(note);
  }
}

function toRow(payload: NotificationPayload): MockNotifyRow {
  return { id: payload.eventId, colonyId: payload.colonyId, eventId: payload.eventId, channel: payload.channel };
}

function view(colonyId: string, rowLimit: AutoTradeLimit, away: boolean): DirectorColonyView {
  return {
    colonyId,
    colonyIndex: 0,
    planetId: 'pl_dir',
    playerId: 'player-1',
    away,
    tick: 12,
    rows: [
      {
        forecast: {
          resource: 'metals.t1',
          stock: 1400,
          storageCap: 1500,
          queued: 0,
          reserved: 0,
          serviceWindow: 0,
          reserveFloor: 200,
          reserveHorizon: 0,
          sessionSpent: 0,
          partner: 'guild',
          limit: rowLimit,
        },
        reference: { num: 1_000_000n, den: 1n },
        ownUnitCost: { num: 800_000n, den: 1n },
        target: 750,
      },
    ],
  };
}

/** W00–W25 with one wave removed, so pricing tables stay on while that wave is off. */
function exceptWave(drop: number): string {
  const nums: string[] = [];
  for (let n = 0; n <= 25; n++) if (n !== drop) nums.push(String(n).padStart(2, '0'));
  return nums.join(',');
}

async function openKey(tag: string, allowance: string) {
  const wallet = new InMemoryAgentWallet();
  const name = `${tag}${Math.random().toString(36).slice(2, 8)}`;
  const created = await wallet.createSubAccount({ opId: `acct:${name}`, parent: 'npc.terraagent.mock', name });
  const publicKey = `ed25519:${name}`;
  await wallet.addLimitedKey({
    opId: `key:${name}`,
    accountId: created.accountId,
    publicKey,
    allowance: '0',
    receiverId: 'intents.near',
    methodNames: ['execute_intents'],
    tokens: [{ token: 'metals.t1', allowance }],
  });
  return { wallet, accountId: created.accountId, publicKey };
}

function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function start(waves: string, row: DirectorColonyView, opened: { wallet: InMemoryAgentWallet; accountId: string; publicKey: string }) {
  const bus = new EventBus();
  const flags = new FlagsService({ TA_WAVES: waves } as never);
  const store = new MemoryDigestStore();
  const digests = new AwayDigestService({ store, now: () => new Date('2026-11-09T12:00:00.000Z') });
  const fanned: SimEvent[] = [];
  const planets = {
    fanEvent(_planetId: string, event: SimEvent) {
      fanned.push(event);
    },
  } as unknown as GamePlanets;
  const recorder = new DirectorDigestRecorder(bus, flags, digests, planets);
  recorder.onModuleInit();
  const notes: NotificationPayload[] = [];
  const router = new AlertRouter(new StorePort(new MockNotifier(new CapturedNotes(notes), new MemoryPresence())), bus, flags);
  router.onModuleInit();
  const events: string[] = [];
  bus.on('planet.event', (event) => events.push(event.kind), { module: 'test' });
  const keys = new MemKeys({ colonyId: row.colonyId, accountId: opened.accountId, publicKey: opened.publicKey, revokedAt: null });
  const service = new DirectorLoopService(
    flags,
    opened.wallet,
    keys as unknown as DirectorKeyRepository,
    bus,
    new MemSource(row),
    new MemMarket(),
    undefined,
    digests,
  );
  return {
    service,
    digests,
    store,
    fanned,
    notes,
    events,
    stop() {
      recorder.onModuleDestroy();
      router.onModuleDestroy();
    },
  };
}

describe('W15-36 director away digest', () => {
  it('one away sell is the welcome digest line', async () => {
    const opened = await openKey('sell', '600');
    const wired = start('all', view(COLONY, limit, true), opened);
    expect(await wired.service.runDirectorOnce(COLONY)).toMatchObject({ ok: true, amount: 300, side: 'sell' });
    await settle();
    const welcome = await wired.digests.deliverWelcome(COLONY, new Date('2026-11-09T13:00:00.000Z'));
    expect(welcome?.items).toEqual([{ kind: DIGEST_DIRECTOR_TRADE, line: SOLD }]);
    wired.stop();
  });

  it('exhaustion notifies away_budget_exhausted once', async () => {
    const opened = await openKey('cap', '300');
    const wired = start('all', view(COLONY, tight, true), opened);
    expect(await wired.service.runDirectorOnce(COLONY)).toMatchObject({ ok: true, spent: 300, allowance: 300 });
    await settle();
    expect(wired.events.filter((kind) => kind === 'directorAllowanceExhausted')).toHaveLength(1);
    expect(wired.notes.map((note) => note.kind)).toEqual(['away_budget_exhausted']);
    expect(await wired.service.runDirectorOnce(COLONY)).toEqual({ ok: false, skip: 'allowance_exhausted' });
    await settle();
    expect(wired.notes).toHaveLength(1);
    expect(wired.events.filter((kind) => kind === 'directorAllowanceExhausted')).toHaveLength(1);
    wired.stop();
  });

  it('W15 off stores no digest item and does not notify', async () => {
    const opened = await openKey('off', '300');
    const wired = start('..14', view(COLONY, tight, true), opened);
    expect(await wired.service.runDirectorOnce(COLONY)).toEqual({ ok: false, skip: 'wave_disabled' });
    await settle();
    expect(await wired.store.findOpen(COLONY)).toBeNull();
    expect(wired.notes).toHaveLength(0);
    expect(wired.events).toEqual([]);
    wired.stop();
  });

  it('W09 off fans the HUD line and does not notify', async () => {
    const opened = await openKey('hud', '300');
    const wired = start(exceptWave(9), view(COLONY, tight, true), opened);
    expect(await wired.service.runDirectorOnce(COLONY)).toMatchObject({ ok: true, amount: 300 });
    await settle();
    expect(wired.fanned[0]?.data.line).toBe(SOLD);
    expect(await wired.store.findOpen(COLONY)).toBeNull();
    expect(wired.notes).toHaveLength(0);
    expect(wired.events).toContain('directorAllowanceExhausted');
    wired.stop();
  });

  it('a present colony does not open a digest row', async () => {
    const opened = await openKey('here', '600');
    const wired = start('all', view(COLONY, limit, false), opened);
    expect(await wired.service.runDirectorOnce(COLONY)).toMatchObject({ ok: true, amount: 300 });
    await settle();
    expect(await wired.store.findOpen(COLONY)).toBeNull();
    wired.stop();
  });
});
