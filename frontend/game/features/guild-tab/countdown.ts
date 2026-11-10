/**
 * Remaining time until `departAt` (unix ms), on the wall clock.
 * `MMm SSs`, or `Hh MMm SSs` once an hour is left. `Departed` when nothing remains.
 * Seconds are rounded up, so the last partial second still reads `00m 01s`.
 */
export function formatDepartCountdown(departAt: number, now: number): string {
  const leftMs = departAt - now;
  if (leftMs <= 0) return 'Departed';
  const total = Math.ceil(leftMs / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}h ${mm}m ${ss}s` : `${mm}m ${ss}s`;
}
