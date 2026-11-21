// Shared lifecycle for live stages (WebGL viewports, 2D canvases): one rAF loop gated by IntersectionObserver visibility,
// document visibility, and content-visibility auto state, plus a clamped dt, optional ResizeObserver, and reduced-motion switch.
import { createFramePacer, type FramePacer } from './framePacer';
import { prefersReducedMotion } from './motionUtils';

export { clamp, prefersReducedMotion } from './motionUtils';

export interface StageHostOptions {
  elements: Element[];
  onFrame(dt: number, time: number): void;
  onResize?(): void;          // ResizeObserver on the first element
  maxDt?: number;             // seconds, default 0.05
  threshold?: number;
  reduced?: boolean;          // default: prefers-reduced-motion
}

interface ContentVisibilityEvent extends Event {
  readonly skipped?: boolean;
}

export class StageHost {
  readonly reduced: boolean;
  time = 0;
  private visibility = new Map<Element, boolean>();
  private cvSkipped = new Map<Element, boolean>();
  private docHidden = typeof document !== 'undefined' && document.hidden;
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

  isVisible(el: Element) {
    return !this.docHidden && this.visibility.get(el) !== false && !this.cvSkipped.get(el);
  }

  get visible() {
    return !this.docHidden && this.o.elements.some((el) => this.isVisible(el));
  }

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
    if (typeof document !== 'undefined') {
      this.docHidden = Boolean(document.hidden);
      document.addEventListener('visibilitychange', this.onVisibilityChange);
      document.addEventListener('contentvisibilityautostatechange', this.onCvAutoStateChange, { capture: true });
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
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      document.removeEventListener('contentvisibilityautostatechange', this.onCvAutoStateChange, { capture: true });
    }
  }

  private readonly onVisibilityChange = () => {
    this.docHidden = typeof document !== 'undefined' && Boolean(document.hidden);
    this.pacer.reset(typeof performance !== 'undefined' ? performance.now() : 0);
  };

  private readonly onCvAutoStateChange = (event: Event) => {
    const target = event.target as Element | null;
    if (!target) return;
    const skipped = Boolean((event as ContentVisibilityEvent).skipped);
    let touched = false;
    for (const el of this.o.elements) {
      if (el === target || (typeof target.contains === 'function' && target.contains(el))) {
        this.cvSkipped.set(el, skipped);
        touched = true;
      }
    }
    if (touched) {
      this.pacer.reset(typeof performance !== 'undefined' ? performance.now() : 0);
    }
  };

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
