# 🏦 Monopoly Forge

A hot-seat Monopoly game for 2–6 players, built from scratch in **TypeScript** on
**Phaser 3** — with a rules engine that runs, and is tested, without a browser.

The longer goal is in the name: an **engine for Monopoly-style board games**, where
the map, the rules and the look of every element are things you configure rather
than things you edit. Building the classic game first is the deliberate route
there — see [Where this is going](#where-this-is-going--from-game-to-engine).

[![CI](https://github.com/Dimitriuses/monopoly-forge/actions/workflows/ci.yml/badge.svg)](https://github.com/Dimitriuses/monopoly-forge/actions/workflows/ci.yml)
[![Phaser](https://img.shields.io/badge/Phaser-3.90-blueviolet)](https://phaser.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-7-646cff)](https://vite.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![status: active](https://img.shields.io/badge/status-active-brightgreen)](ROADMAP.md)
[![Play demo](https://img.shields.io/badge/▶_play-demo-f0c040)](https://dimitriuses.github.io/monopoly-forge/)

## **[▶ Play the demo](https://dimitriuses.github.io/monopoly-forge/)**

No install, no sign-up — it runs in the browser. Pick 2–6 players and hit **START
GAME**; the [controls](#controls) are below. Add `?seed=20260512` to replay an
identical game, or `?debug=1` to watch the full turn trace in the console.

---

## Controls

Everything is mouse-driven — there is no keyboard input.

| Action | How |
|---|---|
| Choose 2–6 players | Click a number on the menu |
| Change a player's token | Click the token name next to `P1`, `P2`, … to cycle |
| Start | **▶ START GAME** |
| Roll | **🎲 ROLL DICE**, below the board (greyed out when it is not your turn to roll) |
| Buy the property you landed on | **✅ BUY** in the prompt |
| Decline it | **❌ PASS** |
| Inspect any tile | Click it — the panel on the right shows the rent ladder, costs and owner. Click it again to close |
| Build, sell, mortgage | Buttons in that panel, on your own turn, for tiles you own. A greyed-out button still tells you why when clicked |
| Dismiss a Chance / Community Chest card | **OK** |
| Leave jail | **🔓 Pay $50** (or **🃏 Use Card** if you hold one) — appears below the board only when you are in jail and can afford it |

Hot-seat: all players share one screen, and the HUD on the right shows whose turn
it is.

---

## What it is

A complete implementation of the Monopoly turn loop: dice with doubles and the
three-doubles jail rule, step-by-step token movement, property/railroad/utility
purchase, the full rent ladder, both card decks with all 33 cards, taxes, the GO
salary, and every route in and out of jail.

The point of the project is the **engine underneath it**. The rules live in plain
TypeScript classes that import no Phaser and touch no DOM, communicate with the
renderer only through a typed event bus, and draw every random number from a
seeded PRNG — so a whole game is reproducible from a single integer, and the model
is unit-tested in bare Node with no jsdom and no canvas shim.

### Implemented

- **Turn engine** — phase FSM (`WAITING_FOR_ROLL → ROLLING → MOVING → LANDING → END_TURN`), doubles grant another roll, three in a row send you to jail
- **Board** — all 40 tiles with correct groups, prices, rent tiers and mortgage values, drawn procedurally
- **Movement** — tile-by-tile animated walk, GO salary paid on passing (and on landing exactly)
- **Property** — buy prompt for streets, railroads and utilities; rent from the tier table, doubled on an unimproved complete colour group; railroad rent by how many the owner holds; utility rent at 4× or 10× the dice
- **Cards** — 16 Chance and 17 Community Chest, with advance / go-back / jail / collect / pay / pay-per-house effects, drawn from a shuffled deck with a discard pile that reshuffles. "Nearest railroad" and "nearest utility" search the board rather than naming a tile, and charge the double / ten-times-dice rate for arriving by card; a spent Get Out of Jail Free card goes back under its own deck
- **Jail** — enter by tile, card or three doubles; leave by doubles, a $50 fine, a Get Out of Jail Free card, or the forced fine after three turns
- **Ownership on the board** — an owner-coloured band with the owner's seat number on every owned tile, `M` when it is mortgaged, houses and hotels drawn along the colour stripe
- **Development** — click a tile for its rent ladder, costs and owner; build and sell houses and hotels, mortgage and redeem, with the colour-group and even-building rules enforced and every refusal explained
- **HUD** — animated dice, per-player cash, active-player highlight, jail markers, stacking toast notifications
- **Determinism** — `?seed=12345` replays an identical game

### Not implemented yet

Named honestly, because the board looks more finished than it is:

- **No auctions and no trading.** Declining a property just ends the turn.
- **Building is offered only on your own turn**, where the real game lets you
  develop at almost any point.
- **Bankruptcy does not settle the estate** — a broke player is skipped, but their
  properties are not transferred.
- **Save/load is not wired up**, though the serialiser exists.

Full detail, with reproductions, in [KNOWNISSUES.md](KNOWNISSUES.md); what happens
next is in [ROADMAP.md](ROADMAP.md).

---

## Screenshots

Captured automatically by `npm run screenshots`, which drives the real game in a
headless browser — see [tools/playtest.mjs](tools/playtest.mjs).

| | |
|---|---|
| ![Menu](screenshots/1-menu.png) | ![Board](screenshots/2-board.png) |
| **Setup** — 2–6 players, cycle tokens | **Board** — 40 tiles, colour groups, HUD |
| ![Buy prompt](screenshots/3-buy-prompt.png) | ![Card](screenshots/4-card.png) |
| **Buy prompt** — price, base rent, your cash | **Cards** — Chance and Community Chest |
| ![Jail](screenshots/5-jail.png) | ![Late game](screenshots/6-late-game.png) |
| **Jail** — entered by card, HUD shows the state | **Later** — owner bands on the tiles, cash diverging |
| ![Property panel](screenshots/7-property-panel.png) | |
| **Property panel** — rent ladder, costs, build and mortgage actions | |

---

## Where this is going — from game to engine

Monopoly Forge is meant to end up as an **engine for Monopoly-style games**: bring
your own board, your own rules, your own artwork, and the engine runs the game.
Three axes of customisation, none of which should require editing engine code:

| Axis | What you should be able to supply |
|---|---|
| **Maps** | A board of any length and shape — not 40 tiles in a square — with your own tiles, groups, prices and named anchors (where "jail" is, where "start" is). *Length and anchors already work; the shape is still a square* |
| **Rules** | New tile types and card effects registered from outside, and a rule set that decides turn order, jail terms, building rules and win conditions |
| **Presentation** | How each element draws — tiles, tokens, cards, HUD — swapped per theme, without touching the rules |

**Writing the classic game first was the point, not a detour.** A configurable
engine whose only consumer is a toy proves nothing; the standard board is the
reference implementation that says what the engine has to be able to express, and
it is what the 154 unit tests pin down.

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
[ROADMAP.md](ROADMAP.md).

---

## Architecture

The rule the codebase is built around: **a model class never imports a scene.**
State changes are announced on a typed event bus and the scenes react to them.

```
      ┌──────────────── model (no Phaser, no DOM) ────────────────┐
      │  Board · Player · Dice · Bank · TurnManager · CardDeck    │
      │  Tile ▸ PropertyTile · SpecialTiles   PRNG · SaveLoad     │
      └──────────────────────────┬───────────────────────────────┘
                                 │  bus.emit('rent:pay', …)
                          ┌──────▼──────┐
                          │  EventBus   │   typed pub/sub singleton
                          └──────┬──────┘
                                 │  bus.on('rent:pay', …)
      ┌──────────────────────────▼───────────────────────────────┐
      │  scenes: Boot · Menu · Game · UI · Card                  │
      │  ui: DiceView · PlayerPanel · Notification               │
      └──────────────────────────────────────────────────────────┘
```

Three consequences worth the trouble:

**The model runs in Node.** `src/config.ts` deliberately contains no Phaser
import — the `Phaser.Game` options live in `main.ts` instead — so everything under
`game/`, `tiles/`, `cards/` and `utils/` is reachable from a plain Node process.
That is what lets 154 unit tests run in ~8 s with no jsdom, and it is the seam a
headless AI opponent would plug into.

**Games are reproducible.** Every dice roll and both deck shuffles draw from one
seeded Mulberry32 generator (`src/utils/PRNG.ts`). `?seed=20260512` replays a game
exactly — the screenshot run above produces byte-identical final state on every
invocation, which is what makes the playtest harness a usable regression check.

**The debug trace is still in the code, and switchable.** The turn/card/jail
logging that found most of the bugs in [DEVLOG.md](DEVLOG.md) routes through
`src/utils/log.ts`: silent by default, on automatically under `npm run dev`, and
available on any build — including the deployed demo — with `?debug=1`.

### Layout

```
src/
├── main.ts               Phaser bootstrap, debug-logging switch
├── config.ts             The classic map, tile sizes, economy constants  [no Phaser]
├── game/
│   ├── Board.ts          Tile registry, anchors by role, layout maths, validated getTile/move
│   ├── Player.ts         Position, cash, holdings, jail state
│   ├── Dice.ts           Rolls via the seeded PRNG
│   ├── Bank.ts           Transfers, purchase, mortgage, house/hotel stock
│   ├── BuildRules.ts     Colour-group, even-building and mortgage legality
│   ├── Rent.ts           What a tile charges: monopolies, railroads, utilities
│   └── TurnManager.ts    Phase FSM, doubles, jail, turn order
├── tiles/                Tile base class ▸ PropertyTile, SpecialTiles, Ownable
├── cards/CardDeck.ts     Deck, discard/reshuffle, CardEffects, both decks
├── scenes/               Boot, Menu, Game (tokens + wiring), UI (HUD), Card
├── ui/                   BoardRenderer, PropertyPanel, DiceView, PlayerPanel, Notification
└── utils/                EventBus, PRNG, SaveLoad, log
tests/                    Vitest — model only, plain Node
tools/playtest.mjs        Plays the built game in a real browser
```

---

## Quick start

Requires **Node 22.12+** (see [.nvmrc](.nvmrc)); any bundled npm 10 or 11 works.

```bash
npm install
npm run dev        # dev server on http://localhost:3000 (debug logging on)
npm run build      # typecheck + production build → dist/
npm run preview    # serve the production build locally
```

`vite.config.ts` sets `base: './'`, so a build works unchanged from the dev
server, from `preview`, and from a GitHub Pages project sub-path.

### Reproducing a game

Append `?seed=<integer>` to the URL to re-seed the generator — the same seed gives
the same dice and the same card order every time. `?debug=1` turns the full turn
trace back on. They combine:

```
http://localhost:3000/?seed=20260512&debug=1
```

---

## Tests

```bash
npm test                # 154 unit tests, plain Node, ~8 s
npm run typecheck       # tsc --noEmit
npm run playtest        # build first: plays 30 seeded turns in a headless browser
npm run screenshots
npm run verify:install  # would CI's npm accept this lockfile?
```

**Unit tests** (`tests/`) cover the model, and lean deliberately towards the bugs
recorded in [DEVLOG.md](DEVLOG.md) — the positive-modulo fix that stops
`tiles[-1]`, dice never leaving 1–6, deck exhaustion and reshuffling, the jail
state machine, bank stock conservation, and the re-entry guard around ending a
turn.

**The playtest harness** (`tools/playtest.mjs`) serves the production build, opens
it in headless Chromium, clicks its way through a seeded game, and fails on any
console error, page exception, failed request or inconsistent end state. Both run
in CI, on Linux and Windows.

**`verify:install`** (`tools/verify-install.mjs`) answers a question a local
`npm ci` cannot: *would CI's npm accept this lockfile?* It fetches the npm bundled
with the Node version in `.nvmrc` — which is not necessarily the npm you develop
with — and checks lockfile agreement, tree consistency, and whether any declared
dependency has been installed at two different majors. Run it whenever
`package.json` or `package-lock.json` changes.

---

## Roadmap and known limitations

- [ROADMAP.md](ROADMAP.md) — what is planned, and what is deliberately deferred
  (with the reasons — save/load in particular is blocked on more than a button)
- [KNOWNISSUES.md](KNOWNISSUES.md) — measured defects in the current build
- [DEVLOG.md](DEVLOG.md) — the design decisions and the bug hunts behind them
- [CLAUDE.md](CLAUDE.md) — conventions and invariants for working in this codebase

The short version: the rules engine is solid and tested, and a full game of buy →
develop → charge rent is now playable. What is missing is the multiplayer
interaction — auctions, trading and a real bankruptcy settlement.

---

## Contributing

Issues and pull requests are welcome. Two conventions matter more than style:

1. **Cross-module communication goes through `EventBus`** — never import a scene
   from a model class.
2. **Keep the model free of Phaser.** Anything under `game/`, `tiles/`, `cards/`
   or `utils/` must stay runnable in Node, so it stays testable. `npm test` fails
   loudly if that breaks.

New tile types extend `Tile` and implement `onLand()`; new card effects extend the
`CardAction` union in `cards/CardDeck.ts`. A third convention is worth knowing
before touching the economy: `Bank` executes, it does not adjudicate — anything
that builds, sells or mortgages checks `game/BuildRules.ts` first. Run `npm test`
and `npm run playtest` before opening a PR.

---

## Licence and attribution

[MIT](LICENSE) © Dimitriuses.

No third-party assets: the board, tokens, dice and cards are all drawn
procedurally with Phaser's `Graphics` API, and the only runtime dependency is
[Phaser 3](https://phaser.io/) (MIT). The tile names are the classic Atlantic City
street names; this is an independent hobby implementation and is not affiliated
with or endorsed by Hasbro.
