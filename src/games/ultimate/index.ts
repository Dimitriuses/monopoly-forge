import { CHANCE_CARDS, COMMUNITY_CHEST_CARDS, type Card } from '@/cards/CardDeck';
import type { Game } from '../Game';
import { ULTIMATE_MAP } from './board';
import { registerUltimateTiles } from './tiles';
import './theme';

// ─── Ultimate Monopoly ────────────────────────────────────────────────────────
// A fan-made synthesis of Classic Monopoly, Mega Edition, Super Add-Ons and
// Stock Exchange, played on 120 tiles across three tracks. It is in this repo as
// an *experiment*: the hardest board anybody has asked the engine to express,
// picked precisely because it was not designed with this engine in mind.
//
// What it needed that the engine did not have, and now does:
//
//   * **A board that is not one loop.** `game/Movement.ts` — the step forward
//     became a named strategy, `move` reports the route it walked, and a map may
//     declare `tracks` and `junctions`. This was the whole reason.
//   * **A tile whose rule mentions somebody else.** `game/TileEffects.ts` — Squeeze
//     Play collects from every player and Auction picks from the whole board, and
//     `onLand(playerId)` can see neither.
//   * **More than eight colour groups.** `ColorGroup` opened, and a theme now
//     derives a colour for a group it has never heard of.
//   * **Two tiers of unimproved group rent.** `monopolyRent` and `majorityRent`,
//     because holding all but one lot of a big group pays here.
//
// What it still cannot have is in KNOWNISSUES and comes down to one thing: **a
// game cannot add state to a player.** Travel vouchers, stock certificates and
// Roll Three cards are all things you hold, and there is nowhere to hold them
// and nothing in the snapshot to save them. Each of those rules ships as the
// nearest version that needs no held card — spent at once instead of kept — and
// each says so where it is written.

/**
 * "Advance to Reading Railroad" means tile 5 on the classic board, and tile 5
 * here is the transit station the railroad left behind when it moved outward.
 * Re-pointed rather than dropped: the card is still exactly the card, it is the
 * railroad that moved.
 */
const READING = 47;

const ULTIMATE_CHANCE: Card[] = CHANCE_CARDS.map((card) =>
  card.id === 'ch12'
    ? { ...card, action: { type: 'advanceTo', tile: READING } as Card['action'] }
    : card,
);

export const ULTIMATE_GAME: Game = {
  id: 'ultimate',
  name: 'Ultimate',
  blurb: '120 tiles, three tracks, and transit stations between them',
  map: ULTIMATE_MAP,
  cards: { chance: ULTIMATE_CHANCE, community: COMMUNITY_CHEST_CARDS },
  theme: 'ultimate',

  rules: {
    // The printed game deals $3,200 a player and supplies 81 houses and 31
    // hotels — a much longer game on a much bigger board.
    startingCash: 3200,
    houseLimit: 81,
    hotelLimit: 31,

    // The board is three loops joined at four junctions; without this it is a
    // 120-tile circuit, and `validateGame` refuses the pairing outright.
    movement: 'tracks',

    // A majority ownership doubles the bare rent, a full monopoly triples it.
    monopolyRent: 3,
    majorityRent: 2,

    // The Pool is not a house rule here, it is where Tax Refund gets its money.
    freeParkingJackpot: true,

    // Mr. Monopoly and the bus are printed on the speed die and this game is
    // played with it. The two bonus moves it already implements are the two the
    // Ultimate rules describe.
    variants: ['speedDie'],

    // A hundred and twenty tiles is a long lap, and four players who never
    // complete a group can circle for ever. Long enough not to cut a real game
    // short, short enough that the simulator finishes.
    winCondition: 'roundLimit',
    roundLimit: 120,
  },

  register: registerUltimateTiles,
};
