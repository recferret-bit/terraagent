import type { WorldStore } from '../../store/WorldStore';

/** Client feature registry: the public, stable API a feature folder codes against. */

export type HostKind = 'server' | 'local';
export type HudSlot = 'top-left' | 'top-right' | 'top-center' | 'bottom-left' | 'bottom-right';
export const HUD_SLOTS: readonly HudSlot[] = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-right'];

/** Opaque per-frame view of the game. The sim view arrives later; extend by declaration merging. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface GameView {}

/**
 * Services a feature may use. Every member is declared, here or by declaration merging from the feature or net module
 * that owns it (`declare module '.../registry/types' { interface FeatureServices { ... } }`), so a misspelt service is
 * a compile error (no index signature, FA-25).
 */
export interface FeatureServices {
  /** The session's world replica (`WorldStore`); features read views through it. */
  store?: FeatureStore;
  /** Axial tile under a pointer position (the online session's terrain pick), or null off the planet. */
  /** Adds a tab to the Trade Hub panel; returns its unregister. Provided by the `trade-hub` feature while its panel is mounted. */
  /** Opens the Trade Hub panel on the extension tab `id` (e.g. `market`). */
  showTradeHubTab?: (id: string) => void;
  registerTradeHubTab?: (def: TradeHubTabDef) => () => void;
  pickTile?: (clientX: number, clientY: number, target?: EventTarget | null) => { q: number; r: number } | null;
  /**
   * Full-screen HUD layer outside the tab books (provided by `HudRoot`). Put fixed-position overlays (modals, edge
   * pings, toasts) here, not inside the panel `el`: a panel in an inactive book tab is hidden, and the book clips.
   */
  hudOverlay?: HTMLElement;
  /** Opens the tab book page that holds `el` (no-op outside a book). Call before showing a panel programmatically. */
  revealHudPanel?: (el: Element) => void;
  /** A badge on the book spine of the tab holding `el` (e.g. live combat alerts); null / 0 clears it. */
  setHudTabBadge?: (el: Element, value: number | string | null) => void;
  /**
   * Registers a "close everything" hook (open dialog, armed ghost or brush, global map …) run by `closeHudMenus`.
   * Returns the unregister. Provided by `HudRoot`.
   */
  registerHudCloser?: (close: () => void) => () => void;
  /** Folds both tab books and runs every registered closer (e.g. when the HQ dies and the respawn dialog opens). */
  closeHudMenus?: () => void;
}

/** The part of `WorldStore` features use; optional members, so a spec can pass a stand-in with only what it needs. */
export type FeatureStore = Partial<Pick<WorldStore, 'latest' | 'latestTiles' | 'onView' | 'onCommandRejected' | 'sendCommand' | 'simData' | 'currentPlanetId' | 'onServerEvents' | 'onRenderEvents' | 'onMarketBook' | 'onMarketTrade' | 'onAwayDigest' | 'latestAway' | 'onDeedUpdated' | 'onDirectorStatus'>>;

export interface FeatureContext {
  readonly flags: ReadonlySet<string>;
  readonly host: HostKind;
  readonly services: FeatureServices;
}

export interface Disposable { dispose(): void }

/** An extra tab of the Trade Hub panel (the `trade-hub` feature provides `services.registerTradeHubTab`). */
export interface TradeHubTabInstance extends Disposable { onShow?(): void; onHide?(): void }
export interface TradeHubTabDef { id: string; label: string; mount(el: HTMLElement, ctx: FeatureContext): TradeHubTabInstance }

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
  consoleCommands?: DevCommandDef[];
  /** Analytics event names this feature may track. */
  analytics?: string[];
}

export const defineFeature = (f: Feature): Feature => f;

export interface LoadOptions { flags: ReadonlySet<string>; host: HostKind }
