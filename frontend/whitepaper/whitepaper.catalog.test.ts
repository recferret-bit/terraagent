import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ArchetypeCatalog } from '@terra/render/kitbash';
import { ParticlePresetRegistry } from '@terra/render/particles';
import { CHAPTER_ITEMS, ENTITY_NAV_ITEMS, STACK_NAV_ITEMS } from './data/chapters';
import { ECOLOGY_CARDS, EFFECT_CARDS } from './data/ecologyAndEffectsCatalog';
import { FLEET_CARDS } from './data/entitiesCatalog';

describe('TerraAgent whitepaper catalog integrity', () => {
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

  it('maps left-rail tabs, counts, and sub-anchors cleanly', () => {
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

  it('keeps CSS and generated HTML free of raw hex, border-radius, and undefined tokens', () => {
    const tokensCss = readFileSync(resolve(import.meta.dirname, '../design/css/tokens.css'), 'utf8');
    const definedTokens = new Set(Array.from(tokensCss.matchAll(/(--ta-[a-z0-9-]+)\s*:/gi), (m) => m[1]));

    for (const file of ['whitepaper.css', 'cards.css', 'index.html']) {
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

    const navSrc = readFileSync(resolve(import.meta.dirname, 'scrollAndNav.ts'), 'utf8');
    expect(navSrc).not.toMatch(/\binnerHTML\b/);

    const featuresSrc = readFileSync(resolve(import.meta.dirname, 'data/features.ts'), 'utf8');
    const chaptersSrc = readFileSync(resolve(import.meta.dirname, 'data/chapters.ts'), 'utf8');
    expect(featuresSrc).toContain('60');
    expect(featuresSrc).toContain('17 top-level domain modules');
    expect(featuresSrc).not.toMatch(/\b44\s+(?:achievement|Badges|DB badge|soulbound)/i);
    expect(chaptersSrc).not.toMatch(/\b44\s+Badges\b/i);
  });
});
