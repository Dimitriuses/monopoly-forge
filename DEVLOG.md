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

The game supports 2–6 players, all standard Monopoly rules, a full card system,
buy/auction prompts, jail logic, and a dev-mode player switcher for testing.

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
| M3 — Ownership (houses/hotels, mortgage, color-group enforcement) | 🔲 Pending |
| M4 — Cards & Jail (all edge cases) | 🔲 Pending |
| M5 — Multiplayer UI (trade dialog, auction system) | 🔲 Pending |
| M6 — Polish (animations, sound, save/load, house rules) | 🔲 Pending |
| M7 — QA (AI opponent, edge-case testing, balance) | 🔲 Pending |
