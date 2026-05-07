import { rng } from '@/utils/PRNG';
import { bus } from '@/utils/EventBus';
import type { Player } from '@/game/Player';
import type { Board } from '@/game/Board';
import type { Bank } from '@/game/Bank';

// ─── Card definition ──────────────────────────────────────────────────────────

export type CardAction =
  | { type: 'advanceTo';      tile: number }
  | { type: 'advanceToGo' }
  | { type: 'goToJail' }
  | { type: 'goBack';         spaces: number }
  | { type: 'collectFromBank';amount: number }
  | { type: 'payBank';        amount: number }
  | { type: 'collectFromAll'; amount: number }
  | { type: 'payAll';         amount: number }
  | { type: 'repairs';        houseCost: number; hotelCost: number }
  | { type: 'getOutOfJail' };

export interface Card {
  id: string;
  description: string;
  action: CardAction;
  isGetOutOfJail?: boolean;
}

// ─── Card Deck ────────────────────────────────────────────────────────────────

export class CardDeck {
  private draw: Card[];
  private discard: Card[] = [];

  constructor(cards: Card[]) {
    this.draw = rng.shuffle([...cards]);
  }

  drawCard(): Card {
    if (this.draw.length === 0) {
      this.draw = rng.shuffle(this.discard);
      this.discard = [];
    }
    return this.draw.pop()!;
  }

  returnCard(card: Card): void {
    this.discard.push(card);
  }
}

// ─── Card Effects ─────────────────────────────────────────────────────────────

export class CardEffects {
  constructor(
    private board: Board,
    private bank: Bank,
    private players: Player[],
  ) {}

  execute(card: Card, player: Player): void {
    const a = card.action;
    bus.emit('card:execute', { cardId: card.id, playerId: player.id });

    switch (a.type) {
      case 'advanceTo':
        this.advanceTo(player, a.tile);
        break;
      case 'advanceToGo':
        this.advanceTo(player, 0);
        break;
      case 'goToJail':
        player.position = 10;
        player.inJail = true;
        player.jailTurns = 0;
        bus.emit('jail:enter', { playerId: player.id, reason: 'card' });
        break;
      case 'goBack': {
        const from = player.position;
        const to   = (from - a.spaces + 40) % 40;
        player.position = to;
        // Pass steps so the animation walks backwards tile-by-tile
        bus.emit('player:move', { playerId: player.id, from, to, steps: a.spaces, isDoubles: false });
        // resolveLanding() fires after animation completes — do NOT call onLand here
        break;
      }
      case 'collectFromBank':
        this.bank.payPlayer(player, a.amount);
        break;
      case 'payBank':
        this.bank.collectTax(player, a.amount);
        break;
      case 'collectFromAll':
        this.players.filter((p) => p.id !== player.id && !p.isBankrupt).forEach((p) => {
          this.bank.transferBetweenPlayers(p, player, a.amount);
        });
        break;
      case 'payAll':
        this.players.filter((p) => p.id !== player.id && !p.isBankrupt).forEach((p) => {
          this.bank.transferBetweenPlayers(player, p, a.amount);
        });
        break;
      case 'repairs': {
        let total = 0;
        player.ownedTileIds.forEach((id) => {
          const tile = this.board.getTile(id);
          if (tile.type === 'property') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pt = tile as any;
            total += pt.houses * a.houseCost + (pt.hasHotel ? a.hotelCost : 0);
          }
        });
        this.bank.collectTax(player, total);
        break;
      }
      case 'getOutOfJail':
        player.getOutOfJailCards++;
        break;
    }
  }

  private advanceTo(player: Player, targetTile: number): void {
    const from  = player.position;
    const steps = (targetTile - from + 40) % 40;
    if (steps === 0) return; // already on the target tile

    // Passed Go when the path wraps around the board
    if (from + steps >= 40) {
      this.board.getTile(0).onPass(player.id);
    }
    player.position = targetTile;
    bus.emit('player:move', { playerId: player.id, from, to: targetTile, steps, isDoubles: false });
    // resolveLanding() fires after the animation completes — do NOT call onLand here
  }
}

// ─── Standard decks ───────────────────────────────────────────────────────────

export const CHANCE_CARDS: Card[] = [
  { id: 'ch1',  description: 'Advance to Go. Collect $200.',                          action: { type: 'advanceToGo' } },
  { id: 'ch2',  description: 'Advance to Illinois Ave.',                              action: { type: 'advanceTo', tile: 24 } },
  { id: 'ch3',  description: 'Advance to St. Charles Place.',                         action: { type: 'advanceTo', tile: 11 } },
  { id: 'ch4',  description: 'Advance to nearest Railroad.',                          action: { type: 'advanceTo', tile: 5 } },
  { id: 'ch5',  description: 'Advance to nearest Railroad (2).',                      action: { type: 'advanceTo', tile: 15 } },
  { id: 'ch6',  description: 'Bank pays you dividend of $50.',                        action: { type: 'collectFromBank', amount: 50 } },
  { id: 'ch7',  description: 'Get Out of Jail Free.',                                 action: { type: 'getOutOfJail' }, isGetOutOfJail: true },
  { id: 'ch8',  description: 'Go Back 3 Spaces.',                                     action: { type: 'goBack', spaces: 3 } },
  { id: 'ch9',  description: 'Go to Jail.',                                           action: { type: 'goToJail' } },
  { id: 'ch10', description: 'Make general repairs: $25/house, $100/hotel.',          action: { type: 'repairs', houseCost: 25, hotelCost: 100 } },
  { id: 'ch11', description: 'Pay poor tax of $15.',                                  action: { type: 'payBank', amount: 15 } },
  { id: 'ch12', description: 'Advance to Reading Railroad.',                          action: { type: 'advanceTo', tile: 5 } },
  { id: 'ch13', description: 'Advance to Boardwalk.',                                 action: { type: 'advanceTo', tile: 39 } },
  { id: 'ch14', description: 'Elected Chairman: pay each player $50.',               action: { type: 'payAll', amount: 50 } },
  { id: 'ch15', description: 'Building loan matures: collect $150.',                  action: { type: 'collectFromBank', amount: 150 } },
  { id: 'ch16', description: 'Won crossword competition: collect $100.',              action: { type: 'collectFromBank', amount: 100 } },
];

export const COMMUNITY_CHEST_CARDS: Card[] = [
  { id: 'cc1',  description: 'Advance to Go. Collect $200.',                          action: { type: 'advanceToGo' } },
  { id: 'cc2',  description: 'Bank error in your favor: collect $200.',              action: { type: 'collectFromBank', amount: 200 } },
  { id: 'cc3',  description: 'Doctor\'s fee: pay $50.',                              action: { type: 'payBank', amount: 50 } },
  { id: 'cc4',  description: 'From sale of stock: collect $50.',                     action: { type: 'collectFromBank', amount: 50 } },
  { id: 'cc5',  description: 'Get Out of Jail Free.',                                 action: { type: 'getOutOfJail' }, isGetOutOfJail: true },
  { id: 'cc6',  description: 'Go to Jail.',                                           action: { type: 'goToJail' } },
  { id: 'cc7',  description: 'Grand Opera Night: collect $50 from every player.',    action: { type: 'collectFromAll', amount: 50 } },
  { id: 'cc8',  description: 'Holiday fund matures: collect $100.',                  action: { type: 'collectFromBank', amount: 100 } },
  { id: 'cc9',  description: 'Income tax refund: collect $20.',                      action: { type: 'collectFromBank', amount: 20 } },
  { id: 'cc10', description: 'It\'s your birthday: collect $10 from each player.',   action: { type: 'collectFromAll', amount: 10 } },
  { id: 'cc11', description: 'Life insurance matures: collect $100.',                action: { type: 'collectFromBank', amount: 100 } },
  { id: 'cc12', description: 'Pay hospital fees: $100.',                             action: { type: 'payBank', amount: 100 } },
  { id: 'cc13', description: 'Pay school fees: $150.',                               action: { type: 'payBank', amount: 150 } },
  { id: 'cc14', description: 'Receive consultancy fee: $25.',                        action: { type: 'collectFromBank', amount: 25 } },
  { id: 'cc15', description: 'You are assessed for street repairs: $40/house, $115/hotel.', action: { type: 'repairs', houseCost: 40, hotelCost: 115 } },
  { id: 'cc16', description: 'You have won second prize in beauty contest: $10.',    action: { type: 'collectFromBank', amount: 10 } },
  { id: 'cc17', description: 'You inherit $100.',                                    action: { type: 'collectFromBank', amount: 100 } },
];
