import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createArchetypeMesh, setArchetypeBuildProgress } from '@terra/render/kitbash';
import { validateArchetype } from '@terra/render/kitbash/validate';
import { ENTITY_KIND, ENTITY_STATE, insertRow, rowOf, setField, setHqCellEnergy, spawnColonyLanding, spawnHqUnit } from '@terra/sim';
import { EntityMeshes, archetypeForKind } from '../../app/online/EntityMeshes';
import { HudRoot } from '../../core/hud/HudRoot';
import { loadFeatures } from '../../core/registry';
import { LocalHost } from '../../store/WorldStore';
import landfallFeature, { LandfallController, extractHqFromView, mountLandfall } from './index';

class FakeElement {
  tagName: string;
  className = '';
  textContent = '';
  hidden = false;
  type = '';
  title = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  onclick: (() => void) | null = null;
  private attrs = new Map<string, string>();
  private listeners = new Map<string, Set<(e: unknown) => void>>();

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  appendChild<T extends FakeElement>(child: T): T {
    child.remove();
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...nodes: Array<FakeElement | string>): void {
    for (const n of nodes) {
      if (typeof n === 'string') {
        const span = new FakeElement('#text');
        span.textContent = n;
        this.appendChild(span);
      } else {
        this.appendChild(n);
      }
    }
  }

  replaceChildren(...nodes: Array<FakeElement | string>): void {
    for (const c of [...this.children]) c.parentElement = null;
    this.children = [];
    this.append(...nodes);
  }

  remove(): void {
    if (!this.parentElement) return;
    const idx = this.parentElement.children.indexOf(this);
    if (idx >= 0) this.parentElement.children.splice(idx, 1);
    this.parentElement = null;
  }

  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
    if (k.startsWith('data-')) this.dataset[k.slice(5)] = v;
  }

  getAttribute(k: string): string | null {
    if (k.startsWith('data-') && this.dataset[k.slice(5)] !== undefined) return this.dataset[k.slice(5)];
    return this.attrs.get(k) ?? null;
  }

  addEventListener(type: string, fn: (e: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  dispatchEvent(ev: { type: string; [k: string]: unknown }): boolean {
    for (const fn of this.listeners.get(ev.type) ?? []) fn(ev);
    return true;
  }

  click(): void {
    this.onclick?.();
    this.dispatchEvent({ type: 'click' });
  }

  matches(selector: string): boolean {
    const testIdMatch = /^\[data-testid=["']?([^"'[\]]+)["']?\]$/.exec(selector.trim());
    if (testIdMatch) return this.dataset.testid === testIdMatch[1];
    const slotMatch = /^\[data-slot=["']?([^"'[\]]+)["']?\]$/.exec(selector.trim());
    if (slotMatch) return this.dataset.slot === slotMatch[1];
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelector(selector: string): FakeElement | null {
    for (const c of this.children) {
      if (c.matches(selector)) return c;
      const found = c.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
}

function ensureDom(): FakeElement {
  const body = new FakeElement('body');
  (globalThis as unknown as { document: unknown }).document = {
    body,
    createElement: (tag: string) => new FakeElement(tag),
  };
  return body;
}

describe('W01-26: HQ selection and right-click moveUnit acceptance', () => {
  it('selects HQ, orders move to (5, 0) via right-click/orderMove, updates HQ panel to moving and back to idle on arrival', () => {
    const body = ensureDom();
    const host = new LocalHost({ flags: ['W00', 'W01'], radius: 16 });
    const hqId = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    host.sync(true);

    const hudRoot = new FakeElement('div');
    const canvas = new FakeElement('canvas');
    body.appendChild(hudRoot);
    body.appendChild(canvas);

    const tileCoords = new Map<string, { q: number; r: number }>([
      ['100,100', { q: 0, r: 0 }],
      ['250,100', { q: 5, r: 0 }],
    ]);
    const pickTile = (cx: number, cy: number) => tileCoords.get(`${cx},${cy}`) ?? null;
    const sendSpy = vi.spyOn(host.store, 'sendCommand');

    const mounted = mountLandfall({
      hudRoot: hudRoot as unknown as HTMLElement,
      store: host.store,
      canvas: canvas as unknown as HTMLElement,
      pickTile,
    });

    const panel = hudRoot.querySelector('[data-testid="hq-panel"]')!;
    const titleEl = hudRoot.querySelector('[data-testid="hq-title"]')!;
    const hpEl = hudRoot.querySelector('[data-testid="hq-hp"]')!;
    const cellEl = hudRoot.querySelector('[data-testid="hq-cell"]')!;
    const jobEl = hudRoot.querySelector('[data-testid="hq-job"]')!;
    const queueEl = hudRoot.querySelector('[data-testid="hq-queue"]')!;

    expect(panel.hidden).toBe(false);
    expect(mounted.getSelectedEntityId()).toBe(hqId);
    expect(titleEl.textContent).toBe('HQ T1 · COMMANDER DRONE');
    expect(hpEl.textContent).toBe('900 / 900');
    expect(cellEl.textContent).toBe('800 / 800 E');
    expect(jobEl.textContent).toBe('idle');
    expect(queueEl.textContent).toBe('Queue: 0');

    mounted.deselect();
    expect(mounted.getSelectedEntityId()).toBeNull();
    canvas.dispatchEvent({ type: 'pointerdown', clientX: 100, clientY: 100, button: 0 });
    canvas.dispatchEvent({ type: 'pointerup', clientX: 100, clientY: 100, button: 0 });
    expect(mounted.getSelectedEntityId()).toBe(hqId);

    const preventDefault = vi.fn();
    canvas.dispatchEvent({ type: 'contextmenu', clientX: 250, clientY: 100, preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith({ type: 'moveUnit', entityId: hqId, q: 5, r: 0 });

    host.step(1);
    const hqRow = rowOf(host.state.entities, hqId);
    expect(host.state.entities.cols.x[hqRow]).toBeGreaterThan(0);
    expect(host.state.entities.cols.x[hqRow]).toBeLessThan(5);
    expect(jobEl.textContent).toBe('moving');
    expect(hpEl.textContent).toBe('900 / 900');
    expect(cellEl.textContent).toBe('800 / 800 E');
    expect(queueEl.textContent).toBe('Queue: 1');

    host.step(20);
    expect(host.state.entities.cols.q[hqRow]).toBe(5);
    expect(host.state.entities.cols.r[hqRow]).toBe(0);
    expect(jobEl.textContent).toBe('idle');
    expect(queueEl.textContent).toBe('Queue: 0');

    mounted.dispose();
  });
});

describe('W01-26: HudRoot integration and HQ panel states', () => {
  it('mounts via HudRoot when W01 wave flag is enabled and updates HP, cell bar, working/constructing states', () => {
    const body = ensureDom();
    const features = loadFeatures({ flags: new Set(['W00', 'W01']), host: 'server' });
    expect(features.some((f) => f.id === 'landfall')).toBe(true);

    const host = new LocalHost({ flags: ['W00', 'W01'], radius: 16 });
    spawnColonyLanding(host.state, { colonyId: 0, q: 2, r: -1 });
    host.step(35);

    const hud = new HudRoot(body as unknown as HTMLElement, [landfallFeature], {
      flags: new Set(['W00', 'W01']),
      host: 'server',
      services: { store: host.store, track: () => {} },
    });
    hud.update(host.store.latest!);

    const jobEl = body.querySelector('[data-testid="hq-job"]')!;
    const cellEl = body.querySelector('[data-testid="hq-cell"]')!;
    const cellBar = body.querySelector('[data-testid="hq-cell-bar"]')!;
    const selectBtn = body.querySelector('[data-testid="hq-select-btn"]')!;
    expect(jobEl.textContent).toBe('idle');
    expect(cellEl.textContent).toBe('800 / 800 E');
    expect(cellBar.style.width).toBe('100.0%');

    const hq = extractHqFromView(host.store.latest!)!;
    const row = rowOf(host.state.entities, hq.entityId);
    setHqCellEnergy(host.state, row, 400);
    setField(host.state.entities, row, 'state', ENTITY_STATE.working, host.tick);
    hud.update(host.sync(false));
    expect(jobEl.textContent).toBe('working');
    expect(cellEl.textContent).toBe('400 / 800 E');
    expect(cellBar.style.width).toBe('50.0%');

    setField(host.state.entities, row, 'state', ENTITY_STATE.constructing, host.tick);
    hud.update(host.sync(false));
    expect(jobEl.textContent).toBe('constructing');

    expect(body.querySelector('[data-testid="hq-panel"]')!.dataset.selected).toBe('true');
    selectBtn.click();
    expect(body.querySelector('[data-testid="hq-panel"]')!.dataset.selected).toBe('false');
    selectBtn.click();
    expect(body.querySelector('[data-testid="hq-panel"]')!.dataset.selected).toBe('true');

    hud.dispose();
  });
});

describe('W01-26: EntityMeshes 3D rendering and interpolation', () => {
  it('renders pod, hq, and commandHub entities, interpolates movement, and updates selection/target rings', () => {
    expect(archetypeForKind(ENTITY_KIND.hq)).toBe('robot.hero');
    expect(archetypeForKind(ENTITY_KIND.pod)).toBe('ship.dropPod');
    expect(archetypeForKind(ENTITY_KIND.commandHub)).toBe('building.commandHub');

    const scene = new THREE.Scene();
    const meshes = new EntityMeshes(scene, (id) => {
      const g = new THREE.Group();
      g.name = id;
      g.userData = { archetypeId: id, uniforms: { uTime: { value: 0 }, uWalkWeight: { value: 0 }, uWorkWeight: { value: 0 } } };
      return g;
    });

    const host = new LocalHost({ flags: ['W00', 'W01'], radius: 16 });
    const hqId = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    let view = host.sync(true);

    meshes.syncView(view, null);
    meshes.setSelectedEntityId(hqId);
    expect(meshes.count).toBe(1);
    expect(meshes.selectionRing.visible).toBe(true);

    host.store.sendCommand({ type: 'moveUnit', entityId: hqId, q: 4, r: 0 });
    meshes.flashTarget(4, 0, null);
    expect(meshes.targetMarker.visible).toBe(true);

    view = host.step(2);
    meshes.syncView(view, null);
    meshes.update(0.1, null);

    const rec = meshes.getRecord(hqId)!;
    expect(rec.mesh.position.x).toBeGreaterThan(0);
    expect(rec.walk).toBeGreaterThan(0);

    meshes.dispose();
  });

  it('plays pod touchdown descent with retro-thruster flames and engine stop animation when playPodTouchdown is enabled', () => {
    const scene = new THREE.Scene();
    const meshes = new EntityMeshes(
      scene,
      (id) => {
        const g = new THREE.Group();
        g.name = id;
        g.userData = { archetypeId: id, uniforms: { uTime: { value: 0 }, uWalkWeight: { value: 0 }, uWorkWeight: { value: 0 } } };
        return g;
      },
      true,
    );

    const host = new LocalHost({ flags: ['W00', 'W01'], radius: 16 });
    const { podEntityId } = spawnColonyLanding(host.state, { colonyId: 0, q: 0, r: 0 });
    host.step(35); // sim is landed (pod + hq present)
    const view = host.sync(true);

    meshes.syncView(view, null, 'desert');
    const podRec = meshes.getRecord(podEntityId)!;
    expect(podRec.mesh.position.y).toBeGreaterThan(20);

    // Mid retro-burn descent (t = 0.5 s)
    meshes.update(0.5, null);
    expect(meshes.podTouchdown.computeState(false, 1).phase).toBe('descending');
    expect(podRec.mesh.position.y).toBeGreaterThan(5);
    expect(podRec.mesh.getObjectByName('pod-retro-flames')?.visible).toBe(true);
    expect(meshes.podTouchdown.thrLight.intensity).toBeGreaterThan(1);

    // Advance to touchdown + engine stop phase (t = 1.95 s, within [1.75, 2.35])
    meshes.update(1.45, null);
    const engineStopState = meshes.podTouchdown.computeState(false, 1);
    expect(engineStopState.phase).toBe('engine-stop');
    expect(engineStopState.podLift).toBe(0);
    expect(engineStopState.thrust).toBeGreaterThan(0);
    expect(engineStopState.thrust).toBeLessThan(1);
    expect(engineStopState.hqVisible).toBe(true);

    // Advance past engine stop completion (t = 2.8 s)
    meshes.update(0.85, null);
    const settledState = meshes.podTouchdown.computeState(false, 1);
    expect(settledState.phase).toBe('settled');
    expect(settledState.thrust).toBe(0);
    expect(meshes.podTouchdown.thrLight.intensity).toBe(0);
    expect(podRec.mesh.getObjectByName('pod-retro-flames')?.visible).toBe(false);

    meshes.dispose();
  });
});

describe('W01-26: PodTouchdownFx dev.land transition and colony isolation', () => {
  it('hides HQ robot and selection until pod lands, and isolates owned colony touchdown', () => {
    const scene = new THREE.Scene();
    const meshes = new EntityMeshes(
      scene,
      (id) => {
        const g = new THREE.Group();
        g.name = id;
        g.userData = { archetypeId: id, uniforms: { uTime: { value: 0 }, uWalkWeight: { value: 0 }, uWorkWeight: { value: 0 } } };
        return g;
      },
      true,
    );
    meshes.setOwnerColonyIndex(1);

    const host = new LocalHost({ flags: ['W00', 'W01'], radius: 16 });
    const col0 = spawnColonyLanding(host.state, { colonyId: 0, q: 0, r: 0 });
    host.step(35); // Colony 0 is already landed and idle
    const col1 = spawnColonyLanding(host.state, { colonyId: 1, q: 6, r: 0 });
    host.step(1); // Colony 1 is descending on initial snapshot

    const ctl = new LandfallController({
      ownerColonyIndex: 1,
      isHqDeployed: () => meshes.isHqDeployed(),
    });
    ctl.onChange(({ selectedEntityId }) => meshes.setSelectedEntityId(selectedEntityId));

    const initialView = host.sync(true);
    meshes.syncView(initialView, null, 'desert');
    meshes.syncView(initialView, null, 'desert');
    expect(meshes.hasPodTouchedDown()).toBe(false);
    expect(meshes.isHqDeployed()).toBe(false);
    meshes.update(0.05, null);
    expect(meshes.hasPodTouchedDown()).toBe(false);
    expect(meshes.isHqDeployed()).toBe(false);
    // Colony 0 pod must stay on the ground (y = 0) and its HQ must remain visible
    const col0Pod = meshes.getRecord(col0.podEntityId)!;
    expect(col0Pod.mesh.position.y).toBe(0);

    // Fast-start dev.land completes Colony 1's sim descent while pod is still descending in 3D
    host.step(35);
    const landedView = host.sync(false);
    meshes.syncView(landedView, null, 'desert');
    ctl.onView(landedView);

    // Before pod touchdown (t = 0.75s): HQ robot, selection ring, and controller selection must be hidden/null
    meshes.update(0.7, null);
    const col1Pod = meshes.getRecord(col1.podEntityId)!;
    expect(col1Pod.mesh.position.y).toBeGreaterThan(2);
    expect(col1Pod.mesh.position.y).toBeLessThan(20);
    expect(meshes.hasPodTouchedDown()).toBe(false);
    expect(meshes.isHqDeployed()).toBe(false);
    expect(ctl.getSelectedEntityId()).toBeNull();
    expect(meshes.selectionRing.visible).toBe(false);
    for (let i = 1; i <= 10; i++) {
      const rec = meshes.getRecord(i);
      if (rec && rec.kind === ENTITY_KIND.hq && rec.owner === 1) {
        expect(rec.mesh.visible).toBe(false);
      }
    }

    // Step into engine-stop window (t = 1.95s, after pod touchdown at 1.75s + 0.15s deploy)
    meshes.update(1.2, null);
    const engineStop = meshes.podTouchdown.computeState(false, 1);
    expect(engineStop.phase).toBe('engine-stop');
    expect(col1Pod.mesh.position.y).toBe(0);
    expect(meshes.hasPodTouchedDown()).toBe(true);
    expect(meshes.isHqDeployed()).toBe(true);
    ctl.onView(landedView);
    expect(ctl.getSelectedEntityId()).not.toBeNull();
    expect(meshes.selectionRing.visible).toBe(true);

    // Step past total completion (t = 2.8s)
    meshes.update(0.85, null);
    const settled = meshes.podTouchdown.computeState(false, 1);
    expect(settled.phase).toBe('settled');
    expect(col1Pod.mesh.position.y).toBe(0);
    expect(settled.hqVisible).toBe(true);
    for (let i = 1; i <= 10; i++) {
      const rec = meshes.getRecord(i);
      if (rec && rec.kind === ENTITY_KIND.hq) expect(rec.mesh.visible).toBe(true);
    }

    ctl.dispose();
    meshes.dispose();
  });
});

describe('W01-25: building.commandHub geometry validation and 0/33/66/100% scaffold stages', () => {
  it('validates building.commandHub with 0 errors, 0 warnings, <3500 tris, minY 0.000 and steps scaffold stages 0/33/66/100%', () => {
    const report = validateArchetype('building.commandHub');
    expect(report.pass).toBe(true);
    expect(report.errors).toBe(0);
    expect(report.warnings).toBe(0);
    expect(report.triCount).toBeLessThan(3500);
    expect(Math.abs(report.minY)).toBeLessThan(0.001);

    const hubMesh = createArchetypeMesh('building.commandHub', 'forestRock');
    expect(hubMesh.userData.uniforms.uBuildProgress.value).toBe(1);
    expect(setArchetypeBuildProgress(hubMesh, 0)).toBe(0);
    expect(hubMesh.userData.uniforms.uBuildProgress.value).toBe(0);
    expect(setArchetypeBuildProgress(hubMesh, 0.4)).toBe(0.33);
    expect(hubMesh.userData.uniforms.uBuildStage.value).toBe(0.33);
    expect(setArchetypeBuildProgress(hubMesh, 0.75)).toBe(0.66);
    expect(hubMesh.userData.uniforms.uBuildStage.value).toBe(0.66);
    expect(setArchetypeBuildProgress(hubMesh, 1.0)).toBe(1);
    expect(hubMesh.userData.uniforms.uBuildProgress.value).toBe(1);

    const scene = new THREE.Scene();
    const meshes = new EntityMeshes(scene);
    const host = new LocalHost({ flags: ['W00', 'W01'], radius: 16 });
    const hubId = 99;
    const hubRow = insertRow(host.state.entities, hubId, host.tick);
    setField(host.state.entities, hubRow, 'kind', ENTITY_KIND.commandHub, host.tick);
    setField(host.state.entities, hubRow, 'owner', 0, host.tick);
    setField(host.state.entities, hubRow, 'q', 2, host.tick);
    setField(host.state.entities, hubRow, 'r', 2, host.tick);
    setField(host.state.entities, hubRow, 'x', 2, host.tick);
    setField(host.state.entities, hubRow, 'y', 2, host.tick);
    setField(host.state.entities, hubRow, 'hp', 1500, host.tick);
    setField(host.state.entities, hubRow, 'hpMax', 1500, host.tick);
    setField(host.state.entities, hubRow, 'state', ENTITY_STATE.waiting, host.tick);
    setField(host.state.entities, hubRow, 'progress', 0, host.tick);

    meshes.syncView(host.sync(true), null);
    expect(meshes.getRecord(hubId)!.buildStage).toBe(0);

    setField(host.state.entities, hubRow, 'state', ENTITY_STATE.constructing, host.tick);
    setField(host.state.entities, hubRow, 'progress', 0.1, host.tick);
    meshes.syncView(host.sync(false), null);
    expect(meshes.getRecord(hubId)!.buildStage).toBe(0);

    setField(host.state.entities, hubRow, 'progress', 0.4, host.tick);
    meshes.syncView(host.sync(false), null);
    expect(meshes.getRecord(hubId)!.buildStage).toBe(0.33);

    setField(host.state.entities, hubRow, 'progress', 0.75, host.tick);
    meshes.syncView(host.sync(false), null);
    expect(meshes.getRecord(hubId)!.buildStage).toBe(0.66);

    setField(host.state.entities, hubRow, 'state', ENTITY_STATE.idle, host.tick);
    setField(host.state.entities, hubRow, 'progress', 1.0, host.tick);
    meshes.syncView(host.sync(false), null);
    expect(meshes.getRecord(hubId)!.buildStage).toBe(1);

    meshes.dispose();
  });
});
