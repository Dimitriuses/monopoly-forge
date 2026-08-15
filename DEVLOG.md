# Monopoly Forge — Development Log

A full record of the design decisions, architecture choices, and bugs fixed
during the collaborative development of this project.

---

## Project Overview

**Monopoly Forge** is a custom Monopoly implementation built with:

| Layer | Choice |
|---|---|
| Language | TypeScript 5.x |
| Renderer | Phaser 3 |
| Build tool | Vite |
| State | Custom EventBus + plain classes |

The game supports 2–6 players, the full turn loop (dice, doubles, movement, rent,
tax, GO salary), both card decks, buy/pass prompts and complete jail logic.

*Corrected 2026-08-01:* this paragraph used to claim "all standard Monopoly
rules" and "buy/auction prompts", and to advertise a dev-mode player switcher.
There is no auction — declining a property simply ends the turn — houses, hotels
and mortgages have no interface, and the switcher buttons were removed in
`a18490a`. See [KNOWNISSUES.md](KNOWNISSUES.md) for the measured current state
and [ROADMAP.md](ROADMAP.md) for what is planned.

*Updated 2026-08-12:* the two gaps named in that correction have since been
closed — houses, hotels and mortgages got an interface in M3, and auctions
arrived in M5 along with trading and a bankruptcy that settles an estate. The
paragraph above is left as written, because the point of it was the habit of
checking claims against the build rather than the claim itself.

---

## M1 — Foundation (Scaffold)

### What was built
- Full Vite + Phaser 3 + TypeScript project scaffold
- `config.ts` — all 40 board tiles fully defined with rent tiers, prices, groups
- `EventBus.ts` — typed singleton pub/sub decoupling model from scenes
- `PRNG.ts` — seeded Mulberry32 for reproducible games
- `SaveLoad.ts` — JSON serialisation to localStorage
- **Tile hierarchy**: `Tile` (abstract) → `PropertyTile`, then `SpecialTiles.ts`
  covering Railroad, Utility, Tax, Chance/CommunityChest, Jail, GoToJail, Go,
  FreeParking
- **Game model**: `Board`, `Player`, `Dice`, `Bank`, `TurnManager`
- **Card system**: `CardDeck` with all 16 Chance and 17 Community Chest cards,
  typed `CardAction` discriminated union, `CardEffects` executor
- **Scenes**: `BootScene`, `MenuScene`, `GameScene`, `UIScene`, `CardScene`
- `README.md` with full development plan and milestone table

### Board rendering bugs fixed (M1 polish)
Four visual glitches in `GameScene.drawBoard()` and `Board.computeLayout()`:

1. **Jail tile (tile 10) x-offset** — formula `CORNER_SIZE + 9*TILE_W + TILE_W/2`
   overshot; added explicit corner branch matching tile 0.
2. **Go-to-Jail tile (tile 30) same bug** — same fix for the top-right corner.
3. **Bottom row color stripes** — were at `y + TILE_H/2 - 14` (bottom edge);
   moved to `y - TILE_H/2` (top edge, toward board center).
4. **Top row rendering** — was lumped with left/right column loop, treating each
   tile as vertical (`TILE_H` wide, `w` tall). Separated into its own loop with
   correct horizontal orientation and color stripe at bottom edge.
5. **Orphaned `});`** — leftover closing brace from the old shared forEach was
   removed after the loop split.

---

## M2 — Core Loop

### What was built
- **`DiceView.ts`** — animated pip dice (12-frame shake → settle on real result)
- **`PlayerPanel.ts`** — per-player cash, status, active-player highlight
- **`Notification.ts`** — stacking toast system with slide-in/fade-out tweens
- **`TurnManager`** phase FSM fully wired: `WAITING_FOR_ROLL → ROLLING → MOVING
  → LANDING → AWAITING_BUY_DECISION → END_TURN`
- Step-by-step token movement (110 ms per tile, chained Promise/tween loop)
- `rent:pay` / `tax:pay` bus events wired to actual bank transfers
- Railroad and Utility rent computed from ownership count / last dice roll
- Buy prompt overlay with Buy / Pass buttons
- Jail enter/exit flows, jail fine and GOOJ card buttons
- Roll button enable/disable tied to turn phase
- `UIScene` rebuilt with `DiceView` and `PlayerPanel`

### Bugs fixed during M2

**`TurnManager.from` capture bug** — `player.position` was assigned to `to`
before emitting `player:move`, so the `from` field in the payload always equalled
`to`. Fixed by capturing `from = player.position` before the assignment.

**`declineBuy()` infinite loop** — `declineBuy()` re-emitted `property:auction`,
causing the buy prompt to recurse infinitely. Fixed to just call `endTurn()`.

**Roll button hidden behind UIScene panel** — `buildButtons()` was placing the
roll button at x=1155, inside the UIScene sidebar (x=1055–1280). Since UIScene
is a separate Phaser scene rendered on top, it visually covered the button.
Moved to x=512, y=738 (below the board, always visible).

**Missing `buildButtons()` call** — confirmed the call existed in `create()`;
the real fix was the position change above.

**`RailroadTile` / `UtilityTile` own-tile landing** — silent `return` with no
event emitted; game froze. Fixed to emit `player:landed` so the turn ends.

**`JailTile.onLand` empty** — Just Visiting froze the game. Fixed to emit
`player:landed`.

**`sendToJail` double `endTurn`** — emitted `player:move` with `steps:0`, async
`moveTokenStepByStep` resolved immediately, `resolveLanding()` fired on the Jail
tile while `jail:enter` also scheduled `endTurn`. Removed `player:move` from
`sendToJail`; `jail:enter` handler now snaps the token directly.

**Card + jail double `endTurn`** — "Go to Jail" card executed before CardScene
was shown, emitting `jail:enter` which scheduled `endTurn`; CardScene close also
called `endTurn`. All paths now funnel through `safeEndTurn()`.

**`endTurn` re-entry causing skipped turns** — `_turnEndedThisRound` flag in
`TurnManager` was reset by `startTurn()` (called from within `endTurn()`), so
stale `delayedCall` timers from previous turns would fire `endTurn()` on the new
turn. Replaced with a **generation counter** (`turnGen`) in `GameScene`:
`safeEndTurn` captures the current generation; if the generation has advanced by
the time the timer fires, the call is silently dropped.

**`showBuyPrompt` container double-remove crash** — `destroy()` on a Phaser
container child automatically removes it from the container; the subsequent
`removeAt(1)` then addressed an out-of-bounds index. Fixed with a single
`removeAt(1, true)` call (remove + destroy in one step).

**`CardEffects.advanceTo` double `onLand`** — called `tile.onLand()` directly
AND emitted `player:move` (which triggers `resolveLanding()` → `onLand` again).
Removed the direct call; `resolveLanding()` handles the landing after animation.
Also added missing `steps` calculation so the animation walks the correct path.

**`CardEffects.goBack` same bug** — same double-onLand pattern and missing
`steps`/`from` in the `player:move` payload. Fixed identically.

**Player switcher** — Added `TurnManager.forcePlayerTurn(index)` and a
**▶ TAKE TURN** button per player row in `PlayerPanel`. Clicking emits
`debug:forcePlayer` on the bus; `GameScene` calls `forcePlayerTurn()` (blocked
while animating).

---

## Bug-fix sessions (post-M2 gameplay testing)

### Stale timer / increasing event delay
**Symptom**: The longer the game ran, the longer it took for card popups and
other events to appear.

**Root cause**: `safeEndTurn(delay)` created a `delayedCall` timer. A single
landing could trigger multiple `safeEndTurn` calls at different delays. The
first one fired, called `endTurn()`, which called `startTurn()`, resetting
`_turnEndedThisRound = false`. A later timer from the same turn then fired,
saw the flag was `false` (reset by the new turn), and prematurely ended the
next player's turn. This compounded with each turn played.

**Fix**: Generation counter in `GameScene` (`turnGen`, incremented on every
`turn:start`). `safeEndTurn` captures `gen` at call-time; the timer fires
`endTurn()` only if `turnGen === gen` at that point.

### `card:draw` TypeError — `card is undefined`
**Symptom**: `TypeError: can't access property "isGetOutOfJail", card is
undefined` thrown as an unhandled promise rejection, freezing the game.

**Root cause 1**: `deck.drawCard()` returned `undefined` (both draw and discard
piles empty). The `drawCard()` return type was declared `Card` with a lying `!`
non-null assertion on `pop()`; at runtime `pop()` on an empty array returns
`undefined`.

**Root cause 2**: The `player:move` `.then()` callback had no `.catch()`. Any
error inside it (including the card draw TypeError) became an unhandled rejection
that left `isAnimating = true` and the turn permanently frozen.

**Fixes**:
- `CardDeck.drawCard()` return type changed to `Card | undefined` with an
  explicit empty-deck warning.
- `player:move` handler given a `.catch()` that logs the error, clears
  `isAnimating`, shows a notification, and force-ends the turn via `safeEndTurn`.
- `card:draw` handler given a null guard: if `card` is undefined, log and call
  `safeEndTurn(300)` instead of crashing.

### `showBuyPrompt` Index out of bounds
**Symptom**: `Error: Index out of bounds` from Phaser's `RemoveAt` when opening
the buy prompt for the second time.

**Root cause**: The prompt rebuild loop called `destroy()` on a child (which
Phaser automatically removes from the container), then called `removeAt(1)` on
the now-shorter list — out of bounds on the second or subsequent iteration.

**Fix**: Replaced `destroy()` + `removeAt()` with a single `removeAt(1, true)`
(Phaser removes first, then destroys, so the index is always valid).

### `tile is undefined` / `layout is undefined` — position corruption
**Symptom 1**: `TypeError: can't access property "onLand", tile is undefined` in
`resolveLanding`.
**Symptom 2**: `TypeError: can't access property "x", layout is undefined` in
`moveTokenStepByStep` on subsequent rolls.

**Root cause**: `player.position` was set to an invalid value (first `NaN`, then
discovered to also be `-1`). Once corrupted, every subsequent roll cascaded the
bad value: `board.move(NaN, steps)` → `to = NaN` → stored back in
`player.position`.

The `-1` case: JavaScript's `%` operator preserves sign, so `(-1 + steps) % 40`
for certain inputs produced negative `to`. `this.tiles[-1]` is `undefined`.

**Fixes**:
- `Board.getTile()` and `Board.getLayout()` now validate the index and throw
  descriptive errors if the slot is missing or the index is non-finite.
- `Board.move()` uses positive-modulo: `((f + s) % 40 + 40) % 40`, ensuring
  `to` is always 0–39 regardless of input sign.
- `Board` constructor `switch` given a `default` case that throws immediately
  on unknown tile types (was silently returning `undefined`).
- `TurnManager.movePlayer()` and `resolveLanding()` both sanitise
  `player.position` before use, resetting to 0 and logging if the value is
  non-finite **or negative or > 39**.

### Card deck exhaustion — `drawCard()` returned undefined (both decks)
**Symptom**: Both Community Chest and Chance decks returned `undefined` after
relatively few draws.

**Root cause 1 — deferred `returnCard`**: `returnCard()` had been moved inside
the `CardScene` shutdown callback. If CardScene got stuck (e.g. `scene.launch`
was a no-op on an already-running scene, so the new card data was never passed
and the dismiss button was never refreshed), the shutdown never fired and the
card was permanently lost from the deck. After enough such losses, both piles
were empty.

**Root cause 2 — accumulating shutdown callbacks**: Each `card:draw` called
`scene.get('CardScene').events.once('shutdown', cb)`. If CardScene was already
running, `scene.launch` did nothing but the new `once` was still registered.
When the scene eventually stopped, all accumulated callbacks fired at once,
executing multiple card effects and calling `safeEndTurn` multiple times.

**Fixes**:
- `returnCard()` moved back to **immediately after drawing**, before
  `CardScene` is launched. This keeps the deck self-consistent regardless of
  what happens to the scene.
- Added `if (this.scene.isActive('CardScene')) this.scene.stop('CardScene')`
  before each `scene.launch`. This ensures the previous session's shutdown fires
  cleanly (clearing any pending callbacks) before the new card is shown.

---

## File Map

*As of M2. The current layout — which adds `game/BuildRules.ts`, `game/Rent.ts`,
`game/Auction.ts`, `game/Trade.ts`, `game/Estate.ts`, `game/Snapshot.ts`,
`game/Bot.ts`, `game/BoardLayout.ts`, `game/Rules.ts`, `maps/`,
`tiles/registry.ts`, `cards/effects.ts`, `ui/BoardRenderer.ts`, `ui/PropertyPanel.ts`, `ui/AuctionPanel.ts`,
`ui/TradePanel.ts` and `ui/Sfx.ts`, and no longer has switcher buttons in
`PlayerPanel` — is in [README.md](README.md#layout).*

```
src/
├── main.ts                  Phaser.Game bootstrap
├── config.ts                40 tile definitions, constants, HouseRules
├── scenes/
│   ├── BootScene.ts         Asset preloading, placeholder texture generation
│   ├── MenuScene.ts         Player count + token selection
│   ├── GameScene.ts         Board rendering, all bus event wiring, buy prompt
│   ├── UIScene.ts           Sidebar HUD (dice, player panels)
│   └── CardScene.ts         Chance / Community Chest card overlay
├── game/
│   ├── Board.ts             40-tile registry, layout math, validated getTile/move
│   ├── Player.ts            Player state (position, cash, properties, jail)
│   ├── Dice.ts              Roll logic using PRNG
│   ├── TurnManager.ts       Phase FSM, position sanitisation, forcePlayerTurn
│   └── Bank.ts              Cash transfers, mortgage, house/hotel inventory
├── tiles/
│   ├── Tile.ts              Abstract base + TileDefinition type
│   ├── PropertyTile.ts      Color group, rent tiers, onLand routing
│   └── SpecialTiles.ts      Railroad, Utility, Tax, Card, Jail, GoToJail,
│                            Go, FreeParking
├── cards/
│   └── CardDeck.ts          CardDeck (draw/discard/shuffle), CardEffects,
│                            all 16 Chance + 17 Community Chest card definitions
├── ui/
│   ├── DiceView.ts          Animated pip dice renderer
│   ├── PlayerPanel.ts       Per-player rows with TAKE TURN switcher buttons
│   └── Notification.ts      Stacking toast notifications
└── utils/
    ├── EventBus.ts          Typed singleton pub/sub
    ├── PRNG.ts              Seeded Mulberry32 PRNG
    └── SaveLoad.ts          JSON save/load to localStorage
```

---

## Milestone Status

| Milestone | Status |
|---|---|
| M1 — Foundation | ✅ Complete |
| M2 — Core Loop | ✅ Complete |
| M3 — Ownership (houses/hotels, mortgage, color-group enforcement) | ✅ Complete — see [M3 below](#m3--ownership-and-development--2026-08-12) |
| M4 — Cards & Jail (all edge cases) | ✅ Complete — see [M4 below](#m4--cards-jail-and-rent-edge-cases--2026-08-12) |
| M5 — Multiplayer UI (trade dialog, auction system) | ✅ Complete — see [M5 below](#m5--multiplayer-interaction--2026-08-12) |
| M6 — Polish (animations, sound, save/load, house rules) | ✅ Complete — see [M6 below](#m6--polish--2026-08-12) |
| M7 — Opponents (bots you can play against) | ✅ Complete — see [M7 below](#m7--opponents-you-can-play-against--2026-08-12) |
| **M8 — Engine** — the destination | ✅ **Complete.** Four parts, below |
| M8a — A board is a file | ✅ `GameMap` + `validateMap`; a square, a circle and three concentric rings ship |
| M8b — Rules are registries, not switches | ✅ Tile types, card effects, turn orders, win conditions, variants; a turn is a list of phases; the speed die is the proof; the last houses sold at auction |
| M8c — Presentation is a theme | ✅ Colours, fonts and per-tile-type decoration in one object, two palettes; the panels update in place instead of rebuilding |
| M8d — A simulation platform | ✅ A headless runner, six invariants after every turn, a batch CLI, a second policy measured, and a balance pass driven by the numbers |
| **M9 — A game is a folder** (board + economy + deck + theme) | ✅ **Complete.** Six games ship, registration is scoped to the loaded one, a game can be composed from another and bring its own artwork, and [authoring a game](docs/authoring-a-game.md) is written down |
| **M11 — A board that is not a circuit** | ✅ **Complete.** Ultimate Monopoly: 120 tiles across three loops. Movement became a named strategy, `move` reports its route, a tile's rule may mention somebody else, colour groups opened, and group rent stopped being a literal |
| **M10 — Refinement** | ✅ **Complete.** All four printed-rule corners closed, both menus are a tree, saves work mid-turn and mid-auction, the turn log comes out, bots offer *you* trades and now trade their way out of a stalemate — 22 of 400 unfinished classic games became 0 — and the cleverer valuation that was meant to beat them was measured and does not |

---

## Hardening pass — 2026-08-01

Portfolio pass over the whole repo. No gameplay rules were changed.

### The build was broken and nobody knew

`npm run build` (`tsc && vite build`) **failed on a clean checkout** with three
`TS2353` errors in `BootScene`: `this.make.graphics({ add: false })` no longer
type-checks, because Phaser dropped `add` from `Graphics.Options` in favour of an
`addToScene` second argument. The runtime still honours `config.add`, so the dev
server worked perfectly — Vite transpiles without type-checking — and the type
error only ever surfaced in a command nobody ran. There had therefore never been
a production build, which is also why there was no demo.

Fixed to `this.make.graphics({}, false)`, which is behaviour-identical.

### The model no longer depends on Phaser

`config.ts` imported Phaser purely to type `GAME_CONFIG`, which dragged Phaser —
and therefore a DOM requirement — into every model file that reads the rules. The
Phaser options moved to `main.ts`, leaving `game/`, `tiles/`, `cards/` and
`utils/` runnable under plain Node. That is what made the unit suite possible
without jsdom or a canvas shim.

### Tests

100 Vitest tests over the model, weighted towards the bugs in this log: the
positive-modulo fix, dice staying in 1–6, deck exhaustion and reshuffling, the
jail state machine, bank stock conservation, and the turn-end guards. One test
deliberately documents that `_turnEndedThisRound` **cannot** block a stale
`endTurn` — that is `GameScene.turnGen`'s job — so the counter cannot be removed
later as apparent duplication.

`tools/playtest.mjs` drives the built game in headless Chromium: 45 seeded turns,
failing on any console error or inconsistent state. A given seed reproduces the
final positions and cash exactly, run to run.

### Smaller fixes

- **Menu player-count highlight** never updated: clicking "3" rebuilt the rows but
  left "2" highlighted, because the button colours were set once at creation.
- **Stale HUD caption** — the sidebar still read "▶ TAKE TURN = switch active
  player" after `a18490a` deleted those buttons. Removed; the debug switch is now
  reachable as `bus.emit('debug:forcePlayer', { index })` in dev builds.
- **Seeding was unreachable.** `GameScene` accepted `data.seed` but `MenuScene`
  never passed one, so the documented "reproducible games" feature could not be
  used. Now read from `?seed=` in the URL, and `PRNG.seed()` replaces the
  `rng['state']` private-field poke.
- **Logging** — 32 `console.log`/`warn` calls now route through `src/utils/log.ts`,
  silent unless `?debug=1` or the dev server. `console.error` untouched.
- Menu setup rows centred under the title instead of hanging off to the left.

---

## CI install failure — 2026-08-01 (same day, after the first push)

Every CI job failed at step 4, `npm ci`, on all three matrix legs plus the Pages
deploy:

```
npm error `npm ci` can only install packages when your package.json and
npm error package-lock.json are in sync.
npm error Missing: esbuild@0.28.1 from lock file
npm error Missing: @esbuild/aix-ppc64@0.28.1 from lock file        (27 in total)
```

**Why it passed locally and failed on CI.** The lockfile had been verified with a
clean `rm -rf node_modules && npm ci` — but with **npm 11.11.0**. `actions/setup-node`
with `node-version: 22` installs Node 22.23.2, which bundles **npm 10.9.8**. A
lockfile is only valid for the npm that consumes it, and these two disagreed.

**Root cause, which was a genuine dependency conflict.** `npm install -D vitest@latest`
installed vitest 4, which requires `vite ^6 || ^7 || ^8`, while `package.json`
pinned `vite ^5.2.11`. npm 11 resolved this by installing a *nested*
`node_modules/vitest/node_modules/vite@8.2.0` — so the app was building on Vite 5
while the test runner ran on Vite 8 — and then wrote a lockfile that recorded the
nested Vite but omitted its entire `esbuild@0.28.1` subtree. npm 11 reinstalls
from that incomplete lockfile without complaint; npm 10 recomputes the required
tree, finds the 27 packages missing, and refuses.

**Fix:** align the majors instead of letting npm nest a second copy — `vite ^7.0.0`,
which is what vitest 4 supports. One Vite, one esbuild, a complete lockfile that
**both** npm 10 and npm 11 accept. Side effects: `npm audit` went 3 advisories → 0
(the moderate esbuild and high postcss advisories were Vite 5's), the dependency
count dropped 62 → 51, and the Phaser chunk shrank 1,478 kB → 1,208 kB under
Rollup 4. Game behaviour is unchanged: the seeded playtest returns identical
positions and cash before and after.

**Guard added:** `tools/verify-install.mjs` (`npm run verify:install`). It fetches
the npm bundled with the Node major in `.nvmrc` and runs three checks with it:

1. `npm ci --dry-run` — does CI's npm accept this lockfile? (non-destructive)
2. `npm ls --all` — invalid or missing edges in the installed tree
3. any declared dependency installed at two different majors — the root cause,
   catchable before a lockfile is even written

Verified against a checkout of the broken commit: check 1 reproduces the exact CI
error and check 3 names the cause (`vite 5.4.21` at `node_modules/vite` vs
`vite 8.2.0` at `node_modules/vitest/node_modules/vite`). Both workflows now
resolve Node from `.nvmrc` and print `node --version && npm --version` before
installing, so the next such failure is diagnosable from the log alone.

---

## M3 — Ownership and development — 2026-08-12

The milestone that turns a working rules engine into a game worth finishing: you
can now see who owns what, and put houses on it.

### Refactor first, on purpose

ROADMAP's sequencing note argued that two pieces of the M8 engine work get more
expensive with every feature drawn on a tile, so they were done **before** the M3
features rather than after M7:

- **Board length and anchors (8a).** `Board` now takes a `TileDefinition[]`,
  publishes `size`, and resolves `start` / `jail` / `goToJail` to indices by role.
  Every `% 40` went through `move` / `stepsBetween`, both `position > 39` guards
  became `isOnBoard`, and the four `player.position = 10` assignments became
  `board.anchor('jail')`. `config.ts`'s `BOARD_SIZE` was deleted rather than wired
  up: nothing read it, and `board.size` is the real answer.
- **`BoardRenderer` (8c).** `GameScene.drawBoard()` was four near-identical loops,
  one per side. `TileLayout` now carries each tile's footprint, orientation and
  whether it is a corner, so the renderer has a single loop and asks each tile
  which edge faces the middle of the board. Owner bands, houses, hotels and the
  mortgage mark were written once each instead of four times.

`computeLayout` derives the corners from `perSide = (size - 4) / 4` and throws on
a length that cannot make a square, which is what a 12-tile test board in
`tests/board.test.ts` pins down along with its anchors and its wrap-around. The
existing 100 tests stayed green through both refactors — the point of having them.

### The two rules the model was missing

`Bank.buyHouse` and friends move cash and inventory and ask no questions, because
`Bank` has no view of the board. Rather than give it one, the legality half lives
in `game/BuildRules.ts`:

- you may only build on a colour group you own outright, none of it mortgaged;
- buildings stay within one of each other across the group, going up *and* coming
  down (a hotel counts as the fifth);
- a group with buildings on it cannot be mortgaged;
- a hotel cannot be broken up unless the bank has four houses to hand back —
  otherwise `Bank.sellHotel` silently leaves the lot bare.

Every check returns a *reason*, not just a verdict, which is what lets a greyed-out
button in the panel say why it is dead instead of doing nothing.

### The interface

- **Owner bands** on the rim edge of each owned tile, in the owner's token colour
  and carrying their **seat number**. The first draft used the owner's initial and
  every tile on the board read `P` — the default names are all `Player N`.
- **Houses and hotels** along the colour stripe, using the textures `BootScene`
  had been generating for nothing since M1.
- **A property panel** in the dead column between board and HUD (x=770–1045):
  rent ladder with the tier actually being charged highlighted, prices, mortgage
  and redemption values, group-complete marker, and the six build/sell/mortgage
  actions. Clicking a tile opens it, clicking the same tile again closes it.

`Tile.ts` grew an `Ownable` interface and an `isOwnable` guard, which properties,
railroads and utilities all satisfy. That deleted the `as any` block in
`doBuyTile` where railroads and utilities used to have their `ownerId` assigned by
hand, and let `Bank.mortgage` / `unmortgage` / `sellPropertyToPlayer` widen from
`PropertyTile` to `Ownable` with no change to their bodies.

### Verification

- 29 new unit tests (129 total): `tests/build.test.ts` for the rules, and the
  12-tile map in `tests/board.test.ts` for the generalisation.
- `tools/playtest.mjs` now clicks an owned tile, asserts the panel opens on it and
  closes on a second click, and screenshots it. Tile coordinates come from a new
  `__forge.tileCentre(id)` rather than the `HOTSPOTS` table, so the harness holds
  no copy of the board geometry.
- The build path itself was driven once by hand against the real canvas — grant a
  monopoly, click **🏠 Build**, and the house appears, $50 leaves the player and
  the bank's stock drops 32 → 31; a second click is refused by the even-build rule.
  Only the temporary grant was thrown away.

### A trap worth recording

Naming the field `this.renderer` in `GameScene` fails to compile: `Phaser.Scene`
already has a `renderer` (the WebGL/Canvas renderer), and the error surfaces as
`Argument of type 'this' is not assignable to parameter of type 'Scene'` at every
`new Notification(this)` — nowhere near the actual clash. It is `boardView`.

---

## M4 — Cards, jail and rent edge cases — 2026-08-12

Four rule gaps and one visual bug, all of them things the M3 interface made
easier to notice.

### The token now walks the right way

`CardEffects.goBack` had been setting `player.position` backwards and then
emitting `player:move` with a positive `steps`, so the animation walked *forwards*
and the token snapped back when something next redrew it. The code carried a
`dwarn` describing exactly this, which is how it stayed known and unfixed.

`player:move` now carries `direction: 1 | -1` and `moveTokenStepByStep` walks
`board.move(from, s * direction)`. Checked against the real canvas by sampling
screenshots during the tween: from Chance (7) the token moves through Oriental (6)
and Reading (5) to Income Tax (4) — rightwards along the bottom row, which is
backwards — instead of heading left towards Jail and jumping back.

### "Nearest railroad" actually looks for one

`ch4` and `ch5` advanced to tiles 5 and 15 unconditionally, which also made `ch5`
a duplicate of "Advance to Reading Railroad". A new `advanceToNearest` action
scans forward from the player's own square — starting one step ahead, so standing
on a railroad sends you to the *next* one — and needs no index, so it works on any
map. `ch4` is the railroad, `ch5` the utility.

### Rent that depends on how you got there

The standard rules charge double on a railroad reached by card, and ten times the
dice on a utility however many the owner holds. The tile cannot know how the
player arrived, so the rate travels: `CardEffects` emits `rent:modifier` before
the move, `GameScene` holds it through the animation and hands it to the landing,
and it is cleared at `turn:start` so it can never leak into another turn. The
ordering matters — the GO salary fires *during* the walk, and its branch returns
before anything consumes the modifier.

### Rent moved out of the scene so it could be tested

Two of these are rules, and rules that live in a Phaser scene cannot be unit
tested. `quoteRent` in `game/Rent.ts` now answers "what does this tile charge",
covering the railroad ladder, the utility multiplier, the card-imposed rates and
the last M3 gap — **an unimproved complete colour group charges double**, which
the property panel had been advertising with `★ Group complete` while charging
single rent. `tests/rent.test.ts` pins all of it in plain Node; the panel shows
the doubled tier as `Bare lot ×2`.

### Get Out of Jail Free cards come back

The card used to be a counter on `Player`, so a card drawn was a card removed from
the game — `CardDeck` coped with the shortage but the deck was permanently one
card lighter. `Player` now holds the `Card` objects themselves,
`TurnManager.useGetOutOfJailCard` sends the spent one out on the `jail:exit`
event, and `GameScene` asks each deck `owns(card)` before calling
`returnToBottom`. Under the draw pile, not into the discard: it comes back into
play in its own time rather than waiting for a reshuffle.

`getOutOfJailCards` survives as a getter over the array, so the UI and the jail
button did not change — only the one test that had been assigning to it.

### Result

154 unit tests (up from 129), typecheck, build and the seeded playtest all green.
Still open, and now scheduled rather than merely known: building is offered only
on the owner's own turn (M5), a hotel cannot be broken up when the bank is short
of houses (M5, with the auction machinery), and a bankrupt player's jail card is
still lost with the rest of their estate (M5).

---

## M5 — Multiplayer interaction — 2026-08-12

The milestone that makes the win condition mean something. Four pieces: auctions,
trading, estate management out of turn, and a bankruptcy that actually settles.

### Model first, four times over

Each piece went in as a Phaser-free class with tests before any canvas work, which
is why the UI for all four is thin:

- **`game/Auction.ts`** — round-robin bidding where a pass forfeits for good. The
  fiddly part is the turn pointer: when the bidder on turn passes, the next bidder
  *slides into the seat just vacated*, so the index stays put rather than
  advancing. A first attempt decremented it conditionally and skipped a player.
  Settlement is two rules — nobody left, or one bidder left and the standing bid
  is already theirs (you do not get asked to outbid yourself).
- **`game/Trade.ts`** — a two-sided offer validated in full and applied in full,
  so it can never half-happen. Cash is *netted*, so a $200-for-$180 swap needs
  neither side to front the gross. A counter-offer is `reverseOffer` and nothing
  else.
- **`game/Estate.ts`** — the fire sale. Buildings go first, tallest lot first
  (which is also what the even-selling rule wants), then deeds by mortgage value,
  largest first, so the fewest possible change hands. Only when that is exhausted
  is the player bankrupt, and then the whole estate — deeds, mortgage flags and
  jail cards — passes to the creditor.
- **No timer in the auction model.** The clock is in `AuctionPanel`, because
  "ran out of time" is a UI event; it calls the same `pass()` the button does.

### `Player.pay` was hiding every debt

`pay()` clamps at zero, so a player could never owe more than they held — which is
why partial payment used to silently "work" and a bankrupt player kept their
deeds, still charging rent. Every charge now routes through `settleDebt`: rent and
tax in `GameScene`, and `payBank` / `payAll` / `repairs` in `CardEffects`, which
had been calling `bank.collectTax` directly. `GameScene.checkBankruptcy` — the
old `cash <= 0` guess — is gone, because the settlement is what decides.

One invariant nearly slipped: `transferEstate` zeroed any buildings still standing
instead of returning them to the bank, which would have leaked houses out of a
fixed supply. A test that asserted stock conservation caught it.

### Trading, and the fixed layout that bit back

`TradePanel` reserves 11 deed rows a side so both columns line up, and everything
below hangs off that. The first version anchored the footer to the frame bottom
instead, which left ~120px of dead space; re-anchoring it to the list shrank the
panel from 470px to 404px — and immediately broke the playtest, because the
harness's click coordinates are derived from those same constants. The failure
mode is exactly what CLAUDE.md warns about: a vague "accepting the trade did not
close the panel" rather than a clear miss.

### The bug that was not a bug

Checking bankruptcy end to end in headless Chromium, the turn appeared never to
end: phase stayed `WAITING_FOR_ROLL` after the `safeEndTurn(700)`. It turned out
the headless clock runs slow — the 700 ms timer landed at about 2 s of wall time.
Polling for the state instead of sleeping for the nominal delay showed the whole
chain working: fire sale → bankruptcy → estate transfer → `game:end` →
"Player 2 wins!". Worth remembering before hunting a phantom.

### The house rule that finally does something

`noAuction` has been declared in `config.ts` since M1 and read by nothing. It now
picks between the two behaviours for a declined property: leave it unowned (old),
or put it under the hammer (default). Three flags still do nothing.

### Verification

- 201 unit tests (up from 154): auction settlement, trade validation and netting,
  fire-sale ordering, estate transfer, and stock conservation through a bankruptcy.
- The playtest harness now bids in the first auction it meets, passes everyone out
  of the rest, and drives a real trade — open, select a deed, propose, accept —
  asserting the deed actually changed hands. It fails if no auction ever happens.
- Bankruptcy was driven once by hand against the real canvas, since a 26-turn
  seeded game will not produce one: $40 and two mortgaged-away lots against a $900
  debt, ending in the estate moving and the game declaring a winner.

---

## M6 — Polish — 2026-08-12

Save/load, the house rules that had never done anything, a turn log, tokens and
sound. The presentation milestone, plus the one piece of infrastructure that had
been deferred since M1.

### Save/load: the deserialiser, not the button

`SaveLoad.ts` (localStorage, versioned) has existed since M1 and `serialize()`
since M2; what was missing was everything that reads a save back. `game/Snapshot.ts`
is that half. Three things were called out in ROADMAP as the hard parts, and all
three turned out to be exactly as advertised:

- **Deck order.** Both piles are now saved as card ids in order, so a resumed game
  does not reshuffle and re-deal cards players have already seen.
- **Cards are shared objects.** A held Get Out of Jail Free card is the *same
  object* as the one in `CHANCE_CARDS`. It is saved by id and looked up again on
  restore — clone it and `deck.owns()` no longer recognises it, so the card could
  never be returned to its deck.
- **The PRNG stream position.** `rng.getSeed()` returns where the stream is, not
  where it started, and that is the value worth persisting.

That last one produced the milestone's real bug. A test asserting "a restored game
rolls what the saved one would have" failed, and the cause was not the seeding —
it was that `CardDeck.restore` built the deck through the normal constructor,
**which shuffles**. Rebuilding two decks therefore drew from the shared PRNG and
left the restored game two stream positions adrift before the first roll. The fix
is a `shuffle` flag on the constructor, and a test that pins the invariant
directly: `rng.getSeed()` is unchanged across a whole `restoreGame`.

A restore deliberately resumes at the *start* of the saved player's turn. Nothing
captures a half-finished move, an open card overlay, a running auction clock or a
half-built trade, so `saveGame` refuses while any of those is happening rather
than pretending to carry them.

The playtest now saves, reloads the page, clicks CONTINUE and compares the
restored state to the pre-save state field by field.

### The house rules, three years late

`HouseRules` was declared in M1 with four flags and read by nothing. `noAuction`
became real in M5. Now:

- **`freeParkingJackpot`** — `Bank` grew a `pot`; taxes and jail fines feed it and
  landing on Free Parking empties it into your hand. The jail fine had to start
  reporting *how much* was actually paid (`Math.min(fine, cash)`), because
  `player.pay` clamps and the pot must not gain money nobody lost.
- **`doubleGoSalary`** — passing GO already pays; landing exactly on it now pays
  again.
- **`speedDie` was deleted.** It is not a flag but a variant: a third die, two new
  face effects and a changed turn structure. Half-implementing it would have been
  worse than the honest removal, and it is noted against the rule sets in M8b.

The menu grew switches for the three survivors — laid out in a row, because six
player rows reach y=578 and START begins at y=690, and the first attempt at a
column ran straight through the button.

### The toasts became the log

M6 had two items pointing at the same strip of screen: "fill the right-hand
column" and "stop toasts covering the roll button". Doing them separately would
have meant a turn log and a toast stack fighting over x=770–1045, so
`Notification` was rewritten in place as the log — same `show(message, type)`
signature, so all ~30 call sites are untouched. Entries arrive at the top, push
older ones down, dim with age and are dropped when they fall off the bottom.

### Tokens and sound, still with no assets

`BootScene` had been generating `token_*` textures since M1 that nothing drew, and
the board drew coloured circles instead. The textures are now a coloured disc with
the token's emblem baked in via a `RenderTexture`, and each piece became a
container holding the sprite plus a seat-number badge — a container because the
badge has to keep its corner while the piece tweens, and because tokens converge
on the same tile centre when they share a square.

`ui/Sfx.ts` synthesises seven effects with Web Audio: no audio files, matching the
no-third-party-assets policy the artwork already follows. It lives in `ui/` rather
than `utils/` on purpose — `utils/` has to keep running in plain Node, and a
`window.AudioContext` reference would break every test that imported it.

### Left undone, on purpose

"Update the panels instead of rebuilding them" stays open. It is still not
measurable, and a diffing renderer is worth writing once against the theme work in
M8c rather than three times now. Auctioning houses when the bank runs short also
stays open: the machinery bids on a tile, not on stock.

### Verification

- 221 unit tests (up from 201), 18 of them on the snapshot round trip and its
  validation, plus the Free Parking pot.
- The playtest saves, reloads and resumes with byte-identical state.
- Both house rules were driven by hand against the real canvas — switches on the
  menu, $200 tax into the pot, the pot collected on Free Parking, and a doubled
  salary for landing on GO — since the seeded run plays with the defaults.

---

## Bug: ROLL DICE dies after three doubles — 2026-08-12

**Symptom, from a player.** Three doubles sent Player 2 to jail, the next player's
turn started, and the game stopped responding. Firefox's console showed
"Security Error: Content at http://localhost:3000/ may not load or link to
file:///", which turned out to be a red herring: that is devtools failing to fetch
a source map, not the fault itself.

**Reproduced** in Playwright's Firefox against the production build, by arming the
current player with `doublesStreak = 2` and a loaded die, then clicking ROLL for
real so the whole chain ran inside a genuine `pointerdown`. The game froze exactly
as reported — and the run recorded **zero exceptions**.

That ruled out the obvious theories. Probing further:

| probe | result |
|---|---|
| `phase()` | `WAITING_FOR_ROLL` — the model is fine |
| `isAnimating()` | `false` — not a stuck animation flag |
| TRADE button | opens the panel — input is *not* globally dead |
| clicking a board tile | opens the property panel — nor is the canvas |
| ROLL DICE | nothing, at full alpha |

So one button, still drawn as enabled, no longer firing: the failure mode
CLAUDE.md has described since M2 without ever pinning the mechanism.

**Root cause.** `setRollEnabled(false)` used `removeInteractive()`, which *queues
the object for removal* from the input plugin's list. `setRollEnabled(true)` then
calls `setInteractive()`, which creates a fresh interactive object and queues an
insertion. When both happen in the same frame, the plugin's next `preUpdate`
processes the removal — and removal calls `clear()`, which nulls the input object
that `setInteractive` had just created. The button is re-inserted into the list
holding `input === null`, so every hit test skips it.

Every turn change does exactly that: `turn:end` disables the button and
`turn:start` re-enables it, synchronously, in one frame. It had never mattered
because **every turn until now ended after a move**, and the `player:move` handler
had already disabled the button, making the `turn:end` call a no-op. Three
doubles is the one path that ends a turn without moving — `sendToJail` emits
`jail:enter` and no `player:move` — so the button was still live at `turn:end`,
and the disable/enable pair landed in the same frame for the first time.

This is not an M6 regression: `setRollEnabled` has been written this way since M2.
It needed a 1-in-216 sequence to show itself.

**Fix.** `disableInteractive()` instead of `removeInteractive()`. It only flips
`input.enabled`, so nothing is ever queued, and `setInteractive()` on an object
that already has an input just re-enables it. `setJailBtnVisible` had been using
the safe pair all along.

**Why the harness never caught it.** It clicks ROLL every turn regardless, so a
dead button produced a run that still passed: the end-state assertions were
satisfied by what the *earlier* turns had done. The playtest now records the model
state around each roll and fails after three consecutive rolls that change
nothing — verified by deliberately killing the button after four turns and
confirming the run fails with "the ROLL button has stopped responding".

---

## M6 follow-up: the two items left open — 2026-08-12

M6 shipped with its heading marked done and two boxes unticked, which is not a
state a roadmap should be left in. Both are now resolved — one built, one moved
with its blocker named.

### Built: stop rebuilding a panel that has not changed

`PropertyPanel` and `TradePanel` keep the JSON of the view they last drew and
return early when the incoming one matches. This is not a micro-optimisation
looking for a problem; it fixes a case that recurred every turn. `refreshPanel()`
fires on `turn:start`, and since M5 the panel's buttons belong to the tile's
*owner* rather than to whoever is rolling — so the view is usually identical from
one turn to the next, and rebuilding it destroyed and re-created every child,
dropping the hover state under the player's cursor.

`AuctionPanel` is deliberately excluded: its `show()` also restarts the bid clock,
so an early return would silently skip a bidder's timer. It is only ever called
when the auction has actually moved on.

Diffing a view that *has* changed is a different job, and it moved to M8c: holding
references to drawn elements and writing to them is the same problem as rendering
a theme, and worth solving once there instead of three times in three hand-written
panels.

### Moved to M8b: auctioning scarce houses

This one does not fit the interaction model yet, and saying so is more useful than
a half-built version. The rule reads "if two or more players wish to buy more than
the Bank has, the houses must be sold at auction" — it exists to settle
*simultaneous* demand. A turn-based click UI never produces any: players ask one
at a time, and turn order settles it.

Building it would need three things that have no home in this build:

1. a notion of who *else* wants a house right now — only a rule set, or the M7
   bot, can answer that;
2. a step where the auction winner nominates which lot to build on, which the
   current build flow (click Build on a specific tile) has no place for;
3. `Auction` bidding on an arbitrary subject rather than a `tileId`.

All three are M8b's work, so that is where it went. What the game does today —
whoever builds first gets the last houses — is now written down in KNOWNISSUES
rather than left as an unticked box.

---

## M7 — Opponents you can play against — 2026-08-12

Bots for the demo game. The simulation platform that runs thousands of games went
to M8d, on the reasoning that both are wanted but only one of them is what a
person sitting down to play needs — and the same bots will drive the simulator, so
the decision layer was built to be reusable from the first line.

### The line that matters

`game/Bot.ts` **decides**; `GameScene` **drives**. The policy answers questions —
buy this? bid how much? build where? accept this offer? — and the scene applies
the answers through the same paths a button would. Nothing in `Bot.ts` touches a
scene, a button or a tween, because M8d's headless runner will not have any.

Two properties are load-bearing:

- **No randomness.** A bot that drew from `rng` would move the dice stream and
  stop a seeded game replaying. Every decision is a pure function of the state,
  which also makes a misbehaving simulated game debuggable.
- **Deterministic for a given state**, pinned by a test that asks the same
  questions twice and compares.

`Player.isBot` is game state, so it is in the snapshot (`SNAPSHOT_VERSION` → 3): a
saved game resumes with the same seats.

### Anything that waits for a click will wait forever

The first bot game froze after 19 ticks. The cause was structural rather than
subtle: `CardScene` waits for **OK**, and nobody clicks it for a bot. Any modal is
the same trap, so the buy prompt is *answered* rather than shown, and a bot's
drawn card closes itself after a beat. That is now written down in CLAUDE.md as
the rule for adding the next prompt.

### The stall that was not a stall

Then the bots ran for two minutes and stopped again, always in the same auction.
The evidence looked damning: the console trace ended mid-auction, the scheduled
bid callback never logged, and the state sat frozen for seven seconds.

Chasing it turned up nothing wrong with the game. The loop was running (a frame
counter proved it), the clock was not paused, timers were being created and
retired, and no exception was ever thrown. The bug was in **the detector**:

```js
const serialised = JSON.stringify(now.players);   // ← players only
```

Bidding does not touch anybody's cash or position until the auction settles, so a
busy auction and a frozen game look identical through that lens. Meanwhile the
bots were bidding the table minimum — $10 a raise, 600 ms apart, climbing toward a
$284 ceiling — so the auction genuinely took half a minute of wall time while the
harness watched a "frozen" player list.

Two real fixes came out of it. The harness now hashes the whole state plus the
auction, so bidding counts as progress; and `nextBid` raises by a tenth of face
value instead of the table minimum, which settles a $300 deed in a handful of
rounds rather than thirty. The second one matters more for M8d than for a human
watching: a thousand simulated games of thirty-round auctions is a lot of nothing.

The lesson is the cheap one to forget: when a detector says "nothing is
happening", check what it is actually looking at before believing it about the
thing it is watching.

### Verification

- 248 unit tests (up from 221), 27 of them on the policy: buying, bidding
  ceilings, the jail heuristic, build plans, redemption order, trade valuation,
  and the determinism contract M8d depends on.
- `npm run playtest -- --bots` hands every seat to a bot and watches: it fails if
  they stop playing, and reports a game one of them wins outright.
- Development was verified by handing a bot a complete colour group and watching
  it put three houses on each lot — evenly, within its cash reserve, and inside
  the bank's stock.

---

## Tokens that share a square — 2026-08-13

**Reported:** pieces on the same tile sat on top of each other, so a square with
three players on it looked like one player with a smudge.

The cause was a single line repeated in three places: every mover tweened to
`layout.x, layout.y` — the exact centre of the tile. `spawnTokens` had a table of
fixed per-seat offsets that scattered the pieces at GO, but the first move threw
that away and they converged for the rest of the game.

### The arrangement

`ui/TokenCluster.ts` is pure geometry with no Phaser: one token sits dead centre,
two take the ends of a line, three make a triangle point-up, and more spread
evenly around a ring. Pieces shrink as the crowd grows, because six 22px tokens do
not fit inside a 56px tile however they are arranged. A test pins the properties
that matter — evenly spaced on one ring, balanced about the centre, no two in the
same spot, and the whole cluster inside the narrow side of a tile.

### The part that was not obvious

Rebuilding a cluster means knowing who is standing on the tile, and **the model
cannot answer that during a move**: `TurnManager` sets `player.position` to the
destination before the walk begins, so mid-animation the model already believes
the walker has arrived. `GameScene.tokenTile` tracks where each piece is *on
screen* instead, and that is what the clustering reads.

With that in place the per-step rule is simple, and it covers the case in the
report — a token merely passing through:

1. book the walker onto the next tile,
2. re-space the tile it just left,
3. re-space the tile it is entering, minus the walker,
4. tween the walker into its own slot there.

So walking across a busy square makes the occupants open up, then close again as
the walker leaves.

### Verification

- Three tokens on GO form a triangle; when one walks away the other two fall back
  to a line, 22px apart on the same y.
- Sampling token positions every 60 ms during a walk shows the stationary pieces
  shuffling *while* the walker is in flight, not after it lands.
- The playtest now asserts, at the start and after every turn, that no two tokens
  on the same tile are within 8px of each other — the glitch cannot come back
  quietly.

---

## M8a — the board stops being 40 tiles in a square — 2026-08-13

The half of M8a that was left: geometry that comes from the map, and a map that
is a file. The test for it was suggested rather than invented — boards with two
or three inner rings, or completely round ones — and it was the right test,
because a circle breaks every assumption at once.

### One idea does all the work

**Every tile is a rectangle in its own frame, and the board's interior lies past
its local top edge.**

That single rule replaced every branch about sides. A bottom-row tile is that
frame unrotated; a left-column tile is the same rectangle turned 90°; a tile on a
ring is turned to whatever angle points it at the centre. `BoardRenderer` draws
all of them through one path — `translateCanvas`, `rotateCanvas`, draw around the
origin — and the stripe, the houses, the owner band and the click zone follow the
tile round for free.

`TileLayout` changed shape to suit: `w`/`h` are now the tile's *local* footprint
rather than a pre-swapped screen rectangle, and `rotation` carries the
orientation. The old `side` field survives for the square, where "which row is
this" is still meaningful, and is `null` on a shape that has no sides.

`game/BoardLayout.ts` turns a `LayoutSpec` into coordinates: `square`, `ring` and
`rings`. `Board` no longer computes anything; it asks.

### A map is a file

`src/maps/` now holds `GameMap` — tiles plus the shape they are laid out in —
`validateMap`, and three boards: the classic square, **Roundabout** (24 tiles on a
circle, no corners) and **Orbits** (30 tiles across three concentric rings). The
classic board moved out of `config.ts`, which is the point at which "the classic
board" and "the board" stopped being the same thing.

`validateMap` earned its place immediately: on their first run it rejected both
new boards, for four real reasons — colour groups whose lots disagreed on the
house cost (my helper derived it from price, so lots in a group differed), and a
group with a single lot that could never be completed. Those are exactly the
mistakes a hand-written map makes.

It also flushed out a leak that had been sitting in plain sight: `GROUP_SIZES` in
`config.ts` said how many lots each colour group has — **on the classic board** —
and both `Bot.isStrategic` and the property panel believed it. On a board where
light blue has two lots rather than three, the bot would misjudge every purchase.
Group size now comes from `board.groupTiles(group).length`, and the table is gone.

### What the circle taught

Two things only a non-square board could have found:

- **Tile widths must be sized off the arc at the tile's *inner* edge.** Sizing off
  the arc at its middle looks obviously right and overlaps every neighbour, because
  a rectangle's inner corners sit where the same angle buys less room. The first
  render of Orbits was a pile of overlapping plates.
- **Labels have to turn with the tile** — a wedge cannot hold horizontal text —
  **but must never print upside down.** A tile facing away gets its text spun the
  other half turn. The classic board's top row now reads the right way up, and its
  side columns read vertically, which is what a real board does.

The shipped card decks also name classic tiles: "Advance to Boardwalk" is tile 39,
which a 24-tile board does not have. It used to wrap silently onto tile 15. Such a
card now does nothing and says so; decks belonging to a map is 8b's work.

### Verification

- 287 unit tests (up from 256). The geometry ones assert the invariant directly:
  on a ring every tile points exactly at the centre, on a square every tile points
  *into* the board (a corner faces its row, not the diagonal), and neighbours on a
  ring never overlap.
- The bots played a full game on all three boards, and the human path — buy
  prompts, auctions, a trade, save/reload/resume — was driven end to end on the
  round board. `npm run playtest -- --map orbits --bots` is repeatable.
- The classic board renders as it did before, which is the point: it is now one
  map among three rather than the shape the code is made of.

---

## M8b — rules become registrable — 2026-08-13

Three closed sets opened, and one that stays shut on purpose.

### The two switches

`Board`'s constructor held a `switch` over ten tile types; `CardEffects.execute()`
held a second over eleven card actions. Both are registries now —
`registerTileType(name, factory)` and `registerCardEffect(name, handler)` — with
the built-ins registering themselves, so nothing changed for the classic board.

Two details worth keeping:

- **The type unions stay named.** `TileType` is `BuiltInTileType | (string & {})`:
  `'railroad'` still autocompletes and a typo in a built-in is still caught, but a
  name the engine has never heard of typechecks fine. Closing the union was doing
  more work than the switch was.
- **A card effect gets a context, not the instance.** Handlers receive the board,
  the bank, the players and the three moves an effect actually needs (`advanceTo`,
  `nearest`, `charge`). Passing `this` would have made every private method of
  `CardEffects` part of the extension API by accident.

An unregistered tile type is refused by name — a board is better not built than
built wrong — while an unregistered *card* effect warns and does nothing, because
a deck with one odd card in it is still a playable game.

### The numbers that were constants

`game/Rules.ts` gathers what the classic game hardcoded: starting cash, the GO
salary, the jail fine and term, the doubles-to-jail count, the house and hotel
supply, and how many houses a hotel is worth. They resolve in three layers —
**classic → the map's → the player's switches** — and are reached through
`board.rules`.

The literals were in more places than the grep suggested: `TurnManager` had
`doublesStreak >= 3` and `jailTurns >= 3` inline, `Bank` had four `4`s for
breaking a hotel into houses, and `BuildRules` had two more. The Bank now takes
its supply from the rule set and exposes `housesPerHotel`, which let
`canSellHotel` stay a three-argument function instead of growing a board.

Both alternative boards now carry an economy: Roundabout pays $150 a lap rather
than $200, because its lap is shorter, and Orbits runs on 24 houses and 8 hotels,
which makes a monopoly worth more. That is the payoff — a rule set is part of a
board's design, not a global constant.

### Decks travel with the map

M8a left a hole: the decks were global and named classic tiles, so "Advance to
Boardwalk" pointed off the end of a 24-tile board. `GameMap.cards` closes it.
`validateMap` now refuses a deck whose cards name a tile the board does not have,
or that look for a tile type it lacks, and both alternative maps ship a
map-agnostic deck — every card either moves you relative to where you are or moves
money.

A save carries the map id and the rule set, so a resumed game plays by the rules
it was played under, on the board it was played on. `SNAPSHOT_VERSION` is 5.

### What was deliberately still shut

Turn order and the win condition were still decisions `TurnManager.advancePlayer`
made on its own. They could have been two more fields on `GameRules`, but that
would have been a bad trade: "seat order, last solvent player wins" is not a
number, it is a shape, and the honest home for it was the phase pipeline. Written
down in KNOWNISSUES rather than half-configured — and built next.

### Verification

- 301 unit tests (up from 287). The new ones register a tile type the engine has
  never heard of and play a board made of it, register a card effect and run it,
  replace a built-in effect, and check the rule set layers classic → map → player
  in the right order.
- Bot games on all three boards; the human path — buy, auction, trade, save,
  reload, resume — on the round board, which now exercises a map with its own
  rules *and* its own decks. `--map orbits --bots` reports `bank h/h 24/8`, which
  is that map's supply rather than the classic one.

---

## M8b (2) — the turn becomes a pipeline

### Reordering what was left before building any of it

Four items were open in 8b and two of them were the same work written twice:
"turn order and the win condition are hardcoded" and "generalise the turn
structure" both described `advancePlayer`. Merged. The remaining three were then
listed in the order they could actually be built rather than by difficulty —
which is what had put the pipeline *last*, described as "the hardest piece to open
up". Difficulty is the wrong axis to schedule on when everything else is blocked
on the thing you are deferring: the speed die needs an extra phase, scarce-house
contention needs a phase that polls the table, and turn order and the win
condition *are* pipeline parts. Building any of them first would have meant
writing a private pipeline inside `TurnManager` and then deleting it.

So the pipeline went first, and the rest of this entry is it.

### Three seams, opened three different ways

`game/TurnFlow.ts`. They are genuinely different problems and it would have been
worse to force one mechanism onto all three:

- **Phases are a list.** Named, ordered, `insertAfter`/`replace`. `TurnManager`
  no longer assigns `this.phase` anywhere — `enterPhase` is the single writer,
  and it runs whatever the rule set hung on that phase and emits `turn:phase`.
  That is what makes an added phase indistinguishable from a built-in one.
- **Turn order is a registered function**, named by `rules.turnOrder`.
- **The win condition is another**, named by `rules.winCondition`.

Named by *string*, not passed as functions, and that is the load-bearing
decision: the rule set is saved with the game, and a function does not survive
`JSON.stringify`. It is the same argument that made tile types and card effects
registries, so it is the same shape — and `validateSnapshot` now refuses a save
naming a strategy this build has not registered, rather than letting `TurnFlow`
throw half-way through a restore.

### The awkward part: a turn is mostly waiting

The obvious pipeline — a loop that runs the phases to completion — cannot work
here. `MOVING` waits for a tween, `AWAITING_BUY_DECISION` waits for a click; the
model is not in charge of when they end and must not be. So the six built-ins are
marked `driven`: something outside enters them, and `endTurn`'s walk skips them
entirely. Without that flag, ending a jailed player's turn from `WAITING_FOR_ROLL`
would have walked *forward* through `ROLLING` and `MOVING` on the way to
`END_TURN`, which is nonsense; there is a test pinning it.

A phase a rule set adds is not driven, so the walk runs it — and can `hold()`,
parking the turn until `resume()`. The re-entry guard stays set across the hold,
so a held turn still cannot be ended twice.

### Two bugs the seams exposed

- **A bankrupt player kept rolling.** `endTurn` handed out the doubles re-roll on
  the dice alone: a player who rolled doubles and then went under settling what
  they landed on took another turn from the grave. Moving the rule into the
  `'seat'` order made it one condition in one place, and the missing
  `!player.isBankrupt` was obvious as soon as it was written out.
- **The game did not end until somebody failed to roll a pair.** The win check
  ran only on the non-doubles branch, so bankrupting the last opponent on doubles
  left the winner rolling against an empty table. `advancePlayer` now asks the
  win condition before anything else.

Both have tests, both were invisible in a hand-played game.

### Rounds, and why the counter needs a companion

`roundLimit` is the win condition people actually want when they do not have
three hours, and it needs to know what round it is. Counting "the seat index
wrapped" only works for seat order, so a round ends when play reaches somebody who
has already had a turn in it — true for any order, including a reversed table.
That means `round` alone cannot be restored: the set of seats already seen is what
places the next boundary, so both go in the snapshot (`SNAPSHOT_VERSION` 6). The
win condition is asked about the round *about to start*, so `roundLimit: 1` ends
the game when everybody has had one turn rather than one turn later.

### Found on the way

- **`restoreGame` built `new Bank()`.** The saved counts were then written over
  it, so it looked right — but `housesPerHotel` came from the classic rules, and a
  map that said three would have restored saying four. One-word fix, and the kind
  of thing only a map with different rules can reveal.
- **Railroads and utilities never reported their owner.** `toJSON` carried
  `ownerId` on `PropertyTile` alone, so a serialised board said nothing about who
  held a railroad. Invisible on the classic board — the playtest's trade step
  happens to pick a lot there — and it failed immediately on Roundabout, where
  the deed it picks is South Halt. Ownership moved to the base `Tile.toJSON`,
  behind `isOwnable`.

### Verification

- 331 unit tests (up from 301). The new file plays turns through a flow with a
  phase the engine has never heard of, holds and resumes one, swaps `ROLLING` for
  a handler that rewrites the dice, registers a team turn order and a bespoke win
  condition, and pins the round arithmetic including the doubles case.
- The human path and the bot path on all three boards. The harness no longer
  keeps its own list of phases — it asks `__forge.phases()` — and it now checks
  the round counter and that the round survives save/reload/resume.

---

## M8b (3) — the three items that were waiting

With the pipeline in place the rest of 8b went in together, and each took a few
hours. That is the whole argument for having reordered them: as written, the list
had the trunk last and three branches ahead of it.

### A variant is a bundle, which is why it was never a boolean

M6 tried to ship the speed die as `speedDie: boolean` and deleted it instead,
correctly. It is two things at once — a third die changes what a *roll* is, and
two of its faces add a *step* to the turn — and neither seam alone expresses it.
So `game/Variants.ts` registers the pair: a `dice(rules)` and an `apply(flow)`.
Named by string in `rules.variants`, for the third time in this milestone and for
the same reason: the rule set is saved with the game, and `['speedDie']` survives
`JSON.stringify` where a pair of functions does not.

`game/SpeedDie.ts` then needed nothing at all from `TurnManager`, which was the
acceptance test the roadmap set for the pipeline. The menu grew no case for it
either — it lists `knownVariants()` beside the house-rule switches, so a variant
that registers itself appears there without the scene being edited.

Two face effects, and both are one rule where the printed text is two:

- **Mr. Monopoly** advances you to the next deed that is not already yours.
  Unowned, and the ordinary landing gives you the buy prompt; owned, and it
  charges you rent. The official rule says both of those separately.
- **The bus** takes you to the next Chance or Community Chest tile.

### The bit that needed care: a phase that moves the token

The bonus move cannot finish inside the phase — the token has to walk, which is
the scene's business. So the phase emits `player:move` and calls `hold()`, and the
landing resumes the turn. Two things had to be true for that to terminate:

- **`safeEndTurn` resumes a held turn instead of ending it.** The landing is
  asking for the rest of the turn; a second `endTurn` would be swallowed by the
  re-entry guard and the turn would hang for ever.
- **The phase consumes the face.** The walk comes back *through* the phase when
  the turn resumes, and an unconsumed face would move the player again, and again.
  There is a test named after exactly that.

### Contention: the rule was blocked on a definition, not on machinery

"If two or more players wish to buy more houses than the Bank has, the houses must
be sold at auction." Open since M5, and deferred three times with the same
reason — a turn-based click UI never produces simultaneous demand.

What actually unblocked it was deciding what *wishes to buy* means without asking
anybody: **a player who owns a lot the build rules would allow a house on, and can
afford it, is bidding.** That is a pure function of the board, so it needs no
prompt, no answer `Bot.ts` cannot give, and the simulator will get the rule for
free. It is generous — someone who was not going to build still counts — which
only matters when the bank is down to its last houses, which is when the rule is
meant to bite.

The rest followed: `Auction` sells an `AuctionSubject` rather than a tile id (item
3, built for this and for the bankrupt-estate auction that is still open), gained
a **reserve** so scarcity cannot make a house *cheaper* than its printed price,
and `Bank.buyHouse` takes an optional price the same way `sellPropertyToPlayer`
always has. The winner does not choose the lot — whoever asked gets what they
asked for, anyone else gets their cheapest legal one — because choosing needs a
prompt. Both decisions are in KNOWNISSUES, not buried in a scene.

`houseAuctions` defaults to **on**, because it is not a house rule. It is the
rule; the game has simply been playing without it.

### Verifying a rule no game reaches

The bots never complete a colour group, so a `--bots` run ends with all 32 houses
still in the bank — the shortage the rule exists for never happens. Rather than
ship the scene wiring with unit tests alone, the debug handle grew its one
*writing* hook, `forceHouseShortage()`: two complete groups, one house left. The
bot run calls it a third of the way in and then asserts that a house went under
the hammer with at least two bidders. It fires on all three boards:

```
· arranged a house shortage around tile 1
  house auction  held, 2 bidders, opened at $50
```

### Verification

- 359 unit tests (up from 331). New files for the variants and the speed die
  (13) and for contention (15) — who is claiming, when the rule bites, what the
  reserve is, where the house ends up, and what a bot will pay for one.
- Bot runs on all three boards, all now exercising a contested house; the human
  path with `--variants speedDie`, which reports a seven-phase turn and still
  saves, reloads and resumes identically — a restored game rebuilds the speed
  dice, because `restoreGame` asks `diceFor(board.rules)` rather than `new Dice()`.

---

## A pass over KNOWNISSUES

Not a milestone — a sweep of the defects that were not waiting on anything. The
triage mattered more than any single fix: of eighteen entries, four were already
scheduled elsewhere, three were explanations rather than defects, one waited on an
open question, two belonged in a milestone and were moved there, and six were
simply undone.

### The two that were moved rather than fixed

Both were unscheduled and both were self-contained, so by the rule they should
have been fixed. They were not, because each has a milestone that makes it *not
optional*, and doing it early means doing it twice:

- **Landing side effects, sequenced by `safeEndTurn(700)` and friends** → 8d. A
  headless runner has no tween to be slower than and no clock to wait on, so the
  landing has to report completion before the simulator can play one game.
- **`TradePanel` reserving 11 rows whatever players hold** → 8c, beside the
  panel-diffing item. Same three files, same layout constants, and the same
  hotspots to recompute by hand afterwards.

### Six fixed

- **Duplicate tokens.** The selector cycled each row independently, so two seats
  could both be "Car" — one colour, one owner band, nothing to tell them apart.
  It skips what is taken now. Eight pieces, at most six seats.
- **The auction clock was a constant.** `auctionSeconds`, `bidIncrement` and
  `bidSteps` are rule-set values. What is left is the panel offering three fixed
  buttons, which needs a stepper and a hotspot recalculation.
- **A bankrupt estate returning to the bank vanished unowned.** It is auctioned
  deed by deed now. The interesting part was not the auction — `Auction` already
  sold a *subject* — but the sequencing: `transferEstate` had to report what went
  back (the tiles are unowned by the time anyone hears about the bankruptcy), and
  `safeEndTurn` had to learn to wait for a queue, or the next player would start
  rolling into an auction. A subject stays *in* the queue until it opens, so
  there is never a moment where the queue looks empty and the turn slips out.
- **The turn log destroyed anything that scrolled past the bottom.** It keeps
  everything now and the drawn strip is a window onto it — the wheel scrolls back,
  and a scrolled-back view holds its place instead of jumping every time the game
  says something. `__forge.log()` exposes the history, which the playtest uses to
  count what the bots did.
- **The playtest never touched the house rules.** `--house-rules` plays with the
  jackpot and the double salary on, asserts the game is really playing them, and
  fails if the pot never takes a penny — *or* if it fills with the rule off.
- **Bots never proposed a trade.** Below.

### The bots' trade, and the policy that made it impossible

`proposeTrade` was meant to be the easy half. It was not, and the reason is worth
recording: `acceptTrade` refused to hand over a deed completing somebody else's
colour group **at any price**, and the only deed a bot ever wants is exactly that
one. Two bots each one lot short of a different group sat across the table from
each other for a whole game. A proposer built on top of that veto would have made
offers that could never be accepted — a fix that demos and does nothing.

So the veto became conditional: a bot will part with your key **in exchange for
its own**. Cash alone still will not buy it, and the test that pins "not for
$5,000" still passes, because $5,000 comes with no key attached. Two monopolies
made at once is the trade real players make.

The proposer then writes itself. It looks for a lot somebody else holds that
completes a group for it, offers back one of theirs that it can never complete
anyway, and tops the offer up with the *smallest* cash that gets a yes — found by
asking `acceptTrade`, the partner's real policy, by binary search over the budget.
No randomness, deterministic, and it declines to spend into its reserve.

One bug found by writing the test rather than the code: the first version happily
proposed swapping Mediterranean for Baltic. Both sides' valuations said yes — each
was getting a "key" — and the brown group stayed exactly as split as before. The
two keys have to belong to *different* groups for the trade to be what it claims.

Bots trade only with bots. Whether an opponent should interrupt a person's turn
with an unsolicited offer is a question about the game's manners, not about the
trade, and it is written down as such.

### Verifying two rules a played game does not reach

The house-shortage hook from 8b got a sibling, `forceBankruptcy()` — it settles a
debt the victim cannot cover through `settleDebt` and `announceSettlement`, the
same path a tax bill takes, so what it exercises is the real chain. The bot run
calls it a fifth of the way in and then asserts that the estate went under the
hammer. It matters more than it sounds: had the queue been wrong, the symptom
would have been a turn that never ends.

```
· bankrupted p1 owing the bank — the estate goes to auction
  estate deeds   14 tick(s) with a returned deed under the hammer
  bot trades     3
  log lines      35
```

### Verification

- 367 unit tests (up from 359): what `transferEstate` reports as returned, and
  six for the bot's proposals — the threshold cash, the reserve it will not spend
  into, the same-group swap it must not make, and that it decides the same way
  twice.
- Human runs on the classic and round boards, with the speed die, and with
  `--house-rules` (biggest pot $500 with the rule on, $0 with it off — both
  asserted). Bot runs on all three boards, each exercising a contested house, a
  returned estate, and a turn log longer than the screen.

---

## M8c — presentation becomes a theme

Four items, and the two halves turned out to be the same idea twice: *hold a
reference to what is drawn, and write to it.* A theme is that for colour, a
`Surface` is that for a panel.

### One object, and a second theme to keep it honest

`ui/Theme.ts` gathers the board's ground and outlines, the colour groups, the
token colours, the panel palette, the chrome around it and the log's stripes.
`GROUP_COLORS` and `TOKEN_HEX` are gone rather than moved, and so are about a
hundred literals across seven files.

Two decisions worth recording:

- **A theme is not game state.** It is not in `GameRules` and not in the
  snapshot. A saved game is the same game whatever colour it was played in, and
  restoring somebody else's palette over yours would be a strange thing for a
  save file to do. It is chosen at boot from `?theme=`, or from a chip on the
  menu, and that is all.
- **A second theme is not decoration, it is the test.** *Parchment* exists
  because one palette hides everything: a colour still hardcoded looks correct
  until something else is meant to be different. Two catch it, and a unit test
  refuses a token or colour group that only one of them has a colour for. Two
  literals in `BootScene` were found exactly that way — the pieces stayed
  brick-red on a paper board because their textures were baked with a private
  table.

That baking moved to `ui/Textures.ts` and runs again when the menu changes theme,
which is also why switching mid-*game* is not offered: the HUD, the buttons and
the board's static layer are drawn once at `create()`. Offering a switch that
repainted half the screen would be worse than not offering one.

### How a tile draws is a registry now

`BoardRenderer` knew that a property has a colour band and that nothing else has
anything. `registerTileDecoration(type, fn)` replaces that, and the handler is
given the tile's **own frame** — origin at its centre, already rotated, the
board's interior past its top edge. That is the geometry work from 8a paying off
a second time: a decoration written once is right on a square board, a circle and
a three-ring spiral, with no branch anywhere.

The nine non-property types gained a glyph where a lot has its stripe, which is
the first time the board has told a railroad from a utility at a glance.

### The panels: written to, not rebuilt

`ui/Retained.ts` is a `Surface` — named elements, a render pass between `begin()`
and `end()`, and only what the pass did not ask for is destroyed. All three panels
draw onto one.

The part that needed care was buttons. A handler closes over the view it was drawn
for, so re-adding a listener each render is how leaks start; instead the listener
is registered once and calls whatever is in a slot the surface rewrites. Only the
hover colours are re-bound, because those *are* the view.

### Measuring a list, and what it cost

`TradePanel` sizes its deed list to the players' actual holdings. Which moves its
buttons — and the playtest clicked three of them at coordinates copied out of the
file by hand, the fragility CLAUDE.md has warned about since M5.

So the panel reports where its controls are, and the harness asks:

```js
await clickGame(page, box, await tradeSpot(page, 'propose'));
```

Three entries left `HOTSPOTS` and the warning above them went too. That is the
better outcome than a comment telling the next person to recompute them.

### A bug the matrix found

Running every configuration afterwards turned up a real one, in the *previous*
pass's work rather than this one:

```
🔴 BUG DETECTED — animation finished for Player 3
   but turn has already advanced to Player 2
```

`finishAuction` ended the turn for any auction whose subject was a tile. That is
right for a declined property — the buy prompt refused it and the turn is over as
soon as it sells — and wrong for a returned estate, which is sold in the *middle*
of somebody's turn and can open while a token is still walking. Ending the turn
there fires the walk's landing on the next player.

Two fixes: `auctionEndsTurn` says which auction is the reason a turn is ending,
and a queued auction waits while a token is moving. Worth noting that this only
appeared on Orbits with a particular turn count — the forced-bankruptcy and
forced-shortage hooks fire at fractions of the run length, so a 40-tick run is a
different game from a 50-tick one, not a prefix of it.

### Verification

- 375 unit tests (up from 367). The new file checks the theme registry and its
  fallback, the `hex()` conversion, the decoration registry, and — the one that
  will actually catch something — that every theme has a colour for every token
  and every colour group on all three boards.
- Ten playtest configurations green: the classic, round and orbit boards, human
  and bot, plus `--variants speedDie`, `--house-rules` and `--theme parchment`.

---

## M9a — a game is a folder

M8 made the parts configurable. This is the part that gives them somewhere to
live together: `src/games/<id>/`, one folder, one playable thing, picked as one
choice on the menu.

### What it actually was: mostly moving

`GameMap` had grown a `rules` field and a `cards` field in 8b, because there was
nowhere else to put them. The consequence was a *board* declaring
`{ goSalary: 150, startingCash: 1200 }`, which is a map doing a game's job. Those
two fields moving into `Game` is most of the diff, and with them went the split
that had been waiting to happen:

- **`validateMap`** is board coherence — ids that match the circuit, anchors the
  rules resolve by name, colour groups that can be completed, a shape the tile
  count can make.
- **`validateGame`** is everything that is a statement about a *pairing*: this
  deck against this board, this rule set against what this build has registered.
  The same deck is perfectly valid next to a different board, which is exactly
  why the check does not belong to either one alone.

### The part that was not moving

Five registries were module-level `Map`s. That is right for a browser tab playing
one game and wrong for the batch runner 8d is going to be, which is the whole
reason this milestone went in front of it: two games that each register a
`tollBooth`, or each replace `collectFromBank`, would quietly get each other's,
and a simulation that answers *wrongly* is worse than one that fails.

They became one `Registry` class with `capture` and `restore`, and `loadGame`
resets to the built-ins before applying a game's own. The limit is written down
rather than implied: this is **serial** isolation, one game live at a time, which
is what a batch is. If a runner ever needs two at once, the registries have to
become instances, and `games/scope.ts` says so.

`registerTheme` is deliberately outside the scoped set. A colour collision is not
a correctness problem, `themeById` already falls back, and scoping it would make
`games/` import `ui/` for nothing.

### The fourth game, which was not planned

Three games were scheduled. A fourth wrote itself while the type was being
tested: **Speed Die** is the classic map and the classic deck with
`variants: ['speedDie']`, and it is the shortest possible argument for the whole
milestone. Two games, one board, one field apart — and neither is a special case
in the engine or a switch somebody has to remember to tick.

Before this, "the classic board with the speed die" was not a thing you could
hand anybody. It was a board plus a chip on the menu.

### One ordering that is load-bearing

`gameById` **loads a game before it validates it**. That looks backwards until
you notice what validation asks: are this game's tile types registered, can this
board be built. Both are questions only answerable once the game's own
registrations are in force. The fallback path loads the classic game properly
rather than leaving the failed one half-registered.

### A game's preferences are defaults

`Game.theme` and `Game.variants` are applied when a game is picked and stop
applying the moment the player picks for themselves. Orbits names `parchment`,
which is the only reason `theme` is a field rather than a plan — a flag nothing
consults does not belong in this repo, and the same rule that deleted `speedDie`
in M6 applies to a game's fields.

### Verification

- 389 unit tests (up from 375). The new file covers the four games validating,
  the deck-against-board and rule-set-against-build checks, the fallback, and
  five on scoped registration — including the one that would have produced a
  wrong simulation rather than a crash: two games registering different handlers
  under one name.
- Nine playtest configurations: all four games, human and bot, plus
  `--house-rules` and `--theme parchment`. `--map` is gone from the harness.

---

## M8d — the simulator, and what it found

A game played to the end with no Phaser, no canvas and nobody clicking; then a
thousand of them; then the numbers. This is the milestone where a rules engine
stops being a claim.

### Two drivers, and the line between them

`sim/Runner.ts` is the *second* driver of the same model. `GameScene` is the
first: it animates a move, shows a prompt, waits a beat, ends the turn on a timer.
The runner does none of that — a move is a position change, every prompt is
answered by `Bot.ts`, and a turn ends the instant its landing returns.

The temptation was to let the simulator reimplement the landing. It would have
been a hundred lines and it would have been wrong within a month, because the two
would drift. So `game/Landing.ts` took the part that *decides* anything — quote
the rent, settle the debt, pot the tax, draw the card, pay what a free landing
pays — and both drivers call it.

What they do not share is timing, and that is the honest reading of the roadmap
item that asked for a landing "sequenced from completion rather than a delay".
`safeEndTurn(700)` is still there and should be: it is how long a person is given
to read what happened. The runner has no tween to be slower than. The point is
that the *rules* no longer depend on which it is.

### The first batch found a bug in ten seconds

```
✗ invariants broken in classic seed 13:
  deck: 15 cards accounted for, 16 were dealt
```

A bankrupt player's Get Out of Jail Free cards were **destroyed**. `transferEstate`
had a branch that said as much in its own log line — "N Get Out of Jail Free
card(s) lost" — written in M5 and never questioned. Enough bankruptcies would have
emptied a deck.

It is now a `card:return` event that both drivers listen for. Worth noting how it
was caught: not by a test somebody thought to write, but by a census that says
*every card is in exactly one place* run after every turn of every game.

### The second batch found a bug in the simulator itself

Speed Die and Classic reported **identical** medians, percentiles, win
distributions and unfinished seeds. Identical numbers from two different games is
not a coincidence; the runner was resolving `game.rules` and dropping
`game.variants`, so Speed Die was playing without the speed die.

The fix is `rulesFor(game, overrides)` in `games/index.ts` — one place where a
rule set is assembled, called by both drivers. With it, the two games separate:
median 162 turns against 257, and the bank runs out of houses in 19% of games
against 7%. Which is exactly what a third die should do.

### And one thing about the game rather than the code

Across 500 games, 24 of Classic's outran the turn cap — about 5%, and the same
rate for Speed Die. Following one to 60,000 turns:

```
turns=60000 rounds=12665 bankrupt=0
deeds={p1:5, p2:6, p3:6, p4:11}  houses=0  hotels=0
cash={p1:199711, p2:77616, p3:1109, p4:1407129}
```

Nobody ever completed a colour group, so nothing was ever built, so rent never
rose above the salary, so nobody could go under. **Monopoly does not always
terminate.** The roadmap had listed "every game reaches a winner" as an invariant
to check; it is not one, and it is not implemented. Neither is "total cash
conserved" — the salary and half the Chance deck create money and taxes destroy
it. An invariant that does not hold is worse than none.

What `npm run simulate` does instead is report them, and `--round-limit N` bounds
a batch by a rule rather than by a cap.

### The second policy is not better

`AGGRESSIVE_PROFILE` — almost no reserve, 1.6× at auction, building the moment it
can — against the M7 baseline, four seats, mirrored to cancel the position effect:

| | wins |
|---|---|
| baseline | 287 |
| aggressive | 289 |

576 finished games. That is a tie, and it is a *result*: the baseline's three
constants were picked by feel in M7, and they are not where the leverage is. What
is: **seat order**. Across 300 four-player games the first two seats took roughly
60% of the wins — worth far more than either policy. A better bot has to be a
different shape, not different numbers, and that is now a measurable claim.

### The balance pass, which was one change

Roundabout ships with `winCondition: 'roundLimit', roundLimit: 80`. Not a feeling:
300 games put its median at 27 rounds and its 90th percentile at 46, so eighty
bounds the tail without touching a typical game. The re-run confirmed exactly
that and nothing else — median unchanged at 112 turns, longest down from 984 to
384, stalemates 2-in-300 to zero.

Classic and Speed Die were deliberately left alone. The classic game is the
reference implementation this engine exists to be able to express; balancing it
away from the printed rules would make it a worse reference, not a better game.

### A note on the build

`npm run simulate` bundles `tools/simulate.ts` with Vite into `dist-sim/` and runs
it with Node. Node cannot run the sources directly — they use `@/` aliases, which
type stripping does not resolve — and adding a TypeScript runner to
`package.json` costs a `verify:install` and has broken CI here once. Ten lines of
Vite config was the cheaper answer.

### Verification

- 408 unit tests (up from 389): the runner plays every shipped game with
  invariants on, a seed replays exactly, a game that will not end is reported
  rather than hung, the two bugs above are pinned, and the report's arithmetic —
  medians rather than means, wins by seat — is tested on synthetic results.
- One pre-existing test was rewritten rather than given a longer timeout: the
  dice-range check called `expect` 140,000 times and started timing out once the
  simulator's tests competed for the same core. It collects the bad rolls and
  asserts once now, which is both quicker and a better failure message.

---

## M9b — authoring a game

The half of M9 that waited for the simulator, because the last of its three items
is documentation about how to tell whether a game you just wrote actually works —
and there was no way to answer that before 8d.

### Composing, and the rule that shapes it

`games/compose.ts` is two ideas. `deriveMap` makes a board like another one, tile
for tile; `withoutCards` takes named cards out of a deck. One rule runs through
both: **a derived board keeps its length and its ids.** Removing a tile would
renumber everything after it and break every card that names a square, so
`deriveMap` replaces rather than removes — "no utilities" is a board where each
utility is something else, not a board that is two tiles shorter. The id is forced
back on afterwards, so a transform that forgets to carry it cannot silently break
the circuit.

`withoutCards` throws on an id the deck does not have. A typo that removes nothing
is worse than one that stops the build, and the whole point of trimming a deck is
knowing what came out.

### The engine made the example finish itself

Writing Pocket — the classic board with the utilities swapped for Community Chest
squares — the first version kept the classic deck. It is refused:

```
[games] "pocket" is not loadable:
  chance card "ch5": looks for the nearest "utility", and this board has none
```

That is `validateGame` earning its place, and it is the best thing that happened
while writing this milestone: the composition helpers cannot be used to make a
board whose own cards cannot resolve. The guide is written around it, and there
is a test that pins the message rather than trusting the prose.

### Artwork, without the repo carrying any

Every texture here is drawn at runtime, which keeps the project free of
third-party art and the licence questions that come with it. `Game.assets` is how
a game brings its own without changing that: **texture key → URL**, keyed on the
names the renderer already asks for. Supplying `house` replaces the drawn house,
and no renderer needed a second lookup path.

Two things had to be true for it to work, and one of them was not:

- The bakers must step aside for a supplied key, or the next theme change paints
  over the game's artwork. That was foreseen.
- **The loader silently skips a key the texture manager already holds** — and
  `BootScene` has baked `house`, `hotel` and all eight pieces by the time
  `GameScene.preload` runs. So the artwork never arrived, and nothing said so:
  the board just kept drawing the default house.

That one was caught by asking the game where each texture came from. A drawn one
is an `HTMLCanvasElement`; one the loader fetched is an `HTMLImageElement`:

```
before: {"house":"HTMLCanvasElement", "hotel":"HTMLCanvasElement", …}
after:  {"house":"HTMLImageElement",  "hotel":"HTMLImageElement",  …}
```

`__forge.textures()` is now on the debug handle and the playtest asserts it, so a
silently-drawn house fails a run instead of being noticed by eye.

### A game could not turn a house rule on

Pocket asks for the Free Parking jackpot. The playtest printed:

```
biggest pot       $0 (jackpot rule off)
```

The menu was sending all three house-rule booleans explicitly on every start, so
`resolveRules(game.rules, houseRules)` let the menu's `false` beat the game's
`true`. The same defaults-versus-choices problem the theme and the variants
already had, on the one field that had not been given the treatment: the switches
now take the game's value unless the player has touched that switch.

The harness had the same bug in miniature — its jackpot assertions were keyed on
the `--house-rules` *flag* rather than on the rules in force, so it would have
mis-reported (and eventually mis-failed) any game that asks for one itself. Both
read `__forge.rules()` now.

### Pocket

It ships as a real game rather than a demo, because a worked example nobody would
play is a worked example nobody reads. The classic board with no utilities, a
deck trimmed to match, forty rounds, the jackpot on, and its own house and hotel
drawn by hand for this repo. Five hundred games:

```
  pocket
    turns          median 183  ·  rounds median 40  ·  unfinished 0
    decided by     22% bankruptcy, 78% the win condition
```

Which is a *timed* game with a real chance of a knockout — and comparing it with
Roundabout is the sharpest thing the guide has to say about round limits:

| | limit | decided by bankruptcy | what the limit is |
|---|---|---|---|
| Roundabout | 80 | 97% | a safety net, firing in 3% of games |
| Pocket | 40 | 22% | the rule of the game |

Same knob, two uses. `decidedByBankruptcy` was added to the batch report to make
the difference visible, because the median alone cannot tell them apart.

### Verification

- 423 unit tests (up from 408). The composition helpers, including that they
  leave their inputs alone; the validation failure the guide claims; the artwork
  keys; and that Pocket is still the only game bringing any — so a second one
  becomes a decision rather than a drift.
- The playtest matrix across all five games, plus the house rules, the speed die
  and the parchment theme. `--game pocket` asserts that two textures arrived from
  the game and that the pot filled.

## M11 — a board that is not a circuit — 2026-08-14

The brief was a test, not a feature: add **Ultimate Monopoly**, a fan-made
synthesis of four Monopoly editions, and find out what this engine assumes. It
was the right board to pick because nobody designed it for this engine — 120
tiles, three tracks, twenty colour groups, and a movement rule no version of
Monopoly in the box has.

### Reading it took longer than expected

The reference was a PDF and a PNG. The PDF's content streams turned out to be
hex strings against subset fonts, so the naive extraction produced a megabyte of
glyph data. Pulling the `/ToUnicode` CMaps out and decoding through them gave
readable prose — through a substitution cipher, because the subset maps several
lowercase letters onto uppercase glyphs. `RuDOs` is "Rules"; `pDTyOL` is
"player". Legible once you see it.

The board came off the PNG in five crops, each rotated so its text was upright.
Worth the care: the tile *order* is the game, and one transposed price would have
been invisible until somebody played it.

### The wall

`Board.move` was `((from + steps) % size + size) % size`, and `layout: rings` has
a comment saying in as many words that a ring is an arrangement rather than a
loop. Orbits looks exactly like this board and is topologically a classic one.

Ultimate Monopoly is three loops joined at four junctions, where a railroad and
the transit station beside it are *one space*, and an even roll that carries you
past one rides it to the next track. The rules give a worked example — States
Avenue plus four ends on Madison Avenue, two tracks away — and that example is
now a test. It was the first thing to pass and it is the whole feature.

The fix was to make the step a strategy, the way `turnOrder` and `winCondition`
already are, and it paid for itself immediately:

- **`move` walks, so it can report where it went.** `{ to, path, passedGo }`.
  That turned out to matter more than the crossing did — the token animation used
  to recompute its own route step by step, which is the same answer only while a
  board is one loop. On this one it would have picked a different way across a
  junction and arrived somewhere the model never went.
- **Distance became a search.** `pathTo` and `scan` are breadth-first now, and
  two hand-rolled forward scans (`CardDeck.nearest`, `SpeedDie.scanForward`)
  deleted themselves.
- **`onPass` fires for every tile underfoot, the landing tile included.** This
  started as a way to make three pay corners work and ended up *simplifying*
  something: `passedGo` was always a special case for "landing exactly on GO
  still pays", and it is now just what "you were on it" means.

One regression, caught by an existing test: the walk loop never runs for
`move(from, 0)`, so a zero-step move stopped normalising `from` and handed back
the out-of-range index the function has sanitised since M1.

### Three smaller walls behind it

**A tile cannot see anybody else.** `onLand(playerId)` is an id. Squeeze Play
collects from every other player; the Auction space picks from the whole board.
Card effects have had a context since 7c, so tiles got the same shape —
`registerTileEffect`, resolved by both drivers through one `applyTileEffect`. The
first run of the finished game died in a stack overflow: the two Holland Tunnels
each send you to the other, for ever. Guarded now, with a comment, because it is
a trap any teleport pair will hit.

**Eight colour groups.** `ColorGroup` was a closed union and `Theme.groups` a
`Record` over it, so twenty groups would not compile. Opening the union is the
easy half; the interesting half is that a theme *cannot* be asked to name groups
it has never heard of. So an unnamed group is now drawn in a colour derived from
its name, in the current theme's own saturation and lightness — stable across
builds, because a colour is how a player learns a group. Ultimate Monopoly ships
a theme naming all twenty anyway, which means the derivation is exercised by
playing it in Parchment.

**One tier of group rent.** The literal `* 2` in `quoteRent` was the last
hardcoded rent in the engine. It is `monopolyRent` and `majorityRent` now, and
the eight-rung utility ladder needed no engine change at all — the game registers
its own tile over the built-in `utility` name, which is what the registry was
always for.

### What it cannot have, and why it is one thing

Six of the printed rules ship reduced, and every one of them for the same reason:
**a game cannot add state to a player.** Travel vouchers, stock certificates,
Roll Three cards, a facing for Reverse Direction — all things you *hold*, and
`Player` has no extension point while `captureGame` would not know to save one.
Each ships as the nearest rule that needs nothing held: a bus ticket is spent at
once, the Stock Exchange pays its dividend and sells no shares.

Two more are the pick-a-tile prompt that stopped the speed die's triples rule in
8b. It has three customers now.

Both are in KNOWNISSUES with the shape of a fix, and neither was worth guessing
at inside this milestone.

### Numbers

200 games, no invariant broken: median 63 rounds, nothing unfinished, 15.8 houses
and 11.2 hotels standing at the end, and wins by seat 53/50/43/54 — the most even
spread of any board here, which is a pleasant surprise on a board where two of
the three tracks are only reachable through four junctions and two tunnels.

### Three rings, then three squares

It shipped drawn on `rings` — concentric circles — because that was the
multi-loop shape the engine had, and it looked fine. It was not what the board
*is*, though, so `squares` joined the layout list: `squareGeometry` again with
the inset, the depth and the count parameterised, which is thirteen tiles a side
on the outer track, nine on the middle and five on the inner, exactly as printed.

The interesting part was `inset` rather than the geometry. A circle's ring takes
an explicit `radius`, so the array order does not decide what is drawn where; a
naive `squares` would have derived each square by insetting from the last, tying
drawing order to tile order. Ultimate Monopoly lists its **middle** track first
because GO has to be tile 0, and its middle track is the one drawn in the middle.
Explicit `inset` keeps the two orders independent, which is the same separation
the layout docstring now states outright: **a shape is not a topology.**

### The last place a 40 was hiding

The browser matrix failed on Ultimate with `Player 1 has an invalid position: 83`.
Both 83 and 71 are perfectly good tiles on a 120-tile board — the harness had
`position <= 39` hardcoded, which is the "never write 40 for the board" rule
broken in the one file nothing type-checks. It survived four milestones because
every board that had ever shipped was 40 tiles or fewer.

Fixed by asking: `__forge.board()` reports the size and the tracks. The same run
then failed on "the jackpot was on and the pot never took a penny", which was
also the harness rather than the game — two tax squares in 120 tiles means eleven
rounds can genuinely pass without anybody meeting one. That assertion now waits
until a tax has actually been charged, which keeps it able to catch the thing it
was written for (Pocket's silently-off house rule in 9b) without failing a board
for being large.

### What was checked

The test that mattered most was not a unit test: a played-out game has to end
with deeds on **all three tracks**. A board whose junctions were never reached
would pass everything else and still be a 40-tile game with 80 tiles of scenery.
`SimResult` gained `tilesOwned` for it.

## M10d — the menus become a tree — 2026-08-14

The flat menu had run out of room. Six games, five player counts, six seat rows
and four switches on one screen, with the house-rule chips already shrinking to
fit as more variants registered — a seventh game or a second variant would have
been the thing that broke it.

Both menus are a tree now, and the useful part is that there is only one of them:
`ui/Menu.ts` is a stack of screens of labelled rows, and the title screen and the
pause screen are the same component with different roots. Written as two scenes
they would have drifted before the milestone was out.

A screen is **data, rebuilt on every render**, which sounded like an
implementation detail and turned out to be the design. A row's label, value and
enabled-ness are functions, so "Save — a token is still moving" is a row that
answers for itself rather than a scene remembering to grey something out. That is
what made moving Save into the pause menu worth doing at all: `saveBlockedBecause()`
returns a *sentence*, and the row prints it, where the old SAVE button could only
be pressed and then apologise with a toast.

### The settings screen writes itself

`GameRules` has been a flat bag of numbers and switches since 8b, which is
exactly the shape a settings screen wants and says nothing about how to present
one. `RULE_FIELDS` beside the rules supplies the missing half — label, type,
range, section — and the screens are generated from it. Twenty rules, in seven
sections, and adding a rule to the engine costs one line here and no scene edit.

Two exclusions are deliberate and both are interesting. **`movement`** is not a
preference: setting a tracks board to `circuit` makes Ultimate Monopoly a
120-tile single loop, which `validateGame` refuses outright — so the control
would have offered a choice that silently drops you back to Classic. And
anything array-shaped stays out until it has a control worth using.

### A bug class deleted rather than fixed

The menu used to keep a whole `HouseRules` object plus three flags —
`themeChosen`, `variantsChosen`, `houseRulesChosen` — because a game's defaults
must not beat a player's choice and a player's choice must not beat a game they
have not picked yet. The third was added in M9b, after Pocket could not turn its
own Free Parking jackpot on for an entire milestone.

It keeps `Partial<GameRules>` of only what somebody actually changed. Layering is
then `rulesFor(game, overrides)`, which is what the engine does anyway; an
untouched rule follows whichever game is picked, a touched one survives changing
game, and there is no third flag to forget. The menu got smaller.

### Two traps, one old and one new

`PauseScene` would not compile: "type `this` is not assignable to parameter of
type `Scene`". That is the same misleading error `GameScene` hit with `renderer`
in M8c — `Phaser.Scene` already has a `data` property, its `DataManager`, and a
scene field of that name shadows it. Renamed to `paused`. CLAUDE.md now lists
both rather than the one.

And the first draft laid rows out on a fixed pitch, which put every hint
underneath the *next* row's background. Rows are not a fixed pitch: `y`
accumulates, and a row with a note is taller.

### The harness stopped clicking coordinates

`HOTSPOTS` held five menu positions — the player-count buttons, three seat
toggles, START — every one of them invalidated by a tree of screens. The answer
was the one already used twice: `__menu.spots()` reports each row's id, label,
current value and where its ‹ › buttons are, and the harness presses rows **by
name**, failing loudly when one is missing or disabled.

It bought something beyond not breaking. The run now walks into Game Settings,
nudges the jail fine, starts the game and asserts `__forge.rules().jailFine` is
what the menu said — which is precisely the check that would have caught the M9b
house-rule bug the day it was written, rather than a milestone later.

## M10a — the four corners, and the piece that was not on the list — 2026-08-14

Four places the implementation knowingly departed from the printed rules, each
one a KNOWNISSUES entry with its reason. Two of them turned out to need the same
missing thing, and that thing was not in 10a or 10b — it was M12a, planned on the
strength of Ultimate Monopoly needing it twice. 10a needed it twice more, so it
came forward.

### A question a bot can answer

`game/Choice.ts`: options with weights, a callback for the answer, and both
drivers obliged to supply one. `GameScene` draws a list, or — when the options
*are* tiles and there are 120 of them — highlights the board and takes a click,
because clicking through 120 rows is not a prompt. `sim/Runner` takes the
heaviest option immediately.

It cost me a batch to learn that both halves of a driver's obligation matter. The
first simulator run after triples landed reported **69 of 80 Speed Die games
unfinished**, and Ultimate 76 of 80 — up from 10 and 0. The runner answered
`choice:ask` perfectly well and had no handler for the `roll:chosen` that the
answer replied with, so every triple parked its turn for ever. Answering a
question is not the same as doing what the answer says.

### What a roll means

The open question KNOWNISSUES recorded — a fifth registered strategy, or the
`ROLLING` phase handler taking the roll over — is answered the first way.
`rules.rollRule` names a rule that returns *what should happen*: `move`, `jail`,
or `handled` when it has a prompt in flight. `TurnManager` does it. A rule that
moved the player itself would be a second mover, and the phase pipeline would
have two things deciding when a turn ends.

That left one gap I had not seen: a variant could *register* a roll rule and had
no way to **select** it, so the speed die would have shipped a triples rule
nobody used. `Variant.rules` fixes it — rule values a variant implies, layered
under the game's and the player's, so a variant brings a default and never
overrules a choice. `rulesFor` settles which variants are on first, then layers.

### Mortgage interest, and why it never looked wrong

A mortgaged deed changed hands mortgaged through three paths — trade, auction,
bankrupt estate — and the new owner inherited the debt for nothing. All three
agreed with each other, which is exactly why nobody noticed; none agreed with the
rules.

`chargeMortgageInterest` is written once and called from all three, and it goes
through `settleDebt` rather than `player.pay` — so a creditor who cannot cover
the interest on an estate they have just inherited mortgages that estate, and can
go under doing it. Charged *after* the deeds have moved, deliberately: a player
raising the money must not be able to sell something the transfer is still in the
middle of handing over.

The rate became `rules.mortgageInterest` and now governs the *lift* charge too,
which had been a literal `1.1` in two places. One number, both halves, and a game
that sets it to zero turns the rule off entirely.

An existing test caught the change immediately — a creditor's cash was $1,564
where the test said $1,570. That is the new rule, and the assertion now says so
in as many words rather than being loosened.

### Two smaller ones

The auction got a stepper beside its three quick buttons, clamped to the minimum
and to what the bidder holds so a nudge cannot make an illegal bid. And the
contested-house winner is asked where the house goes, when there is more than one
legal lot and they are not the player who nominated it — a bot takes the lot
where a house earns most, which is a better answer than the cheapest-first
ordering it replaced. That was never a strategy, just an order.

## M10b — getting things out — 2026-08-14

Two of the five, and the two that were cheap now that the pause menu exists.

**The turn log comes out.** It has kept the whole game since M8c with no way to
read one afterwards. Pause → Turn log copies it or saves it as a file — two
routes because neither works everywhere, and each row reports what actually
happened rather than failing quietly. The clipboard is what somebody wants nine
times in ten and browsers refuse it outside a secure context.

**`noAuction` is finally tested.** It had gone four milestones untested because
switching it on removes the auction step the ordinary run depends on. The answer
was not to skip the assertion but to **invert** it: `--no-auction` must decline
at least one property and hold no auction at all. A run that quietly checks
nothing is how a rule goes untested for four milestones.

Three items are left and all three are the same size — real work rather than
oversights: a save mid-turn, a bot that offers *you* a trade, and a theme that
changes without restarting. Each is written up in the ROADMAP with what it needs.

## M10b — a save taken mid-turn — 2026-08-14

Saving was refused any time a turn was in progress, and the reason was never the
save. `captureGame` wrote everything it needed to; `restoreGame` then called
`startTurn()` whatever had been saved, so the middle of a turn was thrown away on
the way back in. The guard existed to stop you noticing.

So the snapshot gained three fields — `turn.phase`, `turn.held`,
`turn.pendingLanding` — and version 8. Saving while a token walks and while the
buy prompt is open both work now, and between them that is where a game spends
most of its waiting.

### Picking a turn up without replaying it

The trap I expected and wrote the test for first: **a restore must not
`enterPhase` the phase it saved.** A phase's `onEnter` is what *happens* when you
arrive, so arriving a second time would run a variant's extra move again — the
speed die's bonus walk twice over, from a save taken while the first one was on
screen. `restorePhase` sets the phase and holds the flag; what to do next is the
driver's.

And there are only three answers, which surprised me — I had expected one per
phase:

- **a landing is owed** — a token was walking. The model is already at the
  destination and any salary already paid, so the walk is never replayed: the
  tokens snap to where the model says and the landing resolves.
- **an answer is owed** — the buy prompt was open. The tile is wherever the
  player is standing, so it can simply be asked again.
- **nothing is owed** — offer the dice.

`pendingLanding` is the one field the model cannot supply: only the scene knows a
tween is in flight, so `captureGame` takes it as a parameter.

### The phase that had been lying since 8b

The harness caught this, and it is the better find of the two. A mid-walk restore
came back reporting `LANDING` with a buy prompt open — correct behaviour, wrong
label. `AWAITING_BUY_DECISION` had been in the phase list since 8b and **nothing
ever entered it**: a turn waiting on the buy prompt reported the phase it had
already left.

That mattered here rather than staying cosmetic, because `resumeSavedTurn`
branches on the phase — the "re-offer the prompt" branch would have been dead
code, and a save taken with a prompt open would have come back offering the dice
instead, letting the player roll twice. Both drivers call `offerBuy()` now. A
`driven` phase still needs *something* to drive it, or it is documentation
pretending to be state.

### Where the line is now

The remaining refusals are worth a sentence because it is the sentence that makes
them principled rather than arbitrary: **you may save whenever the game is making
you wait, and not in the middle of your own half-finished input.** A walk is the
game making you wait. A half-built trade, an unanswered question and a live
auction are not.

Of those three, the auction is the one that is only *work* rather than a
different kind of problem — it is plain data, and what makes it more than an
afternoon is `auctionEndsTurn`, the queue a bankruptcy fills and the
house-contention claims, which is the most delicate machinery in the turn and has
a documented bug behind it. It is scheduled with that reasoning. Pausing already
stops the clock, because the clock is a `scene.time` event on a scene that
pauses, so the refusal costs a player nothing but the save.

A question in flight is different in kind and will stay refused until somebody
wants it: a `ChoiceRequest` carries an `answer` **callback**, and a closure does
not go into localStorage. Saving one means the *asker* being able to ask again
from saved state, which is per-asker work rather than one mechanism.

## M10b — saving during an auction — 2026-08-14

The last of the three refusals that was only *work* rather than a different kind
of problem. An auction has been plain model state since 8b — what is under the
hammer, who is still in, whose turn it is, what the standing bid is — and the
comment at the top of `Auction.ts` had already said the thing that made this
easy: **no timer lives here.** The clock is a `scene.time` event the panel owns.
So a restored auction comes back with everything that is a rule and starts its
countdown again, and that is the entire cost.

`capture()` and `restore()` on the class, snapshot version 9.

### Three things around it, each with its own answer

**The queue.** A bankruptcy fills it with a whole estate to be sold deed by deed,
and a save taken during the first of those has to bring the rest with it.

**`auctionEndsTurn`.** Only the auction a *declined property* started ends the
turn; an estate sale and a contested house happen in the middle of somebody's
turn and must leave it alone. That flag is the difference between the two, and a
restore without it would end a turn it had no business ending — the bug that
comment exists because of.

**The house-contention claims are recomputed, not saved.** `houseClaims` derives
them from the board and the bank, and both of those come back in the snapshot, so
storing a copy would be storing an answer that could disagree with the board it
came from. Only *which* lot was asked for and by whom is saved, because those are
choices rather than derivations.

One more that is easy to get wrong and would fail quietly: the bidders are looked
up in the **restored** table. An auction holding copies of the players would
settle against cash nobody has, and the board would end up with a deed paid for
out of an account that never moved.

### What the harness does now

Three save-and-reload scenarios in a real browser, and each proves something
different: mid-walk (a landing is owed on the far side), mid-auction (the same
subject, bidders and standing bid come back, and it can be *finished*), and the
original quiescent save (byte-identical state). The mid-auction one declines a
property to open an auction, puts a bid on the table so there is something to
compare, and then checks the restored auction can be passed out rather than
merely being on screen.

### Where the line is now

Two refusals left, and they are no longer the same kind of thing:

- **A half-built trade.** Serialisable; re-opening the panel on the far side is
  the work, and it is the one thing here a player rebuilds in seconds.
- **A question in flight.** Different in kind: a `ChoiceRequest` carries an
  `answer` **callback**, and a closure does not go into localStorage. Saving one
  means the *asker* being able to ask again from saved state — per-asker work
  rather than one mechanism.

The rule the guard follows is unchanged and still reads true: you may save
whenever the game is making you wait, and not in the middle of your own
half-finished input. An auction turned out to be the former — you are waiting on
a clock and on three other people — which is why it moved.

## M10b — a bot that offers you a trade — 2026-08-14

`proposeTrade` has been finding good swaps since M7 and bots have been making
them to each other ever since. What they would not do is put one in front of a
person, and the comment on `botTrade` said exactly why: *an unsolicited modal on
a person's turn is a different question from whether the trade is a good one, and
this answers only the second.*

So this milestone answered the first, and it turned out to be almost entirely
about manners rather than plumbing. The panel needed nothing: `review` mode is
the same screen a person builds an offer in, arriving from the other direction,
so accept, decline and counter all already worked.

### How often is too often

`mayInterrupt` is a pure function in `Bot.ts` — a bot may ask, then not again for
`botTradeCooldown` rounds. It is there rather than in the scene because "how
often may a bot interrupt somebody" is a decision about the game, not about the
panel that shows it, and because a pure function is a thing that can be tested
without a browser.

Two rule values go with it and both are on the generated settings screen, which
cost one line each now that the screen is built from metadata: `botOffersTrades`
for people who never want to be asked, and `botTradeCooldown` for people who want
to be asked less. A year ago that would have been a scene edit.

### The bit that would have been a bug

**The bot's turn stops until the offer is answered.** `botRollWhenClear` waits on
a pending offer exactly as it waits on an auction. Without that the bot would ask
a question and then roll straight past it — a modal that appears, gets ignored by
the game, and is answered into a turn that has already moved on. The harness
asserts it directly: after the offer opens it waits two and a half seconds and
checks whose turn it still is.

### Arranging the position, never the answer

A bot only finds a swap on a board where two players hold each other's key, and a
played game reaches one rarely and late — so this needed a third write-hook on
the debug handle, after `forceHouseShortage` and `forceBankruptcy`.

`forceMutualKeys` rigs the *board*: each of a bot and a person ends up one deed
short of a monopoly, holding the deed the other is short of. Then the real
`proposeTrade` finds the trade, the real manners check lets it through, and the
real panel shows it. That is the shape a write-hook has to have — arrange the
position, never the answer — and it is now written down in CLAUDE.md, because
the temptation with this one was to inject an offer and call it tested.

`npm run playtest -- --bot-trades` runs a table of one person and two bots, plays
the person's turns until a bot asks, checks the bot waits, accepts, and then
checks the deed moved and the game went on.

## M10b — a theme that changes mid-game — 2026-08-14

The last item in 10b, and the one whose description was already the design: *the
HUD, the buttons and the board's static layer are drawn once at `create()`, and
the pieces are baked textures.* Four things drawn once. The work was making each
of them drawable twice.

I considered the cheap route first — capture a snapshot, `setTheme`, restart the
scene, restore. It would have worked and reused everything M10b had just built,
and I did not do it for one reason: the turn log is not in the snapshot, so
changing colour would have thrown away the record of the game. A hammer that
loses the log to repaint a border is the wrong tool.

### One list, not an event

`applyThemeLive` is a numbered list of everything that has to be drawn again. The
tempting shape is a `theme:change` event each component subscribes to, and I
avoided it deliberately: a component that forgot to subscribe would simply keep
its old colours, and a *half*-repainted screen is the failure hardest to notice
and the easiest to ship. A list is greppable and wrong in an obvious way.

Order matters in exactly one place, and it is worth stating: the textures are
re-baked **first**, because the board's `refresh` draws houses out of them and
every token holds one by key.

### Three things that would have been bugs

**Re-texture the piece; never rebuild the token.** A token is a container, and a
walk in progress is a tween targeting it. Destroying one would leave the promise
`moveTokenStepByStep` awaits unresolved — the turn would park for ever, and only
if you changed theme at the wrong moment.

**A panel has to be told its colours moved.** `PropertyPanel` and `TradePanel`
have skipped rendering an unchanged view model since M6, and a palette change
moves no view model at all — so both would have sat there in the old colours,
looking exactly like a bug in the theme rather than in the guard. `invalidate()`
is the fix and it is one line each.

**The HUD restyles rather than restarting.** `scene.restart()` was my first
instinct and it is wrong twice: it blanks the dice and the banner, and the
obvious repair — `delayedCall` to push the state back — cannot fire, because
`GameScene`'s clock is *paused* the whole time the pause menu is open. `UIScene`
now remembers what it is showing so `build()` can put it back.

`BoardRenderer` keeps everything its static layer drew, click zones included. A
zone that survived a redraw would sit underneath the new one and fire the tile
handler twice — silent, and only on a board somebody had re-themed.

### Proving a colour changed

There is nothing in the model to assert on: a palette is not game state, which is
the whole point of it not being in the snapshot. So the harness proves it in
pixels — screenshot the canvas, change the theme, screenshot again, and fail if
the two buffers are identical. Then it rolls the dice, because a redraw that
destroyed the click zones or left the roll button dead would pass every other
check in the file.

## M10c — measuring a bot instead of tuning one — 2026-08-15

Two items. **One worked and it was not the one I expected**, which is the whole
argument for this milestone existing as a measurement rather than an opinion.

### The rig first

A policy match is meaningless unmirrored — 8d put seat order at 60/40 to the
first two seats of four, and it is worse than that heads-up — so `--mirror` plays
every rotation on the same seeds and tallies by policy *name*. And before
believing a single number out of it I added `control`: the baseline under a
second name. Two identical policies came out **300/300, spread 0**. That is what
makes everything below quotable.

### The one that did not work

`game/BoardOdds.ts` runs a Markov chain over the real board — the real
`Board.move`, so it is correct on a circle, a spiral and three loops as well as
on the square — and values a deed by what it will *collect* rather than what it
costs. It reproduces the two famous facts about Monopoly without being told
either: Jail is the busiest square, and the oranges are the best group. Both fall
out of Go To Jail sitting six to eight squares away.

Then I priced four decisions off it, and it lost **57/43 over 800 mirrored
games**.

Taking it apart was the useful part:

- **The first version valued a lot at its three-house rent**, which made every
  payback come out under a single lap. The bot bought down to zero cash and bid
  its whole stack at auction. It was valuing houses nobody had paid for. Pricing
  the *deed's* own earning power took it to 43%.
- **Buying by payback is worse than buying for denial** — worth about four points
  on its own. A deed declined goes to auction, and with two players the only
  other bidder is your opponent. An income model cannot see that.
- **Ranking lots by yield is worse than finishing the cheapest group.** Cheapest-
  first was never really about cheapness: it *concentrates*, and a finished group
  is what wins. Moving the odds up to group level recovered most of the gap.
- **The auction ceiling has almost no leverage**, because with two players almost
  nothing is declined. Capping it changed the result by literally zero games.

Final score: 48/52, inside the noise. **It is not better.** It ships as
`--policies odds` with all four findings written where they were made, because a
measured negative that says *why* is worth more than a deleted branch.

### The one that did

The other item named its own number: *"about 5% of Classic games never form a
monopoly at all and run for ever — the stalemate rate is the number that says
whether it did."*

The cause was one line. `acceptTrade` refused to hand over a deed that completes
somebody else's group **at any price**, so the only deed worth asking for was the
only deed nobody would ever sell. Four players sat on four part-groups until the
turn cap.

`keyPremium` makes it a price rather than a veto: two and a half times what the
deed is worth to us. With `buyKeyForCash` to propose it:

| | baseline | with key trading |
|---|---|---|
| classic games with no monopoly | **22 / 400** | **0 / 400** |
| median rounds | 58 | 53 |
| houses standing at the end | 6.2 | 9.7 |
| trades per game | 6 | 10 |

And it costs nothing head to head — 397/403 over 800 mirrored games — so it went
into `DEFAULT_PROFILE` rather than behind a flag. **Every game that ships now
finishes every batch**, classic and speed included, where both used to leave a
handful running to the cap.

I checked the attribution rather than assuming it: the baseline valuation *plus*
`keyPremium` alone gives 0 of 400 too. The odds model contributes nothing to it.

What has not changed is the fact underneath. Monopoly still need not terminate —
a table that refuses to trade still cannot end — so "every game reaches a winner"
is still not an invariant, and the batch still reports unfinished games rather
than failing on them.

### One harness bug, and it is the interesting kind

The default playtest failed after all this with `menu row "theme" is not on
screen`. `__menu` is published by whichever menu is open and **was never taken
down** when the pause menu closed, so the harness read where the rows *used to
be* and clicked the board believing it was pressing a button. It did not fail —
it silently did the wrong thing, which is the failure a debug handle should never
have. `PauseScene` deletes the handle on the way out now.

## M12a — the last two reductions — 2026-08-15

Mostly an audit. 12a was planned before 10a needed the same thing twice, so three
of its four items were already done by the time it came round; the honest work was
checking rather than assuming, and then finishing the one item that was genuinely
outstanding.

What the audit found:

- **`ChoiceRequest`** — done. **`CHOICE_POLICIES`** — deliberately *not* done, and
  the plan was wrong rather than unfinished. A registry of ranking policies would
  have to know what each choice means; every asker already says that by what it
  puts in an option's `weight`. Ticked with the reasoning rather than built.
- **Both driver paths** — done, and the harder half was the *answer* having
  somewhere to go, which cost a batch of 69 hung games to learn.
- **Saving refused while a choice is open** — done.
- **The four reductions** — two of four. Triples and the contested-house lot went
  through `askChoice` in 10a; **Subway and the Auction square were still deciding
  for everybody.**

### The shape every one of these rewrites has

The old deterministic answer was never wrong as a *bot's* answer — only as a
person's. So it becomes the `weight`: the Subway ranks squares by whether there
is an unowned deed to buy there, the Auction square ranks by price. A bot picks
the heaviest and plays exactly as it did; a person gets a board with the legal
squares ringed and clicks one.

That is worth stating because it is what makes these rewrites cheap and safe. No
simulator number moved — Ultimate is still 0 unfinished in 120 games, median 76
rounds — which is the point rather than a disappointment.

### And an accuracy bug underneath one of them

The Auction square emitted `property:auction`. That event is the *declined
property* path: it offers the deed to a player and only auctions it if they say
no. So landing on Auction gave you first refusal on the property you had just
nominated — close to the opposite of "pick an unowned property for the Banker to
auction off".

`auction:open` goes straight under the hammer, handled by both drivers, and the
test that pins it asserts `property:auction` is *not* emitted — which is the only
way to catch a bug whose symptom is a prompt appearing that should not.

### Three bugs the matrix found afterwards, none of them in 12a

Adding two prompts to a human-playable game made `--game ultimate --turns 40`
fail, and unpicking it turned up three separate things — two of them mine from
M10b, sitting there passing every test I had written.

**`this.chrome` was cleared and never filled.** So a palette change ran
`buildButtons` and stacked a second, identical row of buttons on the first:
superimposed, invisible in a screenshot, each old one still interactive at full
alpha — and `setRollEnabled` reaching only the new. It also registered a second
Escape handler every time.

**And rebuilding was the wrong idea anyway.** It happens *while the scene is
paused*, because the pause menu is what changes the theme — so the fresh buttons
called `setInteractive` on an input plugin that was not processing. That is the
same trap CLAUDE.md already records from the disable-vs-remove direction, reached
from a new one. The buttons are restyled in place now, colours only; the hover
handlers already read `theme()` when they fire, so they needed nothing.

**The buy prompt was not on the restyle list at all.** Its background is made
once and its contents are only rebuilt by the *next* offer, so one already open
kept the old palette entirely.

The third was the harness, and it is the one worth remembering. `settlePrompts`
checked "is anything open?" at an instant — and a walk goes idle a moment
*before* its landing draws a card. So nothing was open, the card appeared, and it
swallowed the click meant for the MENU button. Settling polls for the end state
now — the dice back on offer — which is the same lesson as the headless clock,
arrived at sideways. The harness also gained `__forge.choice()`, because the two
prompts 12a added are answered by clicking a board tile and nothing else on that
handle said which tiles would be accepted.
