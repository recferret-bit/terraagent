import type { DescentGasSample, DescentPhase, DescentPodSystems } from '@terra/render/descent/types';

export const STEP_ORDER: readonly { readonly phase: DescentPhase; readonly code: string; readonly title: string }[] = [
  { phase: 'orbit', code: 'ORB', title: 'ORBITAL STATION' },
  { phase: 'release', code: 'SEP', title: 'BAY SEPARATION' },
  { phase: 'freefall', code: 'FALL', title: 'GRAVITY FREEFALL' },
  { phase: 'reentry', code: 'ENTRY', title: 'PLASMA REENTRY' },
  { phase: 'chute', code: 'CHUTE', title: 'CANOPY DESCENT' },
  { phase: 'approach', code: 'APPR', title: 'TERMINAL VECTOR' },
  { phase: 'retro', code: 'RETRO', title: 'RETRO-BURN' },
  { phase: 'touchdown', code: 'LAND', title: 'TOUCHDOWN' },
];

export const DEFAULT_GASES: readonly DescentGasSample[] = [
  { formula: 'N₂', name: 'Nitrogen', pct: 77.4, role: 'inert' },
  { formula: 'O₂', name: 'Oxygen', pct: 20.9, role: 'oxidizer' },
  { formula: 'Ar', name: 'Argon', pct: 1.2, role: 'inert' },
  { formula: 'CO₂', name: 'Carbon Dioxide', pct: 0.4, role: 'greenhouse' },
  { formula: 'CH₄', name: 'Methane', pct: 0.1, role: 'trace' },
];

export const POD_SYS_KEYS: readonly (keyof DescentPodSystems)[] = ['clamps', 'shield', 'chute', 'retro', 'gear', 'hatch'];

const INITIAL_SYS: Record<keyof DescentPodSystems, { code: string; text: string }> = {
  clamps: { code: 'CLMP', text: 'LOCKED' },
  shield: { code: 'SHLD', text: 'ARMED' },
  chute: { code: 'CHUT', text: 'STOWED' },
  retro: { code: 'RTRO', text: 'ARMED' },
  gear: { code: 'GEAR', text: 'STOWED' },
  hatch: { code: 'HTCH', text: 'SEALED' },
};

export function buildDescentHudMarkup(): string {
  const stepsHtml = STEP_ORDER.map(
    (s) => `<span class="d-step" data-phase="${s.phase}" data-step="upcoming">${s.code}</span>`,
  ).join('');
  const gasRowsHtml = Array.from({ length: 5 }, () =>
    `<div class="d-gas-row" data-role="inert"><span class="d-gas-f">—</span><i class="d-gas-track"><em class="d-gas-bar"></em></i><span class="d-gas-v">---</span></div>`,
  ).join('');
  const sysHtml = POD_SYS_KEYS.map((k) => {
    const m = INITIAL_SYS[k];
    return `<div class="d-sys-cell" id="d-sys-${k}" data-sys="${k}" data-state="stby"><span class="d-sys-k">${m.code}</span><b class="d-sys-v">${m.text}</b></div>`;
  }).join('');

  return `<div class="lb top"></div><div class="lb bot"></div>
    <div class="telemetry d-panel d-kinematics plate-sm">
      <div class="d-panel-head"><span>POD KINEMATICS</span><span id="d-layer">EXOSPHERE</span></div>
      <div class="d-metric">
        <div class="d-metric-top"><span class="d-k">ALTITUDE</span><span class="d-sub" id="d-vsink">↓ 0.0 m/s</span></div>
        <div class="d-val-row"><span class="d-val-main"><b id="d-alt">—</b><span class="u" id="d-alt-u">km</span></span></div>
        <div class="d-bar d-bar--energy"><i id="d-alt-bar"></i></div>
      </div>
      <div class="d-metric">
        <div class="d-metric-top"><span class="d-k">VELOCITY</span><span class="d-tag" id="d-mach">M 0.0</span></div>
        <div class="d-val-row"><span class="d-val-main"><b id="d-spd">—</b><span class="u">km/h</span></span></div>
        <div class="d-bar"><i id="d-spd-bar"></i></div>
      </div>
      <div class="d-metric d-g-block" id="d-g-block" data-band="nominal">
        <div class="d-metric-top"><span class="d-k">G-FORCE</span><span class="d-tag" id="d-g-tag">0-G MICROGRAV</span></div>
        <div class="d-val-row">
          <span class="d-val-main"><b id="d-g">—</b><span class="u">g</span></span>
          <span class="d-sub">PEAK <span id="d-g-peak">0.0</span>g</span>
        </div>
        <div class="d-g-meter"><i id="d-g-bar"></i><em id="d-g-mark"></em></div>
      </div>
      <div class="d-metric d-temp-block" id="d-temp-block" data-band="nominal">
        <div class="d-metric-top"><span class="d-k">TPS HULL TEMP</span><span class="d-tag" id="d-t-state">BAY STANDBY</span></div>
        <div class="d-val-row">
          <div class="temp" id="d-temp"><b id="d-tc">+18</b><span class="u">°C</span><span class="trend" id="d-trend"></span></div>
        </div>
        <div class="d-bar"><i id="d-t-bar"></i></div>
      </div>
      <div class="d-sys-strip" id="d-sys-strip">${sysHtml}</div>
    </div>
    <div class="d-right-col">
      <div class="d-panel d-flight-plate plate-sm">
        <div class="d-panel-head"><span>FLIGHT SEQUENCE</span><span class="d-comms" id="d-comms" data-state="LOCKED">LINK 98%</span></div>
        <div class="d-phase-row"><span class="d-phase-name" id="d-phase">orbit</span><span class="d-met" id="d-met">T+00:00.0</span></div>
        <div class="d-stepper" id="d-stepper">${stepsHtml}</div>
        <div class="d-nav-row"><span class="d-guidance" id="d-guidance" data-mode="ORBITAL NAV">ORBITAL NAV</span><span class="d-rng">LZ <b id="d-downrange">684.0 km</b></span></div>
        <div class="d-lock-row"><span class="d-beacon" id="d-beacon" data-state="STANDBY">BCN STANDBY</span><span class="d-ralt" id="d-ralt" data-locked="false">RALT MASKED</span></div>
      </div>
      <div class="d-panel d-env-plate plate-sm">
        <div class="d-panel-head"><span>PLANETARY SENSORS</span><span id="d-grav-chip">GRAV 1.00g</span></div>
        <div class="d-env-grid">
          <div class="d-env-cell"><span class="d-k">STATIC PRES</span><div><b id="d-pres">0.00</b> <span class="u">kPa</span></div><small id="d-pres-sub">HARD VACUUM</small></div>
          <div class="d-env-cell"><span class="d-k">DYNAMIC Q<span class="d-maxq" id="d-maxq" data-on="false">MAX-Q</span></span><div><b id="d-dynq">0.0</b> <span class="u">kPa</span></div><small id="d-rho">ρ 0.000 kg/m³</small></div>
        </div>
        <div class="d-solar-row">
          <span class="d-k">SOLAR · <span class="d-ext-air" id="d-ext-air">EXT −145 °C</span></span>
          <span class="d-solar-val"><b id="d-solar-clock">09:00</b><span class="d-period" id="d-solar-period" data-period="DAY">DAY</span></span>
        </div>
        <div class="d-spec">
          <div class="d-spec-head"><span class="d-k">ATMO CHEM ANALYSIS</span><span class="d-spec-status" id="d-atmo-status" data-status="VACUUM TRACE">VACUUM TRACE</span></div>
          <div class="d-gas-list" id="d-gas-list">${gasRowsHtml}</div>
          <div class="d-spec-foot"><span class="d-spec-sum" id="d-atmo-sum">EXOSPHERE TRACE — AWAITING INTAKE</span><span class="d-ppo2" id="d-ppo2" data-band="vac">ppO₂ ---</span></div>
        </div>
      </div>
    </div>
    <div class="caption" id="d-cap"></div>
    <div class="progress"><i id="d-prog"></i></div>
    <div class="skip">PRESS ESC / SPACE TO SKIP</div>`;
}
