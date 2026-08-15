# Changelog

What changed, newest first. One entry per milestone; the reasoning behind each is
in [DEVLOG.md](DEVLOG.md), what is planned is in [ROADMAP.md](ROADMAP.md), and
what is broken today is in [KNOWNISSUES.md](KNOWNISSUES.md).

Dates are when the work landed, not when it was released — there are no releases.

---

## M12 — the rules Ultimate Monopoly could not have — 2026-08-15

Four engine gaps, each named by what it unlocks rather than by what it
generalises, and each with at least three customers already in the tree.

### 12d — buildings are a ladder, not houses-then-a-hotel
- **A build level is data** (`game/BuildLadder.ts`): what a building is, which
  tile types it stands on, how many fit, what the bank stocks.
- **Two shapes, not one.** A level either charges the next *rent tier* (house,
  hotel, skyscraper — needs the colour group, goes up evenly) or **multiplies**
  what the tile already charges (train depot, cab stand — needs only the deed).
- `tile.houses` + `tile.hasHotel` became **`tile.level`**, which is also the index
  into the rent table. `level` lives on `Ownable`, so a railroad can hold one.
- `TileDefinition.rent` is a `number[]`; how many tiers a lot needs moved from
  `validateMap` to `validateGame`, because a map has no economy.
- The bank stocks **by kind**, and the invariant census counts every kind.
- Ultimate Monopoly now builds all five its equipment list names: 81 houses, 31
  hotels, 16 skyscrapers, 4 train depots, 4 cab stands.
- **Junctions are drawn as one space.** A railroad and its transit station share
  an unstroked edge, so the pair reads as a single block across two rings while
  staying two tiles for movement.

### 12c — a tile can see the roll that took a player past it
- `onPass` gets a `PassContext`; `roll` is the dice total, or **null** when
  something other than the dice moved you — which is the state the printed rules
  call *direct movement*.
- Pay Day pays $300 on an odd roll and $400 on an even one, and the maximum for a
  direct arrival. It was never a pass/land tile; it had been implemented as one.

### 12b — a player can hold something the engine has never heard of
- `game/Holdings.ts`: countable things keyed by a registered kind, with a limit,
  a value and a bankruptcy rule.
- Carried by the snapshot, moved or forfeited on bankruptcy, counted by an
  invariant, and priced by `estateValue` — which is deliberately **not**
  `liquidValue`, because nothing can sell a travel voucher.
- **Travel vouchers are real** in Ultimate Monopoly: earned at Bus Ticket and at
  every transit station, spent to travel anywhere.
- **Pause → Inventory** lists every seat's cash, net worth, deeds, groups,
  buildings, jail cards and holdings — and a player's row in the HUD opens theirs
  directly.
- `validateSnapshot` now loads the game *before* checking what it registers,
  which is what had been refusing Ultimate Monopoly's own saves.

### 12a — a choice a bot can answer
- `game/Choice.ts` — a choice is data, with weights, and both drivers answer it.
- The Subway and the Auction square ask a person which square they want instead
  of deciding for everybody; the old deterministic answer survives as the weight
  a bot ranks by.
- Fixed: the Auction square offered the nominated deed to the player who
  nominated it, rather than putting it under the hammer.

---

## M11 — a board that is not a circuit — 2026-08-14

- **Movement is a named strategy** (`game/Movement.ts`). `circuit` is one loop;
  `tracks` walks the loops a map declares and crosses at its junctions.
- `Board.move` reports the **route** it walked, not just the destination, so
  tokens follow the path the model took.
- Distance is a breadth-first search (`pathTo`, `scan`), not subtraction.
- A tile's rule may mention somebody else: `registerTileEffect`, resolved through
  one shared context by both drivers.
- Colour groups opened to any string, with a stable derived colour for any group
  a theme has no entry for.
- Group rent stopped being a literal `× 2`: `monopolyRent` and `majorityRent`.
- **Ultimate Monopoly ships** — 120 tiles, three loops, twenty colour groups,
  fourteen tile types the engine had never heard of.

---

## M10 — refinement — 2026-08-14 → 15

- **The corners the rules cut** (10a): three doubles, the contested house lot,
  and the two prompts that used to decide for everybody.
- **Saving mid-turn** (10b): a walking token, an open buy prompt and a live
  auction all survive a reload. The snapshot records *where in the turn* it was
  taken, and a restore picks the turn up rather than restarting it.
- **The turn log comes out** — copy to the clipboard or save as a file.
- **Bots offer you trades** on their own turn, rationed and switchable off.
- **The theme changes mid-game**, without restarting the scene.
- **Both menus are a tree** (10d), rendered from one component, generated from
  rule metadata; the menu keeps only what the player changed.
- **The bots were measured, not tuned** (10c): a Markov chain over the real board
  for landing odds, and `--mirror` to tally a match by policy rather than by seat.
  The cleverer valuation that was meant to win was measured and does not.

---

## M9 — a game is a folder — 2026-08-13

- `src/games/<id>/` is a board, an economy, a deck, the variants it is played
  with, a palette and any artwork — picked as one choice.
- Registration is **scoped to the loaded game**, so two games cannot get each
  other's tile types.
- A game can be composed from one that already exists, and can bring its own
  artwork without the repo carrying any.
- [docs/authoring-a-game.md](docs/authoring-a-game.md) is the worked example.

---

## M8 — the engine — 2026-08-13

- **8a — a board is a file.** `GameMap` + `validateMap`; length, shape and named
  anchors instead of 40 tiles in a square.
- **8b — rules are registries, not switches.** Tile types, card effects, turn
  orders, win conditions and variants; a turn is a list of phases a rule set can
  add to. The speed die is the proof.
- **8c — presentation is a theme.** Colours, fonts and per-tile-type decoration
  in one object; panels update in place instead of rebuilding.
- **8d — a simulation platform.** A headless runner sharing every decision with
  the scene, invariants checked after every turn, and a batch CLI. It found two
  real bugs on its first two batches — and that Monopoly does not always
  terminate, which is why "every game reaches a winner" is not an invariant.

---

## M7 — opponents you can play against — 2026-08-12

- `game/Bot.ts` answers questions — buy this? bid how much? build where? — and
  draws no randomness, so a seeded game still replays.
- Anything a bot must respond to has a bot path; a modal that waits for a click
  would wait for ever.

---

## M6 — polish — 2026-08-12

- Save and load, working house rules, a turn log, tokens that cluster when they
  share a square, and sound.

---

## M5 — multiplayer interaction — 2026-08-12

- Auctions over a subject, two-sided trading with validation, and a bankruptcy
  that settles an estate rather than clamping cash at zero.

---

## M4 — cards, jail and rent edge cases — 2026-08-12

- Both decks with their real effects, the jail rules in full, and the rent cases
  behind them — including a card's rent rate surviving the walk to the tile.

---

## M3 — ownership and development — 2026-08-12

- Houses, hotels and mortgages with an interface, colour-group enforcement, and
  the even-building rule.

---

## M2 — the core loop — 2026-08-12

- Dice, doubles, movement, rent, tax, the GO salary and jail.

---

## M1 — foundation — 2026-08-01

- Vite + Phaser 3 + TypeScript scaffold, the classic board as data, a typed
  `EventBus`, a seeded PRNG, the tile hierarchy and both card decks.
