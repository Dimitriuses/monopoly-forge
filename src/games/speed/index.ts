import { CLASSIC_MAP } from '@/maps';
import { CHANCE_CARDS, COMMUNITY_CHEST_CARDS } from '@/cards/CardDeck';
import type { Game } from '../Game';

// ─── Classic, with the speed die ──────────────────────────────────────────────
// The same board and the same deck as `classic`, played with the third die. It
// exists to show what a bundle is actually *for*: two games can differ in one
// field and share everything else, and neither has to be a special case in the
// engine or a switch on the menu.
//
// Before M9a this was not a game at all — it was the classic board plus a chip
// you had to remember to tick, and there was no way to hand somebody "the one
// with the speed die".

export const SPEED_GAME: Game = {
  id: 'speed',
  name: 'Speed Die',
  blurb: 'The classic board, played with the third die',
  map: CLASSIC_MAP,
  cards: { chance: CHANCE_CARDS, community: COMMUNITY_CHEST_CARDS },
  variants: ['speedDie'],
};
