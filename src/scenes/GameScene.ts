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

const TOKEN_HEX: Record<string, string> = {
  topHat: '#222222', car: '#e74c3c', dog: '#e67e22', battleship: '#3498db',
  iron: '#95a5a6', boot: '#8b4513', wheelbarrow: '#2ecc71', thimble: '#f1c40f',
};

interface SceneData {
  players: Array<{ name: string; token: TokenType }>;
  seed?: number;
}

interface MovePayload    { playerId: string; from: number; to: number; steps: number; isDoubles: boolean }
interface RentPayload    { debtorId: string; creditorId: string; amount?: number; tileId: number; reason?: string }
interface TaxPayload     { playerId: string; amount: number; tileId: number }
interface AuctionPayload { tileId: number; playerId: string; price?: number }
interface JailPayload    { playerId: string; reason: string }
interface NotifPayload   { message: string; type: 'info' | 'success' | 'warning' | 'danger' }

export class GameScene extends Phaser.Scene {
  board!:        Board;
  players!:      Player[];
  dice!:         Dice;
  bank!:         Bank;
  turnManager!:  TurnManager;
  chanceDeck!:   CardDeck;
  commDeck!:     CardDeck;
  cardEffects!:  CardEffects;
  houseRules:    HouseRules = { ...DEFAULT_HOUSE_RULES };

  private tokenSprites: Map<string, Phaser.GameObjects.Arc>  = new Map();
  private tokenLabels:  Map<string, Phaser.GameObjects.Text> = new Map();
  private rollBtn!:     Phaser.GameObjects.Text;
  private jailBtn!:     Phaser.GameObjects.Text;
  private buyPrompt!:   Phaser.GameObjects.Container;
  private notif!:       Notification;

  /** Incremented on every turn:start — stale safeEndTurn timers check against this */
  private turnGen = 0;
  /** True while a tween chain is running — blocks roll and force-switch */
  isAnimating = false;

  constructor() { super({ key: 'GameScene' }); }

  // ── Lifecycle ─────────────────────────────────────────────────────────────────

  init(data: SceneData): void {
    if (data.seed) rng['state'] = data.seed;
    bus.clear();

    this.board        = new Board();
    this.bank         = new Bank();
    this.dice         = new Dice();
    this.players      = data.players.map((p, i) => new Player(`p${i + 1}`, p.name, p.token));
    this.turnManager  = new TurnManager(this.players, this.board, this.dice);
    this.chanceDeck   = new CardDeck(CHANCE_CARDS);
    this.commDeck     = new CardDeck(COMMUNITY_CHEST_CARDS);
    this.cardEffects  = new CardEffects(this.board, this.bank, this.players);
  }

  create(): void {
    this.drawBoard();
    this.spawnTokens();
    this.buildButtons();
    this.buildBuyPrompt();
    this.notif = new Notification(this);
    this.registerBusListeners();

    this.scene.launch('UIScene', { players: this.players });
    this.turnManager.startTurn();
  }

  // ── Board drawing ─────────────────────────────────────────────────────────────

  private drawBoard(): void {
    const g     = this.add.graphics();
    const boardW = CORNER_SIZE * 2 + TILE_W * 9;

    g.fillStyle(0xd4e8c2, 1);
    g.fillRect(BOARD_ORIGIN_X, BOARD_ORIGIN_Y, boardW, boardW);
    g.lineStyle(1, 0x555544, 1);

    // Bottom (0–10): face UP, stripe on TOP
    for (let i = 0; i <= 10; i++) {
      const layout = this.board.getLayout(i);
      const w = (i === 0 || i === 10) ? CORNER_SIZE : TILE_W;
      g.strokeRect(layout.x - w / 2, layout.y - TILE_H / 2, w, TILE_H);
      const tile = this.board.getTile(i);
      if (tile.type === 'property') {
        g.fillStyle(GROUP_COLORS[(tile as PropertyTile).group], 1);
        g.fillRect(layout.x - w / 2, layout.y - TILE_H / 2, w, 14);
      }
      this.add.text(layout.x, layout.y + 4, tile.name, {
        fontFamily: 'Arial', fontSize: '6px', color: '#111111',
        wordWrap: { width: w - 4 }, align: 'center',
      }).setOrigin(0.5, 0.5);
    }

    // Left (11–19): face RIGHT, stripe on RIGHT
    for (let i = 11; i <= 19; i++) {
      const layout = this.board.getLayout(i);
      g.strokeRect(layout.x - TILE_H / 2, layout.y - TILE_W / 2, TILE_H, TILE_W);
      const tile = this.board.getTile(i);
      if (tile.type === 'property') {
        g.fillStyle(GROUP_COLORS[(tile as PropertyTile).group], 1);
        g.fillRect(layout.x + TILE_H / 2 - 14, layout.y - TILE_W / 2, 14, TILE_W);
      }
      this.add.text(layout.x, layout.y, tile.name, {
        fontFamily: 'Arial', fontSize: '6px', color: '#111111',
        wordWrap: { width: TILE_H - 18 }, align: 'center',
      }).setOrigin(0.5, 0.5);
    }

    // Top (20–30): face DOWN, stripe on BOTTOM
    for (let i = 20; i <= 30; i++) {
      const layout = this.board.getLayout(i);
      const w = (i === 20 || i === 30) ? CORNER_SIZE : TILE_W;
      g.strokeRect(layout.x - w / 2, layout.y - TILE_H / 2, w, TILE_H);
      const tile = this.board.getTile(i);
      if (tile.type === 'property') {
        g.fillStyle(GROUP_COLORS[(tile as PropertyTile).group], 1);
        g.fillRect(layout.x - w / 2, layout.y + TILE_H / 2 - 14, w, 14);
      }
      this.add.text(layout.x, layout.y - 4, tile.name, {
        fontFamily: 'Arial', fontSize: '6px', color: '#111111',
        wordWrap: { width: w - 4 }, align: 'center',
      }).setOrigin(0.5, 0.5);
    }

    // Right (31–39): face LEFT, stripe on LEFT
    for (let i = 31; i <= 39; i++) {
      const layout = this.board.getLayout(i);
      g.strokeRect(layout.x - TILE_H / 2, layout.y - TILE_W / 2, TILE_H, TILE_W);
      const tile = this.board.getTile(i);
      if (tile.type === 'property') {
        g.fillStyle(GROUP_COLORS[(tile as PropertyTile).group], 1);
        g.fillRect(layout.x - TILE_H / 2, layout.y - TILE_W / 2, 14, TILE_W);
      }
      this.add.text(layout.x, layout.y, tile.name, {
        fontFamily: 'Arial', fontSize: '6px', color: '#111111',
        wordWrap: { width: TILE_H - 18 }, align: 'center',
      }).setOrigin(0.5, 0.5);
    }

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
    const offsets: [number, number][] = [
      [-10, -10], [10, -10], [-10, 10], [10, 10],
      [0, -16],  [0, 16],  [-16, 0],  [16, 0],
    ];
    this.players.forEach((player, i) => {
      const layout = this.board.getLayout(0);
      const [ox, oy] = offsets[i] ?? [0, 0];
      const color = Phaser.Display.Color.HexStringToColor(TOKEN_HEX[player.token] ?? '#ffffff').color;

      const circle = this.add.arc(layout.x + ox, layout.y + oy, 9, 0, 360, false, color)
        .setDepth(10).setStrokeStyle(1.5, 0xffffff);

      const label = this.add.text(layout.x + ox, layout.y + oy,
        player.name[0].toUpperCase(),
        { fontFamily: 'Arial', fontSize: '8px', color: '#ffffff', fontStyle: 'bold' },
      ).setOrigin(0.5).setDepth(11);

      this.tokenSprites.set(player.id, circle);
      this.tokenLabels.set(player.id, label);
    });
  }

  /** Animate token step-by-step, one tile at a time */
  private async moveTokenStepByStep(playerId: string, from: number, steps: number): Promise<void> {
    const sprite = this.tokenSprites.get(playerId);
    const label  = this.tokenLabels.get(playerId);
    if (!sprite || !label) return;

    for (let s = 1; s <= steps; s++) {
      const tileIndex = (from + s) % 40;
      const layout    = this.board.getLayout(tileIndex);
      await new Promise<void>((resolve) => {
        this.tweens.add({
          targets: [sprite, label],
          x: layout.x, y: layout.y,
          duration: 110,
          ease: 'Sine.easeInOut',
          onComplete: () => resolve(),
        });
      });
    }
  }

  /** Instantly snap a token to a tile (no animation) */
  private snapToken(playerId: string, tileIndex: number): void {
    const layout = this.board.getLayout(tileIndex);
    this.tokenSprites.get(playerId)?.setPosition(layout.x, layout.y);
    this.tokenLabels.get(playerId)?.setPosition(layout.x, layout.y);
  }

  // ── Buttons ───────────────────────────────────────────────────────────────────

  private buildButtons(): void {
    // Buttons sit below the board, inside the game area (x < 1055 = UIScene boundary)
    this.rollBtn = this.add.text(512, 738, '🎲  ROLL DICE', {
      fontFamily: 'Georgia, serif', fontSize: '22px', color: '#ffffff',
      backgroundColor: '#c0392b', padding: { x: 28, y: 12 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(20);

    this.rollBtn.on('pointerdown', () => {
      if (this.isAnimating) return;
      this.turnManager.rollDice();
    });
    this.rollBtn.on('pointerover', () => this.rollBtn.setStyle({ backgroundColor: '#e74c3c' }));
    this.rollBtn.on('pointerout',  () => this.rollBtn.setStyle({ backgroundColor: '#c0392b' }));

    this.jailBtn = this.add.text(512, 778, '🔓  Pay $50 to leave jail', {
      fontFamily: 'Georgia, serif', fontSize: '14px', color: '#ffffff',
      backgroundColor: '#7d6608', padding: { x: 14, y: 7 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(20).setVisible(false);

    this.jailBtn.on('pointerdown', () => {
      const p = this.turnManager.currentPlayer;
      if (p.getOutOfJailCards > 0) {
        this.turnManager.useGetOutOfJailCard(p);
      } else {
        this.turnManager.payJailFine(p);
      }
      this.jailBtn.setVisible(false);
      this.pushUIUpdate();
    });
  }

  private setRollEnabled(on: boolean): void {
    this.rollBtn.setAlpha(on ? 1 : 0.4);
    if (on) this.rollBtn.setInteractive({ useHandCursor: true });
    else    this.rollBtn.removeInteractive();
  }

  // ── Buy Prompt ────────────────────────────────────────────────────────────────

  private buildBuyPrompt(): void {
    // Container centred in the board area
    this.buyPrompt = this.add.container(512, 400).setDepth(40).setVisible(false);

    const bg = this.add.rectangle(0, 0, 360, 220, 0x0d1b35, 0.97)
      .setStrokeStyle(2, 0x4466aa);
    this.buyPrompt.add(bg);
  }

  private showBuyPrompt(tileId: number, playerId: string, price: number, tileName: string, baseRent?: number): void {
    const player = this.players.find((p) => p.id === playerId)!;

    // Rebuild dynamic children (keep bg at index 0)
    while (this.buyPrompt.length > 1) {
      (this.buyPrompt.getAt(1) as Phaser.GameObjects.GameObject).destroy();
      this.buyPrompt.removeAt(1);
    }

    const canAfford = player.canAfford(price);

    const title = this.add.text(0, -78, tileName, {
      fontFamily: 'Georgia, serif', fontSize: '19px', color: '#f0c040',
      fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5);

    const rentLine = baseRent !== undefined
      ? `Price: $${price}   Base rent: $${baseRent}`
      : `Price: $${price}`;
    const info = this.add.text(0, -48, rentLine, {
      fontFamily: 'Georgia, serif', fontSize: '13px', color: '#aabbcc',
    }).setOrigin(0.5);

    const cashLine = this.add.text(0, -26, `Your cash: $${player.cash.toLocaleString()}`, {
      fontFamily: 'Georgia, serif', fontSize: '13px',
      color: canAfford ? '#88ff88' : '#ff8888',
    }).setOrigin(0.5);

    const buyBg   = canAfford ? '#1a6b35' : '#445544';
    const buyBtn  = this.add.text(-88, 58, '✅  BUY', {
      fontFamily: 'Georgia, serif', fontSize: '16px', color: '#ffffff',
      backgroundColor: buyBg, padding: { x: 16, y: 10 },
    }).setOrigin(0.5);

    if (canAfford) {
      buyBtn.setInteractive({ useHandCursor: true });
      buyBtn.on('pointerover', () => buyBtn.setStyle({ backgroundColor: '#27ae60' }));
      buyBtn.on('pointerout',  () => buyBtn.setStyle({ backgroundColor: buyBg }));
      buyBtn.on('pointerdown', () => {
        this.doBuyTile(player, tileId, price, tileName);
      });
    }

    const passBtn = this.add.text(88, 58, '❌  PASS', {
      fontFamily: 'Georgia, serif', fontSize: '16px', color: '#ffffff',
      backgroundColor: '#6b1e1e', padding: { x: 16, y: 10 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    passBtn.on('pointerover', () => passBtn.setStyle({ backgroundColor: '#922b21' }));
    passBtn.on('pointerout',  () => passBtn.setStyle({ backgroundColor: '#6b1e1e' }));
    passBtn.on('pointerdown', () => {
      this.notif.show(`${player.name} passed on ${tileName}.`, 'info');
      this.hideBuyPrompt();
      this.safeEndTurn(300);
    });

    this.buyPrompt.add([title, info, cashLine, buyBtn, passBtn]);
    this.buyPrompt.setVisible(true);
  }

  private doBuyTile(player: Player, tileId: number, price: number, tileName: string): void {
    const tile = this.board.getTile(tileId);

    // Manually set ownerId for Railroad / Utility (bank.sellPropertyToPlayer only handles PropertyTile)
    if (tile.type === 'property') {
      this.bank.sellPropertyToPlayer(player, tile as PropertyTile);
    } else if (tile.type === 'railroad' || tile.type === 'utility') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = tile as any;
      if (!t.ownerId && player.canAfford(price)) {
        player.pay(price);
        t.ownerId = player.id;
        player.ownedTileIds.add(tileId);
      }
    }

    this.notif.show(`${player.name} bought ${tileName} for $${price}!`, 'success');
    this.hideBuyPrompt();
    this.pushUIUpdate();
    this.safeEndTurn(400);
  }

  private hideBuyPrompt(): void {
    this.buyPrompt.setVisible(false);
  }

  // ── Safe end-turn (generation-guarded) ───────────────────────────────────────
  /**
   * Schedule endTurn after `delay` ms.
   * Captures the current turn generation at call-time; if the generation has
   * advanced by the time the timer fires (i.e. a new turn already started due
   * to a faster path), the call is silently dropped.  This prevents stale
   * delayedCall timers from previous turns from prematurely ending a new turn.
   */
  private safeEndTurn(delay = 0): void {
    const gen = this.turnGen;
    const doEnd = () => {
      if (this.turnGen === gen) this.turnManager.endTurn();
    };
    if (delay > 0) this.time.delayedCall(delay, doEnd);
    else            doEnd();
  }

  // ── Bus event wiring ──────────────────────────────────────────────────────────

  private registerBusListeners(): void {

    // ── Movement ──────────────────────────────────────────────────────────────
    bus.on<MovePayload>('player:move', ({ playerId, from, steps }) => {
      this.isAnimating = true;
      this.setRollEnabled(false);

      this.moveTokenStepByStep(playerId, from, steps)
        .then(() => {
          this.isAnimating = false;
          this.turnManager.resolveLanding();
        })
        .catch((err: unknown) => {
          // Any error during movement or landing must never freeze the game.
          console.error('[GameScene] Error during movement/landing:', err);
          this.isAnimating = false;
          this.notif.show('Something went wrong — skipping turn.', 'danger');
          this.safeEndTurn(600);
        });
    });

    // ── Dice ──────────────────────────────────────────────────────────────────
    bus.on('dice:result', (result: { die1: number; die2: number; total: number; isDoubles: boolean }) => {
      this.scene.get('UIScene').events.emit('dice:result', result);
    });

    // ── Turn bookkeeping ──────────────────────────────────────────────────────
    bus.on('turn:start', ({ playerId }: { playerId: string }) => {
      this.turnGen++;                          // ← invalidate all timers from the previous turn
      const player = this.players.find((p) => p.id === playerId)!;

      this.setRollEnabled(true);
      this.hideBuyPrompt();

      const jailActAvail = player.inJail && (player.getOutOfJailCards > 0 || player.cash >= 50);
      this.jailBtn.setVisible(jailActAvail);
      if (jailActAvail) {
        this.jailBtn.setText(player.getOutOfJailCards > 0 ? '🃏  Use Card' : '🔓  Pay $50');
      }

      this.scene.get('UIScene').events.emit('turn:start', { player, players: this.players });
    });

    bus.on('turn:end', () => {
      this.setRollEnabled(false);
      this.jailBtn.setVisible(false);
    });

    // ── Free landing (Go, Just Visiting, Free Parking, own property) ──────────
    bus.on('player:landed', () => {
      this.safeEndTurn(300);
    });

    // ── Unowned property — show buy prompt ────────────────────────────────────
    bus.on<AuctionPayload>('property:auction', ({ tileId, playerId, price }) => {
      const tile = this.board.getTile(tileId);
      const finalPrice = price ?? (tile as PropertyTile).price ?? 0;
      let   baseRent: number | undefined;

      if (tile.type === 'property') {
        baseRent = (tile as PropertyTile).rentTiers[0];
      }

      this.showBuyPrompt(tileId, playerId, finalPrice, tile.name, baseRent);
    });

    // ── Rent ──────────────────────────────────────────────────────────────────
    bus.on<RentPayload>('rent:pay', ({ debtorId, creditorId, amount, tileId, reason }) => {
      let resolved = amount ?? 0;

      // Railroad / Utility: resolve amount from tile + ownership
      if (resolved === 0) {
        const tile     = this.board.getTile(tileId);
        const creditor = this.players.find((p) => p.id === creditorId);
        if (!creditor) return;

        if (tile.type === 'railroad') {
          const owned = [...creditor.ownedTileIds]
            .filter((id) => this.board.getTile(id).type === 'railroad').length;
          resolved = (tile as unknown as RailroadTile).rentFor(owned);
        } else if (tile.type === 'utility') {
          const owned = [...creditor.ownedTileIds]
            .filter((id) => this.board.getTile(id).type === 'utility').length;
          const mult = (tile as unknown as UtilityTile).rentMultiplier(owned);
          resolved = mult * (this.dice.lastResult?.total ?? 7);
        }
      }

      // Go salary: bank pays player
      if (reason === 'go') {
        const player = this.players.find((p) => p.id === creditorId)!;
        this.bank.payPlayer(player, resolved);
        this.notif.show(`${player.name} passed GO — collect $${resolved}!`, 'success');
        this.pushUIUpdate();
        return; // DO NOT end turn — the normal move flow does that
      }

      // Player-to-player rent
      const debtor   = this.players.find((p) => p.id === debtorId);
      const creditor = this.players.find((p) => p.id === creditorId);
      if (!debtor || !creditor) return;

      this.bank.transferBetweenPlayers(debtor, creditor, resolved);
      this.notif.show(`${debtor.name} paid $${resolved} rent to ${creditor.name}.`, 'warning');
      this.pushUIUpdate();
      this.checkBankruptcy(debtor);
      this.safeEndTurn(700);
    });

    // ── Tax ───────────────────────────────────────────────────────────────────
    bus.on<TaxPayload>('tax:pay', ({ playerId, amount }) => {
      const player = this.players.find((p) => p.id === playerId)!;
      this.bank.collectTax(player, amount);
      this.notif.show(`${player.name} paid $${amount} tax.`, 'danger');
      this.pushUIUpdate();
      this.checkBankruptcy(player);
      this.safeEndTurn(700);
    });

    // ── Jail enter (from tile, card, or three-doubles) ────────────────────────
    bus.on<JailPayload>('jail:enter', ({ playerId, reason }) => {
      const player = this.players.find((p) => p.id === playerId)!;

      // Snap token directly — no move tween needed
      this.snapToken(playerId, 10);

      const why = reason === 'doubles' ? 'rolled three doubles'
                : reason === 'tile'    ? 'landed on Go to Jail'
                :                        'drew a Go to Jail card';
      this.notif.show(`${player.name} went to jail (${why})!`, 'danger');
      this.pushUIUpdate();
      this.safeEndTurn(800);
    });

    // ── Card draw ─────────────────────────────────────────────────────────────
    bus.on('card:draw', ({ playerId, deckType }: { playerId: string; deckType: string }) => {
      const player = this.players.find((p) => p.id === playerId)!;
      const deck   = deckType === 'chance' ? this.chanceDeck : this.commDeck;
      const card   = deck.drawCard();

      // Guard: drawCard() returns undefined when the deck is exhausted with no
      // discard to refill from (e.g. all GOOJ cards held by players).
      if (!card) {
        console.error('[GameScene] drawCard() returned undefined for deck:', deckType);
        this.safeEndTurn(300);
        return;
      }

      // Show the card FIRST — execute effects + return card only after dismissal.
      // Returning the card immediately (before effects) would allow it to be
      // re-drawn during the same chain if a card effect lands on another card tile.
      this.scene.launch('CardScene', { card });
      this.scene.get('CardScene').events.once('shutdown', () => {
        // Return non-GOOJ cards to the discard pile now that they've been used.
        if (!card.isGetOutOfJail) deck.returnCard(card);
        this.cardEffects.execute(card, player);
        this.pushUIUpdate();
        this.safeEndTurn(200);
      });
    });

    // ── Generic notification ──────────────────────────────────────────────────
    bus.on<NotifPayload>('ui:notification', ({ message, type }) => {
      this.notif.show(message, type);
      this.pushUIUpdate();
    });

    // ── Force player switch (debug tool from UIScene) ─────────────────────────
    bus.on('debug:forcePlayer', ({ index }: { index: number }) => {
      if (this.isAnimating) {
        this.notif.show('Cannot switch — animation in progress.', 'warning');
        return;
      }
      this.hideBuyPrompt();
      this.turnManager.forcePlayerTurn(index);
    });

    // ── Game over ─────────────────────────────────────────────────────────────
    bus.on('game:end', ({ winnerId }: { winnerId: string | null }) => {
      const winner = this.players.find((p) => p.id === winnerId);
      this.setRollEnabled(false);
      this.hideBuyPrompt();

      this.add.rectangle(512, 400, 520, 190, 0x000000, 0.88)
        .setStrokeStyle(3, 0xf0c040).setDepth(90);
      this.add.text(512, 380, `🏆 ${winner?.name ?? 'Nobody'} wins!`, {
        fontFamily: 'Georgia, serif', fontSize: '36px', color: '#f0c040',
        stroke: '#000', strokeThickness: 5,
      }).setOrigin(0.5).setDepth(91);
      this.add.text(512, 432, 'Refresh to play again.', {
        fontFamily: 'Georgia, serif', fontSize: '16px', color: '#aaaacc',
      }).setOrigin(0.5).setDepth(91);
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private pushUIUpdate(): void {
    this.scene.get('UIScene')?.events.emit('players:update', {
      players:  this.players,
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
