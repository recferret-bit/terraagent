import {
  getActiveHexTerrains,
  getGlobalTerritoryColorBlindMode,
  setGlobalTerritoryColorBlindMode,
  type HexTerrain,
  type TerritoryBorderStats,
} from '@terra/render/planets/hex';
import {
  defineFeature,
  type DevCommandDef,
  type FeatureContext,
  type GameView,
  type HudPanelInstance,
} from '../../core/registry/types';

declare module '../../core/registry/types' {
  interface FeatureServices {
    /** The session's current hex terrain (a live getter: replaced when a planet of another radius loads). */
    hexTerrain?: HexTerrain | null;
    territoryBorder?: TerritoryBorderFeatureHandle;
  }
}

export interface TerritoryBorderFeatureHandle extends HudPanelInstance {
  readonly el: HTMLElement | null;
  setColorBlindMode(enabled: boolean): boolean;
  toggleColorBlindMode(on?: boolean): boolean;
  isColorBlindMode(): boolean;
  setColonyColors(colors: Record<number, number>): void;
  getStats(): TerritoryBorderStats;
  update(view: GameView): void;
}

export interface MountTerritoryBorderOptions {
  el?: HTMLElement | null;
  terrain?: HexTerrain | null;
  colorBlindMode?: boolean;
  colonyColors?: Record<number, number>;
  services?: Partial<FeatureContext['services']>;
}

/** Per-browser memory of the player's border pattern choice (`localStorage`). */
export const BORDER_HATCH_STORAGE_KEY = 'terra.borderHatch';

export function readStoredColorBlindMode(): boolean | null {
  try {
    const v = globalThis.localStorage?.getItem(BORDER_HATCH_STORAGE_KEY);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

function storeColorBlindMode(enabled: boolean): void {
  try {
    globalThis.localStorage?.setItem(BORDER_HATCH_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // storage blocked: the choice lasts for this page only
  }
}

/** Sets the hatch pattern for every terrain (render-module default) and remembers the choice for this browser. */
export function setTerritoryColorBlindMode(enabled: boolean): boolean {
  const next = Boolean(enabled);
  setGlobalTerritoryColorBlindMode(next);
  storeColorBlindMode(next);
  return next;
}

export function isTerritoryColorBlindMode(): boolean {
  return getGlobalTerritoryColorBlindMode();
}

export function toggleTerritoryColorBlindMode(on?: boolean): boolean {
  const next = on !== undefined ? Boolean(on) : !getGlobalTerritoryColorBlindMode();
  return setTerritoryColorBlindMode(next);
}

export function setTerritoryColonyColors(colors: Record<number, number>): void {
  for (const t of getActiveHexTerrains()) {
    t.setColonyColors(colors);
  }
}

/**
 * Mounts the border pattern toggle. Territory borders themselves are drawn by the session's hex terrain from the
 * view's owner layer (the session updates the terrain); this feature only switches solid / hatch borders and keeps
 * the choice per browser (FF-28).
 */
export function mountTerritoryBorder(
  opts: MountTerritoryBorderOptions = {},
): TerritoryBorderFeatureHandle {
  const hasDom = typeof document !== 'undefined';
  const hostEl = opts.el ?? (hasDom ? document.body : null);
  const root = hasDom ? document.createElement('button') : null;
  if (root) {
    root.type = 'button';
    root.className = 'btn btn-ghost btn-sm plate-sm';
    root.dataset.testid = 'territory-border-hatch-toggle';
  }

  const initial = opts.colorBlindMode ?? readStoredColorBlindMode();
  if (initial !== null) setTerritoryColorBlindMode(initial);
  if (opts.colonyColors) {
    setTerritoryColonyColors(opts.colonyColors);
  }

  const getTargetTerrain = (): HexTerrain | null =>
    opts.terrain ?? opts.services?.hexTerrain ?? [...getActiveHexTerrains()][0] ?? null;

  const renderLabel = () => {
    if (!root) return;
    const cb = isTerritoryColorBlindMode();
    root.textContent = cb ? 'BORDER: HATCH' : 'BORDER: SOLID';
    root.setAttribute('aria-pressed', cb ? 'true' : 'false');
  };

  const applyColorBlind = (enabled: boolean): boolean => {
    const next = setTerritoryColorBlindMode(enabled);
    const t = getTargetTerrain();
    if (t) t.setColorBlindMode(next);
    renderLabel();
    return next;
  };

  root?.addEventListener('click', () => {
    applyColorBlind(!isTerritoryColorBlindMode());
  });

  renderLabel();
  if (root && hostEl) {
    hostEl.appendChild(root);
  }

  const handle: TerritoryBorderFeatureHandle = {
    el: root,
    setColorBlindMode: (enabled) => applyColorBlind(enabled),
    toggleColorBlindMode: (on) => applyColorBlind(on !== undefined ? on : !isTerritoryColorBlindMode()),
    isColorBlindMode: () => getTargetTerrain()?.getTerritoryBorderStats().colorBlindMode ?? isTerritoryColorBlindMode(),
    setColonyColors: (colors) => {
      const t = getTargetTerrain();
      if (t) t.setColonyColors(colors);
      setTerritoryColonyColors(colors);
    },
    getStats: () =>
      getTargetTerrain()?.getTerritoryBorderStats() ?? {
        ownedTileCount: 0,
        boundaryEdgeCount: 0,
        frozenEdgeCount: 0,
        hatchSegmentCount: 0,
        colorBlindMode: isTerritoryColorBlindMode(),
      },
    update: () => {
      const t = getTargetTerrain();
      if (t && t.getTerritoryBorderStats().colorBlindMode !== isTerritoryColorBlindMode()) t.setColorBlindMode(isTerritoryColorBlindMode());
      renderLabel();
    },
    dispose: () => {
      root?.remove();
    },
  };

  if (opts.services) {
    opts.services.territoryBorder = handle;
  }
  return handle;
}

export const territoryBorderDevCommands: DevCommandDef[] = [
  {
    name: 'border-hatch',
    help: 'border-hatch [on|off] — toggle colour-blind hatch pattern on territory borders',
    run(args, ctx) {
      const arg = args[0]?.toLowerCase();
      const next =
        arg === 'on' || arg === '1' || arg === 'true'
          ? true
          : arg === 'off' || arg === '0' || arg === 'false'
            ? false
            : !isTerritoryColorBlindMode();
      if (ctx.services.territoryBorder) {
        ctx.services.territoryBorder.setColorBlindMode(next);
      } else {
        setTerritoryColorBlindMode(next);
      }
      return `territory border colour-blind hatch: ${next ? 'on' : 'off'}`;
    },
  },
];

export const territoryBorderFeature = defineFeature({
  id: 'territory-border',
  wave: 'W01',
  hud: [
    {
      id: 'territory-border-toggle',
      slot: 'top-right',
      order: 25,
      mount(el, ctx) {
        return mountTerritoryBorder({ el, services: ctx.services });
      },
    },
  ],
  devCommands: territoryBorderDevCommands,
});

export default territoryBorderFeature;
