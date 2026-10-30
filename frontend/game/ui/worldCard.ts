import { PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';

const css = (n: number) => '#' + n.toString(16).padStart(6, '0');

/** HTML of one selectable world card (procedural planet thumbnail, traits, palette swatches). */
export function worldCardHtml(k: PlanetKind): string {
  const s = PLANET_SPECS[k], o = s.orbital;
  const base = css(o.sea ?? o.land[1]), land = css(o.land[1]), hi = css(o.land[2]);
  const thumb = `radial-gradient(circle at 32% 28%, ${css(o.cloudColor)}55 0%, transparent 28%), radial-gradient(circle at 36% 32%, ${hi} 0%, ${land} 38%, ${base} 70%, #000 100%)`;
  const sw = [s.palette.groundLow, s.palette.groundHigh, s.palette.rock, s.palette.accent, s.palette.water ?? s.palette.rockDark].map((c) => `<i style="background:${css(c)}"></i>`).join('');
  return `<button class="world-card plate" data-k="${k}"><div class="thumb" style="background:${thumb};--glow:${css(o.atmosphereColor)}88"></div>
        <h3>${s.name}</h3><p>${s.tagline}</p><div class="traits">${s.traits.map((t) => `<span>${t}</span>`).join('')}</div><div class="swatches">${sw}</div></button>`;
}
