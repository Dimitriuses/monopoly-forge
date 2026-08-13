# CLAUDE.md

Working notes for this repo — the commands, the invariants, and the traps that
have already cost time. Read [KNOWNISSUES.md](KNOWNISSUES.md) before concluding
that something is broken; several oddities here are known and deliberate.

## Commands

```bash
npm install
npm run dev          # Vite dev server, port 3000, debug logging on
npm run build        # tsc --noEmit && vite build → dist/
npm run typecheck    # tsc --noEmit
npm test             # Vitest, model only, plain Node (~8 s)
npm run test:watch
npm run playtest     # needs a build first — drives dist/ in headless Chromium
npm run screenshots  # playtest + writes screenshots/*.png
npm run verify:install  # would CI's npm accept package-lock.json?
```

`npm run playtest` accepts `--turns N`, `--seed N`, `--headed` (watch it play),
`--url <url>` (drive a deployed site instead of `dist/`), `--map <id>`,
`--variants <a,b>`, `--house-rules` and `--theme <id>`. The last four go through
the URL (`?map=`, `?variants=`, `?houseRules=`, `?theme=`) because the switches
are canvas text with no DOM for a harness to click.

## Invariants

These are not style preferences. The project's destination is M8 — an engine for
Monopoly-style games with configurable maps, rules and presentation
([ROADMAP.md](ROADMAP.md)) — and invariants 1 and 2 are what keep that reachable:
a rules core that runs headlessly, and a renderer that can be replaced without
touching the rules. Breaking either forecloses the engine.

**1. The model must not import Phaser.** Everything under `game/`, `tiles/`,
`cards/` and `utils/` runs in plain Node — that is what makes it unit-testable
with no jsdom and no canvas. `src/config.ts` is the load-bearing part: it is
imported by the whole model, so the `Phaser.Game` options deliberately live in
`main.ts` instead. Adding `import Phaser from 'phaser'` to `config.ts` breaks the
entire test suite with `window is not defined`.

**2. A model class never imports a scene.** State changes are announced on the
typed `EventBus` singleton and scenes subscribe. This is what keeps the rules
testable and the renderer replaceable.

**3. Random numbers come from `rng`, never `Math.random`.** Dice and both deck
shuffles draw from the shared seeded Mulberry32 in `src/utils/PRNG.ts`. A stray
`Math.random` silently destroys reproducibility — and the playtest harness, which
relies on a seed producing the same game every run.

**6. Never write `40` or `10` for the board, and never assume it is a square.**
Length comes from `board.size` (or `board.move` / `board.stepsBetween`, which wrap
for you); jail and GO come from `board.anchor('jail')` / `board.anchor('start')`;
how many lots a colour group holds comes from `board.groupTiles(group).length`.
`Board` takes a `GameMap`, and the game ships a circle and a three-ring board as
well as the square — run `npm run playtest -- --bots --map round` before believing
a board change is safe.

**6b. Tiles are drawn in their own frame.** Every tile is a rectangle whose local
top edge faces the middle of the board, positioned at `layout.x/y` and turned by
`layout.rotation`. Anything drawn on a tile — a stripe, a house, an owner band, a
click zone — must be placed in that frame (`translateCanvas`/`rotateCanvas` for
graphics, `toWorld` for game objects) rather than as an axis-aligned rectangle,
or it will be right on the classic board and wrong on every other one.

**7e. A variant is a bundle, and the auction sells a subject.** A rule that is
neither a number nor a strategy — different dice *and* an extra step in the turn —
is a `registerVariant` in `game/Variants.ts`, named by string in `rules.variants`
so it survives the save file. The speed die is the one that ships, and the test
of any change to `TurnFlow` is whether `SpeedDie.ts` still needs nothing from
`TurnManager`. `Auction` sells an `AuctionSubject` (`kind`, `id`, `label`), not a
tile: `kind: 'tile'` is a deed, `kind: 'house'` is one the bank is short of, and a
new kind needs a branch in exactly two places — `GameScene.awardAuction` and the
bot's bid. Anything that runs an auction must give the bot a way to price the
subject, or it will sit there being asked forever.

**7. The bank does not know the rules.** `Bank` moves cash and inventory and asks
no questions, because it has no view of the board — `bank.buyHouse` will happily
put a house on a lot whose colour group you do not own. Legality lives in
`game/BuildRules.ts`, and every path that builds, sells or mortgages must check
there first. The checks return a *reason*, which is what the property panel shows
when a button is dead.

**7b. Rule *values* come from `board.rules`, never from a constant.** Starting
cash, the GO salary, the jail fine and term, the doubles-to-jail count, the house
supply and how many houses a hotel is worth are all in `game/Rules.ts`, resolved
as classic → the map's → the player's switches. Writing `50` for the jail fine or
`>= 3` for doubles puts the classic board back into the engine. The rule set is
saved with the game, so anything added to it belongs in the snapshot too.

**7c. Tile types and card effects are registries, not switches.** A new tile kind
is `registerTileType(name, factory)` in `tiles/registry.ts`; a new card effect is
`registerCardEffect(name, handler)` in `cards/effects.ts`. Neither `Board` nor
`CardEffects` should ever grow a `switch` over kinds again — that is what closed
the set in the first place. A card effect gets a small context, not the
`CardEffects` instance: keep what an effect may touch visible in one place.

**7d. A turn is a list of phases, and `TurnManager` does not decide who plays
next.** `game/TurnFlow.ts` holds the phase list, the turn order and the win
condition; `TurnManager.enterPhase` is the *only* place `phase` is written, which
is what makes a phase a rule set added indistinguishable from a built-in one.
Never assign `this.phase = '…'` again, never write the seat arithmetic inline, and
never test for the end of the game by counting solvent players outside a
registered win condition. The two strategies are named by string in `board.rules`
(`turnOrder`, `winCondition`) rather than passed as functions, because the rule
set is saved with the game — a function does not survive `JSON.stringify`, and
`validateSnapshot` refuses a save naming one this build has not registered.
The six built-in phases are marked `driven`: something outside the model enters
them (the roll button, the move tween, the buy prompt), so `endTurn`'s walk skips
them. A phase a rule set adds is *not* driven, so the walk runs it — and may
`hold()` it, to be picked up by `resume()`. **`GameScene.safeEndTurn` resumes a
held turn rather than ending it** — the landing that finishes a variant's extra
move is asking for the rest of the turn, not a second `endTurn` the re-entry guard
would swallow. A phase that holds must also *consume* whatever made it hold: the
walk it starts comes back through it, and the speed die's bonus move would
otherwise send the player round the board for ever.

**8. A tile does not price itself.** `PropertyTile.currentRent` is the tier table
and nothing more. What is actually charged — doubled for an unimproved colour
group, scaled by how many railroads the owner holds, ten times the dice when a
card sent the player there — comes from `quoteRent` in `game/Rent.ts`. Resolve
rent there, not in a scene handler, so it stays testable in Node.

**9. Nobody pays a debt with `player.pay`.** `pay` clamps at zero, so using it
directly makes a debt the player cannot cover silently disappear. Every charge —
rent, tax, a card, anything added later — goes through `settleDebt` in
`game/Estate.ts`, which sells buildings, mortgages deeds and, failing that,
declares bankruptcy and moves the estate. Follow it with `announceSettlement` so
the fire sale and the bankruptcy are reported the same way everywhere.

**4b. `utils/` must run in Node; anything touching `window` goes in `ui/`.**
That is why the Web Audio sound lives in `ui/Sfx.ts` and not in `utils/`, despite
being a utility — a `window.AudioContext` reference at module scope would break
every test that transitively imports it.

**4. Use `dlog` / `dwarn`, not `console.log`.** `src/utils/log.ts` is silent
unless switched on (dev server, or `?debug=1` on any build). `console.error` is
deliberately *not* routed through it — real faults should always surface.

**5. `GameScene` ends turns through `safeEndTurn`, never `turnManager.endTurn()`
directly.** See the turn-end section below.

## Things that will bite

### Turn ending is guarded in two places, and both are needed

- `TurnManager._turnEndedThisRound` blocks an `endTurn()` re-entered *while*
  `endTurn` is on the stack.
- `GameScene.turnGen` blocks a *stale* `endTurn` from a `delayedCall` scheduled
  during a previous turn.

The flag cannot do the second job: `endTurn()` calls `startTurn()`, which clears
it. That was the "events get slower every turn" bug — a leftover timer ended the
*next* player's turn early, compounding each round. `tests/turns.test.ts` pins
both behaviours, including one test that asserts the flag's inability to block a
stale call, so the generation counter cannot be deleted as redundant.

### A jailed player's turn must not end synchronously

`TurnManager.handleJailRoll` emits `jail:stay` instead of calling `endTurn()`.
Ending the turn inside the roll button's own `pointerdown` callback runs
`endTurn → advancePlayer → startTurn → setRollEnabled(true) → setInteractive()`,
re-registering the button with Phaser's input plugin mid-event — after which the
next player's roll button is silently dead. `GameScene` defers with
`safeEndTurn(100)` to get out of the pointer-event frame.

### A card's rent rate has to survive the walk to the tile

"Advance to the nearest railroad" charges double, and the tile it sends you to has
no idea how you arrived. `CardEffects` emits `rent:modifier` *before* `player:move`;
`GameScene` holds it in `arrivalRent` through the animation, hands it to
`quoteRent` at the landing, and clears it. It is also cleared at `turn:start`, so a
card whose tile turns out to be unowned cannot overcharge somebody next turn.

The GO salary fires *during* that walk (`onPass` → `rent:pay` with `reason: 'go'`),
so that branch must return before anything consumes `arrivalRent`.

### Cards that move the player must not also end the turn

In the `card:draw` handler, actions in `selfTerminating`
(`advanceTo`, `advanceToNearest`, `advanceToGo`, `goBack`, `goToJail`) resolve
their own turn end via
the movement animation → `resolveLanding()` → `onLand()`, or via `jail:enter`.
Calling `safeEndTurn` for them as well races the animation (N tiles × 110 ms) and
lands `onLand` on the *next* player.

### Return a drawn card to the discard immediately

`deck.returnCard(card)` is called right after `drawCard()`, before `CardScene` is
launched — not from the scene's shutdown callback. If the scene never shuts down
(e.g. `scene.launch` is a no-op because it is already running), a deferred return
loses the card permanently and both decks eventually drain to nothing.

Also `scene.stop('CardScene')` before each `scene.launch`, or `once('shutdown')`
callbacks accumulate and fire together, executing several card effects at once.

### Positions are sanitised in three places, on purpose

`Board.move` uses `((f + s) % 40 + 40) % 40` because JS `%` preserves sign, and
`tiles[-1]` is `undefined`. `Board.getTile`/`getLayout` throw on non-finite input
instead of returning `undefined`, and `TurnManager` resets an out-of-range
`player.position` to 0 rather than propagating it. A corrupted position used to
cascade into every subsequent roll.

### Anything new that is game state has to go in the snapshot

`game/Snapshot.ts` is the save file. Adding a field to a model class that a game
depends on — a counter, a flag, a pile — means adding it to `captureGame` and
`restoreGame`, or a resumed game quietly comes back wrong. Three traps already
paid for:

- **Save the PRNG's *position*, not the seed.** `rng.getSeed()` returns where the
  stream is now; that is the value to persist, and restoring it is what makes a
  resumed game roll what the saved one would have.
- **Rebuilding must not draw from the PRNG.** `CardDeck.restore` passes
  `shuffle: false` for exactly this reason — the shuffle in the normal
  constructor moved the stream on and left the restored game adrift.
- **Cards are shared objects.** A held Get Out of Jail Free card is stored by id
  and looked up in `CHANCE_CARDS` / `COMMUNITY_CHEST_CARDS` again. Clone it and
  `deck.owns()` stops recognising it, so it can never be returned.
- **Rebuild every object from the *saved* rule set, not the classic one.**
  `restoreGame` built `new Bank()` for a while, which silently reset
  `housesPerHotel` to four on a map that said otherwise. Anything whose
  constructor takes rules has to be handed `board.rules`.
- **The round counter needs its companion.** `round` alone cannot be resumed:
  which seats have already played in it is what says when the next one starts, so
  `captureRound` / `restoreRound` carry both.

Bump `SNAPSHOT_VERSION` when the shape changes; `validateSnapshot` refuses a save
this build cannot read rather than half-restoring it.

### Bots decide, the scene drives

`game/Bot.ts` answers questions — buy this? bid how much? build where? — and
`GameScene` applies the answers through the same paths a button would. Nothing in
`Bot.ts` may touch a scene, a button or a tween: the headless runner in M8d will
reuse the policy without one.

Two properties are load-bearing and easy to break:

- **It draws no randomness.** A bot that called `rng` would move the dice stream
  and stop a seeded game replaying. Decisions are pure functions of the state.
- **Anything a bot must respond to needs a bot path.** A modal that waits for a
  click will wait forever on a bot's turn — that is why `card:draw` closes its own
  overlay for a bot, and why the buy prompt is answered instead of shown. Add a
  new prompt and you owe it one.

### Panels render, they do not decide

`PropertyPanel`, `AuctionPanel` and `TradePanel` all take a view model and report
presses. Every rule behind them — what is legal to build, who bids next, whether
an offer is valid — lives in `game/` and is unit-tested. The one exception is
deliberate: `AuctionPanel` owns the bid clock, because "the clock ran out" is a
UI event, and it calls the same `pass()` the button does.

An estate can change hands outside a turn now (auction win, trade, bankruptcy),
so anything that moves a deed must call `boardView.refresh()` — the owner bands
and buildings are drawn from tile state, not re-derived per frame.

### A token's screen tile is not its model position

`TurnManager` sets `player.position` to the destination *before* the walk starts,
so asking the model who is standing on a tile mid-animation gives the wrong
answer. `GameScene.tokenTile` tracks where each piece is **on screen**, and it is
what `occupantsOf` reads.

Tokens sharing a tile are clustered by `ui/TokenCluster.ts` — one centred, two on
a line, three in a triangle, more around a ring, shrinking as the crowd grows.
The cluster is rebuilt for the tile being left *and* the tile being entered on
every step of a walk, so a token passing through an occupied square makes its
occupants shuffle and then close up again. Anything that moves a token must go
through `placeToken` / `snapToken` rather than setting a position directly, or it
will land on top of somebody.

### Colours come from `theme()`, and a panel is written to, not rebuilt

**10. No colour literal in `ui/` or `scenes/`.** `ui/Theme.ts` holds the board's
ground and outlines, the colour groups, the token colours, the panel palette, the
chrome and the log's stripes; `theme()` is how you get them, `hex()` converts a
Graphics number to a Text `'#rrggbb'`. Two themes ship, and the second is not
decoration — it is the test: a token or a colour group that only one theme has a
colour for fails `tests/theme.test.ts`. A theme is **not** game state, so it is
not in `GameRules` and not in the snapshot.

**10b. How a tile type draws is `registerTileDecoration`, not a branch.** The
handler gets the tile's own frame (origin at its centre, already rotated, the
board's interior past its top edge) plus a `label()` that places text in that
frame the right way up. That is what makes one decoration correct on all three
board shapes. `BoardRenderer` must never grow a `tile instanceof X` again.

**10c. Panels draw onto a `Surface` (`ui/Retained.ts`).** Elements have names;
a render writes to what is already there and destroys only what it did not ask
for. Never call `container.removeAll(true)` in a panel again — that is what
dropped the hover state under the cursor and made a new listener on every draw.
A `Surface.button`'s listener is registered *once* and its handler lives in a slot
the surface rewrites; only the hover colours are re-bound per render.

**10d. A panel that measures itself reports where its buttons are.**
`TradePanel` sizes its deed list to what the players hold, so its buttons move —
`spots()` publishes their positions and the playtest asks (`__forge.tradeSpots()`)
instead of keeping coordinates in `HOTSPOTS`. Any panel whose layout stops being
fixed owes the harness the same.

### The board is drawn once, its state many times

`ui/BoardRenderer.ts` holds everything inside the board square. `draw()` lays down
the static layer (tile outlines, colour stripes, names, click zones) and must be
called once; `refresh()` clears and redraws the *state* layer — owner bands,
houses, hotels, mortgage marks — and has to be called after anything that changes
tile state: buying, building, selling, mortgaging.

There is one loop over tiles, not one per side. Each tile's footprint, orientation
and which edge faces the board interior come from its `TileLayout`, so a new
decoration is written once rather than four times. `GameScene` keeps the tokens,
the buttons and the wiring.

### Phaser API traps

- `this.make.graphics({ add: false })` still *works* at runtime but no longer
  type-checks — `add` was dropped from `Graphics.Options`. Use
  `this.make.graphics({}, false)`; `addToScene` is the second argument. This is
  why `npm run build` failed while `npm run dev` was fine: Vite transpiles without
  type-checking, so `tsc` errors never surfaced during development.
- Removing a container child: `removeAt(1, true)` removes *and* destroys in one
  step. Calling `destroy()` first already removes it, so a following `removeAt(1)`
  is out of bounds.
- `setVisible(false)` does not remove an object from the input hit list — pair it
  with `disableInteractive()`, as `setJailBtnVisible` does, or invisible buttons
  still fire.
- **Toggle a button with `disableInteractive()`, never `removeInteractive()`.**
  The destructive one queues the object for removal from the input plugin's list.
  Disable and re-enable it in the *same frame* — which every turn change does,
  `turn:end` off and `turn:start` on — and the next `preUpdate` clears the input
  object that `setInteractive()` just created while re-inserting the button. It
  sits there at full alpha, looking fine, and never fires again. `setInteractive`
  on an object that already has `input` just flips `enabled`, so the pair is safe.
  This killed ROLL DICE after three doubles sent a player to jail; see DEVLOG.
- `Phaser.Scene` already has a `renderer` property (the WebGL/Canvas renderer).
  A scene field of that name fails to compile with a misleading "type `this` is
  not assignable to parameter of type `Scene`" — `GameScene` calls its
  `BoardRenderer` `boardView` for that reason.

### A local `npm ci` does not prove CI will install

**Run `npm run verify:install` after any dependency change.** A passing local
`npm ci` is not evidence, because it uses *your* npm, and the lockfile is only
valid for the npm that consumes it.

This broke every CI job once. `npm install -D vitest@latest` brought in vitest 4,
which requires `vite ^6 || ^7 || ^8` while `package.json` pinned `vite ^5`. npm 11
resolved that by nesting a second Vite (the app built on Vite 5 while the tests
ran on a nested Vite 8) and then wrote a lockfile that recorded the nested Vite
but **not** its `esbuild@0.28.1` subtree. npm 11 reinstalls happily from its own
incomplete lockfile; npm 10 — bundled with Node 22, therefore the npm on the
runners — recomputed the tree, found 27 packages absent, and refused with
`Missing: esbuild@0.28.1 from lock file`.

Two rules follow:

- **Keep dependency majors aligned.** If a dev tool wants a different major of
  something `package.json` already pins, fix the range rather than letting npm
  nest a second copy. Check 3 of `verify:install` fails on exactly that.
- **Node and npm come as a pair.** CI resolves Node from `.nvmrc`
  (`node-version-file`), so the npm major is whatever that Node bundles. Both
  workflows print `node --version && npm --version` before installing.

### The playtest harness clicks fixed coordinates

The game is one canvas with no DOM controls, so `tools/playtest.mjs` clicks board
pixel positions from its `HOTSPOTS` table. **Move a button in a scene and you must
update that table**, or the harness clicks empty space and fails with a vague
"no property was bought in the whole run".

`GameScene.exposeDebugHandle()` publishes `window.__forge` (state, phase,
`isAnimating`, whether a prompt, card or property panel is open) so the harness can
assert on real model state rather than pixels. It is gated on the same switch as
debug logging, so a plain production load exposes nothing.

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
chain. Keep new hooks read-only unless the alternative is a rule with no
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

## Deployment

`vite.config.ts` sets `base: './'` — relative asset paths, so one build serves
from the dev server, from `vite preview`, and from
`https://<user>.github.io/monopoly-forge/` with no repo name compiled in. There is
no client-side routing, so no `404.html` fallback is needed.

`.github/workflows/ci.yml` runs typecheck + tests + build on Linux and Windows,
plus the browser playtest; `pages.yml` deploys `dist/` to GitHub Pages.

## Style

Match the surrounding code: two-space indent, single quotes, semicolons, aligned
trailing comments and the `// ─── Section ───` banner comments. Comments explain
*why* — several in this codebase record a bug that a plausible-looking
simplification would reintroduce. Leave those in place.
