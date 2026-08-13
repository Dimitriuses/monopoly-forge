import { CLASSIC_MAP } from './classic';
import { ROUND_MAP, ORBIT_MAP } from './alternates';
import { validateMap, type GameMap } from './GameMap';

export type { GameMap, MapProblem } from './GameMap';
export { validateMap } from './GameMap';
export { CLASSIC_MAP } from './classic';
export { ROUND_MAP, ORBIT_MAP } from './alternates';

/**
 * Every board this build ships, by id.
 *
 * A *board* is no longer what you choose to play — a game is, and a game names
 * one of these. This stays because a map is still a thing worth validating and
 * listing on its own, and because two games could perfectly well deal the same
 * board with different economies.
 */
export const MAPS: Record<string, GameMap> = {
  [CLASSIC_MAP.id]: CLASSIC_MAP,
  [ROUND_MAP.id]:   ROUND_MAP,
  [ORBIT_MAP.id]:   ORBIT_MAP,
};

export const DEFAULT_MAP = CLASSIC_MAP;

/**
 * Look a board up by id, falling back to the classic one. Refused rather than
 * half-loaded when it does not validate — a board with a broken colour group is
 * a worse outcome than the one you did not ask for.
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
