/** Lightweight motion and scalar helpers with zero WebGL/Three.js dependencies. */
export const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
