import '../design/css/tokens.css';
import '../design/css/base.css';
import './trade.css';
import { PilotAccess } from '../design/pilot/PilotAccess';
import { TradeClient } from './api/client';
import {
  consumeMockToken,
  mockOauthUrl,
  probeTradeAuthMode,
  refreshSession,
  resolveIdentity,
  signOut,
  type Identity,
} from './api/identity';
import { TradePage } from './TradePage';
import { h, note } from './view/dom';

let activePromptAuth: PilotAccess | null = null;

async function identify(): Promise<Identity | null> {
  const fromHash = await consumeMockToken(location.hash);
  if (fromHash) { history.replaceState(null, '', location.pathname + location.search); return fromHash; }
  const params = new URLSearchParams(location.search);
  if (params.has('playerId') || params.has('as')) {
    return resolveIdentity(location.search, location.hash);
  }
  return (await refreshSession()) ?? resolveIdentity(location.search, location.hash);
}

function renderTradeAuthPrompt(root: HTMLElement, onAuthenticated: () => void, skipRestore = false): void {
  activePromptAuth?.dispose();
  activePromptAuth = null;
  const authHost = h('div', { class: 'tr-row' });
  activePromptAuth = new PilotAccess(authHost, {
    triggerLabel: 'Sign in / Sign up',
    skipRestore,
    onAuthChange: (session) => {
      if (session) onAuthenticated();
    },
  });
  authHost.append(h('a', { class: 'btn btn-ghost btn-sm', href: '/landing.html' }, '◂ Landing'));

  const promptPanel = h(
    'section',
    { class: 'tr-panel', 'data-testid': 'trade-auth-prompt' },
    h('div', { class: 'tr-panel-head' }, h('h2', { class: 'tr-h' }, 'Sign in or Sign up to Trade')),
    h(
      'div',
      { class: 'tr-body' },
      note('Sign in with Google, X, or your NEAR Wallet to view live orderbooks, manage bot keys, and trade orbital cargo.', 'warn'),
      authHost,
    ),
  );

  root.replaceChildren(
    h(
      'div',
      { class: 'tr-page' },
      h(
        'header',
        { class: 'tr-top' },
        h('div', { class: 'tr-brand' }, h('a', { href: '/', class: 'tr-back' }, 'TERRA', h('b', {}, 'AGENT')), h('h1', { class: 'tr-title' }, 'TRADE')),
        h('nav', { class: 'tr-links', 'aria-label': 'Related pages' }, h('a', { href: '/play.html' }, 'Game'), h('a', { href: '/me.html' }, 'Profile')),
      ),
      promptPanel,
    ),
  );
}

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;
  activePromptAuth?.dispose();
  activePromptAuth = null;

  const hasWalletCallback =
    location.search.includes('state=terra-pkce:') ||
    location.search.includes('state=terra-fastauth') ||
    location.hash.includes('signature=') ||
    location.search.includes('signature=');
  const who = hasWalletCallback ? null : await identify();
  if (!who) {
    const mode = hasWalletCallback ? 'testnet' : await probeTradeAuthMode();
    if (mode === 'mock') {
      location.replace(mockOauthUrl(location.pathname + location.search));
      return;
    }
    renderTradeAuthPrompt(
      root,
      () => {
        void boot();
      },
      !hasWalletCallback,
    );
    return;
  }

  const client = new TradeClient(who.token);
  const start = TradePage.startFrom(location.search);
  const planetId = start.planetId || (await client.devPlanets())[0] || '';
  const page = new TradePage(root, client, who.label, {
    ...start,
    planetId,
    onSignOut: () => {
      signOut();
      void probeTradeAuthMode().then((mode) => {
        if (mode === 'mock') location.assign(mockOauthUrl(location.pathname));
        else void boot();
      });
    },
  });
  if (!planetId) {
    root.replaceChildren(h('main', { class: 'tr-page' }, note('Enter the id of a planet you play on (the id is shown by the dev console command "planet"): add ?planet=<id> to the address.', 'warn')));
    return;
  }
  await page.mount();
  (window as unknown as { __trade: unknown }).__trade = page;
}

void boot();
