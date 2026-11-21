// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getVertebrateConfig } from '@terra/render/animation/vertebrates/rig';
import { ArchetypeCatalog } from '@terra/render/kitbash';
import { HEX_TERRAIN } from '@terra/render/planets/hex';
import { PLANET_KINDS } from '@terra/render/planets/PlanetSpec';
import { SpawnSet } from '../content/SpawnSet';
import { buildEcosystemTiles, WILDLIFE_STORYBOOK_LEVELS, WildlifeSceneHost } from '../content/WildlifeSceneHost';
import { WildlifePanel } from '../panels/WildlifePanel';
import { Toolbar } from '../panels/Toolbar';
import { Sidebar } from '../panels/Sidebar';
import { FaunaScenePanel } from '../panels/FaunaScenePanel';
import { createState, syncURL } from '../state';

describe('playground vertebrate pose & wildlife ecosystem harness', () => {
  it('parses and round-trips ?pose= and ?wildlife= / ?wildlifeHour= state cleanly', () => {
    const s = createState(new URLSearchParams('inspect=fauna.timberWolf&pose=run&wildlife=forestRock&wildlifeHour=22'));
    expect(s.pose).toBe('run');
    expect(s.wildlife).toBe('forestRock');
    expect(s.wildlifeHour).toBe(22);
    expect(s.kind).toBe('forestRock');

    const round = createState(syncURL(s));
    expect(round.pose).toBe('run');
    expect(round.wildlife).toBe('forestRock');
    expect(round.wildlifeHour).toBe(22);
  });

  it('spawns real biome birds and warm-blooded animals and switches circadian activity with solar hour', () => {
    const host = new WildlifeSceneHost();
    const dayStats = host.setScene('forestRock', { hour: 10 });
    expect(dayStats.active).toBe(true);
    expect(dayStats.birdSpecies).toBe(5);
    expect(dayStats.birdsTotal).toBeGreaterThan(10);
    expect(dayStats.landSpecies).toBe(4);
    expect(dayStats.landAnimalsTotal).toBeGreaterThan(5);
    expect(dayStats.sleeping).toBe(0);

    const nightStats = host.setHour(22);
    host.step(0.5);
    const updatedNight = host.getStats();
    expect(nightStats.hour).toBe(22);
    expect(updatedNight.sleeping).toBeGreaterThan(0);

    // Daytime foraging and afternoon roaming both trigger active open-ground canter/bound (aBioState.y > 1.15)
    host.setHour(10);
    host.step(1.2);
    const bio = (host as unknown as { biosphere: { animalMeshes: Array<{ geometry: { getAttribute(name: string): { array: Float32Array } } }> } }).biosphere;
    const maxWalkOrRun = Math.max(
      ...bio.animalMeshes.flatMap((m) => {
        const arr = m.geometry.getAttribute('aBioState').array;
        const vals: number[] = [];
        for (let i = 1; i < arr.length; i += 4) vals.push(arr[i]!);
        return vals;
      }),
    );
    expect(maxWalkOrRun).toBeGreaterThan(1.15);

    const scared = host.triggerScare();
    expect(scared.fleeing).toBeGreaterThan(0);

    host.setScene(null);
    expect(host.getStats().active).toBe(false);
  });
});

describe('playground wildlife storybook tab & active vertebrate animation', () => {
  it('provides one wildlife storybook level per planet type and mounts WildlifePanel in the dedicated wildlife tab', () => {
    expect(WILDLIFE_STORYBOOK_LEVELS).toHaveLength(PLANET_KINDS.length);
    expect(new Set(WILDLIFE_STORYBOOK_LEVELS.map((l) => l.kind))).toEqual(new Set(PLANET_KINDS));

    document.body.innerHTML = '<div id="pg"><aside id="side"></aside><main id="stage"><div id="overlay"></div></main></div>';
    const state = createState(new URLSearchParams('pose=sleep&wildlife=oceanForest'));
    new Sidebar(state, { onSelect() {}, onRow() {} }).build();
    new FaunaScenePanel(
      state,
      () => ({
        scene: null, tick: 0, populationCount: 0, maxPopulation: 0, waveCount: 0,
        modeLabel: 'NEUTRAL', paused: false, hives: [], mode: 'passive', biomeKey: 'oceanForest',
        seed: 42, rngDraws: 0, bugs: [], activeProjectiles: 0,
      }),
      { onScene() {}, onMode() {}, onSeed() {}, onPauseToggle() {}, onStep() {}, onReset() {}, onAcidPreview() {} },
    ).build();

    const host = new WildlifeSceneHost();
    for (const kind of PLANET_KINDS) {
      const st = host.setScene(kind, { hour: 10 });
      expect(st.active).toBe(true);
      expect(st.kind).toBe(kind);
      expect(st.birdSpecies).toBe(5);
      expect(st.landSpecies).toBe(4);
    }
    host.setScene(state.wildlife, { hour: state.wildlifeHour });
    const wPanel = new WildlifePanel(state, () => host.getStats(), {
      onScene(k) { state.wildlife = k; host.setScene(k, { hour: state.wildlifeHour }); wPanel.render(); },
      onHour() {}, onPauseToggle() {}, onStep() {}, onScare() {}, onReset() {},
    });
    wPanel.build();

    expect(document.querySelectorAll('[data-side-tab]')).toHaveLength(4);
    expect(document.querySelectorAll('[type="radio"]')).toHaveLength(2);
    expect(document.querySelector('[data-side-tab="wildlife"]')?.classList.contains('on')).toBe(true);
    expect(document.querySelector('[data-side-pane="wildlife"]')?.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('[data-testid="pg-wildlife-panel"]')?.parentElement?.dataset.sidePane).toBe('wildlife');
    expect(document.querySelector('[data-wildlife-biome="oceanForest"]')?.classList.contains('on')).toBe(true);
    expect(document.querySelectorAll('[data-wildlife-level-card]')).toHaveLength(3);

    const duneCard = document.querySelector<HTMLElement>('[data-wildlife-level-card="dune"]')!;
    expect(duneCard.querySelector('.fp-wildlife-summary')?.textContent).toContain('oasis');
    duneCard.click();
    expect(state.wildlife).toBe('dune');
    expect(document.querySelector('[data-wildlife-biome="dune"]')?.classList.contains('on')).toBe(true);

    const tb = new Toolbar(state, {
      onView() {}, onPlanet() {}, onToggle() {}, onShot() {}, onSheet() {}, onBuild() {}, onPose() {}, onWorkTarget() {}, onDepositStage() {}, onTileState() {}, onNight() {},
    });
    tb.build();
    const poseBtn = document.querySelector('#ver-pose')!;
    expect(poseBtn.textContent).toBe('pose: sleep');
    expect(poseBtn.classList.contains('on')).toBe(true);
    host.setScene(null);
  });

  it('builds distinct terrain habitats for all 3 planet wildlife levels and animates mammals/birds actively in auto showcase mode', () => {
    for (const kind of PLANET_KINDS) {
      const tiles = buildEcosystemTiles(kind);
      const codes = new Set(Array.from(tiles.terrain));
      expect(codes.has(HEX_TERRAIN.deep) || codes.has(HEX_TERRAIN.shallow)).toBe(true);
      expect(codes.has(HEX_TERRAIN.forest)).toBe(true);
      expect(codes.has(HEX_TERRAIN.rock)).toBe(true);
      expect(codes.has(HEX_TERRAIN.flat)).toBe(true);
    }

    const spawns = new SpawnSet();
    spawns.rebuild(['fauna.timberWolf', 'fauna.bird.highlandHawk'], 'forestRock', false);
    spawns.tick(1.5, 0.016, false, true, 0, 'fauna.timberWolf', false, 'tree', 'auto');

    const wolfSpawn = spawns.find('fauna.timberWolf')!;
    const hawkSpawn = spawns.find('fauna.bird.highlandHawk')!;
    expect(wolfSpawn.mesh.userData.uniforms.uWalkWeight.value).toBeCloseTo(1.0, 5);
    expect(hawkSpawn.mesh.userData.uniforms.uWalkWeight.value).toBeCloseTo(1.0, 5);

    const wolfCfg = getVertebrateConfig(ArchetypeCatalog.getGeometry('fauna.timberWolf'));
    const hawkCfg = getVertebrateConfig(ArchetypeCatalog.getGeometry('fauna.bird.highlandHawk'));
    expect(wolfCfg.gaitFreq).toBeGreaterThanOrEqual(8.5);
    expect(hawkCfg.gaitFreq).toBeGreaterThanOrEqual(12.0);
    spawns.dispose();
  });
});
