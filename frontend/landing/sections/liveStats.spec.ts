// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshLiveStats } from './liveStats';

function mountLandingFixture(): void {
  document.body.innerHTML = `
    <div class="page">
      <div class="stats">
        <div class="stat"><div data-stat="planetsActive">—</div></div>
        <div class="stat"><div data-stat="coloniesAlive">—</div></div>
        <div class="stat"><div data-stat="playersOnline">—</div></div>
      </div>
      <section id="planets">
        <article class="planet">
          <canvas data-planet="dune"></canvas>
          <div class="planet-body">
            <div class="planet-head"><h3>Kharon</h3><span class="badge badge-recruiting">DESERT</span></div>
            <a class="btn btn-primary" href="/play.html?planet=dune">LAND</a>
          </div>
        </article>
        <article class="planet">
          <canvas data-planet="oceanForest"></canvas>
          <div class="planet-body">
            <div class="planet-head"><h3>Thalassa</h3><span class="badge badge-new">OCEAN</span></div>
            <a class="btn btn-primary" href="/play.html?planet=oceanForest">LAND</a>
          </div>
        </article>
        <article class="planet">
          <canvas data-planet="forestRock"></canvas>
          <div class="planet-body">
            <div class="planet-head"><h3>Granite</h3><span class="badge badge-new">TEMPERATE</span></div>
            <a class="btn btn-primary" href="/play.html?planet=forestRock">LAND</a>
          </div>
        </article>
      </section>
    </div>
  `;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('landing liveStats', () => {
  it('hydrates hero counters and per-planet seat/colony/market cards without leaving dashes', async () => {
    mountLandingFixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input.endsWith('/v1/planets/stats')) {
          return new Response(
            JSON.stringify({ planetsActive: 3, coloniesAlive: 33, playersOnline: 0, updatedAt: '2026-11-17T10:00:00.000Z' }),
            { status: 200 },
          );
        }
        if (input.endsWith('/v1/planets')) {
          return new Response(
            JSON.stringify({
              planets: [
                {
                  id: 'pl_01JKHAR0NDVNEST00000000000',
                  type: 'desert',
                  availability: 'open',
                  validatedCapacity: 28,
                  reservedSeats: 0,
                  foundedSeats: 3,
                  freeSeats: 25,
                  livingColonies: 15,
                  onlinePlayers: 0,
                },
                {
                  id: 'pl_01JTHA1ASSAVERDE0000000001',
                  type: 'ocean',
                  availability: 'open',
                  validatedCapacity: 28,
                  reservedSeats: 0,
                  foundedSeats: 0,
                  freeSeats: 28,
                  livingColonies: 13,
                  onlinePlayers: 0,
                },
                {
                  id: 'pl_01JGRAN1TEH0110W0000000002',
                  type: 'temperate',
                  availability: 'open',
                  validatedCapacity: 28,
                  reservedSeats: 0,
                  foundedSeats: 0,
                  freeSeats: 28,
                  livingColonies: 5,
                  onlinePlayers: 0,
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            planetId: 'pl_01JKHAR0NDVNEST00000000000',
            overview: [{ pair: 'bio.water/USDC', bestBid: { num: '1', den: 1 }, bestAsk: null, last: null }],
          }),
          { status: 200 },
        );
      }),
    );

    await refreshLiveStats(document.querySelector('.page'));

    expect(document.querySelector('[data-stat="planetsActive"]')?.textContent).toBe('3');
    expect(document.querySelector('[data-stat="coloniesAlive"]')?.textContent).toBe('33');
    expect(document.querySelector('[data-stat="playersOnline"]')?.textContent).toBe('0');

    const lives = [...document.querySelectorAll('[data-planet-live]')];
    expect(lives).toHaveLength(3);
    expect(lives[0]!.textContent).toContain('25/28 SEATS · 15 COLONIES');
    expect(lives[0]!.querySelector<HTMLAnchorElement>('.planet-market-link')?.getAttribute('href')).toBe(
      '/trade.html?planet=pl_01JKHAR0NDVNEST00000000000',
    );
    expect(lives[0]!.querySelector('.planet-market-link')?.textContent).toBe('1 PAIRS LIVE →');
  });

  it('replaces empty dashes with sensible fallbacks when telemetry request fails', async () => {
    mountLandingFixture();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await refreshLiveStats(document.querySelector('.page'));

    expect(document.querySelector('[data-stat="planetsActive"]')?.textContent).toBe('3');
    expect(document.querySelector('[data-stat="coloniesAlive"]')?.textContent).toBe('15');
    expect(document.querySelector('[data-stat="playersOnline"]')?.textContent).toBe('0');
  });
});
