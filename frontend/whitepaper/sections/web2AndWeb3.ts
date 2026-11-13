import {
  AI_GUARDRAIL_ROWS,
  CONTRACT_ROWS,
  PORT_ROWS,
  WEB2_FEATURES,
  WEB3_FEATURES,
} from '../data/features';
import {
  createCallout,
  createFeatureGrid,
  createSectionShell,
  createTable,
  makeEl,
  makeFormattedEl,
} from './domHelpers';

export function buildWeb2AndWeb3Sections(): HTMLElement[] {
  const sec04 = createSectionShell(
    'sec-04',
    '04',
    'WEB2 RUNTIME & MARKETS',
    'Web2 Architecture: Deterministic Sim, Binary WS, ACID DB & CLOB Exchange',
    'Every sub-second colony action, orderbook match, worker snapshot, and economy stress test runs on a battle-tested TypeScript Web2 backbone with full offline Web Worker parity.',
  );
  const web2Grid = createFeatureGrid(WEB2_FEATURES);
  web2Grid.id = 'sub-web2-core';
  const surfacesHeading = makeEl('h3', 'wp-subsection-h3', 'Playable & Operational Web2 Surfaces');
  surfacesHeading.id = 'sub-web2-surfaces';

  sec04.append(
    web2Grid,
    surfacesHeading,
    createTable(
      ['Surface / Route', 'Runtime', 'Primary Purpose'],
      [
        ['/landing.html & /pitchdeck/', 'Vite MPA + Three.js Orbit', 'Interactive orbital planet showcase (`terraagent.fun`) & investor/judge pitch deck'],
        ['/play.html?planet=dune&skip=1', 'Browser + WebGL2 / WS', 'Live colony RTS with orbit menu, descent cinematics, `?host=local`, tilde (`~`) dev console & `F8` 7-Tab Shader Lab'],
        ['/trade.html', 'SSE + REST (/v1/trade/*)', '90-pair planetary CLOB orderbook, depth ladder, swaps, `0–100 bp` stall royalties & `ta_bot_...` keys'],
        ['/me.html', 'REST (/v1/me/*)', 'Stage `S0–S10` progress, achievement badges, colony history & `AES-256-GCM` NEAR.AI BYOK vault'],
        ['/deed.html (/deed/:tokenId)', 'SSR / Canvas + OpenGraph PNG', 'Shareable soulbound `NEP-171` colony milestone chronicle & immutable event timeline'],
        ['/dev/economy-sim/', 'Headless @terra/sim runner', '7-day 3-colony economy stress test covering wars, truces, Guild AMM & NEAR.AI TEE decisions'],
        ['/playground.html & /design/', '3D Storybook & Faction Plate', '4-view diagnostic turntable (`&validate=1`), particle/model validators & Faction Plate tokens'],
      ],
    ),
  );

  const sec05 = createSectionShell(
    'sec-05',
    '05',
    'WEB3 ON NEAR PROTOCOL',
    'Web3 Architecture: Six Rust Contracts, Eleven Typed Ports & Protocol Economy',
    'Six `near-sdk 5.7` contracts (`res`, `deed`, `bounty`, `staking`, `dao`, `pilots`) sit behind 11 clean backend ports so the entire application swaps seamlessly between `mock`, `testnet` and `mainnet`.',
  );
  const contractsHeading = makeFormattedEl('h3', 'wp-subsection-h3', 'Six Rust Smart Contracts (`backend/near-contracts`)');
  contractsHeading.id = 'sub-web3-contracts';
  const portsHeading = makeFormattedEl('h3', 'wp-subsection-h3', 'Eleven Typed NEAR Ports (`backend/app/src/near/application/ports`)');
  portsHeading.id = 'sub-web3-ports';
  const settlementHeading = makeEl('h3', 'wp-subsection-h3', '4-Way Trade Settlement (D-44) & Protocol Treasury Flows');
  settlementHeading.id = 'sub-web3-settlement';

  sec05.append(
    createFeatureGrid(WEB3_FEATURES),
    contractsHeading,
    createTable(
      ['Contract', 'Standard / Pattern', 'On-Chain Responsibility', 'Safety & Settlement Rule'],
      CONTRACT_ROWS.map((c) => [c.contract, c.standard, c.role, c.guardAndSettlement]),
    ),
    portsHeading,
    createTable(
      ['Port Interface', 'Domain', 'Mock Driver (`?mock` / Local)', 'Live NEAR Driver'],
      PORT_ROWS.map((p) => [p.port, p.category, p.mockBehavior, p.liveImplementation]),
    ),
    settlementHeading,
    createTable(
      ['Recipient', 'Allocation', 'Source Trigger', 'Economic Purpose'],
      [
        ['Seller / Maker', '`100%` clearing proceeds', 'CLOB / Trade Hub match', 'Direct player-to-player resource revenue'],
        ['Trade Hub Owner (Stall)', '`0–100 bp` configurable royalty', 'Physical hub tile visit', 'Rewards colony logistics infrastructure'],
        ['Protocol & Planet DAO', '`100 bp` (`50 bp` staker) split `80%` Protocol / `20%` DAO', 'All orbital & planetary trades', 'Funds `NEP-366` gas relayer, Managed `NEAR.AI` & Planet Council DAO'],
        ['Lossless Staker Pool', '`80%` Staker (`7.2%` APY) / `20%` Protocol (`1.8%` APY)', 'Active `>= 10 NEAR` validator stake', 'Unlocks Managed `NEAR.AI` + `50%` fee cut (`100%` principal safe, zero P2W)'],
      ],
    ),
    createCallout(
      'protocol.terraagent.* Non-Dilutive Treasury Flow',
      'Treasury inflows come strictly from three organic sources: (1) `80%` of platform trade fees (`80 bp` standard / `40 bp` staker, with `20%` going to the Planet Council DAO), (2) `20%` validator staking yield split (`1.80%` APY slice), and (3) `10%` slashed Peace Treaty / `6h` War Bond escrow fee (`90%` paid to betrayed ally or war defender). Outflows sponsor `relayer.terraagent.*` `NEP-366` gasless meta-transactions and Managed `NEAR.AI` Cloud TEE Autopilot.',
    ),
  );

  const sec06 = createSectionShell(
    'sec-06',
    '06',
    'NEAR.AI TEE AUTONOMY',
    'Verifiable AI Commanders, Encrypted BYOK Vault & Hard Guardrails',
    'Players can appoint an autonomous NEAR.AI Colony Commander backed by hardware Trusted Execution Environment signatures while preserving hard mathematical barriers between tactical automation and custody funds.',
  );
  sec06.append(
    createTable(
      ['Security Control', 'Activation Path', 'Hard Enforcement Mechanism'],
      AI_GUARDRAIL_ROWS.map((a) => [a.control, a.trigger, a.enforcement]),
    ),
    createCallout(
      'Cryptographic Decision Trail',
      'Every autonomous turn captures the model digest (`z-ai/glm-5.3-flash` or player BYOK selection), signed TEE payload via `/v1/signature/{chat_id}`, `intentRevision` sequence check, and Resulting Sim Action inside PostgreSQL so human players can replay and verify every AI decision.',
    ),
  );

  return [sec04, sec05, sec06];
}
