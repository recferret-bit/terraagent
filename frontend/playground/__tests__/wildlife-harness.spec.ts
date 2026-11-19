// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { WildlifeSceneHost } from '../content/WildlifeSceneHost';
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

    const scared = host.triggerScare();
    expect(scared.fleeing).toBeGreaterThan(0);

    host.setScene(null);
    expect(host.getStats().active).toBe(false);
  });

  it('mounts WildlifePanel without adding radio buttons or disturbing side tabs, and opens hive tab for ?wildlife=', () => {
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
    host.setScene(state.wildlife, { hour: state.wildlifeHour });
    const wPanel = new WildlifePanel(state, () => host.getStats(), {
      onScene() {}, onHour() {}, onPauseToggle() {}, onStep() {}, onScare() {}, onReset() {},
    });
    wPanel.build();

    expect(document.querySelectorAll('[data-side-tab]')).toHaveLength(3);
    expect(document.querySelectorAll('[type="radio"]')).toHaveLength(2);
    expect(document.querySelector('[data-side-tab="hive"]')?.classList.contains('on')).toBe(true);
    expect(document.querySelector('[data-side-pane="hive"]')?.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('[data-testid="pg-wildlife-panel"]')?.parentElement?.dataset.sidePane).toBe('hive');
    expect(document.querySelector('[data-wildlife-biome="oceanForest"]')?.classList.contains('on')).toBe(true);

    const tb = new Toolbar(state, {
      onView() {}, onPlanet() {}, onToggle() {}, onShot() {}, onSheet() {}, onBuild() {}, onPose() {}, onWorkTarget() {}, onDepositStage() {}, onTileState() {},
    });
    tb.build();
    const poseBtn = document.querySelector('#ver-pose')!;
    expect(poseBtn.textContent).toBe('pose: sleep');
    expect(poseBtn.classList.contains('on')).toBe(true);
    host.setScene(null);
  });
});
