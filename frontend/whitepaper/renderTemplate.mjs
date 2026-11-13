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
<link rel="stylesheet" href="./cards.css">
</head>
<body>
<div class="wp-progress"><div id="wpScrollProgress" class="wp-progress-fill"></div></div>
<header class="wp-top">
  <a class="wp-top-brand" href="/landing.html">
    <span class="wp-top-dot" aria-hidden="true"></span>
    <span>TerraAgent // Whitepaper</span>
  </a>
  <div class="wp-top-controls">
    <button id="wpRailToggle" class="btn btn-ghost btn-sm" type="button" aria-controls="wpRail" aria-expanded="true">Hide Menu</button>
    <div class="wp-biome-pills" role="group" aria-label="3D Biome Shader">
      <button class="wp-biome-btn is-active" type="button" data-biome="dune" aria-pressed="true">Dune</button>
      <button class="wp-biome-btn" type="button" data-biome="oceanForest" aria-pressed="false">Ocean Forest</button>
      <button class="wp-biome-btn" type="button" data-biome="forestRock" aria-pressed="false">Forest Rock</button>
    </div>
  </div>
  <nav class="wp-top-links" aria-label="Primary destinations">
    <a class="btn btn-ghost btn-sm" href="/playground.html">3D Playground</a>
    <a class="btn btn-ghost btn-sm" href="/trade.html">Exchange</a>
    <a class="btn btn-primary btn-sm" href="/play.html?planet=dune&amp;skip=1">Play Live</a>
  </nav>
</header>`;
}

function renderLeftRail() {
  return `  <div id="wpRailBackdrop" class="wp-rail-backdrop" aria-hidden="true"></div>
  <aside id="wpRail" class="wp-rail plate-lg" aria-label="Whitepaper Navigation">
    <div class="wp-rail-head">
      <span class="wp-rail-title">INDEX // COMMAND RAIL</span>
      <button id="wpRailHide" class="btn btn-ghost btn-sm" type="button">Hide</button>
    </div>
    <div class="wp-rail-tabs" role="tablist" aria-label="Navigation Views">
      <button class="wp-rail-tab is-active" type="button" role="tab" aria-selected="true" data-rail-tab="chapters">Chapters</button>
      <button class="wp-rail-tab" type="button" role="tab" aria-selected="false" data-rail-tab="stack">Web2+3</button>
      <button class="wp-rail-tab" type="button" role="tab" aria-selected="false" data-rail-tab="entities">3D Units</button>
    </div>
    <input id="wpRailSearch" class="wp-rail-search" type="search" placeholder="Filter chapters, units..." aria-label="Filter navigation">
    <div class="wp-rail-body">
      <nav id="tabPanel-chapters" class="wp-rail-panel" aria-label="Chapters"></nav>
      <nav id="tabPanel-stack" class="wp-rail-panel" aria-label="Web2 and Web3 Stack" hidden></nav>
      <nav id="tabPanel-entities" class="wp-rail-panel" aria-label="3D Entities and Effects" hidden></nav>
    </div>
    <div class="wp-rail-foot">
      <span id="wpActiveChapter">CH 00 // CORE</span>
      <span id="wpRenderStatus">3D STAGE READY</span>
    </div>
  </aside>`;
}

function renderHeroHeader(safeTitle) {
  return `    <header class="wp-hero plate-lg">
      <div class="scanlines" aria-hidden="true"></div>
      <div class="badge badge-recruiting">TECHNICAL &amp; ECONOMIC SPECIFICATION</div>
      <h1>${safeTitle}</h1>
      <p class="wp-hero-lead">Interactive architecture specification covering the 17-module NestJS backend, 6 NEAR smart contracts and 11 typed ports, every planetary mechanic from S0 Landing to S10 Ascendant, and live Three.js Faction Plate 3D previews for all 68 units, structures, fauna, deposits, VFX and shader presets.</p>
      <div class="wp-kpi-strip">
        <div class="wp-kpi"><span class="wp-kpi-val">5 Hz / 50 Hz</span><span class="wp-kpi-lbl">Deterministic Sim + Warp</span></div>
        <div class="wp-kpi"><span class="wp-kpi-val">6 + 11</span><span class="wp-kpi-lbl">Rust Contracts &amp; NEAR Ports</span></div>
        <div class="wp-kpi"><span class="wp-kpi-val">S0–S10 · 60</span><span class="wp-kpi-lbl">Stages &amp; Achievements</span></div>
        <div class="wp-kpi"><span class="wp-kpi-val">68 Live 3D</span><span class="wp-kpi-lbl">Units, Fauna, VFX &amp; Shaders</span></div>
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
          <span class="wp-divider-domain">CANONICAL PUBLIC DRAFT // LEDGER</span>
        </div>
        <h2>Canonical Public Markdown &amp; Verification Status</h2>
      </div>
      <article class="wp-canonical">
${canonicalBodyHtml}
      </article>
    </section>
  </main>
</div>
<button id="wpRailShowFloat" class="btn btn-primary btn-sm wp-rail-show-float" type="button" hidden>Show Menu</button>
<script type="module" src="./main.ts"></script>
</body>
</html>
`;
}
