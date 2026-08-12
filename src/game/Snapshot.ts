import { rng } from '@/utils/PRNG';
import { dwarn } from '@/utils/log';
import { CardDeck, CardEffects, CHANCE_CARDS, COMMUNITY_CHEST_CARDS } from '@/cards/CardDeck';
import { PropertyTile } from '@/tiles/PropertyTile';
import { isOwnable } from '@/tiles/Tile';
import { DEFAULT_HOUSE_RULES, type HouseRules, type TokenType } from '@/config';
import { Board } from './Board';
import { Bank } from './Bank';
import { Dice, type DiceResult } from './Dice';
import { Player } from './Player';
import { TurnManager } from './TurnManager';

// ─── Snapshot ─────────────────────────────────────────────────────────────────
// The whole game as plain data, and back again. This is the half that save/load
// was missing: `toJSON` existed everywhere, but nothing could read it back.
//
// Three things are easy to get wrong and are handled here rather than at the
// call site:
//
//   1. **The PRNG stream position, not the original seed.** `rng.getSeed()`
//      returns where the stream *is*; restoring it must happen before the decks
//      are rebuilt, or the shuffles diverge from the saved game.
//   2. **Deck order.** Both piles are saved as card ids in order. Without them a
//      restored game reshuffles and deals cards players have already seen.
//   3. **Cards are shared objects.** A Get Out of Jail Free card in a player's
//      hand is the same object as the one in `CHANCE_CARDS`, so it is stored by
//      id and looked up again — never cloned, or `deck.owns()` stops working.
//
// A restore resumes at the start of the saved player's turn. Mid-move state is
// deliberately not captured: see `restoreGame`.

export const SNAPSHOT_VERSION = 3;

export interface TileSnapshot {
  id: number;
  ownerId: string | null;
  houses: number;
  hasHotel: boolean;
  isMortgaged: boolean;
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  token: TokenType;
  cash: number;
  position: number;
  inJail: boolean;
  jailTurns: number;
  jailCardIds: string[];
  ownedTileIds: number[];
  isBankrupt: boolean;
  doublesStreak: number;
  isBot: boolean;
}

export interface DeckSnapshot {
  draw: string[];
  discard: string[];
}

export interface GameSnapshot {
  version: number;
  /** Where the random stream had got to, not the seed the game started from. */
  rngState: number;
  players: PlayerSnapshot[];
  tiles: TileSnapshot[];
  bank: { houses: number; hotels: number; pot: number };
  turn: { currentPlayerIndex: number };
  dice: DiceResult | null;
  decks: { chance: DeckSnapshot; community: DeckSnapshot };
  houseRules: HouseRules;
}

/** Everything a running game is made of — what a restore hands back. */
export interface GameParts {
  board: Board;
  bank: Bank;
  dice: Dice;
  players: Player[];
  turnManager: TurnManager;
  chanceDeck: CardDeck;
  commDeck: CardDeck;
  cardEffects: CardEffects;
  houseRules: HouseRules;
}

// ─── Capture ──────────────────────────────────────────────────────────────────

export function captureGame(parts: GameParts): GameSnapshot {
  return {
    version:  SNAPSHOT_VERSION,
    rngState: rng.getSeed(),
    players:  parts.players.map(capturePlayer),
    tiles:    parts.board.tiles.filter(isOwnable).map((tile) => ({
      id:          tile.id,
      ownerId:     tile.ownerId,
      houses:      tile instanceof PropertyTile ? tile.houses : 0,
      hasHotel:    tile instanceof PropertyTile ? tile.hasHotel : false,
      isMortgaged: tile.isMortgaged,
    })),
    bank:  { houses: parts.bank.houses, hotels: parts.bank.hotels, pot: parts.bank.pot },
    turn:  { currentPlayerIndex: parts.turnManager.currentPlayerIndex },
    dice:  parts.dice.lastResult,
    decks: {
      chance:    parts.chanceDeck.snapshot(),
      community: parts.commDeck.snapshot(),
    },
    houseRules: { ...parts.houseRules },
  };
}

function capturePlayer(player: Player): PlayerSnapshot {
  return {
    id: player.id,
    name: player.name,
    token: player.token,
    cash: player.cash,
    position: player.position,
    inJail: player.inJail,
    jailTurns: player.jailTurns,
    jailCardIds: player.jailCards.map((c) => c.id),
    ownedTileIds: [...player.ownedTileIds],
    isBankrupt: player.isBankrupt,
    doublesStreak: player.doublesStreak,
    isBot: player.isBot,
  };
}

// ─── Restore ──────────────────────────────────────────────────────────────────

/**
 * Rebuild a game from a snapshot. The caller is responsible for the Phaser side —
 * tokens, panels and the active scene — which is why this returns the parts
 * rather than mutating a scene.
 *
 * The restored game resumes at the *start* of the saved player's turn: a save
 * taken mid-animation or mid-auction comes back as "your roll", which is the
 * honest thing to do with state the snapshot does not carry.
 */
export function restoreGame(snapshot: GameSnapshot): GameParts {
  // Before anything shuffles — the decks are rebuilt from the snapshot below,
  // but any later draw has to continue the saved stream, not restart it.
  rng.seed(snapshot.rngState);

  const board = new Board();
  const bank  = new Bank();
  const dice  = new Dice();

  bank.houses = snapshot.bank.houses;
  bank.hotels = snapshot.bank.hotels;
  bank.pot    = snapshot.bank.pot ?? 0;
  dice.lastResult = snapshot.dice;

  for (const saved of snapshot.tiles) {
    const tile = board.getTile(saved.id);
    if (!isOwnable(tile)) continue;
    tile.ownerId     = saved.ownerId;
    tile.isMortgaged = saved.isMortgaged;
    if (tile instanceof PropertyTile) {
      tile.houses   = saved.houses;
      tile.hasHotel = saved.hasHotel;
    }
  }

  const chanceDeck = CardDeck.restore(CHANCE_CARDS, snapshot.decks.chance);
  const commDeck   = CardDeck.restore(COMMUNITY_CHEST_CARDS, snapshot.decks.community);
  const allCards   = [...CHANCE_CARDS, ...COMMUNITY_CHEST_CARDS];

  const players = snapshot.players.map((saved) => {
    const player = new Player(saved.id, saved.name, saved.token, saved.isBot ?? false);
    player.cash          = saved.cash;
    player.position      = saved.position;
    player.inJail        = saved.inJail;
    player.jailTurns     = saved.jailTurns;
    player.isBankrupt    = saved.isBankrupt;
    player.doublesStreak = saved.doublesStreak;
    player.ownedTileIds  = new Set(saved.ownedTileIds);
    // By id, so the card is the same object the deck knows about.
    player.jailCards = saved.jailCardIds
      .map((id) => allCards.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => c !== undefined);
    return player;
  });

  const turnManager = new TurnManager(players, board, dice);
  turnManager.currentPlayerIndex = snapshot.turn.currentPlayerIndex;

  return {
    board, bank, dice, players, turnManager,
    chanceDeck, commDeck,
    cardEffects: new CardEffects(board, bank, players),
    houseRules: { ...DEFAULT_HOUSE_RULES, ...snapshot.houseRules },
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Whether a snapshot can be loaded into *this* build. Saves outlive code changes,
 * and a half-restored game is worse than a refused one.
 */
export function validateSnapshot(snapshot: unknown): snapshot is GameSnapshot {
  const s = snapshot as Partial<GameSnapshot> | null;
  if (!s || typeof s !== 'object') return reject('not an object');
  if (s.version !== SNAPSHOT_VERSION) return reject(`version ${s.version}, expected ${SNAPSHOT_VERSION}`);
  if (!Number.isFinite(s.rngState)) return reject('missing rng state');
  if (!Array.isArray(s.players) || s.players.length === 0) return reject('no players');
  if (!Array.isArray(s.tiles)) return reject('no tiles');
  if (!s.decks?.chance || !s.decks?.community) return reject('no deck state');
  if (!s.turn || !Number.isFinite(s.turn.currentPlayerIndex)) return reject('no turn state');
  if (s.turn.currentPlayerIndex >= s.players.length) return reject('turn points at nobody');

  // The map may have changed under the save.
  const board = new Board();
  for (const tile of s.tiles) {
    if (!Number.isFinite(tile?.id) || tile.id < 0 || tile.id >= board.size) {
      return reject(`tile ${tile?.id} is not on this board`);
    }
  }
  const ids = new Set(s.players.map((p) => p.id));
  for (const tile of s.tiles) {
    if (tile.ownerId !== null && !ids.has(tile.ownerId)) {
      return reject(`tile ${tile.id} is owned by a player who is not in the save`);
    }
  }
  return true;
}

function reject(reason: string): false {
  dwarn(`[Snapshot] refusing to load: ${reason}`);
  return false;
}
