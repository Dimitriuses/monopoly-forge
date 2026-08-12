# Roadmap

Where Monopoly Forge is going. Defects that exist *today* are listed separately in
[KNOWNISSUES.md](KNOWNISSUES.md); this file is about work not yet done.

**Status:** active. **The classic game is playable end to end.** M3 put ownership
on the board and made houses, hotels and mortgages reachable, M4 closed the card,
jail and rent rules behind them, and M5 added the multiplayer half — auctions,
trading and a bankruptcy that actually settles an estate, which is what makes the
last-player-standing win condition mean anything. A seeded game runs with no
console errors (`npm run playtest`).

What is left is polish (M6), quality (M7) and then the engine itself (M8).

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

## M6 — Polish · next

- [ ] **Wire up save/load.** See *Blocked / deferred* below — this is not the
      small job it looks like.
- [ ] **Finish the house rules.** `noAuction` is now real (M5). Three flags are
      still read by nothing: `freeParkingJackpot`, `doubleGoSalary` and
      `speedDie`. Either implement them or delete them.
- [ ] **Auction the houses when the bank runs short.** `BuildRules.canSellHotel`
      refuses to break a hotel the bank cannot supply four houses for, which
      matches the limited-supply rule; what is missing is the other half, where
      several players want the last few houses and the standard rules auction
      them. M5's `Auction` is the machinery, but it bids on a tile, not on stock.
- [ ] **Fill the rest of the right-hand column.** The property panel now occupies
      x=770–1045 down to y=480; the turn log belongs underneath it.
- [ ] **Stop toasts covering the roll button.** Notifications stack upward from
      y=760, directly over the ROLL DICE button at y=738.
- [ ] **Update the property panel instead of rebuilding it.** `PropertyPanel.show`
      destroys and re-creates every text object, and `refreshPanel()` calls it
      after each build, sale, mortgage and turn change. Not measurable at this
      size, but it is churn where a diff would do.
- [ ] Sound effects, and a proper token sprite instead of a coloured circle.

## M7 — Quality

- [ ] **A basic AI opponent**, so a single player can finish a game. The seeded
      PRNG and the Phaser-free model make headless simulation straightforward —
      a bot that plays thousands of games is also the fastest way to find the
      remaining rule bugs.
- [ ] **Balance pass** driven by those simulations: bankruptcy rates, game length,
      how often the bank runs out of houses.
- [ ] **Extend the playtest harness** to assert on richer invariants (total cash
      conservation across the whole table, deck census over a long game).

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
- [ ] **A real rule set.** Start by making the four existing `HouseRules` flags do
      something (they are read by nothing today), then widen it to the things the
      classic rules currently hardcode: starting cash, GO salary, jail term and
      fine, doubles-to-jail count, build rules, win condition.
- [ ] **Generalise the turn structure.** `TurnManager`'s phase FSM is the hardest
      piece to open up and should come last — a phase pipeline a rule set can
      extend, rather than a fixed enum.

### 8c — Presentation becomes a theme

- [x] **Extract `BoardRenderer`.** Done alongside M3, before the ownership and
      building work went in — `src/ui/BoardRenderer.ts` owns everything inside the
      board square, `GameScene` owns the tokens, buttons and wiring.
- [x] **Use the asset pipeline** `BootScene` half-provides: the `house` and
      `hotel` textures it generates are drawn. The token textures are still unused
      — tokens are coloured circles (M6).
- [ ] **A theme object** for colours, fonts and tile decoration, replacing the
      `GROUP_COLORS` / `TOKEN_HEX` constants and the literals still inside
      `BoardRenderer`.
- [ ] **Per-element draw overrides**, so a game can replace how one tile type or
      token renders without forking the renderer.

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

### Save/load needs a deserialiser, not a save button

`SaveLoad.ts` (localStorage, versioned) and `GameScene.serialize()` both work, and
`serialize()` is what the playtest harness reads state through. Restoring is the
hard half and is genuinely not written:

- `Board.toJSON()` emits tile ownership and house counts, but there is no
  `fromJSON` on any model class — every class would need one.
- **Deck state is not serialised at all.** `CardDeck` keeps its draw and discard
  piles in private arrays with no `toJSON`, so a restored game would reshuffle
  both decks and hand out cards a player has already seen.
- The PRNG stream position is not captured either. `PRNG.getSeed()` returns the
  *current* state, which is actually the right value to persist — but nothing
  calls it, and restoring it has to happen before any deck is rebuilt or the
  shuffles diverge.
- Phaser state (token sprites, the active scene, an open card overlay) has to be
  rebuilt to match, which means a restore path through `GameScene.create()`
  rather than a simple field assignment.

Deferred past M3, whose ownership and building work changed the shape of the state
that would need saving — houses, hotels and mortgage flags now all move in play.

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
