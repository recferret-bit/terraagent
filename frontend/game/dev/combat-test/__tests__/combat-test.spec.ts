// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from 'vitest';
import { DEV_PLANET_RADIUS, ENTITY_KIND } from '@terra/sim';
import { setProductionBuildOverride, isProductionBuild } from '../../../core/buildEnv';
import { LocalHost } from '../../../store/local/LocalHost';
import { combatTestSource } from '../../../store/local/planetSource';
import { LocalHostCore, type LocalHostDeps } from '../../../store/local/LocalHostCore';
import { memorySnapshotStore } from '../../../store/local/snapshotStore';
import { CommandBus } from '../../../net/commandBus';
import { Emitter } from '../../../net/emitter';
import type { Transport, Outgoing } from '../../../net/types';
import type { ServerMessage } from '@terra/contracts';
import type { FromLocalHost } from '../../../store/local/protocol';
import { LandfallController } from '../../../features/landfall';
import { forEachEntity } from '../../../store/replica/viewCodec';
import {
  extractModeFromArgv,
  isCombatTestExcludedFromBuild,
  stripCombatTestLinkFromHubHtml,
} from '../buildGate';
import {
  COMBAT_SPAWN_PRESETS,
  COMBAT_TEST_MAP_SPECS,
  buildCombatTestSearch,
  hiveSpeciesForPresetId,
  parseCombatTestUrlParams,
  resolveCombatTestMapSpec,
} from '../catalog';
import { CombatTestPanel } from '../CombatTestPanel';

const flush = async (rounds = 4) => {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
};

function makeFakeSession(canvas: HTMLCanvasElement, sent: Array<{ kind: string; args: unknown }>) {
  let onViewCb: ((view: unknown) => void) | null = null;
  const store = {
    latest: {
      tick: 1,
      planet: { id: 'pl_combat_test_temperate', type: 'temperate', seed: 'combat-test-temperate', radius: 56 },
      colonies: [
        { index: 0, id: 'col-0', name: 'Player', status: 'active' },
        { index: 7, id: 'col-7', name: 'Crimson Vanguard', status: 'active' },
      ],
      entities: [
        { id: 10, kind: ENTITY_KIND.hiveBlackAnt, owner: -1, q: 12, r: 5, hp: 500 },
        { id: 11, kind: ENTITY_KIND.blackAnt, owner: -1, q: 13, r: 5, hp: 50 },
        { id: 12, kind: ENTITY_KIND.roboticsFactory, owner: 7, q: -15, r: 6, hp: 600 },
      ],
      blobs: { combatTest: { staging: { q: 1, r: 1 } } },
    },
    currentPlanetId: () => 'pl_combat_test_temperate',
    onView: (cb: (view: unknown) => void) => { onViewCb = cb; return () => { onViewCb = null; }; },
  };
  return {
    planetId: 'pl_combat_test_temperate',
    cameraTargetTile: { q: 4, r: -2 },
    store,
    viewport: { renderer: { domElement: canvas } },
    commandBus: { send: (kind: string, args: unknown) => sent.push({ kind, args }) },
    transport: {},
    pickAt: vi.fn((x: number) => (x <= 200 ? { q: 9, r: -4 } : null)),
    focusTile: vi.fn(),
    emitView: () => onViewCb?.(store.latest),
  } as unknown as ConstructorParameters<typeof CombatTestPanel>[0]['session'] & { emitView: () => void };
}

describe('combat-test catalog & production build gate', () => {
  afterEach(() => {
    setProductionBuildOverride(null);
  });

  it('defines 3 biome maps matching common gameplay radius (56)', () => {
    expect(COMBAT_TEST_MAP_SPECS).toHaveLength(3);
    expect(COMBAT_TEST_MAP_SPECS.map((s) => s.kind)).toEqual(['dune', 'oceanForest', 'forestRock']);
    expect(COMBAT_TEST_MAP_SPECS.map((s) => s.biome)).toEqual(['desert', 'ocean', 'temperate']);
    for (const spec of COMBAT_TEST_MAP_SPECS) expect(spec.radius).toBe(DEV_PLANET_RADIUS);
  });

  it('parses biome/planet aliases, bots bounds, and round-trips query params', () => {
    expect(resolveCombatTestMapSpec('desert').kind).toBe('dune');
    expect(resolveCombatTestMapSpec('ocean').kind).toBe('oceanForest');
    expect(resolveCombatTestMapSpec('temperate').kind).toBe('forestRock');
    expect(resolveCombatTestMapSpec('unknown').kind).toBe('forestRock');

    const p1 = parseCombatTestUrlParams('?biome=dune&bots=99&seed=fast-1');
    expect(p1.spec.kind).toBe('dune');
    expect(p1.botCount).toBe(5);
    expect(p1.seed).toBe('fast-1');

    const p2 = parseCombatTestUrlParams('?planet=oceanForest&bots=0');
    expect(p2.spec.biome).toBe('ocean');
    expect(p2.botCount).toBe(1);

    expect(buildCombatTestSearch({ biome: 'dune' })).toBe('?biome=dune');
    expect(buildCombatTestSearch({ biome: 'ocean', seed: 's2', botCount: 4 })).toBe('?biome=oceanForest&seed=s2&bots=4');
    expect(hiveSpeciesForPresetId('hiveBlackAnt')).toBe('blackAnt');
    expect(hiveSpeciesForPresetId('hiveBlueBeetle')).toBe('blueBeetle');
    expect(hiveSpeciesForPresetId('hiveGreenSpitter')).toBe('greenSpitter');
  });

  it('excludes /dev/combat-test/ from production builds and allows dev runs', () => {
    expect(isCombatTestExcludedFromBuild({ viteAppEnv: 'production' })).toBe(true);
    expect(isCombatTestExcludedFromBuild({ viteAppEnv: 'staging' })).toBe(true);
    expect(isCombatTestExcludedFromBuild({ mode: 'production' })).toBe(true);
    expect(isCombatTestExcludedFromBuild({ nodeEnv: 'production' })).toBe(true);
    expect(isCombatTestExcludedFromBuild({ argv: ['node', 'vite', 'build'] })).toBe(true);
    expect(isCombatTestExcludedFromBuild({ viteAppEnv: 'development', argv: ['node', 'vite'] })).toBe(false);
    expect(isCombatTestExcludedFromBuild({ viteAppEnv: 'development', argv: ['node', 'vite', 'build'] })).toBe(false);
    expect(isCombatTestExcludedFromBuild({ mode: 'development', argv: ['node', 'vite'] })).toBe(false);

    setProductionBuildOverride(true);
    expect(isProductionBuild()).toBe(true);
    setProductionBuildOverride(false);
    expect(isProductionBuild()).toBe(false);
  });

  it('exposes all battle units, battle buildings, and insects/hives in COMBAT_SPAWN_PRESETS', () => {
    const ids = new Set(COMBAT_SPAWN_PRESETS.map((p) => p.id));
    for (const required of [
      'recon', 'demoTank', 'demoArtillery',
      'autocannon', 'laserTower', 'roboticsFactory', 'droneControlArray', 'sensorArray',
      'blackAnt', 'blueBeetle', 'greenSpitter',
      'hiveBlackAnt', 'hiveBlueBeetle', 'hiveGreenSpitter',
    ]) {
      expect(ids.has(required)).toBe(true);
    }
  });
});

describe('LocalHostCore combatTest worker integration', () => {
  it('boots LocalHostCore across all 3 biomes and funds player ledger without insufficient_funds rejects', async () => {
    for (const biome of ['desert', 'ocean', 'temperate'] as const) {
      const msgs: FromLocalHost[] = [];
      const deps: LocalHostDeps = {
        now: () => 0,
        wallMs: () => Date.now(),
        schedule: () => () => {},
        store: memorySnapshotStore(),
      };
      const core = await LocalHostCore.create(
        { scenario: 'combatTest', combatTest: true, ephemeral: true, reset: true, planetType: biome, botCount: 2 },
        deps,
        (m) => msgs.push(m),
      );
      try {
        expect(core.simHost.state.meta.planetType).toBe(biome);
        expect(core.simHost.state.grid.radius).toBe(DEV_PLANET_RADIUS);
        expect(core.simHost.state.colonies[0]?.status).toBe('active');
        if (biome === 'ocean') {
          core.handle({
            t: 'client',
            msg: { t: 'join', d: { planetId: core.simHost.state.meta.planetId, mode: 'play' } },
          });
          const staging = (core.simHost.state.blobs.combatTest?.value as { staging?: { q: number; r: number } } | undefined)?.staging;
          expect(staging).toBeDefined();
          core.handle({
            t: 'client',
            msg: { t: 'cmd', id: 'fac-1', d: { kind: 'dev.spawnbuilding', args: { building: 'roboticsFactory', q: staging!.q, r: staging!.r, fallbackNear: true } } },
          });
          core.advance(2);
          let facId = -1;
          const cols = core.simHost.state.entities.cols;
          for (let i = 0; i < core.simHost.state.entities.count; i++) {
            if (cols.owner[i] === 0 && cols.kind[i] === ENTITY_KIND.roboticsFactory) { facId = cols.id[i]!; break; }
          }
          expect(facId).toBeGreaterThan(0);
          core.handle({
            t: 'client',
            msg: { t: 'cmd', id: 'trn-1', d: { kind: 'enqueueTask', args: { buildUnit: { unit: 'recon', producerId: facId } } } },
          });
          core.advance(2);
          const hostErrors = msgs.filter((m) => m.t === 'error');
          const rejects = msgs.filter((m) => m.t === 'server' && m.msg.t === 'cmd.reject');
          expect(hostErrors).toEqual([]);
          expect(rejects).toEqual([]);
        }
      } finally {
        await core.stop();
      }
    }
  });
});

describe('LandfallController no-HQ unit/building selection', () => {
  const hosts: LocalHost[] = [];
  afterEach(() => {
    for (const h of hosts.splice(0)) h.stop();
  });

  it('allows selecting spawned battle units & buildings without HQ via LandfallController + LocalHost', async () => {
    const source = combatTestSource({ planetType: 'desert', botCount: 2 });
    const host = new LocalHost({ source });
    hosts.push(host);
    const view0 = host.sync(true);
    const staging = (view0.blobs?.combatTest as { staging?: { q: number; r: number } } | undefined)?.staging;
    expect(staging).toBeDefined();

    const canvas = document.createElement('canvas');
    const bus = new CommandBus(new (class implements Transport {
      msgs = new Emitter<ServerMessage>();
      state = { phase: 'streaming', attempt: 0, downSinceMs: null } as const;
      start() {}
      stop() {}
      send(m: Outgoing) { host.send(m); }
      onMessage(fn: (m: ServerMessage) => void) { return this.msgs.on(fn); }
      onState() { return () => {}; }
    })());
    host.onMessage((m) => (bus as unknown as { transport: { msgs: Emitter<ServerMessage> } }).transport.msgs.emit(m));

    const landfall = new LandfallController({
      store: host.store,
      sendCommand: bus.send,
      pickTile: () => null,
      canvas,
      isHqDeployed: () => true,
    });

    bus.send('dev.spawnunit', { unit: 'demoTank', q: staging!.q, r: staging!.r, owner: 0 });
    bus.send('dev.spawnbuilding', { building: 'autocannon', q: staging!.q + 2, r: staging!.r, owner: 0 });
    await flush(2);
    host.step(2);

    const latest = host.store.latest!;
    landfall.onView(latest);
    let tankId = -1;
    let turretId = -1;
    forEachEntity(latest.entities, latest.count, (e) => {
      if (e.owner === 0 && e.kind === ENTITY_KIND.demoTank) tankId = e.id;
      if (e.owner === 0 && e.kind === ENTITY_KIND.autocannon) turretId = e.id;
    });
    expect(tankId).toBeGreaterThan(0);
    expect(turretId).toBeGreaterThan(0);
    expect(landfall.selectEntity(tankId)).toBe(tankId);
    expect(landfall.getSelectedEntity()?.entityId).toBe(tankId);
    expect(landfall.orderMove(staging!.q + 1, staging!.r)).toBe(true);
    expect(landfall.selectEntity(turretId)).toBe(turretId);
    expect(landfall.getSelectedEntity()?.entityId).toBe(turretId);
    landfall.dispose();
  });
});

describe('CombatTestPanel DOM & spawner controls', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders 3 biome buttons, defaults hives to passive, suppresses Esc/right-click when armed, and sends valid refill/reveal/wave commands', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const canvas = document.createElement('canvas');
    const sent: Array<{ kind: string; args: unknown }> = [];
    const onSwitchBiome = vi.fn();
    const onResetMap = vi.fn();
    const session = makeFakeSession(canvas, sent);

    const panel = new CombatTestPanel({
      root,
      activeSpec: COMBAT_TEST_MAP_SPECS[2]!,
      session,
      onSwitchBiome,
      onResetMap,
    });

    root.querySelector<HTMLButtonElement>('[data-testid="biome-dune"]')?.click();
    expect(onSwitchBiome).toHaveBeenCalledWith('dune');
    root.querySelector<HTMLButtonElement>('[data-testid="biome-oceanForest"]')?.click();
    expect(onSwitchBiome).toHaveBeenCalledWith('oceanForest');
    root.querySelector<HTMLButtonElement>('[data-testid="combat-test-reset"]')?.click();
    expect(onResetMap).toHaveBeenCalledTimes(1);

    root.querySelector<HTMLButtonElement>('[data-testid="spawn-preset-demoArtillery"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-testid="combat-test-drop-center"]')?.click();
    expect(sent[0]).toEqual({ kind: 'dev.spawnunit', args: { unit: 'demoArtillery', q: 1, r: 1, count: 1, owner: 0 } });

    root.querySelector<HTMLButtonElement>('[data-testid="spawn-preset-roboticsFactory"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-testid="combat-test-drop-center"]')?.click();
    expect(sent[1]).toEqual({ kind: 'dev.spawnbuilding', args: { building: 'roboticsFactory', q: 1, r: 1, owner: 0, fallbackNear: true } });

    root.querySelector<HTMLButtonElement>('[data-testid="spawn-preset-laserTower"]')?.click();
    const downLeft = new MouseEvent('pointerdown', { button: 0, clientX: 100, clientY: 100, bubbles: true, cancelable: true });
    const upLeft = new MouseEvent('pointerup', { button: 0, clientX: 100, clientY: 100, bubbles: true, cancelable: true });
    const clickLeft = new MouseEvent('click', { button: 0, clientX: 100, clientY: 100, bubbles: true, cancelable: true });
    canvas.dispatchEvent(downLeft);
    canvas.dispatchEvent(upLeft);
    canvas.dispatchEvent(clickLeft);
    expect(sent[2]).toEqual({ kind: 'dev.spawnbuilding', args: { building: 'laserTower', q: 9, r: -4, owner: 0 } });
    expect(upLeft.defaultPrevented).toBe(true);
    expect(clickLeft.defaultPrevented).toBe(true);

    const escArmed = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    window.dispatchEvent(escArmed);
    expect(escArmed.defaultPrevented).toBe(true);
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 100, clientY: 100, bubbles: true }));
    expect(sent).toHaveLength(3);

    const aggBtn = root.querySelector<HTMLButtonElement>('[data-testid="combat-test-aggression"]')!;
    expect(aggBtn.textContent).toBe('Hives: PASSIVE');
    root.querySelector<HTMLButtonElement>('[data-testid="spawn-preset-hiveGreenSpitter"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-testid="combat-test-drop-center"]')?.click();
    expect(sent[3]).toEqual({ kind: 'dev.spawnhive', args: { species: 'greenSpitter', q: 1, r: 1, mode: 'passive', initialResidents: 4 } });

    // Right-click while armed disarms AND suppresses follow-up pointerup + contextmenu without blocking later right-clicks
    const rightDown = new MouseEvent('pointerdown', { button: 2, bubbles: true, cancelable: true });
    const rightUp = new MouseEvent('pointerup', { button: 2, bubbles: true, cancelable: true });
    const rightCtx = new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true });
    canvas.dispatchEvent(rightDown);
    canvas.dispatchEvent(rightUp);
    canvas.dispatchEvent(rightCtx);
    expect(rightDown.defaultPrevented).toBe(true);
    expect(rightUp.defaultPrevented).toBe(true);
    expect(rightCtx.defaultPrevented).toBe(true);
    const laterCtx = new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true });
    canvas.dispatchEvent(laterCtx);
    expect(laterCtx.defaultPrevented).toBe(false);
    panel.dispose();
  });
});

describe('CombatTestPanel aggression, wave guard & refill', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('toggles hive aggression, guards empty insect wave, and dispatches strict grant/reveal commands', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const canvas = document.createElement('canvas');
    const sent: Array<{ kind: string; args: unknown }> = [];
    const session = makeFakeSession(canvas, sent);
    const panel = new CombatTestPanel({
      root,
      activeSpec: COMBAT_TEST_MAP_SPECS[2]!,
      session,
      onSwitchBiome: vi.fn(),
      onResetMap: vi.fn(),
    });

    const aggBtn = root.querySelector<HTMLButtonElement>('[data-testid="combat-test-aggression"]')!;
    aggBtn.click();
    expect(aggBtn.textContent).toBe('Hives: AGGRESSIVE');
    expect(sent[0]).toEqual({ kind: 'dev.faunamode', args: { entityId: 10, mode: 'aggressive', colonyIndex: 0 } });
    root.querySelector<HTMLButtonElement>('[data-testid="spawn-preset-blackAnt"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-testid="combat-test-drop-center"]')?.click();
    expect(sent.at(-1)).toEqual({ kind: 'dev.spawnunit', args: { unit: 'blackAnt', q: 1, r: 1, count: 1, mode: 'aggressive' } });

    const waveBtn = root.querySelector<HTMLButtonElement>('[data-testid="combat-test-wave"]')!;
    const beforeWaveCount = sent.length;
    waveBtn.click();
    expect(sent).toHaveLength(beforeWaveCount);

    (session.store.latest!.entities as unknown as Array<Record<string, number>>).push({
      id: 99, kind: ENTITY_KIND.demoTank, owner: 0, q: 1, r: 1, x: 0, y: 0, rot: 0, hp: 100, hpMax: 100, state: 1, progress: 0,
    });
    session.emitView();
    waveBtn.click();
    expect(sent.at(-1)).toEqual({ kind: 'dev.spawnraid', args: { count: 5, colonyIndex: 0 } });

    const revealBtn = root.querySelector<HTMLButtonElement>('[data-testid="combat-test-reveal"]');
    expect(revealBtn).not.toBeNull();
    revealBtn!.click();
    await flush(2);
    const grantCalls = sent.filter((c) => c.kind === 'dev.grant');
    expect(grantCalls).toHaveLength(7);
    expect(grantCalls.every((c) => typeof (c.args as { resource?: unknown }).resource === 'string' && (c.args as { amount?: unknown }).amount === 25000)).toBe(true);
    expect(sent.filter((c) => c.kind === 'dev.reveal')).toEqual([{ kind: 'dev.reveal', args: {} }]);
    panel.dispose();
  });
});

describe('CombatTestPanel LocalHost + CommandBus integration', () => {
  it('executes REFILL+REVEAL, hive toggle, unit/building spawns, and insect wave cleanly through LocalHost + CommandBus', async () => {
    const source = combatTestSource({ planetType: 'temperate', botCount: 2 });
    const host = new LocalHost({ source });
    const canvas = document.createElement('canvas');
    const bus = new CommandBus(new (class implements Transport {
      msgs = new Emitter<ServerMessage>();
      state = { phase: 'streaming', attempt: 0, downSinceMs: null } as const;
      start() {}
      stop() {}
      send(m: Outgoing) { host.send(m); }
      onMessage(fn: (m: ServerMessage) => void) { return this.msgs.on(fn); }
      onState() { return () => {}; }
    })());
    const rejects: unknown[] = [];
    host.onMessage((m) => {
      if (m.t === 'cmd.reject') rejects.push(m);
      (bus as unknown as { transport: { msgs: Emitter<ServerMessage> } }).transport.msgs.emit(m);
    });
    const root = document.createElement('div');
    document.body.appendChild(root);
    const view0 = host.sync(true);
    const staging = (view0.blobs?.combatTest as { staging?: { q: number; r: number } } | undefined)?.staging ?? { q: 0, r: 0 };
    const panel = new CombatTestPanel({
      root,
      activeSpec: COMBAT_TEST_MAP_SPECS[2]!,
      session: {
        planetId: view0.planet.id,
        cameraTargetTile: { ...staging },
        store: host.store,
        viewport: { renderer: { domElement: canvas } },
        commandBus: bus,
        transport: {},
        pickAt: () => staging,
        focusTile: vi.fn(),
      } as unknown as ConstructorParameters<typeof CombatTestPanel>[0]['session'],
      onSwitchBiome: vi.fn(),
      onResetMap: vi.fn(),
    });
    try {
      const revealBtn = root.querySelector<HTMLButtonElement>('[data-testid="combat-test-reveal"]');
      expect(revealBtn).not.toBeNull();
      revealBtn!.click();
      await flush(3);
      host.step(1);
      root.querySelector<HTMLButtonElement>('[data-testid="spawn-preset-demoTank"]')!.click();
      root.querySelector<HTMLButtonElement>('[data-testid="combat-test-drop-center"]')!.click();
      root.querySelector<HTMLButtonElement>('[data-testid="spawn-preset-autocannon"]')!.click();
      root.querySelector<HTMLButtonElement>('[data-testid="combat-test-drop-center"]')!.click();
      await flush(3);
      host.step(2);
      root.querySelector<HTMLButtonElement>('[data-testid="combat-test-aggression"]')!.click();
      root.querySelector<HTMLButtonElement>('[data-testid="combat-test-wave"]')!.click();
      await flush(3);
      host.step(2);
      expect(rejects).toEqual([]);
      let playerEntities = 0;
      forEachEntity(host.store.latest!.entities, host.store.latest!.count, (e) => {
        if (e.owner === 0 && e.hp > 0) playerEntities++;
      });
      expect(playerEntities).toBeGreaterThanOrEqual(2);

      // Vision toggle switches between VISION: ALL and VISION: REAL FOV cleanly
      const visionBtn = root.querySelector<HTMLButtonElement>('[data-testid="combat-test-vision"]')!;
      expect(visionBtn.textContent).toBe('VISION: ALL');
      expect(visionBtn.getAttribute('aria-pressed')).toBe('true');
      let fullVisionValue = true;
      (panel as unknown as { opts: { session: { isFullVision?: () => boolean; setFullVision?: (v: boolean) => void } } }).opts.session.setFullVision = (v: boolean) => { fullVisionValue = v; };
      visionBtn.click();
      expect(fullVisionValue).toBe(false);
      expect(visionBtn.textContent).toBe('VISION: REAL FOV');
      expect(visionBtn.getAttribute('aria-pressed')).toBe('false');
      visionBtn.click();
      expect(fullVisionValue).toBe(true);
      expect(visionBtn.textContent).toBe('VISION: ALL');
    } finally {
      panel.dispose();
      host.stop();
    }
  });

  it('strips combat-test hub link only when excluded and extracts --mode build flags cleanly', () => {
    const sampleHub = '<nav>\n  <a href="/dev/economy-sim/">SIM</a>\n  <a class="btn" href="/dev/combat-test/">COMBAT</a>\n  <a href="/dev/chain/">CHAIN</a>\n</nav>';
    expect(stripCombatTestLinkFromHubHtml(sampleHub, false)).toBe(sampleHub);
    const stripped = stripCombatTestLinkFromHubHtml(sampleHub, true);
    expect(stripped).not.toContain('/dev/combat-test');
    expect(stripped).toContain('/dev/economy-sim/');
    expect(stripped).toContain('/dev/chain/');
    expect(extractModeFromArgv(['node', 'vite', 'build', '--mode', 'development'])).toBe('development');
    expect(extractModeFromArgv(['node', 'vite', 'build', '--mode=development'])).toBe('development');
    expect(isCombatTestExcludedFromBuild({ mode: 'development' })).toBe(false);
    expect(isCombatTestExcludedFromBuild({ mode: 'production' })).toBe(true);
  });
});
