export type PredictionMode = 'on' | 'off' | 'auto-off';

/** What the worker reports with each view about prediction. */
export interface PredictionInfo { mode: PredictionMode; pending: number; p95Ms: number }

export interface NetStatsView extends PredictionInfo { rollbacks: number; correctionTiles: number }

/** Dev-overlay counters kept on the main thread: rolled-back commands and the last correction the renderer applied. */
export class NetStatsBoard {
  rollbacks = 0;
  correctionTiles = 0;
  recordRollback(): void { this.rollbacks++; }
  recordCorrection(tiles: number): void { this.correctionTiles = tiles; }
  view(info: PredictionInfo): NetStatsView { return { ...info, rollbacks: this.rollbacks, correctionTiles: this.correctionTiles }; }
}
