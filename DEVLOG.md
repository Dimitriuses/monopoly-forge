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
`ui/BoardRenderer.ts` and `ui/PropertyPanel.ts`, and no longer has switcher
buttons in `PlayerPanel` — is in [README.md](README.md#layout).*

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
| M5 — Multiplayer UI (trade dialog, auction system) | 🔲 Not started |
| M6 — Polish (animations, sound, save/load, house rules) | 🔲 Not started — save/load blocked, see ROADMAP |
| M7 — QA (AI opponent, edge-case testing, balance) | 🟡 154 unit tests + a headless playtest in CI; no AI |
| **M8 — Engine** (configurable maps, rules and presentation) | 🟡 The destination — see [ROADMAP.md](ROADMAP.md). 8a: board length and anchors done, shape still a square. 8c: `BoardRenderer` extracted. 8b: not started |

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
