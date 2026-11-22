import { describe, expect, it } from 'vitest';
import { createState, inspectAlias, parseStakeTier, syncURL } from '../state';
import { SpawnSet } from '../content/SpawnSet';
import { hubUplinkBeam } from '@terra/render/prestige/hubPrestige';
import { HUB_BASE_ID, HUB_GOLD_ID, HUB_UPLINK_ID } from '@terra/render/prestige/tierVisuals';

describe('W28-12 playground ?stakeTier & ?inspect=hub (unit)', () => {
  it('parses 0..4 and round-trips through syncURL', () => {
    for (let t = 0; t <= 4; t++) {
      const s = createState(new URLSearchParams(`inspect=hub&stakeTier=${t}`));
      expect(s.stakeTier).toBe(t);
      expect(syncURL(s).get('stakeTier')).toBe(String(t));
    }
  });

  it('absent, empty, unknown, negative, fractional and out-of-range values leave the stock hub (null)', () => {
    for (const v of [null, '', ' ', 'x', '-1', '5', '1.5', 'NaN', '99']) expect(parseStakeTier(v)).toBeNull();
    const s = createState(new URLSearchParams('inspect=hub'));
    expect(s.stakeTier).toBeNull();
    expect(syncURL(s).has('stakeTier')).toBe(false);
  });

  it('maps ?inspect=hub to the Command Hub and passes other ids through', () => {
    expect(inspectAlias('hub')).toBe('building.commandHub');
    expect(inspectAlias('ship.flagshipCarrier')).toBe('ship.flagshipCarrier');
    expect(inspectAlias(null)).toBeNull();
  });
});

describe('W28-12 SpawnSet.applyStakeTier (integration with real meshes)', () => {
  it('dresses every shown hub per tier and leaves other buildings alone', () => {
    const spawns = new SpawnSet();
    spawns.rebuild(['building.commandHub', 'building.solar'], 'dune', false);
    const hub = () => spawns.find('building.commandHub')!;
    spawns.applyStakeTier(null);
    expect(hub().mesh.userData.archetypeId).toBe(HUB_BASE_ID);
    for (const [tier, id, beam] of [[0, HUB_BASE_ID, false], [1, HUB_UPLINK_ID, true], [2, HUB_UPLINK_ID, true], [3, HUB_GOLD_ID, true], [4, HUB_GOLD_ID, true]] as const) {
      spawns.applyStakeTier(tier);
      expect(hub().mesh.userData.archetypeId).toBe(id);
      expect(Boolean(hubUplinkBeam(hub().mesh))).toBe(beam);
      expect(hub().box.min.y).toBeCloseTo(0, 3);
    }
    expect(spawns.find('building.solar')!.mesh.userData.archetypeId).toBe('building.solar');
    spawns.dispose();
  });

  it('auto-attaches the tier-specific beam VFX when inspecting uplink or gold hub variants directly', () => {
    const spawns = new SpawnSet();
    spawns.rebuild([HUB_BASE_ID, HUB_UPLINK_ID, HUB_GOLD_ID], 'dune', false);
    const baseBeam = hubUplinkBeam(spawns.find(HUB_BASE_ID)!.mesh);
    const uplinkBeam = hubUplinkBeam(spawns.find(HUB_UPLINK_ID)!.mesh);
    const goldBeam = hubUplinkBeam(spawns.find(HUB_GOLD_ID)!.mesh);
    expect(baseBeam).toBeNull();
    expect(uplinkBeam?.style).toBe('uplink');
    expect(goldBeam?.style).toBe('gold');
    spawns.dispose();
    expect(uplinkBeam!.group.parent).toBeNull();
    expect(goldBeam!.group.parent).toBeNull();
  });

  it('resolves the active dressed hub id and restores default tiers when applyStakeTier(null) is called', () => {
    const spawns = new SpawnSet();
    spawns.rebuild([HUB_BASE_ID, HUB_UPLINK_ID, HUB_GOLD_ID], 'dune', false);
    spawns.applyStakeTier(3);
    expect(spawns.resolvedId(HUB_BASE_ID)).toBe(HUB_GOLD_ID);
    expect(hubUplinkBeam(spawns.find(HUB_BASE_ID)!.mesh)?.style).toBe('gold');

    spawns.applyStakeTier(null);
    expect(spawns.resolvedId(HUB_BASE_ID)).toBe(HUB_BASE_ID);
    expect(hubUplinkBeam(spawns.find(HUB_BASE_ID)!.mesh)).toBeNull();
    expect(spawns.resolvedId(HUB_UPLINK_ID)).toBe(HUB_UPLINK_ID);
    expect(hubUplinkBeam(spawns.find(HUB_UPLINK_ID)!.mesh)?.style).toBe('uplink');
    expect(spawns.resolvedId(HUB_GOLD_ID)).toBe(HUB_GOLD_ID);
    expect(hubUplinkBeam(spawns.find(HUB_GOLD_ID)!.mesh)?.style).toBe('gold');
    spawns.dispose();
  });
});
