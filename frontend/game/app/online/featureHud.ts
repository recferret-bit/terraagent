import { track } from '../../core/analytics';
import { HudRoot } from '../../core/hud/HudRoot';
import { loadFeatures } from '../../core/registry';
import type { Disposable, FeatureServices, GameView } from '../../core/registry/types';
import type { ClientFlagsStore } from '../../core/flags';
import { mountDevConsole } from '../../dev/console';
import { httpDevServer } from '../../net/devServer';

/** Feature-registry HUD for the online flow: re-mounts when the flags change and replays the last view into the new panels. */
export class FeatureHud {
  private root: HudRoot | null = null;
  private devConsole: Disposable | null = null;
  private last: GameView = {};
  private readonly off: () => void;

  constructor(
    private readonly parent: HTMLElement,
    private readonly flags: ClientFlagsStore,
    private readonly extraServices: Partial<FeatureServices> = {},
  ) {
    this.off = flags.onChange(() => this.mount());
    this.mount();
  }

  update(view: GameView): void {
    this.last = view;
    this.root?.update(view);
  }

  private mount(): void {
    this.root?.dispose();
    this.devConsole?.dispose();
    const { source } = this.flags.current;
    const set = this.flags.set;
    const features = loadFeatures({ flags: set, host: 'server' });
    const ctx = {
      flags: set,
      host: 'server' as const,
      services: { track, flagsSource: source, devServer: httpDevServer(), ...this.extraServices },
    };
    this.root = new HudRoot(this.parent, features, ctx);
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && typeof location !== 'undefined') {
      this.devConsole = mountDevConsole({ parent: this.parent, features, ctx });
    }
    this.root.update(this.last);
  }

  dispose(): void {
    this.off();
    this.root?.dispose();
    this.devConsole?.dispose();
    this.root = null;
    this.devConsole = null;
  }
}
