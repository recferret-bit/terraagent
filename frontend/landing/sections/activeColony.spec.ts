// @vitest-environment jsdom
import { CANONICAL_PLANETS } from '@terra/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import type { PilotColonyRoster } from '../../design/pilot/activeHomeColony';
import { applyLandingActiveColony, applyLandingColonyRoster } from './activeColony';

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

  it('unlocks uncolonized worlds for Tier 2 stakers with open slots and locks uncolonized worlds when 3/3 slots are full', () => {
    mountLandingCards();
    const openRoster: PilotColonyRoster = {
      primary: {
        kind: 'dune', planetType: 'desert', planetId: CANONICAL_PLANETS.desert.id,
        planetName: 'Kharon', colonyId: 'col_1', colonyName: 'Alpha', foundingSectorId: 'sec_0_0',
      },
      colonies: [
        { kind: 'dune', planetType: 'desert', planetId: CANONICAL_PLANETS.desert.id, planetName: 'Kharon', colonyId: 'col_1', colonyName: 'Alpha', foundingSectorId: 'sec_0_0' },
      ],
      slots: { used: 1, max: 3, aiColonySlots: 3, isStaker: true, tier: 2, stakedNear: '50' },
    };
    applyLandingColonyRoster(document, openRoster);

    const [dune, ocean, temp] = [...document.querySelectorAll<HTMLElement>('#planets article.planet')] as [HTMLElement, HTMLElement, HTMLElement];
    expect(dune.classList.contains('is-active-colony')).toBe(true);
    const duneSelectOne = dune.querySelector<HTMLSelectElement>('[data-testid="landing-colony-select-dune"]')!;
    expect(duneSelectOne).not.toBeNull();
    expect([...duneSelectOne.options].map((o) => o.value)).toEqual(['col_1', '__new__']);
    expect(dune.querySelector('.planet-body .btn')?.textContent).toBe('ENTER ALPHA →');
    expect(dune.querySelector('.planet-body .btn')?.getAttribute('href')).toBe('/play.html?planet=dune&colonyId=col_1&sector=sec_0_0');
    duneSelectOne.value = '__new__';
    duneSelectOne.dispatchEvent(new Event('change'));
    expect(dune.querySelector('.planet-body .btn')?.getAttribute('href')).toBe('/play.html?planet=dune&new=1');
    expect(dune.querySelector('.planet-body .btn')?.textContent).toBe('DEPLOY IN NEW SECTOR →');

    expect(ocean.classList.contains('is-colony-locked')).toBe(false);
    expect(ocean.querySelector('.planet-head .badge')?.textContent).toBe('SLOT OPEN');
    expect(ocean.querySelector('.planet-body .btn')?.textContent).toBe('DEPLOY COLONY (1/3) →');
    expect(ocean.querySelector('.planet-body .btn')?.getAttribute('href')).toBe('/play.html?planet=oceanForest&new=1');

    applyLandingColonyRoster(document, {
      ...openRoster,
      colonies: [
        ...openRoster.colonies,
        { kind: 'dune', planetType: 'desert', planetId: CANONICAL_PLANETS.desert.id, planetName: 'Kharon', colonyId: 'col_2', colonyName: 'Beta', foundingSectorId: 'sec_1_0' },
        { kind: 'oceanForest', planetType: 'ocean', planetId: CANONICAL_PLANETS.ocean.id, planetName: 'Thalassa', colonyId: 'col_3', colonyName: 'Gamma', foundingSectorId: 'sec_0_0' },
      ],
      slots: { used: 3, max: 3, aiColonySlots: 3, isStaker: true, tier: 2, stakedNear: '50' },
    });
    expect(dune.querySelector('.planet-head .badge')?.textContent).toBe('2 COLONIES');
    expect(temp.classList.contains('is-colony-locked')).toBe(true);
    expect(temp.querySelector('.planet-body .btn')?.textContent).toBe('3/3 NEAR.AI SLOTS ACTIVE');

    // When 2 colonies occupy Kharon and open slots remain (2/6), selector offers both colonies AND "+ Deploy new colony in open sector"
    applyLandingColonyRoster(document, {
      ...openRoster,
      colonies: [
        { kind: 'dune', planetType: 'desert', planetId: CANONICAL_PLANETS.desert.id, planetName: 'Kharon', colonyId: 'col_1', colonyName: 'Alpha', foundingSectorId: 'sec_0_0' },
        { kind: 'dune', planetType: 'desert', planetId: CANONICAL_PLANETS.desert.id, planetName: 'Kharon', colonyId: 'col_2', colonyName: 'Beta', foundingSectorId: 'sec_1_0' },
      ],
      slots: { used: 2, max: 6, aiColonySlots: 6, isStaker: true, tier: 3, stakedNear: '200' },
    });
    const duneSelect = dune.querySelector<HTMLSelectElement>('[data-testid="landing-colony-select-dune"]')!;
    expect(duneSelect).not.toBeNull();
    expect([...duneSelect.options].map((o) => o.value)).toEqual(['col_1', 'col_2', '__new__']);
    duneSelect.value = '__new__';
    duneSelect.dispatchEvent(new Event('change'));
    expect(dune.querySelector('.planet-body .btn')?.getAttribute('href')).toBe('/play.html?planet=dune&new=1');
    expect(dune.querySelector('.planet-body .btn')?.textContent).toBe('DEPLOY IN NEW SECTOR →');
  });
});
