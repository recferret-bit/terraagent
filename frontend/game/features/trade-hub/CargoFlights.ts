import { ENTITY_KIND } from '@terra/sim';
import { CargoFlight } from '@terra/render/visuals/space/CargoFlight';
import type { FeatureContext, GameView, RendererInstance } from '../../core/registry/types';
import type { WorldStore } from '../../store/WorldStore';
import { forEachEntity, type ClientView } from '../../store/replica/viewCodec';
import { ownColonyIndex, viewColony } from '../shared/colony';
import '../shared/scene3d';

type FlightEvent = { ref: string; kind: string; direction: 'import' | 'export' };

/** Observe authoritative cargo changes, never button clicks; reconnects do not replay old flights. */
export class CargoFlights implements RendererInstance {
  private seen = new Set<string>();
  private initialized = false;
  private lastFrame = performance.now();
  private flights: CargoFlight[] = [];
  private pending: FlightEvent[] = [];
  private readonly off?: () => void;

  constructor(private readonly ctx: FeatureContext) {
    const store = ctx.services.store as Partial<WorldStore> | undefined;
    this.off = store?.onServerEvents?.((events) => {
      for (const event of events) {
        const d = event.data;
        if (!d || d.colonyIndex !== ownColonyIndex(ctx.services) || typeof d.ref !== 'string') continue;
        if (event.kind === 'cargoExported') this.pending.push({ ref: d.ref, kind: 'exported', direction: 'export' });
        if (event.kind === 'cargoImported' && d.phase === 'settled') {
          this.pending.push({ ref: d.ref, kind: 'imported', direction: 'import' });
        }
      }
    });
  }

  update(view: GameView, _dt: number): void {
    const now = performance.now();
    const dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    this.flights = this.flights.filter((flight) => {
      if (flight.update(dt)) return true;
      flight.dispose();
      return false;
    });
    const frame = view.sim?.view;
    if (!frame || !this.ctx.services.scene3d) return;
    const col = viewColony(frame, ownColonyIndex(this.ctx.services)) as Record<string, unknown> | undefined;
    if (!col) return;
    const event = (col.cargo as { lastEvent?: FlightEvent } | undefined)?.lastEvent;
    if (!this.initialized) {
      if (event && !this.pending.some((p) => p.ref === event.ref)) this.seen.add(event.ref);
      this.initialized = true;
    }
    if (event) this.pending.push(event);
    for (const item of this.pending) this.launch(frame, item);
    this.pending = [];
  }

  private launch(frame: ClientView, event: FlightEvent): void {
    const scene = this.ctx.services.scene3d!;
    const colonyIndex = ownColonyIndex(this.ctx.services);
    if (this.seen.has(event.ref) || event.kind === 'refunded') return;
    this.seen.add(event.ref);
    if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!);
    forEachEntity(frame.entities, frame.count, (entity) => {
      if (entity.kind !== ENTITY_KIND.tradeHub || entity.owner !== colonyIndex || entity.hp <= 0) return;
      const pad = scene.tileToWorld(entity.q, entity.r);
      // Front-left landing pad, rotated with the building; capsule docks above its collar.
      const c = Math.cos(entity.rot), s = Math.sin(entity.rot);
      pad.x += -0.85 * c + 1.02 * s;
      pad.z += 0.85 * s + 1.02 * c;
      pad.y += 0.72;
      this.flights.push(new CargoFlight(scene.scene, scene.biomeKey(), pad, event.direction));
      return false;
    });
  }

  dispose(): void {
    this.off?.();
    this.flights.forEach((flight) => flight.dispose());
    this.flights = [];
    this.pending = [];
  }
}
