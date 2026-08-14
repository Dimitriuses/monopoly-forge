import { CLASSIC_MAP } from '@/maps';
import { CHANCE_CARDS, COMMUNITY_CHEST_CARDS } from '@/cards/CardDeck';
import { deriveMap, replacingTypes, withoutCards } from '../compose';
import type { Game } from '../Game';
import houseArt from './house.svg';
import hotelArt from './hotel.svg';

// ─── Pocket ───────────────────────────────────────────────────────────────────
// The classic board with the two utilities turned into Community Chest squares,
// a deck trimmed to match, a forty-round limit and the Free Parking jackpot on.
// A shorter, simpler game — and the worked example the authoring guide walks
// through (docs/authoring-a-game.md), because it is the one game that uses every
// part of M9: composition, a rule set, a win condition and its own artwork.
//
// The interesting thing about writing it was that the engine *made* the deck get
// trimmed. Swap the utilities out and `validateGame` refuses:
//
//   chance card "ch5": looks for the nearest "utility", and this board has none
//
// which is exactly the check earning its place. A board whose own cards cannot
// resolve is not a game, and the composition helpers cannot be used to make one
// by accident.

/**
 * Every utility becomes a Community Chest square. Note that the *replacement*
 * decides everything about the new tile — `deriveMap` forces the id back on, but
 * a price or a rent ladder left behind would linger.
 */
const POCKET_MAP = deriveMap(CLASSIC_MAP, {
  id: 'pocket',
  name: 'Pocket',
  blurb: '40 tiles, no utilities, and it is over in forty rounds',
  swap: replacingTypes(['utility'], (tile) => ({
    id: tile.id, type: 'communityChest', name: 'Community Chest',
  })),
});

/** The cards that name a utility, and the two long walks that suit a longer game. */
const POCKET_CHANCE = withoutCards(CHANCE_CARDS, 'ch5', 'ch2', 'ch3');

export const POCKET_GAME: Game = {
  id: 'pocket',
  name: 'Pocket',
  blurb: '40 tiles, no utilities, and it is over in forty rounds',
  map: POCKET_MAP,
  cards: { chance: POCKET_CHANCE, community: COMMUNITY_CHEST_CARDS },
  rules: {
    // Forty rounds, then the largest estate takes it. The simulator put the
    // classic game's median at 57 rounds, so this is deliberately the short one.
    winCondition: 'roundLimit',
    roundLimit: 40,
    // Taxes and fines pool on Free Parking, which pays back some of what a
    // shorter game takes out of the middle of the board.
    freeParkingJackpot: true,
  },
  // Its own artwork, drawn for this repo rather than brought from anywhere.
  // These keys are the ones `BoardRenderer` already asks for, so nothing needs a
  // second lookup path — and `bakeBuildingTextures` steps aside for them.
  assets: { house: houseArt, hotel: hotelArt },
};
