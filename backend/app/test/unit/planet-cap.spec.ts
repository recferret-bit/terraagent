import 'reflect-metadata';
import { DEV_PLANET_CAPACITY, MAX_COLONIES_PER_PLANET } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { HomeRepository, HomeService } from '../../src/core/home';
import type { HomeLandingHost } from '../../src/core/home/home.service';
import { isCapacityTicket, QUEUE_EXPIRE_MS, QUEUE_LIVE_MS } from '../../src/core/home/parts/capacity-queue';
import { LobbyPersistenceService } from '../../src/lobby/lobby-persistence.service';
import { MemoryLobbyStore } from '../../src/lobby/memory-lobby.store';

const SEATS = Math.min(DEV_PLANET_CAPACITY, MAX_COLONIES_PER_PLANET);

/** A home service whose fake sim loads a planet when asked for a site (as `loadNew` does) and counts wakes. */
function rig(cap: number) {
  const repo = new HomeRepository();
  const lobby = new LobbyPersistenceService(undefined, undefined, new MemoryLobbyStore());
  const home = new HomeService(repo, undefined, lobby);
  const loaded = new Set<string>();
  const woken: string[] = [];
  const host: HomeLandingHost = {
    landingSite: async (planet, i) => { loaded.add(planet.id); return { ok: true, q: 10 + i, r: -i, slotIndex: i }; },
    ensureHomeLoaded: async (planet) => { if (!loaded.has(planet.id)) woken.push(planet.id); loaded.add(planet.id); },
  };
  home.setLandingHost(host);
  home.setCapacityGate({ cap, loadedPlanetIds: async () => new Set(loaded) });
  const seat = (id: string) => home.getOrAssignHome({ id, handle: id });
  const fill = async (prefix: string, n: number) => { for (let i = 0; i < n; i++) expect((await seat(`${prefix}${i}`)).state).toBe('ACTIVE'); };
  return { repo, lobby, home, loaded, woken, seat, fill };
}

describe('planet cap (3.4): at the cap no planet is created', () => {
  it('queues the next player in the lobby ticket queue instead of creating pl_dev_2', async () => {
    const r = rig(1);
    await r.fill('p_', SEATS);
    const out = await r.seat('p_late');
    expect(out.state).toBe('QUEUED');
    expect(await r.repo.findPlanetById('pl_dev_2')).toBeNull();
    expect((await r.repo.listPlanets()).map((p) => p.id)).toEqual(['pl_dev']);
    const ticket = await r.lobby.findActiveTicketByPlayer('p_late');
    expect(ticket && isCapacityTicket(ticket)).toBe(true);
    expect(ticket).toMatchObject({ mode: 'AUTO', planetId: 'pl_dev', planetType: 'desert', state: 'QUEUED' });
    // polling while still full keeps the player queued and creates nothing
    expect((await r.seat('p_late')).state).toBe('QUEUED');
    expect(await r.repo.findPlanetById('pl_dev_2')).toBeNull();
  });

  it('seats a new player on a loaded planet with a free seat when the cap is reached', async () => {
    const r = rig(1);
    await r.fill('p_', SEATS - 1);
    const out = await r.seat('p_last');
    expect(out.state).toBe('ACTIVE');
    expect(out.state === 'ACTIVE' && out.planet.id).toBe('pl_dev');
  });

  it('below the cap a full planet still gets a new sibling', async () => {
    const r = rig(2);
    await r.fill('p_', SEATS);
    const out = await r.seat('p_next');
    expect(out.state === 'ACTIVE' && out.planet.id).toBe('pl_dev_2');
  });

  it('prefers a loaded planet with a seat over waking an unloaded one, and wakes one below the cap instead of creating', async () => {
    const r = rig(2);
    await r.fill('a_', SEATS);
    await r.fill('b_', 1); // pl_dev_2 created and loaded
    // pl_dev frees a seat while it is unloaded (idle unload): pl_dev_2 (loaded) is still preferred
    const first = (await r.repo.listColoniesByPlanetId('pl_dev'))[0]!;
    await r.repo.deleteColony(first.id);
    r.loaded.delete('pl_dev');
    const out = await r.seat('c_0');
    expect(out.state === 'ACTIVE' && out.planet.id).toBe('pl_dev_2');
    expect(r.woken).toEqual([]);
    // with pl_dev_2 full too, the unloaded pl_dev is woken (restored), not a third planet created
    await r.fill('d_', SEATS - 2);
    const woke = await r.seat('e_0');
    expect(woke.state === 'ACTIVE' && woke.planet.id).toBe('pl_dev');
    expect(r.woken).toEqual(['pl_dev']);
    expect(await r.repo.findPlanetById('pl_dev_3')).toBeNull();
  });
});

describe('planet cap: the queue drains when a seat frees', () => {
  it('a queued player is seated (ACTIVE, ticket ASSIGNED) on the poll after a seat frees', async () => {
    const r = rig(1);
    await r.fill('p_', SEATS);
    expect((await r.seat('q_1')).state).toBe('QUEUED');
    const ticket = (await r.lobby.findActiveTicketByPlayer('q_1'))!;
    const leaving = (await r.repo.listColoniesByPlanetId('pl_dev'))[0]!;
    await r.repo.deleteColony(leaving.id);
    const out = await r.seat('q_1');
    expect(out.state).toBe('ACTIVE');
    expect(out.state === 'ACTIVE' && out.planet.id).toBe('pl_dev');
    expect((await r.lobby.getTicketById(ticket.id))?.state).toBe('ASSIGNED');
    expect(await r.lobby.findActiveTicketByPlayer('q_1')).toBeNull();
  });

  it('is first-in-first-out: the second in line waits while the first has not taken the seat', async () => {
    const r = rig(1);
    await r.fill('p_', SEATS);
    expect((await r.seat('q_1')).state).toBe('QUEUED');
    await new Promise((res) => setTimeout(res, 5)); // a later createdAt: the queue orders by priority, then age
    expect((await r.seat('q_2')).state).toBe('QUEUED');
    await r.repo.deleteColony((await r.repo.listColoniesByPlanetId('pl_dev'))[0]!.id);
    expect((await r.seat('q_2')).state).toBe('QUEUED');
    expect((await r.seat('q_1')).state).toBe('ACTIVE');
  });

  it('a newcomer does not take a freed seat ahead of the players already waiting', async () => {
    const r = rig(1);
    await r.fill('p_', SEATS);
    expect((await r.seat('q_1')).state).toBe('QUEUED');
    await new Promise((res) => setTimeout(res, 5)); // a later createdAt (same-millisecond tickets order by id)
    await r.repo.deleteColony((await r.repo.listColoniesByPlanetId('pl_dev'))[0]!.id);
    expect((await r.seat('newcomer')).state).toBe('QUEUED');
    expect((await r.seat('q_1')).state).toBe('ACTIVE');
  });

  it('a ticket abandoned for longer than the expiry is EXPIRED', async () => {
    const r = rig(1);
    await r.fill('p_', SEATS);
    expect((await r.seat('q_old')).state).toBe('QUEUED');
    const old = (await r.lobby.findActiveTicketByPlayer('q_old'))!;
    await r.lobby.updateTicket({ ticketId: old.id, now: new Date(Date.now() - QUEUE_EXPIRE_MS - 5_000) });
    expect((await r.seat('q_new')).state).toBe('QUEUED');
    await expect.poll(async () => (await r.lobby.getTicketById(old.id))?.state).toBe('EXPIRED');
  });

  it('a first-in-line ticket that stopped polling does not block the queue', async () => {
    const r = rig(1);
    await r.fill('p_', SEATS);
    expect((await r.seat('q_gone')).state).toBe('QUEUED');
    await new Promise((res) => setTimeout(res, 5));
    expect((await r.seat('q_here')).state).toBe('QUEUED');
    const gone = (await r.lobby.findActiveTicketByPlayer('q_gone'))!;
    await r.lobby.updateTicket({ ticketId: gone.id, now: new Date(Date.now() - QUEUE_LIVE_MS - 5_000) });
    await r.repo.deleteColony((await r.repo.listColoniesByPlanetId('pl_dev'))[0]!.id);
    expect((await r.seat('q_here')).state).toBe('ACTIVE');
  });
});
