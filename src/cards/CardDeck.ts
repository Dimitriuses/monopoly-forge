import { rng } from '@/utils/PRNG';
import { bus } from '@/utils/EventBus';
import { dlog, dwarn } from '@/utils/log';
import { settleDebt, announceSettlement } from '@/game/Estate';
import type { Player } from '@/game/Player';
import type { Board } from '@/game/Board';
import type { Bank } from '@/game/Bank';

// ─── Card definition ──────────────────────────────────────────────────────────

export type CardAction =
  | { type: 'advanceTo';      tile: number }
  | { type: 'advanceToNearest'; kind: 'railroad' | 'utility' }
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
  private readonly source: readonly Card[];

  constructor(cards: Card[]) {
    this.source = cards;
    this.draw = rng.shuffle([...cards]);
  }

  /** Whether this deck is where a card came from — how a spent Get Out of Jail
   *  Free card finds its way home without carrying its origin around. */
  owns(card: Card): boolean {
    return this.source.includes(card);
  }

  /** Put a card back underneath the draw pile, so it returns without a reshuffle. */
  returnToBottom(card: Card): void {
    this.draw.unshift(card);
  }

  drawCard(): Card | undefined {
    if (this.draw.length === 0) {
      if (this.discard.length === 0) {
        // All cards are currently held by players (GOOJ cards not yet returned).
        dwarn('[CardDeck] Both draw and discard piles are empty.');
        return undefined;
      }
      this.draw = rng.shuffle(this.discard);
      this.discard = [];
    }
    return this.draw.pop();
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
    dlog(
      `[CardEffects] execute: card="${card.description}", action=${a.type}, ` +
      `player=${player.name}, position=${player.position}`,
    );
    bus.emit('card:execute', { cardId: card.id, playerId: player.id });

    switch (a.type) {
      case 'advanceTo':
        this.advanceTo(player, a.tile);
        break;
      case 'advanceToNearest': {
        const target = this.nearest(player.position, a.kind);
        if (target === null) {
          dwarn(`[CardEffects] advanceToNearest: this map has no ${a.kind} — card ignored`);
          break;
        }
        // Arriving by card changes what the tile charges: a railroad costs twice
        // its usual rate, a utility ten times the dice however many the owner
        // holds. The tile cannot know how the player got there, so the rule
        // travels with the move and is consumed by whoever resolves the rent.
        bus.emit('rent:modifier', {
          playerId: player.id,
          tileId:   target,
          rule:     a.kind === 'railroad' ? 'railroadDouble' : 'utilityTenTimes',
        });
        dlog(`[CardEffects] advanceToNearest ${a.kind}: ${player.name} pos ${player.position} → ${target}`);
        this.advanceTo(player, target);
        break;
      }
      case 'advanceToGo':
        this.advanceTo(player, this.board.anchor('start'));
        break;
      case 'goToJail':
        player.position = this.board.anchor('jail');
        player.inJail = true;
        player.jailTurns = 0;
        dlog(`[CardEffects] goToJail: ${player.name} → position=${player.position}`);
        bus.emit('jail:enter', { playerId: player.id, reason: 'card' });
        break;
      case 'goBack': {
        const from = player.position;
        const to   = this.board.move(from, -a.spaces).to;
        const destTile = this.board.getTile(to);
        dlog(
          `[CardEffects] goBack ${a.spaces} spaces: ${player.name} pos ${from} → ${to} ` +
          `(tile: "${destTile.name}" [${destTile.type}])`,
        );
        player.position = to;
        // direction: -1 makes the animation walk the tiles backwards. Without it
        // the token used to travel three tiles clockwise and then snap back.
        // Going back past GO does NOT pay the salary, so no onPass here.
        bus.emit('player:move', {
          playerId: player.id, from, to, steps: a.spaces, isDoubles: false, direction: -1,
        });
        // resolveLanding() fires after animation completes — do NOT call onLand here
        break;
      }
      case 'collectFromBank':
        dlog(`[CardEffects] collectFromBank: ${player.name} collects $${a.amount}`);
        this.bank.payPlayer(player, a.amount);
        break;
      case 'payBank':
        dlog(`[CardEffects] payBank: ${player.name} pays $${a.amount}`);
        this.charge(player, null, a.amount);
        break;
      case 'collectFromAll':
        dlog(`[CardEffects] collectFromAll: ${player.name} collects $${a.amount} from each player`);
        this.players.filter((p) => p.id !== player.id && !p.isBankrupt).forEach((p) => {
          this.charge(p, player, a.amount);
        });
        break;
      case 'payAll':
        dlog(`[CardEffects] payAll: ${player.name} pays $${a.amount} to each player`);
        this.players.filter((p) => p.id !== player.id && !p.isBankrupt).forEach((p) => {
          this.charge(player, p, a.amount);
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
        dlog(`[CardEffects] repairs: ${player.name} pays $${total} (houses×$${a.houseCost}, hotels×$${a.hotelCost})`);
        this.charge(player, null, total);
        break;
      }
      case 'getOutOfJail':
        // Hold the card itself: spending it returns it to the deck it came from.
        player.jailCards.push(card);
        dlog(`[CardEffects] getOutOfJail: ${player.name} now holds ${player.getOutOfJailCards} GOOJ card(s)`);
        break;
    }
  }

  /** A card debt is a debt like any other: raise cash, then go under if you
   *  cannot. `creditor` is null when the money goes to the bank. */
  private charge(debtor: Player, creditor: Player | null, amount: number): void {
    if (amount <= 0) return;
    const settlement = settleDebt(this.board, this.bank, debtor, creditor, amount);
    announceSettlement(debtor, creditor, settlement);
  }

  /** The next tile of this type going forwards, or null if the map has none.
   *  Starts one step ahead, so standing on a railroad sends you to the next. */
  private nearest(from: number, type: 'railroad' | 'utility'): number | null {
    for (let s = 1; s <= this.board.size; s++) {
      const index = this.board.move(from, s).to;
      if (this.board.getTile(index).type === type) return index;
    }
    return null;
  }

  private advanceTo(player: Player, targetTile: number): void {
    const from  = player.position;
    const steps = this.board.stepsBetween(from, targetTile);
    if (steps === 0) {
      dlog(`[CardEffects] advanceTo tile=${targetTile}: ${player.name} already there — no move`);
      return; // already on the target tile
    }

    const { passedGo } = this.board.move(from, steps);
    const destTile = this.board.getTile(targetTile);
    dlog(
      `[CardEffects] advanceTo: ${player.name} pos ${from} → tile ${targetTile} ` +
      `"${destTile.name}" (${steps} steps${passedGo ? ', passes GO' : ''})`,
    );

    // Passed Go when the path wraps around the board
    if (passedGo) {
      this.board.getTile(this.board.anchor('start')).onPass(player.id);
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
  { id: 'ch4',  description: 'Advance to the nearest Railroad. Pay the owner twice the rent.', action: { type: 'advanceToNearest', kind: 'railroad' } },
  { id: 'ch5',  description: 'Advance to the nearest Utility. Pay the owner ten times the dice.', action: { type: 'advanceToNearest', kind: 'utility' } },
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
