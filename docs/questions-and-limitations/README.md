# Questions and limitations

Known limitations, deliberate trade-offs and open questions that the code does **not** handle (yet). One file per
area. Agents and people write here so a gap that was found once is not forgotten, rediscovered or "fixed" in a way
that breaks a deliberate choice.

| File | Area |
|---|---|
| [`economy-ledger.md`](./economy-ledger.md) | Colony resources: treasury, ledger journal (server, browser host), seating and landing |

## When to write an entry (mandatory for agents)

Add or update an entry in the same change whenever any of these happens:

- you finish a task and something is knowingly left undone, partly done, or done with a trade-off;
- a review (yours, a subagent's, a reviewer's) reports an issue you decide not to fix now;
- you hit a question only the owner can decide and you go ahead with a default;
- a test, probe or reviewer shows behaviour that is surprising but intended ("by design").

Before working in an area, read its file: an entry may already explain why the code looks the way it does.
When you fix an entry, do not delete it: set its status to `Resolved` and name the commit or change. When a
new area appears, create `<area>.md` here and add it to the table above.

## Entry format

Number entries per file with a short prefix (`LED-01`, `LED-02`, …), never reuse a number, and keep them in
this shape:

```md
### LED-07 · Short title

- **Status:** Open | Accepted (by design) | Question for the owner | Resolved (<commit or PR>)
- **Area / code:** `path/to/file.ts` (function), related docs
- **What happens:** the concrete situation and its effect (inputs → outcome)
- **Why it is like this:** the reason or the trade-off chosen
- **Workaround / mitigation:** what limits the damage today, if anything
- **To resolve:** the change that would remove it, or the question to answer (with a recommendation)
- **Found:** date, by whom (session, review, test)
```

Write plainly: what happens and why, no speculation. Link code with repo-relative paths.
