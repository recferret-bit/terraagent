import { escapeHtml } from './md-inline.mjs';

const WP_DESC =
  'TerraAgent technical and economic whitepaper: 5 Hz deterministic colony RTS, 4 organic income lanes, wallet-first 4-tier lossless NEAR & LST staking, bonded diplomacy, 6 Rust contracts, and verifiable NEAR.AI commanders.';

function buildWhitepaperJsonLd(safeTitle) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: safeTitle,
    description: WP_DESC,
    url: 'https://whitepaper.terraagent.fun/',
    mainEntityOfPage: 'https://whitepaper.terraagent.fun/',
    datePublished: '2026-10-31',
    dateModified: '2026-11-21',
    inLanguage: 'en',
    image: 'https://terraagent.fun/og-cover.png',
    author: { '@type': 'Organization', name: 'TerraAgent', url: 'https://terraagent.fun/' },
    publisher: {
      '@type': 'Organization',
      name: 'TerraAgent',
      url: 'https://terraagent.fun/',
      logo: { '@type': 'ImageObject', url: 'https://terraagent.fun/icon-512.png' },
    },
  };
  return JSON.stringify(schema).replace(/</g, '\\u003c');
}

function renderHeadAndTopBar(safeTitle) {
  const safeDesc = escapeHtml(WP_DESC);
  const jsonLd = buildWhitepaperJsonLd(safeTitle);
  return `<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title>
<meta name="description" content="${safeDesc}">
<link rel="canonical" href="https://whitepaper.terraagent.fun/">
<meta property="og:type" content="article">
<meta property="og:site_name" content="TerraAgent">
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="${safeDesc}">
<meta property="og:url" content="https://whitepaper.terraagent.fun/">
<meta property="og:image" content="https://terraagent.fun/og-cover.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${safeTitle}">
<meta name="twitter:description" content="${safeDesc}">
<meta name="twitter:image" content="https://terraagent.fun/og-cover.png">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@600;700&family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../design/css/tokens.css">
<link rel="stylesheet" href="../design/css/base.css">
<link rel="stylesheet" href="./whitepaper.css">
<link rel="stylesheet" href="./rail.css">
<link rel="stylesheet" href="./cards.css">
<link rel="stylesheet" href="./schemas.css">
<script type="application/ld+json">${jsonLd}</script>
</head>
<body>
<div class="wp-progress"><div id="wpScrollProgress" class="wp-progress-fill"></div></div>
<header class="wp-top">
  <a class="wp-top-brand" href="/landing.html">
    <span class="wp-top-dot" aria-hidden="true"></span>
    <span>TerraAgent // Whitepaper</span>
  </a>
  <nav class="wp-top-links" aria-label="Primary destinations">
    <a class="btn btn-ghost btn-sm" href="/playground.html">3D Playground</a>
    <a class="btn btn-ghost btn-sm" href="/trade.html">Exchange</a>
    <a class="btn btn-ghost btn-sm" href="/me.html#staking">Staking</a>
    <a class="btn btn-primary btn-sm" href="/play.html?planet=dune&amp;skip=1">Play Live</a>
  </nav>
</header>`;
}

function renderLeftRail() {
  return `  <div id="wpRailBackdrop" class="wp-rail-backdrop" aria-hidden="true"></div>
  <aside id="wpRail" class="wp-rail plate" aria-label="Whitepaper Navigation">
    <div class="wp-rail-head">
      <span class="wp-rail-title">INDEX // COMMAND RAIL</span>
      <button id="wpRailHide" class="btn btn-ghost btn-sm" type="button">Hide</button>
    </div>
    <div class="wp-rail-tabs" role="tablist" aria-label="Navigation Views">
      <button class="wp-rail-tab is-active" type="button" role="tab" aria-selected="true" data-rail-tab="chapters">Chapters</button>
      <button class="wp-rail-tab" type="button" role="tab" aria-selected="false" data-rail-tab="stack">Protocol</button>
      <button class="wp-rail-tab" type="button" role="tab" aria-selected="false" data-rail-tab="entities">3D Units</button>
    </div>
    <input id="wpRailSearch" class="wp-rail-search" type="search" placeholder="Filter sections, units…" aria-label="Filter navigation">
    <div class="wp-rail-scroll-wrap">
      <div id="wpRailBody" class="wp-rail-body">
        <nav id="tabPanel-chapters" class="wp-rail-panel" aria-label="Chapters"></nav>
        <nav id="tabPanel-stack" class="wp-rail-panel" aria-label="Protocol and Architecture" hidden></nav>
        <nav id="tabPanel-entities" class="wp-rail-panel" aria-label="3D Entities and Effects" hidden></nav>
      </div>
      <div id="wpRailScrollbar" class="wp-rail-scrollbar" aria-hidden="true">
        <div id="wpRailThumb" class="wp-rail-thumb"></div>
      </div>
    </div>
    <button id="wpRailMore" class="wp-rail-more" type="button" hidden>▾ Scroll for more</button>
    <div class="wp-rail-foot">
      <span id="wpActiveChapter">CH 00 // CORE</span>
      <span id="wpRenderStatus">3D STAGE READY</span>
    </div>
  </aside>`;
}

function renderHeroHeader(safeTitle) {
  return `    <header class="wp-hero plate-lg">
      <div class="scanlines" aria-hidden="true"></div>
      <div class="badge badge-recruiting">PROTOCOL, AI &amp; ENGINE WHITEPAPER</div>
      <h1>${safeTitle}</h1>
      <p class="wp-hero-lead">TerraAgent is an autonomous planetary colony RTS where the economy is the gameplay. Colonies mine, trade, form treaties, and defend 24/7 on a deterministic 5 Hz engine — while NEAR smart contracts and hardware-attested NEAR.AI commanders handle asset custody, atomic 4-way settlement, and verifiable autonomy.</p>
      <div class="wp-kpi-strip">
        <div class="wp-kpi"><span class="wp-kpi-val">0% Mint / 0% P2W</span><span class="wp-kpi-lbl">Organic Fee &amp; Yield Economy</span></div>
        <div class="wp-kpi"><span class="wp-kpi-val">6 NEAR Contracts</span><span class="wp-kpi-lbl">NEP-245 · 171 · 366 · 413</span></div>
        <div class="wp-kpi"><span class="wp-kpi-val">TEE + Guardrails</span><span class="wp-kpi-lbl">Verifiable NEAR.AI Autopilot</span></div>
        <div class="wp-kpi"><span class="wp-kpi-val">71 Live 3D Assets</span><span class="wp-kpi-lbl">Interactive WebGL2 Previews</span></div>
      </div>
    </header>`;
}

/**
 * Generates the thin Vite Faction Plate whitepaper HTML shell wrapping the
 * compiled canonical markdown section (`canonicalBodyHtml`).
 */
export function buildWhitepaperHtml(title, canonicalBodyHtml) {
  const safeTitle = escapeHtml(title);
  return `<!doctype html>
<html lang="en">
${renderHeadAndTopBar(safeTitle)}
<div id="wpShell" class="wp-shell">
${renderLeftRail()}
  <main class="container doc" id="wpMain">
${renderHeroHeader(safeTitle)}
    <div id="wpSectionsMount"></div>
    <section id="sec-canonical" class="wp-section wp-reveal">
      <div class="wp-divider">
        <div class="wp-divider-bar">
          <span class="wp-divider-index">10</span>
          <div class="wp-divider-hazard hazard"></div>
          <span class="wp-divider-domain">RISKS, PROOFS &amp; CANONICAL DRAFT</span>
        </div>
        <h2>Risks, Design Trade-offs &amp; Testnet Proof Ledger</h2>
      </div>
      <div id="wpCanonicalRisksMount"></div>
      <details class="wp-canonical-details">
        <summary class="wp-canonical-summary">
          <span>Read Full Standalone Markdown Draft &amp; Testnet Deployment Table</span>
          <span class="wp-canonical-toggle-hint">EXPAND ▾</span>
        </summary>
        <article class="wp-canonical">
${canonicalBodyHtml}
        </article>
      </details>
    </section>
  </main>
</div>
<button id="wpRailShowFloat" class="btn btn-primary btn-sm wp-rail-show-float" type="button" hidden>Show Menu</button>
<script type="module" src="./main.ts"></script>
</body>
</html>
`;
}