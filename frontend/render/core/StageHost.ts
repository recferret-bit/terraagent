// Shared lifecycle for live stages (WebGL viewports, 2D canvases): one rAF loop gated by IntersectionObserver visibility,
// a clamped dt, optional ResizeObserver, and the reduced-motion switch (no loop: callers render still frames themselves).
import { createFramePacer, type FramePacer } from './framePacer';

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  private pacer: FramePacer;
  private rafId = 0;
  private io: IntersectionObserver | null = null;
  private ro: ResizeObserver | null = null;
  private disposed = false;

  constructor(private readonly o: StageHostOptions) {
    this.reduced = o.reduced ?? prefersReducedMotion();
    this.pacer = createFramePacer({ maxDt: o.maxDt ?? 0.05 });
    o.elements.forEach((el) => this.visibility.set(el, true));
  }

  isVisible(el: Element) { return this.visibility.get(el) !== false; }
  get visible() { return [...this.visibility.values()].some(Boolean); }

  start() {
    if (this.disposed) return this;
    const { elements, onResize, threshold } = this.o;
    if ('IntersectionObserver' in window) {
      this.io = new IntersectionObserver((es) => {
        es.forEach((e) => this.visibility.set(e.target, e.isIntersecting));
        this.pacer.reset(performance.now()); // no dt spike when a stage scrolls back into view
      }, threshold === undefined ? undefined : { threshold });
      elements.forEach((el) => this.io!.observe(el));
    }
    if (onResize && elements[0] && 'ResizeObserver' in window) {
      this.ro = new ResizeObserver(onResize);
      this.ro.observe(elements[0]);
    }
    if (!this.reduced) this.rafId = requestAnimationFrame(this.loop);
    return this;
  }

  /** Render one frame by hand (reduced-motion stills, layout changes). */
  renderOnce(dt = 0, time = this.time) { this.o.onFrame(dt, time); }

  dispose() {
    this.disposed = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.io?.disconnect();
    this.io = null;
    this.ro?.disconnect();
    this.ro = null;
  }

  private loop = (now: number) => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    if (!this.visible) {
      this.pacer.reset(now);
      return;
    }
    const dt = this.pacer.next(now);
    if (dt === null) return;
    this.time += dt;
    this.o.onFrame(dt, this.time);
  };
}
