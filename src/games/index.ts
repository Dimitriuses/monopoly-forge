import { CHANCE_CARDS, COMMUNITY_CHEST_CARDS, type Card } from '@/cards/CardDeck';
import { validateGame, type Game } from './Game';
import { loadGame } from './scope';
import { CLASSIC_GAME } from './classic';
import { ROUNDABOUT_GAME } from './roundabout';
import { ORBITS_GAME } from './orbits';
import { SPEED_GAME } from './speed';

export type { Game, GameProblem } from './Game';
export { validateGame } from './Game';
export { loadGame, unloadGame, loadedGame } from './scope';
export { CLASSIC_GAME } from './classic';
export { ROUNDABOUT_GAME } from './roundabout';
export { ORBITS_GAME } from './orbits';
export { SPEED_GAME } from './speed';

/** Every game this build ships, by id. `?game=<id>` picks one. */
export const GAMES: Record<string, Game> = {
  [CLASSIC_GAME.id]:    CLASSIC_GAME,
  [ROUNDABOUT_GAME.id]: ROUNDABOUT_GAME,
  [SPEED_GAME.id]:      SPEED_GAME,
  [ORBITS_GAME.id]:     ORBITS_GAME,
};

export const DEFAULT_GAME = CLASSIC_GAME;

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
