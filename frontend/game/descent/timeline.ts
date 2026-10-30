import type { DescentPhase, DescentTelemetry } from './types';
import { clamp, lerp, makeCurve, smoothstep } from './math';
import { TL, Y0 } from './constants';

const PHASES: [number, DescentPhase][] = [[4, 'orbit'], [8, 'release'], [15, 'freefall'], [23, 'reentry'], [29, 'chute'], [34, 'retro'], [99, 'touchdown']];
export const phaseOf = (t: number): DescentPhase => { for (const [e, p] of PHASES) if (t < e) return p; return 'touchdown'; };

// pod altitude above ground (carrier-docked until 4 s)
export const altCurve = makeCurve([[0, Y0], [4, Y0], [8, 585], [15, 470], [23, 230], [29, 60], [34, 0], [35, 0]]);
const speedCurve = makeCurve([[0, 27600], [4, 27600], [8, 27200], [15, 21000], [19, 9800], [23, 2400], [25, 900], [29, 320], [34, 12], [35, 0]]);
const gCurve = makeCurve([[0, 0], [8, 0.1], [14, 0.6], [17, 3.5], [19.5, 6.8], [22, 4.0], [23, 2.0], [24, 3.8], [25, 1.2], [29, 1.0], [30, 2.4], [33, 1.6], [34, 1.0], [35, 1.0]]);
export const streakSpeed = makeCurve([[0, 0], [8, 0], [10, 60], [15, 180], [19, 260], [23, 150], [26, 30], [29, 0]]);

function caption(t: number, name: string): string {
  if (t < 2) return 'Carrier on station — drop bay arming';
  if (t < 4) return 'Bay open — pod clamps releasing';
  if (t < 8) return 'Drop pod away — separation nominal';
  if (t < 15) return 'Freefall — entry corridor locked';
  if (t < 23) return 'Atmospheric interface — hold on';
  if (t < 26) return 'Heat shield jettisoned — chute deploying';
  if (t < 29) return 'Chute stable — punching through the cloud deck';
  if (t < 34) return 'Retro-thrusters firing — brace for touchdown';
  if (t < 34.6) return 'Touchdown confirmed — pod opening';
  return `Surface contact — welcome to ${name}`;
}

/** HUD telemetry derived from the authored timeline; `dens` is the planet's atmosphere density. */
export class Telemetry {
  constructor(private dens: number, private name: string, private duration: number, private tScale: number) {}

  /** Skin temperature: cold soak in orbit, steep rise in the plasma, residual soak-back after the shield drops, retro heat. */
  private hullTemp(tn: number, heat: number) {
    const peak = 1450 + 650 * this.dens;
    const soak = 260 * smoothstep(21, 24, tn) * (1 - smoothstep(26, 33, tn));   // hot structure cooling down slowly
    const retro = 140 * smoothstep(28.9, 30, tn) * (1 - smoothstep(34, 35, tn));
    const ambient = lerp(-40, 18, smoothstep(22, 32, tn));                      // space cold → planet air
    return ambient + peak * Math.pow(heat, 1.15) + soak + retro;
  }

  /** Writes the telemetry for authored second `tn` (with the live plasma `heat` envelope) into `out`. */
  fill(out: DescentTelemetry, tn: number, heat: number): DescentTelemetry {
    out.t = tn / this.tScale; out.duration = this.duration; out.progress = clamp(tn / TL);
    out.phase = phaseOf(tn);
    out.altitudeKm = 400 * Math.pow(Math.max(altCurve(tn), 0) / Y0, 1.6);
    out.speedKmh = speedCurve(tn);
    out.gForce = gCurve(tn) * (0.75 + 0.5 * this.dens);
    out.heatPct = heat * 100;
    out.hullTempC = this.hullTemp(tn, heat);
    out.caption = caption(tn, this.name);
    return out;
  }

  /** Fresh telemetry for any authored second (no heat). */
  at = (tn: number): DescentTelemetry =>
    this.fill({ t: 0, duration: this.duration, progress: 0, phase: 'orbit', altitudeKm: 0, speedKmh: 0, gForce: 0, heatPct: 0, hullTempC: 0, caption: '' }, tn, 0);
}
