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

### Selling a hotel is blocked when the bank has fewer than four houses

`Bank.sellHotel` hands back four houses only `if (this.houses >= 4)` — otherwise
the lot silently ends up bare and the buildings vanish. Rather than change the
bank, `BuildRules.canSellHotel` refuses the sale in that case and says why, which
matches the limited-supply rule: with no houses in the bank you must wait. The
*other* half of that rule — auctioning the last few houses between players who
all want them — is not implemented (ROADMAP M6).

### The auction clock is fixed at 15 seconds

`AUCTION_SECONDS` in `GameScene` is a constant, not a setting, and the bid
increments offered (minimum, +$40, +$90) are fixed too. A player who wants to
raise by some other amount cannot.

### Duplicate tokens are allowed

The menu assigns distinct tokens by default, but the selector cycles each row
independently, so two players can both end up as "Car" and share a token colour
on the board. Nothing prevents or warns about it.

### Three of the four house-rule flags are still never consulted

`noAuction` became real in M5 — it keeps a declined property unowned instead of
opening an auction. `freeParkingJackpot`, `doubleGoSalary` and `speedDie` are
still read by no code path, and there is no interface for changing any of them:
`GameScene.houseRules` is initialised from `DEFAULT_HOUSE_RULES` and never
touched again.

### Save/load is not wired up

`src/utils/SaveLoad.ts` is complete and works (localStorage, versioned payload),
and `GameScene.serialize()` produces a full state snapshot. Neither is called by
the game: there is no save button and no deserialiser. See
[ROADMAP.md](ROADMAP.md) for what a restore actually needs.

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

### Every panel is rebuilt from scratch on every refresh

`PropertyPanel.show()`, `AuctionPanel.show()` and `TradePanel.show()` all call
`removeAll(true)` and re-create every child, and they are called after each
build, sale, mortgage, bid and offer edit. The trade panel is the heaviest —
roughly 120 objects for two full deed lists — and none of it has been measurable,
but it is churn where a diff would do.

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
