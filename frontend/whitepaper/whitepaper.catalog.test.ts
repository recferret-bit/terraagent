import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ArchetypeCatalog } from '@terra/render/kitbash';
import { ParticlePresetRegistry } from '@terra/render/particles';
import { CHAPTER_ITEMS, ENTITY_NAV_ITEMS, STACK_NAV_ITEMS } from './data/chapters';
import { ECOLOGY_CARDS, EFFECT_CARDS } from './data/ecologyAndEffectsCatalog';
import { FLEET_CARDS } from './data/entitiesCatalog';

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
    const presets = new Set(ParticlePresetRegistry.list().map((p) => p.id));
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
    expect(allCards.length).toBe(68);
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

    const md = readFileSync(resolve(import.meta.dirname, '../../docs/hackathon/public/whitepaper.md'), 'utf8');
    expect(md).not.toContain('NEAR_MODE=testnet / AI_PROVIDER=nearai');

    const featuresSrc = readFileSync(resolve(import.meta.dirname, 'data/features.ts'), 'utf8');
    const web3AiSrc = readFileSync(resolve(import.meta.dirname, 'sections/web3AndAi.ts'), 'utf8');
    expect(featuresSrc).toContain('60 tiered achievement badges');
    expect(web3AiSrc).not.toContain('backend/app/src/near/application/ports');
    expect(web3AiSrc).not.toContain('backend/near-contracts');
  });
});
