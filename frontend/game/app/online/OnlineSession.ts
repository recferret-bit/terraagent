import * as THREE from 'three';
import { createColonyViewport, type ColonyViewport } from '@terra/render/core/createColonyViewport';
import { applyPlanetLook } from '@terra/render/planets/applyPlanetLook';
import { createHexTerrain, specForPlanetType, tileXZ, type HexPick, type HexTerrain, type HexTiles } from '@terra/render/planets/hex';
import { CommandBus } from '../../net/commandBus';
import { ConnectionBanner } from '../../net/ConnectionBanner';
import { WsTransport, browserDeps } from '../../net/WsTransport';
import { WorldStore } from '../../store/WorldStore';
import type { ClientTiles, ClientView } from '../../store/replica/viewCodec';
import { createClientFlagsStore, resolveClientFlags, type ClientFlagsStore } from '../../core/flags';
import { LandfallController } from '../../features/landfall';
import { RTSCamera } from '../RTSCamera';
import { EntityMeshes } from './EntityMeshes';
import { FeatureHud } from './featureHud';
import { hexSurface } from './hexSurface';
import { createSessionTarget } from './sessionTarget';
import type { OnlineMode } from './onlineMode';
import '../../../design/css/tokens.css';
import '../../../design/css/base.css';

/** Tile indices whose height, terrain, prep or deposit differs between two tile snapshots. */
function changedTiles(a: ClientTiles, b: ClientTiles): number[] {
  const out: number[] = [];
  for (let i = 0; i < b.count; i++) {
    if (
      a.height[i] !== b.height[i] ||
      a.terrain[i] !== b.terrain[i] ||
      a.prep[i] !== b.prep[i] ||
      a.deposit?.[i] !== b.deposit?.[i]
    ) {
      out.push(i);
    }
  }
  return out;
}

/**
 * The online play flow (`?scenario=` / `?host=`): viewport + planet look for the sim's planet type, WS transport,
 * replica store, hex terrain from the welcome tiles, RTS camera and the feature HUD (tick chip). No game rules here.
 * `?host=local` is not implemented yet: it connects to the server like `?scenario=` does.
 */
export class OnlineSession {
  readonly viewport: ColonyViewport;
  readonly transport: WsTransport;
  readonly store: WorldStore;
  readonly commandBus: CommandBus;
  readonly entities: EntityMeshes;
  readonly landfall: LandfallController;
  readonly flags: ClientFlagsStore = createClientFlagsStore();
  terrain: HexTerrain | null = null;
  cam: RTSCamera | null = null;
  lastPick: HexPick | null = null;
  private readonly banner: ConnectionBanner;
  private readonly hud: FeatureHud;
  private tiles: ClientTiles | null = null;
  private raf = 0;
  private last = performance.now();
  private cleanups: Array<() => void> = [];

  constructor(root: HTMLElement, readonly mode: OnlineMode) {
    this.viewport = createColonyViewport(root);
    this.transport = new WsTransport(createSessionTarget(location), browserDeps());
    this.banner = new ConnectionBanner(document.body, this.transport, () => this.transport.start());
    this.store = new WorldStore(this.transport);
    this.commandBus = new CommandBus(this.transport);
    this.entities = new EntityMeshes(this.viewport.scene);
    this.landfall = new LandfallController({
      store: this.store,
      sendCommand: this.commandBus.send,
      pickTile: (cx, cy) => this.pickAt(cx, cy),
      canvas: this.viewport.renderer.domElement,
      onTargetMove: (q, r) => this.entities.flashTarget(q, r, this.terrain),
    });
    this.cleanups.push(
      this.landfall.onChange(({ selectedEntityId }) => {
        this.entities.setSelectedEntityId(selectedEntityId);
      }),
    );
    this.hud = new FeatureHud(document.body, this.flags, {
      sendCommand: this.commandBus.send,
      store: this.store,
      landfall: this.landfall,
      pickTile: (cx, cy) => this.pickAt(cx, cy),
      canvas: this.viewport.renderer.domElement,
    });
    this.cleanups.push(this.transport.onMessage((m) => {
      if (m.t === 'welcome') this.flags.update(resolveClientFlags({ welcomeFlags: m.d.flags, search: location.search, dev: import.meta.env.DEV }));
    }));
    this.cleanups.push(this.store.onView((v) => this.onView(v)));
    this.store.start();
    this.transport.start();
    this.loop();
  }

  selectHq(): number | null {
    return this.landfall.selectHq();
  }

  orderMove(q: number, r: number): boolean {
    return this.landfall.orderMove(q, r);
  }

  getSelectedEntityId(): number | null {
    return this.landfall.getSelectedEntityId();
  }

  private onView(v: ClientView): void {
    if (v.tiles) this.onTiles(v, v.tiles);
    const biomeKey = specForPlanetType(v.planet.type).biomeKey;
    this.entities.syncView(v, this.terrain, biomeKey);
    this.landfall.onView(v);
    this.hud.update(v);
  }

  private onTiles(v: ClientView, tiles: ClientTiles): void {
    if (!this.terrain || this.terrain.radius !== v.planet.radius) {
      this.terrain?.dispose();
      const look = specForPlanetType(v.planet.type);
      applyPlanetLook(this.viewport, look);
      const terrain = createHexTerrain({ radius: v.planet.radius, tiles: tiles as HexTiles, look });
      this.terrain = terrain;
      this.viewport.scene.add(terrain.group);
      this.cam?.dispose();
      const surface = hexSurface(terrain, look);
      this.cam = new RTSCamera(this.viewport.camera, this.viewport.renderer.domElement, surface, new THREE.Vector3(42, 46, 42), new THREE.Vector3(0, 0, 0));
    } else if (this.tiles) {
      const changed = changedTiles(this.tiles, tiles);
      if (changed.length) this.terrain.updateTiles(tiles as HexTiles, changed);
    }
    this.tiles = tiles;
  }

  /** Tile under a client-space point, or null (also logged; the state inspector arrives later). */
  pickAt(clientX: number, clientY: number): HexPick | null {
    if (!this.terrain) return null;
    const r = this.viewport.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.lastPick = this.terrain.pick(ndc, this.viewport.camera);
    console.log('[pick]', this.lastPick ? `q=${this.lastPick.q} r=${this.lastPick.r} i=${this.lastPick.i}` : 'off-planet');
    return this.lastPick;
  }

  /** Client-space pixel of a tile centre (debug/E2E: `clickTile`), or null before the terrain exists. */
  tileToScreen(q: number, r: number): { x: number; y: number } | null {
    if (!this.terrain) return null;
    const [x, z] = tileXZ(q, r);
    const p = new THREE.Vector3(x, this.terrain.heightAt(x, z), z).project(this.viewport.camera);
    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  private loop = () => {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.05); this.last = now;
    try {
      this.entities.update(dt, this.terrain);
      if (this.cam) { this.cam.update(dt); this.viewport.followShadow(this.cam.target); }
      this.terrain?.tick(dt);
      this.viewport.render();
    } catch (e) { console.error('frame error', e); }
    this.raf = requestAnimationFrame(this.loop);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.cleanups.forEach((f) => f());
    this.landfall.dispose();
    this.entities.dispose();
    this.commandBus.dispose();
    this.cam?.dispose();
    this.store.dispose(); this.transport.stop();
    this.hud.dispose(); this.banner.dispose();
    this.terrain?.dispose();
    this.viewport.dispose();
  }
}
