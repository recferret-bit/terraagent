// Build-time SEO pre-renderer & JSON-LD structured data builder for landing.html.
import { renderContractsBoardHtml } from './sections/contractsBoard';
import { renderDirectorScenariosHtml } from './sections/directorTemplates';
import { renderEconomicsBoardHtml } from './sections/economicsTemplates';
import { renderProtocolBoardHtml } from './sections/protocolTemplates';

const LANDING_JSON_LD_MARKER = 'data-terra-landing-ld';

function buildFaqEntities(): Array<Record<string, unknown>> {
  return [
    {
      '@type': 'Question',
      name: 'What happens to my colony when I close the tab?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'It keeps running on the server. The rule engine follows your last priorities, the AI Director handles emergencies, and builders repair what storms break. Next time you open the game you land straight in your colony.',
      },
    },
    {
      '@type': 'Question',
      name: 'How do multiple colonies and NEAR.AI slots work?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Free and Tier 1 (10 NEAR) pilots command 1 active colony at a time. Staking 50 / 200 / 500+ NEAR unlocks 3 / 6 / 12 NEAR.AI colony slots so you can expand onto multiple planets or multiple distinct sectors of the same planet (never two colonies in the same sector), all managed on GLM 5.3 Flash.',
      },
    },
    {
      '@type': 'Question',
      name: 'Do I need a crypto wallet?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'No. You start as a guest, and verified accounts get 5 free NEAR.AI TEE turns. Connecting a NEAR wallet is optional and unlocks self-custody withdrawals plus wallet-first 4-Tier Staking on /me.html#staking with no Colony Deed required.',
      },
    },
    {
      '@type': 'Question',
      name: 'How do players earn, and what pays for gas and AI?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Sell refined cargo on /trade.html, collect 0–1.00% stall fees at your Trade Hub, run automated trading bots, or claim defense bounties and 90% treaty/war bond slashes. Real trade activity, 20% of validator staking yield, and 10% bond slashes cover gas and AI—never an inflationary reward token.',
      },
    },
    {
      '@type': 'Question',
      name: 'How do staking profits, warmup, and unstaking rules work?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Stake native NEAR, stNEAR, or LiNEAR on /me.html#staking with no Colony Deed required. You keep 100% of principal plus 80% of validator yield (7.20% simulated net APY on testnet; live APY on mainnet), compound at 0% fee without resetting maturity clocks, and cut market taker fees from 1.00% to 0.65% (instant at 10 NEAR) or 0.50% / 0.35% / 0.25% (at 50 / 200 / 500+ NEAR after a 24h continuous-stake warmup; crossing below 50 to 50+ NEAR starts a fresh 24h clock). Unstaking under 7 days after deposit pays 0.25% (0% after 7 days), unbonding takes 4 epochs (~2 game-days) and unbonding principal does not count toward tiers. Tier 4 Lead Patrons on the 3 canonical worlds also earn 15% of Protocol fee share (12% of gross on standard 20% DAO fills). Zero combat or mining buffs.',
      },
    },
    {
      '@type': 'Question',
      name: 'How does a game end?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Build a rocket, launch it, and carry part of your colony to a new planet in the sector. A planet itself ends after 14 days or when every colony on it is gone.',
      },
    },
  ];
}

export function buildLandingJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': 'https://terraagent.fun/#website',
        url: 'https://terraagent.fun/',
        name: 'TerraAgent',
        description:
          'Autonomous 3D planetary colony builder in your browser on NEAR Protocol and NEAR.AI.',
        publisher: { '@id': 'https://terraagent.fun/#organization' },
        inLanguage: 'en',
      },
      {
        '@type': 'Organization',
        '@id': 'https://terraagent.fun/#organization',
        name: 'TerraAgent',
        url: 'https://terraagent.fun/',
        logo: {
          '@type': 'ImageObject',
          url: 'https://terraagent.fun/icon-512.png',
          width: 512,
          height: 512,
        },
        sameAs: [
          'https://github.com/recferret-bit/terraagent',
          'https://whitepaper.terraagent.fun/',
          'https://pitchdeck.terraagent.fun/',
        ],
      },
      {
        '@type': 'VideoGame',
        '@id': 'https://terraagent.fun/#game',
        name: 'TerraAgent',
        url: 'https://play.terraagent.fun/',
        image: 'https://terraagent.fun/og-cover.png',
        description:
          'Autonomous 3D colony real-time strategy game running 24/7 on a deterministic 5 Hz simulation server with bounded NEAR.AI commanders, NEP-245 cargo markets, Day-1 lossless staking, and bonded diplomacy on NEAR.',
        applicationCategory: 'GameApplication',
        operatingSystem: 'Web Browser',
        gamePlatform: ['WebGL2', 'Web Browser'],
        genre: ['Real-Time Strategy', 'Colony Builder', 'Autonomous Simulation'],
        playMode: ['SinglePlayer', 'MultiPlayer'],
        publisher: { '@id': 'https://terraagent.fun/#organization' },
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
        },
      },
      {
        '@type': 'FAQPage',
        '@id': 'https://terraagent.fun/#faq',
        mainEntity: buildFaqEntities(),
      },
    ],
  };
}

function fillContainer(html: string, id: string, innerHtml: string): string {
  const pattern = new RegExp(`(<div\\b[^>]*\\bid=["']${id}["'][^>]*>)(\\s*)(</div>)`, 'i');
  return html.replace(
    pattern,
    (_match, open: string, _ws: string, close: string) => `${open}${innerHtml}${close}`,
  );
}

export function prerenderLandingHtml(html: string): string {
  let out = html;
  if (!out.includes(LANDING_JSON_LD_MARKER)) {
    const json = JSON.stringify(buildLandingJsonLd()).replace(/</g, '\\u003c');
    const scriptTag = `<script type="application/ld+json" ${LANDING_JSON_LD_MARKER}>${json}</script>\n</head>`;
    out = out.replace('</head>', scriptTag);
  }
  out = fillContainer(out, 'director-scenarios', renderDirectorScenariosHtml());
  out = fillContainer(out, 'economics-board', renderEconomicsBoardHtml());
  out = fillContainer(out, 'protocol-board', renderProtocolBoardHtml());
  out = fillContainer(out, 'contracts-board', renderContractsBoardHtml());
  return out;
}
