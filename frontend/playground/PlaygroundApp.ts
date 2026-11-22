import * as THREE from 'three';
import { createColonyViewport, type ColonyViewport } from '@terra/render/core/createColonyViewport';
import { createFramePacer } from '@terra/render/core/framePacer';
import { setDayNightExternalSync } from '@terra/render/core/dayNightConfig';
import { pinStorybookSolar } from './stage/solarPreview';
import { onPixelArtChange, setPixelArt } from '@terra/render/core/pixelArtPass';
import { isShadowOn, onShadowChange, setShadow } from '@terra/render/core/shadowConfig';
import { onArchetypeLightsChange } from '@terra/render/lighting/archetypeLights';
import { initPixelDialog } from '@terra/render/ui/pixelDialog';
import { PLANET_SPECS } from '@terra/render/planets/PlanetSpec';
import { ArchetypeCatalog, setDepositPreviewStage, type ArchetypeCategory, type DepositVisualStage } from '@terra/render/kitbash';
import { setReconFactionPreview } from '@terra/render/kitbash/archetypes/units/reconFaction';
import { type InteractionTargetKind } from '@terra/render/particles';
import { TILE_STATE_PRESETS, type TileStatePreset } from '@terra/render/planets/hex';
import { $ } from './dom';
import { createPlaygroundDebug } from './pgDebug';
import { BUILD_STAGES, VERTEBRATE_POSE_MODES, WORK_TARGETS, createState, inspectAlias, syncURL, type BuildStage, type FaunaMode, type FaunaSceneKind, type PgState, type ToggleKey, type VertebratePoseMode, type View } from './state';
import { StageRig } from './stage/StageRig';
import { SpawnSet } from './content/SpawnSet';
import { getFloraEntry, isFloraId, listFloraEntries, type FloraGroup } from './content/floraCatalog';
import { FaunaSceneHost } from './content/FaunaSceneHost';
import { WildlifeCoordinator } from './content/WildlifeCoordinator';
import { MarchSceneHost, type MarchPace } from './content/marchScene';
import { SurfaceHost } from './content/SurfaceHost';
import { HexSampleHost } from './content/HexSampleHost';
import { ValidationOverlay } from './content/Validation';
import { CameraRig, type ViewOpts } from './camera/CameraRig';
import { bindPicking } from './camera/Picking';
import { setDockHidden } from './panels/dock';
import { Sidebar } from './panels/Sidebar';
import { Toolbar } from './panels/Toolbar';
import { LightsPanel } from './panels/LightsPanel';
import { FaunaScenePanel } from './panels/FaunaScenePanel';
import { MarchPanel } from './panels/MarchPanel';
import { toast } from './panels/Toast';
import { updateInfo, updateSceneInfo } from './panels/InfoPanel';
import { validationHtml } from './panels/validationHtml';
import { bindKeys, flyKeys } from './keyboard';
import { contactSheet, screenshot } from './capture';

/** Orchestrates the 3D model storybook: owns the state, wires panels, scene parts and camera together. */
export class PlaygroundApp {
  readonly state: PgState;
  private viewport: ColonyViewport;
  private rig: StageRig;
  private spawns = new SpawnSet();
  private faunaHost: FaunaSceneHost;
  private wildlife: WildlifeCoordinator;
  private marchHost: MarchSceneHost;
  private surface: SurfaceHost;
  private hexSample: HexSampleHost;
  private validation = new ValidationOverlay();
  private cam: CameraRig;
  private sidebar: Sidebar;
  private toolbar: Toolbar;
  private lightsPanel: LightsPanel;
  private faunaPanel: FaunaScenePanel;
  private marchPanel: MarchPanel;
  private hasFramedOnce = false;
  private hasStarted = false;
  private pacer = createFramePacer({ maxDt: 0.05 });
  private time = 0;

  constructor(private params: URLSearchParams) {
    this.state = createState(params);
    setReconFactionPreview(this.state.faction);
    setDayNightExternalSync(true);
    const vp = this.viewport = createColonyViewport($('#viewport'));
    this.surface = new SurfaceHost(vp.scene);
    this.hexSample = new HexSampleHost(vp.scene);
    this.faunaHost = new FaunaSceneHost(vp.scene);
    this.marchHost = new MarchSceneHost(vp.scene);
    this.rig = new StageRig(() => this.spawns.minX());
    this.cam = new CameraRig(vp.camera, vp.renderer.domElement, () => this.bounds(), () => !!this.state.row || !!this.state.floraRow || !!this.state.faunaScene || !!this.state.wildlife, flyKeys);
    vp.scene.add(this.rig.group, this.spawns.content, this.spawns.ring);
    this.sidebar = new Sidebar(this.state, {
      onSelect: (id) => this.select(id),
      onRow: (c) => this.toggleRow(c),
      onFloraRow: (g) => this.toggleFloraRow(g),
    });
    this.toolbar = new Toolbar(this.state, {
      onView: (v) => this.setView(v),
      onPlanet: (k) => { this.state.kind = k; if (this.state.wildlife) this.state.wildlife = k; this.applyPlanet(); syncURL(this.state); },
      onToggle: (k) => this.toggle(k),
      onShot: () => { screenshot(vp, this.cam, this.state); toast('Screenshot saved'); },
      onSheet: () => this.contactSheet(),
      onBuild: () => this.setBuild(BUILD_STAGES[(BUILD_STAGES.indexOf(this.state.build) + 1) % BUILD_STAGES.length]!),
      onPose: () => this.setVertebratePose(VERTEBRATE_POSE_MODES[(VERTEBRATE_POSE_MODES.indexOf(this.state.pose) + 1) % VERTEBRATE_POSE_MODES.length]!),
      onWorkTarget: () => {
        const next = WORK_TARGETS[(WORK_TARGETS.indexOf(this.state.workTarget) + 1) % WORK_TARGETS.length]!;
        this.setWorkTarget(next, true);
      },
      onDepositStage: (s) => this.setDepositStage(s),
      onTileState: (ts) => this.setTileState(ts),
      onNight: (night) => this.setNight(night),
    });
    this.lightsPanel = new LightsPanel(this.state, {
      onNightToggle: (night) => this.setNight(night),
      onClose: () => { if (this.state.lights) this.toggle('lights'); },
    });
    this.faunaPanel = new FaunaScenePanel(this.state, () => this.faunaHost.getStats(), {
      onScene: (scene) => this.setFaunaScene(scene), onMode: (mode) => this.setFaunaMode(mode), onSeed: (seed) => this.setFaunaSeed(seed),
      onPauseToggle: () => this.pauseFauna(), onStep: (ticks) => this.stepFauna(ticks), onReset: () => this.resetFauna(), onAcidPreview: () => this.triggerAcidPreview(),
    });
    this.wildlife = new WildlifeCoordinator({
      state: this.state, viewport: vp, spawns: this.spawns, toolbar: this.toolbar,
      deactivateOtherScenes: () => {
        if (this.state.march) { this.state.march = null; this.marchHost.setActive(false); this.marchPanel.render(); }
        if (this.state.faunaScene !== null) { this.state.faunaScene = null; this.syncFaunaStage(); }
      },
      syncSurface: () => this.syncSurface(), syncStageLighting: () => this.syncStageLighting(),
      refreshInfo: () => this.refreshInfo(), resetView: () => this.setView(this.state.view),
    });
    this.marchPanel = new MarchPanel(this.state, () => this.marchHost.getStats(), {
      onPace: (pace) => this.setMarch(pace),
      onRock: (rock) => this.setMarchRock(rock),
      onOrder: () => this.marchHost.order(),
      onPause: () => { this.marchHost.togglePause(); this.marchPanel.render(); },
      onStep: () => { this.marchHost.stepTicks(1); this.marchPanel.renderStats(); },
      onReset: () => this.resetMarch(),
    });
    const bindPick = {
      spawns: () => this.spawns.spawns,
      isRow: () => !!this.state.row || !!this.state.floraRow,
      selectedId: () => this.state.id,
      select: (id: string) => this.select(id, { rebuild: false, frame: false }),
      focus: (target: THREE.Vector3, radius: number) => this.setView(this.state.view, { target, radius }),
      ground: () => this.rig.top,
    };
    bindPicking(vp.renderer.domElement, vp.camera, bindPick);
    bindKeys({
      cycle: (d) => this.cycle(d), view: (v) => this.setView(v), toggle: (k) => this.toggle(k), focus: () => this.focusSelected(),
      revealSearch: () => { setDockHidden('side', false); this.sidebar.showTab('units'); },
      night: () => this.setNight(!this.state.night),
    });
  }

  start() {
    const { state, params } = this;
    setDepositPreviewStage(state.depositStage);
    this.sidebar.build();
    this.toolbar.build();
    this.lightsPanel.build();
    this.faunaPanel.build();
    this.wildlife.panel.build();
    this.marchPanel.build();
    onArchetypeLightsChange((changedId) => {
      this.spawns.refreshLights(changedId);
      this.lightsPanel.onExternalChange(changedId);
    });
    const initial = inspectAlias(params.get('inspect'));
    const knownInitial = initial ? (ArchetypeCatalog.has(initial) || isFloraId(initial)) : false;
    state.id = knownInitial ? initial! : state.floraRow ? (listFloraEntries(state.floraRow)[0]?.id ?? '') : (state.row ? ArchetypeCatalog.list(state.row)[0]?.id : ArchetypeCatalog.list()[0]?.id) ?? '';
    if (initial && !knownInitial) toast(`Unknown archetype "${initial}"`);
    this.applyPlanet();
    if (state.id) this.select(state.id, { rebuild: false, frame: true }); else this.setView(state.view, { instant: true });
    this.syncFaunaStage();
    this.wildlife.sync();
    this.syncMarch();
    this.sidebar.render();
    this.toolbar.syncToggles();
    this.lightsPanel.render();
    this.faunaPanel.render();
    this.wildlife.panel.render();
    this.syncStageLighting();
    initPixelDialog({ production: false });
    if (params.has('pixel')) setPixelArt(state.pixel, false);
    state.shadows = isShadowOn();
    onPixelArtChange((on) => { this.state.pixel = on; this.toolbar.syncToggles(); syncURL(this.state); });
    onShadowChange((on) => { this.state.shadows = on; this.toolbar.syncToggles(); syncURL(this.state); });
    this.setView(state.view, { instant: true });
    this.hasStarted = true;
    this.frame();
  }

  /** QA hooks (`window.__pg`). */
  get debug() {
    return createPlaygroundDebug({
      state: this.state, viewport: this.viewport, cam: this.cam, spawns: () => this.spawns.spawns,
      hexTerrain: () => this.hexSample.hexTerrain, faunaHost: this.faunaHost, wildlifeHost: this.wildlife.host, marchHost: this.marchHost,
      select: (id) => this.select(id), setView: (v) => this.setView(v), setPlanet: (k) => { this.state.kind = k; this.applyPlanet(); },
      toggle: (k) => this.toggle(k), setNight: (on) => this.setNight(on), contactSheet: () => this.contactSheet(),
      setBuild: (s) => this.setBuild(s),
      setStakeTier: (tier) => { this.state.stakeTier = tier; this.rebuildContent(); this.refreshInfo(); syncURL(this.state); },
      setWorkTarget: (t, ew) => this.setWorkTarget(t, ew),
      setDepositStage: (s) => this.setDepositStage(s), setTileState: (ts) => this.setTileState(ts),
      setFaunaScene: (s, o) => this.setFaunaScene(s, o), setFaunaMode: (m) => this.setFaunaMode(m), setFaunaSeed: (s) => this.setFaunaSeed(s),
      pauseFauna: (p) => this.pauseFauna(p), stepFauna: (t) => this.stepFauna(t), resetFauna: (s) => this.resetFauna(s),
      triggerAcidPreview: () => this.triggerAcidPreview(), setVertebratePose: (p) => this.setVertebratePose(p),
      setWildlifeScene: (k, h) => this.wildlife.setScene(k, h), setWildlifeHour: (h) => this.wildlife.setHour(h),
      setMarch: (p) => this.setMarch(p), setMarchRock: (r) => this.setMarchRock(r),
      stepMarch: (t = 1) => { this.marchHost.stepTicks(t); this.marchPanel.renderStats(); return this.marchHost.getStats(); },
      resetMarch: () => this.resetMarch(),
    });
  }

  private bounds() {
    if (this.state.march) return this.marchHost.bounds();
    if (this.state.wildlife !== null) return this.wildlife.host.bounds();
    return this.state.faunaScene !== null ? this.faunaHost.bounds() : this.spawns.bounds(this.state.id, !!this.state.row || !!this.state.floraRow);
  }

  // ---------------------------------------------------------------- planet / content
  private applyPlanet() {
    const { state } = this;
    this.viewport.applySky(PLANET_SPECS[state.kind]);
    this.syncStageLighting(); this.buildStage(); this.rebuildContent();
    this.faunaHost.setBiome(PLANET_SPECS[state.kind].biomeKey);
    if (state.wildlife !== null) this.wildlife.host.setScene(state.wildlife, { hour: state.wildlifeHour, wire: state.wire });
    if (state.march) this.marchHost.setActive(true, { pace: state.march, rock: state.marchRock, biomeKey: PLANET_SPECS[state.kind].biomeKey });
    this.syncSurface(); this.toolbar.setPlanet(state.kind); this.faunaPanel?.render(); this.wildlife.panel.render();
  }

  private syncFaunaStage() {
    const { state } = this;
    const active = state.faunaScene !== null;
    this.spawns.content.visible = !active && !state.march && state.wildlife === null;
    if (active || state.wildlife !== null) this.spawns.ring.visible = false;
    else this.spawns.updateRing(state.id, !!state.row || !!state.floraRow);
    this.faunaHost.setScene(state.faunaScene, { mode: state.faunaMode, seed: state.faunaSeed, biomeKey: PLANET_SPECS[state.kind].biomeKey, wire: state.wire });
    this.syncSurface(); this.faunaPanel?.render(); this.refreshInfo();
  }

  private setFaunaScene(scene: FaunaSceneKind | null, opts?: { mode?: FaunaMode; seed?: number }) {
    if (scene && this.state.march) { this.state.march = null; this.marchHost.setActive(false); this.marchPanel.render(); }
    if (scene && this.state.wildlife !== null) { this.state.wildlife = null; this.wildlife.sync(); }
    this.state.faunaScene = scene;
    if (opts?.mode) this.state.faunaMode = opts.mode;
    else if (scene && this.state.faunaMode !== 'robots') this.state.faunaMode = 'bugs';
    if (opts?.seed !== undefined && Number.isFinite(opts.seed)) this.state.faunaSeed = Math.trunc(opts.seed);
    this.syncFaunaStage(); this.setView(this.state.view); syncURL(this.state);
    return this.faunaHost.getStats();
  }

  private syncMarch() {
    const { state } = this;
    if (state.march) {
      this.marchHost.setActive(true, { pace: state.march, rock: state.marchRock, biomeKey: PLANET_SPECS[state.kind].biomeKey });
      this.spawns.content.visible = false; this.spawns.ring.visible = false;
    } else {
      this.marchHost.setActive(false);
      this.spawns.content.visible = state.faunaScene === null && state.wildlife === null;
    }
    this.marchPanel.render(); this.refreshInfo();
  }

  private setMarch(pace: MarchPace | null) {
    this.state.march = pace;
    if (pace) {
      if (this.state.faunaScene !== null) { this.state.faunaScene = null; this.syncFaunaStage(); }
      if (this.state.wildlife !== null) { this.state.wildlife = null; this.wildlife.sync(); }
    }
    this.syncMarch();
    this.setView(this.state.view);
    syncURL(this.state);
    return this.marchHost.getStats();
  }

  private setVertebratePose(pose: VertebratePoseMode) {
    this.state.pose = pose;
    this.toolbar.syncToggles();
    syncURL(this.state);
    return pose;
  }

  private setMarchRock(rock: boolean) {
    this.state.marchRock = rock;
    if (this.state.march) this.marchHost.setRock(rock);
    this.marchPanel.render();
    syncURL(this.state);
    return this.marchHost.getStats();
  }

  private resetMarch() { this.marchHost.reset(); this.marchPanel.render(); return this.marchHost.getStats(); }

  private setFaunaMode(mode: FaunaMode) {
    this.state.faunaMode = mode;
    this.faunaHost.setMode(mode);
    this.faunaPanel?.render();
    this.syncSurface();
    this.setView(this.state.view);
    syncURL(this.state);
    return this.faunaHost.getStats();
  }

  private setFaunaSeed(seed: number) {
    if (!Number.isFinite(seed)) return this.faunaHost.getStats();
    this.state.faunaSeed = Math.trunc(seed);
    this.faunaHost.setSeed(this.state.faunaSeed);
    this.faunaPanel?.render();
    syncURL(this.state);
    return this.faunaHost.getStats();
  }

  private pauseFauna(paused?: boolean) {
    if (paused === undefined) this.faunaHost.togglePause();
    else this.faunaHost.setPaused(paused);
    this.faunaPanel?.render();
    return this.faunaHost.getStats();
  }

  private stepFauna(ticks = 1) { this.faunaHost.stepTick(ticks); this.faunaPanel?.render(); return this.faunaHost.getStats(); }

  private resetFauna(seed?: number) {
    if (seed !== undefined && Number.isFinite(seed)) this.state.faunaSeed = Math.trunc(seed);
    this.faunaHost.reset(this.state.faunaSeed);
    this.faunaPanel?.render();
    syncURL(this.state);
    return this.faunaHost.getStats();
  }

  private triggerAcidPreview() { this.faunaHost.triggerAcidPreview(); this.faunaPanel?.render(); return this.faunaHost.getStats(); }

  /** Toolbar, `n`, and the lights-panel Night button all write this one flag. */
  setNight(on: boolean) {
    this.state.night = on;
    this.syncStageLighting();
    this.toolbar.syncToggles();
    this.lightsPanel.syncNightButton();
    syncURL(this.state);
  }

  private syncStageLighting() {
    // Day must be a sunlit hour. A saved night clock would zero the sun while the bulbs are also off.
    pinStorybookSolar(this.state.night);
    this.rig.syncLighting(this.viewport, this.state.kind, this.state.night);
  }
  private buildStage() { this.rig.build(this.state.kind, this.state); }

  private syncSurface() {
    const { kind, surface, hexTerrain, hatch, depositStage, tileState, faunaScene, wildlife } = this.state;
    const showHex = wildlife === null && !surface && (hexTerrain || faunaScene !== null);
    const onSurface = wildlife === null && this.surface.sync(kind, surface, tileState);
    const onHex = this.hexSample.sync(kind, showHex, hatch, depositStage, tileState);
    if (onSurface || onHex || wildlife !== null) this.rig.hidePedestal();
    else this.buildStage();
  }

  private setBuild(stage: BuildStage) { this.state.build = stage; this.spawns.applyBuild(stage); this.toolbar.syncToggles(); syncURL(this.state); }

  private setWorkTarget(target: InteractionTargetKind, enableWork = false) {
    if (!WORK_TARGETS.includes(target)) return;
    this.state.workTarget = target;
    if (enableWork) this.state.work = true;
    this.toolbar.syncToggles();
    syncURL(this.state);
  }

  private setDepositStage(stage: DepositVisualStage) {
    this.state.depositStage = stage;
    setDepositPreviewStage(stage);
    this.rebuildContent();
    this.hexSample.setDepositStage(stage);
    this.refreshInfo();
    this.toolbar.syncToggles();
    syncURL(this.state);
  }

  private setTileState(preset: TileStatePreset) {
    if (!TILE_STATE_PRESETS.includes(preset)) return;
    this.state.tileState = preset;
    if (!this.state.hexTerrain && !this.state.surface) { this.state.hexTerrain = true; this.buildStage(); this.syncSurface(); }
    else { this.surface.setTileState(preset); this.hexSample.setTileState(preset); }
    this.toolbar.syncToggles();
    syncURL(this.state);
  }

  private rebuildContent() {
    const { state, spawns } = this;
    spawns.rebuild(spawns.idsFor(state.row, state.id, state.floraRow), PLANET_SPECS[state.kind].biomeKey, state.wire, state.depositStage);
    spawns.applyBuild(state.build);
    spawns.applyRuin(state.ruin);
    spawns.applyStakeTier(state.stakeTier);
    spawns.updateRing(state.id, !!state.row || !!state.floraRow);
    this.rig.placeHuman();
    this.applyValidation();
  }

  private applyValidation() { this.validation.apply(this.validation.report(this.spawns.resolvedId(this.state.id), this.state.validate), this.spawns.find(this.state.id)); }
  private refreshInfo() {
    const { state } = this;
    if (state.march) return updateSceneInfo(this.marchHost.getStats());
    if (state.wildlife !== null) return updateSceneInfo(this.wildlife.host.getStats());
    if (state.faunaScene !== null) return updateSceneInfo(this.faunaHost.getStats());
    const id = this.spawns.resolvedId(state.id);
    updateInfo(id, (state.row || state.floraRow) ? this.spawns.spawns.length : 1, validationHtml(this.validation.report(id, state.validate), id));
  }

  // ---------------------------------------------------------------- selection / view
  private select(id: string, opts: { rebuild?: boolean; frame?: boolean } = {}) {
    const { state } = this;
    const flora = isFloraId(id);
    if (!flora && !ArchetypeCatalog.has(id)) { toast(`Unknown archetype: ${id}`); return; }
    const { rebuild = !(flora ? state.floraRow : state.row), frame = true } = opts;
    state.id = id;
    if (flora && state.row) state.row = null;
    if (!flora && state.floraRow) state.floraRow = null;
    if (this.hasStarted && state.march) this.setMarch(null);
    if (this.hasStarted && state.faunaScene !== null) { state.faunaScene = null; this.syncFaunaStage(); }
    if (this.hasStarted && state.wildlife !== null) { state.wildlife = null; this.wildlife.sync(); }
    if (flora && state.floraRow && getFloraEntry(id)?.group !== state.floraRow) state.floraRow = getFloraEntry(id)!.group;
    else if (!flora && state.row && ArchetypeCatalog.get(id).category !== state.row) state.row = ArchetypeCatalog.get(id).category;
    if (rebuild || state.row || state.floraRow) this.rebuildContent();
    this.spawns.updateRing(state.id, !!state.row || !!state.floraRow);
    this.refreshInfo();
    this.sidebar.mark();
    this.lightsPanel?.render();
    if (frame) this.setView(state.view, { instant: !this.hasFramedOnce });
    this.hasFramedOnce = true;
    syncURL(state);
  }

  private setView(view: View, opts: ViewOpts = {}) {
    this.state.view = view;
    this.toolbar.setView(view);
    this.cam.setView(view, opts);
    syncURL(this.state);
  }

  private focusSelected() { this.setView(this.state.view, { target: this.bounds().getCenter(new THREE.Vector3()) }); }

  private cycle(d: number) {
    const ids = this.sidebar.visibleIds(); if (!ids.length) return;
    const i = ids.indexOf(this.state.id);
    this.select(ids[(i + d + ids.length) % ids.length]);
  }

  private toggleRow(cat?: ArchetypeCategory) {
    const { state } = this;
    if (isFloraId(state.id) && !cat) { this.toggleFloraRow(getFloraEntry(state.id)!.group); return; }
    if (this.hasStarted && state.march) this.setMarch(null);
    if (this.hasStarted && state.faunaScene !== null) { state.faunaScene = null; this.syncFaunaStage(); }
    if (this.hasStarted && state.wildlife !== null) { state.wildlife = null; this.wildlife.sync(); }
    const c = cat ?? (state.id && !isFloraId(state.id) ? ArchetypeCatalog.get(state.id).category : null);
    state.floraRow = null;
    state.row = state.row === c || !c ? null : c;
    if (state.row && (!state.id || isFloraId(state.id) || ArchetypeCatalog.get(state.id).category !== state.row)) state.id = ArchetypeCatalog.list(state.row)[0]?.id ?? state.id;
    this.rebuildContent(); this.refreshInfo(); this.sidebar.render(); this.toolbar.clearBar();
    this.toolbar.syncToggles();
    this.lightsPanel.render();
    this.setView(state.view);
    syncURL(state);
  }

  private toggleFloraRow(group: FloraGroup) {
    const { state } = this;
    if (this.hasStarted && state.march) this.setMarch(null);
    if (this.hasStarted && state.faunaScene !== null) { state.faunaScene = null; this.syncFaunaStage(); }
    if (this.hasStarted && state.wildlife !== null) { state.wildlife = null; this.wildlife.sync(); }
    state.row = null;
    state.floraRow = state.floraRow === group ? null : group;
    if (state.floraRow && getFloraEntry(state.id)?.group !== state.floraRow) state.id = listFloraEntries(state.floraRow)[0]?.id ?? state.id;
    this.rebuildContent(); this.refreshInfo(); this.sidebar.render(); this.toolbar.clearBar();
    this.toolbar.syncToggles();
    this.lightsPanel.render();
    this.setView(state.view);
    syncURL(state);
  }

  // ---------------------------------------------------------------- toggles
  private toggle(k: ToggleKey) {
    const { state, viewport: vp } = this;
    if (k === 'row') { this.toggleRow(); return; }
    state[k] = !state[k];
    switch (k) {
      case 'bloom': vp.bloom.enabled = state.bloom; break;
      case 'pixel': setPixelArt(state.pixel, false); break;
      case 'wire': this.spawns.applyWire(state.wire); this.faunaHost.applyWire(state.wire); this.wildlife.host.applyWire(state.wire); break;
      case 'human': this.rig.human.visible = state.human; break;
      case 'shadows': setShadow(state.shadows); break;
      case 'surface': if (state.surface) state.hexTerrain = false; this.buildStage(); this.syncSurface(); break;
      case 'hexTerrain': if (state.hexTerrain) state.surface = false; this.buildStage(); this.syncSurface(); break;
      case 'validate': this.applyValidation(); this.refreshInfo(); break;
      case 'lights': this.lightsPanel.render(); this.syncStageLighting(); break;
      case 'ruin': this.spawns.applyRuin(state.ruin); break;
    }
    this.toolbar.syncToggles(); syncURL(state);
  }
  private contactSheet(): string { const url = contactSheet(this.viewport, this.cam, this.state, this.bounds()); toast('4-view contact sheet saved'); return url; }

  // ---------------------------------------------------------------- loop
  private frame = (now = performance.now()) => {
    requestAnimationFrame(this.frame);
    const dt = this.pacer.next(now);
    if (dt === null) return;
    this.time += dt; this.cam.step(dt);
    this.spawns.tick(this.time, dt, this.state.turntable, !!this.state.row || !!this.state.floraRow, this.state.work ? 1 : 0, this.state.id, this.state.night, this.state.workTarget, this.state.pose);
    this.faunaHost.update(this.time, dt, { wire: this.state.wire, bloom: this.state.bloom, shadows: this.state.shadows, pixel: this.state.pixel });
    this.wildlife.host.update(dt); this.marchHost.update(dt, this.time);
    if (this.state.faunaScene !== null) this.faunaPanel.renderStats();
    if (this.state.wildlife !== null) this.wildlife.panel.renderStats();
    if (this.state.march) this.marchPanel.renderStats();
    if (this.state.march || this.state.faunaScene !== null || this.state.wildlife !== null) this.refreshInfo();
    this.cam.controls.update(); this.surface.update(dt, this.time); this.hexSample.update(dt);
    this.viewport.followShadow(this.cam.controls.target); this.viewport.render();
  };
}
