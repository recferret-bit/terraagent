/** Phone landscape the Bounties sheet must fit (W22-25). */
export const BOUNTY_PHONE = { width: 740, height: 360 } as const;

const GUTTER = 16;
const PREFERRED_W = 420;
const PREFERRED_H = 320;

/** Preferred sheet box. The stylesheet uses the same 420 / 320 / 16 gutter; the inner pane scrolls. */
export function bountyPanelBounds(
  width: number,
  height: number,
): { maxWidth: number; maxHeight: number; scroll: true } {
  return {
    maxWidth: Math.min(PREFERRED_W, Math.max(0, width - GUTTER)),
    maxHeight: Math.min(PREFERRED_H, Math.max(0, height - GUTTER)),
    scroll: true,
  };
}
