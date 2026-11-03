/**
 * Small persisted on/off + numeric-params store used by the F8 Visual Shader Lab tabs (wind, water).
 * One place for the URL flag, localStorage persistence, clamping and change listeners, so every new lab tab is a
 * declaration (defaults + ranges) instead of another copy of the same boilerplate.
 */
export interface LabStore<P extends object> {
  isOn(): boolean;
  setOn(on: boolean): boolean;
  toggle(): boolean;
  get(): Readonly<P>;
  set(patch: Partial<P>): Readonly<P>;
  reset(): Readonly<P>;
  /** Called on every change (on/off or params). Returns an unsubscribe function. */
  onChange(fn: (on: boolean, params: Readonly<P>) => void): () => void;
}

export interface LabStoreOptions<P extends object> {
  /** localStorage key for the on/off flag; `<key>.params.v<version>` holds the params. */
  key: string;
  version: number;
  /** URL query flag (`?<urlFlag>=1|0`) that overrides the saved on/off state. */
  urlFlag: string;
  defaultOn: boolean;
  defaults: Readonly<P>;
  /** Inclusive `[min, max]` per numeric key; values outside are clamped on `set`. */
  ranges: Readonly<Record<keyof P, readonly [number, number]>>;
  /**
   * Optional URL overrides of individual params (e.g. `?scale=1.5`), read once at start-up. They win over the saved
   * params for this page load only: nothing is persisted until the user edits a param.
   */
  urlParams?: (q: URLSearchParams) => Partial<P>;
}

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

function readUrlFlag(flag: string): boolean | null {
  try {
    const q = new URLSearchParams(location.search).get(flag);
    if (q === '0' || q === 'false') return false;
    if (q === '1' || q === 'true') return true;
  } catch { /* no location (tests / workers) */ }
  return null;
}

export function createLabStore<P extends object>(o: LabStoreOptions<P>): LabStore<P> {
  const paramsKey = `${o.key}.params.v${o.version}`;
  const clampPatch = (patch: Partial<P>): Partial<P> => {
    const out: Partial<P> = {};
    for (const k of Object.keys(patch) as (keyof P)[]) {
      const v = Number(patch[k]);
      const r = o.ranges[k];
      if (!r || !Number.isFinite(v)) continue;
      (out as Record<keyof P, number>)[k] = Math.min(r[1], Math.max(r[0], v));
    }
    return out;
  };
  const readParams = (): P => {
    const raw = safeGet(paramsKey);
    if (!raw) return { ...o.defaults };
    try { return { ...o.defaults, ...clampPatch(JSON.parse(raw) as Partial<P>) }; } catch { return { ...o.defaults }; }
  };
  const readUrlParams = (): Partial<P> => {
    if (!o.urlParams) return {};
    try { return clampPatch(o.urlParams(new URLSearchParams(location.search))); } catch { return {}; }
  };
  const saved = safeGet(o.key);
  let on = readUrlFlag(o.urlFlag) ?? (saved === null ? o.defaultOn : saved === '1');
  let params: P = { ...readParams(), ...readUrlParams() };
  const listeners = new Set<(on: boolean, params: Readonly<P>) => void>();
  const notify = () => listeners.forEach((fn) => fn(on, params));

  const store: LabStore<P> = {
    isOn: () => on,
    setOn(next) {
      if (on !== next) {
        on = next;
        safeSet(o.key, on ? '1' : '0');
        notify();
      }
      return on;
    },
    toggle: () => store.setOn(!on),
    get: () => params,
    set(patch) {
      params = { ...params, ...clampPatch(patch) };
      safeSet(paramsKey, JSON.stringify(params));
      notify();
      return params;
    },
    reset() {
      params = { ...o.defaults };
      safeSet(paramsKey, JSON.stringify(params));
      notify();
      return params;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
  return store;
}
