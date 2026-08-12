# Known issues

Measured against the current `main`, by running the game (`npm run playtest`) and
the unit suite (`npm test`) rather than by reading the code. Anything here is
reproducible; anything merely *planned* lives in [ROADMAP.md](ROADMAP.md) instead.

---

## Gameplay

### A bankrupt player's estate is not auctioned when it returns to the bank

When a player goes under owing the *bank* rather than another player, their deeds
are returned unowned (`Estate.transferEstate` with no creditor). The standard
rules have the bank auction each of them immediately. Owing another player works
correctly — the whole estate passes to them.

### The last houses go to whoever's turn comes first

The bank's 32 houses and 12 hotels are a shared, limited supply, and the game
enforces that: you cannot build when the stock is empty, and
`BuildRules.canSellHotel` refuses to break a hotel the bank cannot hand four
houses back for (`Bank.sellHotel` would otherwise leave the lot bare and lose
them). What is missing is the standard rule for *contention* — when several
players want more houses than the bank holds, they should be auctioned.

Here, turn order decides instead: whoever clicks Build first gets them. This is
not a small omission dressed up, but it is not straightforward either — a
turn-based click UI never produces the simultaneous demand the rule is written
for. See ROADMAP M8b for what implementing it actually needs.

### The auction clock is fixed at 15 seconds

`AUCTION_SECONDS` in `GameScene` is a constant, not a setting, and the bid
increments offered (minimum, +$40, +$90) are fixed too. A player who wants to
raise by some other amount cannot.

### Duplicate tokens are allowed

The menu assigns distinct tokens by default, but the selector cycles each row
independently, so two players can both end up as "Car" and share a token colour
on the board. Nothing prevents or warns about it.

### A save cannot be taken mid-turn, and there is only one slot

Saving is refused while a token is moving, an auction is running or a trade is
open, because a restore resumes at the *start* of the saved player's turn and
none of that state is captured. `SaveLoad` also keeps exactly one localStorage
key, so a new save overwrites the old one with no warning.

### The bots never propose a trade

`game/Bot.ts` answers an offer (`acceptTrade`) but has nothing that *makes* one,
so bots only ever trade when a human proposes. In a bot-only game that means
colour groups are completed by chance alone, and often not at all — which is why
a long `--bots` run usually ends with the bank's houses untouched.

### The bots are a baseline, not a challenge

The policy is deliberately plain: a flat $150 reserve, a bid ceiling of 1.2× face
value (1.7× for a deed that completes a group), build the cheapest complete group
it can afford. It does not count what rent it is likely to face, weigh position on
the board, or plan more than one purchase ahead. It is something to play against
and something for M8d to measure a better policy against.

### The playtest plays with the house rules off

`tools/playtest.mjs` never touches the menu's house-rule switches, so the seeded
run only ever exercises the default rule set. The Free Parking jackpot and the
double GO salary were verified by hand against the real canvas; nothing stops
them regressing silently.

---

## Architecture

### Turn-end protection is split across two layers

Two separate mechanisms stop a turn ending twice, and neither is sufficient alone:

| Mechanism | Where | Covers |
|---|---|---|
| `_turnEndedThisRound` | `TurnManager` | a re-entrant `endTurn()` called *while* `endTurn` is on the stack |
| `turnGen` counter | `GameScene` | a *stale* `endTurn` from a `delayedCall` scheduled during an earlier turn |

The flag cannot do the second job, because `endTurn()` calls `startTurn()`, which
clears it — so by the time a late timer fires, the guard has already reset. That
is exactly the "increasing event delay" bug in [DEVLOG.md](DEVLOG.md), and the
generation counter is the actual fix. Both behaviours are pinned by tests in
`tests/turns.test.ts`, including one that documents the flag's *inability* to
block a stale call, so nobody "fixes" it by deleting the counter.

### Landing side effects are scattered across scene event handlers

Every tile emits a bus event and `GameScene` decides how long to wait before
ending the turn (`safeEndTurn(300)`, `(400)`, `(700)`, `(800)`, `(100)`). The
delays are tuned by feel against animation lengths rather than sequenced from
completion callbacks, so changing an animation duration can reorder events. It
has been stable across long playtests, but it is timing-coupled by construction.

*Narrowed in M4:* how much rent a tile charges is no longer among those side
effects — it moved to `game/Rent.ts` and is unit-tested. What remains in the
scene handlers is the sequencing: who pays whom, when, and how long to wait.

### A panel that *has* changed is still rebuilt from scratch

`PropertyPanel` and `TradePanel` skip the work when the incoming view matches the
one they last drew (M6), so the common case — `refreshPanel()` on every turn
change, with nothing actually different — costs nothing. A view that has genuinely
changed still calls `removeAll(true)` and re-creates every child: roughly 120
objects for the trade panel's two deed lists. Not measurable at this size, and
updating in place is the same problem as drawing a theme, so it waits for M8c.

### The turn log keeps no history beyond the panel

`Notification` holds only the entries that fit between y=496 and y=786 — about a
dozen — and destroys anything pushed past the bottom. There is no scrollback, and
nothing is written anywhere a player could review after the fact.

### The trade panel's layout is fixed, not measured

`TradePanel` reserves 11 deed rows per side whatever the players actually hold,
so a two-deed trade shows a lot of empty space, and everything below the list
hangs off constants derived from that. It also means the harness's `HOTSPOTS`
entries have to be recalculated by hand whenever the layout constants change.

---

## Tooling

### The lockfile is only valid for the npm that wrote it

`npm ci` must be validated with **the npm major CI uses**, which is the one
bundled with the Node version in `.nvmrc` — not necessarily the npm on your
machine. This has already broken every CI job once: a lockfile written by npm 11
was missing 27 packages that npm 10 requires, and npm 11 reinstalled from its own
incomplete lockfile without complaint.

`npm run verify:install` is the guard. Run it after any dependency change; a
plain local `npm ci` is not sufficient evidence.

### `npm audit` is clean, and that is a moving target

Currently **0 vulnerabilities**. It was three (one moderate, two high, all in
`esbuild`/`postcss` under Vite 5) until the Vite 7 upgrade removed them. None
reached the browser bundle in either case — the only runtime dependency is
Phaser. Never run `npm audit fix --force`: it makes breaking major upgrades
silently.

### The playtest harness clicks fixed canvas coordinates

`tools/playtest.mjs` drives the game by clicking board pixel positions listed in
its `HOTSPOTS` table, because the game is a single canvas with no DOM controls.
Moving a button in a scene without updating that table makes the harness click
empty space, which usually surfaces as "no property was bought in the whole run"
rather than as a clear error.
