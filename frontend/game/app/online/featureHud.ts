import { track } from '../../core/analytics';
import { HudRoot } from '../../core/hud/HudRoot';
import { loadFeatures } from '../../core/registry';
import type { Disposable, FeatureContext, FeatureServices, GameView, HostKind, RendererInstance } from '../../core/registry/types';
import type { ClientFlagsStore } from '../../core/flags';
import { mountDevConsole } from '../../dev/console';
import { httpDevServer } from '../../net/devServer';

/** Analytics intake is a server feature: the local host records nothing. */
const noTrack: typeof track = () => undefined;

/**
 * Feature-registry HUD + dev console for the online flow. Features are mounted once per session (FA-29): a flags
 * update (the first `welcome`, a reconnect's `welcome`) only refreshes the live `ctx.flags` set and `flagsSource`;
 * everything is re-mounted only when the set of enabled features itself changes (a wave switched on or off), and the
 * last view is replayed into the new panels then. `services` getters (live values such as the own colony index or
 * the current terrain) are kept as getters, not read once at mount.
 */
export class FeatureHud {
  private root: HudRoot | null = null;
  private devConsole: Disposable | null = null;
  private renderers: RendererInstance[] = [];
  private last: GameView = {};
  private visible = true;
  private mountedIds: string | null = null;
  private ctx: FeatureContext | null = null;
  private readonly liveFlags = new Set<string>();
  private readonly off: () => void;
  /** How many times the features were mounted (1 for the whole session unless the enabled waves changed). */
  mounts = 0;

  get activeServices(): FeatureServices | null {
    return this.ctx?.services ?? null;
  }

  constructor(
    private readonly parent: HTMLElement,
    private readonly flags: ClientFlagsStore,
    private readonly host: HostKind,
    private readonly services: Partial<FeatureServices>,
  ) {
    this.off = flags.onChange(() => this.onFlags());
    this.mount();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root?.setVisible(visible);
  }

  update(view: GameView): void {
    this.last = view;
    this.root?.update(view);
  }

  /** A HUD toast (top bar), when the `hud-min` feature is mounted. */
  toast(message: string, severity: 'warning' | 'error' | 'info' = 'warning'): void {
    this.ctx?.services.hudMin?.showToast(message, severity);
  }

  /** Per-frame tick of the features' 3D renderers with the newest view. */
  frame(view: GameView, dt: number): void {
    for (const r of this.renderers) r.update(view, dt);
  }

  private enabledIds(): string {
    return loadFeatures({ flags: this.flags.set, host: this.host }).map((f) => f.id).join();
  }

  private onFlags(): void {
    if (this.enabledIds() === this.mountedIds) this.syncFlags();
    else this.mount();
  }

  private syncFlags(): void {
    this.liveFlags.clear();
    for (const w of this.flags.set) this.liveFlags.add(w);
  }

  /** The session's services as one object, getters included (a spread would read them once). */
  private buildServices(): FeatureServices {
    const flags = this.flags;
    const out = Object.defineProperties({}, {
      ...Object.getOwnPropertyDescriptors({ devServer: httpDevServer() }),
      ...Object.getOwnPropertyDescriptors(this.services),
    }) as FeatureServices;
    out.track = this.host === 'local' ? noTrack : track;
    Object.defineProperty(out, 'flagsSource', { get: () => flags.current.source, enumerable: true, configurable: true });
    return out;
  }

  private mount(): void {
    this.disposeMounted();
    this.syncFlags();
    const features = loadFeatures({ flags: this.liveFlags, host: this.host });
    this.mountedIds = features.map((f) => f.id).join();
    this.mounts++;
    const ctx: FeatureContext = { flags: this.liveFlags, host: this.host, services: this.buildServices() };
    this.ctx = ctx;
    this.root = new HudRoot(this.parent, features, ctx);
    this.root.setVisible(this.visible);
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && typeof location !== 'undefined') {
      this.devConsole = mountDevConsole({ parent: this.parent, features, ctx });
    }
    this.renderers = features.flatMap((f) => f.renderers ?? []).flatMap((r) => {
      try { return [r.mount(ctx)]; } catch (e) { console.warn(`renderer ${r.id} failed`, e); return []; }
    });
    this.root.update(this.last);
  }

  private disposeMounted(): void {
    for (const r of this.renderers) { try { r.dispose(); } catch (e) { console.warn(e); } }
    this.renderers = [];
    this.root?.dispose();
    this.devConsole?.dispose();
    this.root = null;
    this.devConsole = null;
  }

  dispose(): void {
    this.off();
    this.disposeMounted();
  }
}
