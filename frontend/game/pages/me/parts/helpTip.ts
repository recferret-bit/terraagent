import { el } from '../dom';
import './helpTip.css';

export interface HelpTipOptions {
  readonly id: string;
  readonly title: string;
  readonly description: string;
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
  wasConnected: boolean;
  close(): void;
}

let activeTip: ActiveTip | null = null;
let listenersBound = false;
let uidSeq = 0;

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
    if (target && (activeTip.button.contains(target) || activeTip.panel.contains(target))) return;
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

/**
 * Builds a top-left `?` question button + toggleable tip readout panel for Staking and AI blocks on `/me.html`.
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

  const panel = el(
    'div',
    {
      id: panelDomId,
      className: 'ta-help-tip plate-sm',
      role: 'region',
      aria: { label: `${opts.title} tip` },
      dataset: { testid: `help-tip-panel-${opts.id}` },
    },
    el(
      'div',
      { className: 'ta-help-tip-copy' },
      el('span', { className: 'ta-help-tip-eyebrow' }, `TIP // ${opts.title}`),
      el('p', { className: 'ta-help-tip-text' }, opts.description),
    ),
    closeBtn,
  );
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

  const close = (): void => {
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (activeTip?.button === button) activeTip = null;
  };

  const open = (): void => {
    if (activeTip && activeTip.button !== button) activeTip.close();
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    activeTip = { key: opts.id, button, panel, wasConnected: button.isConnected, close };
  };

  const toggle = (e: Event): void => {
    e.stopPropagation();
    if (panel.hidden) open();
    else close();
  };

  button.addEventListener('click', toggle);
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    close();
    button.focus();
  });
  panel.addEventListener('click', (e) => e.stopPropagation());

  return { button, panel, open, close };
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
  if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();
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
