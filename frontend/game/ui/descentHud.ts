import type { DescentPhase, DescentPodSystems, DescentTelemetry } from '@terra/render/descent/types';
import { buildDescentHudMarkup, DEFAULT_GASES, POD_SYS_KEYS, STEP_ORDER } from './parts/descentHudMarkup';
import './descentHud.css';
import './descentSensors.css';

interface GasRowRefs {
  row: HTMLElement;
  formula: HTMLElement;
  bar: HTMLElement;
  val: HTMLElement;
}

interface SysCellRefs {
  cell: HTMLElement;
  val: HTMLElement;
}

function fmtSignedTemp(c: number): string {
  const r = Math.round(c);
  if (r < 0) return `−${Math.abs(r)}`;
  if (r > 0) return `+${r}`;
  return '0';
}

function formatMet(sec: number): string {
  const s = Math.max(0, sec);
  const mins = Math.floor(s / 60);
  const rem = (s - mins * 60).toFixed(1).padStart(4, '0');
  return `T+${String(mins).padStart(2, '0')}:${rem}`;
}

function gRegimeLabel(phase: DescentPhase, g: number): string {
  if (g < 0.12) return '0-G MICROGRAV';
  if (phase === 'freefall') return 'ENTRY INTERFACE';
  if (phase === 'reentry') return g > 5.2 ? 'HIGH-G BRAKE' : 'AEROBRAKE';
  if (phase === 'chute') return g > 2.2 ? 'CANOPY SHOCK' : 'CHUTE 1-G';
  if (phase === 'approach') return 'APPROACH BRAKE';
  if (phase === 'retro') return 'RETRO BURN';
  if (phase === 'touchdown') return 'SURFACE G';
  return 'DEORBIT';
}

/** Cinematic descent overlay (aerospace kinematics, pod mechanisms, G-meter, TPS thermal state, pressure, solar sync & spectrometer). */
export class DescentHud {
  readonly el = document.createElement('div');
  private q: Record<string, HTMLElement> = {};
  private stepEls: HTMLElement[] = [];
  private gasRows: GasRowRefs[] = [];
  private sysCells: Record<keyof DescentPodSystems, SysCellRefs>;
  private lastTemp: number | null = null;

  constructor(parent: HTMLElement) {
    this.el.id = 'descent';
    this.el.className = 'ui-layer';
    this.el.innerHTML = buildDescentHudMarkup();
    parent.appendChild(this.el);

    const ids = [
      'layer', 'vsink', 'alt', 'alt-u', 'alt-bar', 'mach', 'spd', 'spd-bar',
      'g-block', 'g-tag', 'g', 'g-peak', 'g-bar', 'g-mark',
      'temp-block', 't-state', 'temp', 'tc', 'trend', 't-bar',
      'comms', 'phase', 'met', 'guidance', 'downrange', 'beacon', 'ralt',
      'grav-chip', 'pres', 'pres-sub', 'maxq', 'dynq', 'rho', 'ext-air',
      'solar-clock', 'solar-period', 'atmo-status', 'atmo-sum', 'ppo2', 'cap', 'prog',
    ];
    for (const id of ids) this.q[id] = this.el.querySelector('#d-' + id)!;
    this.stepEls = Array.from(this.el.querySelectorAll<HTMLElement>('#d-stepper .d-step'));
    this.gasRows = Array.from(this.el.querySelectorAll<HTMLElement>('#d-gas-list .d-gas-row')).map((row) => ({
      row,
      formula: row.querySelector('.d-gas-f')!,
      bar: row.querySelector('.d-gas-bar')!,
      val: row.querySelector('.d-gas-v')!,
    }));
    this.sysCells = Object.fromEntries(
      POD_SYS_KEYS.map((k) => {
        const cell = this.el.querySelector<HTMLElement>(`#d-sys-${k}`)!;
        return [k, { cell, val: cell.querySelector<HTMLElement>('.d-sys-v')! }];
      }),
    ) as Record<keyof DescentPodSystems, SysCellRefs>;
  }

  show() { requestAnimationFrame(() => this.el.classList.add('on')); }
  hide() { this.el.classList.remove('on'); }

  update(t: DescentTelemetry) {
    this.updateKinematics(t);
    this.updatePodSystems(t);
    this.updateFlightSequence(t);
    this.updateEnvironment(t);
    this.updateSpectrometer(t);
    this.q.cap.textContent = t.caption;
    this.q.prog.style.width = `${(Math.min(1, Math.max(0, t.progress)) * 100).toFixed(1)}%`;
  }

  private updateKinematics(t: DescentTelemetry) {
    const f = (n: number, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
    if (t.altitudeKm < 1) {
      const m = Math.max(0, t.altitudeKm * 1000);
      this.q.alt.textContent = f(m, m < 100 ? 1 : 0);
      this.q['alt-u'].textContent = 'm';
    } else {
      this.q.alt.textContent = f(t.altitudeKm, t.altitudeKm < 10 ? 2 : 1);
      this.q['alt-u'].textContent = 'km';
    }
    this.q.layer.textContent = t.atmoLayer ?? (t.altitudeKm > 100 ? 'EXOSPHERE' : 'TROPOSPHERE');
    const altPct = Math.min(100, Math.max(0, (t.altitudeKm / 415) * 100));
    this.q['alt-bar'].style.width = `${altPct.toFixed(1)}%`;

    const vsink = t.verticalSpeedMs ?? t.speedKmh / 3.6;
    this.q.vsink.textContent = `↓ ${f(vsink, vsink < 100 ? 1 : 0)} m/s`;
    this.q.spd.textContent = f(t.speedKmh);
    const mach = t.mach ?? t.speedKmh / 1200;
    this.q.mach.textContent = mach >= 0.85 ? `MACH ${f(mach, 1)}` : `SUBSONIC M${f(mach, 2)}`;
    this.q['spd-bar'].style.width = `${Math.min(100, Math.max(0, (t.speedKmh / 28600) * 100)).toFixed(1)}%`;

    const g = t.gForce;
    const peakG = Math.max(t.peakG ?? g, g);
    this.q.g.textContent = f(g, 2);
    this.q['g-peak'].textContent = f(peakG, 1);
    this.q['g-tag'].textContent = gRegimeLabel(t.phase, g);
    const gBand = g > 5.5 ? 'crit' : g > 2.6 ? 'elevated' : 'nominal';
    this.q['g-block'].dataset.band = gBand;
    this.q['g-bar'].style.width = `${Math.min(100, Math.max(0, (g / 9) * 100)).toFixed(1)}%`;
    this.q['g-mark'].style.left = `${Math.min(99, Math.max(0, (peakG / 9) * 100)).toFixed(1)}%`;

    const c = Math.round(t.hullTempC);
    this.q.tc.textContent = fmtSignedTemp(c);
    const tBand = c > 1150 ? 'crit' : c > 450 ? 'hot' : c > 85 ? 'warm' : c < -25 ? 'cold' : 'nominal';
    this.q['temp-block'].dataset.band = tBand;
    this.q.temp.dataset.band = tBand === 'nominal' ? 'warm' : tBand;
    const delta = t.hullTempRateCs !== undefined
      ? t.hullTempRateCs
      : (this.lastTemp === null ? 0 : (c - this.lastTemp) * 2);
    this.lastTemp = c;
    this.q.trend.textContent = delta >= 1.5 ? '▲' : delta <= -1.5 ? '▼' : '';
    this.q['t-state'].textContent = t.thermalState ?? 'NOMINAL';
    const tNorm = Math.min(100, Math.max(2, ((t.hullTempC + 125) / 2250) * 100));
    this.q['t-bar'].style.width = `${tNorm.toFixed(1)}%`;
  }

  private updatePodSystems(t: DescentTelemetry) {
    const sys = t.podSystems;
    if (!sys) return;
    for (const k of POD_SYS_KEYS) {
      const item = sys[k];
      const ref = this.sysCells[k];
      ref.cell.dataset.state = item.state;
      ref.val.textContent = item.text;
    }
  }

  private updateFlightSequence(t: DescentTelemetry) {
    const activeIdx = Math.max(0, STEP_ORDER.findIndex((s) => s.phase === t.phase));
    const stepMeta = STEP_ORDER[activeIdx]!;
    this.q.phase.textContent = stepMeta.title;
    this.q.met.textContent = formatMet(t.t);
    for (let i = 0; i < this.stepEls.length; i++) {
      this.stepEls[i]!.dataset.step = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'upcoming';
    }
    const comms = t.commsState ?? 'LOCKED';
    const sig = t.commsSignalPct ?? 98;
    this.q.comms.dataset.state = comms;
    this.q.comms.textContent = comms === 'BLACKOUT' ? 'RF BLACKOUT' : `LINK ${sig}%`;

    const guidance = t.guidanceState ?? (t.altitudeKm < 0.001 ? 'PAD CONTACT' : t.altitudeKm < 15 ? 'RADAR ALT LOCK' : 'ORBITAL NAV');
    this.q.guidance.textContent = guidance;
    this.q.guidance.dataset.mode = guidance;
    const rngKm = Math.max(0, t.downrangeKm ?? 0);
    this.q.downrange.textContent = rngKm < 1
      ? `${(rngKm * 1000).toFixed(0)} m`
      : `${rngKm.toFixed(rngKm < 10 ? 2 : 1)} km`;

    const bcn = t.beaconState ?? (comms === 'BLACKOUT' ? 'BLACKOUT' : t.altitudeKm < 0.7 ? 'LOCKED' : t.altitudeKm < 15 ? 'ACQUIRED' : 'ORBITAL');
    this.q.beacon.dataset.state = bcn;
    this.q.beacon.textContent = `BCN ${bcn}`;

    const ralt = t.radarAltM !== undefined ? t.radarAltM : (t.altitudeKm <= 14.5 ? t.altitudeKm * 1000 : null);
    if (ralt === null) {
      this.q.ralt.dataset.locked = 'false';
      this.q.ralt.textContent = 'RALT MASKED';
    } else {
      this.q.ralt.dataset.locked = 'true';
      this.q.ralt.textContent = ralt >= 1000
        ? `RALT ${(ralt / 1000).toFixed(2)} km`
        : `RALT ${Math.max(0, ralt).toFixed(ralt < 100 ? 1 : 0)} m`;
    }
  }

  private updateEnvironment(t: DescentTelemetry) {
    const f = (n: number, d = 1) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
    const pKpa = t.staticPressureKpa ?? 0;
    this.q.pres.textContent = pKpa < 10 ? f(pKpa, 2) : f(pKpa, 1);
    this.q['pres-sub'].textContent = pKpa < 0.05 ? 'HARD VACUUM' : `${f(pKpa / 101.325, 2)} atm`;

    const dynQ = t.dynamicPressureKpa ?? 0;
    this.q.dynq.textContent = f(dynQ, 1);
    this.q.maxq.dataset.on = String(Boolean(t.isMaxQ));
    const rho = t.atmoDensityKgM3 ?? 0;
    this.q.rho.textContent = rho < 0.001 ? 'ρ 0.000 kg/m³' : `ρ ${f(rho, 3)} kg/m³`;

    const grav = t.surfaceGravityG ?? 1.0;
    this.q['grav-chip'].textContent = `GRAV ${f(grav, 2)}g`;
    const amb = t.ambientTempC ?? 15;
    this.q['ext-air'].textContent = `EXT ${fmtSignedTemp(amb)} °C`;

    const clock = t.localSolarClock ?? '09:00';
    const period = t.localDayPeriod ?? 'DAY';
    this.q['solar-clock'].textContent = clock;
    this.q['solar-period'].textContent = period;
    this.q['solar-period'].dataset.period = period;
  }

  private updateSpectrometer(t: DescentTelemetry) {
    const intake = Math.min(1, Math.max(0, t.intakeProgress ?? (t.altitudeKm < 90 ? 1 : 0)));
    const status = t.atmoStatus ?? (intake < 0.05 ? 'VACUUM TRACE' : intake < 0.96 ? 'IONIZED INTAKE' : 'ANALYSIS LOCKED');
    this.q['atmo-status'].dataset.status = status;
    this.q['atmo-status'].textContent = status === 'IONIZED INTAKE' ? `SAMPLING ${Math.round(intake * 100)}%` : status;

    const gases = t.atmoGases ?? DEFAULT_GASES;
    for (let i = 0; i < this.gasRows.length; i++) {
      const ref = this.gasRows[i]!;
      const g = gases[i];
      if (!g) {
        ref.row.style.display = 'none';
        continue;
      }
      ref.row.style.display = '';
      ref.row.dataset.role = g.role;
      ref.formula.textContent = g.formula;
      if (intake < 0.06) {
        ref.bar.style.width = '0%';
        ref.val.textContent = '---';
      } else {
        const shown = g.pct * intake;
        const barW = Math.min(100, Math.pow(shown / 100, 0.58) * 100);
        ref.bar.style.width = `${barW.toFixed(1)}%`;
        ref.val.textContent = `${shown.toFixed(1)}%`;
      }
    }

    this.q['atmo-sum'].textContent =
      intake < 0.06
        ? 'EXOSPHERE H₂/He TRACE — AWAITING INTAKE'
        : intake < 0.96
          ? 'SPECTROMETER CONVERGING ON BOW-SHOCK GAS…'
          : (t.atmoSummary ?? 'BREATHABLE · TEMPERATE STD');

    const ppO2 = t.ppO2Kpa ?? 0;
    if (intake < 0.2 || ppO2 < 0.05) {
      this.q.ppo2.textContent = 'ppO₂ ---';
      this.q.ppo2.dataset.band = 'vac';
    } else {
      this.q.ppo2.textContent = `ppO₂ ${ppO2.toFixed(1)} kPa`;
      this.q.ppo2.dataset.band = ppO2 >= 15.5 ? 'norm' : 'hypo';
    }
  }

  dispose() { this.el.remove(); }
}
