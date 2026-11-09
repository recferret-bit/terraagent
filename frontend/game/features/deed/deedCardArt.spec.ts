// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeedMetadataV1 } from '@terra/contracts';
import {
  computeHexPolygonPoints,
  createDeedCardArtElement,
  createHexTerritorySvg,
  DEFAULT_DEED_HEX_CLUSTER,
  DEED_SHOWCASE_VARIANTS,
  mountDeedCardShowcase,
  resolveDeedBadgeLabel,
  resolveDeedVisualVariant,
} from './deedCardArt';

const CSS_PATH = resolve(process.cwd(), 'frontend/game/features/deed/deedCardArt.css');

function makeMeta(overrides: Partial<DeedMetadataV1> = {}): DeedMetadataV1 {
  return {
    planet: 'p-dune-01',
    colony: 'col-alpha',
    colonyName: 'Alpha Bastion',
    planetType: 'dune',
    stage: 3,
    terraformBp: 4200,
    tradeVolume: 900,
    truces: 2,
    rank: 1,
    territoryHexes: [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 0, r: 1 },
    ],
    status: 'active',
    settled: false,
    version: 2,
    imageUrl: '/v1/near/deed/deed:col-alpha/image.png?v=2',
    ...overrides,
  };
}

describe('deedCardArt (W20-11) — variant resolution & helpers', () => {
  it('resolves active, settled, eliminated, and abandoned variants accurately', () => {
    expect(resolveDeedVisualVariant({ status: 'active', settled: false })).toBe('active');
    expect(resolveDeedVisualVariant({ status: 'settled', settled: true })).toBe('settled');
    expect(resolveDeedVisualVariant({ status: 'active', settled: true })).toBe('settled');
    expect(resolveDeedVisualVariant({ status: 'settled', settled: false })).toBe('settled');
    expect(resolveDeedVisualVariant({ status: 'eliminated', settled: false })).toBe('eliminated');
    expect(resolveDeedVisualVariant({ status: 'abandoned', settled: false })).toBe('abandoned');
    expect(resolveDeedVisualVariant({ status: 'eliminated', settled: true })).toBe('settled');
  });

  it('returns canonical Faction Plate badge labels for each variant', () => {
    expect(resolveDeedBadgeLabel('active')).toBe('ACTIVE DEED');
    expect(resolveDeedBadgeLabel('settled')).toBe('SETTLED DEED');
    expect(resolveDeedBadgeLabel('eliminated')).toBe('ELIMINATED DEED');
    expect(resolveDeedBadgeLabel('abandoned')).toBe('ABANDONED DEED');
  });

  it('computes 6-vertex hexagon polygon points around center', () => {
    const pts = computeHexPolygonPoints(160, 88, 14).split(' ');
    expect(pts).toHaveLength(6);
    for (const pair of pts) {
      expect(pair).toMatch(/^\d+(\.\d+)?,\d+(\.\d+)?$/);
    }
  });
});

describe('deedCardArt (W20-11) — hex territory SVG thumbnail', () => {
  it('renders custom hex cluster with center cell highlighted', () => {
    const svg = createHexTerritorySvg(
      [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: -1, r: 1 },
      ],
      'settled',
    );
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.getAttribute('data-variant')).toBe('settled');
    expect(svg.getAttribute('data-hex-count')).toBe('3');
    expect(svg.querySelector('.ta-deed-card__hex-caption')?.textContent).toBe('HEX TERRITORY (3)');
    const cells = svg.querySelectorAll('.ta-deed-card__hex-cell');
    expect(cells).toHaveLength(3);
    expect(svg.querySelectorAll('.ta-deed-card__hex-cell--center')).toHaveLength(1);
  });

  it('falls back to default 7-hex cluster when hexes are omitted or empty', () => {
    const svgEmpty = createHexTerritorySvg([], 'active');
    expect(svgEmpty.getAttribute('data-hex-count')).toBe(String(DEFAULT_DEED_HEX_CLUSTER.length));
    expect(svgEmpty.querySelectorAll('.ta-deed-card__hex-cell')).toHaveLength(7);
  });

  it('clamps large territory clusters to 37 hexes within the SVG viewBox bounds', () => {
    const manyHexes = Array.from({ length: 50 }, (_, idx) => ({
      q: (idx % 7) - 3,
      r: Math.floor(idx / 7) - 3,
    }));
    const svg = createHexTerritorySvg(manyHexes, 'active');
    expect(svg.getAttribute('data-hex-count')).toBe('37');
    expect(svg.querySelectorAll('.ta-deed-card__hex-cell')).toHaveLength(37);
  });
});

describe('deedCardArt (W20-11) — createDeedCardArtElement DOM & security', () => {
  it('renders active, settled, eliminated, and abandoned card elements with expected classes and attributes', () => {
    const activeCard = createDeedCardArtElement(makeMeta({ status: 'active', settled: false }));
    expect(activeCard.classList.contains('ta-deed-card--active')).toBe(true);
    expect(activeCard.getAttribute('data-deed-variant')).toBe('active');
    expect(activeCard.getAttribute('data-token-id')).toBe('deed:col-alpha');
    expect(activeCard.querySelector('[data-testid="deed-card-badge"]')?.textContent).toBe('ACTIVE DEED');
    expect(activeCard.querySelector('[data-testid="deed-card-version"]')?.textContent).toBe('v2');
    expect(activeCard.querySelector('[data-testid="deed-card-colony"]')?.textContent).toBe('Alpha Bastion');
    expect(activeCard.querySelector('[data-testid="deed-card-planet"]')?.textContent).toBe('PLANET: p-dune-01 · DUNE');
    expect(activeCard.querySelector('[data-testid="deed-card-ribbon"]')?.getAttribute('data-stage')).toBe('S3');
    expect(activeCard.querySelectorAll('.ta-deed-card__stage-pip--lit')).toHaveLength(3);
    expect(activeCard.querySelector('[data-testid="deed-card-tf-pct"]')?.textContent).toBe('42%');
    expect(
      activeCard.querySelector<HTMLElement>('[data-testid="deed-card-tf-fill"]')?.style.width,
    ).toBe('42%');

    const settledCard = createDeedCardArtElement(
      makeMeta({ status: 'settled', settled: true, stage: 4, terraformBp: 10_000, version: 5 }),
      { tokenId: 'deed:col-helios', ownerAccountId: 'helios.near' },
    );
    expect(settledCard.classList.contains('ta-deed-card--settled')).toBe(true);
    expect(settledCard.getAttribute('data-deed-variant')).toBe('settled');
    expect(settledCard.querySelector('[data-testid="deed-card-badge"]')?.textContent).toBe('SETTLED DEED');
    expect(settledCard.querySelector('[data-testid="deed-card-tf-pct"]')?.textContent).toBe('100%');
    expect(settledCard.querySelector('[data-testid="deed-card-footer"]')?.textContent).toBe(
      'TOKEN: deed:col-helios · OWNER: helios.near',
    );

    const eliminatedCard = createDeedCardArtElement(
      makeMeta({ status: 'eliminated', settled: false, stage: 2, terraformBp: 2000 }),
    );
    expect(eliminatedCard.classList.contains('ta-deed-card--eliminated')).toBe(true);
    expect(eliminatedCard.getAttribute('data-deed-variant')).toBe('eliminated');
    expect(eliminatedCard.querySelector('[data-testid="deed-card-badge"]')?.textContent).toBe('ELIMINATED DEED');

    const abandonedCard = createDeedCardArtElement(
      makeMeta({ status: 'abandoned', settled: false }),
    );
    expect(abandonedCard.classList.contains('ta-deed-card--abandoned')).toBe(true);
    expect(abandonedCard.classList.contains('ta-deed-card--eliminated')).toBe(true);
    expect(abandonedCard.getAttribute('data-deed-variant')).toBe('abandoned');
    expect(abandonedCard.querySelector('[data-testid="deed-card-badge"]')?.textContent).toBe('ABANDONED DEED');
  });

  it('escapes untrusted script/HTML strings via textContent without executing or injecting elements', () => {
    const xssPayload = '<script>window.__xss=1</script><img src=x onerror=alert(1)>';
    const card = createDeedCardArtElement(
      makeMeta({
        colonyName: xssPayload,
        planet: xssPayload,
      }),
      { tokenId: `deed:${xssPayload}`, ownerAccountId: xssPayload },
    );
    expect(card.querySelectorAll('script')).toHaveLength(0);
    expect(card.querySelectorAll('img')).toHaveLength(0);
    expect(card.querySelector('[data-testid="deed-card-colony"]')?.textContent).toBe(xssPayload);
  });

  it('clamps out-of-range stage and terraformBp values and handles omitted optional fields', () => {
    const lowCard = createDeedCardArtElement(
      makeMeta({
        colonyName: undefined,
        planetType: undefined,
        stage: -4,
        terraformBp: -500,
        tradeVolume: undefined,
        truces: undefined,
        rank: undefined,
        walls: undefined,
      }),
    );
    expect(lowCard.querySelector('[data-testid="deed-card-colony"]')?.textContent).toBe('col-alpha');
    expect(lowCard.querySelector('[data-testid="deed-card-planet"]')?.textContent).toBe('PLANET: p-dune-01');
    expect(lowCard.querySelector('[data-testid="deed-card-ribbon"]')?.getAttribute('data-stage')).toBe('S0');
    expect(lowCard.querySelectorAll('.ta-deed-card__stage-pip--lit')).toHaveLength(0);
    expect(lowCard.querySelector('[data-testid="deed-card-tf-pct"]')?.textContent).toBe('0%');
    expect(lowCard.querySelector('[data-testid="deed-card-stats"]')?.textContent).toBe(
      'NEP-171 DYNAMIC COLONY DEED',
    );

    const highCard = createDeedCardArtElement(
      makeMeta({
        stage: 99,
        terraformBp: 25_000,
        walls: 12,
      }),
    );
    expect(highCard.querySelector('[data-testid="deed-card-ribbon"]')?.getAttribute('data-stage')).toBe('S10');
    expect(highCard.querySelectorAll('.ta-deed-card__stage-pip--lit')).toHaveLength(10);
    expect(highCard.querySelector('[data-testid="deed-card-tf-pct"]')?.textContent).toBe('100%');
    expect(highCard.querySelector('[data-testid="deed-card-stats"]')?.textContent).toContain('WALLS 12');
  });
});

describe('deedCardArt (W20-11) — /playground.html?deedcard=1 3-variant showcase', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('mounts all 3 canonical variants (active, settled, eliminated) side by side and hides #pg', () => {
    const pgDiv = document.createElement('div');
    pgDiv.id = 'pg';
    document.body.appendChild(pgDiv);

    const showcase = mountDeedCardShowcase(document.body);
    expect(pgDiv.style.display).toBe('none');
    expect(document.body.contains(showcase.root)).toBe(true);
    expect(showcase.root.getAttribute('data-testid')).toBe('deed-card-showcase');
    expect(showcase.cards).toHaveLength(3);
    expect(DEED_SHOWCASE_VARIANTS).toHaveLength(3);

    const variants = showcase.cards.map((c) => c.getAttribute('data-deed-variant'));
    expect(variants).toEqual(['active', 'settled', 'eliminated']);

    const names = showcase.cards.map(
      (c) => c.querySelector('[data-testid="deed-card-colony"]')?.textContent,
    );
    expect(names).toEqual(['Aegis Basin', 'Helios Crown', 'Cinder Outpost']);

    const stages = showcase.cards.map(
      (c) => c.querySelector('[data-testid="deed-card-ribbon"]')?.getAttribute('data-stage'),
    );
    expect(stages).toEqual(['S3', 'S4', 'S2']);

    const tfPcts = showcase.cards.map(
      (c) => c.querySelector('[data-testid="deed-card-tf-pct"]')?.textContent,
    );
    expect(tfPcts).toEqual(['40%', '100%', '20%']);
  });

  it('defines a 3-column side-by-side grid with min-width: 0 in deedCardArt.css to prevent clipping', () => {
    const css = readFileSync(CSS_PATH, 'utf8');
    expect(css).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    expect(css).toContain('.ta-deed-card--active');
    expect(css).toContain('.ta-deed-card--settled');
    expect(css).toContain('.ta-deed-card--eliminated');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
