# CLAUDE.md

Working notes for this repo — the commands, the invariants, and the traps that
have already cost time. Read [KNOWNISSUES.md](KNOWNISSUES.md) before concluding
that something is broken; several oddities here are known and deliberate.

**What is not here, on purpose.** This file is read every session, so it keeps the
rules and leaves the retellings elsewhere. Reach for these when you are actually
in that corner of the repo:

| When | Read |
|---|---|
| Working on, or breaking, the browser harness | [docs/playtest-harness.md](docs/playtest-harness.md) |
| Changing a dependency | [docs/ci-and-dependencies.md](docs/ci-and-dependencies.md) |
| Phaser doing something inexplicable | [docs/phaser-traps.md](docs/phaser-traps.md) |
| Adding a game | [docs/authoring-a-game.md](docs/authoring-a-game.md) |
| Wondering how the layers fit | [docs/architecture.md](docs/architecture.md) |
| Wondering *why* a rule exists | [DEVLOG.md](DEVLOG.md) — every invariant here has an entry there |

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

`npm run playtest` accepts `--turns N`, `--seed N`, `--players N` (2–6; the
menus are what a full table breaks, not the board), `--headed` (watch it play),
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
`board.announcePassing(path, playerId, ctx)` is the only caller. So **`onPass` is
what a tile charges you for being there and `onLand` is what else happens** — a
pay corner that pays more for stopping pays the *difference* in `onLand`, and one
that pays the same pays nothing extra. Writing the full landing amount in
`onLand` makes every pass pay twice. Forward walks only: going back three spaces
over GO has never paid, which is why `goBack` moves without calling it.

**6e. `PassContext` is what the walk knows about itself, and `roll: null` means
*direct*.** One field, and it stays one field until a rule needs a second: a
context that accumulates whatever seemed handy is how `onLand` would have ended
up with the whole game in it. `roll` is the dice total that produced the walk, or
**null when the dice are not what moved you** — a card, a voucher, a subway, a
bonus move. That null is not an absence of information; it is the state the
printed rules call *direct movement*, and Ultimate's Pay Day reads it as "pay the
maximum". **The argument has no default on purpose**: there are five movers in
this build and exactly one of them is the dice, so a new one has to say which it
is rather than silently paying the top rate.

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

**7g. "Which one?" is `askChoice`, and it owes a bot an answer.** A rule that
picks for everybody is a rule nobody gets to play — so what used to be the
deterministic answer becomes an option's `weight`, and the bots keep playing
exactly as they did while a person gets asked. There is no policy registry and
deliberately so: an asker that cannot express itself as a weight is the thing
that would justify one.
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

**19f. Even building is measured over the lots you *own*, not the group.** A
level may ask for a `'majority'` — all but one, in a group of more than two —
and the lot you do not own sits at level 0 for ever. Counting it holds the whole
group at nothing, which looks exactly like the rule being implemented and
permits no house. The same applies coming down.

**19. What can be built is a ladder, and a level says which of two shapes it
is.** `game/BuildLadder.ts`. A `BuildLevel` names a building, which tile types it
stands on, how many fit, what the bank stocks — and crucially whether it charges
the next **rent tier** (house, hotel, skyscraper: needs the colour group, goes up
evenly) or **multiplies** what the tile already charges (train depot, cab stand:
needs nothing but the deed, and doubles a rent that is priced off how many its
owner holds). Forcing both into one shape is the mistake this design exists to
avoid. `canBuild` / `canSell` are one question per *direction*, so a game adding a
rung gets its legality, its bot and its renderer for free.

**19b. A tile's `level` is the rung *and* the rent tier.** One number replaced
`houses: number` + `hasHotel: boolean`, and `rentTiers[level]` replaced
`hasHotel ? tiers[5] : tiers[houses]`. That is what made the change cheap — and it
deleted a state the old pair could represent and no rule could produce (a hotel
*and* three houses), which every reader used to need an opinion about. `level`
lives on **`Ownable`**, not on a lot, because a railroad can hold a depot.

**19c. How many rent tiers a lot needs is `validateGame`, not `validateMap`.** A
map has no economy (invariant 11), so it can only insist a lot charges something
bare and something built; the *count* is the ladder's business and is checked
where map meets rules. Getting it wrong is otherwise silent — `rentTiers[6]` on a
six-tier deed is `undefined`, and rent becomes `NaN`.

**19d. The bank stocks by kind, and the census counts every one.** `bank.stock` is
a `Record<string, number>`; `houses`/`hotels` survive as accessors because "how
many houses are left" is still a real question. A census naming only those two
would let a game's third building be minted out of nothing — the exact shape of
the deck bug `sim/Invariants.ts` was written after. The exchange between rungs is
what makes it worth checking: a hotel takes one out of one box and puts four back
in another.

**19e. The three building scalars stay the player's, and win.** `houseLimit`,
`hotelLimit` and `housesBeforeHotel` describe the two rungs every game here has
and remain in `RULE_FIELDS`; `resolveRules` writes them into the ladder's `house`
and `hotel` levels after layering. So nudging "houses in the bank" cannot flatten
a game's extra rungs — the failure invariant 11c warns about. The ladder itself is
array-shaped and stays out of `RULE_FIELDS`, like `movement`.

**20. A junction is two tiles and one space, and the space is not a rectangle.**
Ultimate Monopoly's rules say "TRANSIT STATIONS and RAILROAD spaces are considered
one space", and the board draws them as one block across two rings. Movement needs
two tiles — stepping off one continues on your ring, off the other crosses — so
`mergeJunctions` reconciles them at *layout* time.

It does it by **not stroking the edge between them**, and the first attempt —
giving the pair one merged rectangle — is the instructive failure. **Concentric
rings do not share a tile width.** Each divides a different perimeter by a
different count, so Ultimate's are 43, 49 and 64 across; one rectangle has to pick
a width, and whichever it picks overhangs its neighbours on the other ring by half
the difference. All four junctions overlapped their neighbours.

Nor can the widths be tuned into agreement, which is the tempting fix: equal pitch
across 13, 9 and 5 tiles a side needs the rings so far apart that the two halves
stop touching, and touching is the whole premise. So each half keeps the width its
own ring gives it, the shared edge goes unstroked, and the space is a *stepped*
block — which is what it honestly is. `tests/movement.test.ts` pins it, including
a check that **no tile is drawn over any other**.

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

A pay corner keyed off the dice is the same problem one step further on, and it
is solved the other way: the roll travels *with the walk* in `PassContext`
(6e) rather than being parked on the scene, because every tile underfoot needs it
and only the landing tile needs `arrivalRent`.

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

### A game may give a player something the engine has never heard of

**18. Holdings are countable and keyed by kind** (`game/Holdings.ts`), because
that is what makes them a `Record<string, number>` and therefore trivially
saveable. Anything needing identity is a card, and cards have a home. Use
`giveHolding` / `takeHolding` rather than writing to `player.holdings`: a kind
may have a limit, and the helpers report what actually moved.

**18b. Four places owe a new holding something**, and three of them are lessons
already paid for: the **snapshot** carries it, **`transferEstate`** moves or
forfeits it *by name* (the deck census bug came from an implicit "destroy"), the
**invariant census** counts it, and a **`value`** says what it is worth. The
census is a census, not a conservation law — a game mints holdings, so a fixed
total would be checking something untrue, which is the mistake M8d nearly made
with total cash.

**18g. A trade moves holdings, and a limit is not negotiable.** `TradeOffer`
carries `fromHoldings` / `toHoldings`; `validateTrade` refuses an offer that
would take the receiver past a kind's `limit`, because `giveHolding` would clamp
and the excess would evaporate — an offer that quietly delivers less than it
says. Read them as `?? {}`: an offer built before the fields existed is still a
valid offer.

**18e. `estateValue` counts a holding; `liquidValue` must never.** Wealth and
what a fire sale can raise are different questions and this is the first thing
to separate them — nothing can sell a travel voucher, so counting one in
`liquidValue` would let `settleDebt` believe a debt coverable that is not.

**18c. `validateSnapshot` loads the game before checking what it registers.**
Holdings, turn orders, win conditions and variants are all scoped, and validation
runs from the **menu** — where the game in force is whichever was played last.
Checking first refused Ultimate Monopoly's own saves.

**18d. Spending is a game's business, not the engine's.** The registry knows a
voucher exists, is worth $60 and survives its owner; it does not know that
playing one asks where you would like to go. `GameScene.SPENDABLE` maps a kind to
the tile effect that plays it.

**18f. A menu screen is as long as the table, so it must not grow per seat.**
The Inventory listed every player's cash, deeds, buildings and holdings on one
screen, which is five rows a seat and ran off the bottom of an 800px canvas at
four players. It is a seat *list* now, one row each, opening one screen per
player. Anything else that renders per player owes the same shape — `ui/Menu.ts`
does not scroll, deliberately, and a second scrolling mechanism is worth more
than the screen it would save. The playtest asserts every inventory row is
on the canvas, which is the check that was missing when it broke.

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

Four rules it follows, each of which cost something to learn:

- **Restyle a button, never rebuild the row.** `buildButtons` runs *while the
  scene is paused* — the pause menu is what changes the theme — so a button that
  called `setInteractive` there came back dead, on an input plugin that was not
  processing. Rebuilding also duplicated the Escape handler and left the old row
  superimposed and still interactive. `chromeStyles` re-applies colours only; the
  hover handlers already read `theme()` when they fire.
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

### The playtest harness clicks fixed coordinates

The game is one canvas with no DOM, so `tools/playtest.mjs` clicks board pixel
positions from its `HOTSPOTS` table. **Move a button in a scene and you must
update that table**, or the harness clicks empty space and fails with something
vague. Four rules follow, and the reasoning behind each is in
**[docs/playtest-harness.md](docs/playtest-harness.md)**:

- **Menus, tiles and trade rows are *not* in the table.** They report their own
  positions (`__menu.spots()`, `__forge.tileCentre()`, `__forge.tradeSpots()`) and
  the harness presses them **by name**. Keep it that way; the table is for scene
  buttons only.
- **Nothing may assume the board's size.** `__forge.board()` reports it. The
  harness checked `position <= 39` for four milestones and failed Ultimate
  Monopoly's 120-tile board with it.
- **Poll for the end state, never for "nothing is open."** A walk goes idle a
  moment before its landing draws a card. The headless clock also runs slow — a
  `delayedCall(700)` can take ~2 s — so sleeping for the nominal delay is how you
  get a "nothing happened" that is really impatience.
- **A run owns the screenshots it may write.** `shot()` used to save a fixed
  filename whatever the run was playing, so `--game ultimate --shots` — a
  reasonable way to refresh one picture — overwrote thirteen Classic screenshots
  with Ultimate ones, invisibly, because the names are only referenced from
  README.md. Three run shapes own anything: plain Classic owns the gallery,
  `--bots` owns `12-bots`, and a non-Classic game owns *its board picture only*
  and stops as soon as it has it. Any other shape — a variant, a house rule, six
  players, a theme — owns nothing. `npm run screenshots` is all five passes.
- **A write-hook arranges the position, never the answer.**
  `__forge.forceHouseShortage()`, `forceBankruptcy()` and `forceMutualKeys()` set
  up a board the real rule then plays out. Keep new hooks read-only unless the
  alternative is a rule with no end-to-end check at all.

### Dependencies: a local `npm ci` does not prove CI will install

**Run `npm run verify:install` after any dependency change.** A passing local
`npm ci` is not evidence — it uses *your* npm, and a lockfile is only valid for
the npm that consumes it. Keep dependency majors aligned rather than letting npm
nest a second copy of something, and remember Node and npm come as a pair (CI
resolves Node from `.nvmrc`). The failure that established all of this — it broke
every CI job once — is in
**[docs/ci-and-dependencies.md](docs/ci-and-dependencies.md)**.

### Phaser API traps

Two bite often enough to keep here; the rest are in
**[docs/phaser-traps.md](docs/phaser-traps.md)**.

- **Toggle a button with `disableInteractive()`, never `removeInteractive()`.**
  The destructive one queues the object for removal from the input plugin's list,
  and disabling then re-enabling in the *same frame* — which every turn change
  does — leaves it at full alpha, looking fine, and never firing again.
- **`Phaser.Scene` already owns some obvious field names.** A collision fails to
  compile with the misleading "type `this` is not assignable to parameter of type
  `Scene`", naming neither the property nor the file. `renderer` and `data` have
  both been hit — which is why `GameScene` calls its renderer `boardView` and
  `PauseScene` calls its init payload `paused`.

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
