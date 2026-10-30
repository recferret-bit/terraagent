# @terra/contracts

zod schemas for every message that crosses a boundary. `docs/spec/PROTOCOL.md` is the human-readable mirror; on a
conflict the spec wins and the code is fixed.

| Folder | What |
|---|---|
| `src/ids` | Prefixed ULIDs (`newId('cm')`, `PlayerId`, `PlanetId`, …), PR-02 |
| `src/envelope` | `ClientEnvelope` (strict, PR-01) and `ServerEnvelope` (permissive), `v: 1` |
| `src/ws` | Client → app and app → client messages, the engine sync payloads and the wire codec |
| `src/errors` | `RejectCode` (incl. `wave_disabled`, `host_unavailable`), `CLOSE_CODES`, REST error codes |
| `src/flags` | Wave flag ids and the `TA_WAVES` / `?waves=` parser |
| `src/commands/*.ts` | One file per command kind: `export const command = defineCommand({...})` |
| `src/events/*.ts` | One file per event kind: `export const event = defineEvent({...})` |

## Wire format (D-31)

- Every message is a JSON text frame (`WS-01`), **except** messages that carry engine bytes: `welcome.d.state` (engine
  snapshot) and `delta.d.diff` (engine diff) are `Uint8Array`s, and such a message is sent as **one binary frame**
  holding the MessagePack encoding of the whole envelope. `encodeWire(msg)` picks the format, `decodeWire(frame)`
  reverses it; both ends then validate with the schemas.
- Inbound (client → server) schemas are strict at every level: unknown keys fail. Clients parse server messages
  permissively.

## Adding a command or event kind

1. Add ONE file: `src/commands/<name>.ts` exporting `command = defineCommand({ kind, wave, origin, args, summary })`, or
   `src/events/<name>.ts` exporting `event = defineEvent({ kind, wave, severity, audience, data, summary })`. Never edit a
   shared list. Files starting with `_` and `define.ts` / `index.ts` / `*.generated.ts` are not kinds.
2. Run `npm run gen`. It rewrites `src/{commands,events}/index.generated.ts` (`COMMANDS`, `COMMAND_KINDS`, `CommandKind`,
   `CommandKindSchema`, `commandDef(kind)`, `parseCommandArgs(kind, args)`; `EVENTS`, `EVENT_KINDS`, `EventKind`,
   `EventKindSchema`, `eventDef(kind)`) and the JSON-Schema snapshot `schema/contracts.schema.json`.
3. Commit the generated files with the kind file. `npm run gen:check` (part of `npm run check`, i.e. CI) fails while they
   are stale, so a contract change can never land without an explicit, reviewable snapshot diff.
4. A snapshot diff is a protocol change: reviewers check that `docs/spec/PROTOCOL.md` was updated with it (PR-06).

The `cmd` envelope keeps `kind: string`; the server routes on it, answers unknown kinds with `cmd.reject unknown_kind`
and validates `args` with `parseCommandArgs(kind, args)`.
