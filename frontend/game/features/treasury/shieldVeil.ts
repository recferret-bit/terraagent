/** One full-viewport element. The glint is a CSS animation, so the frame loop does not allocate for it. */
export interface ShieldVeil {
  readonly el: HTMLElement;
  setActive(on: boolean): void;
  dispose(): void;
}

export function mountShieldVeil(host: HTMLElement): ShieldVeil {
  const el = host.ownerDocument.createElement('div');
  el.className = 'ta-shield-shimmer';
  el.dataset.testid = 'shield-shimmer';
  el.hidden = true;
  el.setAttribute('aria-hidden', 'true');
  host.insertBefore(el, host.firstChild);
  let active = false;
  return {
    el,
    setActive(on) {
      if (on === active) return;
      active = on;
      el.hidden = !on;
    },
    dispose() {
      el.remove();
    },
  };
}
