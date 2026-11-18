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
      name: "Why can't I join any planet I like?",
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Planets stop accepting new colonies once their seats fill or 24 hours pass since the first landing. That keeps every new player on a fair start. Fresh worlds open automatically.',
      },
    },
    {
      '@type': 'Question',
      name: 'Do I need a crypto wallet?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'No. You start as a guest. Linking or claiming a NEAR wallet is optional and unlocks self-custody withdrawals and Day-1 Staking.',
      },
    },
    {
      '@type': 'Question',
      name: 'How do players earn, and what pays for gas and AI?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Sell refined cargo on /trade.html, collect stall fees at your Trade Hub, run automated trading bots, or claim defense bounties. Real trade activity, staking yield, and forfeited bonds cover gas and AI—never an inflationary reward token.',
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
