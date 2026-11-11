const GUILD_ACTORS = new Set(['npc', 'guild']);

/** Two Guild books must not cross. `npc` is the order actor; `guild` is the badge some books already store. */
export function sameGuild(
  a: { readonly actorKind?: string | null },
  b: { readonly actorKind?: string | null },
): boolean {
  return GUILD_ACTORS.has(a.actorKind ?? '') && GUILD_ACTORS.has(b.actorKind ?? '');
}
