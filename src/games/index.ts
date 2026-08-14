import { CHANCE_CARDS, COMMUNITY_CHEST_CARDS, type Card } from '@/cards/CardDeck';
import { resolveRules, type GameRules } from '@/game/Rules';
import { variantRules } from '@/game/Variants';
import { validateGame, type Game } from './Game';
import { loadGame } from './scope';
import { CLASSIC_GAME } from './classic';
import { ROUNDABOUT_GAME } from './roundabout';
import { ORBITS_GAME } from './orbits';
import { SPEED_GAME } from './speed';
import { POCKET_GAME } from './pocket';
import { ULTIMATE_GAME } from './ultimate';

export type { Game, GameProblem } from './Game';
export { validateGame } from './Game';
export { loadGame, unloadGame, loadedGame } from './scope';
export { deriveMap, replacingTypes, withoutCards, portableCards } from './compose';
export { CLASSIC_GAME } from './classic';
export { ROUNDABOUT_GAME } from './roundabout';
export { ORBITS_GAME } from './orbits';
export { SPEED_GAME } from './speed';
export { POCKET_GAME } from './pocket';
export { ULTIMATE_GAME } from './ultimate';

/** Every game this build ships, by id. `?game=<id>` picks one. */
export const GAMES: Record<string, Game> = {
  [CLASSIC_GAME.id]:    CLASSIC_GAME,
  [ROUNDABOUT_GAME.id]: ROUNDABOUT_GAME,
  [SPEED_GAME.id]:      SPEED_GAME,
  [ORBITS_GAME.id]:     ORBITS_GAME,
  [POCKET_GAME.id]:     POCKET_GAME,
  [ULTIMATE_GAME.id]:   ULTIMATE_GAME,
};

export const DEFAULT_GAME = CLASSIC_GAME;

/**
 * The rule set a game is played under: the classic defaults, then the game's
 * own, then whatever the player switched on top.
 *
 * `Game.variants` is folded in here rather than at each call site, which is the
 * bug this function exists because of: the simulator resolved `game.rules` and
 * nothing else, so **Speed Die played without the speed die** — and reported
 * numbers identical to Classic's, which is what gave it away. One place to
 * assemble a rule set means one place for that to be wrong.
 */
export function rulesFor(game: Game, ...overrides: Array<Partial<GameRules> | undefined>): GameRules {
  const own: Partial<GameRules> = { ...game.rules };
  if (game.variants?.length) own.variants = game.variants;

  // Which variants are on has to be settled *first*, because a variant may bring
  // rule values with it — the speed die selects its own triples rule — and those
  // have to be in place before the game's and the player's layer over them. A
  // variant brings a default; it never overrules a choice.
  const chosen = resolveRules(own, ...overrides).variants;
  return resolveRules(variantRules(chosen), own, ...overrides);
}

/** The decks a game deals from; the classic ones for a game that does not care. */
export function decksFor(game: Game): { chance: Card[]; community: Card[] } {
  return game.cards ?? { chance: CHANCE_CARDS, community: COMMUNITY_CHEST_CARDS };
}

/**
 * Look a game up by id and make it the one in force — its registrations applied
 * over the built-ins, everything the last game added dropped.
 *
 * A game that fails validation is refused rather than half-loaded, and the
 * fallback is loaded properly rather than left half-registered: a board with a
 * broken colour group is a worse outcome than the one you did not ask for.
 *
 * Note the order. The game is *loaded* before it is *validated*, because
 * validation asks whether its tile types are registered and its variants known —
 * questions that can only be answered once its own registrations are in force.
 */
export function gameById(id: string | null | undefined): Game {
  if (!id) return loadGame(DEFAULT_GAME);

  const game = GAMES[id];
  if (!game) {
    console.error(`[games] no game called "${id}" — falling back to ${DEFAULT_GAME.id}`);
    return loadGame(DEFAULT_GAME);
  }

  loadGame(game);
  const problems = validateGame(game);
  if (problems.length) {
    console.error(
      `[games] "${id}" is not loadable:\n` +
      problems.map((p) => `  ${p.where}: ${p.problem}`).join('\n'),
    );
    return loadGame(DEFAULT_GAME);
  }
  return game;
}
