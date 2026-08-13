import type { Card } from '@/cards/CardDeck';

// ─── Map-agnostic decks ───────────────────────────────────────────────────────
// Shared by the two games that are not the classic board. Every card here moves
// you *relative* to where you are, or moves money — because "advance to
// Boardwalk" means nothing on a board with no Boardwalk, and `validateGame`
// refuses a deck that names a tile its board does not have.
//
// They live with the games rather than with the maps: a deck is dealt by a game,
// and the same deck is perfectly valid next to a different board.

export const GENERIC_CHANCE: Card[] = [
  { id: 'gch1',  description: 'Advance to GO. Collect your salary.',        action: { type: 'advanceToGo' } },
  { id: 'gch2',  description: 'Advance to the nearest Railroad. Pay double rent.', action: { type: 'advanceToNearest', kind: 'railroad' } },
  { id: 'gch3',  description: 'Go back three spaces.',                      action: { type: 'goBack', spaces: 3 } },
  { id: 'gch4',  description: 'Go directly to Jail.',                       action: { type: 'goToJail' } },
  { id: 'gch5',  description: 'Bank pays you a dividend of $50.',           action: { type: 'collectFromBank', amount: 50 } },
  { id: 'gch6',  description: 'Get Out of Jail Free.',   isGetOutOfJail: true, action: { type: 'getOutOfJail' } },
  { id: 'gch7',  description: 'Pay a fine of $25.',                         action: { type: 'payBank', amount: 25 } },
  { id: 'gch8',  description: 'General repairs: $25 per house, $100 per hotel.', action: { type: 'repairs', houseCost: 25, hotelCost: 100 } },
  { id: 'gch9',  description: 'You have been elected chairman: pay each player $50.', action: { type: 'payAll', amount: 50 } },
  { id: 'gch10', description: 'Your loan matures: collect $150.',           action: { type: 'collectFromBank', amount: 150 } },
];

export const GENERIC_CHEST: Card[] = [
  { id: 'gcc1',  description: 'Advance to GO. Collect your salary.',        action: { type: 'advanceToGo' } },
  { id: 'gcc2',  description: 'Bank error in your favour: collect $200.',   action: { type: 'collectFromBank', amount: 200 } },
  { id: 'gcc3',  description: "Doctor's fees: pay $50.",                    action: { type: 'payBank', amount: 50 } },
  { id: 'gcc4',  description: 'Get Out of Jail Free.',   isGetOutOfJail: true, action: { type: 'getOutOfJail' } },
  { id: 'gcc5',  description: 'Go directly to Jail.',                       action: { type: 'goToJail' } },
  { id: 'gcc6',  description: "It's your birthday: collect $10 from each player.", action: { type: 'collectFromAll', amount: 10 } },
  { id: 'gcc7',  description: 'Pay hospital fees: $100.',                   action: { type: 'payBank', amount: 100 } },
  { id: 'gcc8',  description: 'You inherit $100.',                          action: { type: 'collectFromBank', amount: 100 } },
  { id: 'gcc9',  description: 'Street repairs: $40 per house, $115 per hotel.', action: { type: 'repairs', houseCost: 40, hotelCost: 115 } },
  { id: 'gcc10', description: 'Receive a consultancy fee of $25.',          action: { type: 'collectFromBank', amount: 25 } },
];
