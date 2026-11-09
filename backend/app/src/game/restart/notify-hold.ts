/** Planets tell the router when a restart catch-up starts, finishes, or stops early. */
export interface FastRunAlertSource {
  onFastRunStart(fn: (planetId: string) => void): void;
  onFastRun(fn: (planetId: string, seconds: number, ticks: number) => void): void;
  onFastRunAbort(fn: (planetId: string) => void): void;
}

export interface FastRunAlertSink {
  beginFastRun(planetId: string): void;
  flushFastRun(planetId: string): Promise<{ readonly sent: number }>;
  dropFastRun(planetId: string): void;
}

/**
 * Holds `NotifierPort.send` from the moment a restart catch-up is marked until `fastRan` (CT-54).
 * A gap of 0 never starts a run, so live notifications are not delayed.
 */
export function installFastRunAlertHold(planets: FastRunAlertSource, router: FastRunAlertSink): void {
  planets.onFastRunStart((planetId) => router.beginFastRun(planetId));
  planets.onFastRun((planetId) => {
    void router.flushFastRun(planetId);
  });
  planets.onFastRunAbort((planetId) => router.dropFastRun(planetId));
}
