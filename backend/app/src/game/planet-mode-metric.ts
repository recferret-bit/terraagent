import { Gauge, type Registry } from 'prom-client';

export interface PlanetModeStat {
  readonly mode: 'active' | 'coarse';
}

/** `ta_game_planet_mode{mode}` from the same thread stats as `ta_game_planets`. Both labels are set on every scrape. */
export function installPlanetModeGauge(
  reg: Registry,
  stats: () => Promise<readonly { readonly planets: readonly PlanetModeStat[] }[]>,
): void {
  new Gauge({
    name: 'ta_game_planet_mode',
    help: 'Loaded planets by step mode (active = 5 TPS, coarse = dt 5 once per second)',
    labelNames: ['mode'],
    registers: [reg],
    async collect() {
      this.reset();
      let active = 0;
      let coarse = 0;
      for (const thread of await stats()) {
        for (const planet of thread.planets) {
          if (planet.mode === 'coarse') coarse += 1;
          else active += 1;
        }
      }
      this.set({ mode: 'active' }, active);
      this.set({ mode: 'coarse' }, coarse);
    },
  });
}
