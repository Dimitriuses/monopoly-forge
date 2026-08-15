# From a game to an engine

Where Monopoly Forge is going, what already supports it, and what had to change
to get there. Split out of the README in the interest of that file staying
readable; [ROADMAP.md](../ROADMAP.md) is the plan, this is the argument behind it.

---

Monopoly Forge is meant to end up as an **engine for Monopoly-style games**: bring
your own board, your own rules, your own artwork, and the engine runs the game.
Three axes of customisation, none of which should require editing engine code:

| Axis | What you should be able to supply |
|---|---|
| **Maps** | A board of any length and shape — not 40 tiles in a square — with your own tiles, groups, prices and named anchors (where "jail" is, where "start" is). *Done: see the round and multi-ring boards that ship* |
| **Rules** | New tile types and card effects registered from outside, a rule set that decides jail terms, building rules and the economy, and a turn whose phases, order and win condition come from that rule set. *Done — the speed die is the proof: its own dice and an extra phase, with the engine never learning what one is* |
| **Presentation** | How each element draws — tiles, tokens, panels, HUD — swapped per theme, without touching the rules. *Done: two themes ship, and how a tile type draws is a registered decoration rather than a branch in the renderer* |
| **Buildings** | A ladder rather than houses-then-a-hotel: a game says what can be built, on which tile types, how many fit, what the bank stocks, and whether it charges the next rent tier or multiplies what the tile already charges. *Done: Ultimate Monopoly builds houses, hotels, **skyscrapers**, **train depots** on its railroads and **cab stands** on its cab companies* |
| **A game** | All three of the above in one place — a folder holding a board, a rule set, decks, a theme and whatever else it needs, picked as a single choice and launched. *Done: `src/games/<id>/` is a game, `gameById` loads it, six ship — including Ultimate Monopoly's 120 tiles and three loops — and [docs/authoring-a-game.md](authoring-a-game.md) is how to add one* |

**Writing the classic game first was the point, not a detour.** A configurable
engine whose only consumer is a toy proves nothing; the standard board is the
reference implementation that says what the engine has to be able to express, and
it is what the 583 unit tests pin down.

### What already supports it

Some of the groundwork is deliberately in place — it is why the architecture below
looks the way it does:

- **The rules core has no Phaser and no DOM**, so an engine consumer can run a
  whole game headlessly — to validate a custom rule set, or simulate thousands of
  games — with no renderer at all.
- **The renderer only listens to events.** A different presentation layer
  subscribes to the same bus; it does not subclass or import the model.
- **Tiles are already data.** `TileDefinition` is a plain object and the board is
  an array of them, which is most of the way to a map being a file.
- **Tiles are already polymorphic** — `Tile.onLand()` is a real extension point.
- **Games are deterministic from a seed**, which is what makes comparing two rule
  sets, or reproducing a custom-map bug, tractable.
- **The board's length and its anchors come from the map.** `Board` takes a
  `TileDefinition[]`, publishes `board.size`, and resolves `start` / `jail` /
  `goToJail` to indices by role; no `40` or `10` is left in the model. A 12-tile
  board is a test case, not a thought experiment.
- **The renderer is separate from the scene.** `BoardRenderer` draws everything
  inside the board square from per-tile layout data, in one loop rather than one
  per side.

### What has to change first

Honestly measured against the current code, not estimated:

- **The board is still a square with equal sides.** `Board.computeLayout()` now
  derives the corners from `(size - 4) / 4` instead of literal index ranges, and
  rejects a length that cannot make a square — but an arbitrary shape needs
  per-tile coordinates, or a segment description, supplied by the map.
- **A map is not yet a file.** `BOARD_TILES` still lives in `config.ts`, with no
  schema, loader or validation.
- **Two closed `switch` statements** decide what can exist: tile construction in
  `Board`, and card effects in `CardEffects.execute()`. Both need to become
  registries so a game can add a type without editing the engine.
- **Presentation is not yet a theme.** The renderer is extracted, but its colours,
  fonts and decorations are still constants inside it and in `config.ts`.

None of that is a rewrite — it is parameterising code that already has the right
shape. The sequencing mattered more than the size: the board-length work and the
renderer split were done **as part of** M3, before ownership markers, houses and
hotels were drawn, because every feature added inside the old `drawBoard()` would
have raised the cost of extracting it. The full breakdown is in
[ROADMAP.md](../ROADMAP.md).

---

