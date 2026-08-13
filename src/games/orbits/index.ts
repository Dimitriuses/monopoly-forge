import { ORBIT_MAP } from '@/maps';
import { GENERIC_CHANCE, GENERIC_CHEST } from '../decks';
import type { Game } from '../Game';

// ─── Orbits ───────────────────────────────────────────────────────────────────
// 30 tiles across three concentric rings, and the least ordinary game that
// ships: the circuit spirals inward and jumps back out to GO, which looks as odd
// as it sounds and is precisely why it is a good test.
//
// It is also the one that shows a game tuning more than one thing at once — a
// shorter, tighter board with fewer houses to go round, so a monopoly is worth
// more and the race for the last of them starts earlier.

export const ORBITS_GAME: Game = {
  id: 'orbits',
  name: 'Orbits',
  blurb: '30 tiles across three concentric rings',
  map: ORBIT_MAP,
  cards: { chance: GENERIC_CHANCE, community: GENERIC_CHEST },
  rules: { startingCash: 1400, houseLimit: 24, hotelLimit: 8 },
  // A game may name the palette it looks best in, and this one does — which is
  // also the only reason `Game.theme` is a field rather than a plan. The player's
  // own choice still outranks it.
  theme: 'parchment',
};
