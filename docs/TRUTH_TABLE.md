# Realtime Kanban: Truth Table

**Status:** APPROVED 2026-09-29 (D1–D7, C4 behavior, R3 hard block). Changes to rows need a note in §14.
**Rule:** Every row has an ID. Every ID becomes at least one test. If a behavior has no row here, it is out of scope until we add a row.

Test level legend: **U** = unit (pure functions, no network) · **I** = integration (real server + 2 or more clients in one process) · **E** = end-to-end (Playwright, real browsers).

---

## 1. Architecture decisions (review these first)

### D1. Split data by how it should merge. CRDT for text, server-validated intents for structure. ✅ Approved

| Data | Examples | Strategy | Why |
|---|---|---|---|
| **Content** | card title, card description, column title | **Yjs CRDT** (`Y.Text`) | Text is where merging matters most. If Alice and Bob both type in the same title, a CRDT keeps both edits. Last-write-wins would throw one away. The server never needs to reject text. |
| **Structure** | card exists / deleted, which column, order, WIP limit | **Intents** (named mutations) that the **server validates**, applied optimistically on the client | These have *invariants* (WIP limit, can't delete a non-empty column). An invariant needs someone who can say "no", and a pure CRDT can't say no. |

**Why not put everything in Yjs and let the server reject bad updates?** Yjs updates from one client form a contiguous chain (clock 1, 2, 3, …). Suppose the server rejects update #5. Then #6, #7, … all depend on #5, so the server can never apply them, and that client is stuck. If the rejectable parts are kept out of the CRDT, a rejected move never costs anyone their typing.

This split is also the honest interview answer: *"CRDT where a merge is meaningful, server authority where invariants exist."* Figma, Linear and Replicache-style apps all make this same split.

### D2. Two Yjs docs per board
- `content` doc: `Y.Map<key, Y.Text>`, with keys `card:{id}:title`, `card:{id}:desc`, `column:{id}:title`. Clients and the server exchange Yjs updates freely.
- `structure` doc: **only the server writes to it.** Clients receive it as the *confirmed* state.
  - `columns: Y.Map<columnId, {order, wipLimit, deleted}>`
  - `cards: Y.Map<cardId, {columnId, order, deleted}>`
  - Each value is **one plain object**, so a move (`columnId` + `order`) is replaced atomically. A card can never end up with column A's id and column B's order.

### D3. Client view = confirmed state + replay(pending intents)
The client never changes its confirmed state speculatively. It renders `view = applyAll(confirmed, outbox)`. When state changes, it recomputes:
- **ack:** the intent leaves the outbox. Its effect is already in the confirmed state, so nothing moves on screen.
- **nack:** the intent leaves the outbox and the view is recomputed, so the item snaps back. **This is the rollback.**
- **Someone else's update arrives:** the confirmed state changes and pending intents are replayed on top (a "rebase").

### D4. Shared mutators
Each intent (`createCard`, `moveCard`, `deleteCard`, `restoreCard`, `createColumn`, `moveColumn`, `deleteColumn`, `setWipLimit`) is **one pure function** in a shared package: `(state, args) => {ok, patch} | {error: code}`. The client runs it to predict the result. The server runs the same function to decide. Because both sides use the same code, prediction and decision can't drift apart.

### D5. Ordering uses fractional indexing
`order` is a string key that sorts between its neighbours (`"a0"`, `"a0V"`, `"a1"`). A move changes one card's key and no other card's. Ties are broken by `(order, id)`.

### D6. Presence uses the Yjs awareness protocol
Presence is ephemeral. It travels on the same socket but is never persisted, never undoable, and never stored offline.

### D7. Stack ✅ Approved
pnpm monorepo. `packages/shared` (mutators, types; TypeScript + zod + vitest) · `apps/server` (Node + `ws` + Yjs + SQLite) · `apps/web` (Vite + React + TS, dnd-kit, IndexedDB).
Not Next.js: the board is entirely client-side (no benefit from server rendering), Yjs and IndexedDB are browser-only, and the WebSocket server has to be a separate process anyway.

---

## 2. Sync and convergence (S)

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| S1 | A and B open the same board | both are connected | they render identical boards | I |
| S2 | A and B connected (localhost) | A makes any change | B sees it in < 200 ms (p95) | I/E |
| S3 | N clients, random intents and text edits, random delivery order and delays | all messages are delivered | the server and every client have byte-identical `structure` and identical `content` text (**property test**) | I |
| S4 | the board has history | C joins late | C receives a full snapshot, then only incremental updates | I |
| S5 | the board has data | the server restarts | the state is preserved (persisted to disk/SQLite) | I |
| S6 | boards X and Y exist | a change happens on X | clients on Y receive nothing | I |
| S7 | — | — | all traffic goes through the server; there is no peer-to-peer | — |

## 3. Conflicts: concurrent edits (C)

"Concurrent" means neither user had seen the other's change when they made their own. For structure, "first" means *first processed by the server*.

| ID | User A does | User B does (concurrently) | Result, identical on every client | Why | Test |
|---|---|---|---|---|---|
| C1 | appends " now" to title "Fix bug" | prepends "Urgent: " | `Urgent: Fix bug now` | CRDT merges | U/I |
| C2 | types "X" at position 3 | types "Y" at position 3 | both are kept, in a deterministic order (the same everywhere) | CRDT tie-break by client ID | U |
| C3 | deletes the characters 2–8 | inserts "Z" at position 5 | "Z" survives | CRDT: an insert is never swallowed by a concurrent delete | U |
| C4 | moves card X to column 2 | moves card X to column 3 | X ends up where the **later-processed** move put it. **Never duplicated, never lost.** The losing user gets **no toast**; the card animates to its new place with a brief highlight (same as Figma, Linear and Trello). Presence (P3/P4) is what prevents most of these conflicts | per-card LWW in server order (D2 atomic value) | U/I |
| C5 | moves card X | edits X's title | both apply | structure and content are independent | I |
| C6 | deletes card X | edits X's title | X is hidden (soft delete). B's edit **is kept**. If A undoes, X returns *with* B's edit | soft delete + separate content doc | I |
| C7 | deletes card X | moves card X | processed as delete→move: the move is rejected (`CARD_DELETED`) and B rolls back. Processed as move→delete: both apply and X is deleted | server validation | I |
| C8 | inserts a card between P and Q | inserts a card between P and Q | both cards exist. Order is by `(order, id)`, the same everywhere | D5 tie-break | U |
| C9 | deletes empty column K | moves a card into K | whichever is processed first wins, and the other is rejected (`COLUMN_DELETED` or `COLUMN_NOT_EMPTY`) | invariant R2/R4 | I |
| C10 | moves a card into column K (limit 3, has 2 cards) | moves another card into K | first is accepted, second is rejected (`WIP_LIMIT`) | invariant R3 | I |
| C11 | reorders column K | reorders column K | the later-processed reorder wins | per-column LWW | U |
| C12 | sets K's WIP limit to 2 | moves a 3rd card into K | whichever is processed first wins, and the other is rejected | R3/R5 | I |

## 4. Server rules / invariants (R)

The server rejects an intent with a code when a rule fails. The client shows a human-readable message for each code.

| ID | Rule | Reject code | Test |
|---|---|---|---|
| R1 | Users with the `viewer` role can't write: every intent is rejected and every content update is dropped (not broadcast) | `FORBIDDEN` | I |
| R2 | A card's `columnId` must be a live (not deleted) column | `COLUMN_DELETED` | U |
| R3 | A column with `wipLimit = n` can't hold more than `n` live cards. **Hard block**, not a warning, so the server has a real reason to reject and we can demonstrate rollback | `WIP_LIMIT` | U |
| R4 | A column can only be deleted when it has 0 live cards | `COLUMN_NOT_EMPTY` | U |
| R5 | A WIP limit can't be set below the column's current card count | `WIP_BELOW_COUNT` | U |
| R6 | A deleted card can't be moved (restore it first) | `CARD_DELETED` | U |
| R7 | Unknown intent, bad args, or unknown IDs are rejected | `INVALID` | U |
| R8 | **Idempotency:** a repeated intent `id` is acked again and **not** applied twice | — (ack) | I |
| R9 | Preconditions: an intent carrying `expect` is rejected if the current state doesn't match (used by undo, see U4) | `STALE` | U |

## 5. Optimistic updates and rollback (O)

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| O1 | online, 300 ms artificial latency | A moves a card | the card moves **in the same frame**, before any network reply | E |
| O2 | an intent is pending | — | the affected item shows a subtle "saving" indicator | E |
| O3 | an intent is pending | ack arrives | the indicator clears and **nothing moves**. The server sends the structure update *before* the ack, so the confirmed state already contains the effect | I |
| O4 | an intent is pending | nack arrives | the item animates back to its confirmed position, a toast shows the reason, and the same text goes to an `aria-live` region | I/E |
| O5 | intents i1 (create card X) and i2 (move X) are pending | i1 is rejected | i2 is also rejected (X doesn't exist), and the toasts collapse into one: "2 changes couldn't be saved" | I |
| O6 | A has a pending intent | B's unrelated change arrives | the view is rebased: B's change appears, A's pending change stays, nothing else flickers | I |
| O7 | online | no ack arrives within 10 s | the same intent `id` is resent (safe because of R8) | I |
| O8 | dev mode | a dev panel is open | it has a latency slider (0–3 s) and a "reject next intent" toggle, so rollback can be seen by hand | E |

## 6. Presence (P)

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| P1 | A and B are on the board | — | the header shows both avatars with a name and a stable color | E |
| P2 | A moves the mouse over the board | — | B sees A's cursor. The position is stored **relative to the card or column under the pointer** (fractions 0..1 of that element's box, falling back to the board). Different window widths and scroll positions still line up, because each screen resolves the anchor against its own layout. If B doesn't have that element, the cursor is hidden. Updates are throttled to about 20 Hz | U/I |
| P3 | A focuses or selects a card | — | on B's screen the card has a ring in A's color | E |
| P4 | A is dragging a card (mouse or keyboard) | — | B sees "A is moving…" on that card | E |
| P5 | A closes the tab | — | A disappears immediately. If A's network dies instead, A disappears within 30 s (awareness timeout) | I |
| P6 | — | — | presence is never persisted, never in undo, never stored offline | U |
| P7 | the same user opens 2 tabs | — | 2 presences (one per tab) | I |
| P8 | A is offline | — | A broadcasts nothing, and A's UI shows no one else's presence | E |

## 7. Offline (F)

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| F1 | connected | the network drops | a banner says "Offline: changes are saved on this device" within 2 s | E |
| F2 | offline | A edits text, creates, moves or deletes cards | everything works locally. Text goes into the content doc (IndexedDB) and intents go into the outbox (IndexedDB) | E |
| F3 | offline with pending changes | A reloads the page | the board is restored from IndexedDB, including pending intents and text | E |
| F4 | offline edits exist on both sides | the connection is restored | the content docs exchange **state vectors** and send only the missing updates in both directions | I |
| F5 | the outbox has intents i1…in | the connection is restored | they are sent **in their original order**, and the server processes them one at a time in that order | I |
| F6 | an offline intent is now invalid (e.g. WIP limit reached meanwhile) | it is flushed | it is rejected and rolled back as in O4/O5. The toast names the affected cards | I |
| F7 | A and B both edit the same title while offline | both reconnect | the text is merged (C1–C3) | I |
| F8 | the connection flaps during a flush | intents are resent | no duplicates (R8) | I |
| F9 | never opened board X while online | A opens X while offline | shows "This board isn't available offline" | E |

## 8. Accessible drag and drop (K)

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| K1 | — | the user presses Tab | focus reaches columns and cards. Arrow keys move focus between cards. The focus ring is always visible | E |
| K2 | a card is focused | Space or Enter | the card is picked up, and the live region says: "Picked up *X*. Position 2 of 5 in *To do*. Arrow keys to move, Space to drop, Escape to cancel." | E |
| K3 | a card is picked up | ↑ / ↓ | moves within the column. Each step is announced ("Position 3 of 5") | E |
| K4 | a card is picked up | ← / → | moves to the adjacent column, with the index clamped. Announced ("Moved to *Doing*, position 2 of 3") | E |
| K5 | a card is picked up | Space or Enter | dropped. **Exactly one** `moveCard` intent, not one per arrow press. Announced "Dropped" | E |
| K6 | a card is picked up | Escape | returns to its original spot, no intent is sent, announced "Cancelled" | E |
| K7 | a card was dropped | — | focus stays on the moved card | E |
| K8 | a column is focused | the same keys (← / →) | reorders columns | E |
| K9 | a card is picked up | a remote user deletes it | the drag is cancelled and announced | E |
| K10 | a keyboard drop is rejected | nack arrives | the rollback is announced (O4) and focus follows the card back | E |
| K11 | — | a mouse or touch drag | produces the same single intent as K5 | E |
| K12 | — | an axe scan runs | 0 violations | E |

## 9. Undo and redo (U)

| ID | Given | When | Then | Test |
|---|---|---|---|---|
| U1 | — | Cmd/Ctrl+Z · Shift+Cmd+Z / Ctrl+Y | undo · redo (there are also toolbar buttons) | E |
| U2 | A and B both made changes | A presses undo | only **A's own** latest change is reverted, never B's | I |
| U3 | focus is on the board (not in a text field) | undo | the **inverse intent** is sent (move back, restore, delete-created, …). It goes through the server like any intent, so it can be rejected (e.g. WIP limit) → toast, and the entry is dropped | I |
| U4 | A moved X from col1 to col2, then B moved X to col3 | A presses undo | the inverse carries `expect: X in col2`, so it is `STALE` → toast "Couldn't undo: someone changed “X” after you". X stays in col3. If A hadn't seen B's move yet, the server rejects it instead of A's browser | I |
| U5 | focus is in a text field | Cmd/Ctrl+Z | undoes **text in that field only** (`Y.UndoManager`, tracks local origin only, typing within 500 ms is grouped) | U/E |
| U6 | there are undone entries | A makes a new change | the redo stack is cleared | U |
| U7 | a keyboard drag with 6 arrow steps | undo | the whole drag is reverted in one step (one entry, K5) | E |
| U8 | card X was deleted by A, and B edited it meanwhile | A undoes | X is restored with B's edit (C6) | I |
| U9 | — | — | the undo stack is capped at 100 entries, survives going offline, and is **not** persisted across reloads | U |

---

## 10. Wire protocol (sketch)

```
client → server   {t:"sync1", doc, stateVector}           // Yjs sync step 1
server → client   {t:"sync2", doc, update}                // Yjs sync step 2
both ways         {t:"content", update}                   // content doc updates
server → client   {t:"structure", update}                 // confirmed structure updates
client → server   {t:"intent", id, name, args, expect?}
server → client   {t:"ack", id} | {t:"nack", id, code}    // ack is always sent AFTER its structure update
both ways         {t:"awareness", update}                 // presence
```

## 11. Milestones (each one closes a set of rows)

| # | Milestone | Rows closed |
|---|---|---|
| M0 ✅ | Monorepo scaffold, shared mutators + unit tests | R1–R7, R9, C4, C8, C11 (U level). R8 is server state, so it moves to M2 |
| M1 ✅ | Server, rooms, persistence, content CRDT sync | S1–S7, C1–C3 |
| M2 ✅ | Intents, optimistic view, rollback, dev panel | O1–O8, C5–C12 |
| M3 ✅ | Presence | P1–P8 |
| M4 ✅ | Offline (IndexedDB, outbox, reconnect) | F1–F9 |
| M5 ✅ | Accessible drag and drop | K1–K12 |
| M6 ✅ | Undo/redo | U1–U9 |
| M7 ✅ | README (why CRDT vs LWW, conflict table = §3), E2E polish | all rows green |

## 12. Out of scope (for now)
Auth beyond a name prompt plus a role picker · multiple boards UI (one board per URL is enough) · card comments, labels and attachments · mobile-optimized layout · horizontal scaling (a single server process).

## 13. Resolved questions
1. D1 split: approved. Alternatives considered: all-Yjs (can't reject, so no real rollback) and all-server LWW (concurrent text edits get lost).
2. Stack: Vite + React (D7).
3. Concurrent move of the same card: silent last-write-wins with a highlight, no notice (C4).
4. WIP limit: hard block (R3).

## 14. Change log
- 2026-09-29: decisions approved; R8 moved from M0 to M2.
- 2026-09-30: M7 done. `README.md` explains CRDT vs LWW and has the conflict table. 22 Playwright tests in real Chrome (`apps/e2e`, `pnpm e2e`) cover the rows marked "needs E2E": O1/O2/O4/O8 visuals, P1–P3/P5 in the browser, F1/F2, F3 (production build + service worker, reload with no network), F9, K1–K12 (announcement text, focus, WebSocket frame counting for "one drag = one intent", axe in light and dark), U1/U4/U5/U7. They found two bugs: (1) board undo never recorded anything in the app, because React StrictMode's dev double-mount destroyed a `useMemo`'d history (fixed: create and destroy in one effect); (2) the "Connected" pill and the dev-panel label failed WCAG AA contrast (colors darkened). `pnpm test` = unit + integration (164), `pnpm e2e` = browser (22).
- 2026-09-30: M6 done. `invertIntent` builds each undo/redo as an intent with `expect` set to the state our change left behind; a property test checks that change → undo → redo gives exactly the before/after boards for every intent type. `BoardUndo` is integration-tested for U2–U4, U6, U8 and U9 (`apps/server/test/undo.test.ts`), including U4 rejected by the server when the other change hadn't arrived yet. Added the `restoreColumn` intent (undo of deleteColumn, redo of createColumn). U4 wording changed: the app can't know *who* made the conflicting change, so the toast says "someone". U5 is a per-field `Y.UndoManager` that tracks only that field's own typing; its behavior is unit-tested on two replicas. U1, U7 and keyboard handling need E2E (M7). Fixed a timing-flaky R8 test (its 50 ms window was too tight under load).
- 2026-09-30: M5 done. Drag and drop is a pure state machine (`packages/client/src/drag.ts`) driven by both the keyboard and the pointer (K11). The logic and every announcement for K2–K6 and K8 are unit-tested. dnd-kit is used for pointer/touch only; its keyboard sensor stays off, because it moves by screen geometry rather than "next column". The M2 arrow buttons were replaced by a drag handle per card and per column. K1, K7, K9, K10, K12 and the visual parts are built but need E2E (M7). P4 ("… is moving") is now set during any drag.
- 2026-09-30: M4 done. F2–F9 are integration-tested with `fake-indexeddb` (`apps/server/test/offline.test.ts`); a reload is a new client on the same device's storage. The IndexedDB store is unit-tested (`packages/client/test/localStore.test.ts`). The outbox is stored one row per intent, so two tabs can't overwrite each other; a tab resending another tab's intent is harmless (R8). F1 (banner, browser `offline`/`online` events) and the app-shell service worker are built but need a real browser: E2E in M7. The service worker only runs in a production build (`pnpm --filter @kanban/web preview`).
- 2026-09-29: M3 done. P1–P8 are integration-tested (`apps/server/test/presence.test.ts`), and cursor math + throttle are unit-tested. P2 changed from board-relative pixels to element-anchored fractions, because a responsive grid puts the same card at different x on different widths. P4 is shown in the UI, but nothing sets `dragging` until drag and drop exists (M5). The server now pings connections every 10 s and guards against corrupt payloads (a bad awareness or Yjs update used to be able to crash the process).
- 2026-09-29: M2 done. O1, O3–O7, R8, C4–C12 are integration-tested (`apps/server/test/intents.test.ts`); S3 now includes structure intents. O2, O4's visual part, and O8 are built in the UI but still need an E2E test (Playwright, M7). Added `cardOrderAt`/`columnOrderAt` (index → order key; ties step past the tied group). The "Doing" default WIP limit is 3.
- 2026-09-29: M1 done. Rows S1–S6, C1–C3, and R1 for text are tested (`apps/server/test`, `packages/shared/test/crdt.test.ts`). S3 covers text only for now; structure joins the property test in M2. S7 holds by design (clients only ever connect to the server).
- 2026-09-29: M0 done. 51 unit tests in `packages/shared/test`, named by row ID. Also covered early at U level: C9, C10, C12.
