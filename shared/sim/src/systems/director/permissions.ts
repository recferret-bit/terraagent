/** Player flags for later-wave strategies. Risk is not a flag and never grants one. */
export interface StrategyPermissions {
  readonly raids: boolean;
  readonly upgrades: boolean;
  readonly launch: boolean;
}

/** True only when that strategy's own flag is on. All false denies diplomacy, technology and settlement. */
export function strategyPermitted(skillId: 'diplomacy' | 'technology' | 'settlement', perms: StrategyPermissions): boolean {
  switch (skillId) {
    case 'diplomacy': return perms.raids;
    case 'technology': return perms.upgrades;
    case 'settlement': return perms.launch;
  }
}
