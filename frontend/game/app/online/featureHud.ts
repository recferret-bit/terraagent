import { track } from '../../core/analytics';
import { HudRoot } from '../../core/hud/HudRoot';
import { loadFeatures } from '../../core/registry';
import type { GameView } from '../../core/registry/types';
import type { ClientFlagsStore } from '../../core/flags';

/** Feature-registry HUD for the online flow: re-mounts when the flags change and replays the last view into the new panels. */
export class FeatureHud {
  private root: HudRoot | null = null;
  private last: GameView = {};
  private readonly off: () => void;

  constructor(private readonly parent: HTMLElement, private readonly flags: ClientFlagsStore) {
    this.off = flags.onChange(() => this.mount());
    this.mount();
  }

  update(view: GameView): void {
    this.last = view;
    this.root?.update(view);
  }

  private mount(): void {
    this.root?.dispose();
    const { source } = this.flags.current;
    const set = this.flags.set;
    this.root = new HudRoot(this.parent, loadFeatures({ flags: set, host: 'server' }), { flags: set, host: 'server', services: { track, flagsSource: source } });
    this.root.update(this.last);
  }

  dispose(): void {
    this.off();
    this.root?.dispose();
    this.root = null;
  }
}
