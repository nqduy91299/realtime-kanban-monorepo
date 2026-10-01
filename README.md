# Realtime Kanban

A Kanban board that several people edit at the same time, that keeps working offline, and that can be
used entirely from the keyboard.

Built to learn, and to be able to answer "design a collaborative editor" from experience. Every
behavior is specified first in [`docs/TRUTH_TABLE.md`](docs/TRUTH_TABLE.md) (about 80 rows, each with an
ID like `C4` or `U4`), and every row is covered by a test named after it.

| Feature | How | Rows |
|---|---|---|
| Several people editing at once | Yjs CRDT for text, server-validated intents for structure, over one WebSocket | S, C |
| Optimistic updates with rollback | the screen shows `confirmed state + pending changes`; a rejection just removes one | O, R |
| Presence | avatars, live cursors anchored to cards, focus rings, "Alice is moving…" | P |
| Works offline | IndexedDB for both docs and the outbox, a service worker for the app shell | F |
| Keyboard drag and drop | Space · arrows · Space / Esc, with screen-reader announcements; mouse and touch too | K |
| Undo / redo | undo is itself a validated change that refuses to overwrite newer work; per-field text undo | U |

## Run it

```bash
pnpm install
pnpm dev            # server on :4000, web on :5173 → open http://localhost:5173 in two windows
pnpm test           # unit + integration (Node, ~10 s)
pnpm e2e            # end-to-end in your installed Google Chrome (starts its own servers on other ports)
pnpm typecheck
```

`?board=<name>` opens another board. `&role=viewer` makes a read-only viewer. In development there's a
**Dev panel** with a network-delay slider and "Reject next change", so you can watch optimistic updates
and rollbacks happen. `pnpm --filter @kanban/web preview` serves the production build with the offline
service worker.

Requires Node 22+ and pnpm. SQLite is Node's built-in `node:sqlite`, so there's no native build step.

## Architecture

```
 Browser (per tab)                                        Node server (one process)
┌──────────────────────────────────────┐                 ┌─────────────────────────────────┐
│ React UI                             │                 │ one room per board              │
│  view = confirmed + replay(outbox) ──┼── intent ──────▶│  runIntent() (same code!)       │
│                                      │◀─ structure ────┤  structure doc (server writes)  │
│                                      │◀─ ack / nack ───┤                                 │
│ content Y.Doc (one Y.Text per field)◀┼── Yjs updates ─▶│  content doc (merge + relay)    │
│ awareness (cursor, focus, dragging) ◀┼── presence ────▶│  awareness (memory only)        │
│ IndexedDB: both docs + outbox        │                 │  SQLite: update log + intent ids│
└──────────────────────────────────────┘                 └─────────────────────────────────┘
```

```
packages/shared   types, intents (zod), mutators (the rules), ordering, wire protocol, presence schema
packages/client   BoardClient (sync, outbox, offline, presence), drag state machine, undo, IndexedDB store
apps/server       WebSocket server, rooms, SQLite persistence
apps/web          React UI (Vite)
apps/e2e          Playwright tests in real Chrome
```

## Why a CRDT, and why not *only* a CRDT

### What last-write-wins gets wrong

Last-write-wins (LWW): when two people change the same thing, the change that arrives last replaces the
other. It's simple, and for some data it's exactly right. For text it loses work:

```
"Fix bug"   Alice appends " now"        → "Fix bug now"
            Bob prepends "Urgent: "     → "Urgent: Fix bug"
LWW result: whichever arrived last, e.g.  "Urgent: Fix bug"      Alice's words are gone
CRDT result:                              "Urgent: Fix bug now"  both kept
```

It gets worse offline. Someone who edits for an hour on a train and reconnects would overwrite every
title the team changed in the meantime, or be overwritten by it.

A **CRDT** (conflict-free replicated data type, here [Yjs](https://yjs.dev)) avoids that by design. Each
character has a unique identity and a position relative to its neighbours, not an index. So any set of
edits, applied in any order, on any replica, converges to the same text without asking a server
(proven here by property tests, `S3`). Deleting text someone else is typing inside doesn't swallow their
insert (`C3`), and two inserts at the same spot both survive in the same order everywhere (`C2`).

### Where a CRDT is the wrong tool

A CRDT can merge anything, but it can't **refuse** anything. Every edit is accepted, by construction.
A Kanban board has rules that need someone who can say no:

- "Doing" holds at most 3 cards (WIP limit, `R3`).
- A column can only be deleted when it's empty (`R4`).
- Viewers can't edit (`R1`).

Two people each moving a card into the last free slot of "Doing" is a *conflict of rules*, not of text.
Merging both would silently break the limit.

There's also a subtler reason not to push rejections into Yjs. Updates from one Yjs client form a chain
(clock 1, 2, 3 …). If the server rejected update 5, then 6, 7, … all depend on it, and that client is
stuck.

### So the data is split by how it should merge (decision D1)

| Data | Strategy | On conflict |
|---|---|---|
| **Text**: card and column titles | Yjs CRDT, sent as Yjs updates | both edits merge; nothing is ever rejected |
| **Structure**: which cards exist, their column and order, WIP limits | named **intents** (`moveCard`, `deleteColumn` …) validated by the server | processed in server order: valid → applied; breaks a rule → rejected and rolled back |

Structure is, deliberately, **LWW per item in server order**. For a card's position that's the right
semantics: a card can't be in two columns, so there's nothing meaningful to merge. Each position is
written as **one object** (`{columnId, order}`), so a card can never end up with one move's column and
the other move's order (`C4`).

Figma describes the same approach (server-ordered LWW per property) for its multiplayer engine, and so
does Linear for its sync engine. The one-line version: **CRDT where a merge means something; a server
with authority where there are rules.**

## How conflicts are handled

"At the same time" means neither person had seen the other's change. For structure, "first" means *first
to reach the server*. Every row is a test.

| | Alice | Bob, at the same time | Everyone ends up with | Mechanism |
|---|---|---|---|---|
| C1 | appends " now" to a title | prepends "Urgent: " | `Urgent: Fix bug now` | CRDT merge |
| C2 | types X at position 3 | types Y at position 3 | both, same order everywhere | CRDT tie-break |
| C3 | deletes a word | types inside that word | Bob's letters survive | CRDT |
| C4 | moves card X → Doing | moves card X → Done | the later move wins; X never duplicated or lost; no popup, just a brief highlight | per-card LWW in server order |
| C5 | moves card X | edits X's title | both apply | text and structure are independent |
| C6 | deletes card X | edits X's title | X hidden (soft delete); Bob's edit kept; undo brings X back *with* the edit | soft delete + separate text doc |
| C7 | deletes card X | moves card X | if the delete comes first, the move is rolled back (`CARD_DELETED`) | server rule |
| C8 | adds a card between P and Q | adds a card between P and Q | both, same order everywhere | fractional index, ties broken by id |
| C9 | deletes empty column K | moves a card into K | the second one is rolled back | server rules R2 / R4 |
| C10 | moves a card into Doing (1 slot left) | moves another card into Doing | first accepted, second rolled back: "Doing is full" | server rule R3 |
| C11 | reorders column K | reorders column K | the later reorder wins | per-column LWW |
| C12 | lowers Doing's WIP limit | moves a card into Doing | the second one is rolled back | server rules R3 / R5 |

### Optimistic updates and rollback

The same mutator functions run on both sides (`packages/shared/src/mutators.ts`): the client uses them
to *predict*, the server to *decide*. The client never edits its confirmed state; it renders

```
view = confirmed state + replay(pending intents)
```

- **Accepted:** the server broadcasts the new structure, and only *then* acks. The client already has
  the result when it drops the intent, so nothing flickers (`O3`).
- **Rejected:** the client drops the intent and recomputes. The card snaps back. That is the whole
  rollback, and it needs no special undo code (`O4`). Changes that depended on it fail too, and are
  reported together (`O5`).
- **Someone else's change arrives meanwhile:** pending intents are replayed on top of it (a rebase, `O6`).
- **Reply lost:** the same intent id is sent again. The server stores every decided id (in the same
  SQLite transaction as the change), so a repeat is answered, never applied twice (`R8`, `O7`).
- **Obviously invalid on your own screen** (e.g. the column is full)? It's refused on the spot, no round
  trip.

### Offline

Text needs no special handling. Offline edits accumulate in the local Yjs doc, and on reconnect each
side sends the other exactly what it's missing (state-vector sync, `F4`). Structure changes wait in the
outbox. Both are saved in IndexedDB, so a reload while offline loses nothing (`F3`). On reconnect the
outbox is sent in its original order (`F5`); anything that's no longer valid is rolled back and named in
one toast (`F6`). The outbox is stored one row per intent, so two tabs can't overwrite each other's
pending changes. The browser's `offline` event drops the socket at once, instead of waiting for TCP to
notice (`F1`).

### Undo is a change like any other

Undo sends the reverse intent, carrying a precondition: "only if the card is still where *I* left it"
(`expect`). If someone moved it since, undo is refused instead of silently reverting their work (`U4`).
Because it's validated like any change, it can also fail for normal reasons (a full column). A rejected
change is removed from history. Inside a text field, Cmd/Ctrl+Z is a `Y.UndoManager` that tracks only
that field's own typing, so it never undoes someone else's words (`U5`).

## Accessibility

- Every card and column has a drag handle.
  - **Space** picks it up, the **arrow keys** move it (←/→ = next column), **Space** drops, **Esc** cancels.
  - Each step is announced, e.g. "Moved to Doing, position 2 of 3. Doing is full (limit 3), so the card
    can't be dropped here."
  - A whole drag sends one change and is one undo step.
- Without a drag, the arrow keys move focus between cards like a grid.
- Focus follows the card when it's re-rendered in another column, and when the server rejects a drop.
- Pointer and touch dragging (dnd-kit) drive the same state machine, so they behave identically.
- An axe scan runs in the E2E suite, at rest and mid-drag, in light and dark mode.

## Testing

| Level | Where | What |
|---|---|---|
| Unit | `packages/*/test` | rules (R1–R9), conflicts (C1–C12), CRDT properties, ordering, drag state machine and announcements, `invertIntent`, IndexedDB store |
| Integration | `apps/server/test` | a real server and real WebSocket clients: sync, rollback, idempotency, presence, offline with a reload, undo between two users |
| End-to-end | `apps/e2e` | Playwright in Chrome: visual pending/rollback, keyboard drag with announcements and focus, WebSocket frame counting ("one drag = one intent"), offline banner, service-worker reload, undo shortcuts, axe |

Property tests (fast-check) cover convergence under random edits, offline toggles and delivery orders.
They also check that *change → undo → redo* gives back exactly the before/after board for every intent
type. Each guarantee was also checked by breaking the code on purpose and watching the right test fail.
For example: sending the ack before the update, dropping duplicate detection, reversing the saved
outbox, and removing undo's precondition.

The E2E suite found two bugs the other levels couldn't:
- **Undo never recorded anything.** React StrictMode destroyed and reused a memoized object.
- **Two color pairs failed WCAG contrast.**

## Trade-offs and limits

- **No authentication.** The role is picked in the URL, and presence isn't verified (§12 of the truth
  table).
- **One server process.** Rooms live in memory. Scaling out would need sticky routing per board, or a
  pub/sub layer between servers.
- **Server cost per intent.** The server reads the whole structure doc for each intent. That's fine at
  Kanban sizes; a bigger app would keep a cached state beside the doc.
- **Text never gets deleted.** Text for cards is never garbage-collected (top-level Y.Text, soft
  delete), and a rejected card creation leaves its title text behind, unused.
- **Presence redraws.** Every remote cursor movement re-renders the board. That's fine for a handful of
  people.
- **Undo history doesn't survive a reload,** by design (`U9`).
