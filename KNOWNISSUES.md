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

### The bots are a baseline, not a challenge

The policy is deliberately plain: a flat $150 reserve, a bid ceiling of 1.2× face
value (1.7× for a deed that completes a group), build the cheapest complete group
it can afford. It does not count what rent it is likely to face, weigh position on
the board, or plan more than one purchase ahead. It is something to play against
and something for M8d to measure a better policy against.

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

### The alternative boards are test boards

Roundabout and Orbits exist to prove the geometry is not hardcoded, and their
tiles were written to fill a shape rather than to play well: rent ladders are
derived from price by formula, and neither has been balanced. Orbits in
particular is odd on purpose — the circuit spirals inward across three rings and
then jumps back out to GO.

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

### Landing side effects are scattered across scene event handlers

Every tile emits a bus event and `GameScene` decides how long to wait before
ending the turn (`safeEndTurn(300)`, `(400)`, `(700)`, `(800)`, `(100)`). The
delays are tuned by feel against animation lengths rather than sequenced from
completion callbacks, so changing an animation duration can reorder events. It
has been stable across long playtests, but it is timing-coupled by construction.

*Narrowed in M4:* how much rent a tile charges is no longer among those side
effects — it moved to `game/Rent.ts` and is unit-tested. What remains in the
scene handlers is the sequencing: who pays whom, when, and how long to wait.

**Scheduled into ROADMAP 8d**, not because it is small but because that is where
it stops being optional: a headless runner has no tweens to wait for and no clock
to wait on, so the sequencing has to come from completion rather than from a
delay before the simulator can run a game at all. Fixing it earlier would be the
same work done twice.

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

### A panel that *has* changed is still rebuilt from scratch

`PropertyPanel` and `TradePanel` skip the work when the incoming view matches the
one they last drew (M6), so the common case — `refreshPanel()` on every turn
change, with nothing actually different — costs nothing. A view that has genuinely
changed still calls `removeAll(true)` and re-creates every child: roughly 120
objects for the trade panel's two deed lists. Not measurable at this size, and
updating in place is the same problem as drawing a theme, so it waits for M8c.

### The turn log cannot be exported

*Fixed:* `Notification` keeps every entry (up to 500) and the drawn strip is a
*window* onto them — the wheel scrolls back over the log, and a marker says how
far. Nothing is destroyed on the way past the bottom any more, and the history is
readable through `__forge.log()`, which the playtest now uses to count what the
bots did.

What is missing is a way to get it *out*: no copy button, no download, and
nothing is written to disk. A player who wants the record of a game after closing
the tab still has nothing.

### The trade panel's layout is fixed, not measured

`TradePanel` reserves 11 deed rows per side whatever the players actually hold,
so a two-deed trade shows a lot of empty space, and everything below the list
hangs off constants derived from that. It also means the harness's `HOTSPOTS`
entries have to be recalculated by hand whenever the layout constants change.

**Scheduled into ROADMAP 8c**, with the panel rework above it: measuring the list
and updating a drawn panel in place are the same job on the same three files, and
both change the constants the harness's hotspots hang off. Doing them separately
means recomputing those hotspots by hand twice.

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
