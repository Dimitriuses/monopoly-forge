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
npm run simulate     # plays games headlessly and reports; see below
```

`npm run simulate` builds a Node bundle (`vite.sim.config.ts` → `dist-sim/`) and
runs it. `--game <id|all>`, `--games N`, `--seed N`, `--players N`,
`--policies a,b` (one seat each, for a head-to-head), `--mirror` (every seating
order, tallied by policy — the only honest way to compare two), `--round-limit N`,
`--max-turns N`, `--no-invariants`, `--json`. It exits non-zero **only** when an
invariant breaks; a game that outruns the cap is reported, because Monopoly
genuinely does not always terminate.

`npm run playtest` accepts `--turns N`, `--seed N`, `--headed` (watch it play),
`--url <url>` (drive a deployed site instead of `dist/`),
`--game <id>`, `--variants <a,b>`, `--house-rules` and `--theme <id>`. The last
four go through the URL (`?game=`, `?variants=`, `?houseRules=`, `?theme=`)
because the switches are canvas text with no DOM for a harness to click.
`--map` is gone: a board is not what you choose to play any more, a game is.

## Invariants

These are not style preferences. The project *is* an engine for Monopoly-style
games now — configurable maps, rules, presentation and whole games, with a
headless simulator to check them ([ROADMAP.md](ROADMAP.md)) — and invariants 1
and 2 are what made that reachable and what keep it: a rules core that runs
without a browser, and a renderer that can be replaced without touching the
rules. Breaking either takes the engine back apart.

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
well as the square — run `npm run playtest -- --bots --game roundabout` before
believing a board change is safe.

**6c. A board is not necessarily one loop, and `move` reports the route.**
`Board.move(from, steps, ctx)` returns `{ to, path, passedGo }`, and `path` is
every tile stepped *onto*, `to` last. What one step means is a named strategy in
`game/Movement.ts` resolved from `rules.movement`: `circuit` is one loop,
`tracks` walks the loops a map declares in `GameMap.tracks` and crosses at its
`junctions` when `ctx.crossing` is set (which `TurnManager` sets from the parity
of the roll). Three things follow and all three have already been got wrong:

- **Never recompute a route somebody else walked.** `player:move` carries `path`
  and the tokens follow it. A token that recomputed with `board.move(from, s)`
  would pick its own way across a junction and arrive where the model never went.
- **Distance is a search, not a subtraction.** `board.pathTo(from, to)` and
  `board.scan(from, predicate)` are breadth-first and topology-agnostic; on one
  circuit they return exactly what `stepsBetween` did. Anything counting steps in
  a loop of its own is wrong on a board with junctions — that is why `CardDeck`'s
  `nearest` and `SpeedDie`'s `scanForward` are gone.
- **`move(from, 0)` still normalises `from`.** The walk loop never runs, so the
  normalisation is done up front; removing it puts an out-of-range index back.

**6d. `onPass` fires for every tile underfoot, the landing tile included.**
`board.announcePassing(path, playerId)` is the only caller. So **`onPass` is what
a tile charges you for being there and `onLand` is what else happens** — a pay
corner that pays more for stopping pays the *difference* in `onLand`, and one
that pays the same pays nothing extra. Writing the full landing amount in
`onLand` makes every pass pay twice. Forward walks only: going back three spaces
over GO has never paid, which is why `goBack` moves without calling it.

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

**11. A game is the unit, and `gameById` is how you get one.** `src/games/<id>/`
holds a board, the economy it is balanced for, the deck it deals, the variants it
is played with, the palette it prefers and any artwork it brings. Six ship, and
[docs/authoring-a-game.md](docs/authoring-a-game.md) is how to add one.
**Ultimate Monopoly is the stress test** — 120 tiles, three loops, twenty colour
groups, fourteen tile types the engine had never heard of — and four of the
invariants above exist because of it. When something new has to be expressible,
try it there first. **A map has no economy** —
`GameMap` is tiles and a shape, and anything that reaches for `map.rules` is
reaching for something that moved in M9a.

`gameById(id)` **loads before it validates**, and the order is load-bearing: a
game's registrations have to be in force before anything asks whether its tile
types exist or its board can be built. Never construct a `Board` from a game's map
without loading the game first — in the scene, in a test, or in the simulator.

**11b. Loading a game resets every registry.** `games/scope.ts` puts the built-ins
back and applies that game's own, so two games cannot get each other's tile types
or card effects. That is *serial* isolation: one game live at a time. Registering
a type at module scope still works and still leaks — use `Game.register` for
anything a game owns, and keep module-level registration for built-ins only.
`registerTheme` is deliberately outside the scoped set (a colour is not a
correctness problem, and scoping it would make `games/` import `ui/`).

**11c. A game's theme, variants and house rules are defaults, not requirements.**
The menu applies them when a game is picked and stops as soon as the player has
chosen for *that* switch. Anything else added to `Game` that a player can also set
owes the same treatment — the house rules were the field that did not get it, and
a game could not turn one on for a whole milestone because the menu sent all three
booleans explicitly and its `false` beat the game's `true`.

**11d. A game's artwork replaces a texture; it never adds a lookup.** `Game.assets`
is keyed on the names the renderer already asks for (`house`, `hotel`, `token_*`),
loaded in `GameScene.preload`. Two things are easy to get wrong and are already
paid for: **the loader silently skips a key the texture manager holds**, so the
drawn one has to be removed first — `BootScene` has baked all of them by then —
and the bakers must skip a supplied key, or a theme change paints over it.
`__forge.textures()` says where each one came from (a canvas is drawn, an image
was fetched) and the playtest asserts on it. **The default is no assets at all**,
and that is what keeps the repo free of third-party art.

**12. There are two drivers, and they share everything that decides anything.**
`GameScene` animates and waits; `sim/Runner.ts` does neither. What they must
share is `game/Landing.ts` — what a landing *costs*: quote the rent, settle the
debt, pot the tax, draw the card, pay what a free landing pays. A rule added to
one driver and not the other is the failure mode this split exists to prevent, so
anything a landing does belongs in `Landing.ts` and anything about *when* belongs
in the driver. `rulesFor(game, overrides)` is the same idea for a rule set: it is
the only place one is assembled, because the simulator once resolved `game.rules`
and dropped `game.variants`, and Speed Die played without the speed die.

**12b. An invariant that does not always hold is worse than none.** `sim/Invariants.ts`
checks positions, non-negative cash, both halves of ownership agreeing, the
building census, the deck census and that a bankrupt player holds nothing. It
deliberately does *not* check total cash (the salary creates money and taxes
destroy it) or that every game reaches a winner (Monopoly does not always end —
see KNOWNISSUES). Do not add either back.

**7. The bank does not know the rules.** `Bank` moves cash and inventory and asks
no questions, because it has no view of the board — `bank.buyHouse` will happily
put a house on a lot whose colour group you do not own. Legality lives in
`game/BuildRules.ts`, and every path that builds, sells or mortgages must check
there first. The checks return a *reason*, which is what the property panel shows
when a button is dead.

**7b. Rule *values* come from `board.rules`, never from a constant.** Starting
cash, the GO salary, the jail fine and term, the doubles-to-jail count, the house
supply and how many houses a hotel is worth are all in `game/Rules.ts`, resolved
as classic → the game's → the player's switches. Writing `50` for the jail fine or
`>= 3` for doubles puts the classic board back into the engine, and so does a
literal rent multiplier — `monopolyRent` and `majorityRent` are what an
unimproved group charges, because Ultimate Monopoly pays two tiers where the
classic game pays one. A railroad counts **its own `tile.type`**, not the literal
`'railroad'`, so a game may have a second railroad-shaped thing without it
raising the first one's rate. The rule set is
saved with the game, so anything added to it belongs in the snapshot too.

**7c. Tile types and card effects are registries, not switches.** A new tile kind
is `registerTileType(name, factory)` in `tiles/registry.ts`; a new card effect is
`registerCardEffect(name, handler)` in `cards/effects.ts`. Neither `Board` nor
`CardEffects` should ever grow a `switch` over kinds again — that is what closed
the set in the first place. A card effect gets a small context, not the
`CardEffects` instance: keep what an effect may touch visible in one place.

**7g. "Which one?" is `askChoice`, and it owes a bot an answer.**
`game/Choice.ts`. A choice is data — options with weights — and both drivers
answer it: `GameScene` shows a list, or highlights tiles and takes a board click
when the options *are* tiles; `sim/Runner` hands it straight to the heaviest
option. **Both halves are needed, and the answer needs a home too**: the first
batch after triples landed hung 69 of 80 Speed Die games because `choice:ask` was
answered and the `roll:chosen` it replied with had no handler in the runner. A
rule that asks must also survive nobody listening — `askChoice` returns false and
the caller falls back rather than parking the turn for ever.

**7h. What a roll *means* is `rules.rollRule`.** `game/RollRules.ts`, the fifth
registered strategy. A rule returns **what should happen** — `move`, `jail`, or
`handled` when it has a prompt in flight — and `TurnManager` does it. A rule that
moved a player itself would be a second mover and the phase pipeline would have
two things deciding when a turn ends. Never put an `if` about the dice back into
`rollDice`; that `if` is why the triples rule sat deferred from 8b to 10a.
**A variant may bring rule values** (`Variant.rules`), layered under the game's
and the player's — without it the speed die could register a roll rule and had no
way to select it.

**7f. A tile's rule may mention somebody else, and then it is an effect.**
`Tile.onLand(playerId)` gets an id and nothing else. That is enough for every
built-in — a lot knows its own rent — and useless for "collect $50 from every
other player" or "auction any unowned property", because a tile can see neither
the players nor the board. Those are `registerTileEffect(name, handler)` in
`game/TileEffects.ts`: the tile emits `tile:effect` and **both** drivers resolve
it through `applyTileEffect` with `effectContext(landingContext())`. Build that
context in a driver and it will drift; it is assembled in one place for the same
reason `Landing.ts` exists. An effect finishes the landing the way any tile does
— `player:landed`, or a move whose walk resolves it — so neither driver calls
`safeEndTurn` for one. **An effect that moves a player to a tile of its own kind
must guard against arriving there**: Ultimate Monopoly's two Holland Tunnels each
send you to the other, and the first run of that game died in a stack overflow.

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

**9b. A mortgaged deed costs its new owner 10% to receive.** Charged on all
three transfer paths — trade, auction, bankrupt estate — from one place,
`chargeMortgageInterest` in `game/Estate.ts`, and *after* the deeds have moved so
a player raising the money cannot sell what the transfer is still handing over.
The rate is `rules.mortgageInterest` and governs the lift charge too, so one
number turns the whole rule off. Add a fourth way for a deed to change hands and
it owes this call.

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

### A restored turn is picked up, not restarted

**14. The snapshot says *where in the turn* it was taken.** `turn.phase`,
`turn.held` and `turn.pendingLanding`. A restore used to call `startTurn()`
whatever had been saved, which is why saving was refused any time a turn was in
progress — the save was fine and the resume threw the middle of it away.

**`restorePhase` sets the phase and does not `enterPhase` it.** A phase's
`onEnter` is what *happens* when you arrive; arriving a second time would run a
variant's extra move again, from a save taken while the first one was on screen.
What to do next is the driver's, and there are only three answers —
`GameScene.resumeSavedTurn` has them: a landing is owed (a token was walking, so
snap the tokens and resolve it — never replay the walk, the salary is already
paid), an answer is owed (re-offer the buy prompt), or nothing is owed (offer the
dice).

**`pendingLanding` comes from the driver, not the model.** Only the scene knows a
tween is in flight; `captureGame` takes it as a parameter for that reason.

**14d. An auction saves itself; what is around it does not.** `Auction.capture`
covers the subject, the bidders still in, whose turn it is and the standing bid —
the clock is a `scene.time` event the panel owns and is deliberately not in it,
so a restored auction counts down from the top. The driver saves three more
things beside it and each has a reason: the **queue** a bankruptcy fills,
**`auctionEndsTurn`** (without it a restored estate sale ends a turn it has no
business ending), and *which lot* a contested house was asked for. The
**contention claims are recomputed** rather than saved — `houseClaims` derives
them from the board and the bank, which both come back, and a stored copy could
disagree with the board it came from. Restore the bidders from the **restored
table**: an auction bidding against copies settles against cash nobody has.

**14b. What may be saved is a rule, not a list.** *You may save whenever the game
is making you wait, and not in the middle of your own half-finished input.*
`saveBlockedBecause()` returns a sentence, and every entry in it should be
somebody's unfinished input — an auction, a half-built trade, an unanswered
question. If a new blocker is not that, the answer is to make it saveable.

**14c. A phase nothing enters is a phase that lies.** `AWAITING_BUY_DECISION` sat
in the phase list from 8b to 10b with nothing ever entering it, so a turn waiting
on the buy prompt reported `LANDING` — a phase it had already left. Both drivers
call `offerBuy()` now. A `driven` phase still needs *something* to drive it, or
it is documentation rather than state.

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

### A bot claim is a measurement or it is nothing

**17. `--policies a,b --mirror`, or do not say a bot is better.** Seat order is
worth more than any policy in this repo, so an unmirrored match measures the
seating. The tool plays every rotation and tallies by policy name, and
`PROFILES.control` is the baseline under a second name — two identical policies
must come out 50/50 (they do: 300/300, spread 0). Check that before quoting
anything else.

**17b. `game/BoardOdds.ts` is computed, never tabulated.** A Markov chain over
the real board and the real `Board.move`, so it is right on a circle, a spiral
and three loops as well as on the 1935 square. It leaves out the cards and the
three-doubles rule deliberately: the pattern a bot needs is *which squares are
busy*, that is decided by Go To Jail, and odds that changed every time somebody
drew a card would be worse than blunt ones that hold still. Cached per `Board`.

**17c. Three measured findings live in `Bot.ts` as comments.** Buying by payback
is worse than buying for denial; ranking lots by yield is worse than finishing
the cheapest group; the auction ceiling barely matters because little is
declined. Do not "fix" any of those without re-running the mirror — each is a
result, not an oversight.

### Bots decide, the scene drives

**15. A bot may interrupt a person, and the rules of that are `mayInterrupt`.**
Whether a trade is worth making is `proposeTrade`; whether a bot may put one in
front of somebody who did not ask is separate, pure, and in `Bot.ts` — rationed
by `botTradeCooldown` and switchable off with `botOffersTrades`. **The bot's turn
holds until the offer is answered**: `botRollWhenClear` waits on
`pendingBotOffer` the same way it waits on an auction, because a question the
game rolls past is a question nobody got to answer. `closeTrade` is what releases
it, whatever the answer was.

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

### The menus are a tree, and one component draws both

**13. Both menus render from `ui/Menu.ts`.** The title screen and the pause
screen are the same object with different roots; written as two scenes they drift
inside a milestone. A screen is **data, rebuilt on every render** — a row's
label, value and enabled-ness are functions — so "Save — a token is still moving"
is a row that answers for itself rather than a scene remembering to grey
something out. Rows draw onto a `Surface`, so 10c's rule applies unchanged.

**13b. A player-editable rule is a line in `RULE_FIELDS`, not a control.**
`game/RuleFields.ts` (plain Node, beside the rules) says which of `GameRules` a
person may set, its type, its range and which section it belongs in; the settings
screens are generated. Adding a rule to the engine costs one line here and no
scene edit. Two things stay out on purpose: **`movement`**, because setting a
tracks board to `circuit` is a pairing `validateGame` refuses — it belongs to the
board, not to a preference — and anything **array-shaped** (`bidSteps`), which
has no control worth building. `variants` is the exception that proves it: a list
the engine holds, shown as one switch per entry.

**13c. The menu keeps only what the player changed.** `Partial<GameRules>`, not a
full rule set plus flags. Layering is then `rulesFor(game, overrides)` — what the
engine does anyway — so an untouched rule follows whichever game is picked and a
touched one survives changing game. The three `themeChosen` / `variantsChosen` /
`houseRulesChosen` booleans this replaced were three chances to get that wrong,
and the third existed only because Pocket could not turn its own house rule on
for a whole milestone.

**13d. Saving lives in the pause menu, and says why it cannot.**
`GameScene.saveBlockedBecause()` returns a *sentence* rather than a boolean, so
the row prints "something is under the hammer" instead of the player pressing a
button and getting a toast. Pause uses `scene.pause`, never `stop`: the board
stays behind the scrim and every tween and `delayedCall` is held rather than
cancelled — which is what the turn-generation guard expects to survive.

### Colours come from `theme()`, and a panel is written to, not rebuilt

**10. No colour literal in `ui/` or `scenes/`.** `ui/Theme.ts` holds the board's
ground and outlines, the colour groups, the token colours, the panel palette, the
chrome and the log's stripes; `theme()` is how you get them, `hex()` converts a
Graphics number to a Text `'#rrggbb'`. Two themes ship, and the second is not
decoration — it is the test: a token or a colour group that only one theme has a
colour for fails `tests/theme.test.ts`. A theme is **not** game state, so it is
not in `GameRules` and not in the snapshot.

**10e. Ask `groupColor(group)`, never `theme().groups[group]`.** `ColorGroup` is
an open union and a theme's `groups` is not a total map — it cannot be, when a
board may bring twenty groups and Ultimate Monopoly does. A group the theme has
no colour for is **derived from its name**, in that theme's own average
saturation and lightness, so it belongs to the palette instead of shouting over
it. The derivation is stable on purpose: a colour is how a player learns a group,
so the same name must give the same colour in every build.

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

### A palette can change while a game is running

**16. `GameScene.applyThemeLive` is the list of everything drawn in a colour**,
and it is a list on purpose — an event each component subscribed to would let one
that forgot keep its old palette, which is the failure hardest to see. Order
matters once: **the textures are re-baked first**, because the board's `refresh`
draws houses from them and each token holds one by key.

Three rules it follows, each of which cost something to learn:

- **Re-texture the piece, never rebuild the token.** A container is what a walk's
  tween targets; destroying one leaves the promise the walk awaits unresolved and
  the turn parked for ever.
- **A panel has to be told.** `PropertyPanel` and `TradePanel` skip a render when
  the view model is unchanged, and a palette change moves no view model —
  `invalidate()` is what makes the next `show` real.
- **The HUD restyles; it does not restart.** A restart blanks the dice and the
  banner, and cannot be followed by a `delayedCall` to put them back: this
  scene's clock is paused whenever the pause menu that changed the theme is open.
  `UIScene` keeps what it is showing so `build()` can put it back.

`BoardRenderer` keeps every object its static layer drew (`staticObjects`) so
`redraw()` can take it down — **including the click zones**, because one that
survived would sit under the new one and fire the handler twice.

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
- **`Phaser.Scene` already owns some obvious field names**, and a scene field
  that collides fails to compile with the misleading "type `this` is not
  assignable to parameter of type `Scene`". Two have been hit: `renderer` (the
  WebGL/Canvas renderer), which is why `GameScene` calls its `BoardRenderer`
  `boardView`; and **`data`** (the scene's `DataManager`), which is why
  `PauseScene` calls its init payload `paused`. Check the name before adding a
  field — the error names neither the property nor the file.

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

**The menu is not in `HOTSPOTS` either.** It is a tree whose rows move as games,
variants and save slots are added, so it reports its own positions through
`__menu.spots()` — id, label, current value, and where the ‹ › are — and the
harness presses rows **by name**. `menuPress` throws when a row is missing or
disabled rather than clicking empty space, because a silent miss is the failure
mode the table had. The run also walks into Game Settings, changes a rule, and
asserts it reached `__forge.rules()`.

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
