import { GuildShipRig } from '@terra/render/visuals/space/GuildShipRig';
import type { GuildArrivedPayload, GuildDepartedPayload } from '@terra/contracts';
import { DEFAULT_GUILD_DOT_COLOR, clearExtraMapDot, setExtraMapDot } from '../../maps/entityDots';
import type { FeatureContext, GameView, RendererInstance } from '../../core/registry/types';
import type { ClientView } from '../../store/replica/viewCodec';
import { dockSpotFromView } from './dockSpot';
import { GuildShipPresenter, type GuildDockMark, type GuildShipPose } from './GuildShipPresenter';
import '../shared/scene3d';

const MARK_PREFIX = 'guild:';

/**
 * Plays `guild.arrived` / `guild.departed` on the colony scene.
 * The ship group is parented to `scene3d.scene` as `guild-ship:<shipId>`.
 * The drop rig and flames are children of that group (see `GuildShipRig`).
 */
export class GuildShipView implements RendererInstance {
  private readonly presenter: GuildShipPresenter;
  private readonly rigs = new Map<string, GuildShipRig>();
  private readonly off: () => void;
  private elapsedMs = 0;
  private frame: GameView | null = null;

  constructor(private readonly ctx: FeatureContext) {
    const w04 = ctx.flags.has('W04');
    this.presenter = new GuildShipPresenter({
      now: () => this.elapsedMs,
      w04,
      marker: w04 ? (mark) => this.applyMark(mark) : undefined,
      dockFor: () => dockSpotFromView(this.viewEntities()),
      samePlanet: (planetId) => {
        const here = ctx.services.session?.planetId() ?? null;
        return here === null || here === planetId;
      },
    });
    this.off =
      ctx.services.transport?.onMessage?.((m) => {
        if (m.t === 'guild.arrived') this.presenter.arrive(m.d as GuildArrivedPayload);
        else if (m.t === 'guild.departed') this.presenter.depart(m.d as GuildDepartedPayload);
      }) ?? (() => {});
  }

  update(view: GameView, dt: number): void {
    this.frame = view;
    this.elapsedMs += Number.isFinite(dt) ? Math.max(0, dt) * 1000 : 0;
    this.presenter.sync();
    const scene = this.ctx.services.scene3d;
    for (const pose of this.presenter.poses()) {
      if (pose.phase === 'gone' || !scene) {
        this.dropRig(pose.shipId);
        continue;
      }
      this.place(scene, pose);
    }
    this.presenter.forgetGone();
  }

  dispose(): void {
    this.off();
    for (const id of [...this.rigs.keys()]) this.dropRig(id);
    this.rigs.clear();
  }

  private place(scene: NonNullable<FeatureContext['services']['scene3d']>, pose: GuildShipPose): void {
    let rig = this.rigs.get(pose.shipId);
    if (!rig) {
      rig = new GuildShipRig(scene.biomeKey());
      rig.root.name = `guild-ship:${pose.shipId}`;
      scene.scene.add(rig.root);
      this.rigs.set(pose.shipId, rig);
    }
    const pad = scene.tileToWorld(pose.q, pose.r);
    const hub = scene.tileToWorld(pose.hubQ, pose.hubR);
    rig.place({
      x: pad.x,
      y: pad.y,
      z: pad.z,
      altitudeM: pose.altitudeM,
      bobM: pose.bobM,
      flame: pose.flame,
      time: this.elapsedMs / 1000,
      yaw: Math.atan2(hub.x - pad.x, hub.z - pad.z),
    });
  }

  private dropRig(shipId: string): void {
    const rig = this.rigs.get(shipId);
    if (!rig) return;
    rig.dispose();
    this.rigs.delete(shipId);
  }

  private applyMark(mark: GuildDockMark): void {
    const id = MARK_PREFIX + mark.shipId;
    if (!mark.visible) clearExtraMapDot(id);
    else setExtraMapDot({ id, q: mark.q, r: mark.r, color: DEFAULT_GUILD_DOT_COLOR, shape: 'ship' });
    this.ctx.services.maps?.controller.scheduler.markDirty({ minimap: true, globalMap: true });
  }

  private viewEntities(): { entities?: ClientView['entities']; count?: number } | null {
    const latest = this.ctx.services.store?.latest;
    if (latest?.entities) return latest;
    const sim = this.frame?.sim?.view;
    if (sim?.entities) return sim;
    return null;
  }
}
