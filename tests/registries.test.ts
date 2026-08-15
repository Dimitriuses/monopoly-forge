import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Tile, type TileDefinition } from '@/tiles/Tile';
import {
  registerTileType, createTile, knownTileTypes, isKnownTileType,
} from '@/tiles/registry';
import { registerCardEffect, knownCardEffects, CARD_EFFECTS } from '@/cards/effects';
import { CardEffects, type Card } from '@/cards/CardDeck';
import { Board } from '@/game/Board';
import { Bank } from '@/game/Bank';
import { Player } from '@/game/Player';
import { CLASSIC_RULES, resolveRules } from '@/game/Rules';
import { CLASSIC_MAP, ROUND_MAP } from '@/maps';
import { ROUNDABOUT_GAME } from '@/games';
import { bus } from '@/utils/EventBus';
import type { GameMap } from '@/maps';

// ─── Tile types ───────────────────────────────────────────────────────────────

describe('The tile-type registry', () => {
  it('knows every built-in type', () => {
    for (const type of [
      'go', 'property', 'railroad', 'utility', 'tax',
      'chance', 'communityChest', 'jail', 'freeParking', 'goToJail',
    ]) {
      expect(isKnownTileType(type), type).toBe(true);
    }
    expect(knownTileTypes().length).toBeGreaterThanOrEqual(10);
  });

  it('refuses a type nobody registered, and says what it knows', () => {
    expect(() => createTile({ id: 0, type: 'teleporter', name: 'Wormhole' }))
      .toThrow(/no tile type called "teleporter"/);
  });

  describe('with a type a game added', () => {
    /** A tile that fines whoever lands on it — the engine has never heard of it. */
    class TollBoothTile extends Tile {
      readonly toll: number;
      constructor(def: TileDefinition) {
        super(def);
        this.toll = def.amount ?? 25;
      }
      onLand(playerId: string): void {
        bus.emit('tax:pay', { playerId, amount: this.toll, tileId: this.id });
      }
    }

    beforeEach(() => {
      registerTileType('tollBooth', (def) => new TollBoothTile(def));
    });
    afterEach(() => {
      CARD_EFFECTS.delete('__none__');   // keep the card registry tidy too
    });

    it('builds it, and a board made of it works', () => {
      const tiles: TileDefinition[] = [
        { id: 0, type: 'go', name: 'GO' },
        { id: 1, type: 'jail', name: 'Jail' },
        { id: 2, type: 'tollBooth', name: 'Toll Booth', amount: 40 },
        { id: 3, type: 'freeParking', name: 'Rest' },
      ];
      const map: GameMap = {
        id: 'toll', name: 'Toll', blurb: 'with a type the engine did not ship',
        tiles, layout: { kind: 'ring' },
      };

      const board = new Board(map);
      expect(board.getTile(2)).toBeInstanceOf(TollBoothTile);
      expect(board.size).toBe(4);

      // And it behaves: landing on it charges the toll.
      bus.clear();
      const charged: unknown[] = [];
      bus.on('tax:pay', (p: unknown) => charged.push(p));
      board.getTile(2).onLand('p1');
      expect(charged).toEqual([{ playerId: 'p1', amount: 40, tileId: 2 }]);
    });
  });
});

// ─── Card effects ─────────────────────────────────────────────────────────────

describe('The card-effect registry', () => {
  let board: Board;
  let bank: Bank;
  let player: Player;
  let effects: CardEffects;

  const run = (action: Card['action']) =>
    effects.execute({ id: 'test', description: 'test', action }, player);

  beforeEach(() => {
    bus.clear();
    board  = new Board();
    bank   = new Bank();
    player = new Player('p1', 'Ann', 'car');
    effects = new CardEffects(board, bank, [player]);
  });

  it('knows every built-in effect', () => {
    for (const type of [
      'advanceTo', 'advanceToGo', 'advanceToNearest', 'goToJail', 'goBack',
      'collectFromBank', 'payBank', 'collectFromAll', 'payAll', 'repairs', 'getOutOfJail',
    ]) {
      expect(knownCardEffects(), type).toContain(type);
    }
  });

  it('runs an effect a game added, with the context it was promised', () => {
    let sawBoard = false;
    registerCardEffect('teleport', (ctx, action, p) => {
      sawBoard = ctx.board === board;
      p.position = (action as { to: number }).to % ctx.board.size;
    });

    run({ type: 'teleport', to: 17 } as unknown as Card['action']);

    expect(player.position).toBe(17);
    expect(sawBoard).toBe(true);
    CARD_EFFECTS.delete('teleport');
  });

  it('ignores a card whose effect nobody registered rather than throwing', () => {
    player.position = 5;
    expect(() => run({ type: 'summonDragon' } as unknown as Card['action'])).not.toThrow();
    expect(player.position).toBe(5);
  });

  it('lets a game replace a built-in', () => {
    const original = CARD_EFFECTS.get('collectFromBank')!;
    registerCardEffect('collectFromBank', (ctx, action, p) => {
      ctx.bank.payPlayer(p, (action as { amount: number }).amount * 2);   // double it
    });

    run({ type: 'collectFromBank', amount: 100 });
    expect(player.cash).toBe(CLASSIC_RULES.startingCash + 200);

    registerCardEffect('collectFromBank', original);
  });
});

// ─── Rule sets ────────────────────────────────────────────────────────────────

describe('Rule sets', () => {
  it('layers a map over the classic rules, and the player over the map', () => {
    const rules = resolveRules({ goSalary: 150, startingCash: 1200 }, { noAuction: true });
    expect(rules.goSalary).toBe(150);           // from the map
    expect(rules.startingCash).toBe(1200);      // from the map
    expect(rules.noAuction).toBe(true);         // from the player
    expect(rules.jailFine).toBe(CLASSIC_RULES.jailFine);   // untouched
  });

  // A board has no economy of its own since M9a — the *game* dealing it supplies
  // one, and the board takes whatever it is handed.
  it('gives a board the rule set it is handed', () => {
    expect(new Board(CLASSIC_MAP).rules.startingCash).toBe(CLASSIC_RULES.startingCash);
    expect(new Board(ROUND_MAP, ROUNDABOUT_GAME.rules).rules.goSalary)
      .toBe(ROUNDABOUT_GAME.rules?.goSalary);
  });

  it('lets a player switch a house rule over the game', () => {
    const board = new Board(ROUND_MAP, resolveRules(ROUNDABOUT_GAME.rules, {
      freeParkingJackpot: true,
    }));
    expect(board.rules.freeParkingJackpot).toBe(true);
    expect(board.rules.goSalary).toBe(ROUNDABOUT_GAME.rules?.goSalary);   // still the game's
  });

  it('pays the salary the rule set names, not a constant', () => {
    bus.clear();
    const paid: Array<{ amount?: number }> = [];
    bus.on('rent:pay', (p: { amount?: number }) => paid.push(p));

    const board = new Board(ROUND_MAP, ROUNDABOUT_GAME.rules);
    board.getTile(board.anchor('start')).onPass('p1');
    expect(paid[0].amount).toBe(ROUNDABOUT_GAME.rules?.goSalary);
  });

  it('stocks the bank from the rule set', () => {
    const board = new Board(ROUND_MAP);
    expect(new Bank(board.rules).houses).toBe(CLASSIC_RULES.houseLimit);

    const lean = new Bank(resolveRules({ houseLimit: 12, hotelLimit: 4 }));
    expect(lean.level).toBe(12);
    expect(lean.hotels).toBe(4);
  });

  it('sends a player to jail after the number of doubles the rules name', () => {
    const board = new Board(CLASSIC_MAP);
    expect(board.rules.doublesToJail).toBe(3);
    expect(new Board(CLASSIC_MAP, { doublesToJail: 2 }).rules.doublesToJail).toBe(2);
  });
});
