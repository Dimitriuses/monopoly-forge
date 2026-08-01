import { describe, it, expect, beforeEach } from 'vitest';
import {
  CardDeck, CardEffects, CHANCE_CARDS, COMMUNITY_CHEST_CARDS, type Card,
} from '@/cards/CardDeck';
import { Board } from '@/game/Board';
import { Bank } from '@/game/Bank';
import { Player } from '@/game/Player';
import { bus } from '@/utils/EventBus';
import { rng } from '@/utils/PRNG';

describe('Standard decks — data integrity', () => {
  it('has 16 Chance and 17 Community Chest cards', () => {
    expect(CHANCE_CARDS).toHaveLength(16);
    expect(COMMUNITY_CHEST_CARDS).toHaveLength(17);
  });

  it('gives every card a unique id', () => {
    const ids = [...CHANCE_CARDS, ...COMMUNITY_CHEST_CARDS].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('carries exactly one Get Out of Jail Free card per deck', () => {
    expect(CHANCE_CARDS.filter((c) => c.isGetOutOfJail)).toHaveLength(1);
    expect(COMMUNITY_CHEST_CARDS.filter((c) => c.isGetOutOfJail)).toHaveLength(1);
  });

  it('only ever targets tiles that exist on the board', () => {
    const all = [...CHANCE_CARDS, ...COMMUNITY_CHEST_CARDS];
    for (const card of all) {
      if (card.action.type === 'advanceTo') {
        expect(card.action.tile).toBeGreaterThanOrEqual(0);
        expect(card.action.tile).toBeLessThanOrEqual(39);
      }
      if (card.action.type === 'goBack') {
        expect(card.action.spaces).toBeGreaterThan(0);
        expect(card.action.spaces).toBeLessThan(40);
      }
    }
  });
});

describe('CardDeck — draw / discard cycling', () => {
  it('deals every card once before repeating', () => {
    const deck = new CardDeck(CHANCE_CARDS);
    const drawn = Array.from({ length: 16 }, () => deck.drawCard()!);
    expect(drawn.every(Boolean)).toBe(true);
    expect(new Set(drawn.map((c) => c.id)).size).toBe(16);
  });

  // The deck-exhaustion bug: cards were returned to the discard from a scene
  // shutdown callback that sometimes never fired, so the deck drained to nothing.
  it('returns undefined rather than throwing when both piles are empty', () => {
    const deck = new CardDeck(CHANCE_CARDS);
    for (let i = 0; i < 16; i++) expect(deck.drawCard()).toBeDefined();
    expect(deck.drawCard()).toBeUndefined();
  });

  it('reshuffles the discard pile and never runs dry when cards are returned', () => {
    const deck = new CardDeck(CHANCE_CARDS);
    for (let i = 0; i < 5_000; i++) {
      const card = deck.drawCard();
      expect(card).toBeDefined();
      deck.returnCard(card!);
    }
  });

  it('withholds only the cards a player keeps', () => {
    const deck = new CardDeck(CHANCE_CARDS);
    // Hold the single GOOJ card back, exactly as GameScene does, and confirm the
    // remaining 15 keep cycling forever.
    let held = 0;
    for (let i = 0; i < 500; i++) {
      const card = deck.drawCard();
      expect(card).toBeDefined();
      if (card!.isGetOutOfJail && held === 0) held++;
      else deck.returnCard(card!);
    }
    expect(held).toBe(1);
  });

  it('shuffles reproducibly from a seeded generator', () => {
    rng.seed(555);
    const a = Array.from({ length: 16 }, ((d) => () => d.drawCard()!.id)(new CardDeck(CHANCE_CARDS)));
    rng.seed(555);
    const b = Array.from({ length: 16 }, ((d) => () => d.drawCard()!.id)(new CardDeck(CHANCE_CARDS)));
    expect(a).toEqual(b);
  });
});

describe('CardEffects', () => {
  let board: Board;
  let bank: Bank;
  let players: Player[];
  let effects: CardEffects;
  let events: Array<{ name: string; payload: Record<string, unknown> }>;

  const run = (action: Card['action'], player = players[0]) =>
    effects.execute({ id: 'test', description: 'test card', action }, player);

  beforeEach(() => {
    bus.clear();
    board = new Board();
    bank = new Bank();
    players = [
      new Player('p1', 'Ann', 'car'),
      new Player('p2', 'Bo', 'dog'),
      new Player('p3', 'Cy', 'iron'),
    ];
    effects = new CardEffects(board, bank, players);

    events = [];
    for (const name of ['player:move', 'jail:enter', 'rent:pay', 'card:execute']) {
      bus.on(name, (payload: Record<string, unknown>) => events.push({ name, payload }));
    }
  });

  it('advances to a named tile and emits the move', () => {
    players[0].position = 5;
    run({ type: 'advanceTo', tile: 24 });

    expect(players[0].position).toBe(24);
    const move = events.find((e) => e.name === 'player:move')!;
    expect(move.payload).toMatchObject({ playerId: 'p1', from: 5, to: 24, steps: 19 });
  });

  it('pays the GO salary when an advance wraps past GO', () => {
    players[0].position = 36;
    run({ type: 'advanceTo', tile: 11 });

    expect(players[0].position).toBe(11);
    const go = events.find((e) => e.name === 'rent:pay' && e.payload.reason === 'go');
    expect(go).toBeDefined();
    expect(go!.payload).toMatchObject({ creditorId: 'p1', amount: 200 });
    // 36 → 11 is 15 steps forward, not -25.
    expect(events.find((e) => e.name === 'player:move')!.payload.steps).toBe(15);
  });

  it('does not move or pay when already standing on the target tile', () => {
    players[0].position = 24;
    run({ type: 'advanceTo', tile: 24 });

    expect(players[0].position).toBe(24);
    expect(events.some((e) => e.name === 'player:move')).toBe(false);
    expect(events.some((e) => e.name === 'rent:pay')).toBe(false);
  });

  it('advances to GO and collects the salary', () => {
    players[0].position = 30;
    run({ type: 'advanceToGo' });

    expect(players[0].position).toBe(0);
    expect(events.some((e) => e.name === 'rent:pay' && e.payload.reason === 'go')).toBe(true);
  });

  it('sends the player to jail without paying GO', () => {
    players[0].position = 22;
    run({ type: 'goToJail' });

    expect(players[0].position).toBe(10);
    expect(players[0].inJail).toBe(true);
    expect(players[0].jailTurns).toBe(0);
    expect(events.some((e) => e.name === 'jail:enter')).toBe(true);
    expect(events.some((e) => e.name === 'rent:pay')).toBe(false);
  });

  it('moves back three spaces, wrapping below zero without going negative', () => {
    players[0].position = 7;
    run({ type: 'goBack', spaces: 3 });
    expect(players[0].position).toBe(4);

    players[1].position = 1;
    run({ type: 'goBack', spaces: 3 }, players[1]);
    expect(players[1].position).toBe(38);
  });

  it('moves cash to and from the bank', () => {
    run({ type: 'collectFromBank', amount: 150 });
    expect(players[0].cash).toBe(1650);

    run({ type: 'payBank', amount: 50 });
    expect(players[0].cash).toBe(1600);
  });

  it('collects from and pays every other solvent player', () => {
    run({ type: 'collectFromAll', amount: 50 });
    expect(players[0].cash).toBe(1600);
    expect(players[1].cash).toBe(1450);
    expect(players[2].cash).toBe(1450);

    run({ type: 'payAll', amount: 100 });
    expect(players[0].cash).toBe(1400);
    expect(players[1].cash).toBe(1550);
    expect(players[2].cash).toBe(1550);
  });

  it('skips bankrupt players when collecting from all', () => {
    players[2].isBankrupt = true;
    run({ type: 'collectFromAll', amount: 50 });
    expect(players[0].cash).toBe(1550);
    expect(players[2].cash).toBe(1500);
  });

  it('bills street repairs per house and per hotel', () => {
    // Mediterranean (1) with 3 houses, Baltic (3) with a hotel.
    const med = board.getTile(1) as unknown as { houses: number; hasHotel: boolean };
    const baltic = board.getTile(3) as unknown as { houses: number; hasHotel: boolean };
    med.houses = 3;
    baltic.hasHotel = true;
    players[0].ownedTileIds = new Set([1, 3]);

    run({ type: 'repairs', houseCost: 25, hotelCost: 100 });
    expect(players[0].cash).toBe(1500 - (3 * 25 + 100));
  });

  it('hands out a Get Out of Jail Free card', () => {
    run({ type: 'getOutOfJail' });
    expect(players[0].getOutOfJailCards).toBe(1);
  });
});
