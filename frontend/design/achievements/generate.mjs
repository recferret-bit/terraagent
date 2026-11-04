// TerraAgent Achievement Badge Generator (W12-23)
// Generates 60 earned SVGs, 60 locked SVGs, 60 pure-Node PNGs, and preview.html.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACHIEVEMENTS, ACHIEVEMENT_FAMILIES } from '../../../shared/contracts/src/progression/achievements.ts';
import { GLYPHS } from './glyphs.mjs';
import { generateBadgePng } from './png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const SVG_DIR = join(ROOT, 'frontend/public/img/achievements');
const PREVIEW_PATH = join(HERE, 'preview.html');

const TIERS = {
  1: { name: 'Bronze', rim: ['#F0B888', '#C8844A', '#7D3E14', '#BD7138', '#F0B888'], edge: '#502408', glow: '#C8844A', ink: '#FFE3C7' },
  2: { name: 'Silver', rim: ['#FFFFFF', '#C9CED6', '#747D8C', '#D4D9E2', '#FFFFFF'], edge: '#39404D', glow: '#C9CED6', ink: '#F2F4F8' },
  3: { name: 'Gold', rim: ['#FFF3B0', '#FFCF5A', '#A87208', '#FFDD75', '#FFF6C9'], edge: '#6E4300', glow: '#FFCF5A', ink: '#FFF0BE' },
};
const LOCKED_TIER = { name: 'Steel', rim: ['#8A93A2', '#5B6372', '#2A313D', '#4A5260', '#8A93A2'], edge: '#181C24', glow: '#5A6270', ink: '#8A93A2' };

const r1 = (n) => Math.round(n * 10) / 10;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fit = (len, width, max) => Math.min(max, Math.floor(width / (Math.max(len, 1) * 0.62)));

const hexPts = (cx, cy, r) => Array.from({ length: 6 }, (_, k) => {
  const a = ((-90 + 60 * k) * Math.PI) / 180;
  return `${r1(cx + r * Math.cos(a))},${r1(cy + r * Math.sin(a))}`;
}).join(' ');

const starPts = (cx, cy, R, r = R * 0.42) => Array.from({ length: 10 }, (_, k) => {
  const a = ((-90 + 36 * k) * Math.PI) / 180;
  const d = k % 2 ? r : R;
  return `${r1(cx + d * Math.cos(a))},${r1(cy + d * Math.sin(a))}`;
}).join(' ');

function renderDefs(tier, locked) {
  const rimStops = tier.rim.map((c, i) => `<stop offset="${r1((i / (tier.rim.length - 1)) * 100)}%" stop-color="${c}"/>`).join('');
  const g1 = locked ? '#8A93A2' : tier.rim[0];
  const g2 = locked ? '#3A4250' : tier.rim[2];
  return `<defs>
    <radialGradient id="bg" cx="50%" cy="30%" r="80%"><stop offset="0" stop-color="${locked ? '#12151D' : '#141822'}"/><stop offset="1" stop-color="#050608"/></radialGradient>
    <radialGradient id="halo" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="${tier.glow}" stop-opacity="${locked ? 0.08 : 0.35}"/><stop offset="1" stop-color="${tier.glow}" stop-opacity="0"/></radialGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">${rimStops}</linearGradient>
    <linearGradient id="rimB" x1="1" y1="0" x2="0" y2="1">${rimStops}</linearGradient>
    <linearGradient id="bevel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${tier.edge}"/><stop offset=".5" stop-color="#0B0D11"/><stop offset="1" stop-color="${tier.edge}"/></linearGradient>
    <radialGradient id="plate" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="${locked ? '#181D26' : '#13161F'}"/><stop offset=".7" stop-color="${locked ? '#10131A' : '#0D0F15'}"/><stop offset="1" stop-color="#050608"/></radialGradient>
    <linearGradient id="ga" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${g1}"/><stop offset="1" stop-color="${g2}"/></linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF" stop-opacity="0"/><stop offset=".48" stop-color="#FFF" stop-opacity="0"/><stop offset=".5" stop-color="#FFF" stop-opacity="${locked ? 0.04 : 0.18}"/><stop offset=".54" stop-color="#FFF" stop-opacity="0"/><stop offset="1" stop-color="#FFF" stop-opacity="0"/></linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>`;
}

function renderPips(cx, cy, a, tier, locked) {
  const pips = Array.from({ length: 3 }, (_, n) => {
    const x = cx + (n - 1) * 68;
    const lit = !locked && n < a.tier;
    return lit
      ? `<polygon points="${starPts(x, cy, 26)}" fill="url(#rim)" stroke="${tier.edge}" stroke-width="3" filter="url(#glow)"/>`
      : `<polygon points="${starPts(x, cy, 26)}" fill="${locked ? '#2A313D' : tier.rim[1]}" fill-opacity=".15" stroke="${locked ? '#4A5364' : tier.rim[1]}" stroke-width="3" stroke-dasharray="${locked ? '0' : '2 6'}" opacity="${locked ? '0.45' : '0.6'}"/>`;
  }).join('');
  const label = locked ? 'LOCKED · TIER ' + a.tier : (a.star ? '★ ' + tier.name.toUpperCase() + ' · TIER ' + a.tier + ' ★' : tier.name.toUpperCase() + ' · TIER ' + a.tier);
  return `${pips}<text x="${cx}" y="${cy + 52}" text-anchor="middle" font-family="'IBM Plex Mono',monospace" font-size="20" font-weight="600" fill="${locked ? '#5A6270' : tier.rim[1]}" letter-spacing="6">${label}</text>`;
}

export function generateBadgeSvg(a, locked = false) {
  const tier = locked ? LOCKED_TIER : TIERS[a.tier];
  const cx = 512, cy = 445;
  const glyphFn = GLYPHS[a.glyph] || GLYPHS[a.familyId] || GLYPHS.flag;
  const glyphContext = { p: locked ? '#8A93A2' : 'url(#ga)', s: locked ? '#6B7385' : '#FFFFFF', d: locked ? '#1C212B' : '#0B0D11', k: !locked, edge: tier.edge, glow: tier.glow };
  const glyphBody = glyphFn(glyphContext, a);
  const nameFs = fit(a.name.length, 780, 58);
  const bolts = Array.from({ length: 6 }, (_, k) => {
    const an = ((-90 + 60 * k) * Math.PI) / 180;
    return `<circle cx="${r1(cx + 322 * Math.cos(an))}" cy="${r1(cy + 322 * Math.sin(an))}" r="9" fill="url(#rimB)" stroke="${tier.edge}" stroke-width="3"/><circle cx="${r1(cx + 322 * Math.cos(an))}" cy="${r1(cy + 322 * Math.sin(an))}" r="3" fill="${tier.edge}"/>`;
  }).join('');
  const starEmblem = a.star && !locked
    ? `<polygon points="${hexPts(cx, cy, 372)}" fill="none" stroke="url(#rimB)" stroke-width="4" stroke-dasharray="12 8" opacity=".85" filter="url(#glow)"/>
       <polygon points="${starPts(512, 115, 20)}" fill="#FF6A13" filter="url(#glow)"/>`
    : '';
  const lockSvg = locked
    ? `<g transform="translate(${cx} ${cy + 18})">
        <circle r="76" fill="#07080A" opacity=".78"/>
        <path d="M-28 -12 V-34 A28 28 0 0 1 28 -34 V-12" fill="none" stroke="#8A93A2" stroke-width="12" stroke-linecap="round"/>
        <rect x="-42" y="-12" width="84" height="66" rx="14" fill="#2A313D" stroke="#8A93A2" stroke-width="4"/>
        <circle cy="18" r="8" fill="#8A93A2"/><rect x="-3.5" y="22" width="7" height="16" rx="3.5" fill="#8A93A2"/>
      </g>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-label="${esc(a.name)} – TerraAgent achievement${locked ? ' (locked)' : ''}">
  <title>${esc(a.name)}${locked ? ' (locked)' : ''}</title>
  ${renderDefs(tier, locked)}
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <circle cx="${cx}" cy="${cy}" r="460" fill="url(#halo)"/>
  <text x="512" y="78" text-anchor="middle" font-family="'Chakra Petch','IBM Plex Mono',monospace" font-size="28" font-weight="700" fill="${locked ? '#5A6270' : tier.glow}" letter-spacing="12">TERRAAGENT</text>
  ${starEmblem}
  <polygon points="${hexPts(cx, cy, 348)}" fill="url(#rim)" stroke="${tier.edge}" stroke-width="8" stroke-linejoin="round"/>
  <polygon points="${hexPts(cx, cy, 314)}" fill="url(#bevel)" stroke="url(#rimB)" stroke-width="5" stroke-linejoin="round"/>
  <polygon points="${hexPts(cx, cy, 292)}" fill="url(#plate)" stroke="#050608" stroke-width="3" stroke-linejoin="round"/>
  <polygon points="${hexPts(cx, cy, 272)}" fill="none" stroke="${tier.glow}" stroke-width="2.5" stroke-dasharray="4 10" opacity="${locked ? 0.3 : 0.65}"/>
  ${bolts}
  <g transform="translate(${cx} ${cy - 12}) scale(1.65)" ${locked ? 'opacity=".45"' : 'filter="url(#glow)"'}>${glyphBody}</g>
  ${lockSvg}
  <polygon points="${hexPts(cx, cy, 348)}" fill="url(#sheen)" stroke="none"/>
  <rect x="92" y="792" width="840" height="100" rx="16" fill="url(#bevel)" stroke="url(#rim)" stroke-width="5"/>
  <rect x="108" y="806" width="808" height="72" rx="10" fill="#07080A" opacity=".95"/>
  <text x="512" y="856" text-anchor="middle" font-family="'Chakra Petch','IBM Plex Mono',monospace" font-size="${nameFs}" font-weight="700" fill="${locked ? '#8A93A2' : tier.ink}" letter-spacing="2">${esc(a.name.toUpperCase())}</text>
  ${renderPips(cx, 932, a, tier, locked)}
</svg>
`;
}

function generatePreview(achievements, families) {
  const rows = families.map((fam) => {
    const famTiers = achievements.filter((a) => a.familyId === fam.familyId);
    const starTag = fam.star ? '<span class="c-orange">★ STAR</span>' : '';
    const cards = famTiers.map((a) => `<div class="card plate" style="padding:16px;text-align:center"><div style="display:flex;gap:8px;justify-content:center;margin-bottom:12px"><img src="../../public/img/achievements/${a.id}.svg" width="160" height="160" alt="${esc(a.name)}" style="border-radius:8px;background:var(--ta-void)"><img src="../../public/img/achievements/${a.id}-locked.svg" width="160" height="160" alt="${esc(a.name)} (locked)" style="border-radius:8px;background:var(--ta-void)"><img src="../../public/img/achievements/${a.id}.png" width="160" height="160" alt="${esc(a.name)} PNG" style="border-radius:8px;background:var(--ta-void)"></div><p class="label c-orange" style="margin:4px 0">${a.tierName.toUpperCase()} · TIER ${a.tier} (${a.xp} XP)</p><h4 style="margin:4px 0;font-family:var(--ta-font-display)">${esc(a.name)}</h4><p class="muted" style="font-size:12px;margin:4px 0">${esc(a.description)}</p><code style="font-size:11px;color:var(--ta-steel)">${esc(a.id)}</code></div>`).join('\n');
    return `<section style="margin-bottom:32px">
<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px"><h3 style="margin:0;font-family:var(--ta-font-display)">${esc(fam.name)}</h3><span class="muted" style="font-family:var(--ta-font-mono);font-size:12px">glyph: ${fam.glyph} · wave: ${fam.producerWave}</span>${starTag}</div>
<div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:16px">
${cards}
</div>
</section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TerraAgent — Achievement Badges</title>
<link rel="stylesheet" href="../css/tokens.css">
<link rel="stylesheet" href="../css/base.css">
</head>
<body style="background:var(--ta-void);color:var(--ta-text);padding:32px;font-family:var(--ta-font-body)">
<header style="margin-bottom:36px;border-bottom:1px solid var(--ta-seam);padding-bottom:18px">
<p class="eyebrow" style="color:var(--ta-orange);font-family:var(--ta-font-mono);margin-bottom:8px">PROGRESSION ASSETS · W12-23</p>
<h1 style="font-family:var(--ta-font-display);margin:0 0 8px">TerraAgent Achievement Badges</h1>
<p class="muted" style="margin:0">20 families × 3 tiers = 60 milestones (Earned SVG, Locked SVG, 1024×1024 PNG).</p>
</header>
<main>
${rows}
</main>
</body>
</html>`;
}

export function main() {
  mkdirSync(SVG_DIR, { recursive: true });
  console.log(`Generating 60 badges for TerraAgent...`);
  for (const a of ACHIEVEMENTS) {
    writeFileSync(join(SVG_DIR, `${a.id}.svg`), generateBadgeSvg(a, false));
    writeFileSync(join(SVG_DIR, `${a.id}-locked.svg`), generateBadgeSvg(a, true));
    writeFileSync(join(SVG_DIR, `${a.id}.png`), generateBadgePng(a, false));
  }
  writeFileSync(PREVIEW_PATH, generatePreview(ACHIEVEMENTS, ACHIEVEMENT_FAMILIES));
  console.log(`Generated ${ACHIEVEMENTS.length} badges (SVG, locked SVG, PNG) -> ${SVG_DIR}`);
  console.log(`Generated preview contact sheet -> ${PREVIEW_PATH}`);
}

main();
