import { rng } from '@/utils/PRNG';
import { bus } from '@/utils/EventBus';
import { dlog, dwarn } from '@/utils/log';
import { settleDebt, announceSettlement } from '@/game/Estate';
import { CARD_EFFECTS, type CardEffectContext } from './effects';
import type { Player } from '@/game/Player';
import type { Board } from '@/game/Board';
import type { Bank } from '@/game/Bank';

// ─── Card definition ──────────────────────────────────────────────────────────

/**
 * What a card does. The built-ins are spelled out so they typecheck and
 * autocomplete; the trailing member keeps the set open, because a game can
 * `registerCardEffect` an action this file has never heard of.
 */
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
  | { type: 'getOutOfJail' }
  | { type: string & {};      [field: string]: unknown };

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

  /**
   * `shuffle: false` is for restoring a saved deck: shuffling would draw from
   * the shared PRNG and move the stream on, so a restored game's *next* roll
   * would differ from the saved one's.
   */
  constructor(cards: Card[], shuffle = true) {
    this.source = cards;
    this.draw = shuffle ? rng.shuffle([...cards]) : [...cards];
  }

  /** Whether this deck is where a card came from — how a spent Get Out of Jail
   *  Free card finds its way home without carrying its origin around. */
  owns(card: Card): boolean {
    return this.source.includes(card);
  }

  /** The same question by id, for a census that only has ids to go on. */
  ownsId(id: string): boolean {
    return this.source.some((card) => card.id === id);
  }

  /** How many cards were dealt into it. Every one of them is in exactly one
   *  place — the draw pile, the discard, or somebody's hand — and the batch
   *  invariants check that after every turn. */
  get size(): number {
    return this.source.length;
  }

  /** Put a card back underneath the draw pile, so it returns without a reshuffle. */
  returnToBottom(card: Card): void {
    this.draw.unshift(card);
  }

  /** Both piles in order, by id — enough to restore the exact deal. */
  snapshot(): { draw: string[]; discard: string[] } {
    return {
      draw:    this.draw.map((c) => c.id),
      discard: this.discard.map((c) => c.id),
    };
  }

  /**
   * Rebuild a deck from a snapshot without shuffling. Cards missing from both
   * piles are the ones players are holding, so they are simply left out.
   */
  static restore(cards: Card[], snapshot: { draw: string[]; discard: string[] }): CardDeck {
    const deck = new CardDeck(cards, false);
    const find = (ids: string[]) =>
      ids.map((id) => cards.find((c) => c.id === id)).filter((c): c is Card => c !== undefined);
    deck.draw    = find(snapshot.draw);
    deck.discard = find(snapshot.discard);
    return deck;
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
    const action = card.action;
    dlog(
      `[CardEffects] execute: card="${card.description}", action=${action.type}, ` +
      `player=${player.name}, position=${player.position}`,
    );
    bus.emit('card:execute', { cardId: card.id, playerId: player.id });

    // What a card can do is a registry, not a switch: a game adds an effect by
    // registering a handler, without this file knowing about it.
    const effect = CARD_EFFECTS.get(action.type);
    if (!effect) {
      dwarn(`[CardEffects] no handler registered for "${action.type}" — card ignored`);
      return;
    }
    effect(this.context(), action as CardAction, player, card);
  }

  /** What a handler is allowed to reach. Deliberately small. */
  private context(): CardEffectContext {
    return {
      board: this.board,
      bank: this.bank,
      players: this.players,
      advanceTo: (p, tile) => this.advanceTo(p, tile),
      nearest: (from, type) => this.nearest(from, type),
      charge: (debtor, creditor, amount) => this.charge(debtor, creditor, amount),
    };
  }

  /** A card debt is a debt like any other: raise cash, then go under if you
   *  cannot. `creditor` is null when the money goes to the bank. */
  private charge(debtor: Player, creditor: Player | null, amount: number): void {
    if (amount <= 0) return;
    const settlement = settleDebt(this.board, this.bank, debtor, creditor, amount);
    announceSettlement(debtor, creditor, settlement);
  }

  /** The next tile of this type going forwards, or null if the map has none.
   *  Starts one step ahead, so standing on a railroad sends you to the next.
   *  Takes any type name, since a game may have registered one. */
  private nearest(from: number, type: string): number | null {
    return this.board.scan(from, (tile) => tile.type === type);
  }

  private advanceTo(player: Player, targetTile: number): void {
    // The shipped decks name tiles on the classic board. On a shorter map those
    // indices would silently wrap onto some unrelated square, so the card does
    // nothing and says so instead. Decks belonging to a map is ROADMAP 8b.
    if (targetTile >= this.board.size) {
      dwarn(
        `[CardEffects] advanceTo tile=${targetTile} is off this ${this.board.size}-tile ` +
        `map — the card does nothing`,
      );
      return;
    }
    const from = player.position;
    // The route, not the distance: on a board with junctions a named tile may be
    // on another loop, and the printed rule agrees that you take the transit
    // station on the way. `pathTo` crosses where it has to and returns exactly
    // the forward distance on a board that is one circuit.
    const path = this.board.pathTo(from, targetTile);
    if (path === null) {
      dwarn(
        `[CardEffects] advanceTo tile=${targetTile}: no route from ${from} — the card does nothing`,
      );
      return;
    }
    if (path.length === 0) {
      dlog(`[CardEffects] advanceTo tile=${targetTile}: ${player.name} already there — no move`);
      return; // already on the target tile
    }

    const destTile = this.board.getTile(targetTile);
    dlog(
      `[CardEffects] advanceTo: ${player.name} pos ${from} → tile ${targetTile} ` +
      `"${destTile.name}" (${path.length} steps)`,
    );

    this.board.announcePassing(path, player.id);
    player.position = targetTile;
    bus.emit('player:move', {
      playerId: player.id, from, to: targetTile, path, steps: path.length, isDoubles: false,
    });
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
