import type { FeatureContext, HudPanelInstance } from '../../core/registry/types';
import { makeBtn, makeDiv, makeSpan } from '../shared/dom';
import { copyText, type TextClipboard } from './copyText';
import { readMockToken } from './mockToken';

const FAULT = 'That sign-in could not be confirmed.';

/** Opens the dev mock screen in a popup. The return path is this page, so a direct visit can still redirect. */
export function openMockProvider(provider: 'google' | 'x'): Window | null {
  const ret = encodeURIComponent(location.pathname + location.search);
  return window.open(`/dev/mock-oauth?provider=${provider}&return=` + ret, 'terra-mock-oauth', 'popup,width=480,height=640');
}

function guestLine(onSave: () => void): HTMLElement {
  const line = makeDiv('ta-pilot__line');
  const dot = makeSpan('ta-pilot__dot', undefined, '·');
  dot.setAttribute('aria-hidden', 'true');
  line.append(
    makeSpan('ta-pilot__label', undefined, 'Guest pilot'),
    dot,
    makeBtn('btn btn-primary btn-sm', 'save-progress', 'Save progress', onSave),
  );
  return line;
}

function guestNodes(open: boolean, fault: string, act: { save(): void; google(): void; x(): void }): HTMLElement[] {
  const nodes: HTMLElement[] = [guestLine(act.save)];
  if (!open) return nodes;
  const plate = makeDiv('ta-pilot__plate plate');
  plate.append(
    makeBtn('btn btn-primary btn-sm', 'continue-google', 'Continue with Google (mock)', act.google),
    makeBtn('btn btn-ghost btn-sm', 'continue-x', 'Continue with X (mock)', act.x),
  );
  if (fault) {
    const note = document.createElement('p');
    note.className = 'ta-pilot__fault';
    note.textContent = fault;
    plate.append(note);
  }
  nodes.push(plate);
  return nodes;
}

/** Selection is only a fallback when the write is refused. A thrown selection must not escape the click. */
function selectContents(node: HTMLElement): void {
  try {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    /* the data-copied attribute already records the miss */
  }
}

function linkedLine(accountId: string, clipboard?: TextClipboard): HTMLElement {
  const line = makeDiv('ta-pilot__line');
  const id = makeSpan('ta-pilot__id', 'pilot-id', `Pilot ID ${accountId}`);
  const copy = makeBtn('btn btn-ghost btn-sm', 'pilot-copy', 'Copy', () => {
    void copyText(accountId, clipboard).then((result) => {
      copy.setAttribute('data-copied', result);
      if (result === 'fail') selectContents(id);
    });
  });
  line.append(id, copy);
  return line;
}

/** Top-left pilot chip. Subscribes to `services.pilot` and re-renders; no page reload. */
export function mountPilotChip(el: HTMLElement, ctx: FeatureContext): HudPanelInstance {
  const pilot = ctx.services.pilot;
  const clipboard = ctx.services.clipboard;
  const root = makeDiv('ta-pilot plate-sm', 'pilot-chip');
  el.appendChild(root);
  let open = false;
  let fault = '';
  let busy = false;
  let popup: Window | null = null;

  const render = (): void => {
    const view = pilot?.view();
    root.replaceChildren();
    if (view?.accountId && !view.isGuest) {
      root.append(linkedLine(view.accountId, clipboard));
      return;
    }
    root.append(...guestNodes(open, fault, {
      save: () => { open = true; render(); },
      google: () => { if (!busy) popup = openMockProvider('google'); },
      x: () => { if (!busy) popup = openMockProvider('x'); },
    }));
  };

  const onMessage = (event: MessageEvent): void => {
    const hit = readMockToken(event, popup, location.origin);
    if (!hit || !pilot || busy) return;
    busy = true;
    void pilot.loginSocial(hit.provider, hit.token).then(() => { fault = ''; }, () => { fault = FAULT; open = true; })
      .finally(() => { busy = false; render(); });
  };

  window.addEventListener('message', onMessage);
  const off = pilot?.subscribe(() => render());
  render();
  return {
    dispose() {
      off?.();
      window.removeEventListener('message', onMessage);
      root.remove();
    },
  };
}
