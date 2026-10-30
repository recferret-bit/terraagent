import { track } from '../../core/analytics';
import { HudRoot } from '../../core/hud/HudRoot';
import { loadFeatures } from '../../core/registry';
import type { Disposable, FeatureServices, GameView, HostKind, RendererInstance } from '../../core/registry/types';
import type { ClientFlagsStore } from '../../core/flags';
import { mountDevConsole } from '../../dev/console';

/** Analytics intake is a server feature: the local host records nothing. */
const noTrack: typeof track = () => undefined;

/**
 * Feature-registry HUD + dev console for the online flow: re-mounts both when the flags change (so only enabled
 * waves' panels and commands exist) and replays the last view into the new panels.
 */
export class FeatureHud {
  private root: HudRoot | null = null;
  private devConsole: Disposable | null = null;
  private renderers: RendererInstance[] = [];
  private last: GameView = {};
  private readonly off: () => void;

  constructor(private readonly parent: HTMLElement, private readonly flags: ClientFlagsStore, private readonly host: HostKind = 'server', private readonly services: Partial<FeatureServices> = {}) {
    this.off = flags.onChange(() => this.mount());
    this.mount();
  }

  update(view: GameView): void {
    this.last = view;
    this.root?.update(view);
  }

  /** Per-frame tick of the features' 3D renderers with the newest view. */
  frame(view: GameView, dt: number): void {
    for (const r of this.renderers) r.update(view, dt);
  }

  private mount(): void {
    this.disposeRenderers();
    this.root?.dispose();
    this.devConsole?.dispose();
    const { source } = this.flags.current;
    const set = this.flags.set;
    const features = loadFeatures({ flags: set, host: this.host });
    const ctx = { flags: set, host: this.host, services: { ...this.services, track: this.host === 'local' ? noTrack : track, flagsSource: source } };
    this.root = new HudRoot(this.parent, features, ctx);
    this.devConsole = mountDevConsole({ parent: this.parent, features, ctx });
    this.renderers = features.flatMap((f) => f.renderers ?? []).flatMap((r) => {
      try { return [r.mount(ctx)]; } catch (e) { console.warn(`renderer ${r.id} failed`, e); return []; }
    });
    this.root.update(this.last);
  }

  private disposeRenderers(): void {
    for (const r of this.renderers) { try { r.dispose(); } catch (e) { console.warn(e); } }
    this.renderers = [];
  }

  dispose(): void {
    this.off();
    this.disposeRenderers();
    this.root?.dispose();
    this.devConsole?.dispose();
    this.root = null;
    this.devConsole = null;
  }
}
