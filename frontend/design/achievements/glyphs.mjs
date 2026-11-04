// TerraAgent 20 Family Achievement Glyphs (W12-23)
// Rendered in a -100..100 viewBox coordinate system.
// c = { p: primary fill, s: light accent, d: dark plate, k: boolean earned, edge: stroke color, glow: string }

export function flagGlyph(c) {
  return `<g>
    <rect x="-48" y="-95" width="10" height="190" rx="5" fill="${c.p}"/>
    <circle cx="-43" cy="-95" r="9" fill="${c.s}"/>
    <path d="M-38 -85 L55 -60 L35 -20 L65 20 L-38 10 Z" fill="${c.p}" stroke="${c.s}" stroke-width="3"/>
    <polygon points="5,-35 15,-10 -10,-25 20,-25 -5,-10" fill="${c.s}"/>
    <path d="M-80 95 Q-43 70 0 95 Q45 75 80 95" fill="none" stroke="${c.s}" stroke-width="6" stroke-linecap="round"/>
  </g>`;
}

export function shovelGlyph(c) {
  return `<g transform="rotate(-30)">
    <rect x="-18" y="-95" width="36" height="24" rx="6" fill="none" stroke="${c.p}" stroke-width="7"/>
    <rect x="-10" y="-92" width="20" height="7" rx="3.5" fill="${c.s}"/>
    <rect x="-5" y="-72" width="10" height="85" rx="3" fill="${c.p}"/>
    <polygon points="-12,13 12,13 16,30 -16,30" fill="${c.s}"/>
    <path d="M-40 30 L40 30 L36 75 L0 102 L-36 75 Z" fill="${c.p}" stroke="${c.s}" stroke-width="4"/>
    <line x1="0" y1="30" x2="0" y2="85" stroke="${c.d}" stroke-width="5" stroke-linecap="round"/>
  </g>`;
}

export function rockGlyph(c) {
  return `<g>
    <polygon points="-75,10 -45,-65 20,-85 75,-25 65,55 0,90 -65,70" fill="${c.p}" stroke="${c.s}" stroke-width="4" stroke-linejoin="round"/>
    <polygon points="-45,-65 20,-85 0,-15 -25,15" fill="${c.s}" opacity=".25"/>
    <polygon points="20,-85 75,-25 15,20 0,-15" fill="${c.d}" opacity=".35"/>
    <polygon points="-75,10 -25,15 0,90 -65,70" fill="${c.d}" opacity=".2"/>
    <polygon points="-25,15 15,20 65,55 0,90" fill="${c.s}" opacity=".15"/>
    <line x1="-25" y1="15" x2="15" y2="20" stroke="${c.s}" stroke-width="3"/>
    <line x1="0" y1="-15" x2="15" y2="20" stroke="${c.s}" stroke-width="3"/>
    <line x1="0" y1="-15" x2="-25" y2="15" stroke="${c.s}" stroke-width="3"/>
  </g>`;
}

export function dropletGlyph(c) {
  return `<g>
    <path d="M0 -90 C38 -35 68 12 68 45 A68 68 0 0 1 -68 45 C-68 12 -38 -35 0 -90 Z" fill="${c.p}" stroke="${c.s}" stroke-width="5"/>
    <path d="M-20 -40 C-36 -10 -46 15 -46 40 A46 46 0 0 0 -15 82" fill="none" stroke="${c.s}" stroke-width="8" stroke-linecap="round" opacity=".85"/>
    <path d="M-40 45 Q-20 30 0 45 Q20 60 40 45" fill="none" stroke="${c.d}" stroke-width="5" stroke-linecap="round" opacity=".6"/>
  </g>`;
}

export function sproutGlyph(c) {
  return `<g>
    <path d="M0 90 Q-5 35 10 -20 Q18 -50 42 -75" fill="none" stroke="${c.p}" stroke-width="9" stroke-linecap="round"/>
    <path d="M12 -25 C45 -55 80 -40 75 -10 C50 0 25 -10 12 -25 Z" fill="${c.p}" stroke="${c.s}" stroke-width="4"/>
    <path d="M-2 15 C-40 -10 -75 0 -65 30 C-40 38 -15 28 -2 15 Z" fill="${c.p}" stroke="${c.s}" stroke-width="4"/>
    <path d="M-60 92 Q0 70 60 92" fill="none" stroke="${c.s}" stroke-width="7" stroke-linecap="round"/>
  </g>`;
}

export function craneGlyph(c) {
  const diagonals = [-35, -5, 25, 55]
    .map((y) => `<line x1="-35" y1="${y}" x2="-17" y2="${y + 25}" stroke="${c.d}" stroke-width="3"/>`)
    .join('');
  return `<g>
    <rect x="-35" y="-55" width="18" height="150" fill="${c.p}"/>
    ${diagonals}
    <rect x="-70" y="-70" width="155" height="15" rx="3" fill="${c.p}" stroke="${c.s}" stroke-width="2"/>
    <rect x="-75" y="-62" width="24" height="28" rx="4" fill="${c.s}"/>
    <polygon points="-26,-70 -26,-95 -10,-70" fill="${c.p}"/>
    <line x1="-26" y1="-95" x2="65" y2="-70" stroke="${c.s}" stroke-width="3"/>
    <line x1="50" y1="-55" x2="50" y2="15" stroke="${c.s}" stroke-width="3" stroke-dasharray="4 2"/>
    <path d="M45 15 C45 35 60 35 60 25" fill="none" stroke="${c.s}" stroke-width="4" stroke-linecap="round"/>
    <rect x="35" y="30" width="30" height="24" rx="4" fill="${c.p}" stroke="${c.s}" stroke-width="3"/>
  </g>`;
}

export function boltGlyph(c) {
  return `<g>
    <polygon points="15,-95 -45,5 0,5 -20,95 50,-5 5,-5" fill="${c.p}" stroke="${c.s}" stroke-width="6" stroke-linejoin="round"/>
    <polygon points="12,-70 -30,0 2,0 -12,70 32,-8 4,-8" fill="${c.s}" opacity=".35"/>
    <line x1="-55" y1="-30" x2="-75" y2="-10" stroke="${c.s}" stroke-width="4" stroke-linecap="round"/>
    <line x1="55" y1="30" x2="75" y2="10" stroke="${c.s}" stroke-width="4" stroke-linecap="round"/>
  </g>`;
}

export function moonGlyph(c) {
  return `<g>
    <path d="M25 -85 A85 85 0 1 0 25 85 A68 68 0 1 1 25 -85 Z" fill="${c.p}" stroke="${c.s}" stroke-width="4"/>
    <ellipse cx="0" cy="0" rx="90" ry="32" fill="none" stroke="${c.s}" stroke-width="3" stroke-dasharray="8 5" transform="rotate(-25)"/>
    <polygon points="50,-45 53,-35 63,-32 53,-29 50,-19 47,-29 37,-32 47,-35" fill="${c.s}"/>
    <polygon points="70,25 72,32 79,34 72,36 70,43 68,36 61,34 68,32" fill="${c.s}"/>
  </g>`;
}

export function crateGlyph(c) {
  return `<g>
    <polygon points="0,-75 68,-38 0,-2 -68,-38" fill="${c.s}" stroke="${c.d}" stroke-width="3"/>
    <polygon points="-68,-38 0,-2 0,72 -68,35" fill="${c.p}" stroke="${c.d}" stroke-width="3"/>
    <polygon points="0,-2 68,-38 68,35 0,72" fill="${c.p}" stroke="${c.d}" stroke-width="3" opacity=".85"/>
    <line x1="0" y1="-2" x2="0" y2="72" stroke="${c.s}" stroke-width="4"/>
    <line x1="-34" y1="-20" x2="-34" y2="54" stroke="${c.s}" stroke-width="3"/>
    <line x1="34" y1="-20" x2="34" y2="54" stroke="${c.s}" stroke-width="3"/>
  </g>`;
}

export function chevronsGlyph(c) {
  return `<g>
    <path d="M0 -88 L65 -38 L50 -25 L0 -65 L-50 -25 L-65 -38 Z" fill="${c.p}" stroke="${c.s}" stroke-width="3"/>
    <path d="M0 -38 L65 12 L50 25 L0 -15 L-50 25 L-65 12 Z" fill="${c.p}" stroke="${c.s}" stroke-width="3"/>
    <path d="M0 12 L65 62 L50 75 L0 35 L-50 75 L-65 62 Z" fill="${c.p}" stroke="${c.s}" stroke-width="3"/>
    <line x1="0" y1="-95" x2="0" y2="85" stroke="${c.s}" stroke-width="4" stroke-dasharray="6 4"/>
  </g>`;
}

export function bugGlyph(c) {
  return `<g>
    <path d="M-30 -20 L-75 -50 M30 -20 L75 -50 M-35 10 L-80 15 M35 10 L80 15 M-30 40 L-75 75 M30 40 L75 75" stroke="${c.p}" stroke-width="7" stroke-linecap="round"/>
    <path d="M-15 -60 Q-25 -92 0 -85 Q-10 -70 -5 -60 M15 -60 Q25 -92 0 -85 Q10 -70 5 -60" fill="${c.s}" stroke="${c.p}" stroke-width="2"/>
    <ellipse cx="0" cy="-50" rx="20" ry="15" fill="${c.s}"/>
    <ellipse cx="0" cy="-15" rx="32" ry="25" fill="${c.p}" stroke="${c.s}" stroke-width="3"/>
    <ellipse cx="0" cy="35" rx="42" ry="48" fill="${c.p}" stroke="${c.s}" stroke-width="4"/>
    <line x1="0" y1="-10" x2="0" y2="80" stroke="${c.d}" stroke-width="4"/>
  </g>`;
}

export function nestGlyph(c) {
  return `<g>
    <path d="M-75 75 C-70 10 -40 -60 0 -70 C40 -60 70 10 75 75 Z" fill="${c.p}" stroke="${c.s}" stroke-width="4"/>
    <ellipse cx="0" cy="-68" rx="22" ry="9" fill="${c.d}" stroke="${c.s}" stroke-width="3"/>
    <path d="M0 -60 L-10 -20 L-25 0 L-15 40 L-35 75" fill="none" stroke="${c.s}" stroke-width="4" stroke-linecap="round"/>
    <path d="M10 -45 L25 -15 L15 15 L30 50 L20 75" fill="none" stroke="${c.s}" stroke-width="4" stroke-linecap="round"/>
    <circle cx="-32" cy="-25" r="7" fill="${c.d}" stroke="${c.s}" stroke-width="2"/>
    <circle cx="38" cy="-5" r="9" fill="${c.d}" stroke="${c.s}" stroke-width="2"/>
  </g>`;
}

export function wallGlyph(c) {
  return `<g>
    <path d="M-80 60 L-80 -30 L-50 -30 L-50 -10 L-20 -10 L-20 -30 L20 -30 L20 -10 L50 -10 L50 -30 L80 -30 L80 60 Z" fill="${c.p}" stroke="${c.s}" stroke-width="4"/>
    <polygon points="-88,80 -80,60 80,60 88,80" fill="${c.d}" stroke="${c.s}" stroke-width="3"/>
    <line x1="-80" y1="15" x2="80" y2="15" stroke="${c.d}" stroke-width="4"/>
    <line x1="-80" y1="38" x2="80" y2="38" stroke="${c.s}" stroke-width="2" stroke-dasharray="10 6"/>
  </g>`;
}

export function shieldGlyph(c) {
  return `<g>
    <path d="M0 -90 L75 -55 V15 C75 60 40 85 0 100 C-40 85 -75 60 -75 15 V-55 Z" fill="${c.p}" stroke="${c.s}" stroke-width="5"/>
    <path d="M0 -72 L58 -44 V12 C58 48 30 68 0 80 C-30 68 -58 48 -58 12 V-44 Z" fill="${c.d}" stroke="${c.s}" stroke-width="3" opacity=".6"/>
    <path d="M0 -30 L32 5 L20 18 L0 -5 L-20 18 L-32 5 Z" fill="${c.s}"/>
  </g>`;
}

export function crossedBladesGlyph(c) {
  return `<g>
    <g transform="rotate(45)">
      <rect x="-6" y="-95" width="12" height="135" rx="3" fill="${c.p}" stroke="${c.s}" stroke-width="3"/>
      <polygon points="0,-105 -8,-95 8,-95" fill="${c.s}"/>
      <rect x="-24" y="40" width="48" height="8" rx="2" fill="${c.s}"/>
      <rect x="-5" y="48" width="10" height="35" rx="2" fill="${c.d}"/>
    </g>
    <g transform="rotate(-45)">
      <rect x="-6" y="-95" width="12" height="135" rx="3" fill="${c.p}" stroke="${c.s}" stroke-width="3"/>
      <polygon points="0,-105 -8,-95 8,-95" fill="${c.s}"/>
      <rect x="-24" y="40" width="48" height="8" rx="2" fill="${c.s}"/>
      <rect x="-5" y="48" width="10" height="35" rx="2" fill="${c.d}"/>
    </g>
    <circle cx="0" cy="0" r="14" fill="${c.s}" stroke="${c.d}" stroke-width="3"/>
  </g>`;
}

export function coinsGlyph(c) {
  return `<g>
    <g transform="translate(-32, 25)">
      <ellipse cx="0" cy="0" rx="42" ry="24" fill="${c.p}" stroke="${c.s}" stroke-width="3"/>
      <ellipse cx="0" cy="10" rx="42" ry="24" fill="none" stroke="${c.s}" stroke-width="3"/>
    </g>
    <g transform="translate(32, 25)">
      <ellipse cx="0" cy="0" rx="42" ry="24" fill="${c.p}" stroke="${c.s}" stroke-width="3"/>
      <ellipse cx="0" cy="10" rx="42" ry="24" fill="none" stroke="${c.s}" stroke-width="3"/>
    </g>
    <g transform="translate(0, -30)">
      <polygon points="0,-55 45,-28 45,28 0,55 -45,28 -45,-28" fill="${c.p}" stroke="${c.s}" stroke-width="4"/>
      <polygon points="0,-40 32,-20 32,20 0,40 -32,20 -32,-20" fill="${c.d}" stroke="${c.s}" stroke-width="2"/>
      <path d="M-14 18 V-18 L14 18 V-18" fill="none" stroke="${c.s}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  </g>`;
}

export function marketStallGlyph(c) {
  return `<g>
    <polygon points="0,-85 85,-48 70,-32 0,-55 -70,-32 -85,-48" fill="${c.p}" stroke="${c.s}" stroke-width="3"/>
    <line x1="-35" y1="-43" x2="-28" y2="-72" stroke="${c.s}" stroke-width="3"/>
    <line x1="35" y1="-43" x2="28" y2="-72" stroke="${c.s}" stroke-width="3"/>
    <rect x="-65" y="-32" width="8" height="65" fill="${c.s}"/>
    <rect x="57" y="-32" width="8" height="65" fill="${c.s}"/>
    <rect x="-75" y="30" width="150" height="50" rx="8" fill="${c.p}" stroke="${c.s}" stroke-width="4"/>
    <rect x="-55" y="42" width="110" height="24" rx="4" fill="${c.d}" stroke="${c.s}" stroke-width="2"/>
  </g>`;
}

export function shipGlyph(c) {
  return `<g>
    <polygon points="0,-30 85,35 60,45 0,15 -60,45 -85,35" fill="${c.s}" stroke="${c.p}" stroke-width="3"/>
    <polygon points="0,-95 28,-30 22,65 0,75 -22,65 -28,-30" fill="${c.p}" stroke="${c.s}" stroke-width="4"/>
    <polygon points="0,-65 12,-35 0,-22 -12,-35" fill="${c.s}"/>
    <rect x="-24" y="65" width="14" height="15" rx="3" fill="${c.d}" stroke="${c.s}" stroke-width="2"/>
    <rect x="10" y="65" width="14" height="15" rx="3" fill="${c.d}" stroke="${c.s}" stroke-width="2"/>
    <path d="M-17 80 L-17 95 M17 80 L17 95" stroke="${c.s}" stroke-width="4" stroke-linecap="round"/>
  </g>`;
}

export function handshakeGlyph(c) {
  return `<g>
    <path d="M-85 30 L-45 -5 L-20 15 L-60 50 Z" fill="${c.p}" stroke="${c.s}" stroke-width="3"/>
    <path d="M85 30 L45 -5 L20 15 L60 50 Z" fill="${c.p}" stroke="${c.s}" stroke-width="3"/>
    <polygon points="-25,10 0,-15 25,10 0,35" fill="${c.s}" stroke="${c.d}" stroke-width="3"/>
    <rect x="-18" y="2" width="16" height="8" rx="2" fill="${c.d}" transform="rotate(35)"/>
    <rect x="2" y="-8" width="16" height="8" rx="2" fill="${c.d}" transform="rotate(-35)"/>
    <circle cx="0" cy="10" r="8" fill="${c.p}" stroke="${c.s}" stroke-width="2"/>
  </g>`;
}

export function rocketGlyph(c) {
  return `<g>
    <path d="M-22 25 L-55 60 L-22 50 Z" fill="${c.s}" stroke="${c.p}" stroke-width="2"/>
    <path d="M22 25 L55 60 L22 50 Z" fill="${c.s}" stroke="${c.p}" stroke-width="2"/>
    <path d="M0 -95 C25 -50 25 15 22 55 L-22 55 C-25 15 -25 -50 0 -95 Z" fill="${c.p}" stroke="${c.s}" stroke-width="4"/>
    <circle cx="0" cy="-25" r="14" fill="${c.s}" stroke="${c.d}" stroke-width="3"/>
    <circle cx="0" cy="-25" r="7" fill="${c.p}"/>
    <polygon points="-16,55 16,55 22,68 -22,68" fill="${c.d}" stroke="${c.s}" stroke-width="2"/>
    <polygon points="-14,68 0,102 14,68 0,78" fill="${c.s}" opacity=".9"/>
  </g>`;
}

export const GLYPHS = {
  flag: flagGlyph,
  'first-landfall': flagGlyph,
  shovel: shovelGlyph,
  groundbreaker: shovelGlyph,
  rock: rockGlyph,
  'stone-mason': rockGlyph,
  droplet: dropletGlyph,
  'hydro-engineer': dropletGlyph,
  sprout: sproutGlyph,
  'green-thumb': sproutGlyph,
  crane: craneGlyph,
  architect: craneGlyph,
  bolt: boltGlyph,
  'power-broker': boltGlyph,
  moon: moonGlyph,
  'night-shift': moonGlyph,
  crate: crateGlyph,
  stockpile: crateGlyph,
  chevrons: chevronsGlyph,
  'tech-ascendant': chevronsGlyph,
  bug: bugGlyph,
  exterminator: bugGlyph,
  nest: nestGlyph,
  'nest-breaker': nestGlyph,
  wall: wallGlyph,
  'great-wall': wallGlyph,
  shield: shieldGlyph,
  unbreached: shieldGlyph,
  'crossed-blades': crossedBladesGlyph,
  warlord: crossedBladesGlyph,
  coins: coinsGlyph,
  merchant: coinsGlyph,
  'market-stall': marketStallGlyph,
  'port-authority': marketStallGlyph,
  ship: shipGlyph,
  'guild-contact': shipGlyph,
  handshake: handshakeGlyph,
  diplomat: handshakeGlyph,
  rocket: rocketGlyph,
  settler: rocketGlyph,
};
