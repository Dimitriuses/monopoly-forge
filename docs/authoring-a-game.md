# Authoring a game

A game in Monopoly Forge is a folder. It holds a board, the economy that board is
balanced for, the deck it deals, the variants it is played with, the palette it
prefers and any artwork it brings — and the menu picks it as one choice.

This guide walks through writing one. The worked example is
[`src/games/pocket/`](../src/games/pocket/index.ts), which ships: the classic
board with the utilities taken out, a trimmed deck, a forty-round limit and its
own house and hotel. Every capability described here is used by that one file.

The last section is the one that matters most, and it is the reason this guide
was written after the simulator rather than before it: **you can check whether
your game works before anybody plays it.**

---

## 1. The shortest game that works

```ts
// src/games/tiny/index.ts
import { CLASSIC_MAP } from '@/maps';
import type { Game } from '../Game';

export const TINY_GAME: Game = {
  id: 'tiny',
  name: 'Tiny',
  blurb: 'the classic board and nothing else',
  map: CLASSIC_MAP,
};
```

That is a complete game. It inherits the classic rules, the classic decks and the
default theme, because everything except `id`, `name`, `blurb` and `map` is
optional. Register it in [`src/games/index.ts`](../src/games/index.ts) and it
appears on the menu and at `?game=tiny`.

A board of your own is [`GameMap`](../src/maps/GameMap.ts) — tiles in circuit
order and the shape they are laid out in (`square`, `ring` or concentric
`rings`). A map has no economy and no deck; those belong to the game.

## 2. Deriving from a game that already exists

Most new games are an old one with something changed. Two helpers in
[`games/compose.ts`](../src/games/compose.ts) do the changing, and one rule
shapes both: **a derived board keeps its length and its ids.** Removing a tile
would renumber every tile after it and break every card that names a square, so
`deriveMap` *replaces* rather than removes.

```ts
const POCKET_MAP = deriveMap(CLASSIC_MAP, {
  id: 'pocket',
  name: 'Pocket',
  blurb: '40 tiles, no utilities, and it is over in forty rounds',
  swap: replacingTypes(['utility'], (tile) => ({
    id: tile.id, type: 'communityChest', name: 'Community Chest',
  })),
});
```

"No utilities" is a board where each utility is something else, not a board that
is two tiles shorter.

### The engine will make you finish the job

Write only that much and the game is refused:

```
[games] "pocket" is not loadable:
  chance card "ch5": looks for the nearest "utility", and this board has none
```

That is `validateGame` earning its place. The classic deck has a card that
advances to the nearest utility, and there are none left. A board whose own cards
cannot resolve is not a game, so the deck has to be trimmed too:

```ts
const POCKET_CHANCE = withoutCards(CHANCE_CARDS, 'ch5', 'ch2', 'ch3');
```

`withoutCards` refuses an id the deck does not have, because a typo that silently
removes nothing is worse than one that stops the build. There is also
`portableCards`, which keeps only the cards that name no place at all — useful
when your board looks nothing like the classic one.

## 3. Rules, variants and how the game ends

`rules` is a partial [`GameRules`](../src/game/Rules.ts), layered over the classic
defaults; the player's menu switches then layer over yours. Numbers — starting
cash, the GO salary, the jail fine and term, the house supply — are just fields.

Two fields are *names of registered strategies* rather than numbers:

```ts
rules: {
  winCondition: 'roundLimit',   // or 'lastSolvent', the default
  roundLimit: 40,
  turnOrder: 'seat',            // or 'reverse'
  freeParkingJackpot: true,
}
```

and `variants` names bundles that change the shape of a turn:

```ts
variants: ['speedDie'],   // a third die, and an extra step in the turn
```

Both are strings rather than functions, because the rule set is saved with the
game and a function does not survive `JSON.stringify`. A build that does not have
the strategy you named refuses the game, and refuses a *save* of it too.

### A round limit is two different tools

The same field does two jobs, and the simulator tells you which one you have
built. Of the games that ship:

| | limit | decided by bankruptcy | what the limit is |
|---|---|---|---|
| Roundabout | 80 rounds | 97% | a **safety net** — it fires in 3% of games, and only on the ones that would otherwise run for ever |
| Ultimate | 120 rounds | 98% | a safety net on a much longer board |
| Pocket | 40 rounds | 22% | the **rule of the game** — a timed race that a knockout sometimes ends early |

Neither is wrong. What would be wrong is not knowing which you had.

## 4. Bringing artwork

Every texture in this repo is drawn at runtime. That is deliberate: it keeps the
project free of third-party art and the licence questions that come with it, and
it is why the default is *no assets at all*.

A game that wants a picture brings its own:

```ts
import houseArt from './house.svg';
import hotelArt from './hotel.svg';

assets: { house: houseArt, hotel: hotelArt },
```

The keys are the ones the renderer already asks for — `house`, `hotel`,
`token_car` and the rest — so supplying one replaces the drawn version and
nothing needs a second lookup path. `bakeBuildingTextures` and
`bakeTokenTextures` step aside for anything a game supplied, so changing theme
mid-menu does not paint over your artwork.

**Import the file; do not write a path.** The bundler hashes it, which is what
makes the URL right from the dev server, from `vite preview` and from a project
sub-path on GitHub Pages alike.

Bring your own licence with your own art. Pocket's two SVGs were drawn for this
repo by hand, which is the only reason they are in it.

## 5. Tile types and card effects of your own

If your game needs a kind of tile the engine has never heard of, register it —
and register it in `Game.register`, not at module scope:

```ts
register() {
  registerTileType('tollBooth', (def) => new TollBoothTile(def));
  registerCardEffect('teleport', (ctx, action, player) => { /* … */ });
},
```

`loadGame` resets every registry to the built-ins and then calls this, so two
games cannot get each other's tile types. Registering at module scope still
works and still leaks — it is how the *built-ins* are registered, and that is the
only thing it is for.

This is serial isolation: one game live at a time. It is what lets the simulator
load one game after another in a single process without their registrations
mixing.

## 5b. A board that is not one loop

`layout` is how a board is *drawn* — `square`, `ring`, `rings` (concentric
circles) or `squares` (concentric squares). `tracks` is how it is *walked*, and
the two are independent: Orbits is three rings of one circuit, Ultimate Monopoly
is three nested squares that really are three loops, and nothing stops you
drawing three loops as one square.

```ts
tracks: [
  { id: 'middle', from: 0,  count: 40 },
  { id: 'outer',  from: 40, count: 56 },
  { id: 'inner',  from: 96, count: 24 },
],
junctions: [
  { a: 47, b: 5 },     // a railroad and the transit station beside it
],
rules: { movement: 'tracks' },
```

A **junction is two tiles that are one space.** Stepping off either of them with
`crossing` set continues from the *other*, and `TurnManager` sets `crossing` from
the parity of the roll — so an even roll that takes you past a transit station
rides it to the next track and an odd one does not. That is one rule, and it is
the whole of Ultimate Monopoly's movement.

Three things to know before you use it:

- **Tracks must tile the board end to end**, in order, no gaps. A tile on no
  track is a tile a player can walk onto and never leave, so `validateMap`
  refuses it — as it refuses a junction joining a track to itself, and a game
  that declares tracks while naming `movement: 'circuit'`.
- **GO should be tile 0.** `Player` starts there and `TurnManager` sanitises a
  corrupt position to it. Ultimate Monopoly lists its middle track first for
  exactly this reason, even though it is drawn second.
- **Distance stops being subtraction.** Use `board.pathTo(from, to)` and
  `board.scan(from, predicate)`; both are breadth-first and both return what the
  arithmetic did on a single circuit.

## 5c. A tile whose rule mentions somebody else

`Tile.onLand(playerId)` gets an id. That is enough for a lot, a tax or a card
tile, and not enough for "collect $50 from every other player" — a tile can see
neither the players nor the board.

Those are **tile effects**, and they are the same shape as card effects:

```ts
registerTileEffect('squeezePlay', (ctx, player, { tileId }) => {
  for (const other of ctx.players) {
    if (other.id === player.id || other.isBankrupt) continue;
    ctx.charge(other, player, 50);
  }
  bus.emit('player:landed', { playerId: player.id, tileId });
});
```

The tile itself just asks: `bus.emit('tile:effect', { playerId, tileId, effect })`.
Both drivers resolve it with the context they already build for a landing, so the
rule cannot behave one way animated and another way headless.

An effect **finishes the landing the way any tile does** — `player:landed`, or a
move whose walk resolves it. Do not call `onLand` yourself, and if your effect
moves a player onto a tile of the same kind, guard against it: two Holland
Tunnels each sending you to the other is an infinite loop, and it is how Ultimate
Monopoly's first run ended.

## 5d. More than eight colour groups

`ColorGroup` is open, so `group: 'saltLake'` is a colour group. You do not have to
register anything: a group no theme names is drawn in a colour **derived from its
name**, in the current theme's own saturation and lightness, and the same name
always gives the same colour.

If you want particular colours, ship a theme:

```ts
export const MY_THEME: Theme = {
  ...CLASSIC_THEME, id: 'mine', name: 'Mine',
  groups: { ...CLASSIC_THEME.groups, saltLake: 0xc99a2e },
};
registerTheme(MY_THEME);
```

Register it at module scope, not from `Game.register` — a theme is not scoped to
a game, and the menu resolves `Game.theme` by id before anything is loaded.

## 6. Check it before anybody plays it

This is the part that would have been guesswork before the simulator existed.

```bash
npm run simulate -- --game pocket --games 500
```

```
  pocket
    turns          median 183  ·  p10 143  ·  p90 194  ·  longest 201
    rounds         median 40
    unfinished     0
    house shortage 4% of games
    decided by     22% bankruptcy, 78% the win condition
    built at end   7.0 houses, 3.5 hotels
    auctions       median 2   trades  median 5
    wins by seat   49 / 48 / 65 / 38   (seat 1: 25%)
```

What to read in it:

- **`unfinished`** — games that outran the turn cap. Monopoly genuinely does not
  always terminate: four players who never complete a colour group build nothing,
  so rent never rises above the salary and nobody can go under. About 5% of
  classic games do this. If *your* game does it much more often, the board or the
  economy is the reason, and a `roundLimit` is the blunt fix.
- **`built at end`** — a Monopoly where nothing is ever built is a dice game.
  Near-zero here means the groups are too big, the houses too dear, or the salary
  too small relative to them.
- **`decided by`** — see the table above.
- **`wins by seat`** — should be roughly even. It never quite is (the first two
  seats of four take about 60% even on the classic board), but a *large* skew
  means something about your board favours going early.
- **`house shortage`** — how often the bank runs out, which is when the
  contested-house auction comes into play.

The batch also checks six invariants after every turn of every game — positions,
cash, both halves of ownership agreeing, the building census, the deck census, and
that a bankrupt player holds nothing. It exits non-zero if any of them breaks,
which is how a card that silently left the game was found.

Useful flags while tuning:

```bash
npm run simulate -- --game pocket --games 1000 --seed 500   # a different sample
npm run simulate -- --game pocket --players 3               # a different table
npm run simulate -- --game pocket --round-limit 60          # try a limit on
npm run simulate -- --game pocket --json                    # numbers, not prose
```

And to watch a game rather than count it:

```bash
npm run build && npm run playtest -- --game pocket --bots --headed
```

## 7. What the engine refuses

`validateGame` runs before your game is handed to anything, and a game that fails
it is refused rather than half-loaded — the classic game is loaded in its place.
It checks:

- everything that makes a **board** coherent: ids matching the circuit, a `go` and
  a `jail` tile, colour groups of at least two lots that agree on their house
  cost, a rent ladder and a price on every lot, and a shape the tile count can
  actually make;
- everything that makes a **pairing** coherent: no card naming a tile the board
  does not have, no card looking for the nearest tile of a type it lacks, and no
  rule set naming a turn order, win condition or variant this build has not
  registered.

The order matters and is deliberate: a game is **loaded before it is validated**,
because validation asks whether its tile types are registered — a question only
answerable once its own registrations are in force.

## 8. Checklist

1. `src/games/<id>/index.ts` exporting a `Game`.
2. Register it in `src/games/index.ts`.
3. `npm run typecheck` — the shape is checked at compile time.
4. `npm run simulate -- --game <id> --games 500` — does it validate, terminate,
   and get built on?
5. `npm run build && npm run playtest -- --game <id> --bots` — does it play in a
   real browser?
6. Add it to the games table in [README.md](../README.md).
