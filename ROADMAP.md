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

What is left is the engine itself (M8), including the simulation platform (8d)
that runs M7's bots a thousand games at a time.

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

### 8a — The board stops being 40 tiles in a square

- [x] **Take board length from the map.** Done alongside M3. `Board` takes a
      `TileDefinition[]` (defaulting to the classic one), publishes `board.size`,
      and every wrap goes through `move` / `stepsBetween`. The `BOARD_SIZE`
      constant is gone rather than read.
- [x] **Name the anchors.** `Board.anchor('start' | 'jail' | 'goToJail')` resolves
      a role to an index by scanning the map; `TurnManager`, `CardEffects` and
      `GameScene` all ask for the role. A map without a jail says so
      (`tryAnchor` → `null`) instead of silently meaning tile 10.
- [ ] **Stop assuming a square.** Half done: the four literal index ranges are
      gone — `Board.computeLayout()` derives corners and sides from
      `perSide = (size - 4) / 4`, and `TileLayout` now carries each tile's
      footprint and orientation so the renderer has one loop instead of four. It
      is still a square with equal sides: a map whose length is not `4n + 4` is
      rejected with an explicit error rather than mis-drawn. Arbitrary shapes need
      a side/segment description, or per-tile coordinates, in the map.
- [ ] **A map is a file.** `TileDefinition[]` is already plain data and `Board`
      already accepts one; what is missing is a schema, a loader and validation
      (every referenced tile exists, groups are consistent, anchors resolve), and
      shipping the classic board as the first map rather than as `BOARD_TILES` in
      `config.ts`.

### 8b — Rules become registrable instead of switch statements

- [ ] **Tile-type registry.** `Board`'s constructor `switch` closes the set of tile
      types; a `registerTileType(name, factory)` opens it. `Tile.onLand()` is
      already the right extension point.
- [ ] **Card-effect registry.** `CardEffects.execute()` is a second closed switch
      over the `CardAction` union. Same treatment, so a game can add an effect
      without touching the engine.
- [ ] **A real rule set.** The three `HouseRules` flags are now read (M6), which is
      the shape of the idea but not the thing: widen it to what the classic rules
      still hardcode — starting cash, GO salary, jail term and fine,
      doubles-to-jail count, build rules, win condition — and let a game supply its
      own. The `speedDie` variant dropped in M6 belongs here too: a third die and
      two new face effects are a rule set, not a boolean.
- [ ] **Contention, and auctioning scarce houses** (moved from M6). The standard
      rule auctions houses when "two or more players wish to buy more than the Bank
      has", and a turn-based click UI never produces simultaneous demand — players
      ask one at a time and turn order settles it. Making the rule expressible
      needs three things that land here: a notion of who *else* wants to build
      right now (a rule set, or the M7 bot, can answer that), a step where the
      auction winner nominates the lot, and `Auction` bidding on an arbitrary
      subject rather than a tile id.
- [ ] **Generalise the turn structure.** `TurnManager`'s phase FSM is the hardest
      piece to open up and should come last — a phase pipeline a rule set can
      extend, rather than a fixed enum.

### 8c — Presentation becomes a theme

- [x] **Extract `BoardRenderer`.** Done alongside M3, before the ownership and
      building work went in — `src/ui/BoardRenderer.ts` owns everything inside the
      board square, `GameScene` owns the tokens, buttons and wiring.
- [x] **Use the asset pipeline** `BootScene` half-provides. Done in M6: the
      `house` and `hotel` textures are drawn on the board, and the `token_*`
      textures — unused since M1 — are now baked per token type and drawn as the
      pieces.
- [ ] **A theme object** for colours, fonts and tile decoration, replacing the
      `GROUP_COLORS` / `TOKEN_HEX` constants and the literals still inside
      `BoardRenderer`.
- [ ] **Per-element draw overrides**, so a game can replace how one tile type or
      token renders without forking the renderer.
- [ ] **Diff a panel instead of redrawing it** (moved from M6). The three panels
      skip a rebuild when the view has not changed (M6), but a view that *has*
      changed still destroys and re-creates every child. Updating in place is the
      same problem as rendering a theme — hold references to the drawn elements and
      write to them — so it is worth solving once, here, rather than three times in
      three hand-written panels.

### 8d — A simulation platform

Running the game thousands of times without a renderer, driven by M7's bots. This
is where a rules engine stops being a claim and starts being measurable — and it
is the fastest way to find the rule bugs a hand-played game never reaches.

- [ ] **A headless runner.** No Phaser, no canvas: seed, players, rule set in;
      a finished game out. The model already runs in plain Node, and M7's decision
      layer is deliberately separate from the scene that currently drives it, so
      the runner supplies the driving instead.
- [ ] **A batch CLI** — `npm run simulate -- --games 1000 --seed 1` — reporting
      what a balance pass needs: bankruptcy rates, game length, how often the bank
      runs out of houses, how often a game fails to terminate.
- [ ] **Invariant checking across the batch** (the richer assertions moved here
      from M7). Total cash conserved, deck census intact, no player ever off the
      board, every game reaching a winner. A rule bug that shows up once in five
      hundred games is invisible at the table and obvious here.
- [ ] **A second policy to measure the first against.** `game/Bot.ts` is a
      deliberately simple baseline — a fixed reserve, a tenth-of-face bidding
      step, build the cheapest complete group. The point of a simulator is being
      able to say whether a different one is actually better.
- [ ] **A balance pass** driven by those numbers (moved from M7, which cannot do
      it without the runner).

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
