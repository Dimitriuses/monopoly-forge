# The playtest harness

`tools/playtest.mjs` drives the real canvas with Playwright. This is everything
it assumes and everything that has broken it — reference for when you are working
on the harness or have just made it fail, rather than something to keep in your
head. The one-line rules are in [CLAUDE.md](../CLAUDE.md).

---

## Clicking fixed coordinates

The game is one canvas with no DOM controls, so `tools/playtest.mjs` clicks board
pixel positions from its `HOTSPOTS` table. **Move a button in a scene and you must
update that table**, or the harness clicks empty space and fails with a vague
"no property was bought in the whole run".

`GameScene.exposeDebugHandle()` publishes `window.__forge` (state, phase,
`isAnimating`, whether a prompt, card or property panel is open) so the harness can
assert on real model state rather than pixels. It is gated on the same switch as
debug logging, so a plain production load exposes nothing.

**The menu is not in `HOTSPOTS` either.** It is a tree whose rows move as games,
variants and save slots are added, so it reports its own positions through
`__menu.spots()` — id, label, current value, and where the ‹ › are — and the
harness presses rows **by name**. `menuPress` throws when a row is missing or
disabled rather than clicking empty space, because a silent miss is the failure
mode the table had. The run also walks into Game Settings, changes a rule, and
asserts it reached `__forge.rules()`.

**A prompt the harness cannot answer is a hung run.** `__forge.choice()` reports
the question on screen and which tiles it would accept, so `settlePrompts` can
answer a board-style choice by clicking one. And settling polls for the *end
state* — the dice back on offer — never for "nothing is open", because a walk
goes idle a moment before its landing draws a card, and the card then swallows
the next click.

**Nothing in the harness may assume the board's size.** `__forge.board()` reports
the size, the tracks and which squares charge a tax. It exists because the
harness checked `position <= 39` for four milestones and failed Ultimate
Monopoly's 120-tile board with it — the "never write 40" rule broken in the one
file nothing type-checks.

Board *tiles* are the exception to the hotspot table: `__forge.tileCentre(id)`
returns a tile's centre, so the harness clicks tiles without keeping its own copy
of the board geometry. Keep it that way — the table is for scene buttons only.
The same applies to the turn: `__forge.phases()` reports what *this* game's turn
is made of, so the harness checks the phase it ended in without a hardcoded list
that a rule set adding a phase would falsify.

`__forge.forceHouseShortage()` and `__forge.forceBankruptcy()` are the two hooks
on that handle that *write*. Both exist for the same reason: the rule they set up
needs a board a played game reaches only at the very end, or not at all. The bot
run calls them part-way in and then asserts that a house, and a returned estate,
went under the hammer. `forceBankruptcy` settles the debt through `settleDebt` and
`announceSettlement` rather than setting flags, so what it exercises is the real
chain; `forceMutualKeys` rigs a *board* where two players hold each other's key
and lets the real `proposeTrade` find the swap, rather than injecting an offer.
That is the shape a write-hook must have — **arrange the position, never the
answer.** Keep new hooks read-only unless the alternative is a rule with no
end-to-end check at all.

**A turn does not end while anything is under the hammer.** `safeEndTurn` waits
on `this.auction` *and* `this.auctionQueue` — a bankruptcy mid-turn puts a whole
estate up for sale, and the next player must not start rolling into it. A queued
subject stays in the queue until it actually opens, so there is never a frame
where the queue looks empty and the turn slips out underneath it.

**Only the auction a declined property started ends the turn.** `auctionEndsTurn`
says which one that is. A contested house and a returned estate both happen in the
*middle* of somebody's turn — the estate sale can even open while a token is still
walking — so ending the turn when they settle fires the walk's landing on the next
player. That is the "🔴 BUG DETECTED — animation finished for Player 3 but the turn
has already advanced to Player 2" the harness caught on Orbits.

`TradePanel`'s hotspots are the fragile ones: its rows and buttons hang off
`LIST_TOP` / `BUTTON_Y` / `H`, so changing any of those means recomputing
`tradeRow1`, `tradePropose` and `tradeAccept` by hand. The symptom is a vague
"accepting the trade did not close the panel".

**The headless clock runs slow.** A `delayedCall(700)` can take ~2 s of wall time
in headless Chromium, so anything driving the game from Playwright must poll for
the state it wants rather than sleeping for the nominal delay. A "nothing
happened" result there is usually impatience, not a bug.

**A dead button is silent.** The harness clicks ROLL every turn whether or not
anything happens, so a broken roll button used to leave the run passing on what
the earlier turns had already done. It now fails after three consecutive rolls
that change no state at all. Keep that check honest when adding modal flows —
it skips turns where a card or buy prompt is open.

## Screenshots, and which run owns which

`npm run screenshots` is five passes, because no single run can produce the set:

| Pass | Writes |
|---|---|
| `--shots` (Classic, three humans) | the gallery — menus, board, prompts, panels, saves, inventory |
| `--shots --bots` | `12-bots` |
| `--shots --game roundabout` | `13-round-board` |
| `--shots --game orbits` | `14-orbit-board` |
| `--shots --game ultimate` | `15-ultimate-board` |

**A run may only write what it owns.** `shot()` used to save a fixed filename
whatever was being played, so a shots run of a non-Classic game overwrote the
Classic gallery with pictures of a different board — thirteen files at once, and
invisibly, since the names appear only in the README. `shotClaim()` is the guard:
a board run photographs `2-board` and saves it under that game'''s name, a bots run
owns `12-bots`, and a run bent out of shape by a variant, a house rule, a theme or
a different seat count owns nothing at all.

A board run also **stops as soon as it has its picture**. Playing the rest out
proves nothing that game'''s own playtest does not already prove, and would make
the screenshot chain hostage to every step after the board renders.
