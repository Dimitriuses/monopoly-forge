import { CLASSIC_MAP } from '@/maps';
import { CHANCE_CARDS, COMMUNITY_CHEST_CARDS } from '@/cards/CardDeck';
import type { Game } from '../Game';

// ─── Classic ──────────────────────────────────────────────────────────────────
// The Atlantic City circuit the whole project was built to express, and the
// reference implementation for everything the engine claims to be able to do.
//
// It names nothing it does not have to: no `rules`, because the classic rules
// *are* the defaults, and no `variants`. That is the useful thing about it as an
// example — a game is allowed to be a board and a deck.

export const CLASSIC_GAME: Game = {
  id: 'classic',
  name: 'Classic',
  blurb: '40 tiles, four corners, eight colour groups',
  map: CLASSIC_MAP,
  cards: { chance: CHANCE_CARDS, community: COMMUNITY_CHEST_CARDS },
};
