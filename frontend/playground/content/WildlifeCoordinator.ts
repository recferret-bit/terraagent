import { PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import { WildlifeSceneHost } from '../content/WildlifeSceneHost';
import type { SpawnSet } from '../content/SpawnSet';
import { WildlifePanel } from '../panels/WildlifePanel';
import type { Toolbar } from '../panels/Toolbar';
import { syncURL, type PgState } from '../state';

export interface WildlifeDeps {
  state: PgState;
  viewport: ColonyViewport;
  spawns: SpawnSet;
  toolbar: Toolbar;
  deactivateOtherScenes: () => void;
  syncSurface: () => void;
  syncStageLighting?: () => void;
  refreshInfo: () => void;
  resetView: () => void;
}

/** Coordinates Playground's live ecosystem diorama host and Faction Plate panel. */
export class WildlifeCoordinator {
  readonly host: WildlifeSceneHost;
  readonly panel: WildlifePanel;

  constructor(private d: WildlifeDeps) {
    this.host = new WildlifeSceneHost(d.viewport.scene);
    this.panel = new WildlifePanel(d.state, () => this.host.getStats(), {
      onScene: (kind) => this.setScene(kind),
      onHour: (hour) => this.setHour(hour),
      onPauseToggle: () => { this.host.togglePause(); this.panel.render(); },
      onStep: () => { this.host.step(1.0); this.panel.render(); this.d.refreshInfo(); },
      onScare: () => { this.host.triggerScare(); this.panel.render(); this.d.refreshInfo(); },
      onReset: () => this.setScene(this.d.state.wildlife),
    });
  }

  sync(): void {
    const { state, spawns } = this.d;
    spawns.content.visible = state.wildlife === null && state.faunaScene === null && !state.march;
    if (state.wildlife !== null) spawns.ring.visible = false;
    else spawns.updateRing(state.id, state.row);
    this.host.setScene(state.wildlife, { hour: state.wildlifeHour, wire: state.wire });
    this.d.syncSurface();
    this.panel.render();
    this.d.refreshInfo();
  }

  setScene(kind: PlanetKind | null, hour?: number) {
    const { state, viewport, toolbar } = this.d;
    if (kind) this.d.deactivateOtherScenes();
    state.wildlife = kind;
    if (kind) {
      state.kind = kind;
      if (this.d.syncStageLighting) this.d.syncStageLighting();
      else viewport.applySky(PLANET_SPECS[kind]);
      toolbar.setPlanet(kind);
    }
    if (hour !== undefined && Number.isFinite(hour)) state.wildlifeHour = ((hour % 24) + 24) % 24;
    this.sync();
    this.d.resetView();
    syncURL(state);
    return this.host.getStats();
  }

  setHour(hour: number) {
    this.d.state.wildlifeHour = ((hour % 24) + 24) % 24;
    this.host.setHour(this.d.state.wildlifeHour);
    this.panel.render();
    this.d.refreshInfo();
    syncURL(this.d.state);
    return this.host.getStats();
  }
}
