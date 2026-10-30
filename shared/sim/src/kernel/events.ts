/** An event emitted by a system or command handler during a step (SIMULATION §9). */
export interface SimEvent {
  kind: string;
  severity: 'info' | 'warn' | 'critical';
  atTick: number;
  colonyIds: string[];
  data: Record<string, unknown>;
}

export type EmitInput = Omit<SimEvent, 'atTick' | 'severity' | 'colonyIds' | 'data'> & Partial<Pick<SimEvent, 'severity' | 'colonyIds' | 'data'>>;
