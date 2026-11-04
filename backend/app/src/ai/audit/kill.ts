export type KillScope = 'global' | `planet:${string}` | `colony:${string}`;

export interface KillDecision {
  readonly ok: boolean;
  readonly code: 'unauthorized' | 'killed' | 'ok';
}

/**
 * Admin kill switch (AI-11). A wrong admin token is refused and does not change state.
 * Once killed, a late provider result is rejected. The check is immediate; callers must
 * run it at claim, each tool turn and apply, which is what makes it effective within 5s.
 */
export class DirectorKillSwitch {
  private readonly killedAt = new Map<string, number>();

  constructor(private readonly adminToken: string) {}

  kill(scope: KillScope, token: string, nowMs: number): KillDecision {
    if (token !== this.adminToken) return { ok: false, code: 'unauthorized' };
    this.killedAt.set(scope, nowMs);
    return { ok: true, code: 'killed' };
  }

  /** Global kill, or a kill on this exact scope, rejects the result. */
  acceptResult(scope: KillScope, token: string): KillDecision {
    if (token !== this.adminToken && token !== 'worker') return { ok: false, code: 'unauthorized' };
    if (this.killedAt.has('global') || this.killedAt.has(scope)) return { ok: false, code: 'killed' };
    return { ok: true, code: 'ok' };
  }
}
