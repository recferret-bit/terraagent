import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MATERIAL_ZONES } from '@terra/render/kitbash';
import { reconFactionPalette } from '@terra/render/kitbash/archetypes/units/reconFaction';
import { createState, syncURL } from '../state';

describe('playground faction query', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mercenary palette differs from default', () => {
    const merc = reconFactionPalette('mercenary');
    expect(merc.zones.hullPrimary?.color).not.toBe(DEFAULT_MATERIAL_ZONES.hullPrimary.color);
    expect(createState(new URLSearchParams('faction=mercenary')).faction).toBe('mercenary');
    expect(createState(new URLSearchParams('inspect=robot.recon&faction=Mercenary')).faction).toBe('mercenary');
  });

  it('unknown faction falls back to default', () => {
    expect(reconFactionPalette('pirate')).toEqual(reconFactionPalette(undefined));
    expect(createState(new URLSearchParams('inspect=robot.recon&faction=pirate')).faction).toBeNull();
  });

  it('missing query is default', () => {
    expect(reconFactionPalette(null).id).toBe('default');
    expect(reconFactionPalette('').marks).toBe(false);
    expect(createState(new URLSearchParams('')).faction).toBeNull();
    expect(createState(new URLSearchParams('inspect=robot.recon')).faction).toBeNull();

    vi.stubGlobal('location', { pathname: '/playground.html' });
    vi.stubGlobal('history', { replaceState: vi.fn() });
    const plain = createState(new URLSearchParams('inspect=robot.recon'));
    plain.id = 'robot.recon';
    expect(syncURL(plain).has('faction')).toBe(false);
    const merc = createState(new URLSearchParams('faction=mercenary'));
    merc.id = 'robot.recon';
    expect(syncURL(merc).get('faction')).toBe('mercenary');
  });
});
