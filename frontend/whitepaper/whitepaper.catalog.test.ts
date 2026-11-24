// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ArchetypeCatalog } from '@terra/render/kitbash';
import { ParticlePresetRegistry } from '@terra/render/particles';
import { rewriteSubdomainLinks } from '../design/js/subdomainLinks';
import { CHAPTER_ITEMS, ENTITY_NAV_ITEMS, STACK_NAV_ITEMS } from './data/chapters';
import { ECOLOGY_CARDS, EFFECT_CARDS } from './data/ecologyAndEffectsCatalog';
import { FLEET_CARDS } from './data/entitiesCatalog';
import { RESOURCE_ROWS } from './data/mechanics';
import { buildGameplayAndEngineSections, mountCanonicalRisksSummary } from './sections/gameplayAndEngine';
import { buildWeb3AndAiSections } from './sections/web3AndAi';

function assertCssAndMarkupClean(): void {
  const tokensCss = readFileSync(resolve(import.meta.dirname, '../design/css/tokens.css'), 'utf8');
  const definedTokens = new Set(Array.from(tokensCss.matchAll(/(--ta-[a-z0-9-]+)\s*:/gi), (m) => m[1]));

  for (const file of ['whitepaper.css', 'rail.css', 'cards.css', 'schemas.css', 'index.html']) {
    const content = readFileSync(resolve(import.meta.dirname, file), 'utf8');
    expect(content).not.toMatch(/border-radius/);
    expect(content).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    expect(content).not.toMatch(/--ta-hull\b/);
    expect(content).not.toMatch(/\bbadge-(?:orange|blue|terra)\b/);

    if (file.endsWith('.css')) {
      for (const match of content.matchAll(/var\((--ta-[a-z0-9-]+)\)/gi)) {
        expect(definedTokens.has(match[1]!), `Undefined token ${match[1]} in ${file}`).toBe(true);
      }
    }
  }
}

describe('TerraAgent whitepaper 3D catalog parity', () => {
  it('covers every registered ArchetypeCatalog model cleanly', () => {
    const registered = new Set(ArchetypeCatalog.list().map((e) => e.id));
    const cards = [...FLEET_CARDS, ...ECOLOGY_CARDS, ...EFFECT_CARDS];
    const archetypeTargets = cards
      .filter((c) => c.renderKind === 'archetype' || c.renderKind === 'shaderFx')
      .map((c) => c.targetId);

    for (const id of archetypeTargets) {
      expect(registered.has(id), `Expected ArchetypeCatalog to contain ${id}`).toBe(true);
    }
    const cardSet = new Set(archetypeTargets);
    for (const id of registered) {
      expect(cardSet.has(id), `Expected whitepaper cards to cover registered archetype ${id}`).toBe(true);
    }

    for (const rigFile of ['stageRigs.ts', 'shaderRigs.ts']) {
      const rigSrc = readFileSync(resolve(import.meta.dirname, rigFile), 'utf8');
      for (const m of rigSrc.matchAll(/createArchetypeMesh\(\s*'([^']+)'/g)) {
        expect(registered.has(m[1]!), `Unknown archetype "${m[1]}" in ${rigFile}`).toBe(true);
      }
    }
  });

  it('covers every registered work and combat ParticlePresetRegistry entry', () => {
    // Tint variants (`variantOf`, e.g. W28 `work.<kind>.cyan`) are covered by their base preset's card.
    const presets = new Set(ParticlePresetRegistry.list().filter((p) => !p.variantOf).map((p) => p.id));
    const fxTargets = EFFECT_CARDS
      .filter((c) => c.renderKind === 'workFx' || c.renderKind === 'combatFx')
      .map((c) => c.targetId);

    for (const id of fxTargets) {
      expect(presets.has(id), `Expected ParticlePresetRegistry to contain ${id}`).toBe(true);
    }
    const fxSet = new Set(fxTargets);
    for (const id of presets) {
      expect(fxSet.has(id), `Expected whitepaper FX cards to cover preset ${id}`).toBe(true);
    }
  });
});

describe('TerraAgent whitepaper section ordering & token hygiene', () => {
  it('orders Web3, Income, and NEAR.AI up front and maps left-rail items cleanly', () => {
    expect(CHAPTER_ITEMS.slice(0, 4).map((c) => c.id)).toEqual([
      'sec-00',
      'sec-01',
      'sec-02',
      'sec-03',
    ]);
    expect(CHAPTER_ITEMS[1]?.accent).toBe('web3');
    expect(CHAPTER_ITEMS[2]?.accent).toBe('web3');
    expect(CHAPTER_ITEMS[3]?.accent).toBe('ai');

    const firstWeb2Idx = STACK_NAV_ITEMS.findIndex((item) => item.layer === 'WEB2');
    const lastWeb3Idx = STACK_NAV_ITEMS.map((item) => item.layer).lastIndexOf('WEB3');
    expect(lastWeb3Idx).toBeGreaterThan(-1);
    expect(firstWeb2Idx).toBeGreaterThan(lastWeb3Idx);

    const chapterIds = new Set(CHAPTER_ITEMS.map((c) => c.id));
    for (const item of [...STACK_NAV_ITEMS, ...ENTITY_NAV_ITEMS]) {
      expect(chapterIds.has(item.targetId), `Broken rail link ${item.targetId}`).toBe(true);
    }

    const allCards = [...FLEET_CARDS, ...ECOLOGY_CARDS, ...EFFECT_CARDS];
    expect(allCards.length).toBe(70); // W28 adds the uplink + gold hubs and the Lead Patron flagship
    for (const item of ENTITY_NAV_ITEMS) {
      const matching = allCards.filter((c) => c.group === item.filterGroup);
      expect(matching.length, `Entity nav count mismatch for ${item.group}`).toBe(item.count);
    }
  });

  it('keeps CSS and generated HTML free of raw hex, border-radius, undefined tokens, and env-var boilerplate', () => {
    assertCssAndMarkupClean();

    for (const srcFile of ['scrollAndNav.ts', 'sections/schemas.ts', 'sections/web3AndAi.ts', 'sections/gameplayAndEngine.ts', 'sections/domHelpers.ts']) {
      const src = readFileSync(resolve(import.meta.dirname, srcFile), 'utf8');
      expect(src).not.toMatch(/\binnerHTML\b/);
      expect(src).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
      expect(src).not.toMatch(/--ta-hull\b/);
    }

    const md = readFileSync(resolve(import.meta.dirname, 'whitepaper.md'), 'utf8');
    expect(md).not.toContain('NEAR_MODE=testnet / AI_PROVIDER=nearai');
    // D-31 invariant: neither static markdown nor interactive whitepaper sections may claim @terra/sim reads staking or runs staker fee discounts.
    expect(md).not.toMatch(/staker fee [^.]{0,40}@terra\/sim/i);

    const risksHost = document.createElement('div');
    risksHost.id = 'wpCanonicalRisksMount';
    document.body.appendChild(risksHost);
    mountCanonicalRisksSummary();
    const mountedText = [...buildWeb3AndAiSections(), ...buildGameplayAndEngineSections(), risksHost].map((s) => s.textContent ?? '').join('\n');
    risksHost.remove();
    expect(mountedText).not.toMatch(/staker fee discounts[^.]{0,60}@terra\/sim/i);
    expect(mountedText).toContain('never reads staking');
    expect(mountedText).toContain('4-Tier Orbital Patronage Matrix');
    expect(mountedText).toContain('Staker Profit Streams, Anti-Snipe Warmup & Exit Rules');
    expect(mountedText).toContain('Native-backing solvency guard');
    expect(md).toContain('| **T4 Planetary Patron** |');
    expect(md).toContain('Four Staker Profit & Effective APY Buckets');
    expect(md).toContain('TOTAL_NATIVE_BACKING_KEY');

    const featuresSrc = readFileSync(resolve(import.meta.dirname, 'data/features.ts'), 'utf8');
    const web3AiSrc = readFileSync(resolve(import.meta.dirname, 'sections/web3AndAi.ts'), 'utf8');
    expect(featuresSrc).toContain('60 tiered achievement badges');
    expect(web3AiSrc).not.toContain('backend/app/src/near/application/ports');
    expect(web3AiSrc).not.toContain('backend/near-contracts');
  });
});

describe('TerraAgent whitepaper NEP-245 & subdomain link parity', () => {
  it('maps all 10 surface commodities 1-to-1 to canonical res.terraagent.testnet NEP-245 token IDs and clarifies NEAR AI Cloud TEE URLs', () => {
    expect(RESOURCE_ROWS.map((r) => [r.id, r.label])).toEqual([
      ['metals.t1', 'Iron'],
      ['metals.t2', 'Light Alloys'],
      ['metals.t3', 'Titanium'],
      ['minerals.t1', 'Silica'],
      ['minerals.t2', 'Rare Earths'],
      ['minerals.t3', 'Exotic Crystal'],
      ['bio.water', 'Water'],
      ['bio.biomass', 'Biomass'],
      ['bio.t2', 'Petroleum'],
      ['bio.t3', 'Gene-stock'],
    ]);

    const md = readFileSync(resolve(import.meta.dirname, 'whitepaper.md'), 'utf8');
    for (const row of RESOURCE_ROWS) {
      expect(md).toContain(row.id);
      expect(md).toContain(row.label);
    }
    expect(md).toContain('cloud-api.near.ai/v1');
    expect(md).toContain('model:request:response');

    for (const f of ['sections/schemas.ts', 'sections/web3AndAi.ts', 'data/features.ts']) {
      const src = readFileSync(resolve(import.meta.dirname, f), 'utf8');
      expect(src).not.toMatch(/INTEL TDX|Intel TDX/);
      expect(src).toContain('NEAR AI Cloud');
    }
  });

  it('rewrites dynamically mounted section links on whitepaper.terraagent.fun after DOM mount', () => {
    const mount = document.createElement('div');
    for (const sec of [...buildWeb3AndAiSections(), ...buildGameplayAndEngineSections()]) {
      mount.appendChild(sec);
    }

    const beforeHrefs = Array.from(mount.querySelectorAll('a[href]'), (a) => a.getAttribute('href'));
    expect(beforeHrefs).toContain('/play.html?planet=dune');
    expect(beforeHrefs).toContain('/trade.html');
    expect(beforeHrefs).toContain('/dev/economy-sim/');
    expect(beforeHrefs).toContain('/playground.html');

    rewriteSubdomainLinks(mount, 'whitepaper.terraagent.fun');
    const afterHrefs = Array.from(mount.querySelectorAll('a[href]'), (a) => a.getAttribute('href'));
    expect(afterHrefs).toContain('https://play.terraagent.fun/play.html?planet=dune');
    expect(afterHrefs).toContain('https://play.terraagent.fun/trade.html');
    expect(afterHrefs).toContain('https://play.terraagent.fun/dev/economy-sim/');
    expect(afterHrefs).toContain('https://playground.terraagent.fun/');
    expect(afterHrefs).toContain('https://design.terraagent.fun/');
    expect(afterHrefs.some((h) => h?.startsWith('/play.html') || h?.startsWith('/trade.html'))).toBe(false);
  });
});
