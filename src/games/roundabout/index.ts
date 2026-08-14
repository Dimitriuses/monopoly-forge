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
  rules: {
    // A shorter circuit comes round faster, so the salary is smaller.
    goSalary: 150,
    startingCash: 1200,

    // And it is the quick game, so it ends: after eighty rounds the largest
    // estate wins. That is a design choice made against a measurement rather
    // than a feeling — 300 simulated games put the median at 27 rounds and the
    // 90th percentile at 46, so eighty bounds the tail without touching a
    // typical game, and it removes the 2-in-300 that ran for ever because no
    // monopoly ever formed. See DEVLOG, M8d.
    winCondition: 'roundLimit',
    roundLimit: 80,
  },
};
