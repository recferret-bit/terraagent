import '../design/css/tokens.css';
import '../design/css/base.css';
import './trade.css';
import { TradeClient } from './api/client';
import { consumeMockToken, mockOauthUrl, refreshSession, resolveIdentity, type Identity } from './api/identity';
import { TradePage } from './TradePage';
import { h, note } from './view/dom';

async function identify(): Promise<Identity | null> {
  const fromHash = await consumeMockToken(location.hash);
  if (fromHash) { history.replaceState(null, '', location.pathname + location.search); return fromHash; }
  return resolveIdentity(location.search, location.hash) ?? (await refreshSession());
}

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;
  const who = await identify();
  if (!who) {
    // unauthenticated visitors sign in through the mock OAuth page and come back here
    location.replace(mockOauthUrl(location.pathname + location.search));
    return;
  }
  const client = new TradeClient(who.token);
  const start = TradePage.startFrom(location.search);
  const planetId = start.planetId || (await client.devPlanets())[0] || '';
  const page = new TradePage(root, client, who.label, { ...start, planetId });
  if (!planetId) {
    root.replaceChildren(h('main', { class: 'tr-page' }, note('Enter the id of a planet you play on (the id is shown by the dev console command "planet"): add ?planet=<id> to the address.', 'warn')));
    return;
  }
  await page.mount();
  (window as unknown as { __trade: unknown }).__trade = page;
}

void boot();
