import { ECOLOGY_CARDS, EFFECT_CARDS } from '../data/ecologyAndEffectsCatalog';
import { FLEET_CARDS, type EntityCardSpec } from '../data/entitiesCatalog';
import type { WhitepaperLiveStage3D } from '../liveStage3D';
import {
  createEntityCard3D,
  createSectionShell,
  makeEl,
} from './domHelpers';

interface FilterDef {
  readonly key: string;
  readonly label: string;
}

function countGroup(cards: ReadonlyArray<EntityCardSpec>, group: string): number {
  return cards.filter((c) => c.group === group).length;
}

function buildFilterableCardSection(
  sec: HTMLElement,
  cards: ReadonlyArray<EntityCardSpec>,
  filters: ReadonlyArray<FilterDef>,
  stage3D: WhitepaperLiveStage3D,
): void {
  const filterBar = makeEl('div', 'wp-filter-bar');
  filterBar.dataset.secFilter = sec.id;
  const grid = makeEl('div', 'wp-card3d-grid');
  const cardEls: HTMLElement[] = [];

  for (const spec of cards) {
    const el = createEntityCard3D(spec, stage3D);
    cardEls.push(el);
    grid.appendChild(el);
  }

  filters.forEach((f, idx) => {
    const btn = makeEl('button', `wp-filter-btn${idx === 0 ? ' is-active' : ''}`, f.label);
    btn.type = 'button';
    btn.dataset.filterKey = f.key;
    btn.dataset.filterGroup = f.key;
    btn.addEventListener('click', () => {
      for (const b of filterBar.querySelectorAll('.wp-filter-btn')) b.classList.remove('is-active');
      btn.classList.add('is-active');
      for (const card of cardEls) {
        card.hidden = f.key !== 'all' && card.dataset.group !== f.key;
      }
      window.dispatchEvent(new CustomEvent('wp:cards-changed', { detail: { secId: sec.id, filterKey: f.key } }));
    });
    filterBar.appendChild(btn);
  });

  sec.append(filterBar, grid);
}

export function buildEntitiesAndEffectsSections(stage3D: WhitepaperLiveStage3D): HTMLElement[] {
  const sec07 = createSectionShell(
    'sec-07',
    '07',
    'LIVE 3D CATALOG // UNITS & STRUCTURES',
    '3D Fleet & Structures: Robots, Orbital Vessels & Colony Buildings (28 Models)',
    'Every model renders live through TerraAgent’s Three.js kitbash PBR pipeline with the Unifier biome shader (switchable in the top bar across Dune, Ocean Forest, and Forest Rock). Hover or tap any card to animate GPU kinematics, walk cycles, construction masks, or Ruin decay.',
  );
  buildFilterableCardSection(
    sec07,
    FLEET_CARDS,
    [
      { key: 'all', label: `All (${FLEET_CARDS.length})` },
      { key: 'robots', label: 'Robots (5)' },
      { key: 'orbital', label: 'Ships & Sats (7)' },
      { key: 'buildings', label: 'Buildings (16)' },
    ],
    stage3D,
  );

  const sec08 = createSectionShell(
    'sec-08',
    '08',
    'LIVE 3D CATALOG // ECOLOGY & DEPOSITS',
    'Alien Fauna, Species Hives, Ambient Nests & Deposit Stages (13 Models)',
    'Hostile insect species use segmented chitin armor and tripod combat states; ambient Skitters and pelagic Drifters inhabit native nests; resource outcrops shrink visibly across Full, Half, and Depleted extraction stages.',
  );
  buildFilterableCardSection(
    sec08,
    ECOLOGY_CARDS,
    [
      { key: 'all', label: `All (${ECOLOGY_CARDS.length})` },
      { key: 'fauna', label: 'Fauna (5)' },
      { key: 'hives', label: 'Hives & Nests (5)' },
      { key: 'deposits', label: 'Deposits (3)' },
    ],
    stage3D,
  );

  const sec09 = createSectionShell(
    'sec-09',
    '09',
    'LIVE 3D CATALOG // VFX & SHADERS',
    `Visual Effects: 3D Work Particles, Combat Bursts, Storms & Shaders (${EFFECT_CARDS.length} Effects)`,
    'Zero flat 2D sprite templates: harvesting, terraforming, combat impacts, and storms emit instanced 3D chunks with ground-bounce physics, high CIE Lab contrast, and selective HDR Bloom, alongside live Water, Unifier, Day/Night, Build, and Ruin shaders.',
  );
  buildFilterableCardSection(
    sec09,
    EFFECT_CARDS,
    [
      { key: 'all', label: `All (${EFFECT_CARDS.length})` },
      { key: 'work', label: `Work & Cutter Beams (${countGroup(EFFECT_CARDS, 'work')})` },
      { key: 'combat', label: `Combat Bursts (${countGroup(EFFECT_CARDS, 'combat')})` },
      { key: 'hazards', label: `Weather & Storms (${countGroup(EFFECT_CARDS, 'hazards')})` },
      { key: 'shaders', label: `Shaders, Projectiles & Rings (${countGroup(EFFECT_CARDS, 'shaders')})` },
    ],
    stage3D,
  );

  return [sec07, sec08, sec09];
}
