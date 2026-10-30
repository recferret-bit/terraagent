// Shared lifecycle for live stages (WebGL viewports, 2D canvases): one rAF loop gated by IntersectionObserver visibility,
// a clamped dt, optional ResizeObserver, and the reduced-motion switch (no loop: callers render still frames themselves).
export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export interface StageHostOptions {
  elements: Element[];
  onFrame(dt: number, time: number): void;
  onResize?(): void;          // ResizeObserver on the first element
  maxDt?: number;             // seconds, default 0.05
  threshold?: number;
  reduced?: boolean;          // default: prefers-reduced-motion
}

export class StageHost {
  readonly reduced: boolean;
  time = 0;
  private visibility = new Map<Element, boolean>();
  private last = performance.now();

  constructor(private readonly o: StageHostOptions) {
    this.reduced = o.reduced ?? prefersReducedMotion();
    o.elements.forEach((el) => this.visibility.set(el, true));
  }

  isVisible(el: Element) { return this.visibility.get(el) !== false; }
  get visible() { return [...this.visibility.values()].some(Boolean); }

  start() {
    const { elements, onResize, threshold } = this.o;
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => {
        es.forEach((e) => this.visibility.set(e.target, e.isIntersecting));
        this.last = performance.now(); // no dt spike when a stage scrolls back into view
      }, threshold === undefined ? undefined : { threshold });
      elements.forEach((el) => io.observe(el));
    }
    if (onResize && elements[0]) new ResizeObserver(onResize).observe(elements[0]);
    if (!this.reduced) requestAnimationFrame(this.loop);
    return this;
  }

  /** Render one frame by hand (reduced-motion stills, layout changes). */
  renderOnce(dt = 0, time = this.time) { this.o.onFrame(dt, time); }

  private loop = (now: number) => {
    requestAnimationFrame(this.loop);
    const dt = clamp((now - this.last) / 1000, 0, this.o.maxDt ?? 0.05);
    this.last = now;
    if (!this.visible) return;
    this.time += dt;
    this.o.onFrame(dt, this.time);
  };
}
