# Architecture

How the pieces fit together, and the file layout. Split out of the README so that
file can stay a front page; the rules a change has to respect are in
[CLAUDE.md](../CLAUDE.md), and [authoring a game](authoring-a-game.md) is the
worked example of adding one.

---

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
That is what lets 527 unit tests run in ~8 s with no jsdom, and it is the seam a
headless AI opponent would plug into.

**Games are reproducible.** Every dice roll and both deck shuffles draw from one
seeded Mulberry32 generator (`src/utils/PRNG.ts`). `?seed=20260512` replays a game
exactly — the screenshot run above produces byte-identical final state on every
invocation, which is what makes the playtest harness a usable regression check.

**The debug trace is still in the code, and switchable.** The turn/card/jail
logging that found most of the bugs in [DEVLOG.md](../DEVLOG.md) routes through
`src/utils/log.ts`: silent by default, on automatically under `npm run dev`, and
available on any build — including the deployed demo — with `?debug=1`.

### Layout

```
src/
├── main.ts               Phaser bootstrap, debug-logging switch
├── config.ts             Tile sizes, economy constants, house rules  [no Phaser]
├── games/                **A game is a folder**: board + economy + deck + theme
│                         classic, roundabout, speed, orbits, pocket, ultimate
│                         Game + validateGame · compose.ts — derive one from another
│                         scope.ts — whose registrations are in force
├── maps/                 GameMap + validateMap; classic, round and orbit boards
├── game/
│   ├── Rules.ts          The rule set: classic → the map's → the player's
│   ├── Board.ts          Tile registry, anchors by role, validated getTile/move
│   ├── BoardLayout.ts    Turns a map's shape into tile coordinates
│   ├── Player.ts         Position, cash, holdings, jail state
│   ├── Holdings.ts       Countable things a *game* invents — travel vouchers,
│   │                     tickets, shares: saved, traded, transferred, counted
│   ├── Dice.ts           Rolls via the seeded PRNG
│   ├── Bank.ts           Transfers, purchase, mortgage, house/hotel stock
│   ├── BuildRules.ts     Colour-group, even-building and mortgage legality
│   ├── Rent.ts           What a tile charges: monopolies, railroads, utilities
│   ├── Auction.ts        Round-robin bidding over a subject, reserve, settlement
│   ├── Contention.ts     Who is claiming the bank's last houses, and where one goes
│   ├── Variants.ts       Variant registry: a rule set's own dice and turn steps
│   ├── SpeedDie.ts       The speed die, built entirely on those two seams
│   ├── Trade.ts          Two-sided offers: validation, netting, counters
│   ├── Estate.ts         Fire sales, debt settlement, bankruptcy transfer
│   ├── Snapshot.ts       Capture/restore the whole game, and validate a save
│   ├── Landing.ts        What a landing costs — shared by both drivers
│   ├── Bot.ts            Opponent decisions — no Phaser, no randomness
│   ├── TurnFlow.ts       A turn's phases, plus the turn-order and win-condition
│   │                     registries a rule set picks from by name
│   └── TurnManager.ts    Walks the flow: rolling, moving, jail, handing over
├── tiles/                Tile base class ▸ PropertyTile, SpecialTiles, Ownable,
│                         registry (registerTileType)
├── cards/                Deck, discard/reshuffle, CardEffects, the classic decks,
│                         effects registry (registerCardEffect)
├── scenes/               Boot, Menu, Game (tokens + wiring), UI (HUD), Card
├── ui/                   Theme + TileDecor (the palette and per-type drawing),
│                         Retained (panels update in place), BoardRenderer,
│                         PropertyPanel, AuctionPanel, TradePanel, DiceView,
│                         PlayerPanel, Notification (turn log), Textures, Sfx
├── sim/                  The headless driver — Runner, Invariants, Report
└── utils/                EventBus, PRNG, SaveLoad, Registry, log
tests/                    Vitest — model only, plain Node
tools/playtest.mjs        Plays the built game in a real browser
tools/simulate.ts         Plays it a thousand times with no browser at all
docs/authoring-a-game.md  How to write one of your own
```

`src/games/` is the top of that tree, and everything under it is a part a game
assembles. Four ship, and two of them — **Classic** and **Speed Die** — share a
board and a deck and differ in one field, which is the shortest way to say what a
bundle is for. Loading a game is also what puts its tile types and card effects in
force: the registries are scoped to it, so a batch runner can load one game after
another without them treading on each other.

---

