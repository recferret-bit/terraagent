// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createState, FAUNA_SCENES, syncURL } from '../state';
import { FaunaScenePanel } from '../panels/FaunaScenePanel';
import type { FaunaSceneStats } from '../content/FaunaSceneHost';

function mount(scene: string) {
  document.body.innerHTML = '<aside data-side-pane="hive"></aside>';
  const state = createState(new URLSearchParams(`faunaScene=${scene}`));
  const stats: FaunaSceneStats = {
    scene: state.faunaScene, tick: 3, rngDraws: 0, mode: 'bugs', modeLabel: 'BUGS', biomeKey: 'dune',
    seed: 42, paused: false, populationCount: 1, maxPopulation: 1, waveCount: 0,
    activeProjectiles: 0, hives: [], bugs: [],
    animations: [{ id: 9, state: 'windup', phase: 0.5, retired: false }],
  };
  const panel = new FaunaScenePanel(state, () => stats, {
    onScene() {}, onSeed() {}, onPauseToggle() {}, onStep() {}, onReset() {}, onAcidPreview() {},
    onMode(mode) { state.faunaMode = mode; panel.render(); },
  });
  panel.build();
  return { state, stats, panel };
}

describe('insect animation tuning controls', () => {
  it.each(FAUNA_SCENES)('%s defaults to bugs attacking and switches exclusively to robot attacks', scene => {
    const { state } = mount(scene);
    const bugs = document.querySelector<HTMLInputElement>('[data-fauna-attack="bugs"]')!;
    const robots = document.querySelector<HTMLInputElement>('[data-fauna-attack="robots"]')!;
    expect(document.querySelectorAll('[type="radio"]')).toHaveLength(2);
    expect(state.faunaMode).toBe('bugs'); expect(bugs.checked).toBe(true); expect(robots.checked).toBe(false);
    expect(document.querySelector('[data-fauna-range="bugs"]')).toBeNull();
    robots.click();
    expect(state.faunaMode).toBe('robots'); expect(bugs.checked).toBe(false); expect(robots.checked).toBe(true);
    expect(robots.parentElement!.classList.contains('on')).toBe(true);
    expect(bugs.parentElement!.classList.contains('on')).toBe(false);
    expect(state.faunaScene).toBe(scene);
    expect(createState(syncURL(state)).faunaMode).toBe('robots');
    bugs.click(); expect(state.faunaMode).toBe('bugs'); expect(robots.checked).toBe(false);
  });

  it('exposes current animation state and phase for paused stepping', () => {
    const { stats, panel } = mount('mixed');
    const readout = document.querySelector('[data-fauna-animation-states]')!;
    expect(readout.textContent).toContain('#9 insect · windup 50%');
    stats.animations = [{ id: 9, state: 'dead', phase: 1, retired: true }];
    panel.renderStats();
    expect(readout.isConnected).toBe(false);
    expect(document.querySelector('[data-fauna-animation-states]')!.textContent).toContain('dead 100% · removed');
  });
});
