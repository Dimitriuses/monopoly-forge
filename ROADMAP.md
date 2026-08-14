# Roadmap

Where Monopoly Forge is going. Defects that exist *today* are listed separately in
[KNOWNISSUES.md](KNOWNISSUES.md); this file is about work not yet done.

**Status:** active. **The classic game is playable end to end, on your own, and it
can be put down and picked up again.** M3 put ownership on the board and made
houses, hotels and mortgages reachable, M4 closed the card, jail and rent rules
behind them, M5 added the multiplayer half — auctions, trading and a bankruptcy
that settles an estate — M6 finished the presentation with save/load, working
house rules, a turn log, tokens and sound, and M7 added opponents worth playing
against. A seeded game runs with no console errors (`npm run playtest`), which
also saves, reloads the page and resumes; `--bots` hands every seat to a bot and
watches them play it out.

**M8 — the engine — is done.** The board is a file (8a), the rules are registries
rather than switches and a turn is a list of phases a rule set can add to (8b),
presentation is a theme object (8c), and `npm run simulate` plays a game a
thousand times with no renderer, checking six invariants after every turn (8d).
The simulator found two real bugs on its first two batches, and one thing about
the game itself: Monopoly does not always terminate, which is why "every game
reaches a winner" is *not* one of the invariants it checks.

**M9 gives the parts somewhere to live together, and it is done.**
`src/games/<id>/` is one folder, one playable thing, picked as one choice. Five
ship: the classic board, a circle, a three-ring spiral, the classic board with
the speed die, and **Pocket** — the classic board with its utilities swapped out,
a trimmed deck, a round limit and its own artwork, which is the worked example
[the authoring guide](docs/authoring-a-game.md) is written around. A game can be
composed from one that already exists, and can bring artwork without the repo
carrying any.

**M11 was not planned, and that is the point.** Ultimate Monopoly — a fan-made
board of 120 tiles across **three loops** joined by transit stations — was picked
as a stress test precisely because it was designed by somebody else, for a table,
with no thought for this engine. It found the one assumption every milestone so
far had shared: *a board is a circuit*. `rings` was only ever an arrangement, and
`Board.move` was `(from + steps) % size`. Fixing that, and the three smaller walls
behind it, is M11, and it is done. What Ultimate Monopoly still *cannot* have is
the more useful half of the answer, and it is all one thing: **a game cannot add
state to a player.**

**M12 is the plan that came out of it** — four engine gaps, each with at least
three customers already in the tree, and each named by what it unlocks rather
than by what it generalises. Not started.

**M10 is refinement**, and it is under way — the corners this implementation
knowingly cuts, the things a player asks for, and a bot worth playing against.
**10d is done**: both menus are a tree rendered from one component, saving moved
into a pause screen where a dead row can say why, and the Game Settings screen is
*generated* from metadata beside the rules rather than laid out by hand.

**Why the classic game came first.** A configurable engine whose only consumer is
a toy proves nothing. M1–M7 build the game the engine has to be able to express;
M8 generalises it. Some of that groundwork was deliberate from the start — a
Phaser-free core, an event-decoupled renderer, data-driven tiles — and some of it
was cheaper done early, which the sequencing note at the end explains.

---

## M3 — Ownership and development · done

- [x] **Draw ownership on the board.** An owner-coloured band on each owned tile's
      rim edge, carrying the owner's seat number, plus an `M` on a mortgaged tile.
      Drawn by `BoardRenderer.refresh()`.
- [x] **Property detail panel.** Click any tile: rent ladder with the tier it
      currently charges highlighted, house cost, mortgage and redemption values,
      owner, and whether the colour group is complete. `src/ui/PropertyPanel.ts`,
      in the column that used to be dead space between board and HUD.
- [x] **Build houses and hotels.** The two missing rules now live in
      `src/game/BuildRules.ts`: you must own the whole colour group (and none of
      it mortgaged), and buildings must stay within one of each other going up
      *and* coming down. `Bank` still does the cash and inventory and asks no
      questions — it has no view of the board — so anything that builds must go
      through the rule check first.
- [x] **Mortgage / unmortgage UI.** In the same panel, including the rule that a
      colour group with buildings on it cannot be mortgaged.
- [x] **Render houses and hotels.** `BootScene`'s `house` and `hotel` textures are
      drawn along each lot's colour stripe, on whichever side of the board it sits.

Three gaps found while building it are listed in KNOWNISSUES and scheduled above:
rent not doubling on an unimproved complete group (M4), building being offered
only on the owner's own turn and the hotel sale blocked by a house shortage (both
M5, which brings the machinery they need), and the panel rebuilding itself on
every refresh (M6).

## M4 — Cards, jail and rent edge cases · done

- [x] **Fix the `goBack` animation direction.** `player:move` carries
      `direction: 1 | -1`, and `moveTokenStepByStep` walks
      `board.move(from, s * direction)`. Verified against the real canvas: the
      token now walks 7 → 6 → 5 → 4 instead of travelling forwards to 10 and
      snapping back.
- [x] **Real "nearest railroad" / "nearest utility" cards.** A new
      `advanceToNearest` action scans forward from where the player stands
      (skipping the tile they are on), so it needs no hard-coded index and works
      on any map. Chance `ch4` is the railroad, `ch5` the utility — which also
      ends `ch5` duplicating "Advance to Reading Railroad".
- [x] **The rent a card imposes.** Arriving by card charges double on a railroad
      and ten times the dice on a utility however many the owner holds. The rule
      travels as a `rent:modifier` event emitted before the move and is consumed
      by the landing it causes; it is cleared at `turn:start` so it can never
      leak into another turn.
- [x] **Get Out of Jail Free cards return to the bottom of their deck** when
      spent. `Player` holds the card itself rather than a tally, `jail:exit`
      carries it out, and `CardDeck.owns` tells `GameScene` which deck to put it
      under. They are no longer withdrawn from the game.
- [x] **Double the rent on an unimproved colour group** — the gap M3's panel made
      visible by showing `★ Group complete` on a group charging single rent.

Rent resolution moved out of `GameScene` and into `game/Rent.ts` to make those
last two rules testable: `quoteRent` is where a railroad, a utility or an
unimproved monopoly works out what it charges, and it runs in plain Node.

## M5 — Multiplayer interaction · done

- [x] **Auctions.** Declining a property now puts it under the hammer:
      round-robin bidding, a pass forfeits for good, and a per-bidder clock that
      passes for anyone who runs it out. `game/Auction.ts` owns the rules and
      knows nothing about the clock; `ui/AuctionPanel.ts` owns the clock and
      knows nothing about the rules. The `noAuction` house rule — declared since
      M1 and read by nothing — now keeps the old leave-it-unowned behaviour.
- [x] **Trading.** `game/Trade.ts` validates and applies a two-sided offer over
      deeds, cash and jail cards; `ui/TradePanel.ts` builds it. Propose, accept,
      decline and counter (which is just the offer reversed and handed back).
      Cash is netted, so neither side needs to front the gross, and a lot whose
      colour group has buildings on it cannot be traded at all.
- [x] **Let players manage their estate outside their own turn.** The property
      panel now offers its buttons to the tile's *owner* rather than to whoever
      is rolling.
- [x] **Proper bankruptcy settlement.** `game/Estate.ts`: a debt is paid from
      cash, then by selling buildings (tallest lot first, which is also what the
      even-selling rule wants) and mortgaging deeds (largest first, so the fewest
      change hands), and only then does the player go under — at which point the
      whole estate, jail cards included, passes to the creditor. Rent, tax and
      card debts all route through it, so the win condition finally means
      something: the last solvent player wins.

Not done, and moved to M6: auctioning houses when the bank runs short of them.

## M6 — Polish · done

- [x] **Save and load.** `game/Snapshot.ts` is the deserialiser that was missing:
      `captureGame` / `restoreGame` carry ownership, buildings, mortgages, cash,
      jail state, bank stock, the Free Parking pot, both deck piles in order, the
      house rules and — the easy one to get wrong — the PRNG *stream position*,
      so a resumed game rolls what the saved one would have. SAVE sits under the
      board; the menu offers CONTINUE when a readable save exists. A restore
      resumes at the start of the saved player's turn, which is why saving is
      refused mid-animation, mid-auction or mid-trade.
- [x] **Finish the house rules.** All three now do something: the Free Parking
      jackpot pools taxes and fines and pays whoever lands there,
      `doubleGoSalary` pays twice for landing exactly on GO, and `noAuction` was
      done in M5. The menu has switches for them. `speedDie` was **deleted**: it
      is not a flag but a variant — a third die, two new face effects and a
      changed turn structure — and belongs with the rule sets in M8b.
- [x] **Fill the right-hand column, and stop toasts covering the roll button.**
      Both at once: `Notification` became a turn log living at x=770–1040,
      y=496–786, under the property panel and clear of every control. Entries
      arrive at the top, push older ones down and fade with age instead of
      vanishing, so the last dozen events stay readable.
- [x] **Sound effects and a proper token.** `ui/Sfx.ts` synthesises seven short
      effects with Web Audio — no audio files, matching the repo's no-assets
      policy — with a mute button. `BootScene` now bakes a disc-and-emblem
      texture per token type into a RenderTexture, and each piece carries its
      seat number in the corner so a token matches its owner band on a tile.
- [x] **Stop rebuilding a panel that has not changed.** `PropertyPanel` and
      `TradePanel` now compare the incoming view model against the one they last
      drew and return early when it matches. That covers the case that actually
      recurred: `refreshPanel()` fires on every turn change, and since M5 the
      buttons belong to the tile's *owner* rather than to whoever is rolling, so
      the view is usually identical from one turn to the next — and rebuilding it
      dropped the hover state under the player's cursor. `AuctionPanel` is
      deliberately excluded: its `show()` also restarts the bid clock.
      Diffing a view that *has* changed, rather than redrawing it, moved to M8c —
      it is the same work as a themed renderer and worth writing once, there.
- [→] **Auction the houses when the bank runs short** — moved to **M8b**.
      Not a scheduling dodge; the rule does not fit the interaction model yet.
      It exists to settle *simultaneous* demand ("if two or more players wish to
      buy more than the Bank has"), and a turn-based click UI never produces any:
      players ask one at a time and turn order settles it. Implementing it needs
      two things this build has no place for — a notion of who *else* wants a
      house right now, which only a rule set (or the M7 bot) can express, and a
      step where the winner nominates the lot to build on. `Auction` would also
      have to bid on an arbitrary subject rather than a tile id. All three are
      M8b's work. Today's behaviour is recorded in KNOWNISSUES.

## M7 — Opponents you can play against · done

Bots for the *demo game* first: something a single player can sit down and finish
a game against. The simulation platform that runs thousands of games is M8d — but
these bots are the ones it will run, so the decision layer was built to be reused
from the start.

- [x] **A bot that plays the real game.** Seats are set to 🤖 Bot or 🙋 Human on
      the menu, and seats 2+ default to bots so a single player can just start.
      Bots roll, buy or decline, bid in auctions, answer a trade, choose how to
      leave jail, redeem mortgages and develop a group — all through the same
      rules the buttons drive. The roll button greys out on their turn, and their
      drawn cards close themselves.
- [x] **A decision interface the simulator can reuse.** `game/Bot.ts` is
      Phaser-free and deterministic: given the same state it answers the same way
      twice, and it draws no randomness at all, so it cannot shift the dice
      stream out from under a seeded game. It answers questions — *buy this? bid
      how much? build where? accept this offer?* — and `GameScene` applies the
      answers. Nothing in it touches a button, a tween or a scene.
- [x] **Bots are game state.** `Player.isBot` is captured in the snapshot
      (`SNAPSHOT_VERSION` 3), so a saved game resumes with the same seats.
- [x] **A bot-driven playtest.** `npm run playtest -- --bots` hands every seat to
      a bot and watches: it fails if they stop playing, and reports the game if
      one of them wins outright.
- [ ] **Extend the playtest harness** to assert on richer invariants (total cash
      conservation across the whole table, deck census over a long game). Moved
      to **M8d** — those are batch invariants, and checking them once per run is
      far weaker than checking them across a thousand games.

## M8 — Monopoly Forge as an engine · the destination

Turn the game into something that *runs* games: bring your own map, rules and
artwork, and never edit engine code to do it. Each item below names the code that
currently prevents it, so none of this is an estimate.

### 8a — The board stops being 40 tiles in a square · done

- [x] **Take board length from the map.** Done alongside M3. `Board` takes a
      `TileDefinition[]` (defaulting to the classic one), publishes `board.size`,
      and every wrap goes through `move` / `stepsBetween`. The `BOARD_SIZE`
      constant is gone rather than read.
- [x] **Name the anchors.** `Board.anchor('start' | 'jail' | 'goToJail')` resolves
      a role to an index by scanning the map; `TurnManager`, `CardEffects` and
      `GameScene` all ask for the role. A map without a jail says so
      (`tryAnchor` → `null`) instead of silently meaning tile 10.
- [x] **Stop assuming a square.** `game/BoardLayout.ts` takes a shape a map asks
      for and returns coordinates: `square` (the classic four corners and equal
      sides), `ring` (one circle, any number of tiles) or `rings` (concentric
      circles the circuit is dealt into). The idea that makes it work is that
      **every tile is a rectangle in its own frame with the board's interior past
      its local top edge** — a bottom-row tile is that frame unrotated, a left
      column tile is the same turned 90°, and a tile on a circle is turned to
      whatever angle points it at the centre. `BoardRenderer` draws all of them
      through one path with `translateCanvas`/`rotateCanvas`, so a stripe, a
      house, an owner band and a click zone all follow the tile round.
- [x] **A map is a file.** `src/maps/` holds `GameMap` (tiles plus the shape they
      are laid out in), `validateMap`, and three boards: the classic 40-tile
      square, a 24-tile circle, and 30 tiles across three concentric rings. The
      menu picks between them and `?map=<id>` preselects one. The classic board is
      no longer *the* board — it is `src/maps/classic.ts`, the first map that ships.
      `validateMap` refuses a map rather than half-drawing it: ids that do not
      match the circuit, a missing `go` or `jail`, a colour group with one lot or
      with lots that disagree on the house cost, a property with no rent ladder, a
      shape its tile count cannot make, rings that do not add up or that would
      overlap. It caught four real mistakes in the two test boards on their first
      run.

### 8b — Rules become registrable instead of switch statements · done

- [x] **Tile-type registry.** `tiles/registry.ts`: `registerTileType(name, factory)`
      and `createTile`. `Board`'s constructor no longer knows what a tile is — it
      asks. The ten built-ins register themselves, `TileType` stays a named union
      *and* accepts a string so a new type still typechecks, and an unregistered
      type is refused by name rather than silently skipped.
- [x] **Card-effect registry.** `cards/effects.ts`: `registerCardEffect(name, handler)`,
      with the eleven built-ins moved into it. `CardEffects.execute()` looks the
      handler up and hands it a small context (board, bank, players, and the three
      moves an effect needs) rather than the whole instance. A game can add an
      effect, or replace a built-in, without touching the engine.
- [x] **Decks belong to a map.** `GameMap.cards` carries them, `validateMap`
      refuses a deck whose cards name tiles the board does not have or look for a
      tile type it lacks, and both alternative boards ship a map-agnostic deck of
      their own. The classic decks are the fallback.
- [x] **A real rule set.** `game/Rules.ts`: starting cash, GO salary, jail fine and
      term, doubles-to-jail, the house and hotel supply, and how many houses a
      hotel is worth — resolved as *classic → the map's → the player's switches*
      and reached through `board.rules`. Roundabout pays a smaller salary for a
      shorter lap; Orbits runs on 24 houses and 8 hotels. The rule set is saved
      with the game, so a resumed save plays by the rules it was played under.
The last four were one piece of work and three things waiting on it, and they are
listed in the order they were actually built.

- [x] **1 · Generalise the turn structure.** `game/TurnFlow.ts`. A turn is a
      **list of named phases** now, not an enum walked by hand: `insertAfter` puts
      a step into one, `replace` swaps a step's behaviour, and `TurnManager`
      enters them through a single method that announces `turn:phase`. A phase may
      `hold()` the turn and be picked up again with `resume()`, which is how a
      step that waits for somebody is written without a scene. **Turn order and
      the win condition came with it** — both are registered strategies named by
      the rule set (`'seat'`, `'reverse'`; `'lastSolvent'`, `'roundLimit'`), for
      the same reason tile types are: a rule set is saved with the game, and a
      function does not survive `JSON.stringify`. Rounds are counted and saved,
      because a round limit cannot be re-derived.
      *Was last on this list; moved first because the three below all wait on it.*
- [x] **2 · The `speedDie` variant** dropped in M6 — and the acceptance test for
      item 1, because if it could not be written without opening `TurnManager` the
      pipeline was not finished. It was: `game/SpeedDie.ts` supplies its own
      `Dice` and inserts a `SPEED_BONUS` phase, and `TurnManager` never learned
      what a speed die is. Mr. Monopoly moves you on to the next deed that is not
      already yours — unowned and you get the buy prompt, owned and you pay,
      which is one rule where the official text is two. The bus takes you to the
      next card tile. The picture faces add nothing to the total, doubles still
      come from the two white dice, and the extra step `hold()`s the turn while
      the token walks exactly as a card's move does.
      Not implemented, and recorded in KNOWNISSUES rather than half-built: the
      official *triples* rule (move anywhere — needs a pick-a-tile prompt that a
      bot then also owes an answer to) and "not until you have been round once".
- [x] **3 · `Auction` bids on a subject, not a tile id.** `AuctionSubject` is a
      `kind`, an `id` and a label; `tileSubject()` is the ordinary case. It also
      gained a **reserve**, because a contested house must not sell for less than
      the printed price — scarcity making houses *cheaper* would be a strange
      rule. The second consumer this unblocks, auctioning a bankrupt estate deed
      by deed, is still open in KNOWNISSUES, but it no longer needs a second
      implementation of round-robin bidding.
- [x] **4 · Contention, and auctioning scarce houses** (moved from M6, open since
      M5). `game/Contention.ts`. What made it writable was deciding what "wishes
      to buy" means without a prompt: **a player who owns a lot the build rules
      would allow a house on, and can afford it, is bidding.** That is a pure
      function of the board — so it needs no new prompt, no answer `Bot.ts` cannot
      give, and the simulator gets the rule for free. When two or more such
      players exist and the bank holds fewer houses than they do, the next house
      goes under the hammer at a reserve of what it is worth to the cheapest
      claimant, and the winner pays their bid instead of the printed price.
      The winner does not *choose* the lot: whoever asked for the house gets the
      one they asked for, anybody else gets the cheapest they could legally build
      on. Choosing needs a prompt, and the deviation is in KNOWNISSUES.
      `houseAuctions` is on in the classic rules, because it *is* the classic rule.

### 8b's leftovers, and what closed them

Everything above is done. The last three items had all been waiting on the phase
pipeline, and each took a few hours once it existed — which is the argument for
having reordered them rather than working down the list as written.

One thing they shared: the hard part of every one was **not** the mechanism. It
was deciding what a rule means when there is nobody to ask. "Wishes to buy a
house", "which lot the winner builds on", "what a bus face does on a board with
no Chance tiles" — each is a decision, each is written down in the file that makes
it, and each is a line in KNOWNISSUES where it departs from the printed rules.

### 8c — Presentation becomes a theme · done

- [x] **Extract `BoardRenderer`.** Done alongside M3, before the ownership and
      building work went in — `src/ui/BoardRenderer.ts` owns everything inside the
      board square, `GameScene` owns the tokens, buttons and wiring.
- [x] **Use the asset pipeline** `BootScene` half-provides. Done in M6: the
      `house` and `hotel` textures are drawn on the board, and the `token_*`
      textures — unused since M1 — are now baked per token type and drawn as the
      pieces.
- [x] **A theme object.** `ui/Theme.ts`: the board's ground, outlines and labels,
      the colour groups, the token colours, the panel palette, the chrome around
      it all, and the turn log's stripes — one object, registered by name and
      reached through `theme()`. `GROUP_COLORS` and `TOKEN_HEX` are gone rather
      than moved. A theme is *not* in the save file and not in `GameRules`: a game
      is the same game whatever colour it was played in, and a person who prefers
      one palette should not have it restored to somebody else's on load. Two
      ship — **Classic** and **Parchment** — and the second one exists to catch
      what one theme hides; a test refuses a token or a colour group that only
      one of them has a colour for.
- [x] **Per-element draw overrides.** `ui/TileDecor.ts`:
      `registerTileDecoration(type, fn)`, handed the tile's own frame — origin at
      its middle, already rotated, the board's interior past its top edge — which
      is what makes a decoration written once correct on a square, a circle and a
      three-ring spiral. A lot's colour band is now one of these rather than a
      branch in the renderer, and the nine other built-in types gained a glyph
      where a lot has its stripe. A type nobody decorated still draws.
- [x] **Diff a panel instead of redrawing it** (moved from M6). `ui/Retained.ts`
      is a `Surface`: elements have names, a render writes to whatever is already
      there, and only what the pass did not ask for is destroyed. All three panels
      draw onto one. A button's *listener* is registered once and its handler
      lives in a slot the surface rewrites, so hovering keeps working when the
      view changes under the cursor and nothing accumulates.
- [x] **Measure a panel's list instead of reserving it** (moved from KNOWNISSUES).
      `TradePanel` sizes its deed list to what the players actually hold, and its
      whole layout follows from that. Which means the buttons move — so the panel
      **reports where they are** (`spots()`, published as `__forge.tradeSpots()`)
      and the playtest asks, exactly as it already asks a tile for its centre.
      Three entries left the harness's `HOTSPOTS` table and the note warning that
      they had to be recomputed by hand went with them.

### 8d — A simulation platform · done

Running the game thousands of times without a renderer, driven by M7's bots. This
is where a rules engine stops being a claim and starts being measurable — and it
was, on the first two batches, the fastest way to find the rule bugs a hand-played
game never reaches:

- **A card left the game.** A bankrupt player's Get Out of Jail Free cards were
  destroyed rather than returned to their deck. Caught by the deck census in the
  first hundred games: *"15 cards accounted for, 16 were dealt."* Enough
  bankruptcies would have emptied a deck.
- **Speed Die was not playing with the speed die.** The runner resolved
  `game.rules` and nothing else, so `Game.variants` was dropped — and the batch
  reported numbers *identical* to Classic's, which is what gave it away. Both
  drivers assemble a rule set through one `rulesFor` now.
- **Monopoly does not always terminate.** About 5% of Classic games run past a
  6,000-turn cap; one, followed to 60,000 turns, had four players holding
  5/6/6/11 deeds, no monopoly, no houses, and £1.4M on the table. Rent never rises above
  the salary, so nobody can go under. That is a property of the game rather than
  a bug in it, and it is why the roadmap's "every game reaches a winner" is not
  implemented as an invariant.

**Runs after M9a**, which is not a scheduling preference — see the note under M9.
The short version: every registry in this engine is a module-level `Map`, and
8d's whole premise is many games in one Node process. Two games that each
register a `tollBooth`, or each replace `collectFromBank`, tread on each other
silently, and the failure mode is a simulation result that is *wrong* rather than
one that crashes. So the runner takes a `Game`, and games own their registrations
before a batch ever loads two of them.

- [x] **A headless runner.** `src/sim/Runner.ts`: a `Game`, a seed and a table of
      players in; a finished game out. It is the *second* driver of the same
      model — `GameScene` is the first — and what the two share is everything
      that decides anything. A hundred games of the classic board take under two
      seconds.
- [x] **Sequence a landing from completion, not from a delay** (moved from
      KNOWNISSUES). `game/Landing.ts` holds what a landing *costs* — quote the
      rent, settle the debt, pot the tax, draw the card, pay what a free landing
      pays. Both drivers call it; what they do not share is timing, which is the
      honest division. `GameScene` still waits a beat so a person can read what
      happened, because its landings are animated. The runner ends the turn the
      instant the landing returns.
- [x] **A batch CLI** — `npm run simulate -- --game classic --games 1000 --seed 1`.
      Game length as a distribution, how often the bank runs out of houses, how
      often nobody ever forms a monopoly, wins by seat. `--policies a,b` seats one
      policy against another, `--round-limit N` bounds a batch by a rule rather
      than by a cap, and `--json` is for anything that wants the numbers rather
      than the paragraph.
- [x] **Invariant checking across the batch.** `src/sim/Invariants.ts`, run after
      every turn: positions on the board, no negative cash, the two halves of
      ownership agreeing, the building census (bank stock + what is standing =
      what the rule set stocked), the deck census (every card in exactly one
      place), and a bankrupt player holding nothing.
      **Two of the assertions this milestone was scheduled with are wrong, and
      are not implemented.** *Total cash conserved* is not true of Monopoly — the
      salary and half the Chance deck create money and taxes destroy it — and an
      invariant that does not hold is worse than none. *Every game reaches a
      winner* is not true either, which the batch demonstrated: see below.
- [x] **A second policy to measure the first against.** `AGGRESSIVE_PROFILE`:
      almost no cash held back, well over the odds at auction, building the moment
      it can. **It is not better.** Across 576 finished games in both seatings —
      mirrored, to cancel the position effect — baseline took 287 and aggressive
      289. Which is a result: the baseline's three constants were picked by feel
      in M7 and are not where the leverage is. Seat order is worth far more than
      either of them (below).
- [x] **A balance pass** driven by those numbers. One change, made against a
      measurement rather than a feeling: **Roundabout ends after eighty rounds**
      (`winCondition: 'roundLimit'`). 300 games put its median at 27 rounds and
      its 90th percentile at 46, so eighty bounds the tail without touching a
      typical game — and the re-run confirmed exactly that: median unchanged at
      112 turns, longest down from 984 to 384, and the 2-in-300 that ran for ever
      gone. Classic and Speed Die were left alone deliberately: the classic game
      is the reference implementation, and balancing it away from the printed
      rules would make it a worse reference.

### Sequencing — why some of this did not wait

Extracting a renderer gets more expensive with every feature drawn inside
`drawBoard()`, and un-hardcoding the board gets more expensive with every rule that
assumes 40 tiles. M3 was about to add ownership markers, houses and hotels to
exactly those places.

So board length, the anchors and the `BoardRenderer` split were done **first**,
as part of M3, while the surface was small: the ownership and building work then
landed in a renderer that loops over the board once and asks each tile for its
own footprint. That order held up — the refactor changed no behaviour and the
existing tests stayed green throughout, which is exactly what they are for.

8b's registries and the rule set still wait until the classic rules are complete
enough to know what needs to vary.

The same argument reordered 8b's remainder. The phase pipeline was listed last as
"the hardest piece to open up", which was a statement about difficulty, not about
sequence — and difficulty is the wrong axis to schedule on when three other items
are blocked on it. The speed die needs an extra phase, scarce-house contention
needs a phase that polls the table, and turn order and the win condition *are*
pipeline parts. Building any of them first would mean building a private version
of the pipeline inside `TurnManager` and then removing it. So it moved to the
front, and the speed die immediately after it as the proof it works.

The same argument puts **M9a in front of 8d**, and this one is not about cost but
about correctness. Every registry the engine has is a module-level `Map`, which is
harmless while one process plays one game and is not harmless at all when a batch
runner loads three. Two games registering different handlers under one name would
produce a simulation result that is wrong rather than one that fails, and that is
the worst kind of thing to find late. So games own their registrations before
anything runs a thousand of them.

---

## M9 — a game is a folder · done

M8 made the *parts* configurable: a map is a file, rules and turn structure are a
registry, presentation is a theme. What it did not do is give them somewhere to
live together. You can supply a board, and separately a rule set, and separately a
palette — but you cannot hand somebody **a game**.

This milestone is that top level: `src/games/<id>/`, each folder a complete
playable thing, picked as one choice and launched.

### The evidence it was missing — all three now answered

None of these was a matter of taste, which is why they were worth writing down:

- ~~**A map is carrying the economy.**~~ `GameMap` grew a `rules` field and a
  `cards` field in 8b because there was nowhere else to put them, so `ROUND_MAP`
  declared `{ goSalary: 150, startingCash: 1200 }` — a board saying how much money
  you start with. Both moved to the game; a map is tiles and a shape again.
- ~~**The menu asks four questions that are one.**~~ It asks one, and treats the
  other three as overrides. Picking Orbits now brings its economy, its deck *and*
  its palette, which is the first time the menu has been able to say what a game
  is rather than what a board looks like.
- ~~**Every registry is global.**~~ Five of them are scoped to the loaded game.
  `registerTheme` deliberately is not: a colour collision is not a correctness
  problem, `themeById` already falls back, and scoping it would make `games/`
  import `ui/` for no gain.

### 9a — the bundle · **before 8d** · done

Mostly moving things that already existed. The one piece of genuinely new
engineering was the registry scoping, and that is the piece 8d could not have
been built without.

- [x] **`src/games/<id>/index.ts` exporting a `Game`** — `{ id, name, blurb, map,
      rules, cards, variants?, theme?, register? }`. **Four** ship, not three:
      `classic`, `roundabout`, `orbits` and **`speed`** — the classic board with
      the third die. That last one was not planned and is the best argument for
      the whole milestone: two games sharing a map and a deck, one field apart,
      neither a special case in the engine or a switch on the menu.
- [x] **`rules` and `cards` moved off `GameMap`.** `validateMap` is board
      coherence — ids, anchors, group sizes, layout fit. `validateGame` is
      everything that is a statement about a *pairing*: this deck against this
      board, this rule set against what this build has registered.
- [x] **Registration is game-scoped.** `loadGame` resets every registry to the
      built-ins and applies that game's own, so no two can leak into each other.
      The five module-level `Map`s became one `Registry` class with `capture` and
      `restore`. The limit is written down rather than implied: this is *serial*
      isolation — one game live at a time, which is what a batch is.
- [x] **The menu picks a game**, and a game's theme and variants are *defaults* a
      player's own choice outranks. `?game=` replaces `?map=`; the playtest's
      `--map` became `--game`.
- [x] **`SNAPSHOT_VERSION` 7 stores `gameId`.** Old saves are refused, which
      `validateSnapshot` already did gracefully.

### 9b — authoring · **after 8d** · done

Deliberately after, because 8d is what tells an author their game is unplayable,
and because guessing at these would have been guessing without that.

- [x] **Per-game assets.** `Game.assets` is texture key → URL, keyed on the names
      the renderer already asks for — so supplying one *replaces* a drawn texture
      and nothing needs a second lookup path. Loaded in `GameScene.preload`, and
      the bakers step aside for anything a game supplied so a theme change cannot
      paint over it. The default stays **no assets at all**, which is what keeps
      the repo free of third-party art.
- [x] **Composing a rule set, not just overriding one.** `games/compose.ts`:
      `deriveMap` + `replacingTypes` for a board like another one, `withoutCards`
      and `portableCards` for a deck. One rule shapes it — a derived board keeps
      its **length and its ids**, because removing a tile would renumber the
      circuit and break every card that names a square. So "no utilities" is a
      board where each utility is something else.
- [x] **Authoring documentation** — [docs/authoring-a-game.md](docs/authoring-a-game.md),
      written against the simulator, with a section on reading a batch: what
      `unfinished`, `built at end`, `decided by` and `wins by seat` are telling
      you about a board you just wrote.

**Pocket** ships as the worked example, and is a real game rather than a demo:
the classic board with the utilities swapped out, a deck trimmed to match, a
forty-round limit and its own artwork. It is the only game that uses every part
of M9, which is why the guide is written around it.

Two things fell out of writing it, both recorded in DEVLOG:

- The engine *made* the deck get trimmed. Swap the utilities out and
  `validateGame` refuses the classic deck — one of its cards advances to the
  nearest utility — which is the check earning its place.
- **A game could not turn a house rule on.** The menu sent all three booleans
  explicitly every time, so its `false` beat the game's `true` and Pocket
  silently played without the Free Parking jackpot it asks for. Found by the
  playtest printing "jackpot rule off" for a game that asks for it on.

### The open question, recorded rather than settled

**Modules or data?** A game folder of TypeScript modules is typechecked,
importable, needs no loader, and keeps every guarantee the engine has now. A
folder of JSON is what "users create a game" really implies — authorable with no
build step — but needs a schema and a runtime validator to be safe.

9a starts with modules, because the validator that data-driven loading needs is
the same one `validateGame` has to be anyway, and writing it against a typed
shape first is the cheaper order. Data-driven loading is its own item when
somebody actually wants to author a game without cloning the repo.

---

## M10 — refinement

Nothing here opens a new seam. Every item is something already written down —
in KNOWNISSUES, or in the deferred list below — that was left because it was not
what the milestone was about at the time. This is the milestone it is about.

It comes last on purpose. Each of these is easier now than it would have been at
any earlier point: the rules are registries, presentation is a theme, a game is a
folder, and there is a simulator to say whether a change to the bots or the
economy actually did anything.

### 10a — the corners the rules still cut · done

Four places where this implementation knowingly departed from the printed rules.
All four are closed, and the one that unblocked two of them was not on this list
at all — see the note below.

- [x] **Mortgage interest.** Charged now on *both* sides: the 10% for taking on a
      mortgaged deed, through a trade, an auction or a bankrupt estate, and the
      10% for lifting one. `chargeMortgageInterest` is written once and called
      from all three transfer paths, and the rate is `rules.mortgageInterest`
      rather than a literal `1.1` — one number governs both halves, and a game
      that sets it to zero turns the whole rule off. It goes through `settleDebt`
      like every other charge, so a creditor who cannot cover the interest on an
      estate they have just inherited mortgages it, or goes under.
- [x] **The speed die's triples rule**, and with it **what a repeated dice face
      means**. The open question is answered the first way KNOWNISSUES offered:
      **a fifth registered strategy.** `game/RollRules.ts` holds `rules.rollRule`
      — a rule returns *what should happen* (`move` / `jail` / `handled`) and
      `TurnManager` does it, so nothing but the turn manager ever moves anybody.
      A variant may now bring rule values with it (`Variant.rules`), which is
      what lets the speed die *select* the triples rule instead of registering
      one nobody uses.
- [x] **A bid of any amount.** A stepper beside the three quick buttons, clamped
      to the minimum and to what the bidder can cover, so a nudge cannot produce
      an illegal bid. `AuctionPanel.spots()` reports where its controls are, the
      way the trade panel does.
- [x] **The contested-house winner chooses the lot.** Asked, when there is more
      than one legal lot and the winner is not the player who nominated it. A bot
      takes the lot where a house earns most, which is a better answer than the
      cheapest-first ordering it replaced — that was never a strategy, just an
      order.

**What actually unblocked two of these** was a piece neither 10a nor 10b listed:
**`game/Choice.ts`**, a question a person and a bot can both answer. It was
planned as M12a on the strength of Ultimate Monopoly needing it twice; 10a needed
it twice more, so it landed here. M12a is struck through accordingly.

### 10b — what a player asks for

- [x] **Named save slots.** Three of them, written and read through the pause
      menu's Save screen and the title screen's Load screen. A pre-slot save is
      migrated into slot 1 rather than lost, and never over a slot somebody wrote
      deliberately.
- [x] **A save mid-turn.** The snapshot carries **where in the turn** it was
      taken — the phase, whether the turn was held, and whether a landing is
      owed — so a restore picks the turn up rather than rewinding it. Saving
      while a token is walking and while the buy prompt is open both work now,
      and those are where a game spends most of its waiting.
- [x] **Save during an auction.** `Auction.capture()` / `Auction.restore()` —
      the subject, who is still in, whose turn it is and the standing bid. The
      **clock is not part of it** and never was: it is a `scene.time` event the
      panel owns, so a restored auction starts its countdown again, and that is
      the entire cost.
- [x] **Get the turn log out.** Pause → Turn log copies it to the clipboard or
      saves it as a text file. Two routes because neither works everywhere: the
      clipboard is what somebody usually wants and browsers refuse it outside a
      secure context, and a file always works but is heavier. Each row says what
      happened rather than failing quietly.
- [ ] **A bot that offers *you* a trade.** `proposeTrade` exists and bots use it
      on each other; a bot will not interrupt a person with one. That is a
      question about the game's manners, and answering it means a modal that
      arrives uninvited plus a harness that knows to answer it.
- [ ] **A theme that can change mid-game.** Picked at boot or on the menu today.
      The HUD, the buttons and the board's static layer are drawn once at
      `create()`, and the pieces are baked textures.
- [x] **Test the `noAuction` house rule.** `npm run playtest -- --no-auction` is
      that second pass, and it *inverts* the assertion rather than skipping it: a
      run must decline at least one property and hold no auction at all. Skipping
      would have been how the rule went untested for another four milestones.

### 10d — the menus · done

One flat screen held six games, five player counts, six seat rows and four
switches, and had run out of room — the house-rule chips were already shrinking
to fit as more variants registered. Both menus are a tree now, and both render
from the same component.

- [x] **`ui/Menu.ts`** — a stack of screens of labelled rows. A screen is *data*,
      rebuilt each render, so a row's label, value and enabled-ness are functions
      and "Save — a token is still moving" is a row that answers for itself.
      Drawn onto a `Surface`, per 10c.
- [x] **A pause menu**, on Escape or the button that used to say SAVE: Resume,
      Save, Settings, Quit to menu. `scene.pause` rather than `stop`, so the board
      stays behind a scrim and every tween and timer is held rather than
      cancelled. Quitting asks first, and says whether the game is saved.
- [x] **Saving moved into it**, where a dead row can say *why* — "a token is
      still moving", "something is under the hammer" — rather than a button
      showing a toast after the fact. Same bargain the property panel's build
      buttons make.
- [x] **A generated Game Settings screen.** `RULE_FIELDS` beside `CLASSIC_RULES`
      says which rules a player may set, their type, their range and which
      section they belong in; the screens are built from it. A rule added to the
      engine costs one line and no scene edit. `movement` is deliberately absent:
      it is a property of the board, and setting a tracks board to `circuit` is a
      pairing `validateGame` refuses.
- [x] **Sound became a level, not a mute**, persisted to localStorage — a volume
      is a preference like the theme, so it is not in the snapshot. The theme
      picker moved next to it under Settings.
- [x] **The harness clicks rows by name.** `__menu.spots()` reports every row's
      position, its value and where its ‹ › are; `HOTSPOTS` lost its five menu
      coordinates. It also now walks into Game Settings, changes a rule, and
      asserts the change reached `__forge.rules()` — the check that would have
      caught M9b's silently-ignored house rule.

**The bug class that went away.** The menu used to keep a whole `HouseRules`
object plus three "has the player touched this?" flags, because a game's defaults
must not beat a player's choice and a player's choice must not beat a game they
have not picked yet. It keeps `Partial<GameRules>` of only what somebody actually
changed, so layering is `rulesFor(game, overrides)` — what the engine does anyway
— and the third flag, added only after Pocket could not turn its own house rule
on for a whole milestone, has nothing left to do.

### 10c — a bot worth playing against

The simulator turned this from an opinion into a measurement, and the measurement
is unflattering: tuning the baseline's three constants does **nothing**
(`AGGRESSIVE_PROFILE` won 289 games to 287 across 576), while *seat order* is
worth roughly 60/40 to the first two seats. So the work is not more numbers.

- [ ] **A policy of a different shape** — one that values a deed by the rent it is
      likely to face rather than by its printed price, weighs where the other
      players stand, and plans more than one purchase ahead. Whether it is better
      is now a question with an answer: `npm run simulate -- --policies a,b`,
      mirrored to cancel the position effect.
- [ ] **Trade more than a mutual monopoly.** The current proposer only makes the
      one swap, which is why about 5% of Classic games never form a monopoly at
      all and run for ever. A policy that would sell a key for enough cash, or
      assemble a group over several trades, would shrink that — and the stalemate
      rate is the number that says whether it did.

### What M10 is not

- **Not networked multiplayer**, and not simultaneous animation. Both are listed
  below with reasons, and neither is refinement — they are different projects.
- **Not a rewrite of the panels or the renderer.** They were done in 8c, and the
  board's state layer still rebuilding is a small, known cost recorded in
  KNOWNISSUES rather than a debt worth paying now.

---

## M11 — a board that is not a circuit · done

Adding a game nobody designed for this engine, to find out what the engine
assumes. It assumed four things, and Ultimate Monopoly broke all four.

### 11a — movement is a strategy · done

- [x] **`game/Movement.ts`** — a registry of named step strategies, resolved from
      `rules.movement` the way `turnOrder` and `winCondition` are. `circuit` is
      what every board did before; `tracks` walks the loops a map declares.
- [x] **`GameMap.tracks` / `GameMap.junctions`** — topology as data. A junction is
      two tiles that are one space; stepping off either with an even roll
      continues from the other, which is the printed transit-station rule exactly.
- [x] **`Board.move` reports the route.** `{ to, path, passedGo }`. The tokens
      walk the path instead of recomputing one — a token that recomputed would
      pick its own way across a junction and arrive somewhere the model never
      went.
- [x] **`pathTo` and `scan`** replace arithmetic with a breadth-first search, so
      "advance to Boardwalk" and "the nearest railroad" work on a board where
      distance has no closed form. On one circuit they return what the
      subtraction did.
- [x] **Every tile underfoot gets `onPass`, the landing tile included.** That one
      sentence is what makes a pay corner expressible, and it reproduces GO's old
      `passedGo` special case exactly. Backwards walks still pay nothing.
- [x] Validation: tracks must tile the board end to end, a junction must join two
      *different* loops, and a map that declares tracks but is played with
      `circuit` is refused rather than quietly played as one loop.

### 11b — a tile whose rule mentions somebody else · done

- [x] **`game/TileEffects.ts`** — `onLand(playerId)` is handed an id and nothing
      else, which is enough for a lot and useless for "collect $50 from every
      other player". Tiles get the shape card effects have had since 7c: a
      registry of named handlers, each given the landing context, resolved by both
      drivers through one `applyTileEffect` so the rule cannot drift between them.
- [x] `walkTo` moved into `Landing.ts` and is shared, because a card is no longer
      the only thing that moves somebody.

### 11c — twenty colour groups · done

- [x] **`ColorGroup` is open**, and a theme's `groups` is no longer a total map —
      it cannot be, when a board may bring twenty and a theme cannot know their
      names in advance.
- [x] **A group with no named colour is derived from its name**, in the current
      theme's own saturation and lightness, so it sits in the palette rather than
      shouting over it. Stable across builds, because a colour is how a player
      learns a group. Ultimate Monopoly ships a theme naming all twenty anyway.

### 11d — rent that is not the classic ladder · done

- [x] **`monopolyRent` and `majorityRent`** are rule values. The literal `* 2` in
      `quoteRent` was the last hardcoded rent in the engine; Ultimate Monopoly
      pays double for all-but-one of a group and triple for the set.
- [x] **A railroad counts its own type**, not the literal `'railroad'`, so a game
      can have a second railroad-shaped thing — four cab companies — without four
      cabs raising the railroad rate.
- [x] The eight-rung utility ladder needed **no engine change at all**: the game
      registers its own tile over the built-in `utility` name, which is exactly
      what the tile registry was for.

### What M11 deliberately did not do

Every one of these is the *same* gap, and it is the one worth naming: **a game
cannot add state to a player.** `Player` has no extension point and `captureGame`
would not know to save one. So travel vouchers, stock certificates and Roll Three
cards — three things you *hold* — cannot exist, and each ships as the nearest
rule that needs nothing held:

| printed rule | what ships | why |
|---|---|---|
| Bus Ticket — keep it, play it later | spent at once: on to the next card tile | a held card is per-player state |
| Stock Exchange — buy shares, draw dividends | the dividend only | shares are per-player state |
| Roll Three — everybody holds a number | the roller plays against a drawn one | a held card again |
| Reverse Direction — turn round *next* turn | straight back, now | a per-player facing is state |
| Subway — go to *any* space | on to the next unowned property | needs a pick-a-tile prompt a bot can answer |
| Auction — *you* pick the property | the dearest unowned one | the same missing prompt |
| Pay Day — $300 odd, $400 even | $300 passing, $400 landing | `onPass` cannot see the dice |

Two of those rows say "a prompt a bot can answer", which is the *second* thing
worth naming and is already on the list: it is what stopped the speed die's
triples rule in 8b, and it now has three customers.

Skyscrapers, train depots and cab stands are not here either. They are a fifth
building level and two more besides, and `rent` is fixed at six tiers with
`houseCost` and `housesBeforeHotel` assuming a single ladder. That is a real
generalisation rather than a reduction, and it belongs in its own slice.

**All of it is planned as [M12](#m12--the-rules-ultimate-monopoly-could-not-have)**,
which exists because of this list rather than ahead of it.

---

## M12 — the rules Ultimate Monopoly could not have

M11 added the board. This is the four engine gaps that stopped six of its printed
rules, written as a plan rather than a wish: each slice names **what it unlocks**,
so none of them is built speculatively. Every one has at least three customers
already in the tree, which is the bar for opening a seam at all.

They are independent — none blocks another — so the order below is by cost, not
by dependency.

### 12a — a choice a bot can answer · ~~planned~~ **done early, in 10a**

**Unlocks:** Subway ("travel to any space"), the Auction space ("pick an unowned
property"), the speed die's triples rule (deferred since 8b), and turns the
contested-house lot choice from deterministic into a real decision.

Pulled forward, because 10a turned out to need it twice as well — the speed
die's triples and the contested-house lot — which took it from three customers to
five. `game/Choice.ts` is the module; Ultimate Monopoly's Subway and Auction
square still use their deterministic reductions and are the two left to rewrite
onto it.

```ts
// game/Choice.ts
export interface ChoiceOption { id: string; label: string; tileId?: number }
export interface ChoiceRequest {
  playerId: string;
  prompt: string;
  options: ChoiceOption[];
  /** How a bot ranks them when nobody is at the keyboard. */
  rank?: string;          // a registered policy name, not a function
}
```

The shape is already in the tree twice over: the buy prompt has a human path and
a bot path, and `TurnFlow`'s `hold()` / `resume()` is exactly "a turn parked
waiting for an answer". So `choice:ask` holds the turn and `choice:answer`
resumes it, `GameScene` shows a panel (highlighting tiles when an option carries
a `tileId`), and `sim/Runner` asks `Bot`.

- [ ] `ChoiceRequest` + a `CHOICE_POLICIES` registry, named by string so a rule
      set naming one survives `JSON.stringify` — the same reason `turnOrder` is.
- [ ] Both driver paths, and **a bot answer is not optional**: a modal that waits
      for a click waits for ever on a bot's turn, which is the rule in CLAUDE.md
      that every prompt has to pay.
- [ ] Rewrite the four reductions to use it, and delete the "pick the dearest"
      comments that apologise for them.
- [ ] Saving is refused while a choice is open, as it already is mid-auction.

### 12b — a player can hold something the engine has never heard of

**Unlocks:** travel vouchers, stock certificates, Roll Three cards — and, past
Ultimate Monopoly, anything a future game wants a player to *have*.

The single gap behind four of the six reduced rules. `Player` has cash, a
position, deeds and Get Out of Jail Free cards, and no room for a fifth kind of
thing.

```ts
// game/Holdings.ts
export interface HoldingKind {
  label: string;
  plural?: string;
  /** Most a player may hold at once. */
  limit?: number;
  /** What one is worth in cash, so a bot can price it in a trade. */
  value?(ctx: LandingContext, player: Player): number;
}
export const HOLDINGS = new Registry<HoldingKind>('holdings');

// on Player
holdings: Record<string, number>;   // countable, keyed by kind
```

Countable is enough for all three: a stock company is its own kind
(`stock.acmeMotors`), not a bag of objects with identity.

Four things it must not get wrong, three of which the engine has already been
bitten by:

- [ ] **The snapshot.** `captureGame` / `restoreGame` carry `holdings`, and
      `validateSnapshot` refuses a save naming a kind this build has not
      registered — the same rule a turn order gets.
- [ ] **Bankruptcy.** `transferEstate` must move or forfeit them *explicitly*.
      This is exactly where the deck census bug came from in M8d: a bankrupt
      player's cards were destroyed and the deck quietly drained.
- [ ] **An invariant.** `sim/Invariants.ts` gains a holdings census — counts
      non-negative, every kind registered, a bankrupt player holding none.
- [ ] **The bot.** Pricing one in a trade is `value()`. *Spending* one well is
      not general, and should stay a per-game policy rather than being guessed
      at in `Bot.ts`.

The open question worth answering before writing any of it: **can a bot be taught
to value a held thing it has never heard of?** `value()` is the cheap answer and
may be enough. If it is not, holdings are tradeable but not playable by a bot,
and that is worth knowing before the panel is built.

### 12c — a tile can see the roll that took a player past it

**Unlocks:** Pay Day's real rule, and anything else keyed off the dice rather
than off stopping.

The smallest item here. `Tile.onLand` reaches the dice through the `tile:effect`
indirection; `Tile.onPass` cannot reach anything, because
`Board.announcePassing` walks the path with an id and nothing else. So Pay Day
pays "$300 passing, $400 landing" where the board says "$300 odd, $400 even".

- [ ] `announcePassing(path, playerId, ctx)` and an optional second argument to
      `onPass`, carrying the roll.
- [ ] Decide deliberately whether *every* tile should get a context on every step
      of every walk. That is the actual design question, and the reason this is
      not a five-minute change.

### 12d — buildings are a ladder, not houses-then-a-hotel

**Unlocks:** skyscrapers (Ultimate Monopoly's fifth level), train depots on
railroads, cab stands on cab companies.

The largest, and last for that reason: it touches `BuildRules`, `Bank`,
`PropertyPanel`, `Snapshot`, `Invariants`, `Bot` **and the `rent` tuple on every
map**.

```ts
export interface BuildLevel {
  id: string;              // 'house' | 'hotel' | 'skyscraper'
  label: string;
  /** How many of the level below one of these replaces. */
  consumes: number;
  supply: number;
}
rules.buildLadder: BuildLevel[]
```

Two consequences to face up front rather than discover:

- **`TileDefinition.rent` stops being a six-tuple.** It becomes a `number[]` as
  long as the ladder allows, and `validateMap`'s "needs six rent tiers" becomes
  "needs one tier per level this game builds". Every map changes; the classic
  ones change by having their length checked differently, not their contents.
- **A railroad can hold a building.** Depots and cab stands are improvements on
  something that is not a `PropertyTile`, so `buildingLevel` and the build rules
  stop being about lots. `quoteRent` already counts by `tile.type`, which helps.

Worth doing only when something wants it. Ultimate Monopoly does, and it is the
only thing that does — so if this slips behind M10, nothing is blocked.

### What M12 is not

- **Not a second board.** Ultimate Monopoly is the customer for all four items,
  and it already plays. This is about the rules it had to soften, not about
  adding anything else.
- **Not the printed rule at any cost.** Two reductions are staying: Squeeze
  Play's dice table is fine as it is, and the Holland Tunnels' arrival guard is
  the printed rule, not a compromise.

---

## Blocked / deferred, with reasons

### What a save deliberately does not carry — *resolved in M6*

Save/load works (`game/Snapshot.ts`). Two things are left out on purpose rather
than by omission, and both are why saving is refused while they are happening:

- **Mid-turn state.** A restore resumes at the *start* of the saved player's
  turn. Nothing captures a half-finished move, an open card overlay, a running
  auction clock or a half-built trade offer, so the save button says "finish what
  you are doing first" instead of pretending otherwise.
- **One save slot.** `SaveLoad` keeps a single localStorage key. Named slots,
  autosave and export-to-file are all straightforward from here; none is written.

Both are **scheduled into M10b** now rather than left here — the slots because
they are cheap, the mid-turn save because `TurnFlow`'s `hold()` / `resume()` gave
"a turn parked part-way through" a shape it did not have when this was written.

A save is refused by a build that cannot read it: `validateSnapshot` checks the
version, that every tile is on this board, that no deed is owned by a player who
is not in the save, and that the turn points at somebody real.

### Multiple simultaneous animations

Movement is a chain of awaited tweens guarded by a single `isAnimating` flag, so
exactly one token can move at a time. Fine for hot-seat play; it would need
rethinking for any form of simultaneous or networked turns. Not planned.

### Networked multiplayer

Not planned. The `EventBus` is a plausible seam for it — the model already emits
every state change as an event and imports no Phaser — but authoritative state,
reconnection and anti-cheat are a different project.

### Mobile / responsive layout

The canvas is a fixed 1280×800 with no Phaser Scale Manager configuration, so on a
small screen it is simply cut off. Fixing it properly means reflowing the board
and the HUD, not just scaling, since the tile labels are already 6px.

---

## Not on the roadmap

- **Official Monopoly assets or branding.** This is an independent implementation
  of the public-domain-era board layout using generic tile names; the artwork is
  drawn procedurally in code. It is not affiliated with Hasbro.
- **An in-game asset pipeline.** `BootScene` generates its placeholder textures at
  runtime, which keeps the repo free of third-party art and its licence questions.
