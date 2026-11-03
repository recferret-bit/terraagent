/* Tab registry of the F8 Visual Shader Lab. Each tab adapts one effect store (on/off + params + listeners) to the
   dialog; `pixelDialog.ts` only renders and dispatches. A new tab is one entry here plus its sliders in
   `visualLabSpecs.ts`, never another branch in the dialog. */
import {
  getDayNightParams, isDayNightOn, onDayNightChange, resetDayNightParams, setDayNight, setDayNightParams, toggleDayNight,
} from '../core/dayNightConfig';
import { getPixelArtParams, isPixelArtOn, onPixelArtChange, resetPixelArtParams, setPixelArt, setPixelArtParams, togglePixelArt } from '../core/pixelArtPass';
import { getShadowParams, isShadowOn, onShadowChange, resetShadowParams, setShadow, setShadowParams, toggleShadow } from '../core/shadowConfig';
import { getWindParams, isWindOn, onWindChange, resetWindParams, setWind, setWindParams, toggleWind } from '../core/windConfig';
import {
  getWaterParams, isWaterFxOn, onWaterChange, resetWaterParams, setWaterFx, setWaterParams, toggleWaterFx,
} from '../visuals/water/waterConfig';
import {
  getPerfParams, isPerfOn, onPerfChange, resetPerfParams, setPerf, setPerfParams, togglePerf,
} from '../core/perfConfig';
import { getCrtParams, isCrtOn, onCrtChange, resetCrtParams, setCrt, setCrtParams, toggleCrt } from './crt';
import {
  CRT_SLIDERS, DAY_NIGHT_SLIDERS, PERF_SLIDERS, PIXEL_SLIDERS, SHADOW_SLIDERS, WATER_SLIDERS, WIND_SLIDERS,
  type SliderSpec, type VisualTabId,
} from './visualLabSpecs';
import { CYCLE_HEAD, PERF_HEAD, SUN_HEAD, WIND_HEAD, type VisualLabHead } from './visualLabWidgets';

export type { VisualTabId } from './visualLabSpecs';
export type { VisualLabHead } from './visualLabWidgets';

type Params = Readonly<Record<string, number>>;

export interface VisualLabTab {
  readonly id: VisualTabId;
  readonly label: string;
  readonly statusTitle: string;
  readonly sliders: readonly SliderSpec[];
  /** Optional widget drawn above the sliders (sun pad, solar clock, wind compass). */
  readonly head?: VisualLabHead;
  isOn(): boolean;
  toggle(): void;
  getParams(): Params;
  /** A slider edit: switches the effect on if it was off (like the bottom-left switches), then writes the value. */
  setParam(key: string, value: number): void;
  reset(): void;
  /**
   * Subscribes to store changes. `fn(always)`: `true` = refresh the dialog even while it is closed; the day/night clock
   * ticks every frame, so only its user-sourced edits pass `true` (closed dialog, no per-frame DOM work).
   */
  onChange(fn: (always: boolean) => void): () => void;
}

interface StoreApi<P> {
  isOn(): boolean;
  setOn(on: boolean): unknown;
  toggle(): unknown;
  get(): Readonly<P>;
  set(patch: Partial<P>): unknown;
  reset(): unknown;
  onChange(fn: () => void): () => unknown;
}

type Meta = Pick<VisualLabTab, 'id' | 'label' | 'statusTitle' | 'sliders' | 'head'>;

function storeTab<P>(meta: Meta, s: StoreApi<P>): VisualLabTab {
  return {
    ...meta,
    isOn: () => s.isOn(),
    toggle: () => { s.toggle(); },
    getParams: () => s.get() as unknown as Params,
    setParam(key, value) {
      if (!s.isOn()) s.setOn(true);
      s.set({ [key]: value } as Partial<P>);
    },
    reset: () => { s.reset(); },
    onChange(fn) {
      const off = s.onChange(() => fn(true));
      return () => { off(); };
    },
  };
}

export const VISUAL_LAB_TABS: readonly VisualLabTab[] = [
  // Lambdas, not references: `crt.ts` -> `pixelArt.ts` -> `pixelDialog.ts` -> this file is an import cycle, so the crt
  // exports are not initialised yet when this registry is built.
  storeTab({ id: 'crt', label: 'CRT', statusTitle: 'CRT OVERLAY STATUS (F9)', sliders: CRT_SLIDERS }, {
    isOn: () => isCrtOn(), setOn: (on) => setCrt(on), toggle: () => toggleCrt(), get: () => getCrtParams(),
    set: (p) => setCrtParams(p), reset: () => resetCrtParams(), onChange: (fn) => onCrtChange(fn),
  }),
  storeTab({ id: 'pixel', label: 'PIXEL', statusTitle: 'PIXEL SHADER STATUS (F10)', sliders: PIXEL_SLIDERS }, {
    isOn: isPixelArtOn, setOn: (on) => setPixelArt(on), toggle: togglePixelArt, get: getPixelArtParams,
    set: setPixelArtParams, reset: resetPixelArtParams, onChange: onPixelArtChange,
  }),
  storeTab({ id: 'shadow', label: 'SHADOW', statusTitle: 'SUN & SHADOW STATUS (F7)', sliders: SHADOW_SLIDERS, head: SUN_HEAD }, {
    isOn: isShadowOn, setOn: setShadow, toggle: toggleShadow, get: getShadowParams, set: setShadowParams,
    reset: resetShadowParams, onChange: onShadowChange,
  }),
  {
    id: 'daynight', label: 'DAY/NIGHT', statusTitle: 'PLANETARY SOLAR CYCLE', sliders: DAY_NIGHT_SLIDERS, head: CYCLE_HEAD,
    isOn: isDayNightOn,
    toggle: () => { toggleDayNight(); },
    getParams: () => getDayNightParams() as unknown as Params,
    setParam(key, value) {
      if (!isDayNightOn()) setDayNight(true);
      setDayNightParams({ [key]: value }, 'user');
    },
    reset: () => { resetDayNightParams('user'); },
    onChange(fn) {
      const off = onDayNightChange((_on, _p, source) => fn(source === 'user'));
      return () => { off(); };
    },
  },
  storeTab({ id: 'wind', label: 'WIND', statusTitle: 'PLANETARY WIND (VISUAL)', sliders: WIND_SLIDERS, head: WIND_HEAD }, {
    isOn: isWindOn, setOn: setWind, toggle: toggleWind, get: getWindParams, set: setWindParams, reset: resetWindParams, onChange: onWindChange,
  }),
  storeTab({ id: 'water', label: 'WATER', statusTitle: 'WATER SURFACE & FAUNA', sliders: WATER_SLIDERS }, {
    isOn: isWaterFxOn, setOn: setWaterFx, toggle: toggleWaterFx, get: getWaterParams, set: setWaterParams,
    reset: resetWaterParams, onChange: onWaterChange,
  }),
  // ON/OFF = PERF OPTIMISATIONS (OFF = native DPR, view focus off, secondary shadow always on: the A/B baseline).
  storeTab({ id: 'perf', label: 'PERF', statusTitle: 'PERF OPTIMISATIONS', sliders: PERF_SLIDERS, head: PERF_HEAD }, {
    isOn: isPerfOn, setOn: setPerf, toggle: togglePerf, get: getPerfParams, set: setPerfParams, reset: resetPerfParams,
    onChange: onPerfChange,
  }),
];

export const DEFAULT_VISUAL_TAB: VisualTabId = 'shadow';

/** The tab with `id`, or the default tab for an unknown id (e.g. a stale saved tab). */
export function getVisualLabTab(id: string | null | undefined): VisualLabTab {
  return VISUAL_LAB_TABS.find((t) => t.id === id) ?? VISUAL_LAB_TABS.find((t) => t.id === DEFAULT_VISUAL_TAB)!;
}
