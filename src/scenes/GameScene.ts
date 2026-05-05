import Phaser from 'phaser';
import { Board } from '@/game/Board';
import { Player } from '@/game/Player';
import { Dice } from '@/game/Dice';
import { Bank } from '@/game/Bank';
import { TurnManager } from '@/game/TurnManager';
import { CardDeck, CardEffects, CHANCE_CARDS, COMMUNITY_CHEST_CARDS } from '@/cards/CardDeck';
import { bus } from '@/utils/EventBus';
import { rng } from '@/utils/PRNG';
import {
  BOARD_ORIGIN_X, BOARD_ORIGIN_Y, CORNER_SIZE, TILE_W, TILE_H,
  GROUP_COLORS, DEFAULT_HOUSE_RULES,
  type TokenType, type HouseRules,
} from '@/config';
import { PropertyTile } from '@/tiles/PropertyTile';

interface SceneData {
  players: Array<{ name: string; token: TokenType }>;
  seed?: number;
}

export class GameScene extends Phaser.Scene {
  // ── Game model ───────────────────────────────────────────────────────────────
  board!: Board;
  players!: Player[];
  dice!: Dice;
  bank!: Bank;
  turnManager!: TurnManager;
  chanceDeck!: CardDeck;
  commDeck!: CardDeck;
  cardEffects!: CardEffects;
  houseRules: HouseRules = { ...DEFAULT_HOUSE_RULES };

  // ── Visuals ──────────────────────────────────────────────────────────────────
  private tokenSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  private rollButton!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: SceneData): void {
    if (data.seed) rng['state'] = data.seed;

    this.board   = new Board();
    this.bank    = new Bank();
    this.dice    = new Dice();

    this.players = data.players.map((p, i) =>
      new Player(`p${i + 1}`, p.name, p.token),
    );

    this.turnManager = new TurnManager(this.players, this.board, this.dice);
    this.chanceDeck  = new CardDeck(CHANCE_CARDS);
    this.commDeck    = new CardDeck(COMMUNITY_CHEST_CARDS);
    this.cardEffects = new CardEffects(this.board, this.bank, this.players);
  }

  create(): void {
    this.drawBoard();
    this.spawnTokens();
    this.buildRollButton();
    this.registerBusListeners();

    // Kick off first turn
    this.turnManager.startTurn();
  }

  // ─── Board rendering ─────────────────────────────────────────────────────────

  private drawBoard(): void {
    const g = this.add.graphics();
    const boardW = CORNER_SIZE * 2 + TILE_W * 9;

    // Board background
    g.fillStyle(0xd4e8c2, 1);
    g.fillRect(BOARD_ORIGIN_X, BOARD_ORIGIN_Y, boardW, boardW);

    // Tile outlines
    g.lineStyle(1, 0x555544, 1);

    // ── Bottom row (0–10): tile face UP → color stripe on TOP edge ────────────
    for (let i = 0; i <= 10; i++) {
      const layout = this.board.getLayout(i);
      const w = i === 0 || i === 10 ? CORNER_SIZE : TILE_W;
      g.strokeRect(layout.x - w / 2, layout.y - TILE_H / 2, w, TILE_H);

      const tile = this.board.getTile(i);
      if (tile.type === 'property') {
        const pt = tile as PropertyTile;
        g.fillStyle(GROUP_COLORS[pt.group], 1);
        g.fillRect(layout.x - w / 2, layout.y - TILE_H / 2, w, 14); // TOP stripe
      }

      this.add.text(layout.x, layout.y + 4, tile.name, {
        fontFamily: 'Arial', fontSize: '6px', color: '#111111', wordWrap: { width: w - 4 },
        align: 'center',
      }).setOrigin(0.5, 0.5);
    }

    // ── Left column (11–19): tile faces RIGHT → color stripe on RIGHT edge ────
    for (let i = 11; i <= 19; i++) {
      const layout = this.board.getLayout(i);
      g.strokeRect(layout.x - TILE_H / 2, layout.y - TILE_W / 2, TILE_H, TILE_W);

      const tile = this.board.getTile(i);
      if (tile.type === 'property') {
        const pt = tile as PropertyTile;
        g.fillStyle(GROUP_COLORS[pt.group], 1);
        g.fillRect(layout.x + TILE_H / 2 - 14, layout.y - TILE_W / 2, 14, TILE_W); // RIGHT stripe
      }

      this.add.text(layout.x, layout.y, tile.name, {
        fontFamily: 'Arial', fontSize: '6px', color: '#111111', wordWrap: { width: TILE_H - 18 },
        align: 'center',
      }).setOrigin(0.5, 0.5);
    }

    // ── Top row (20–30): tiles face DOWN → color stripe on BOTTOM edge ────────
    for (let i = 20; i <= 30; i++) {
      const layout = this.board.getLayout(i);
      const w = i === 20 || i === 30 ? CORNER_SIZE : TILE_W;
      g.strokeRect(layout.x - w / 2, layout.y - TILE_H / 2, w, TILE_H);

      const tile = this.board.getTile(i);
      if (tile.type === 'property') {
        const pt = tile as PropertyTile;
        g.fillStyle(GROUP_COLORS[pt.group], 1);
        g.fillRect(layout.x - w / 2, layout.y + TILE_H / 2 - 14, w, 14); // BOTTOM stripe
      }

      this.add.text(layout.x, layout.y - 4, tile.name, {
        fontFamily: 'Arial', fontSize: '6px', color: '#111111', wordWrap: { width: w - 4 },
        align: 'center',
      }).setOrigin(0.5, 0.5);
    }

    // ── Right column (31–39): tile faces LEFT → color stripe on LEFT edge ─────
    for (let i = 31; i <= 39; i++) {
      const layout = this.board.getLayout(i);
      g.strokeRect(layout.x - TILE_H / 2, layout.y - TILE_W / 2, TILE_H, TILE_W);

      const tile = this.board.getTile(i);
      if (tile.type === 'property') {
        const pt = tile as PropertyTile;
        g.fillStyle(GROUP_COLORS[pt.group], 1);
        g.fillRect(layout.x - TILE_H / 2, layout.y - TILE_W / 2, 14, TILE_W); // LEFT stripe
      }

      this.add.text(layout.x, layout.y, tile.name, {
        fontFamily: 'Arial', fontSize: '6px', color: '#111111', wordWrap: { width: TILE_H - 18 },
        align: 'center',
      }).setOrigin(0.5, 0.5);
    }

    // (dummy block to satisfy replacement — original forEach body closed here)
    if (false) {
      const layout = { x: 0, y: 0, rotation: 0, side: 'bottom' as const };
      const tile = this.board.getTile(0);
      void layout; void tile;
      }

    // Center logo
    const cx = BOARD_ORIGIN_X + boardW / 2;
    const cy = BOARD_ORIGIN_Y + boardW / 2;
    this.add.text(cx, cy - 20, '🏦', { fontSize: '48px' }).setOrigin(0.5);
    this.add.text(cx, cy + 30, 'MONOPOLY\nFORGE', {
      fontFamily: 'Georgia, serif', fontSize: '20px', color: '#222244',
      align: 'center', fontStyle: 'bold',
    }).setOrigin(0.5);
  }

  // ─── Tokens ───────────────────────────────────────────────────────────────────

  private spawnTokens(): void {
    this.players.forEach((player) => {
      const layout = this.board.getLayout(0); // All start on Go
      const sprite = this.add.image(layout.x, layout.y, `token_${player.token}`)
        .setScale(1)
        .setDepth(10);
      this.tokenSprites.set(player.id, sprite);
    });
  }

  private moveToken(playerId: string, toIndex: number): void {
    const sprite = this.tokenSprites.get(playerId);
    if (!sprite) return;
    const layout = this.board.getLayout(toIndex);
    // Small random offset so tokens don't overlap perfectly
    const ox = Phaser.Math.Between(-8, 8);
    const oy = Phaser.Math.Between(-8, 8);
    this.tweens.add({
      targets: sprite,
      x: layout.x + ox,
      y: layout.y + oy,
      duration: 400,
      ease: 'Sine.easeInOut',
      onComplete: () => this.turnManager.resolveLanding(),
    });
  }

  // ─── Roll Button ──────────────────────────────────────────────────────────────

  private buildRollButton(): void {
    this.rollButton = this.add.text(1150, 400, '🎲  ROLL', {
      fontFamily: 'Georgia, serif',
      fontSize: '22px',
      color: '#ffffff',
      backgroundColor: '#c0392b',
      padding: { x: 20, y: 12 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(20);

    this.rollButton.on('pointerdown', () => this.turnManager.rollDice());
    this.rollButton.on('pointerover', () => this.rollButton.setStyle({ backgroundColor: '#e74c3c' }));
    this.rollButton.on('pointerout',  () => this.rollButton.setStyle({ backgroundColor: '#c0392b' }));
  }

  // ─── EventBus listeners ───────────────────────────────────────────────────────

  private registerBusListeners(): void {
    bus.on('player:move', ({ playerId, to }: { playerId: string; to: number }) => {
      this.moveToken(playerId, to);
    });

    bus.on('dice:result', (result: { die1: number; die2: number; total: number }) => {
      this.scene.get('UIScene').events.emit('dice:result', result);
    });

    bus.on('turn:start', ({ playerId }: { playerId: string }) => {
      const player = this.players.find((p) => p.id === playerId);
      this.scene.get('UIScene').events.emit('turn:start', { player });
    });

    bus.on('card:draw', ({ playerId, deckType }: { playerId: string; deckType: string }) => {
      const player = this.players.find((p) => p.id === playerId)!;
      const deck   = deckType === 'chance' ? this.chanceDeck : this.commDeck;
      const card   = deck.drawCard();
      if (card.isGetOutOfJail) {
        // Hold in player's hand; don't return to deck until used/traded
      } else {
        deck.returnCard(card);
      }
      this.cardEffects.execute(card, player);
      this.scene.launch('CardScene', { card });
    });

    bus.on('game:end', ({ winnerId }: { winnerId: string | null }) => {
      const winner = this.players.find((p) => p.id === winnerId);
      this.add.text(640, 400, `🏆 ${winner?.name ?? 'Nobody'} wins!`, {
        fontFamily: 'Georgia, serif', fontSize: '40px', color: '#f0c040',
        stroke: '#000', strokeThickness: 6,
      }).setOrigin(0.5).setDepth(100);
    });
  }

  // ─── Serialization ────────────────────────────────────────────────────────────

  serialize(): object {
    return {
      board: this.board.toJSON(),
      players: this.players.map((p) => p.toJSON()),
      dice: this.dice.toJSON(),
      bank: this.bank.toJSON(),
      turn: this.turnManager.toJSON(),
    };
  }
}
