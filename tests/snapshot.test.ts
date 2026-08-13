import { describe, it, expect, beforeEach } from 'vitest';
import {
  captureGame, restoreGame, validateSnapshot,
  SNAPSHOT_VERSION, type GameParts, type GameSnapshot,
} from '@/game/Snapshot';
import { Board } from '@/game/Board';
import { Bank } from '@/game/Bank';
import { Dice } from '@/game/Dice';
import { Player } from '@/game/Player';
import { TurnManager } from '@/game/TurnManager';
import { CardDeck, CardEffects, CHANCE_CARDS, COMMUNITY_CHEST_CARDS } from '@/cards/CardDeck';
import { PropertyTile } from '@/tiles/PropertyTile';
import { isOwnable } from '@/tiles/Tile';
import { CLASSIC_RULES, resolveRules } from '@/game/Rules';
import { ROUND_MAP } from '@/maps';
import { ROUNDABOUT_GAME } from '@/games';
import { bus } from '@/utils/EventBus';
import { rng } from '@/utils/PRNG';

const MEDITERRANEAN = 1;
const BALTIC = 3;
const READING = 5;

/** A game part-way through, so a round trip has something to lose. */
function playedGame(): GameParts {
  bus.clear();
  rng.seed(1234);

  const board   = new Board();
  const bank    = new Bank();
  const dice    = new Dice();
  const players = [
    new Player('p1', 'Ann', 'car'),
    new Player('p2', 'Bo', 'dog'),
    new Player('p3', 'Cy', 'iron'),
  ];

  const own = (player: Player, ...ids: number[]) => ids.forEach((id) => {
    const tile = board.getTile(id);
    if (isOwnable(tile)) tile.ownerId = player.id;
    player.ownedTileIds.add(id);
  });

  own(players[0], MEDITERRANEAN, BALTIC);
  own(players[1], READING);
  (board.getTile(MEDITERRANEAN) as PropertyTile).houses = 3;
  (board.getTile(BALTIC) as PropertyTile).isMortgaged = true;
  bank.houses = 29;
  bank.pot = 275;

  players[0].cash = 640;
  players[0].position = 17;
  players[1].inJail = true;
  players[1].jailTurns = 2;
  players[1].jailCards.push(CHANCE_CARDS.find((c) => c.isGetOutOfJail)!);
  players[2].isBankrupt = true;
  players[2].doublesStreak = 2;

  dice.roll();
  const turnManager = new TurnManager(players, board, dice);
  turnManager.currentPlayerIndex = 1;

  const chanceDeck = new CardDeck(CHANCE_CARDS);
  const commDeck   = new CardDeck(COMMUNITY_CHEST_CARDS);
  // Move some cards into the discard so the piles are not pristine.
  for (let i = 0; i < 4; i++) chanceDeck.returnCard(chanceDeck.drawCard()!);
  commDeck.drawCard();

  return {
    gameId: 'classic',
    board, bank, dice, players, turnManager, chanceDeck, commDeck,
    cardEffects: new CardEffects(board, bank, players),
    rules: resolveRules({ freeParkingJackpot: true }),
  };
}

describe('Snapshot — round trip', () => {
  let original: GameParts;
  let snapshot: GameSnapshot;
  let restored: GameParts;

  beforeEach(() => {
    original = playedGame();
    snapshot = captureGame(original);
    restored = restoreGame(snapshot);
  });

  it('brings back every player, down to the jail clock', () => {
    expect(restored.players.map((p) => p.name)).toEqual(['Ann', 'Bo', 'Cy']);
    expect(restored.players[0].cash).toBe(640);
    expect(restored.players[0].position).toBe(17);
    expect(restored.players[1].inJail).toBe(true);
    expect(restored.players[1].jailTurns).toBe(2);
    expect(restored.players[2].isBankrupt).toBe(true);
    expect(restored.players[2].doublesStreak).toBe(2);
  });

  it('brings back ownership, buildings and mortgages', () => {
    const med = restored.board.getTile(MEDITERRANEAN) as PropertyTile;
    const baltic = restored.board.getTile(BALTIC) as PropertyTile;
    expect(med.ownerId).toBe('p1');
    expect(med.houses).toBe(3);
    expect(baltic.isMortgaged).toBe(true);
    expect(restored.board.getTile(READING)).toMatchObject({ ownerId: 'p2' });
    expect([...restored.players[0].ownedTileIds].sort()).toEqual([MEDITERRANEAN, BALTIC]);
  });

  it('leaves unowned tiles unowned', () => {
    expect((restored.board.getTile(39) as PropertyTile).ownerId).toBeNull();
  });

  it('brings back the bank, the pot, the dice and whose turn it is', () => {
    expect(restored.bank.houses).toBe(29);
    expect(restored.bank.pot).toBe(275);
    expect(restored.dice.lastResult).toEqual(original.dice.lastResult);
    expect(restored.turnManager.currentPlayerIndex).toBe(1);
    expect(restored.turnManager.currentPlayer.name).toBe('Bo');
  });

  // A round limit cannot be re-derived from anything else in the save, and
  // neither can "who has already played in this one".
  it('brings back the round, and keeps counting from where it was', () => {
    const parts = playedGame();
    parts.turnManager.currentPlayerIndex = 0;
    parts.dice.lastResult = { die1: 1, die2: 2, isDoubles: false, total: 3 };
    parts.turnManager.startTurn();
    parts.turnManager.endTurn();          // → Bo (Cy is bankrupt)
    parts.turnManager.endTurn();          // → Ann again: the round is over
    expect(parts.turnManager.round).toBe(2);

    const back = restoreGame(captureGame(parts));
    expect(back.turnManager.round).toBe(2);

    back.turnManager.startTurn();
    back.turnManager.endTurn();
    back.turnManager.endTurn();
    expect(back.turnManager.round).toBe(3);
  });

  // The counts come from the save, but what a hotel is *worth* comes from the
  // map — restoring built the bank from the classic rules and lost it.
  it('gives the restored bank the rules the game was played under', () => {
    const parts = playedGame();
    const board = new Board(undefined, { housesBeforeHotel: 3 });
    const back  = restoreGame(captureGame({ ...parts, board, rules: board.rules }));
    expect(back.bank.housesPerHotel).toBe(3);
  });

  it('brings back the rule set, switches and all', () => {
    expect(restored.rules.freeParkingJackpot).toBe(true);
    expect(restored.rules.noAuction).toBe(false);
    expect(restored.rules.startingCash).toBe(CLASSIC_RULES.startingCash);
  });

  // A game brings its own economy, and a save is of a game — not of a board.
  it('brings back a game whose rule set is not the classic one', () => {
    const parts = playedGame();
    const board = new Board(ROUND_MAP, ROUNDABOUT_GAME.rules);
    const onRound: GameParts = {
      ...parts, gameId: ROUNDABOUT_GAME.id, board, rules: board.rules,
    };
    const restored = restoreGame(captureGame(onRound));

    expect(restored.gameId).toBe('roundabout');
    expect(restored.board.map.id).toBe('round');
    expect(restored.rules.goSalary).toBe(ROUNDABOUT_GAME.rules?.goSalary);
    expect(restored.rules.startingCash).toBe(ROUNDABOUT_GAME.rules?.startingCash);
  });

  // A cloned card would break `deck.owns()`, and a spent Get Out of Jail Free
  // card would then never find its way home.
  it('restores a held jail card as the deck object itself, not a copy', () => {
    const held = restored.players[1].jailCards[0];
    expect(held).toBe(CHANCE_CARDS.find((c) => c.isGetOutOfJail));
    expect(restored.chanceDeck.owns(held)).toBe(true);
  });

  it('deals the same cards after a restore as the saved game would have', () => {
    const expected = Array.from({ length: 6 }, () => original.chanceDeck.drawCard()?.id);
    const actual   = Array.from({ length: 6 }, () => restored.chanceDeck.drawCard()?.id);
    expect(actual).toEqual(expected);
  });

  // The saved value is the stream *position*, not the seed the game began with.
  it('resumes the random stream where the save left it', () => {
    const expected = [original.dice.roll(), original.dice.roll()];
    const resumed  = restoreGame(snapshot);
    const actual   = [resumed.dice.roll(), resumed.dice.roll()];
    expect(actual).toEqual(expected);
  });

  // Rebuilding the decks used to shuffle them, which drew from the shared PRNG
  // and left the restored game one stream position adrift per deck.
  it('spends no randomness rebuilding the game', () => {
    rng.seed(snapshot.rngState);
    restoreGame(snapshot);
    expect(rng.getSeed()).toBe(snapshot.rngState);
  });

  it('does not carry over objects from the saved game', () => {
    expect(restored.board).not.toBe(original.board);
    expect(restored.players[0]).not.toBe(original.players[0]);
    restored.players[0].cash = 1;
    expect(original.players[0].cash).toBe(640);
  });
});

describe('Snapshot — validation', () => {
  const goodSnapshot = () => captureGame(playedGame());

  it('accepts a snapshot it just wrote', () => {
    expect(validateSnapshot(goodSnapshot())).toBe(true);
  });

  it('refuses anything that is not a snapshot', () => {
    expect(validateSnapshot(null)).toBe(false);
    expect(validateSnapshot('save')).toBe(false);
    expect(validateSnapshot({})).toBe(false);
  });

  it('refuses a save written by another version', () => {
    expect(validateSnapshot({ ...goodSnapshot(), version: SNAPSHOT_VERSION + 1 })).toBe(false);
  });

  it('refuses a save with no deck state', () => {
    const snapshot = goodSnapshot() as Partial<GameSnapshot>;
    delete snapshot.decks;
    expect(validateSnapshot(snapshot)).toBe(false);
  });

  it('refuses a tile that is not on this board', () => {
    const snapshot = goodSnapshot();
    snapshot.tiles.push({ id: 999, ownerId: null, houses: 0, hasHotel: false, isMortgaged: false });
    expect(validateSnapshot(snapshot)).toBe(false);
  });

  it('refuses a deed owned by somebody who is not in the save', () => {
    const snapshot = goodSnapshot();
    snapshot.tiles[0].ownerId = 'p9';
    expect(validateSnapshot(snapshot)).toBe(false);
  });

  it('refuses a turn pointing at nobody', () => {
    const snapshot = goodSnapshot();
    snapshot.turn.currentPlayerIndex = 7;
    expect(validateSnapshot(snapshot)).toBe(false);
  });

  // A save names its turn order and win condition. This build may not have them
  // registered — better refused than thrown half-way through a restore.
  it('refuses a save naming a turn order this build does not have', () => {
    const snapshot = goodSnapshot();
    snapshot.rules.turnOrder = 'widdershins';
    expect(validateSnapshot(snapshot)).toBe(false);
  });

  it('refuses a save naming a win condition this build does not have', () => {
    const snapshot = goodSnapshot();
    snapshot.rules.winCondition = 'mostHotels';
    expect(validateSnapshot(snapshot)).toBe(false);
  });

  it('refuses a save with no players', () => {
    expect(validateSnapshot({ ...goodSnapshot(), players: [] })).toBe(false);
  });
});
