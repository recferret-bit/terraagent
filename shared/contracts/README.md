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

Add one file to `src/commands/` or `src/events/` (never edit a shared list); the generator builds the `CommandKind` /
`EventKind` unions and the JSON-Schema snapshot that CI diffs.
