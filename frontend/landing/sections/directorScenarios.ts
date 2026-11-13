// Section 05 extension: Emergent Planet Scenarios (wars, territory conquest, alliances, orbital endgame)
// driven autonomously by both Rival AI bots (NEAR AI Cloud) and offline players with NEAR.AI attached on /me.
import { prefersReducedMotion } from '@terra/render/core/StageHost';

interface ScenarioItem {
  readonly code: string;
  readonly tag: string;
  readonly badgeClass: string;
  readonly accent: string;
  readonly title: string;
  readonly copy: string;
  readonly directive: string;
  readonly svg: string;
}

const SCENARIOS: readonly ScenarioItem[] = [
  {
    code: '01 · WARFARE',
    tag: 'SIEGE & BOUNTIES',
    badgeClass: 'badge-alert',
    accent: 'var(--ta-fault)',
    title: 'Declare Wars & Raids',
    copy: 'Spot a weak perimeter, march assault frames on rival extractors, or lock an on-chain bounty to hire mercenary strikes.',
    directive: 'raid.launch(sector_04) · bounty.open_escrow()',
    svg: `<svg viewBox="0 0 260 136" fill="none" aria-hidden="true">
      <g stroke="#222631" stroke-width="1">
        <polygon points="48,24 70,11 92,24 92,50 70,63 48,50" fill="#111318"/>
        <polygon points="48,66 70,53 92,66 92,92 70,105 48,92" fill="#15181F" stroke="#FF6A13" stroke-opacity=".6"/>
        <polygon points="168,24 190,11 212,24 212,50 190,63 168,50" fill="#191114" stroke="#FF3B3B" stroke-opacity=".8"/>
        <polygon points="168,66 190,53 212,66 212,92 190,105 168,92" fill="#111318"/>
      </g>
      <circle cx="70" cy="79" r="6" fill="#FF6A13"/>
      <path class="sc-vec" d="M78 75 C 118 52, 144 42, 178 37" stroke="#FF6A13" stroke-width="2" stroke-dasharray="5 4"/>
      <path class="sc-vec" d="M80 82 C 122 76, 148 58, 180 42" stroke="#FF3B3B" stroke-width="1.8" stroke-dasharray="4 4"/>
      <g class="sc-pulse" transform="translate(190 37)">
        <circle r="16" stroke="#FF3B3B" stroke-width="1.5" stroke-dasharray="6 3"/>
        <circle r="4.5" fill="#FF3B3B"/>
        <path d="M-21 0H-11M11 0H21M0 -21V-11M0 11V21" stroke="#FF3B3B" stroke-width="1.5"/>
      </g>
      <text x="16" y="122" fill="#FF6B6B" font-family="IBM Plex Mono, monospace" font-size="9.5" letter-spacing="1.2">▸ RAID VECTOR · TARGET LOCKED</text>
    </svg>`,
  },
  {
    code: '02 · CONQUEST',
    tag: 'HEX ANNEXATION',
    badgeClass: 'badge-recruiting',
    accent: 'var(--ta-orange)',
    title: 'Conquer Territory',
    copy: 'Push claim beacons across choke ridges and rich mineral veins to expand your hex ring before neighbours arrive.',
    directive: 'enqueue(beacon_mk2) · claim.ring(R10 → R16)',
    svg: `<svg viewBox="0 0 260 136" fill="none" aria-hidden="true">
      <g stroke="#2A2F3A" stroke-width="1">
        <polygon points="110,14 130,2 150,14 150,38 130,50 110,38" fill="#171310" stroke="#FF6A13" stroke-opacity=".5"/>
        <polygon points="74,35 94,23 114,35 114,59 94,71 74,59" fill="#171310" stroke="#FF6A13" stroke-opacity=".5"/>
        <polygon points="146,35 166,23 186,35 186,59 166,71 146,59" fill="#171310" stroke="#FF6A13" stroke-opacity=".5"/>
        <polygon points="110,56 130,44 150,56 150,80 130,92 110,80" fill="#24160E" stroke="#FF6A13" stroke-width="1.8"/>
        <polygon points="74,77 94,65 114,77 114,101 94,113 74,101" fill="#111318" stroke-dasharray="3 2"/>
        <polygon points="146,77 166,65 186,77 186,101 166,113 146,101" fill="#111318" stroke-dasharray="3 2"/>
      </g>
      <circle class="sc-ring" cx="130" cy="68" r="28" stroke="#FF6A13" stroke-width="1.5" stroke-dasharray="6 4"/>
      <circle class="sc-ring sc-ring-outer" cx="130" cy="68" r="45" stroke="#FF8A3D" stroke-width="1.2" stroke-opacity=".65" stroke-dasharray="4 4"/>
      <polygon points="130,58 138,72 122,72" fill="#FF6A13"/>
      <circle cx="94" cy="47" r="3.5" fill="#39D0FF"/>
      <circle cx="166" cy="47" r="3.5" fill="#FF8A3D"/>
      <text x="16" y="122" fill="#FF8A3D" font-family="IBM Plex Mono, monospace" font-size="9.5" letter-spacing="1.2">▸ CLAIM WAVE · +6 MINERAL HEXES</text>
    </svg>`,
  },
  {
    code: '03 · DIPLOMACY',
    tag: 'TRUCE & TRADE',
    badgeClass: 'badge-new',
    accent: 'var(--ta-blue-hi)',
    title: 'Forge Alliances',
    copy: 'Sign server-enforced truces (backstabbing blocked by AW-13) and open automated cargo corridors across friendly borders.',
    directive: 'diplomacy.truce(accept) · intents.swap(water, metals)',
    svg: `<svg viewBox="0 0 260 136" fill="none" aria-hidden="true">
      <polygon points="36,42 60,28 84,42 84,70 60,84 36,70" fill="#101726" stroke="#5B8CFF" stroke-width="1.6"/>
      <polygon points="176,42 200,28 224,42 224,70 200,84 176,70" fill="#171310" stroke="#FF6A13" stroke-width="1.6"/>
      <path class="sc-vec" d="M86 50 H174" stroke="#39D0FF" stroke-width="2" stroke-dasharray="6 4"/>
      <path class="sc-vec sc-vec-rev" d="M174 62 H86" stroke="#FF8A3D" stroke-width="2" stroke-dasharray="6 4"/>
      <g transform="translate(130 56)">
        <polygon points="0,-16 14,-8 14,8 0,16 -14,8 -14,-8" fill="#0B0D11" stroke="#3DDC84" stroke-width="1.6"/>
        <path d="M-5 0 L-1 4 L6 -4" stroke="#3DDC84" stroke-width="2" stroke-linecap="square"/>
      </g>
      <circle cx="60" cy="56" r="5" fill="#5B8CFF"/>
      <circle cx="200" cy="56" r="5" fill="#FF6A13"/>
      <text x="16" y="122" fill="#5B8CFF" font-family="IBM Plex Mono, monospace" font-size="9.5" letter-spacing="1.2">▸ AW-13 TRUCE · WATER ⇄ METALS</text>
    </svg>`,
  },
  {
    code: '04 · ENDGAME',
    tag: 'ORBITAL ASCENSION',
    badgeClass: 'badge-ok',
    accent: 'var(--ta-terra)',
    title: 'Race for the Rocket',
    copy: 'Pool grid megawatts to defend your orbital launch countdown—or rally the sector to halt a rival colony before liftoff.',
    directive: 'rocket.ignite(stage_4) · turret.guard_perimeter()',
    svg: `<svg viewBox="0 0 260 136" fill="none" aria-hidden="true">
      <ellipse cx="130" cy="86" rx="62" ry="18" fill="#0E1714" stroke="#3DDC84" stroke-width="1.4" stroke-dasharray="6 3"/>
      <ellipse cx="130" cy="86" rx="34" ry="10" fill="#13221C" stroke="#3DDC84" stroke-opacity=".6"/>
      <path class="sc-vec" d="M130 82 V 18" stroke="#3DDC84" stroke-width="2.2" stroke-dasharray="5 3"/>
      <g class="sc-ship" transform="translate(130 20)">
        <polygon points="0,-12 7,4 -7,4" fill="#F2F4F7" stroke="#3DDC84" stroke-width="1.2"/>
        <polygon points="-4,4 4,4 0,12" fill="#FF6A13"/>
      </g>
      <circle cx="78" cy="82" r="4" fill="#FF6A13"/>
      <circle cx="182" cy="82" r="4" fill="#FF6A13"/>
      <path d="M56 64 L78 82 M204 64 L182 82" stroke="#FF6A13" stroke-width="1.4"/>
      <text x="16" y="122" fill="#3DDC84" font-family="IBM Plex Mono, monospace" font-size="9.5" letter-spacing="1.2">▸ ORBITAL SEAL · PERIMETER HELD</text>
    </svg>`,
  },
];

function renderScenarioCard(item: ScenarioItem, index: number): string {
  return `<article class="scenario-card plate-sm" data-scenario-card style="--sc-accent:${item.accent};--sc-delay:${index * 90}ms">
    <div class="scenario-vis">
      ${item.svg}
      <div class="scanlines"></div>
    </div>
    <div class="scenario-body">
      <div class="scenario-top">
        <span class="scenario-code">${item.code}</span>
        <span class="badge ${item.badgeClass}">${item.tag}</span>
      </div>
      <h4 class="h3">${item.title}</h4>
      <p>${item.copy}</p>
      <div class="scenario-cmd"><code>${item.directive}</code></div>
    </div>
  </article>`;
}

export function initDirectorScenarios(): void {
  const host = document.getElementById('director-scenarios');
  if (!host) return;

  const cardsHtml = SCENARIOS.map(renderScenarioCard).join('');

  host.innerHTML = `<div class="scenarios-block plate">
    <div class="scenarios-head">
      <div class="scenarios-intro">
        <p class="eyebrow">EMERGENT SANDBOX · EVERY 14-DAY WORLD PLAYS OUT DIFFERENTLY</p>
        <h3 class="h2">No two planets write the same history.</h3>
        <p>Wars, territory grabs, binding truces, and rocket races emerge dynamically—driven around the clock by both <b>Rival AI colonies</b> and <b>offline players</b> who link their own <span class="c-blue">NEAR.AI</span> model.</p>
      </div>
      <div class="scenarios-parity plate-sm" aria-label="Autonomous decision parity between bots and offline players">
        <div class="parity-col">
          <div class="parity-tag"><span class="dot-live"></span> RIVAL AI BOTS</div>
          <strong>NEAR AI Cloud · GLM-5.3 Flash TEE</strong>
          <p>Seeded rival colonies evaluate borders, trade quotes, and raid windows on every planet sweep.</p>
        </div>
        <div class="parity-col is-player">
          <div class="parity-tag c-blue">◆ OFFLINE PLAYERS (BYOK)</div>
          <strong>Your Colony + NEAR.AI on <a href="/me.html">/me</a></strong>
          <p>Attach your NEAR.AI key on <a href="/me.html">/me</a> and your offline colony executes the exact same strategic plays while you sleep.</p>
        </div>
      </div>
    </div>
    <div class="scenarios-grid">${cardsHtml}</div>
    <div class="scenarios-foot">
      <span><b>SAFETY RAILS</b> AW-13 blocks truce backstabs · D-18 blocks AI staking · Trade allowance caps enforced</span>
      <a class="scenarios-cta" href="/me.html">ATTACH NEAR.AI KEY ON /ME <span aria-hidden="true">→</span></a>
    </div>
  </div>`;

  const cards = [...host.querySelectorAll<HTMLElement>('[data-scenario-card]')];
  if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
    cards.forEach((c) => c.classList.add('is-visible'));
    return;
  }
  host.classList.add('js-reveal');
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          (e.target as HTMLElement).classList.add('is-visible');
          io.unobserve(e.target);
        }
      }
    },
    { threshold: 0.18, rootMargin: '0px 0px -40px 0px' },
  );
  cards.forEach((c) => io.observe(c));
}
