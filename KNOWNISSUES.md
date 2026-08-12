# Known issues

Measured against the current `main`, by running the game (`npm run playtest`) and
the unit suite (`npm test`) rather than by reading the code. Anything here is
reproducible; anything merely *planned* lives in [ROADMAP.md](ROADMAP.md) instead.

---

## Gameplay

### Declining a property does not open an auction

Under tournament rules, a declined property goes to auction between all players.
Here, `PropertyTile.onLand` emits an event named `property:auction`, but the
handler only shows a Buy/Pass prompt — passing simply ends the turn and the tile
stays unowned. The event name is a leftover from the original plan and is
misleading; renaming it is a small, safe cleanup.

### Bankruptcy ends a player without settling their estate

`checkBankruptcy` flags a player as bankrupt when their cash hits zero, and
`TurnManager.advancePlayer` then skips them. What does *not* happen:

- their properties are not transferred to the creditor or returned to the bank —
  the tiles stay owned by a player who is out of the game, and keep charging rent;
- there is no chance to mortgage or sell to raise the money first;
- `Player.pay` clamps at zero (`Math.max(0, …)`), so a player can never actually
  owe more than they hold, which is why partial payment silently "works";
- a Get Out of Jail Free card in their hand is not returned to its deck. Spending
  one puts it back (M4); going bankrupt holding one still takes it out of play.

### Building is only offered on the owner's own turn

Real Monopoly lets you build, sell and mortgage at almost any point, including
during another player's turn. Here `GameScene.actionsFor` only offers the buttons
to `turnManager.currentPlayer`, so a player who wants to develop must wait for
their turn to come round. Inspecting any tile works at any time; only the actions
are gated.

### Selling a hotel is blocked when the bank has fewer than four houses

`Bank.sellHotel` hands back four houses only `if (this.houses >= 4)` — otherwise
the lot silently ends up bare and the buildings vanish. Rather than change the
bank, `BuildRules.canSellHotel` refuses the sale in that case and says why. The
standard rules would instead force an auction of the scarce houses.

### Duplicate tokens are allowed

The menu assigns distinct tokens by default, but the selector cycles each row
independently, so two players can both end up as "Car" and share a token colour
on the board. Nothing prevents or warns about it.

### House-rule flags are declared but never consulted

`HouseRules` (`freeParkingJackpot`, `doubleGoSalary`, `noAuction`, `speedDie`) is
defined in `src/config.ts` and `GameScene.houseRules` is initialised from
`DEFAULT_HOUSE_RULES` — but no code path reads any of the four flags. They are a
placeholder, not a feature.

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

### The property panel is rebuilt from scratch on every refresh

`PropertyPanel.show()` calls `removeAll(true)` and re-creates every text object,
and `GameScene.refreshPanel()` calls it after each build, sale, mortgage and
turn change. It is a few dozen objects and has not been measurable, but it is
churn where a diff would do.

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
