# Known issues

Measured against the current `main`, by running the game (`npm run playtest`) and
the unit suite (`npm test`) rather than by reading the code. Anything here is
reproducible; anything merely *planned* lives in [ROADMAP.md](ROADMAP.md) instead.

---

## Gameplay

### "Go Back 3 Spaces" animates the wrong way round

**Severity:** visual only — the game state stays correct.

`CardEffects.goBack` sets `player.position` backwards correctly, then emits
`player:move` with `steps: 3`. `GameScene.moveTokenStepByStep` always walks
*forward* (`(from + s) % 40`), so the token visibly travels three tiles clockwise
and then jumps back to the right tile when the next redraw happens. Landing
resolves on the correct tile, so rent, cards and taxes are all charged properly.

The code warns about this on the console (`dwarn` in `CardEffects.goBack`), which
is how it was found. Fixing it needs a signed step direction threaded through the
`player:move` payload and the animation loop.

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
  owe more than they hold, which is why partial payment silently "works".

### Houses, hotels and mortgages have no user interface

`Bank.buyHouse`, `buyHotel`, `sellHouse`, `sellHotel`, `mortgage` and
`unmortgage` are implemented and unit-tested (see `tests/economy.test.ts`,
including bank-stock conservation and the 110% unmortgage fee), but **nothing in
the game calls them**. Rent therefore never rises above the bare-lot tier in
actual play, and the colour-group and even-building rules described in the
original design are not enforced anywhere.

### Property ownership is invisible on the board

Buying a tile updates the model — `ownerId`, `player.ownedTileIds`, and rent is
charged correctly on later landings — but the board draws no owner marker, so
there is no way to tell who owns what without reading the console. This is the
single biggest gap between "the rules work" and "the game is playable".

### The two "nearest Railroad" Chance cards are fixed destinations

`ch4` and `ch5` advance to tiles 5 and 15 unconditionally rather than to the
railroad nearest the player, and `ch12` ("Advance to Reading Railroad") also
targets tile 5, so two of the sixteen Chance cards have the same effect. The
standard deck also charges double rent on a railroad reached this way; that is
not implemented.

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

### Board drawing is duplicated four times

`GameScene.drawBoard` has one near-identical loop per side of the board, differing
only in tile dimensions and colour-stripe edge. That duplication is what allowed
the original top-row orientation bug, and it is the natural thing to extract when
houses and owner markers need drawing per tile.

---

## Tooling

### `npm audit` reports advisories in the dev toolchain

Three at the time of writing (one moderate, two high), all in build-time
dependencies (`esbuild`/`vite` dev server, `postcss`). None reach the browser
bundle — the only runtime dependency is Phaser. `npm audit fix --force` would
pull a breaking Vite major and is deliberately not run.

### The playtest harness clicks fixed canvas coordinates

`tools/playtest.mjs` drives the game by clicking board pixel positions listed in
its `HOTSPOTS` table, because the game is a single canvas with no DOM controls.
Moving a button in a scene without updating that table makes the harness click
empty space, which usually surfaces as "no property was bought in the whole run"
rather than as a clear error.
