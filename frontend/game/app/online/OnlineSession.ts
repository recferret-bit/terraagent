import * as THREE from 'three';
import { createColonyViewport, type ColonyViewport } from '@terra/render/core/createColonyViewport';
import { applyPlanetLook } from '@terra/render/planets/applyPlanetLook';
import { createHexTerrain, specForPlanetType, tileXZ, type HexPick, type HexTerrain, type HexTiles } from '@terra/render/planets/hex';
import { ConnectionBanner } from '../../net/ConnectionBanner';
import { WsTransport, browserDeps } from '../../net/WsTransport';
import { withDevLag } from '../../net/LagTransport';
import { CommandBus } from '../../net/commandBus';
import { httpDevServer } from '../../net/devServer';
import type { Transport } from '../../net/types';
import { WorldStore } from '../../store/WorldStore';
import type { ClientTiles, ClientView } from '../../store/replica/viewCodec';
import { createClientFlagsStore, resolveClientFlags, type ClientFlagsStore } from '../../core/flags';
import { RTSCamera } from '../RTSCamera';
import { FeatureHud } from './featureHud';
import { hexSurface } from './hexSurface';
import { createSessionTarget } from './sessionTarget';
import { warpOfMessage } from '../../net/warpFeed';
import type { OnlineMode } from './onlineMode';
import '../../../design/css/tokens.css';
import '../../../design/css/base.css';

/** Tile indices whose height differs between two tile snapshots (the replica only says "tiles changed"). */
function changedHeights(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

/**
 * The online play flow (`?scenario=` / `?host=`): viewport + planet look for the sim's planet type, WS transport,
 * replica store, hex terrain from the welcome tiles, RTS camera and the feature HUD (tick chip). No game rules here.
 * `?host=local` is not implemented yet: it connects to the server like `?scenario=` does.
 */
export class OnlineSession {
  readonly viewport: ColonyViewport;
  readonly transport: Transport;
  readonly store: WorldStore;
  readonly commands: CommandBus;
  readonly flags: ClientFlagsStore = createClientFlagsStore();
  terrain: HexTerrain | null = null;
  cam: RTSCamera | null = null;
  lastPick: HexPick | null = null;
  private readonly banner: ConnectionBanner;
  private readonly hud: FeatureHud;
  private tiles: ClientTiles | null = null;
  private warp = 1;
  private raf = 0;
  private last = performance.now();
  private cleanups: Array<() => void> = [];

  constructor(root: HTMLElement, readonly mode: OnlineMode) {
    this.viewport = createColonyViewport(root);
    // dev `?lag=<ms>` delays the transport both ways (prediction testing, D-31)
    this.transport = withDevLag(new WsTransport(createSessionTarget(location), browserDeps()), location.search);
    this.banner = new ConnectionBanner(document.body, this.transport, () => this.transport.start());
    this.store = new WorldStore(this.transport);
    this.commands = new CommandBus(this.transport, undefined, (id, kind, args) => this.store.notifySent(id, kind, args));
    this.hud = new FeatureHud(document.body, this.flags, { sendCommand: this.commands.send, devServer: httpDevServer(), session: { planetId: () => this.store.latest?.planet.id ?? null } });
    this.cleanups.push(this.transport.onMessage((m) => {
      const k = warpOfMessage(m);
      if (k !== undefined) this.setWarp(k);
      if (m.t === 'welcome') this.flags.update(resolveClientFlags({ welcomeFlags: m.d.flags, search: location.search, dev: import.meta.env.DEV }));
    }));
    this.cleanups.push(this.store.onView((v) => this.onView(v)));
    this.store.start([], { predict: new URLSearchParams(location.search).get('predict') !== '0' });
    this.transport.start();
    this.bindPicking();
    this.loop();
  }

  private onView(v: ClientView): void {
    if (v.tiles) this.onTiles(v, v.tiles);
    this.hud.update({ tick: v.tick, warp: this.warp });
  }

  private setWarp(k: number): void {
    this.warp = k;
    this.hud.update({ tick: this.store.latest?.tick, warp: k });
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
      const changed = changedHeights(this.tiles.height, tiles.height);
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

  private bindPicking(): void {
    const dom = this.viewport.renderer.domElement;
    let down = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => { if (e.button === 0 && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 5) this.pickAt(e.clientX, e.clientY); };
    dom.addEventListener('pointerdown', onDown); dom.addEventListener('pointerup', onUp);
    this.cleanups.push(() => { dom.removeEventListener('pointerdown', onDown); dom.removeEventListener('pointerup', onUp); });
  }

  private loop = () => {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.05); this.last = now;
    try {
      if (this.cam) { this.cam.update(dt); this.viewport.followShadow(this.cam.target); }
      this.viewport.render();
    } catch (e) { console.error('frame error', e); }
    this.raf = requestAnimationFrame(this.loop);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.cleanups.forEach((f) => f());
    this.cam?.dispose();
    this.commands.dispose(); this.store.dispose(); this.transport.stop();
    this.hud.dispose(); this.banner.dispose();
    this.terrain?.dispose();
    this.viewport.dispose();
  }
}
