# Known issues

Measured against the current `main`, by running the game (`npm run playtest`) and
the unit suite (`npm test`) rather than by reading the code. Anything here is
reproducible; anything merely *planned* lives in [ROADMAP.md](ROADMAP.md) instead.

---

## Gameplay

### A returned estate is sold as it stands, mortgages and all

*Fixed:* a player who goes under owing the **bank** now has their deeds auctioned
one after another, as the standard rules require. `transferEstate` reports what
went back unowned, and `GameScene` queues a `tileSubject` for each; the turn that
caused the bankruptcy does not end until the queue is empty.

What is still a simplification: a mortgaged deed goes under the hammer mortgaged,
and the winner inherits the debt rather than being made to lift it or pay the
interest there and then. That matches what already happens when an estate passes
to a *creditor*, so both routes agree — but neither charges the 10%.

### The winner of a contested house does not choose the lot

The last houses *are* auctioned now (`game/Contention.ts`), which closes the gap
that stood here from M5. Two readings of the rule were decided rather than asked,
and both are deliberate:

- **"Wishes to buy" means "could and can afford to."** A player who owns a lot
  the build rules would allow a house on, and holds the cash, is bidding whether
  they clicked anything or not. It is generous — somebody who was not going to
  build still counts — which matters only when the bank is down to its last
  houses, which is exactly when the rule is meant to bite.
- **The winner does not nominate.** Whoever asked for the house gets the lot they
  asked for; anybody else gets the cheapest lot they could legally build on. The
  official rule lets the winner pick, and a hot-seat game could ask them — but
  only with a prompt, which a bot would then also owe an answer to.

Neither can be reached by a game played through: it needs two complete colour
groups and a bank down to one house. `__forge.forceHouseShortage()` arranges it
for the playtest, which is the only reason the browser run exercises it at all.

### The speed die leaves out its triples rule

`game/SpeedDie.ts` implements the third die, the Mr. Monopoly face and the bus
face. Two parts of the official variant are missing on purpose:

- **Triples** (all three dice alike) should let you move to any space you choose.
  That needs a pick-a-tile prompt, and a bot owes an answer to every prompt.
- **The speed die is not in play until you have been round the board once.** That
  is a per-player flag, and anything that is game state has to go in the snapshot.

Doubles are unaffected: `SpeedDice` reports them from the two white dice, so
three doubles still means jail.

### A bid has to be one of the three offered amounts

*Fixed in part:* the clock and the raises are rule-set values now
(`auctionSeconds`, `bidIncrement`, `bidSteps`), so a map or a variant sets them
and nothing in `GameScene` is a constant any more.

What remains is the panel: it offers three buttons — the minimum and two bigger
jumps — and a player who wants to raise by some other amount still cannot. That
needs a stepper of the kind the trade panel has for cash, which moves the panel's
buttons and so means recomputing the harness's `auctionBid` / `auctionPass`
hotspots by hand.

### A save cannot be taken mid-turn, and there is only one slot

Saving is refused while a token is moving, an auction is running or a trade is
open, because a restore resumes at the *start* of the saved player's turn and
none of that state is captured. `SaveLoad` also keeps exactly one localStorage
key, so a new save overwrites the old one with no warning.

### A bot will not make an offer to a person

*Fixed in part:* `Bot.proposeTrade` makes two shapes of offer — a monopoly for a
monopoly (we hold the lot that completes their group, they hold ours, cash tops
it up) and cash for a second railroad or utility. The cash is the smallest amount
that gets a yes, found by asking the partner's own `acceptTrade` rather than
guessing at it. A `--bots` run now shows several trades a game and colour groups
that were completed on purpose.

Making that possible needed one policy change, worth knowing about: a bot used to
refuse to hand over the deed completing somebody else's group **at any price**,
which meant the only deed worth asking for was the only deed nobody would ever
part with. It will now part with one — but only in exchange for the deed that
completes a group of its own. Cash alone still will not buy it.

What is left: **a bot only proposes to another bot.** Whether an opponent should
interrupt your turn with an unsolicited offer is a question about the game's
manners rather than about the trade, and answering it means a modal that arrives
uninvited, plus a harness that knows to answer it.

### The bots are a baseline, and tuning their numbers does not help

The policy is deliberately plain: a flat $150 reserve, a bid ceiling of 1.2× face
value (1.7× for a deed that completes a group), build the cheapest complete group
it can afford. It does not count what rent it is likely to face, weigh position on
the board, or plan more than one purchase ahead.

M8d measured the obvious alternative. `AGGRESSIVE_PROFILE` — almost no reserve,
1.6× at auction, building the moment it can — won **289 games to the baseline's
287** across 576 finished games in both seatings. That is a tie, and it says the
three constants are not where the leverage is.

What *does* matter, by a lot, is seat order: across 300 four-player games the
first two seats took roughly 60% of the wins. A better policy has to be a
different *shape* — one that values a deed by the rent it is likely to face
rather than by its price — and that is now a measurable claim rather than an
opinion.

### What a repeated dice face means is still hardcoded

The turn is a pipeline, a rule set names its order and win condition, and a
variant can supply its own dice — but one turn rule is still an `if` inside
`TurnManager.rollDice`: *N* doubles in a row send you to jail. `doublesToJail` is
a rule value and `Dice` is substitutable, which between them cover the speed die
(it reports doubles from the two white dice and the classic rule applies
unchanged). What no rule set can say is that a *triple* means something, which is
why the speed die's triples rule is missing above.

**The open question, for whoever picks this up:** is a roll's *meaning* a fourth
registered strategy beside `turnOrder`, `winCondition` and `variants` — something
like `rollOutcome(result, player) → { jail?, rollAgain? }` — or does the roll
belong inside the `ROLLING` phase handler, which a rule set can already replace?
The second needs no new registry and no new field in the save file, but it means
`rollDice` handing over control rather than consulting a strategy, which is a
larger change to a method three bugs have already been fixed in. Both are worth
doing only alongside the variant that needs them; the speed die's triples rule is
the only candidate today, and it also needs a pick-a-tile prompt.

### Monopoly does not always end

Across 500 four-player games, 24 of Classic's and 24 of Speed Die's ran past a
6,000-turn cap — about 5%. One followed to 60,000 turns had four players holding
5/6/6/11 deeds, **no monopoly, no houses**
and £1.4M on the table. With nothing built, rent never rises above the salary and
nobody can be bankrupted. It is a property of the game, not a defect in this
implementation — but it is worth knowing before trusting a batch:

- `npm run simulate` **reports** these rather than failing on them.
- `--round-limit N` bounds a batch by a rule instead of by a cap.
- **Roundabout** ships with `winCondition: 'roundLimit'` for exactly this reason
  (M8d's balance pass), which took its stalemate rate to zero in 500 games.

The underlying cause is the bots: `proposeTrade` only makes a mutual-monopoly
swap, so four players who are never simultaneously one-lot-short of two different
groups will never complete one. A stronger trading policy would shrink this, and
the simulator is now the thing that could measure whether it did.

### Three things cannot be saved, and one of them is only a callback

*Narrowed in M10b.* A save taken mid-turn now works: the snapshot carries the
phase, whether the turn was held, and whether a landing is owed, so a walk in
progress and an open buy prompt both survive a reload. What is left refused:

- **An auction.** Plain data, and the only reason it is not done is what
  surrounds it — the turn-ending flag, the queue a bankruptcy fills, the
  house-contention claims. Scheduled, with that reasoning, in the ROADMAP.
  Pausing stops the clock, so nothing is lost by finishing the auction first.
- **A half-built trade.** The offer is serialisable; re-opening the panel on the
  far side is the work, and a draft is the one thing here a player can rebuild in
  seconds.
- **A question in flight.** This one is different in kind: a `ChoiceRequest`
  carries an `answer` **callback**, and a closure cannot be written to
  localStorage. Saving it would mean the *asker* being re-entrant — able to ask
  again from saved state — which is per-asker work rather than one mechanism.

### Three things a bot still cannot be asked

*Narrowed in M10a.* `game/Choice.ts` closed the "nothing can ask a player to pick
a tile" gap — triples, the contested-house lot, Ultimate Monopoly's Subway and
its Auction square all ask a real question now, and a bot answers by weight.

What is left is narrower and worth stating separately: a bot's answer is only as
good as the weight the *asker* supplies. Triples weights every tile by price, so
a bot always jumps to Boardwalk — correct often and not always, because it takes
no account of what the bot already owns or of what it would have to pay to land
there. The weights are a first pass, not a policy.

### The menu can set a rule that the game it is set for refuses

*Added in M10d.*

`RULE_FIELDS` deliberately excludes `movement`, because a tracks board played as
a `circuit` is a pairing `validateGame` refuses and the menu would be offering a
choice that silently falls back to Classic. Nothing stops the *other* direction
being reachable, though: `winCondition: 'roundLimit'` with `roundLimit: 0` is a
game with no limit and no knockout ending either, and the settings screen will
happily let you build it.

The screen does not validate a combination before starting. It should — the
check exists (`validateGame`) and the screen has the resolved rule set in hand —
so a refused combination could be a row that says why instead of a game that
quietly plays something else. Small, and not written.

### The playtest harness assumed a 40-tile board

*Found and fixed in M11.*

`tools/playtest.mjs` checked `position >= 0 && position <= 39` — the one place
"never write 40 for the board" was broken, and it survived four milestones
because every board that shipped was 40 tiles or fewer. Ultimate Monopoly's 120
failed a perfectly good run.

It asks `__forge.board()` now, which reports the size, the tracks and which
squares charge a tax. The tax list is there for the same class of reason: the
"jackpot rule is on but the pot is empty" assertion is only meaningful once a tax
has actually been charged, and on a 120-tile board with two tax squares eleven
rounds can pass without anybody meeting one.

The general lesson is worth keeping: **the harness is the last place a hardcoded
board constant hides**, because nothing type-checks it.

### A game cannot add state to a player

*Found in M11, by trying to add Ultimate Monopoly.*

`Player` holds cash, a position, deeds, jail state and Get Out of Jail Free
cards, and there is no way for a game to add a field to it. `game/Snapshot.ts`
would not know to save one either, so even a game that reached in and set a
property would lose it on a reload.

That single gap is why six of Ultimate Monopoly's rules ship reduced. Each is a
thing a player *holds*:

- **Travel vouchers** (bus tickets) — drawn, kept, played on a later turn.
- **Stock certificates** — bought at the Stock Exchange, paying dividends
  whenever anybody lands there.
- **Roll Three cards** — every player holds three numbers; landing on the space
  rolls against everybody's.
- **A facing** — Reverse Direction turns you round for your *next* turn.

What ships instead is written in the ROADMAP's M11 table and commented at each
handler. None of them is wrong to have shipped — a rule spent at once is still
that rule's flavour — but none of them is the printed rule either.

The fix has a shape: `Player.extras: Record<string, unknown>` captured and
restored wholesale, with a game declaring what it puts there. It is not written,
and the interesting question is whether the *bot* can be taught to value a held
thing it has never heard of. Ask before building it.

### Nothing can ask a player to pick a tile

*Named in M8b, and it now has three customers.*

There is no prompt that says "choose a square" and no bot policy that could
answer one. It stopped the speed die's official triples rule ("roll a triple and
move anywhere"); in M11 it also stopped Ultimate Monopoly's **Subway** ("travel
to any space on your next turn") and its **Auction** space ("pick an unowned
property for the banker to auction").

Both shipped as deterministic reductions — the next unowned property, and the
dearest unowned property — which are defensible and are not the rule. Any modal
that waits for a click waits for ever on a bot's turn, so the prompt and the bot
policy are one job, not two.

### A tile cannot see the dice that brought a player to it

*Found in M11.*

`Tile.onPass(playerId)` and `Tile.onLand(playerId)` get an id. `tile:effect`
handlers get the landing context, which includes `dice`, so a *landing* can read
the roll — but a **pass** cannot, because `announcePassing` walks the path
calling `onPass` with nothing else.

Ultimate Monopoly's Pay Day pays "$300 if you rolled an odd number or $400 if
even", passing or landing. What ships pays $300 for passing and $400 for
stopping, which is the same pair of numbers keyed off the wrong thing. Widening
`onPass` is easy; deciding whether *every* tile should get a context on every
step of every walk is the part worth thinking about.

### A game can bring artwork, but only for a texture that already exists

*Added in M9b:* `Game.assets` maps texture key → URL and replaces a drawn
texture. Pocket ships two SVGs, drawn by hand for this repo, and the playtest
asserts they arrive.

What it cannot do is add a texture the renderer does not already ask for — there
are exactly eleven keys (`house`, `hotel`, and eight `token_*`), so a game cannot
supply, say, a picture for the middle of its own board. That needs the renderer to
ask a game what to draw rather than a game replacing what it draws, which is the
same shape as `registerTileDecoration` and would be the way to do it.

Nor is there an asset *budget*: a game that brought a 4MB texture would simply be
slow to start, and nothing says so.

### The games that are not Classic are unbalanced

Roundabout and Orbits exist to prove the geometry is not hardcoded, and their
tiles were written to fill a shape rather than to play well: rent ladders are
derived from price by formula, and neither has been balanced. Orbits in
particular is odd on purpose — the circuit spirals inward across three rings and
then jumps back out to GO.

Speed Die inherits the classic board and is unbalanced in a different way, and
the simulator can now put a number on it: median 162 turns against Classic's 257,
and the bank runs out of houses in 19% of games against Classic's 7%. A third die
makes every lap shorter without anything else changing, so rent arrives faster
than the salary does.

Only Roundabout has had a balance change made to it (an eighty-round limit, M8d).
Classic and Speed Die were left alone deliberately: the classic game is the
reference implementation this engine exists to be able to express, and balancing
it away from the printed rules would make it a worse reference.

Pocket (M9b) is the one game *designed* against the numbers rather than balanced
after the fact — forty rounds, chosen so the limit decides 78% of games and a
knockout the other 22%.

Ultimate Monopoly (M11) came out of the box in better shape than any of them —
median 63 rounds, nothing unfinished in 200 games, the most even spread of wins
by seat on any board here — but its rents are **derived, not transcribed**. The
printed game puts them on 64 title deeds that are not in the reference material,
so every lot outside the classic middle track charges `price / 12` scaled up the
usual ladder. Consistent, plausible, and certainly not the designer's numbers.

### The no-auction house rule is still untested

*Fixed in part:* `npm run playtest -- --house-rules` plays with the Free Parking
jackpot and the double GO salary on (`?houseRules=` selects them, the same way
`?map=` and `?variants=` work), asserts the game is really playing them, and
fails if the jackpot never takes a penny — or if the pot fills with the rule
*off*, which would be the more interesting bug.

`noAuction` is left out of that run on purpose: it would switch off the auction
step the same run depends on. Testing it needs a second pass with a different set
of assertions.

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

### The scene's turn-end delays are still tuned by feel

*Narrowed twice.* In M4 the *rent* left the scene for `game/Rent.ts`. In M8d
everything a landing **costs** left for `game/Landing.ts` — quoting, settling,
potting a tax, drawing a card, paying what a free landing pays — because the
headless runner needed the same rules and the alternative was a second
implementation of them inside the simulator.

What is left in `GameScene` is genuinely presentational: `safeEndTurn(300)`,
`(400)`, `(700)`, `(800)` are how long a person is given to read what happened,
picked against animation lengths. The simulator has none of them and ends a turn
the instant its landing returns, which is the evidence that the *rules* no longer
depend on the timing. Changing an animation's duration can still reorder what a
watcher sees; it can no longer change the result.

### A turn's phases are a list; the path between them is not

`TurnFlow` made the phases of a turn data — named, ordered, insertable — and
`TurnManager` enters them through one method. What is *not* data is the wiring
between the six built-in ones: `WAITING_FOR_ROLL → ROLLING → MOVING` is still
`rollDice` calling `movePlayer`, and `MOVING → LANDING` is still `GameScene`
calling `resolveLanding()` when its tween finishes. Those six are marked `driven`
for that reason, and a rule set can hang behaviour on them but cannot re-route
between them.

The consequence to know about: a phase a rule set adds runs on the way to
`END_TURN` *wherever the turn happened to be*, including a turn that ended with no
move at all (a jailed player staying put). A handler that only makes sense after a
landing has to check for itself.

### Only one game can be loaded at a time

*Fixed in M9a*, as far as it goes: five of the six registries are scoped to the
loaded game, so two games cannot get each other's tile types, card effects, turn
orders, win conditions or variants. `loadGame` resets to the built-ins and applies
that game's own.

What that buys is **serial** isolation — one game live at a time. Nothing lets two
be loaded at once, and a batch runner that wanted to interleave games rather than
run them in blocks would need the registries to become instances rather than
singletons. `games/scope.ts` is the seam where that change would go, and it says
so.

`registerTheme` is deliberately outside the scoped set: a colour collision is not
a correctness problem, `themeById` already falls back, and scoping it would make
`games/` import `ui/` for no gain.

### A panel updates in place; the board does not

*Fixed for the panels (M8c):* all three draw onto a `Surface` (`ui/Retained.ts`),
so a view that has changed writes to the elements already on screen and only what
has genuinely gone is destroyed. Hover survives a redraw, and a button's listener
is registered once for the life of the panel.

The board is still the other way round: `BoardRenderer.refresh()` clears the state
layer and re-creates every owner band, house and mortgage mark on every change.
That is a smaller list than a panel's and it is redrawn far less often — but it is
the same pattern, and the machinery to fix it now exists.

### The turn log cannot be exported

*Fixed:* `Notification` keeps every entry (up to 500) and the drawn strip is a
*window* onto them — the wheel scrolls back over the log, and a marker says how
far. Nothing is destroyed on the way past the bottom any more, and the history is
readable through `__forge.log()`, which the playtest now uses to count what the
bots did.

What is missing is a way to get it *out*: no copy button, no download, and
nothing is written to disk. A player who wants the record of a game after closing
the tab still has nothing.

### The HUD is drawn once and never re-themed

*Fixed in M8c:* `TradePanel` measures its deed list, and because that moves its
buttons, it reports where they are (`__forge.tradeSpots()`) instead of the harness
holding a copy — three entries left `HOTSPOTS`.

What is left is when the theme can change: it is read at boot and when the menu's
chip is clicked, and everything drawn after that takes it. Nothing re-themes a
*running* game, so switching mid-game is not offered rather than being offered and
half-working. The pieces and the buildings are baked textures and would need
re-baking; the HUD, the buttons and the board's static layer are drawn once at
`create()` and would need rebuilding.

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
