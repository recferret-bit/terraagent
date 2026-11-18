// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { applyLandingActiveColony } from './activeColony';

function mountLandingCards(): void {
  document.body.innerHTML = `
    <div class="page">
      <a class="btn btn-play-header" href="/play.html?planet=dune">PLAY</a>
      <section id="planets">
        <article class="planet">
          <canvas data-planet="dune"></canvas>
          <div class="planet-body">
            <div class="planet-head"><h3>Kharon</h3><span class="badge badge-recruiting">DESERT</span></div>
            <a class="btn btn-primary" href="/play.html?planet=dune">LAND ON KHARON</a>
          </div>
        </article>
        <article class="planet">
          <canvas data-planet="oceanForest"></canvas>
          <div class="planet-body">
            <div class="planet-head"><h3>Thalassa</h3><span class="badge badge-new">OCEAN</span></div>
            <a class="btn btn-primary" href="/play.html?planet=oceanForest">LAND ON THALASSA</a>
          </div>
        </article>
        <article class="planet">
          <canvas data-planet="forestRock"></canvas>
          <div class="planet-body">
            <div class="planet-head"><h3>Granite</h3><span class="badge badge-new">TEMPERATE</span></div>
            <a class="btn btn-primary" href="/play.html?planet=forestRock">LAND ON GRANITE</a>
          </div>
        </article>
      </section>
      <a class="btn-void" href="/play.html?planet=dune">DROP IN</a>
    </div>
  `;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('landing applyLandingActiveColony', () => {
  it('highlights the active planet card, disables other planets, and restores cleanly when cleared', () => {
    mountLandingCards();
    applyLandingActiveColony(document, {
      kind: 'oceanForest',
      planetType: 'ocean',
      planetId: 'pl_dev_ocean',
      planetName: 'Thalassa',
      colonyId: 'col_1',
      colonyName: 'Reef',
    });

    const cards = [...document.querySelectorAll<HTMLElement>('#planets article.planet')];
    const [dune, ocean, temp] = cards as [HTMLElement, HTMLElement, HTMLElement];

    expect(ocean.classList.contains('is-active-colony')).toBe(true);
    expect(ocean.querySelector('.planet-head .badge')?.textContent).toBe('YOUR COLONY');
    expect(ocean.querySelector('.planet-body .btn')?.getAttribute('href')).toBe('/play.html?planet=oceanForest');

    expect(dune.classList.contains('is-colony-locked')).toBe(true);
    expect(dune.getAttribute('aria-disabled')).toBe('true');
    expect(dune.querySelector('.planet-body .btn')?.getAttribute('href')).toBeNull();
    expect(temp.classList.contains('is-colony-locked')).toBe(true);
    expect(document.querySelector('.btn-play-header')?.getAttribute('href')).toBe('/play.html?planet=oceanForest');

    applyLandingActiveColony(document, null);
    expect(dune.classList.contains('is-colony-locked')).toBe(false);
    expect(dune.querySelector('.planet-body .btn')?.getAttribute('href')).toBe('/play.html?planet=dune');
    expect(ocean.classList.contains('is-active-colony')).toBe(false);
    expect(ocean.querySelector('.planet-head .badge')?.textContent).toBe('OCEAN');
  });
});
