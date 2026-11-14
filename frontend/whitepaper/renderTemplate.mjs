import { escapeHtml } from './md-inline.mjs';

function renderHeadAndTopBar(safeTitle) {
  return `<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@600;700&family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../design/css/tokens.css">
<link rel="stylesheet" href="../design/css/base.css">
<link rel="stylesheet" href="./whitepaper.css">
<link rel="stylesheet" href="./rail.css">
<link rel="stylesheet" href="./cards.css">
<link rel="stylesheet" href="./schemas.css">
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
        <div class="wp-kpi"><span class="wp-kpi-val">68 Live 3D Assets</span><span class="wp-kpi-lbl">Interactive WebGL2 Previews</span></div>
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