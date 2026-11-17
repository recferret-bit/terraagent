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

const DEFAULT_PUBLIC_PLANET = 'pl_01JKHAR0NDVNEST00000000000';

let activePromptAuth: PilotAccess | null = null;
let activeTradePage: TradePage | null = null;

async function identify(): Promise<Identity | null> {
  const fromHash = await consumeMockToken(location.hash);
  if (fromHash) { history.replaceState(null, '', location.pathname + location.search); return fromHash; }
  const params = new URLSearchParams(location.search);
  if (params.has('playerId') || params.has('as')) {
    return resolveIdentity(location.search, location.hash);
  }
  return (await refreshSession()) ?? resolveIdentity(location.search, location.hash);
}

function createPublicAuthSlot(onAuthenticated: () => void, skipRestore = false): HTMLElement {
  activePromptAuth?.dispose();
  activePromptAuth = null;
  const authHost = h('div', { class: 'tr-row', 'data-testid': 'trade-auth-prompt' });
  activePromptAuth = new PilotAccess(authHost, {
    triggerLabel: 'Sign in / Sign up',
    skipRestore,
    onAuthChange: (session) => {
      if (session) onAuthenticated();
    },
  });
  return authHost;
}

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;
  activePromptAuth?.dispose();
  activePromptAuth = null;
  activeTradePage?.dispose();
  activeTradePage = null;

  const params = new URLSearchParams(location.search);
  const wantPublic = params.get('public') === '1';
  const hasWalletCallback =
    location.search.includes('state=terra-pkce:') ||
    location.search.includes('state=terra-fastauth') ||
    location.hash.includes('signature=') ||
    location.search.includes('signature=');
  const who = hasWalletCallback ? null : await identify();
  let authSlot: HTMLElement | undefined;
  if (!who) {
    const mode = hasWalletCallback ? 'testnet' : await probeTradeAuthMode();
    if (mode === 'mock' && !wantPublic) {
      location.replace(mockOauthUrl(location.pathname + location.search));
      return;
    }
    authSlot = createPublicAuthSlot(() => {
      void boot();
    }, !hasWalletCallback);
  }

  const client = new TradeClient(who?.token ?? '');
  const explicitPlanet = params.get('planet')?.trim() ?? '';
  const planets = await client.devPlanets();
  const start = TradePage.startFrom(location.search);
  const planetId =
    explicitPlanet ||
    (start.planetId && (planets.length === 0 || planets.includes(start.planetId)) ? start.planetId : '') ||
    planets[0] ||
    DEFAULT_PUBLIC_PLANET;
  if (!explicitPlanet && start.planetId && start.planetId !== planetId) {
    try { localStorage.setItem('ta_trade_planet', planetId); } catch { /* storage is optional */ }
  }
  const page = new TradePage(root, client, who?.label ?? '', {
    ...start,
    planetId,
    authSlot,
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
  activeTradePage = page;
  await page.mount();
  (window as unknown as { __trade: unknown }).__trade = page;
}

void boot();
