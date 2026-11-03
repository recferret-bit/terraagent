import type * as THREE from 'three';
import { tileXZ, type HexPick, type HexTerrain } from '@terra/render/planets/hex';
import type { ClientFlagsStore } from '../../core/flags';
import type { FeatureServices } from '../../core/registry/types';
import type { Scene3dService } from '../../features/shared/scene3d';
import type { LandfallController } from '../../features/landfall';
import type { CommandBus } from '../../net/commandBus';
import { httpDevServer, sessionLedgerQuery, type DevServer } from '../../net/devServer';
import type { LocalTransport } from '../../net/LocalTransport';
import type { NetStatsBoard } from '../../net/netStats';
import type { Transport } from '../../net/types';
import type { LocalHost } from '../../store/local/LocalHost';
import type { WorldStore } from '../../store/WorldStore';
import { FeatureHud } from './featureHud';

/** What the feature HUD reads from the online session; the getters are read on every use (live values). */
export interface SessionHudDeps {
  uiParent: HTMLElement;
  flags: ClientFlagsStore;
  /** The `?host=local` worker transport, or null on the server flows. */
  local: LocalTransport | null;
  scene: THREE.Scene;
  canvas: HTMLElement;
  store: WorldStore;
  commandBus: CommandBus;
  netStats: NetStatsBoard;
  transport: Transport;
  landfall: LandfallController;
  terrain(): HexTerrain | null;
  biomeKey(): string;
  /** The in-process fallback host, once attached (its dev server and ledger replace the server's). */
  localHost(): LocalHost | null;
  planetId(): string | null;
  /** Own colony index (changes when the boot seats the colony). */
  colonyIndex(): number;
  pickAt(clientX: number, clientY: number): HexPick | null;
}

/**
 * The online session's `FeatureServices` and its `FeatureHud`. Besides the shared services it provides, for the
 * features: `surface` (the canvas the pointer events bind to, same element as `canvas`), `colonyId` (getter: the own
 * colony index right now) and `hexTerrain` (getter: the current hex terrain, replaced when a planet of another radius
 * loads; null before the first tiles).
 */
export function createSessionHud(d: SessionHudDeps): FeatureHud {
  const scene3d: Scene3dService = {
    scene: d.scene,
    tileToWorld: (x, y) => { const [wx, wz] = tileXZ(x, y); return { x: wx, y: d.terrain()?.heightAt(wx, wz) ?? 0, z: wz }; },
    biomeKey: d.biomeKey,
  };
  const baseDev = d.local ? d.local.devServer : httpDevServer();
  // an attached in-process fallback answers like `?host=local`; never send tune / scenario to a real server planet
  const devServer: DevServer = async (name, args) => (d.localHost()?.devServer ?? baseDev)(name, args);
  const services: Partial<FeatureServices> = {
    sendCommand: d.commandBus.send, devServer,
    ledgerQuery: sessionLedgerQuery(d.localHost, d.local ? d.local.devServer : null, d.planetId),
    session: { planetId: d.planetId },
    scene3d, netStats: d.netStats, transport: d.transport, store: d.store,
    getView: () => d.store.latest ?? undefined,
    landfall: d.landfall, pickTile: (cx, cy) => d.pickAt(cx, cy), canvas: d.canvas, surface: d.canvas,
  };
  Object.defineProperties(services, {
    colonyId: { get: d.colonyIndex, enumerable: true, configurable: true },
    hexTerrain: { get: d.terrain, enumerable: true, configurable: true },
  });
  return new FeatureHud(d.uiParent, d.flags, d.local ? 'local' : 'server', services);
}
