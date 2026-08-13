import { ROUND_MAP } from '@/maps';
import { GENERIC_CHANCE, GENERIC_CHEST } from '../decks';
import type { Game } from '../Game';

// ─── Roundabout ───────────────────────────────────────────────────────────────
// 24 tiles on a single circle. The board proves the geometry is not hardcoded;
// the rule set here is what proves an *economy* travels with a game rather than
// being a global constant — this is the file that used to be three lines inside
// `ROUND_MAP`, which was a board declaring how much money you start with.

export const ROUNDABOUT_GAME: Game = {
  id: 'roundabout',
  name: 'Roundabout',
  blurb: '24 tiles on a single circle — no corners at all',
  map: ROUND_MAP,
  cards: { chance: GENERIC_CHANCE, community: GENERIC_CHEST },
  // A shorter circuit comes round faster, so the salary is smaller.
  rules: { goSalary: 150, startingCash: 1200 },
};
