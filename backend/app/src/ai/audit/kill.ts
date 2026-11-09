export type KillScope = 'global' | `planet:${string}` | `colony:${string}`;

export interface KillDecision {
  readonly ok: boolean;
  readonly code: 'unauthorized' | 'killed' | 'ok';
}

/**
 * Admin kill switch (AI-11, D-45). A wrong admin token is refused and does not change state.
 * Once killed, a late provider result is rejected and any bound W13 bot trade keys for that
 * scope are stopped immediately. The check is immediate; callers must run it at claim,
 * each tool turn and apply, which is what makes it effective within 5s.
 */
export class DirectorKillSwitch {
  private readonly killedAt = new Map<string, number>();
  private readonly botKeysByScope = new Map<string, Set<string>>();
  private readonly stoppedBotKeys = new Set<string>();

  constructor(private readonly adminToken: string) {}

  /** Registers a colony-bound W13 bot trading key so killing the AI scope also stops its bot key (D-45). */
  bindBotKey(scope: KillScope, botKeyId: string): void {
    let set = this.botKeysByScope.get(scope);
    if (!set) {
      set = new Set<string>();
      this.botKeysByScope.set(scope, set);
    }
    set.add(botKeyId);
    if (this.killedAt.has('global') || this.killedAt.has(scope)) {
      this.stoppedBotKeys.add(botKeyId);
    }
  }

  /** True if the bot key was stopped by a colony, planet, or global AI kill switch (D-45). */
  isBotKeyKilled(botKeyId: string): boolean {
    return this.stoppedBotKeys.has(botKeyId);
  }

  kill(scope: KillScope, token: string, nowMs: number): KillDecision {
    if (token !== this.adminToken) return { ok: false, code: 'unauthorized' };
    this.killedAt.set(scope, nowMs);
    if (scope === 'global') {
      for (const keys of this.botKeysByScope.values()) {
        for (const keyId of keys) this.stoppedBotKeys.add(keyId);
      }
    } else {
      for (const keyId of this.botKeysByScope.get(scope) ?? []) {
        this.stoppedBotKeys.add(keyId);
      }
    }
    return { ok: true, code: 'killed' };
  }

  /** Global kill, or a kill on this exact scope, rejects the result. */
  acceptResult(scope: KillScope, token: string): KillDecision {
    if (token !== this.adminToken && token !== 'worker') return { ok: false, code: 'unauthorized' };
    if (this.killedAt.has('global') || this.killedAt.has(scope)) return { ok: false, code: 'killed' };
    return { ok: true, code: 'ok' };
  }
}
