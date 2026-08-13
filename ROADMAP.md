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

What is left is the engine itself (M8). **8a is done**: the board is a file, and
the game ships three of them — the classic square, a 24-tile circle and 30 tiles
across three concentric rings. **8b is done too**: tile types, card effects,
turn orders, win conditions and whole variants are registries rather than
switches; decks travel with a map; the numbers the classic game hardcoded are a
rule set a map can override; a turn is a list of phases a rule set can add to;
and the speed die is the proof, added without the engine learning what one is.
The last rule the game was missing — auctioning the houses the bank is short of —
went in with it. **8c is done too**: colours, fonts and per-tile-type decoration
are a theme object with two palettes registered, and the panels update what is on
screen instead of destroying it. That leaves **8d**, the simulation platform that
runs M7's bots a thousand games at a time — and the last thing standing between
the engine and being measurable.

**M8 makes the parts configurable; M9 gives them somewhere to live together, and
its first half is done.** `src/games/<id>/` is one folder, one playable thing,
picked as one choice — four ship, including the classic board with the speed die,
which is two games sharing a map and differing in a single field. Registration is
scoped to the loaded game, which is what 8d needed before it could load more than
one. The rest of M9 runs after the simulator, because a simulator is what tells
an author their game does not work.

**The destination is M8: an engine for Monopoly-style games** — configurable maps,
rules and presentation. M1–M7 build the classic game that the engine has to be able
to express; M8 generalises it. Some M8 groundwork is already deliberate (a
Phaser-free core, an event-decoupled renderer, data-driven tiles), and some of it
is cheaper to do early — see the sequencing note at the end.

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

### 8d — A simulation platform

Running the game thousands of times without a renderer, driven by M7's bots. This
is where a rules engine stops being a claim and starts being measurable — and it
is the fastest way to find the rule bugs a hand-played game never reaches.

**Runs after M9a**, which is not a scheduling preference — see the note under M9.
The short version: every registry in this engine is a module-level `Map`, and
8d's whole premise is many games in one Node process. Two games that each
register a `tollBooth`, or each replace `collectFromBank`, tread on each other
silently, and the failure mode is a simulation result that is *wrong* rather than
one that crashes. So the runner takes a `Game`, and games own their registrations
before a batch ever loads two of them.

- [ ] **A headless runner.** No Phaser, no canvas: **a `Game`**, a seed and a
      table of players in; a finished game out. The model already runs in plain
      Node, and M7's decision layer is deliberately separate from the scene that
      currently drives it, so the runner supplies the driving instead.
- [ ] **Sequence a landing from completion, not from a delay** (moved from
      KNOWNISSUES). `GameScene` ends a turn with `safeEndTurn(300)` / `(400)` /
      `(700)` / `(800)`, tuned by feel against animation lengths. It has been
      stable for four milestones, and it is the *first* thing a headless runner
      breaks: there is no tween to be slower than and no clock to wait on. So the
      landing has to report when it is finished rather than be waited out — and
      that has to be true before the runner can play a single game, which is why
      it is here rather than filed as debt.
- [ ] **A batch CLI** — `npm run simulate -- --game classic --games 1000 --seed 1`
      — reporting what a balance pass needs: bankruptcy rates, game length, how
      often the bank runs out of houses, how often a game fails to terminate.
      Naming a game rather than a pile of flags is the point: `--games 1000` over
      *which* map, rules and variants is a question the old shape could not
      answer, and a report that cannot say what it ran is not evidence.
- [ ] **Invariant checking across the batch** (the richer assertions moved here
      from M7). Total cash conserved, deck census intact, no player ever off the
      board, every game reaching a winner. A rule bug that shows up once in five
      hundred games is invisible at the table and obvious here. Run over **every
      shipped game**, not just the classic one — "all three finish, always" is a
      far stronger claim than "the classic board does", and it is the claim an
      engine has to be able to make.
- [ ] **A second policy to measure the first against.** `game/Bot.ts` is a
      deliberately simple baseline — a fixed reserve, a tenth-of-face bidding
      step, build the cheapest complete group. The point of a simulator is being
      able to say whether a different one is actually better.
- [ ] **A balance pass** driven by those numbers (moved from M7, which cannot do
      it without the runner). Per game, and editable in one place: Roundabout's
      economy and its board are one folder by then, so balancing it is changing
      that folder and re-running the batch against it.

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

## M9 — a game is a folder

**9a is done**; 9b waits for the simulator. M8 made the *parts* configurable: a map is a file, rules and turn structure are a
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

### 9b — authoring · **after 8d**

Deliberately after, because 8d is what tells an author their game is unplayable,
and because guessing at these now means guessing without that.

- [ ] **Per-game assets.** The repo has none today — every texture is drawn at
      runtime, which is what keeps it free of third-party art and its licence
      questions. A game bringing its own needs a loading story that does not
      exist yet, and one that keeps the no-assets default intact.
- [ ] **Composing a rule set, not just overriding one.** `GameRules` layers
      cleanly already. What is *not* expressible is subtracting — a game that
      wants no utilities, or the classic deck minus three cards. Which knobs are
      worth building is a question 1,000 simulated games can answer and a
      guess cannot.
- [ ] **Authoring documentation**, written against a simulator that can tell an
      author their board never terminates.

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
