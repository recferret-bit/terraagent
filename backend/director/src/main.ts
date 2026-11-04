/**
 * Director worker entry. It does not import the Nest app or a game-table client.
 * Provider calls and the queue live here; colony writes stay in the game authority (AI §1).
 */
export function directorBoot(): { ok: true; role: 'director'; gameDb: 'none' } {
  return { ok: true, role: 'director', gameDb: 'none' };
}
