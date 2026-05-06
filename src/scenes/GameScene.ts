import Phaser from 'phaser';
import { Board } from '@/game/Board';
import { Player } from '@/game/Player';
import { Dice } from '@/game/Dice';
import { Bank } from '@/game/Bank';
import { TurnManager } from '@/game/TurnManager';
import { CardDeck, CardEffects, CHANCE_CARDS, COMMUNITY_CHEST_CARDS } from '@/cards/CardDeck';
import { bus } from '@/utils/EventBus';
import { rng } from '@/utils/PRNG';
import { Notification } from '@/ui/Notification';
import {
  BOARD_ORIGIN_X, BOARD_ORIGIN_Y, CORNER_SIZE, TILE_W, TILE_H,
  GROUP_COLORS, DEFAULT_HOUSE_RULES,
  type TokenType, type HouseRules,
} from '@/config';
import { PropertyTile } from '@/tiles/PropertyTile';
import type { RailroadTile, UtilityTile } from '@/tiles/SpecialTiles';

// Token colour palette (matches BootScene generated textures)
const TOKEN_HEX: Record<string, string> = {
  topHat: '#222222', car: '#e74c3c', dog: '#e67e22', battleship: '#3498db',
  iron: '#95a5a6', boot: '#8b4513', wheelbarrow: '#2ecc71', thimble: '#f1c40f',
};

interface SceneData {
  players: Array<{ name: string; token: TokenType }>;
  seed?: number;
}

// Payload shapes emitted by the bus
interface MovePayload  { playerId: string; from: number; to: number; steps: number; isDoubles: boolean }
interface RentPayload  { debtorId: string; creditorId: string; amount?: number; tileId: number; reason?: string }
interface TaxPayload   { playerId: string; amount: number; tileId: number }
interface AuctionPayload { tileId: number; playerId: string }
interface JailPayload  { playerId: string; reason: string }
interface NotifPayload { message: string; type: 'info' | 'success' | 'warning' | 'danger' }

export class GameScene extends Phaser.Scene {
  // ── Model ────────────────────────────────────────────────────────────────────
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
  private tokenSprites: Map<string, Phaser.GameObjects.Arc> = new Map();
  private tokenLabels:  Map<string, Phaser.GameObjects.Text> = new Map();
  private rollBtn!: Phaser.GameObjects.Text;
  private jailBtn!: Phaser.GameObjects.Text;   // "Pay $50 / Use Card" while in jail
  private buyPrompt!: Phaser.GameObjects.Container;
  private notif!: Notification;
  private isAnimating = false;

  constructor() { super({ key: 'GameScene' }); }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  init(data: SceneData): void {
    if (data.seed) rng['state'] = data.seed;
    bus.clear();  // fresh listeners each game

    this.board   = new Board();
    this.bank    = new Bank();
    this.dice    = new Dice();
    this.players = data.players.map((p, i) => new Player(`p${i + 1}`, p.name, p.token));
    this.turnManager = new TurnManager(this.players, this.board, this.dice);
    this.chanceDeck  = new CardDeck(CHANCE_CARDS);
    this.commDeck    = new CardDeck(COMMUNITY_CHEST_CARDS);
    this.cardEffects = new CardEffects(this.board, this.bank, this.players);
  }

  create(): void {
    this.drawBoard();
    this.spawnTokens();
    this.buildButtons();
    this.buildBuyPrompt();
    this.notif = new Notification(this);
    this.registerBusListeners();

    // Boot UIScene with initial player list
    this.scene.launch('UIScene', { players: this.players });
    this.turnManager.startTurn();
  }

  // ── Board drawing ─────────────────────────────────────────────────────────────

  private drawBoard(): void {
    const g = this.add.graphics();
    const boardW = CORNER_SIZE * 2 + TILE_W * 9;

    g.fillStyle(0xd4e8c2, 1);
    g.fillRect(BOARD_ORIGIN_X, BOARD_ORIGIN_Y, boardW, boardW);
    g.lineStyle(1, 0x555544, 1);

    // ── Bottom row (0–10) — face UP, color stripe on TOP ─────────────────────
    for (let i = 0; i <= 10; i++) {
      const layout = this.board.getLayout(i);
      const w = (i === 0 || i === 10) ? CORNER_SIZE : TILE_W;
      g.strokeRect(layout.x - w / 2, layout.y - TILE_H / 2, w, TILE_H);
      const tile = this.board.getTile(i);
      if (tile.type === 'property') {
        const pt = tile as PropertyTile;
        g.fillStyle(GROUP_COLORS[pt.group], 1);
        g.fillRect(layout.x - w / 2, layout.y - TILE_H / 2, w, 14);
      }
      this.add.text(layout.x, layout.y + 4, tile.name, {
        fontFamily: 'Arial', fontSize: '6px', color: '#111111',
        wordWrap: { width: w - 4 }, align: 'center',
      }).setOrigin(0.5, 0.5);
    }

    // ── Left column (11–19) — face RIGHT, color stripe on RIGHT ──────────────
    for (let i = 11; i <= 19; i++) {
      const layout = this.board.getLayout(i);
      g.strokeRect(layout.x - TILE_H / 2, layout.y - TILE_W / 2, TILE_H, TILE_W);
      const tile = this.board.getTile(i);
      if (tile.type === 'property') {
        const pt = tile as PropertyTile;
        g.fillStyle(GROUP_COLORS[pt.group], 1);
        g.fillRect(layout.x + TILE_H / 2 - 14, layout.y - TILE_W / 2, 14, TILE_W);
      }
      this.add.text(layout.x, layout.y, tile.name, {
        fontFamily: 'Arial', fontSize: '6px', color: '#111111',
        wordWrap: { width: TILE_H - 18 }, align: 'center',
      }).setOrigin(0.5, 0.5);
    }

    // ── Top row (20–30) — face DOWN, color stripe on BOTTOM ──────────────────
    for (let i = 20; i <= 30; i++) {
      const layout = this.board.getLayout(i);
      const w = (i === 20 || i === 30) ? CORNER_SIZE : TILE_W;
      g.strokeRect(layout.x - w / 2, layout.y - TILE_H / 2, w, TILE_H);
      const tile = this.board.getTile(i);
      if (tile.type === 'property') {
        const pt = tile as PropertyTile;
        g.fillStyle(GROUP_COLORS[pt.group], 1);
        g.fillRect(layout.x - w / 2, layout.y + TILE_H / 2 - 14, w, 14);
      }
      this.add.text(layout.x, layout.y - 4, tile.name, {
        fontFamily: 'Arial', fontSize: '6px', color: '#111111',
        wordWrap: { width: w - 4 }, align: 'center',
      }).setOrigin(0.5, 0.5);
    }

    // ── Right column (31–39) — face LEFT, color stripe on LEFT ───────────────
    for (let i = 31; i <= 39; i++) {
      const layout = this.board.getLayout(i);
      g.strokeRect(layout.x - TILE_H / 2, layout.y - TILE_W / 2, TILE_H, TILE_W);
      const tile = this.board.getTile(i);
      if (tile.type === 'property') {
        const pt = tile as PropertyTile;
        g.fillStyle(GROUP_COLORS[pt.group], 1);
        g.fillRect(layout.x - TILE_H / 2, layout.y - TILE_W / 2, 14, TILE_W);
      }
      this.add.text(layout.x, layout.y, tile.name, {
        fontFamily: 'Arial', fontSize: '6px', color: '#111111',
        wordWrap: { width: TILE_H - 18 }, align: 'center',
      }).setOrigin(0.5, 0.5);
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

  // ── Tokens ────────────────────────────────────────────────────────────────────

  private spawnTokens(): void {
    // Stack tokens on Go with small offsets
    const offsets = [
      [-10, -10], [10, -10], [-10, 10], [10, 10],
      [0, -16], [0, 16], [-16, 0], [16, 0],
    ];
    this.players.forEach((player, i) => {
      const layout = this.board.getLayout(0);
      const [ox, oy] = offsets[i] ?? [0, 0];

      const circle = this.add.arc(layout.x + ox, layout.y + oy, 9, 0, 360, false,
        Phaser.Display.Color.HexStringToColor(TOKEN_HEX[player.token] ?? '#ffffff').color,
      ).setDepth(10).setStrokeStyle(1.5, 0xffffff);

      const label = this.add.text(layout.x + ox, layout.y + oy,
        player.name[0].toUpperCase(),
        { fontFamily: 'Arial', fontSize: '8px', color: '#ffffff', fontStyle: 'bold' },
      ).setOrigin(0.5).setDepth(11);

      this.tokenSprites.set(player.id, circle);
      this.tokenLabels.set(player.id, label);
    });
  }

  // Step-by-step token movement: chain a tween per tile
  private async moveTokenStepByStep(playerId: string, from: number, steps: number): Promise<void> {
    if (steps === 0) return;
    const sprite = this.tokenSprites.get(playerId);
    const label  = this.tokenLabels.get(playerId);
    if (!sprite || !label) return;

    const STEP_MS = 100;

    for (let s = 1; s <= steps; s++) {
      const tileIndex = (from + s) % 40;
      const layout    = this.board.getLayout(tileIndex);
      await new Promise<void>((resolve) => {
        this.tweens.add({
          targets: [sprite, label],
          x: layout.x,
          y: layout.y,
          duration: STEP_MS,
          ease: 'Sine.easeInOut',
          onComplete: () => resolve(),
        });
      });
    }
  }

  // ── Buttons ───────────────────────────────────────────────────────────────────

  private buildButtons(): void {
    // Roll button
    this.rollBtn = this.add.text(1155, 560, '🎲  ROLL', {
      fontFamily: 'Georgia, serif', fontSize: '20px', color: '#ffffff',
      backgroundColor: '#c0392b', padding: { x: 18, y: 10 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(20);

    this.rollBtn.on('pointerdown', () => {
      if (this.isAnimating) return;
      this.turnManager.rollDice();
    });
    this.rollBtn.on('pointerover', () => this.rollBtn.setStyle({ backgroundColor: '#e74c3c' }));
    this.rollBtn.on('pointerout',  () => this.rollBtn.setStyle({ backgroundColor: '#c0392b' }));

    // Jail action button (hidden by default)
    this.jailBtn = this.add.text(1155, 610, '🔓  Pay $50', {
      fontFamily: 'Georgia, serif', fontSize: '14px', color: '#ffffff',
      backgroundColor: '#7d6608', padding: { x: 12, y: 8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(20).setVisible(false);

    this.jailBtn.on('pointerdown', () => {
      const p = this.turnManager.currentPlayer;
      if (p.getOutOfJailCards > 0) {
        this.turnManager.useGetOutOfJailCard(p);
      } else {
        this.turnManager.payJailFine(p);
      }
      this.jailBtn.setVisible(false);
    });
  }

  private setRollEnabled(enabled: boolean): void {
    this.rollBtn.setAlpha(enabled ? 1 : 0.4);
    this.rollBtn.setInteractive(enabled ? { useHandCursor: true } : false);
  }

  // ── Buy Prompt ────────────────────────────────────────────────────────────────

  private buildBuyPrompt(): void {
    const bg = this.add.rectangle(0, -120, 340, 200, 0x16213e, 0.97).setStrokeStyle(2, 0x5577cc);
    this.buyPrompt = this.add.container(512, 420, [bg]).setDepth(30).setVisible(false);
  }

  private showBuyPrompt(tileId: number, playerId: string): void {
    const tile   = this.board.getTile(tileId) as PropertyTile;
    const player = this.players.find((p) => p.id === playerId)!;
    if (!tile || tile.type !== 'property') { this.turnManager.declineBuy(); return; }

    // Clear previous prompt children (keep bg at [0])
    while (this.buyPrompt.length > 1) {
      this.buyPrompt.getAt<Phaser.GameObjects.GameObject>(1).destroy();
      this.buyPrompt.removeAt(1);
    }

    const title = this.add.text(0, -188, tile.name, {
      fontFamily: 'Georgia, serif', fontSize: '18px', color: '#f0c040', fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5);

    const info = this.add.text(0, -160, `Price: $${tile.price}   Rent: $${tile.rentTiers[0]}`, {
      fontFamily: 'Georgia, serif', fontSize: '13px', color: '#aaaacc',
    }).setOrigin(0.5);

    const cash = this.add.text(0, -140, `Your cash: $${player.cash.toLocaleString()}`, {
      fontFamily: 'Georgia, serif', fontSize: '13px', color: '#ffffff',
    }).setOrigin(0.5);

    const canAfford = player.canAfford(tile.price);

    const buyBtn = this.add.text(-70, -100, '✅  BUY', {
      fontFamily: 'Georgia, serif', fontSize: '16px', color: '#ffffff',
      backgroundColor: canAfford ? '#27ae60' : '#555555',
      padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setInteractive(canAfford ? { useHandCursor: true } : false);

    if (canAfford) {
      buyBtn.on('pointerdown', () => {
        this.bank.sellPropertyToPlayer(player, tile);
        this.notif.show(`${player.name} bought ${tile.name} for $${tile.price}!`, 'success');
        this.hideBuyPrompt();
        this.pushUIUpdate();
        this.time.delayedCall(400, () => this.turnManager.confirmBuy());
      });
    }

    const declineBtn = this.add.text(70, -100, '❌  PASS', {
      fontFamily: 'Georgia, serif', fontSize: '16px', color: '#ffffff',
      backgroundColor: '#7f1d1d', padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    declineBtn.on('pointerdown', () => {
      this.notif.show(`${player.name} passed on ${tile.name}.`, 'info');
      this.hideBuyPrompt();
      this.time.delayedCall(300, () => this.turnManager.declineBuy());
    });

    this.buyPrompt.add([title, info, cash, buyBtn, declineBtn]);
    this.buyPrompt.setVisible(true);
  }

  private hideBuyPrompt(): void {
    this.buyPrompt.setVisible(false);
  }

  // ── Bus event wiring ──────────────────────────────────────────────────────────

  private registerBusListeners(): void {

    // ── Movement ──────────────────────────────────────────────────────────────
    bus.on<MovePayload>('player:move', ({ playerId, from, to, steps }) => {
      this.isAnimating = true;
      this.setRollEnabled(false);

      this.moveTokenStepByStep(playerId, from, steps).then(() => {
        this.isAnimating = false;
        this.turnManager.resolveLanding();
      });
    });

    // ── Dice ──────────────────────────────────────────────────────────────────
    bus.on('dice:result', (result: { die1: number; die2: number; total: number; isDoubles: boolean }) => {
      this.scene.get('UIScene').events.emit('dice:result', result);
    });

    // ── Turn bookkeeping ──────────────────────────────────────────────────────
    bus.on('turn:start', ({ playerId }: { playerId: string }) => {
      this.setRollEnabled(true);
      const player = this.players.find((p) => p.id === playerId)!;

      // Show jail button if player is in jail and can act
      const showJail = player.inJail && (player.getOutOfJailCards > 0 || player.cash >= 50);
      this.jailBtn.setVisible(showJail);
      if (showJail) {
        this.jailBtn.setText(player.getOutOfJailCards > 0 ? '🃏  Use Card' : '🔓  Pay $50');
      }

      this.scene.get('UIScene').events.emit('turn:start', { player, players: this.players });
    });

    bus.on('turn:end', () => {
      this.setRollEnabled(false);
      this.jailBtn.setVisible(false);
    });

    // ── Rent (player→player or bank→player for Go salary) ─────────────────────
    bus.on<RentPayload>('rent:pay', ({ debtorId, creditorId, amount, tileId, reason }) => {
      let resolved = amount ?? 0;

      if (resolved === 0) {
        // Railroad or Utility — compute from tile
        const tile = this.board.getTile(tileId);
        const creditor = this.players.find((p) => p.id === creditorId);
        if (!creditor) return;

        if (tile.type === 'railroad') {
          const owned = [...creditor.ownedTileIds].filter(
            (id) => this.board.getTile(id).type === 'railroad',
          ).length;
          resolved = (tile as unknown as RailroadTile).rentFor(owned);
        } else if (tile.type === 'utility') {
          const owned = [...creditor.ownedTileIds].filter(
            (id) => this.board.getTile(id).type === 'utility',
          ).length;
          const mult = (tile as unknown as UtilityTile).rentMultiplier(owned);
          resolved = mult * (this.dice.lastResult?.total ?? 7);
        }
      }

      if (reason === 'go') {
        // Bank pays player
        const player = this.players.find((p) => p.id === creditorId)!;
        this.bank.payPlayer(player, resolved);
        this.notif.show(`${player.name} passed GO — collect $${resolved}!`, 'success');
        this.pushUIUpdate();
        return;
      }

      // Player pays player
      const debtor   = this.players.find((p) => p.id === debtorId);
      const creditor = this.players.find((p) => p.id === creditorId);
      if (!debtor || !creditor) return;

      this.bank.transferBetweenPlayers(debtor, creditor, resolved);
      this.notif.show(
        `${debtor.name} paid $${resolved} rent to ${creditor.name}.`, 'warning',
      );
      this.pushUIUpdate();
      this.checkBankruptcy(debtor);
      // Auto-end turn after notification
      this.time.delayedCall(600, () => this.turnManager.endTurn());
    });

    // ── Tax ───────────────────────────────────────────────────────────────────
    bus.on<TaxPayload>('tax:pay', ({ playerId, amount }) => {
      const player = this.players.find((p) => p.id === playerId)!;
      this.bank.collectTax(player, amount);
      this.notif.show(`${player.name} paid $${amount} tax.`, 'danger');
      this.pushUIUpdate();
      this.checkBankruptcy(player);
      this.time.delayedCall(600, () => this.turnManager.endTurn());
    });

    // ── Unowned property — show buy prompt ────────────────────────────────────
    bus.on<AuctionPayload>('property:auction', ({ tileId, playerId }) => {
      const tile = this.board.getTile(tileId);
      if (tile.type === 'property' && !( tile as PropertyTile).ownerId) {
        this.showBuyPrompt(tileId, playerId);
      } else {
        // Railroad / Utility unowned
        this.notif.show(`No one owns that — available for purchase.`, 'info');
        this.time.delayedCall(500, () => this.turnManager.declineBuy());
      }
    });

    // ── Jail ──────────────────────────────────────────────────────────────────
    bus.on<JailPayload>('jail:enter', ({ playerId, reason }) => {
      const player = this.players.find((p) => p.id === playerId)!;
      // Move token directly to jail (sendToJail also emits player:move with steps:0)
      const layout = this.board.getLayout(10);
      const sprite = this.tokenSprites.get(playerId);
      const label  = this.tokenLabels.get(playerId);
      if (sprite) { sprite.setPosition(layout.x, layout.y); }
      if (label)  { label.setPosition(layout.x, layout.y); }

      const why = reason === 'doubles' ? 'rolled three doubles' : reason === 'tile' ? 'landed on Go to Jail' : 'drew a card';
      this.notif.show(`${player.name} went to jail (${why})!`, 'danger');
      this.pushUIUpdate();
      this.time.delayedCall(700, () => this.turnManager.endTurn());
    });

    // ── Free landing (Go, Free Parking, Just Visiting) ────────────────────────
    bus.on('player:landed', ({ playerId }: { playerId: string }) => {
      this.time.delayedCall(300, () => this.turnManager.endTurn());
    });

    // ── Card ──────────────────────────────────────────────────────────────────
    bus.on('card:draw', ({ playerId, deckType }: { playerId: string; deckType: string }) => {
      const player = this.players.find((p) => p.id === playerId)!;
      const deck   = deckType === 'chance' ? this.chanceDeck : this.commDeck;
      const card   = deck.drawCard();

      if (!card.isGetOutOfJail) deck.returnCard(card);
      this.cardEffects.execute(card, player);
      this.pushUIUpdate();

      // Launch card overlay; after it's dismissed endTurn
      this.scene.launch('CardScene', { card });
      // Listen for CardScene shutdown to advance turn
      this.scene.get('CardScene').events.once('shutdown', () => {
        this.time.delayedCall(200, () => this.turnManager.endTurn());
      });
    });

    // ── Generic notification from TurnManager ─────────────────────────────────
    bus.on<NotifPayload>('ui:notification', ({ message, type }) => {
      this.notif.show(message, type);
      this.pushUIUpdate();
    });

    // ── Game over ─────────────────────────────────────────────────────────────
    bus.on('game:end', ({ winnerId }: { winnerId: string | null }) => {
      const winner = this.players.find((p) => p.id === winnerId);
      this.setRollEnabled(false);

      const overlay = this.add.rectangle(512, 400, 500, 180, 0x000000, 0.85)
        .setStrokeStyle(3, 0xf0c040).setDepth(90);
      this.add.text(512, 380, `🏆 ${winner?.name ?? 'Nobody'} wins!`, {
        fontFamily: 'Georgia, serif', fontSize: '36px', color: '#f0c040',
        stroke: '#000', strokeThickness: 5,
      }).setOrigin(0.5).setDepth(91);
      this.add.text(512, 430, 'Refresh the page to play again.', {
        fontFamily: 'Georgia, serif', fontSize: '16px', color: '#aaaacc',
      }).setOrigin(0.5).setDepth(91);
      void overlay;
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /** Push fresh player data to UIScene */
  private pushUIUpdate(): void {
    const uiEvents = this.scene.get('UIScene')?.events;
    if (!uiEvents) return;
    uiEvents.emit('players:update', {
      players: this.players,
      activeId: this.turnManager.currentPlayer.id,
    });
  }

  private checkBankruptcy(player: Player): void {
    if (player.cash <= 0) {
      player.isBankrupt = true;
      this.notif.show(`${player.name} is bankrupt! 💀`, 'danger', 3500);
      bus.emit('player:bankrupt', { playerId: player.id });
    }
  }

  // ── Serialization ─────────────────────────────────────────────────────────────

  serialize(): object {
    return {
      board:   this.board.toJSON(),
      players: this.players.map((p) => p.toJSON()),
      dice:    this.dice.toJSON(),
      bank:    this.bank.toJSON(),
      turn:    this.turnManager.toJSON(),
    };
  }
}
