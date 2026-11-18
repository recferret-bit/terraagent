import { PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import { resolveAtmosphereProfile } from '../../../descent/atmosphereSpec';
import { Telemetry } from '../../../descent/timeline';

const TELEMETRY_BY_KIND: Record<PlanetKind, Telemetry> = {
  dune: new Telemetry(PLANET_SPECS.dune.orbital.atmosphereDensity, PLANET_SPECS.dune.name, 35, 1, 'dune'),
  oceanForest: new Telemetry(PLANET_SPECS.oceanForest.orbital.atmosphereDensity, PLANET_SPECS.oceanForest.name, 35, 1, 'oceanForest'),
  forestRock: new Telemetry(PLANET_SPECS.forestRock.orbital.atmosphereDensity, PLANET_SPECS.forestRock.name, 35, 1, 'forestRock'),
};

export interface DescentOverlayRefs {
  readonly descentEl: HTMLElement;
  readonly descentLabelEl: HTMLElement;
  readonly descentCoordsEl: HTMLElement;
  readonly descentAltEl: HTMLElement;
  readonly descentProgEl: HTMLElement;
  readonly descentBarFillEl: HTMLElement;
  readonly speedEl: HTMLElement;
  readonly gForceEl: HTMLElement;
  readonly tempEl: HTMLElement;
  readonly pressureEl: HTMLElement;
  readonly solarEl: HTMLElement;
  readonly atmoEl: HTMLElement;
  readonly stepEls: readonly HTMLElement[];
}

function makeMetricCell(label: string, testId: string, initial: string): { cell: HTMLElement; valueEl: HTMLElement } {
  const cell = document.createElement('div');
  cell.className = 'ta-descent-phase__cell';
  const k = document.createElement('span');
  k.className = 'ta-descent-phase__k';
  k.textContent = label;
  const v = document.createElement('b');
  v.className = 'ta-descent-phase__v';
  v.setAttribute('data-testid', testId);
  v.dataset.testid = testId;
  v.textContent = initial;
  cell.append(k, v);
  return { cell, valueEl: v };
}

export function buildDescentOverlayDom(): DescentOverlayRefs {
  const descentEl = document.createElement('div');
  descentEl.className = 'ta-descent-phase plate-sm';
  descentEl.setAttribute('data-testid', 'descent-phase');
  descentEl.dataset.testid = 'descent-phase';
  descentEl.dataset.active = 'false';
  descentEl.hidden = true;

  const header = document.createElement('div');
  header.className = 'ta-descent-phase__header';
  const descentLabelEl = document.createElement('span');
  descentLabelEl.setAttribute('data-testid', 'descent-phase-label');
  descentLabelEl.dataset.testid = 'descent-phase-label';
  descentLabelEl.textContent = 'ATMOSPHERIC ENTRY';
  const descentCoordsEl = document.createElement('span');
  descentCoordsEl.setAttribute('data-testid', 'descent-coords');
  descentCoordsEl.dataset.testid = 'descent-coords';
  descentCoordsEl.textContent = '(0, 0)';
  header.append(descentLabelEl, descentCoordsEl);

  const stepsRow = document.createElement('div');
  stepsRow.className = 'ta-descent-phase__steps';
  const stepEls = ['ENTRY', 'CHUTE', 'RETRO', 'LAND'].map((code, idx) => {
    const s = document.createElement('span');
    s.className = 'ta-descent-phase__step';
    s.dataset.step = idx === 0 ? 'active' : 'upcoming';
    s.textContent = code;
    stepsRow.appendChild(s);
    return s;
  });

  const metrics = document.createElement('div');
  metrics.className = 'ta-descent-phase__metrics';
  const descentAltEl = document.createElement('span');
  descentAltEl.setAttribute('data-testid', 'descent-altitude');
  descentAltEl.dataset.testid = 'descent-altitude';
  descentAltEl.textContent = '120.0 km';
  const descentProgEl = document.createElement('span');
  descentProgEl.setAttribute('data-testid', 'descent-progress');
  descentProgEl.dataset.testid = 'descent-progress';
  descentProgEl.textContent = '0%';
  metrics.append(descentAltEl, descentProgEl);

  const grid = document.createElement('div');
  grid.className = 'ta-descent-phase__grid';
  const spd = makeMetricCell('VELOCITY', 'descent-speed', '28,400 km/h');
  const gf = makeMetricCell('G-FORCE', 'descent-gforce', '1.20 g');
  const tmp = makeMetricCell('TPS TEMP', 'descent-temp', '+185 °C');
  const prs = makeMetricCell('PRESSURE', 'descent-pressure', '0.42 kPa');
  const sol = makeMetricCell('LOCAL SOLAR', 'descent-solar', '09:00 DAY');
  const atm = makeMetricCell('ATMO SPEC', 'descent-atmo', 'N₂ · O₂');
  grid.append(spd.cell, gf.cell, tmp.cell, prs.cell, sol.cell, atm.cell);

  const bar = document.createElement('div');
  bar.className = 'ta-descent-phase__bar';
  const descentBarFillEl = document.createElement('div');
  descentBarFillEl.className = 'ta-descent-phase__bar-fill';
  descentBarFillEl.setAttribute('data-testid', 'descent-progress-bar');
  descentBarFillEl.dataset.testid = 'descent-progress-bar';
  bar.appendChild(descentBarFillEl);

  descentEl.append(header, stepsRow, metrics, grid, bar);
  return {
    descentEl,
    descentLabelEl,
    descentCoordsEl,
    descentAltEl,
    descentProgEl,
    descentBarFillEl,
    speedEl: spd.valueEl,
    gForceEl: gf.valueEl,
    tempEl: tmp.valueEl,
    pressureEl: prs.valueEl,
    solarEl: sol.valueEl,
    atmoEl: atm.valueEl,
    stepEls,
  };
}

export function renderDescentOverlayUpdate(
  refs: DescentOverlayRefs,
  update: { progress: number; q: number; r: number; planetType?: string | null },
): void {
  const p = Math.min(1, Math.max(0, update.progress));
  const pct = Math.round(p * 100);
  const profile = resolveAtmosphereProfile(update.planetType);
  // Map direct-boot progress [0..1] across atmospheric entry -> chute -> retro -> touchdown (tn 14..34)
  const tn = 14 + p * 20;
  const tel = TELEMETRY_BY_KIND[profile.kind].at(tn);

  let activeStep = 0;
  let label = 'ATMOSPHERIC ENTRY';
  if (tel.phase === 'touchdown') {
    activeStep = 3;
    label = 'TOUCHDOWN';
  } else if (tel.phase === 'approach' || tel.phase === 'retro') {
    activeStep = 2;
    label = 'RETRO-BURN';
  } else if (tel.phase === 'chute') {
    activeStep = 1;
    label = 'CANOPY DESCENT';
  }
  for (let i = 0; i < refs.stepEls.length; i++) {
    refs.stepEls[i]!.dataset.step = i < activeStep ? 'done' : i === activeStep ? 'active' : 'upcoming';
  }

  refs.descentLabelEl.textContent = label;
  refs.descentCoordsEl.textContent = `(${update.q}, ${update.r})`;
  refs.descentAltEl.textContent =
    tel.altitudeKm < 1 ? `${(tel.altitudeKm * 1000).toFixed(1)} m` : `${tel.altitudeKm.toFixed(1)} km`;
  refs.descentProgEl.textContent = `${pct}%`;
  refs.descentBarFillEl.style.width = `${pct}%`;

  const fmt = (n: number, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  refs.speedEl.textContent = `${fmt(tel.speedKmh)} km/h`;
  refs.gForceEl.textContent = `${fmt(tel.gForce, 2)} g`;
  const tempRound = Math.round(tel.hullTempC);
  refs.tempEl.textContent = `${tempRound < 0 ? '−' : '+'}${fmt(Math.abs(tempRound))} °C`;
  refs.tempEl.dataset.band = tempRound > 1100 ? 'crit' : tempRound > 400 ? 'hot' : tempRound < -20 ? 'cold' : 'warm';
  const pKpa = tel.staticPressureKpa ?? 0;
  refs.pressureEl.textContent = pKpa < 0.05 ? 'VACUUM' : `${fmt(pKpa, pKpa < 10 ? 2 : 1)} kPa`;
  refs.solarEl.textContent = `${tel.localSolarClock ?? '09:00'} ${tel.localDayPeriod ?? 'DAY'}`;
  const topGases = (tel.atmoGases ?? []).slice(0, 2).map((g) => `${g.formula} ${g.pct.toFixed(0)}%`).join(' · ');
  refs.atmoEl.textContent = (tel.intakeProgress ?? 1) < 0.25 ? 'SAMPLING…' : topGases;

  refs.descentEl.dataset.progress = p.toFixed(2);
  refs.descentEl.dataset.q = String(update.q);
  refs.descentEl.dataset.r = String(update.r);
}
