import { validateMap, type GameMap, type MapProblem } from '@/maps';
import { knownTurnOrders, knownWinConditions } from '@/game/TurnFlow';
import { knownVariants } from '@/game/Variants';
import { knownMovements } from '@/game/Movement';
import { knownRollRules } from '@/game/RollRules';
import type { GameRules } from '@/game/Rules';
import type { Card } from '@/cards/CardDeck';

// ─── Game ─────────────────────────────────────────────────────────────────────
// A complete playable thing: a board, the economy it is balanced for, the decks
// it deals from, the variants it is played with and the palette it looks best
// in — one object, one folder, one choice on the menu.
//
// M8 made all of those configurable *separately*. You could supply a board, and
// separately a rule set, and separately a theme, and there was no single thing
// you could hand somebody and call a game. Worse, the parts had started to leak
// into each other: `GameMap` grew `rules` and `cards` in 8b because there was
// nowhere else to put them, so a *board* was declaring an economy.
//
// This is that place. A map went back to being tiles and a shape.
//
// Two boundaries worth stating:
//
//   * **A game is not a save.** The snapshot stores which game was played and
//     the rule set as resolved, not the game object — a build that no longer
//     ships that game refuses the save rather than half-loading it.
//   * **A game does not own the player's choices.** House rules, variants and
//     the theme it names are *defaults*; the menu layers the player's switches
//     over them, and `resolveRules` has always worked that way round.

export interface Game {
  id: string;
  name: string;
  /** One line, shown wherever a game is chosen. */
  blurb: string;
  map: GameMap;
  /**
   * The economy this game is balanced for — starting cash, the GO salary, the
   * jail term, the house supply. Anything left out falls back to the classic
   * rules; the player's switches go on top of both.
   */
  rules?: Partial<GameRules>;
  /**
   * The decks it deals from. A card that names a tile only makes sense on the
   * board it was written for, which is why these belong to the game rather than
   * being global. Left out, the classic decks are used.
   */
  cards?: { chance: Card[]; community: Card[] };
  /** Variants on by default. The menu can add to or remove from these. */
  variants?: string[];
  /** The palette it looks best in, by id. A preference, not a requirement. */
  theme?: string;
  /**
   * Artwork this game brings, as **texture key → URL**. The keys are the ones
   * the renderer already asks for — `house`, `hotel`, `token_car` and the rest —
   * so a game replaces a drawn texture simply by supplying one, and nothing in
   * the renderer needs a second lookup path.
   *
   * The default stays *no assets at all*: every texture in this repo is drawn at
   * runtime, which is what keeps it free of third-party art and the licence
   * questions that come with it. A game that wants a picture brings its own, and
   * its own licence with it.
   *
   * Import the file rather than writing a path — `import house from './house.svg'`
   * — so the bundler hashes it and the URL is right from a dev server, from
   * `vite preview` and from a project sub-path on GitHub Pages alike.
   */
  assets?: Record<string, string>;
  /**
   * Tile types, card effects, turn orders, win conditions and variants this game
   * brings with it. Called once when the game is loaded, with every registry
   * reset to the built-ins first — see `games/scope.ts`. Anything registered
   * here belongs to this game and cannot leak into the next one.
   */
  register?(): void;
}

export interface GameProblem extends MapProblem {}

/**
 * Whether a game hangs together. Board coherence is `validateMap`'s job and
 * always was; what is checked here is everything that only makes sense once the
 * parts are put *together* — a deck against the board it deals onto, a rule set
 * against the strategies this build has registered.
 *
 * A game's own registrations have to be in force before this runs, or its tile
 * types look unregistered and its variants look unknown. `gameById` does that.
 */
export function validateGame(game: Game): GameProblem[] {
  const problems: GameProblem[] = [...validateMap(game.map)];
  const complain = (where: string, problem: string) => problems.push({ where, problem });

  if (!game.id?.trim())   complain('game', 'has no id');
  if (!game.name?.trim()) complain(game.id || 'game', 'has no name');

  problems.push(...validateDecks(game));

  // ── The rule set names strategies this build has to have ────────────────────
  const rules = game.rules;
  if (rules?.turnOrder && !knownTurnOrders().includes(rules.turnOrder)) {
    complain(game.id, `asks for turn order "${rules.turnOrder}", which is not registered`);
  }
  if (rules?.winCondition && !knownWinConditions().includes(rules.winCondition)) {
    complain(game.id, `asks for win condition "${rules.winCondition}", which is not registered`);
  }
  if (rules?.rollRule && !knownRollRules().includes(rules.rollRule)) {
    complain(game.id, `asks for roll rule "${rules.rollRule}", which is not registered`);
  }
  if (rules?.movement && !knownMovements().includes(rules.movement)) {
    complain(game.id, `asks for movement "${rules.movement}", which is not registered`);
  }
  // A board with loops that nothing walks across is a board with one loop and a
  // lot of misleading data, so say so rather than quietly playing it as a circuit.
  if (game.map.tracks?.length && (rules?.movement ?? 'circuit') === 'circuit') {
    complain(game.id, 'declares tracks but is played with "circuit" movement, which ignores them');
  }
  for (const variant of [...(game.variants ?? []), ...(rules?.variants ?? [])]) {
    if (!knownVariants().includes(variant)) {
      complain(game.id, `asks for variant "${variant}", which is not registered`);
    }
  }

  return problems;
}

/**
 * A card that says "advance to tile 39" is nonsense on a 24-tile board. This is
 * the check that stops a deck being paired with a board it was not written for,
 * and it lives here rather than in `validateMap` because it is a statement about
 * a *pairing* — the same deck is perfectly valid next to a different board.
 */
function validateDecks(game: Game): GameProblem[] {
  if (!game.cards) return [];
  const problems: GameProblem[] = [];
  const size = game.map.tiles.length;

  for (const [pile, cards] of Object.entries(game.cards)) {
    for (const card of cards) {
      const action = card.action as { type: string; tile?: number; kind?: string };
      if (action.type === 'advanceTo' && (action.tile === undefined || action.tile >= size)) {
        problems.push({
          where: `${pile} card "${card.id}"`,
          problem: `sends the player to tile ${action.tile}, which this ${size}-tile board does not have`,
        });
      }
      if (action.type === 'advanceToNearest'
          && !game.map.tiles.some((t) => t.type === action.kind)) {
        problems.push({
          where: `${pile} card "${card.id}"`,
          problem: `looks for the nearest "${action.kind}", and this board has none`,
        });
      }
    }
  }
  return problems;
}
