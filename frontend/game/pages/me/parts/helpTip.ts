import { el } from '../dom';
import './helpTip.css';

export interface HelpTipOptions {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly body?: HTMLElement | null;
  readonly openOnHover?: boolean;
  readonly floating?: boolean;
  readonly wide?: boolean;
  readonly hoverTrigger?: HTMLElement | null;
  readonly buttonTestId?: string;
  readonly buttonTitle?: string;
}

export interface HelpTipPair {
  readonly button: HTMLButtonElement;
  readonly panel: HTMLElement;
  open(): void;
  close(): void;
}

interface ActiveTip {
  readonly key: string;
  readonly button: HTMLButtonElement;
  readonly panel: HTMLElement;
  readonly hoverTrigger: HTMLElement | null;
  wasConnected: boolean;
  close(): void;
}

let activeTip: ActiveTip | null = null;
let listenersBound = false;
let uidSeq = 0;
const reopenFns = new WeakMap<HTMLButtonElement, () => void>();

function isUnmountedActiveTip(tip: ActiveTip): boolean {
  if (tip.button.isConnected) {
    tip.wasConnected = true;
    return false;
  }
  return tip.wasConnected;
}

function ensureGlobalDismissListeners(): void {
  if (listenersBound || typeof document === 'undefined') return;
  listenersBound = true;
  document.addEventListener('click', (e) => {
    if (!activeTip) return;
    if (isUnmountedActiveTip(activeTip)) { activeTip = null; return; }
    const target = e.target as Node | null;
    if (
      target &&
      (activeTip.button.contains(target) ||
        activeTip.panel.contains(target) ||
        (activeTip.hoverTrigger !== null && activeTip.hoverTrigger.contains(target)))
    ) {
      return;
    }
    activeTip.close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !activeTip) return;
    if (isUnmountedActiveTip(activeTip)) { activeTip = null; return; }
    const btn = activeTip.button;
    const focusInside = activeTip.panel.contains(document.activeElement);
    activeTip.close();
    if (focusInside && btn.isConnected) btn.focus();
  });
}

function positionFloatingPanel(anchorEl: HTMLElement, panel: HTMLElement, wide: boolean): void {
  if (typeof window === 'undefined' || !anchorEl.isConnected) return;
  const vw = window.innerWidth || 1024;
  const vh = window.innerHeight || 768;
  const margin = 12;
  const maxW = wide ? Math.min(760, Math.max(240, vw - margin * 2)) : Math.min(420, Math.max(240, vw - margin * 2));
  panel.style.maxWidth = `${maxW}px`;
  panel.style.maxHeight = `${Math.max(180, vh - margin * 2)}px`;
  const anchorRect = anchorEl.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const width = panelRect.width || maxW;
  const height = panelRect.height || 220;
  let left = anchorRect.left;
  if (left + width > vw - margin) left = Math.max(margin, anchorRect.right - width);
  if (left + width > vw - margin) left = vw - margin - width;
  left = Math.max(margin, left);
  const spaceBelow = vh - anchorRect.bottom - margin;
  const spaceAbove = anchorRect.top - margin;
  let top = anchorRect.bottom + 8;
  if (spaceBelow < height && spaceAbove > spaceBelow) {
    top = Math.max(margin, anchorRect.top - height - 8);
  } else if (top + height > vh - margin) {
    top = Math.max(margin, vh - margin - height);
  }
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

function showPopoverSafe(panel: HTMLElement): void {
  const pop = panel as HTMLElement & { showPopover?: () => void };
  if (typeof pop.showPopover === 'function' && panel.isConnected) {
    try { pop.showPopover(); } catch { /* detached or already open */ }
  }
}

function hidePopoverSafe(panel: HTMLElement): void {
  const pop = panel as HTMLElement & { hidePopover?: () => void };
  if (typeof pop.hidePopover === 'function') {
    try { pop.hidePopover(); } catch { /* detached or already closed */ }
  }
}

function wireHoverAndClick(
  opts: HelpTipOptions,
  button: HTMLButtonElement,
  panel: HTMLElement,
  closeBtn: HTMLButtonElement,
  open: (pinned: boolean) => void,
  close: () => void,
  state: { pinnedByClick: boolean },
): void {
  const triggerEl = opts.hoverTrigger ?? button;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  const clearCloseTimer = (): void => {
    if (closeTimer !== null) { clearTimeout(closeTimer); closeTimer = null; }
  };
  const scheduleHoverClose = (): void => {
    clearCloseTimer();
    closeTimer = setTimeout(() => {
      if (!state.pinnedByClick) close();
    }, 160);
  };

  if (opts.openOnHover) {
    const enterOpen = (): void => {
      clearCloseTimer();
      if (panel.hidden) open(false);
    };
    triggerEl.addEventListener('mouseenter', enterOpen);
    triggerEl.addEventListener('mouseleave', scheduleHoverClose);
    if (triggerEl !== button) {
      button.addEventListener('mouseenter', enterOpen);
      button.addEventListener('mouseleave', scheduleHoverClose);
    }
    panel.addEventListener('mouseenter', clearCloseTimer);
    panel.addEventListener('mouseleave', scheduleHoverClose);
  }

  const toggle = (e: Event): void => {
    e.stopPropagation();
    clearCloseTimer();
    if (panel.hidden) {
      open(true);
    } else if (opts.openOnHover && !state.pinnedByClick) {
      state.pinnedByClick = true;
    } else {
      close();
    }
  };

  button.addEventListener('click', toggle);
  if (opts.hoverTrigger && opts.hoverTrigger !== button) {
    opts.hoverTrigger.addEventListener('click', (e) => {
      if (button.contains(e.target as Node)) return;
      toggle(e);
    });
  }
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearCloseTimer();
    close();
    button.focus();
  });
  panel.addEventListener('click', (e) => e.stopPropagation());
}

/**
 * Builds a top-left `?` question button + toggleable (and optionally hover-triggered floating) tip panel.
 */
export function createBlockHelpTip(opts: HelpTipOptions): HelpTipPair {
  ensureGlobalDismissListeners();
  const panelDomId = `ta-help-tip-${opts.id}-${++uidSeq}`;
  const closeBtn = el(
    'button',
    {
      className: 'ta-help-tip-close',
      type: 'button',
      aria: { label: `Close ${opts.title} tip` },
      dataset: { testid: `help-tip-close-${opts.id}` },
    },
    '×',
  );
  const copy = el(
    'div',
    { className: 'ta-help-tip-copy' },
    el('span', { className: 'ta-help-tip-eyebrow' }, `TIP // ${opts.title}`),
    el('p', { className: 'ta-help-tip-text' }, opts.description),
    opts.body ?? null,
  );
  const panelClasses = ['ta-help-tip', 'plate-sm'];
  if (opts.floating) panelClasses.push('ta-help-tip--floating');
  if (opts.wide) panelClasses.push('ta-help-tip--wide');
  const panel = el(
    'div',
    {
      id: panelDomId,
      className: panelClasses.join(' '),
      role: 'region',
      aria: { label: `${opts.title} tip` },
      dataset: { testid: `help-tip-panel-${opts.id}` },
    },
    copy,
    closeBtn,
  );
  if (opts.floating) panel.setAttribute('popover', 'manual');
  panel.hidden = true;

  const button = el(
    'button',
    {
      className: 'ta-help-btn',
      type: 'button',
      title: opts.buttonTitle ?? `Tip: ${opts.title}`,
      aria: { label: `Show tip for ${opts.title}`, expanded: 'false', controls: panelDomId },
      dataset: { testid: opts.buttonTestId ?? `help-tip-btn-${opts.id}`, tipKey: opts.id },
    },
    '?',
  );

  const state = { pinnedByClick: false };
  const anchorEl = opts.hoverTrigger ?? button;
  const syncPosition = (): void => {
    if (opts.floating && !panel.hidden) positionFloatingPanel(anchorEl, panel, Boolean(opts.wide));
  };

  const close = (): void => {
    state.pinnedByClick = false;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (opts.floating) {
      hidePopoverSafe(panel);
      if (typeof window !== 'undefined') {
        window.removeEventListener('scroll', syncPosition, true);
        window.removeEventListener('resize', syncPosition);
      }
    }
    if (activeTip?.button === button) activeTip = null;
  };

  const open = (pinned = true): void => {
    if (activeTip && activeTip.button !== button) activeTip.close();
    state.pinnedByClick = pinned;
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    if (opts.floating) {
      showPopoverSafe(panel);
      positionFloatingPanel(anchorEl, panel, Boolean(opts.wide));
      if (typeof window !== 'undefined') {
        window.addEventListener('scroll', syncPosition, true);
        window.addEventListener('resize', syncPosition);
      }
    }
    activeTip = { key: opts.id, button, panel, hoverTrigger: opts.hoverTrigger ?? null, wasConnected: button.isConnected, close };
  };

  reopenFns.set(button, () => open(true));
  wireHoverAndClick(opts, button, panel, closeBtn, open, close, state);

  return { button, panel, open: () => open(true), close };
}

/** Returns the active help-tip key if the currently open tip lives inside `container`. */
export function getActiveHelpTipKeyIn(container: ParentNode): string | null {
  if (!activeTip) return null;
  if (isUnmountedActiveTip(activeTip)) {
    activeTip = null;
    return null;
  }
  const nodes = container.querySelectorAll<HTMLButtonElement>('[data-tip-key]');
  for (const b of nodes) {
    if (b === activeTip.button) return activeTip.key;
  }
  return null;
}

/** Re-opens a help-tip by key inside `container` after a re-render so live refreshes never snap tips shut. */
export function reopenHelpTipIn(container: ParentNode, key: string | null): void {
  if (!key) return;
  const btn = container.querySelector<HTMLButtonElement>(`[data-tip-key="${key}"]`);
  if (!btn || btn.getAttribute('aria-expanded') === 'true') return;
  const fn = reopenFns.get(btn);
  if (fn) fn();
  else btn.click();
}

/**
 * Convenience helper that wraps a block's top-left `?` button + title element (and optional right-side controls)
 * alongside the expandable tip panel directly underneath.
 */
export function buildBlockHeaderWithTip(
  tipOpts: HelpTipOptions,
  titleEl: HTMLElement,
  rightSlot?: HTMLElement | null,
): { readonly head: HTMLElement; readonly panel: HTMLElement; readonly tip: HelpTipPair } {
  const tip = createBlockHelpTip(tipOpts);
  const head = el(
    'div',
    { className: 'ta-help-head' },
    el('div', { className: 'ta-help-title-group' }, tip.button, titleEl),
    rightSlot ?? null,
  );
  return { head, panel: tip.panel, tip };
}
