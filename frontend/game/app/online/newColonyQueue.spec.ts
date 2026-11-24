import { describe, expect, it, vi } from 'vitest';
import {
  buildActiveQueueFilter,
  buildCoordinatorHomeUrl,
  extractActiveHomePayload,
  inspectTrackedNewColonyTicketHelper,
  type QueuedHomeStatus,
} from './joinQueueHomeExtract';
import type { StorageLike } from './bootOnline';

const mem = (): StorageLike => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

describe('Multi-colony planet-cap queue helpers (?new=1)', () => {
  it('keeps new=1 on polls and omits family base planetId so overflow planets match', () => {
    const latestQueue: QueuedHomeStatus = {
      state: 'QUEUED',
      ticketId: 'tkt_cap_1',
      ticketState: 'QUEUED',
      planetId: 'pl_dev',
      planetType: 'desert',
      sectorIntent: { kind: 'chosen', sectorId: 'sec_1_0' },
      reservedSectorId: null,
      alternativeSectors: [],
      position: 1,
      etaS: null,
    };

    const pollUrl = buildCoordinatorHomeUrl({
      isInitial: false,
      planetType: 'desert',
      newColony: true,
      search: '',
      latestQueue,
    });
    expect(pollUrl).toContain('new=1');
    expect(pollUrl).toContain('sector=sec_1_0');
    expect(pollUrl).not.toContain('planetId=pl_dev');

    const filter = buildActiveQueueFilter({
      newColony: true,
      search: '',
      planetType: 'desert',
      latestQueue,
      priorActiveColonyIds: new Set(['col_1']),
    });
    expect(filter.planetId).toBeUndefined();

    const extracted = extractActiveHomePayload(
      {
        state: 'ACTIVE',
        planet: { id: 'pl_dev_2', name: 'Overflow Dunes', type: 'desert', state: 'ACTIVE' },
        colony: { id: 'col_2', colonyIndex: 0, name: 'Colony 2', color: 1, state: 'ACTIVE', foundingSectorId: 'sec_1_0', spawnQ: 1, spawnR: 2 },
        activeColonies: [
          { planet: { id: 'pl_dev', type: 'desert' }, colony: { id: 'col_1', colonyIndex: 0, name: 'Colony 1' } },
          { planet: { id: 'pl_dev_2', type: 'desert' }, colony: { id: 'col_2', colonyIndex: 0, name: 'Colony 2', foundingSectorId: 'sec_1_0' } },
        ],
      },
      { ...filter, planetId: 'pl_dev' },
    );
    expect(extracted?.planet.id).toBe('pl_dev_2');
    expect(extracted?.colony.id).toBe('col_2');
  });

  it('resolves ASSIGNED capacity tickets via GET /v1/me/home excluding prior colonies', async () => {
    const doFetch = vi.fn(async (url: string) => {
      if (url === '/v1/match/tickets/tkt_cap_1') {
        return { ok: true, status: 200, json: async () => ({ id: 'tkt_cap_1', status: 'ASSIGNED' }) };
      }
      if (url === '/v1/me/home') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            state: 'ACTIVE',
            planet: { id: 'pl_dev_2', type: 'desert', state: 'ACTIVE' },
            colony: { id: 'col_2', colonyIndex: 0, name: 'Colony 2', state: 'ACTIVE', spawnQ: 3, spawnR: 4 },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    const res = await inspectTrackedNewColonyTicketHelper({
      ticketId: 'tkt_cap_1',
      accessToken: 'tok',
      doFetch,
      storage: mem(),
      search: '',
      clearPending: () => undefined,
      fallback: { planetType: 'desert' },
      priorActiveColonyIds: new Set(['col_1']),
      onQueued: () => undefined,
    });
    expect(res && res !== 'cancelled' ? res.colony.id : null).toBe('col_2');
  });
});
