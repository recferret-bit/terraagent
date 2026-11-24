import { describe, expect, it } from 'vitest';
import { ArchetypeCatalog } from '@terra/render/kitbash';
import { FLEET_CARDS } from './data/entitiesCatalog';

describe('Whitepaper orbital fleet card parity', () => {
  it('exposes reworked ship cards with idle + work action toggles and registered target archetypes', () => {
    for (const id of ['ship.carrier', 'ship.flagshipCarrier', 'ship.guildTrader'] as const) {
      const card = FLEET_CARDS.find((c) => c.id === id);
      expect(card, `FLEET_CARDS entry for ${id}`).toBeDefined();
      expect(ArchetypeCatalog.has(card!.targetId)).toBe(true);
      expect(card!.actions).toContain('idle');
      expect(card!.actions).toContain('work');
    }
  });
});
