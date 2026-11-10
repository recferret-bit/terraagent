import { describe, expect, it } from 'vitest';
import { createState, syncURL } from '../state';
import { SpawnSet } from '../content/SpawnSet';
import { isArchetypeRuin, tickArchetypeMesh } from '@terra/render/kitbash';

describe('W18-22 playground ?ruin=1 & SpawnSet integration', () => {
  it('parses ?ruin=1 into PgState, round-trips through syncURL, and applies charred unlit state to SpawnSet meshes', () => {
    const stateOn = createState(new URLSearchParams('inspect=building.solar&ruin=1'));
    expect(stateOn.id === '' || stateOn.id === 'building.solar').toBe(true);
    expect(stateOn.ruin).toBe(true);
    expect(syncURL(stateOn).get('ruin')).toBe('1');

    const spawns = new SpawnSet();
    spawns.rebuild(['building.solar', 'building.commandHub'], 'dune', false);
    spawns.applyRuin(stateOn.ruin);

    for (const s of spawns.spawns) {
      expect(isArchetypeRuin(s.mesh)).toBe(true);
      expect(s.mesh.userData.uniforms.uRuin.value).toBe(1);
      expect(s.mesh.userData.uniforms.uLit.value).toBe(0);
      tickArchetypeMesh(s.mesh, 2.5);
      expect(s.mesh.userData.uniforms.uLit.value).toBe(0);
    }

    spawns.applyRuin(false);
    for (const s of spawns.spawns) {
      expect(isArchetypeRuin(s.mesh)).toBe(false);
      expect(s.mesh.userData.uniforms.uRuin.value).toBe(0);
      expect(s.mesh.userData.uniforms.uLit.value).toBe(1);
    }
    spawns.dispose();
  });

  it('keeps state.ruin false and omits ruin param from URL when ?ruin is absent or 0 (negative & boundary cases)', () => {
    const stateDefault = createState(new URLSearchParams('inspect=building.solar'));
    expect(stateDefault.ruin).toBe(false);
    expect(syncURL(stateDefault).has('ruin')).toBe(false);

    const stateZero = createState(new URLSearchParams('inspect=building.solar&ruin=0'));
    expect(stateZero.ruin).toBe(false);
    expect(syncURL(stateZero).has('ruin')).toBe(false);
  });
});
