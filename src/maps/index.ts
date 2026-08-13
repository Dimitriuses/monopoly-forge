import { CLASSIC_MAP } from './classic';
import { ROUND_MAP, ORBIT_MAP } from './alternates';
import { validateMap, type GameMap } from './GameMap';
import { CHANCE_CARDS, COMMUNITY_CHEST_CARDS, type Card } from '@/cards/CardDeck';

export type { GameMap, MapProblem } from './GameMap';
export { validateMap } from './GameMap';
export { CLASSIC_MAP } from './classic';
export { ROUND_MAP, ORBIT_MAP } from './alternates';

/** Every map this build ships, by id. `?map=<id>` picks one. */
export const MAPS: Record<string, GameMap> = {
  [CLASSIC_MAP.id]: CLASSIC_MAP,
  [ROUND_MAP.id]:   ROUND_MAP,
  [ORBIT_MAP.id]:   ORBIT_MAP,
};

export const DEFAULT_MAP = CLASSIC_MAP;

/**
 * The decks a map deals from. A card that names a tile only makes sense on the
 * board it was written for, so a map may bring its own; the classic decks are
 * the fallback for a map that does not care.
 */
export function decksFor(map: GameMap): { chance: Card[]; community: Card[] } {
  return map.cards ?? { chance: CHANCE_CARDS, community: COMMUNITY_CHEST_CARDS };
}

/**
 * Look a map up by id, falling back to the classic board. A map that fails
 * validation is refused rather than half-loaded — a board with a broken colour
 * group is a worse outcome than the one you did not ask for.
 */
export function mapById(id: string | null | undefined): GameMap {
  if (!id) return DEFAULT_MAP;
  const map = MAPS[id];
  if (!map) {
    console.error(`[maps] no map called "${id}" — falling back to ${DEFAULT_MAP.id}`);
    return DEFAULT_MAP;
  }
  const problems = validateMap(map);
  if (problems.length) {
    console.error(
      `[maps] "${id}" is not loadable:\n` +
      problems.map((p) => `  ${p.where}: ${p.problem}`).join('\n'),
    );
    return DEFAULT_MAP;
  }
  return map;
}
