import {
  getActiveHexTerrains,
  getGlobalTerritoryColorBlindMode,
  setGlobalTerritoryColorBlindMode,
  type HexTerrain,
  type HexTiles,
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

export function setTerritoryColorBlindMode(enabled: boolean): boolean {
  const next = Boolean(enabled);
  setGlobalTerritoryColorBlindMode(next);
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

function resolveTerrains(explicit?: HexTerrain | null): HexTerrain[] {
  if (explicit) return [explicit];
  return [...getActiveHexTerrains()];
}

export function syncTerritoryBordersFromView(
  view?: GameView | null,
  explicitTerrain?: HexTerrain | null,
): void {
  const tiles = view?.tiles;
  if (!tiles) return;
  const hexTiles: HexTiles = {
    terrain: tiles.terrain,
    prep: tiles.prep,
    height: tiles.height ?? new Float32Array(tiles.count),
    deposit: tiles.deposit,
    owner: tiles.owner,
  };
  for (const t of resolveTerrains(explicitTerrain)) {
    t.updateTiles(hexTiles, []);
  }
}

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

  if (opts.colorBlindMode !== undefined) {
    setTerritoryColorBlindMode(opts.colorBlindMode);
  }
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
    update: (view) => {
      syncTerritoryBordersFromView(view, opts.terrain ?? opts.services?.hexTerrain ?? null);
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
