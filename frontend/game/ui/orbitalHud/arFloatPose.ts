export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** C1-smooth quintic wave that glides in 3D then hovers weightlessly at apex/trough (~0.9s dwell). */
export function gyroDwellWave(u: number): number {
  const s = Math.sin(u);
  const a = Math.abs(s);
  if (a >= 0.78) return Math.sign(s);
  const x = a / 0.78;
  const smooth = x * x * x * (x * (x * 6 - 15) + 10);
  return Math.sign(s) * smooth;
}

export function clampAxis(v: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, v));
}

export function dampPtr(current: number, target: number): number {
  if (Math.abs(target - current) < 0.012) return target;
  return current + (target - current) * 0.25;
}

export function floatTransform(
  tx: number,
  ty: number,
  tz: number,
  ry: number,
  rx: number,
  rz: number,
): string {
  return (
    `perspective(780px) translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, ${tz.toFixed(2)}px) ` +
    `rotateY(${ry.toFixed(2)}deg) rotateX(${rx.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg)`
  );
}

/** Y travel stays inside the rail gap so the blue card and the orange sector card cannot cross. */
export function poseFloatWrap(
  wrap: HTMLDivElement,
  t: number,
  phase: number,
  amp: number,
  px: number,
  py: number,
  baseRy: number,
  baseRx: number,
  baseRz: number,
  hovered: boolean,
): void {
  const rotSin = Math.sin(t * 0.24 + phase);
  const rotCos = Math.cos(t * 0.48 + phase);
  const tx = clampAxis(rotSin * 3.8 * amp - px * 8 * amp, 10);
  const ty = clampAxis(rotCos * 4.2 * amp + py * 4 * amp, 5);
  const tz = rotCos * 12 * amp + (hovered ? 12 : 0);
  const ry = baseRy + rotSin * 2.4 * amp + px * 3.2;
  const rx = baseRx + rotCos * 1.2 * amp + py * 1.6;
  const rz = baseRz + rotSin * 0.45 * amp;
  wrap.style.transform = floatTransform(tx, ty, tz, ry, rx, rz);
}

export function createFloatWrapper(wrapClass: string): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = `ar-float-wrap ${wrapClass}`;
  const back = document.createElement('div');
  back.className = 'ar-holo-back plate';
  back.setAttribute('aria-hidden', 'true');
  wrap.appendChild(back);
  return wrap;
}
