/** Client feature registry: the public, stable API a feature folder codes against. */

export type HostKind = 'server' | 'local';
export type HudSlot = 'top-left' | 'top-right' | 'top-center' | 'bottom-left' | 'bottom-right';
export const HUD_SLOTS: readonly HudSlot[] = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-right'];

/** Opaque per-frame view of the game. The sim view arrives later; extend by declaration merging. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface GameView {}

/**
 * Services a feature may use. Empty on purpose: later issues add members via declaration merging
 * (`declare module '.../registry/types' { interface FeatureServices { ... } }`) so existing features keep compiling.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface FeatureServices {}

export interface FeatureContext {
  readonly flags: ReadonlySet<string>;
  readonly host: HostKind;
  readonly services: FeatureServices;
}

export interface Disposable { dispose(): void }

export interface HudPanelInstance extends Disposable { update?(view: GameView): void }
export interface HudPanelDef {
  id: string;
  slot: HudSlot;
  /** Ascending within a slot; default 0. */
  order?: number;
  /** Panel root `el` is pointer-events:auto; add your content to it. */
  mount(el: HTMLElement, ctx: FeatureContext): HudPanelInstance;
}

export interface MenuDef { id: string; label: string; open(ctx: FeatureContext): void }

export interface RendererInstance extends Disposable { update(view: GameView, dt: number): void }
export interface RendererDef { id: string; mount(ctx: FeatureContext): RendererInstance }

export interface DevCommandDef {
  name: string;
  help: string;
  run(args: string[], ctx: FeatureContext): string | Promise<string>;
}

export interface Feature {
  /** Folder name under features/. */
  id: string;
  /** Wave id ('W00'..'W25'); the feature is skipped unless this flag is on. */
  wave: string;
  /** `'server'`: hidden on the browser local host (?host=local); `'local'`: hidden on the game server host. */
  hostOnly?: 'server' | 'local';
  hud?: HudPanelDef[];
  menus?: MenuDef[];
  renderers?: RendererDef[];
  devCommands?: DevCommandDef[];
  /** Analytics event names this feature may track. */
  analytics?: string[];
}

export const defineFeature = (f: Feature): Feature => f;

export interface LoadOptions { flags: ReadonlySet<string>; host: HostKind }
