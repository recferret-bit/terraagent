export type ViewportPreset = 'auto' | '2560x1440' | '1920x1080' | '1280x720';

export const VIEWPORT_PRESETS: Record<ViewportPreset, { label: string; width: number; height: number } | null> = {
  auto: null,
  '2560x1440': { label: '2560×1440', width: 2560, height: 1440 },
  '1920x1080': { label: '1920×1080', width: 1920, height: 1080 },
  '1280x720': { label: '1280×720', width: 1280, height: 720 },
};

const OPT_KEY = 'terraagent.opt';
const RES_KEY = 'terraagent.res';

function readInitialOpt(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('opt');
    if (q === '0' || q === 'false') return false;
    if (q === '1' || q === 'true') return true;
    const saved = localStorage.getItem(OPT_KEY);
    return saved === null ? true : saved === '1';
  } catch { return true; }
}

function readInitialPreset(): ViewportPreset {
  try {
    const q = new URLSearchParams(location.search).get('res') as ViewportPreset | null;
    if (q && q in VIEWPORT_PRESETS) return q;
    const saved = localStorage.getItem(RES_KEY) as ViewportPreset | null;
    if (saved && saved in VIEWPORT_PRESETS) return saved;
  } catch { /* ignore */ }
  return 'auto';
}

let optimized = readInitialOpt();
let preset: ViewportPreset = readInitialPreset();
const listeners = new Set<(opt: boolean, res: ViewportPreset) => void>();

const notify = () => listeners.forEach((fn) => fn(optimized, preset));

export const isShaderOptimized = (): boolean => optimized;
export const getViewportPreset = (): ViewportPreset => preset;
export const getPresetDimensions = (p: ViewportPreset = preset) => VIEWPORT_PRESETS[p];

export function setShaderOptimized(v: boolean): boolean {
  if (optimized === v) return optimized;
  optimized = v;
  try { localStorage.setItem(OPT_KEY, v ? '1' : '0'); } catch { /* private mode */ }
  notify();
  return optimized;
}

export function setViewportPreset(p: ViewportPreset): ViewportPreset {
  if (!(p in VIEWPORT_PRESETS) || preset === p) return preset;
  preset = p;
  try { localStorage.setItem(RES_KEY, p); } catch { /* private mode */ }
  notify();
  return preset;
}

export function onPerfConfigChange(fn: (opt: boolean, res: ViewportPreset) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
