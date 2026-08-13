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
| **M8 — Engine** (configurable maps, rules, presentation, simulation) | 🟡 The destination — see [ROADMAP.md](ROADMAP.md). **8a complete**: a map is a file, and three ship (square, circle, three rings). **8b: registries, the rule set and the turn pipeline done**; the speed die,
an auction over an arbitrary subject and scarce-house contention outstanding. 8c: `BoardRenderer` extracted and shape-agnostic. 8d: not started |

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
