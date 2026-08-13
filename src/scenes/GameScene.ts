import Phaser from 'phaser';
import { Board } from '@/game/Board';
import { Player } from '@/game/Player';
import { Dice } from '@/game/Dice';
import { Bank } from '@/game/Bank';
import { TurnManager } from '@/game/TurnManager';
import { CardDeck, CardEffects, CHANCE_CARDS, COMMUNITY_CHEST_CARDS, type Card } from '@/cards/CardDeck';
import { bus } from '@/utils/EventBus';
import { rng } from '@/utils/PRNG';
import { SaveLoad } from '@/utils/SaveLoad';
import { dlog, dwarn, isDebugLogging } from '@/utils/log';
import {
  captureGame, restoreGame, type GameParts, type GameSnapshot,
} from '@/game/Snapshot';
import { Notification, type NotifType } from '@/ui/Notification';
import { sfx } from '@/ui/Sfx';
import { BoardRenderer, type OwnerStyle } from '@/ui/BoardRenderer';
import { tokenSlot } from '@/ui/TokenCluster';
import {
  PropertyPanel,
  type PanelAction, type PanelActionKey, type PropertyView, type RentRow,
} from '@/ui/PropertyPanel';
import {
  DEFAULT_HOUSE_RULES, GROUP_COLORS, GO_SALARY, JAIL_FINE,
  type TokenType, type HouseRules,
} from '@/config';
import { PropertyTile } from '@/tiles/PropertyTile';
import { isOwnable, type Tile } from '@/tiles/Tile';
import {
  RailroadTile, UtilityTile, TaxTile, RAILROAD_RENT, UTILITY_MULTIPLIERS,
} from '@/tiles/SpecialTiles';
import {
  canBuildHouse, canBuildHotel, canSellHouse, canSellHotel,
  canMortgage, canUnmortgage, unmortgageCost, ownsWholeGroup, groupBuildingCount,
  type RuleCheck,
} from '@/game/BuildRules';
import { quoteRent, countOwnedOfType, type ArrivalRent } from '@/game/Rent';
import {
  shouldBuy, nextBid, jailChoice, buildPlan, redeemPlan, acceptTrade,
  type BotContext,
} from '@/game/Bot';

/** A beat between bot actions, so a human can follow what it is doing. */
const BOT_THINK = 600;
/** Cap on buildings a bot puts up in one turn — it re-plans between each. */
const MAX_BOT_BUILDS = 6;
/** How long a bot leaves its drawn card on screen before closing it. */
const BOT_CARD_LINGER = 1600;
/** How quickly the tokens already on a tile shuffle over to make room. */
const CLUSTER_SHUFFLE = 140;
import { settleDebt, announceSettlement } from '@/game/Estate';
import { mapById } from '@/maps';
import { Auction } from '@/game/Auction';
import { AuctionPanel, type AuctionView } from '@/ui/AuctionPanel';
import {
  emptyOffer, reverseOffer, validateTrade, executeTrade, describeOffer,
  type TradeOffer,
} from '@/game/Trade';
import {
  TradePanel,
  type TradeAction, type TradeRow, type TradeSideView, type TradeView,
} from '@/ui/TradePanel';

/** How long each bidder has before the clock passes for them. */
const AUCTION_SECONDS = 15;

const TOKEN_HEX: Record<string, string> = {
  topHat: '#222222', car: '#e74c3c', dog: '#e67e22', battleship: '#3498db',
  iron: '#95a5a6', boot: '#8b4513', wheelbarrow: '#2ecc71', thimble: '#f1c40f',
};

interface SceneData {
  players: Array<{ name: string; token: TokenType; isBot?: boolean }>;
  seed?: number;
  /** Which board to play on; defaults to the classic one. */
  mapId?: string;
  houseRules?: HouseRules;
  /** A saved game to resume instead of dealing a new one. */
  snapshot?: GameSnapshot;
}

/** `direction: -1` walks the token backwards, for "Go Back 3 Spaces". */
interface MovePayload    { playerId: string; from: number; to: number; steps: number; isDoubles: boolean; direction?: 1 | -1 }
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

  /** Piece + seat badge per player, moved as one. */
  private tokens: Map<string, Phaser.GameObjects.Container> = new Map();
  /** Which tile each token is standing on *on screen* — see the clustering note. */
  private tokenTile: Map<string, number> = new Map();
  private rollBtn!:     Phaser.GameObjects.Text;
  private jailBtn!:     Phaser.GameObjects.Text;
  private buyPrompt!:   Phaser.GameObjects.Container;
  private notif!:       Notification;
  /** Not `renderer` — Phaser.Scene already owns that name for the WebGL renderer. */
  private boardView!:   BoardRenderer;
  private panel!:       PropertyPanel;
  private auctionPanel!: AuctionPanel;
  private tradePanel!:  TradePanel;
  /** The auction in progress, if any. Blocks the roll and the tile inspector. */
  private auction: Auction | null = null;
  /** The offer being built or reviewed, if the trade panel is open. */
  private offer: TradeOffer | null = null;
  private tradeMode: 'edit' | 'review' = 'edit';
  private tradeScroll = { left: 0, right: 0 };

  /** Incremented on every turn:start — stale safeEndTurn timers check against this */
  private turnGen = 0;
  /** Set by a "nearest railroad / utility" card, consumed by the next rent it
   *  causes. Cleared at turn:start so it can never leak into another turn. */
  private arrivalRent: ArrivalRent | null = null;
  /** Once the game is won, no scheduled bot action should still fire. */
  private gameOver = false;
  /** True while a tween chain is running — blocks roll and force-switch */
  isAnimating = false;

  constructor() { super({ key: 'GameScene' }); }

  // ── Lifecycle ─────────────────────────────────────────────────────────────────

  init(data: SceneData): void {
    // Before any TurnManager is built — its constructor subscribes to the bus.
    bus.clear();
    // restoreGame re-seeds the PRNG to where the saved stream had got to, which
    // is why a resumed game ignores ?seed= entirely.
    this.applyParts(data.snapshot ? restoreGame(data.snapshot) : this.newGame(data));
  }

  private newGame(data: SceneData): GameParts {
    if (data.seed !== undefined) rng.seed(data.seed);

    const board   = new Board(mapById(data.mapId));
    const bank    = new Bank();
    const dice    = new Dice();
    const players = data.players.map(
      (p, i) => new Player(`p${i + 1}`, p.name, p.token, p.isBot ?? false),
    );

    return {
      board, bank, dice, players,
      turnManager: new TurnManager(players, board, dice),
      chanceDeck:  new CardDeck(CHANCE_CARDS),
      commDeck:    new CardDeck(COMMUNITY_CHEST_CARDS),
      cardEffects: new CardEffects(board, bank, players),
      houseRules:  data.houseRules ?? { ...DEFAULT_HOUSE_RULES },
    };
  }

  private applyParts(parts: GameParts): void {
    this.board       = parts.board;
    this.bank        = parts.bank;
    this.dice        = parts.dice;
    this.players     = parts.players;
    this.turnManager = parts.turnManager;
    this.chanceDeck  = parts.chanceDeck;
    this.commDeck    = parts.commDeck;
    this.cardEffects = parts.cardEffects;
    this.houseRules  = parts.houseRules;
  }

  create(): void {
    this.notif = new Notification(this);

    this.boardView = new BoardRenderer(this, this.board, (id) => this.ownerStyle(id));
    this.boardView.draw((tileId) => this.selectTile(tileId));
    this.boardView.refresh();

    this.panel = new PropertyPanel(
      this,
      (key) => this.runPanelAction(key),
      (reason) => this.notif.show(reason, 'warning'),
    );

    this.auctionPanel = new AuctionPanel(
      this,
      (amount) => this.handleAuctionAction((a, id) => { a.bid(id, amount); }),
      ()       => this.handleAuctionAction((a, id) => { a.pass(id); }),
    );

    this.tradePanel = new TradePanel(this, (action) => this.handleTradeAction(action));

    this.spawnTokens();
    this.buildButtons();
    this.buildBuyPrompt();
    this.registerBusListeners();

    this.scene.launch('UIScene', { players: this.players });
    this.turnManager.startTurn();
    this.exposeDebugHandle();
  }

  /**
   * Read-only state hook for tools/playtest.mjs, which drives the real canvas and
   * needs to know what the model did. Gated on the same switch as debug logging
   * (dev server, or ?debug=1), so a plain production load exposes nothing.
   */
  private exposeDebugHandle(): void {
    if (!isDebugLogging()) return;
    (window as unknown as Record<string, unknown>).__forge = {
      state:       () => this.serialize(),
      phase:       () => this.turnManager.phase,
      isAnimating: () => this.isAnimating,
      activeId:    () => this.turnManager.currentPlayer.id,
      buyPromptOpen: () => this.buyPrompt.visible,
      cardOpen:    () => this.scene.isActive('CardScene'),
      panelOpen:   () => this.panel.isOpen,
      panelTile:   () => this.panel.tileId,
      auctionOpen: () => this.auctionPanel.isOpen,
      auctionBidder: () => this.auction?.currentBidder?.id ?? null,
      auctionState: () => (this.auction ? {
        tileId:        this.auction.tileId,
        bidders:       this.auction.bidders.map((p) => p.id),
        currentBidder: this.auction.currentBidder?.id ?? null,
        highBid:       this.auction.highBid,
        highBidderId:  this.auction.highBidderId,
        minimumBid:    this.auction.minimumBid,
        complete:      this.auction.complete,
      } : null),
      houseRules:  () => ({ ...this.houseRules }),
      gameOver:    () => this.gameOver,
      // Frame counter and clock state: if the game ever looks frozen, this says
      // whether the loop is still turning or whether it stopped underneath you.
      loop:        () => {
        const clock = this.time as unknown as {
          _active: unknown[]; _pendingInsertion: unknown[]; _pendingRemoval: unknown[];
        };
        return {
          frame:      this.game.loop.frame,
          awake:      this.game.loop.running,
          paused:     this.time.paused,
          active:     clock._active.length,
          pendingIn:  clock._pendingInsertion.length,
          pendingOut: clock._pendingRemoval.length,
        };
      },
      tradeOpen:   () => this.tradePanel.isOpen,
      tradeOffer:  () => (this.offer ? { ...this.offer, mode: this.tradeMode } : null),
      // Where each piece actually sits, so the harness can prove that tokens
      // sharing a tile are not sitting on top of each other.
      tokens:      () => Object.fromEntries([...this.tokens].map(([id, token]) => [
        id, { x: Math.round(token.x), y: Math.round(token.y), tile: this.tokenTile.get(id) ?? -1 },
      ])),
      // Lets the harness click a tile without keeping its own copy of the
      // board geometry — unlike the button HOTSPOTS, which it must.
      tileCentre:  (tileId: number) => {
        const layout = this.board.getLayout(tileId);
        return { x: layout.x, y: layout.y };
      },
    };
  }

  // ── Ownership ─────────────────────────────────────────────────────────────────

  /** How BoardRenderer should mark a tile owned by this player. */
  private ownerStyle(playerId: string): OwnerStyle | null {
    const index = this.players.findIndex((p) => p.id === playerId);
    if (index === -1) return null;
    return {
      color: Phaser.Display.Color.HexStringToColor(TOKEN_HEX[this.players[index].token] ?? '#ffffff').color,
      // The seat number, not the initial: everyone is "Player N" by default, so
      // an initial marks every tile on the board with the same letter.
      initial: String(index + 1),
    };
  }

  // ── Tokens ────────────────────────────────────────────────────────────────────

  private spawnTokens(): void {
    this.players.forEach((player, i) => {
      const layout = this.board.getLayout(player.position);

      // BootScene bakes a disc-and-emblem texture per token type; the seat
      // number rides in the corner so a token matches its owner band on a tile.
      const piece = this.add.image(0, 0, `token_${player.token}`).setDisplaySize(22, 22);
      const label = this.add.text(8, 6,
        String(i + 1),   // seat number — see ownerStyle for why not the initial
        {
          fontFamily: 'Arial', fontSize: '8px', color: '#ffffff', fontStyle: 'bold',
          backgroundColor: '#000000cc', padding: { x: 2, y: 0 },
        },
      ).setOrigin(0.5);

      // One container per player: the badge has to keep its corner as the piece
      // moves, and the whole cluster scales together when a tile gets crowded.
      this.tokens.set(player.id, this.add
        .container(layout.x, layout.y, [piece, label])
        .setDepth(10));
      this.tokenTile.set(player.id, player.position);
    });

    // A restored game can start with several players already sharing a square.
    new Set(this.tokenTile.values()).forEach((tile) => this.relayoutTile(tile, false));
  }

  // ── Token clustering ──────────────────────────────────────────────────────────
  // Tokens used to converge on the exact centre of a tile and hide each other.
  // Each one now takes a slot in a cluster, and the cluster is rebuilt whenever
  // the occupants change — including for the tiles a token merely walks across.
  //
  // This tracks where each token *is on screen*, which is not the same as
  // `player.position`: TurnManager sets the model to the destination before the
  // walk begins, so asking the model who is on a tile mid-animation is wrong.

  private occupantsOf(tileIndex: number): string[] {
    return this.players
      .filter((p) => this.tokenTile.get(p.id) === tileIndex)
      .map((p) => p.id);   // seat order keeps the arrangement stable
  }

  /** Place a token in its slot on a tile, tweening unless told otherwise. */
  private placeToken(playerId: string, tileIndex: number, animate: boolean): void {
    const token = this.tokens.get(playerId);
    if (!token) return;

    const occupants = this.occupantsOf(tileIndex);
    const layout = this.board.getLayout(tileIndex);
    const slot   = tokenSlot(Math.max(0, occupants.indexOf(playerId)), occupants.length);
    const x = layout.x + slot.dx;
    const y = layout.y + slot.dy;

    if (!animate) {
      token.setPosition(x, y).setScale(slot.scale);
      return;
    }
    this.tweens.add({
      targets: token, x, y, scaleX: slot.scale, scaleY: slot.scale,
      duration: CLUSTER_SHUFFLE, ease: 'Sine.easeOut',
    });
  }

  /** Re-space everyone standing on a tile. `except` is mid-move and placed by the walk. */
  private relayoutTile(tileIndex: number, animate = true, except?: string): void {
    for (const id of this.occupantsOf(tileIndex)) {
      if (id !== except) this.placeToken(id, tileIndex, animate);
    }
  }

  /** Animate token step-by-step, one tile at a time, forwards or backwards */
  private async moveTokenStepByStep(
    playerId: string, from: number, steps: number, direction: 1 | -1 = 1,
  ): Promise<void> {
    const token = this.tokens.get(playerId);
    if (!token) return;

    for (let s = 1; s <= steps; s++) {
      const left = this.tokenTile.get(playerId) ?? from;
      const next = this.board.move(from, s * direction).to;

      // Book the new tile before working anything out, so both clusters are
      // computed against where the tokens will be. Passing *through* a busy
      // square re-spaces it too, which is the point of doing this per step.
      this.tokenTile.set(playerId, next);
      this.relayoutTile(left, true);
      this.relayoutTile(next, true, playerId);

      const occupants = this.occupantsOf(next);
      const layout = this.board.getLayout(next);
      const slot = tokenSlot(Math.max(0, occupants.indexOf(playerId)), occupants.length);

      await new Promise<void>((resolve) => {
        this.tweens.add({
          targets: token,
          x: layout.x + slot.dx, y: layout.y + slot.dy,
          scaleX: slot.scale, scaleY: slot.scale,
          duration: 110,
          ease: 'Sine.easeInOut',
          onComplete: () => resolve(),
        });
      });
    }
  }

  /** Instantly snap a token to a tile (no animation) */
  private snapToken(playerId: string, tileIndex: number): void {
    const left = this.tokenTile.get(playerId);
    this.tokenTile.set(playerId, tileIndex);
    if (left !== undefined && left !== tileIndex) this.relayoutTile(left, true);
    this.relayoutTile(tileIndex, true, playerId);
    this.placeToken(playerId, tileIndex, false);
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

    // Left of the roll button, clear of the toast stack at x≈360–680.
    const tradeBtn = this.add.text(180, 738, '🤝  TRADE', {
      fontFamily: 'Georgia, serif', fontSize: '16px', color: '#ffffff',
      backgroundColor: '#1a4a6b', padding: { x: 16, y: 10 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(20);
    tradeBtn.on('pointerover', () => tradeBtn.setStyle({ backgroundColor: '#2a6b9b' }));
    tradeBtn.on('pointerout',  () => tradeBtn.setStyle({ backgroundColor: '#1a4a6b' }));
    tradeBtn.on('pointerdown', () => this.openTrade());

    const saveBtn = this.add.text(300, 738, '💾  SAVE', {
      fontFamily: 'Georgia, serif', fontSize: '14px', color: '#ffffff',
      backgroundColor: '#2a3a55', padding: { x: 12, y: 9 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(20);
    saveBtn.on('pointerover', () => saveBtn.setStyle({ backgroundColor: '#3d5170' }));
    saveBtn.on('pointerout',  () => saveBtn.setStyle({ backgroundColor: '#2a3a55' }));
    saveBtn.on('pointerdown', () => this.saveGame());

    const muteBtn = this.add.text(383, 738, '🔊', {
      fontFamily: 'Arial', fontSize: '15px',
      backgroundColor: '#2a3a55', padding: { x: 8, y: 8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(20);
    muteBtn.on('pointerdown', () => muteBtn.setText(sfx.toggleMute() ? '🔊' : '🔇'));

    this.jailBtn = this.add.text(710, 738, '🔓  Pay $50 to leave jail', {
      fontFamily: 'Georgia, serif', fontSize: '14px', color: '#ffffff',
      backgroundColor: '#7d6608', padding: { x: 14, y: 7 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(10).setVisible(false).disableInteractive();

    this.jailBtn.on('pointerdown', () => {
      const p = this.turnManager.currentPlayer;
      if (p.getOutOfJailCards > 0) {
        this.turnManager.useGetOutOfJailCard(p);
      } else {
        this.turnManager.payJailFine(p);
      }
      this.setJailBtnVisible(false);
      this.pushUIUpdate();
    });
  }

  /**
   * `disableInteractive`, never `removeInteractive`. The destructive one queues
   * the button for removal from the input plugin's list; if it is then re-enabled
   * in the same frame — which is exactly what a turn change does, `turn:end`
   * disabling it and `turn:start` re-enabling it — the plugin's next preUpdate
   * clears the freshly created input object while re-inserting the button. It
   * stays on screen at full alpha and never fires again.
   *
   * That did not show up until M6 because every turn until then ended *after* a
   * move, and the `player:move` handler had already disabled the button, making
   * the `turn:end` call a no-op. A turn that ends without moving — three doubles
   * straight to jail — disabled and re-enabled it in one frame and killed it.
   * `disableInteractive` only flips `input.enabled`, so nothing is ever queued.
   */
  private setRollEnabled(on: boolean): void {
    this.rollBtn.setAlpha(on ? 1 : 0.4);
    if (on) this.rollBtn.setInteractive({ useHandCursor: true });
    else    this.rollBtn.disableInteractive();
  }

  /** Always pair visibility with interactivity — setVisible(false) alone does not
   *  remove the object from Phaser's hit list, so invisible buttons can still fire. */
  private setJailBtnVisible(on: boolean, label?: string): void {
    if (label) this.jailBtn.setText(label);
    this.jailBtn.setVisible(on);
    if (on) this.jailBtn.setInteractive({ useHandCursor: true });
    else    this.jailBtn.disableInteractive();
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

    // Rebuild dynamic children (keep bg at index 0).
    // removeAt(1, true) removes AND destroys in one step — calling destroy() first
    // already removes the child from the container, making a subsequent removeAt() OOB.
    while (this.buyPrompt.length > 1) {
      this.buyPrompt.removeAt(1, true);
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
      this.hideBuyPrompt();
      // Tournament rules put a declined property under the hammer; the
      // `noAuction` house rule — declared since M1 and read by nothing until
      // now — keeps the old behaviour of leaving it unowned.
      if (this.houseRules.noAuction) {
        this.notif.show(`${player.name} passed on ${tileName}.`, 'info');
        this.safeEndTurn(300);
        return;
      }
      this.notif.show(`${player.name} passed — ${tileName} goes to auction.`, 'info');
      this.startAuction(tileId);
    });

    this.buyPrompt.add([title, info, cashLine, buyBtn, passBtn]);
    this.buyPrompt.setVisible(true);
  }

  private doBuyTile(player: Player, tileId: number, price: number, tileName: string): void {
    const tile = this.board.getTile(tileId);
    // Properties, railroads and utilities all change hands through the bank —
    // they share the Ownable shape, so there is no per-type branch here.
    if (isOwnable(tile)) this.bank.sellPropertyToPlayer(player, tile);

    sfx.play('buy');
    this.notif.show(`${player.name} bought ${tileName} for $${price}!`, 'success');
    this.hideBuyPrompt();
    this.boardView.refresh();
    this.pushUIUpdate();
    this.refreshPanel();
    this.safeEndTurn(400);
  }

  private hideBuyPrompt(): void {
    this.buyPrompt.setVisible(false);
  }

  // ── Bot turns ─────────────────────────────────────────────────────────────────
  // The scene *drives*, `game/Bot.ts` *decides*. Everything below applies a
  // decision through the same paths a button would; nothing here works out what
  // the right move is. That line is what lets M8d's headless runner reuse the
  // policy without dragging a scene along.

  private botContext(player: Player): BotContext {
    return { board: this.board, bank: this.bank, player, players: this.players };
  }

  /** Let a bot act after a beat, so a human can follow what it is doing. */
  private botAct(fn: () => void, delay = BOT_THINK): void {
    const gen = this.turnGen;
    this.time.delayedCall(delay, () => {
      if (this.gameOver || this.turnGen !== gen) return;
      fn();
    });
  }

  private startBotTurn(player: Player): void {
    this.botAct(() => {
      if (player.inJail) {
        const choice = jailChoice(this.botContext(player), JAIL_FINE);
        if (choice === 'card') this.turnManager.useGetOutOfJailCard(player);
        if (choice === 'pay')  this.turnManager.payJailFine(player);
        this.pushUIUpdate();
      } else {
        this.botDevelop(player);
      }
      this.botAct(() => this.turnManager.rollDice(), BOT_THINK);
    });
  }

  /** Redeem what it can afford, then build what the plan asks for. */
  private botDevelop(player: Player): void {
    const ctx = this.botContext(player);

    for (const tileId of redeemPlan(ctx)) {
      const tile = this.board.getTile(tileId);
      if (isOwnable(tile) && canUnmortgage(player, tile).ok) {
        this.bank.unmortgage(player, tile);
        this.notif.show(`${player.name} lifted the mortgage on ${tile.name}.`, 'info');
      }
    }

    // Re-plan after each step: cash and the bank's stock move underneath it.
    for (let step = 0; step < MAX_BOT_BUILDS; step++) {
      const next = buildPlan(this.botContext(player))[0];
      if (!next) break;
      const lot = this.board.getTile(next.tileId);
      if (!(lot instanceof PropertyTile)) break;

      const built = next.kind === 'hotel'
        ? canBuildHotel(this.board, this.bank, player, lot).ok && this.bank.buyHotel(player, lot)
        : canBuildHouse(this.board, this.bank, player, lot).ok && this.bank.buyHouse(player, lot);
      if (!built) break;

      this.notif.show(
        `${player.name} built a ${next.kind} on ${lot.name}.`, 'success',
      );
    }

    this.boardView.refresh();
    this.pushUIUpdate();
    this.refreshPanel();
  }

  /** Answer a buy prompt without showing it. */
  private botDecideBuy(player: Player, tileId: number, price: number, tileName: string): void {
    this.botAct(() => {
      const tile = this.board.getTile(tileId);
      if (!isOwnable(tile)) return;

      if (shouldBuy(this.botContext(player), tile)) {
        this.doBuyTile(player, tileId, price, tileName);
        return;
      }
      if (this.houseRules.noAuction) {
        this.notif.show(`${player.name} passed on ${tileName}.`, 'info');
        this.safeEndTurn(300);
        return;
      }
      this.notif.show(`${player.name} passed — ${tileName} goes to auction.`, 'info');
      this.startAuction(tileId);
    });
  }

  /** Take a bot's turn at the auction, if the bidder on turn is one. */
  private botDecideBid(): void {
    const auction = this.auction;
    const bidder  = auction?.currentBidder;
    if (!auction || !bidder || !bidder.isBot) return;

    const tile = this.board.getTile(auction.tileId);
    if (!isOwnable(tile)) return;

    this.time.delayedCall(BOT_THINK, () => {
      if (this.auction !== auction) return;   // the auction ended under it
      // Somebody else moved the auction on while this was pending — the panel's
      // clock passing for a bidder does exactly that. Re-ask for whoever is up
      // now, or the auction sits there with nobody scheduled to act.
      if (auction.currentBidder?.id !== bidder.id) {
        this.botDecideBid();
        return;
      }
      const bid = nextBid(this.botContext(bidder), tile, auction.highBid, auction.minimumBid);
      dlog(
        `[Bot] ${bidder.name} on ${tile.name}: high=${auction.highBid} ` +
        `min=${auction.minimumBid} cash=${bidder.cash} → ${bid === null ? 'pass' : `bid ${bid}`}`,
      );
      this.handleAuctionAction((a, id) => {
        // A refused bid would leave the auction exactly as it was, and the next
        // redraw would ask this bot the same question forever. Passing is the
        // only safe fallback.
        if (bid !== null && a.bid(id, bid)) return;
        if (bid !== null) {
          dwarn(`[Bot] ${bidder.name}'s bid of ${bid} was refused — passing instead`);
        }
        a.pass(id);
      });
    });
  }

  /** Answer an offer a human has just proposed to a bot. */
  private botAnswerTrade(): void {
    const offer = this.offer;
    if (!offer || this.tradeMode !== 'review') return;
    const partner = this.players.find((p) => p.id === offer.toId);
    if (!partner?.isBot) return;

    this.time.delayedCall(BOT_THINK * 2, () => {
      if (this.offer !== offer || this.tradeMode !== 'review') return;
      const accepted = acceptTrade(this.botContext(partner), offer);
      this.notif.show(
        accepted ? `${partner.name} accepts.` : `${partner.name} turns the offer down.`,
        accepted ? 'success' : 'info',
      );
      this.handleTradeAction({ kind: accepted ? 'accept' : 'decline' });
    });
  }

  // ── House rules ───────────────────────────────────────────────────────────────

  /**
   * The two rules that fire on a harmless landing. Both are off by default; the
   * menu turns them on. Kept here rather than in the tiles because a tile can see
   * neither the rule set nor the bank.
   */
  private applyLandingHouseRules(playerId: string, tileId: number): void {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return;
    const tile = this.board.getTile(tileId);

    if (this.houseRules.freeParkingJackpot && tile.type === 'freeParking' && this.bank.pot > 0) {
      const won = this.bank.takePot(player);
      this.notif.show(`${player.name} collected the $${won} Free Parking jackpot!`, 'success');
      this.pushUIUpdate();
    }

    // Passing GO already paid the salary; landing exactly on it pays it twice.
    if (this.houseRules.doubleGoSalary && tileId === this.board.anchor('start')) {
      this.bank.payPlayer(player, GO_SALARY);
      this.notif.show(`${player.name} landed on GO — double salary, $${GO_SALARY * 2}!`, 'success');
      this.pushUIUpdate();
    }
  }

  // ── Save / load ───────────────────────────────────────────────────────────────

  private saveGame(): void {
    if (this.isAnimating || this.auction || this.tradePanel.isOpen) {
      this.notif.show('Finish what you are doing first, then save.', 'warning');
      return;
    }
    const snapshot = captureGame({
      board: this.board, bank: this.bank, dice: this.dice, players: this.players,
      turnManager: this.turnManager, chanceDeck: this.chanceDeck, commDeck: this.commDeck,
      cardEffects: this.cardEffects, houseRules: this.houseRules,
    });
    SaveLoad.save(snapshot, snapshot.rngState);
    this.notif.show('Game saved. It will be waiting on the menu.', 'success');
  }

  // ── Trading ───────────────────────────────────────────────────────────────────

  private openTrade(): void {
    if (this.auction || this.isAnimating) return;
    const proposer = this.turnManager.currentPlayer;
    const partner  = this.players.find((p) => p.id !== proposer.id && !p.isBankrupt);
    if (!partner) {
      this.notif.show('There is nobody left to trade with.', 'warning');
      return;
    }
    this.offer      = emptyOffer(proposer.id, partner.id);
    this.tradeMode  = 'edit';
    this.tradeScroll = { left: 0, right: 0 };
    this.panel.hide();
    this.tradePanel.show(this.tradeView());
  }

  private closeTrade(): void {
    this.offer = null;
    this.tradePanel.hide();
  }

  private tradeView(): TradeView {
    const offer = this.offer!;
    const from  = this.players.find((p) => p.id === offer.fromId)!;
    const to    = this.players.find((p) => p.id === offer.toId)!;
    const check = validateTrade(this.board, this.players, offer);

    return {
      mode:  this.tradeMode,
      left:  this.tradeSide(from, offer.fromTileIds, offer.fromCash, offer.fromJailCards, this.tradeScroll.left),
      right: this.tradeSide(to,   offer.toTileIds,   offer.toCash,   offer.toJailCards,   this.tradeScroll.right),
      partners: this.players
        .filter((p) => p.id !== from.id && !p.isBankrupt)
        .map((p) => ({ id: p.id, name: p.name, active: p.id === to.id })),
      summary: describeOffer(this.board, this.players, offer),
      problem: check.ok ? '' : check.reason,
    };
  }

  private tradeSide(
    player: Player, offered: number[], cash: number, jailCards: number, scroll: number,
  ): TradeSideView {
    const rows: TradeRow[] = [...player.ownedTileIds]
      .map((id) => this.board.getTile(id))
      .filter(isOwnable)
      .sort((a, b) => a.id - b.id)
      .map((tile) => ({
        tileId: tile.id,
        name: tile.name + (tile.isMortgaged ? ' (mortgaged)' : ''),
        color: tile instanceof PropertyTile ? GROUP_COLORS[tile.group] : null,
        selected: offered.includes(tile.id),
        // Buildings anywhere in the group freeze every lot in it.
        blocked: tile instanceof PropertyTile && groupBuildingCount(this.board, tile) > 0,
      }));

    return {
      playerId: player.id,
      name: player.name,
      color: this.ownerStyle(player.id)?.color ?? 0xffffff,
      cash: player.cash,
      offeredCash: cash,
      jailCards: player.getOutOfJailCards,
      offeredJailCards: jailCards,
      rows,
      scroll: Math.min(scroll, Math.max(0, rows.length - 1)),
    };
  }

  private handleTradeAction(action: TradeAction): void {
    const offer = this.offer;
    if (!offer) return;

    // 'left' is always the offer's `from` side, whichever player that now is.
    const sideTiles = (side: 'left' | 'right') =>
      side === 'left' ? offer.fromTileIds : offer.toTileIds;

    switch (action.kind) {
      case 'toggleTile': {
        const list = sideTiles(action.side);
        const at   = list.indexOf(action.tileId);
        if (at === -1) list.push(action.tileId);
        else           list.splice(at, 1);
        break;
      }
      case 'cash': {
        if (action.side === 'left') offer.fromCash = Math.max(0, offer.fromCash + action.delta);
        else                        offer.toCash   = Math.max(0, offer.toCash + action.delta);
        break;
      }
      case 'jailCards': {
        if (action.side === 'left') offer.fromJailCards = Math.max(0, offer.fromJailCards + action.delta);
        else                        offer.toJailCards   = Math.max(0, offer.toJailCards + action.delta);
        break;
      }
      case 'scroll': {
        const key = action.side;
        this.tradeScroll[key] = Math.max(0, this.tradeScroll[key] + action.delta);
        break;
      }
      case 'partner': {
        // Switching partner clears their half — it was their deeds, not these.
        this.offer = {
          ...offer, toId: action.playerId, toTileIds: [], toCash: 0, toJailCards: 0,
        };
        this.tradeScroll.right = 0;
        break;
      }
      case 'propose':
        this.tradeMode = 'review';
        this.tradePanel.show(this.tradeView());
        this.botAnswerTrade();   // if the other side is a bot, it answers itself
        return;
      case 'counter':
        // Hand it back the other way round and let them edit it.
        this.offer = reverseOffer(offer);
        this.tradeMode = 'edit';
        this.tradeScroll = { left: this.tradeScroll.right, right: this.tradeScroll.left };
        break;
      case 'accept': {
        const summary = describeOffer(this.board, this.players, offer);
        if (executeTrade(this.board, this.players, offer)) {
          this.notif.show(`Trade agreed — ${summary}.`, 'success');
          this.boardView.refresh();
          this.pushUIUpdate();
        } else {
          this.notif.show('That trade is no longer legal.', 'danger');
        }
        this.closeTrade();
        return;
      }
      case 'decline':
        this.notif.show('Offer declined.', 'info');
        this.closeTrade();
        return;
      case 'close':
        this.closeTrade();
        return;
    }

    this.tradePanel.show(this.tradeView());
  }

  // ── Auction ───────────────────────────────────────────────────────────────────

  private startAuction(tileId: number): void {
    this.auction = new Auction(tileId, this.players);
    if (this.auction.complete) {   // nobody solvent to bid
      this.finishAuction();
      return;
    }
    this.panel.hide();
    this.boardView.setSelected(tileId);
    this.auctionPanel.show(this.auctionView(this.auction));
    this.botDecideBid();
  }

  private auctionView(auction: Auction): AuctionView {
    const bidder   = auction.currentBidder!;
    const tile     = this.board.getTile(auction.tileId);
    const property = tile instanceof PropertyTile ? tile : null;
    const leader   = this.players.find((p) => p.id === auction.highBidderId) ?? null;

    return {
      tileName:   tile.name,
      subtitle:   this.subtitleFor(tile),
      groupColor: property ? GROUP_COLORS[property.group] : null,
      price:      isOwnable(tile) ? tile.price : 0,
      bidderName: bidder.name,
      bidderColor: this.ownerStyle(bidder.id)?.color ?? 0xffffff,
      bidderCash: bidder.cash,
      highBid:    auction.highBid,
      highBidderName: leader?.name ?? null,
      // Minimum, then two bigger jumps so bidding does not take twenty clicks.
      options: [auction.minimumBid, auction.minimumBid + 40, auction.minimumBid + 90],
      remaining: auction.bidders.map((p) => p.name),
      secondsPerBid: AUCTION_SECONDS,
    };
  }

  private handleAuctionAction(action: (auction: Auction, bidderId: string) => void): void {
    const auction = this.auction;
    const bidder  = auction?.currentBidder;
    if (!auction || !bidder) return;

    action(auction, bidder.id);

    if (auction.complete) {
      this.finishAuction();
      return;
    }
    this.auctionPanel.show(this.auctionView(auction));
    this.botDecideBid();   // the next bidder may be one too
  }

  private finishAuction(): void {
    const result = this.auction?.result;
    this.auction = null;
    this.auctionPanel.hide();
    this.boardView.setSelected(null);

    const winner = result?.winnerId
      ? this.players.find((p) => p.id === result.winnerId)
      : null;

    if (result && winner) {
      const tile = this.board.getTile(result.tileId);
      if (isOwnable(tile)) this.bank.sellPropertyToPlayer(winner, tile, result.amount);
      sfx.play('hammer');
      this.notif.show(`${winner.name} won ${tile.name} at auction for $${result.amount}!`, 'success');
      this.boardView.refresh();
      this.pushUIUpdate();
      this.refreshPanel();
    } else if (result) {
      this.notif.show(`No bids — ${this.board.getTile(result.tileId).name} stays unowned.`, 'info');
    }

    this.safeEndTurn(400);
  }

  // ── Property panel ────────────────────────────────────────────────────────────

  /** Board click: inspect a tile, or close the panel by clicking it again. */
  private selectTile(tileId: number): void {
    if (this.auction) return;   // the board is not up for inspection mid-auction
    if (this.panel.isOpen && this.panel.tileId === tileId) {
      this.panel.hide();
      this.boardView.setSelected(null);
      return;
    }
    this.boardView.setSelected(tileId);
    this.panel.show(this.buildPropertyView(tileId));
  }

  /** Re-render the open panel — cash, buildings and whose turn it is all move. */
  private refreshPanel(): void {
    if (this.panel.isOpen && this.panel.tileId !== null) {
      this.panel.show(this.buildPropertyView(this.panel.tileId));
    }
  }

  private runPanelAction(key: PanelActionKey): void {
    const tileId = this.panel.tileId;
    if (tileId === null) return;
    const tile = this.board.getTile(tileId);
    if (!isOwnable(tile)) return;

    // The owner acts, whoever's turn it is — see actionsFor.
    const player = this.players.find((p) => p.id === tile.ownerId);
    if (!player) return;
    const property = tile instanceof PropertyTile ? tile : null;

    // The buttons were drawn from a snapshot; cash and bank stock may have moved
    // since, so every action is re-checked on the way in.
    const attempt = (check: RuleCheck, run: () => boolean, done: string, type: NotifType): void => {
      if (!check.ok) {
        this.notif.show(check.reason, 'warning');
        return;
      }
      if (!run()) {
        this.notif.show(`The bank turned that down for ${tile.name}.`, 'danger');
        return;
      }
      this.notif.show(done, type);
      this.boardView.refresh();
      this.pushUIUpdate();
      this.refreshPanel();
    };

    switch (key) {
      case 'buildHouse':
        if (!property) return;
        attempt(
          canBuildHouse(this.board, this.bank, player, property),
          () => this.bank.buyHouse(player, property),
          `${player.name} built a house on ${property.name}.`, 'success',
        );
        break;
      case 'buildHotel':
        if (!property) return;
        attempt(
          canBuildHotel(this.board, this.bank, player, property),
          () => this.bank.buyHotel(player, property),
          `${player.name} opened a hotel on ${property.name}!`, 'success',
        );
        break;
      case 'sellHouse':
        if (!property) return;
        attempt(
          canSellHouse(this.board, player, property),
          () => this.bank.sellHouse(player, property),
          `${player.name} sold a house on ${property.name}.`, 'info',
        );
        break;
      case 'sellHotel':
        if (!property) return;
        attempt(
          canSellHotel(this.bank, player, property),
          () => this.bank.sellHotel(player, property),
          `${player.name} sold the hotel on ${property.name}.`, 'info',
        );
        break;
      case 'mortgage':
        attempt(
          canMortgage(this.board, player, tile),
          () => this.bank.mortgage(player, tile),
          `${player.name} mortgaged ${tile.name} for $${tile.mortgage}.`, 'warning',
        );
        break;
      case 'unmortgage':
        attempt(
          canUnmortgage(player, tile),
          () => this.bank.unmortgage(player, tile),
          `${player.name} lifted the mortgage on ${tile.name}.`, 'success',
        );
        break;
    }
  }

  // ── Panel view model ──────────────────────────────────────────────────────────
  // Every rule decision is made here so PropertyPanel stays a renderer.

  private buildPropertyView(tileId: number): PropertyView {
    const tile     = this.board.getTile(tileId);
    const property = tile instanceof PropertyTile ? tile : null;
    const owner    = isOwnable(tile) && tile.ownerId
      ? this.players.find((p) => p.id === tile.ownerId) ?? null
      : null;

    const facts: string[] = [];
    if (isOwnable(tile)) {
      facts.push(`Price  $${tile.price}`);
      if (property) facts.push(`House / hotel  $${property.houseCost} each`);
      facts.push(`Mortgage value  $${tile.mortgage}`);
      facts.push(`Lift mortgage  $${unmortgageCost(tile)}`);
    } else {
      facts.push(this.describeTile(tile));
    }

    const status: string[] = [];
    if (property?.hasHotel)    status.push('🏨 Hotel');
    else if (property?.houses) status.push(`🏠 ${property.houses} house${property.houses > 1 ? 's' : ''}`);
    if (isOwnable(tile) && tile.isMortgaged) status.push('⚠ Mortgaged');
    if (owner && property && ownsWholeGroup(this.board, owner, property)) status.push('★ Group complete');

    return {
      tileId,
      name: tile.name,
      subtitle: this.subtitleFor(tile),
      groupColor: property ? GROUP_COLORS[property.group] : null,
      ownerLabel: owner ? `Owned by ${owner.name}` : isOwnable(tile) ? 'Unowned' : '—',
      ownerColor: owner ? (this.ownerStyle(owner.id)?.color ?? null) : null,
      facts,
      rentRows: this.rentRowsFor(tile, owner),
      status: status.join('   '),
      actions: this.actionsFor(tile),
      note: this.actionNoteFor(tile, owner),
    };
  }

  private subtitleFor(tile: Tile): string {
    if (tile instanceof PropertyTile) {
      const group = tile.group.replace(/([A-Z])/g, ' $1').toLowerCase();
      return `Property · ${group} group of ${this.board.groupTiles(tile.group).length}`;
    }
    const labels: Record<string, string> = {
      railroad: 'Railroad', utility: 'Utility', tax: 'Tax',
      chance: 'Chance', communityChest: 'Community Chest',
      go: 'Corner', jail: 'Corner', freeParking: 'Corner', goToJail: 'Corner',
    };
    return labels[tile.type] ?? tile.type;
  }

  private describeTile(tile: Tile): string {
    if (tile instanceof TaxTile) return `Pay $${tile.amount} to the bank.`;
    switch (tile.type) {
      case 'go':          return `Collect $${GO_SALARY} as you pass.`;
      case 'chance':
      case 'communityChest': return 'Draw the top card.';
      case 'jail':        return 'Just visiting — unless you were sent here.';
      case 'goToJail':    return 'Go straight to jail. No salary.';
      case 'freeParking': return 'Nothing happens here.';
      default:            return '';
    }
  }

  private rentRowsFor(tile: Tile, owner: Player | null): RentRow[] {
    if (tile instanceof PropertyTile) {
      const charging = owner !== null && !tile.isMortgaged;
      const tier     = tile.hasHotel ? 5 : tile.houses;
      const labels   = ['Bare lot', '1 house', '2 houses', '3 houses', '4 houses', 'Hotel'];
      // The bare-lot tier doubles once the owner holds the whole group.
      const doubled  = owner !== null && ownsWholeGroup(this.board, owner, tile);
      return tile.rentTiers.map((rent, i) => ({
        label: i === 0 && doubled ? 'Bare lot ×2' : labels[i],
        value: `$${i === 0 && doubled ? rent * 2 : rent}`,
        active: charging && i === tier,
      }));
    }

    if (tile instanceof RailroadTile) {
      const held = owner ? countOwnedOfType(this.board, owner, 'railroad') : 0;
      return RAILROAD_RENT.map((rent, i) => ({
        label: `${i + 1} railroad${i ? 's' : ''}`,
        value: `$${rent}`,
        active: !tile.isMortgaged && held === i + 1,
      }));
    }

    if (tile instanceof UtilityTile) {
      const held = owner ? countOwnedOfType(this.board, owner, 'utility') : 0;
      return UTILITY_MULTIPLIERS.map((mult, i) => ({
        label: `${i + 1} utilit${i ? 'ies' : 'y'}`,
        value: `${mult} × dice`,
        active: !tile.isMortgaged && held === i + 1,
      }));
    }

    return [];
  }

  /**
   * Buttons belong to whoever owns the tile, not to whoever is rolling: the real
   * game lets you build, sell and mortgage at almost any point, and hot-seat play
   * has no secrecy to protect anyway.
   */
  private actionsFor(tile: Tile): PanelAction[] {
    if (!isOwnable(tile) || tile.ownerId === null) return [];
    const player = this.players.find((p) => p.id === tile.ownerId);
    if (!player || player.isBankrupt) return [];

    const button = (key: PanelActionKey, label: string, check: RuleCheck): PanelAction =>
      ({ key, label, enabled: check.ok, reason: check.reason });

    const actions: PanelAction[] = [];
    if (tile instanceof PropertyTile) {
      actions.push(
        button('buildHouse', `🏠 Build  $${tile.houseCost}`,
          canBuildHouse(this.board, this.bank, player, tile)),
        button('buildHotel', `🏨 Hotel  $${tile.houseCost}`,
          canBuildHotel(this.board, this.bank, player, tile)),
        button('sellHouse', `Sell house  +$${Math.floor(tile.houseCost / 2)}`,
          canSellHouse(this.board, player, tile)),
        button('sellHotel', `Sell hotel  +$${Math.floor(tile.houseCost / 2)}`,
          canSellHotel(this.bank, player, tile)),
      );
    }
    actions.push(
      button('mortgage', `Mortgage  +$${tile.mortgage}`, canMortgage(this.board, player, tile)),
      button('unmortgage', `Redeem  −$${unmortgageCost(tile)}`, canUnmortgage(player, tile)),
    );
    return actions;
  }

  private actionNoteFor(tile: Tile, owner: Player | null): string {
    if (!isOwnable(tile)) return 'Nothing to manage on this tile.';
    if (!owner)           return 'Nobody owns this yet — land on it to buy it.';
    if (owner.isBankrupt) return `${owner.name} is out of the game.`;
    return '';
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
    bus.on<MovePayload>('player:move', ({ playerId, from, to, steps, direction }) => {
      const mover = this.players.find((p) => p.id === playerId);
      const moverName = mover?.name ?? playerId;
      dlog(
        `[GameScene] player:move received: player=${moverName}, from=${from}, to=${to}, steps=${steps} | ` +
        `currentTurnPlayer=${this.turnManager.currentPlayer.name}`,
      );
      if (mover && mover.id !== this.turnManager.currentPlayer.id) {
        dwarn(
          `[GameScene] ⚠️  player:move for ${moverName} but currentPlayer is ` +
          `${this.turnManager.currentPlayer.name} — card-triggered move on a completed turn?`,
        );
      }
      this.isAnimating = true;
      this.setRollEnabled(false);

      this.moveTokenStepByStep(playerId, from, steps, direction ?? 1)
        .then(() => {
          const currentTurnPlayer = this.turnManager.currentPlayer;
          const movedPlayer       = this.players.find((p) => p.id === playerId);
          dlog(
            `[GameScene] Animation complete: animatedPlayer=${moverName} (pos=${movedPlayer?.position}), ` +
            `currentTurnPlayer=${currentTurnPlayer.name} (pos=${currentTurnPlayer.position})`,
          );
          if (movedPlayer && movedPlayer.id !== currentTurnPlayer.id) {
            console.error(
              `[GameScene] 🔴 BUG DETECTED — animation finished for ${moverName} ` +
              `but turn has already advanced to ${currentTurnPlayer.name}. ` +
              `resolveLanding() will fire on tile[${currentTurnPlayer.position}] ` +
              `"${this.board.getTile(currentTurnPlayer.position).name}" ` +
              `instead of tile[${movedPlayer.position}] ` +
              `"${this.board.getTile(movedPlayer.position).name}".`,
            );
          }
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
      sfx.play('dice');
      this.scene.get('UIScene').events.emit('dice:result', result);
    });

    // ── Turn bookkeeping ──────────────────────────────────────────────────────
    bus.on('turn:start', ({ playerId }: { playerId: string }) => {
      this.turnGen++;                          // ← invalidate all timers from the previous turn
      this.arrivalRent = null;                 // ← a card's rent rate never outlives its turn
      const player = this.players.find((p) => p.id === playerId)!;

      // A bot rolls for itself; leaving the button live would let a human roll
      // on its behalf.
      this.setRollEnabled(!player.isBot);
      this.hideBuyPrompt();

      const jailActAvail = !player.isBot && player.inJail
        && (player.getOutOfJailCards > 0 || player.cash >= JAIL_FINE);
      const jailLabel    = player.getOutOfJailCards > 0 ? '🃏  Use Card' : `🔓  Pay $${JAIL_FINE}`;
      this.setJailBtnVisible(jailActAvail, jailActAvail ? jailLabel : undefined);

      // Whose buttons the panel offers depends on whose turn it is.
      this.refreshPanel();

      this.scene.get('UIScene').events.emit('turn:start', { player, players: this.players });

      if (player.isBot) this.startBotTurn(player);
    });

    bus.on('turn:end', () => {
      this.setRollEnabled(false);
      this.setJailBtnVisible(false);
    });

    // ── Free landing (Go, Just Visiting, Free Parking, own property) ──────────
    bus.on('player:landed', ({ playerId, tileId }: { playerId: string; tileId: number }) => {
      this.applyLandingHouseRules(playerId, tileId);
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

      // A bot answers the prompt instead of being shown it.
      const player = this.players.find((p) => p.id === playerId);
      if (player?.isBot) {
        this.botDecideBuy(player, tileId, finalPrice, tile.name);
        return;
      }

      this.showBuyPrompt(tileId, playerId, finalPrice, tile.name, baseRent);
    });

    // ── Rent ──────────────────────────────────────────────────────────────────
    bus.on<RentPayload>('rent:pay', ({ debtorId, creditorId, amount, tileId, reason }) => {
      // Go salary: bank pays player. Fires *during* a move, so it must not touch
      // the arrival rate the landing still needs.
      if (reason === 'go') {
        const player = this.players.find((p) => p.id === creditorId)!;
        this.bank.payPlayer(player, amount ?? 0);
        sfx.play('cash');
        this.notif.show(`${player.name} passed GO — collect $${amount ?? 0}!`, 'success');
        this.pushUIUpdate();
        return; // DO NOT end turn — the normal move flow does that
      }

      // Player-to-player rent
      const debtor   = this.players.find((p) => p.id === debtorId);
      const creditor = this.players.find((p) => p.id === creditorId);
      if (!debtor || !creditor) return;

      // What the tile actually charges is a rules question — see game/Rent.ts.
      const { amount: resolved, notes } = quoteRent(
        this.board, this.board.getTile(tileId), creditor,
        {
          diceTotal: this.dice.lastResult?.total ?? 7,
          arrival:   this.arrivalRent,
          declared:  amount,
        },
      );
      this.arrivalRent = null;   // consumed

      // Settlement, not a clamped subtraction: a debtor who cannot pay sells and
      // mortgages first, and only then goes under, handing over their estate.
      const settlement = settleDebt(this.board, this.bank, debtor, creditor, resolved);
      sfx.play('spend');
      const note = notes.length ? ` (${notes.join(', ')})` : '';
      this.notif.show(
        `${debtor.name} paid $${settlement.paid} rent to ${creditor.name}${note}.`, 'warning',
      );
      announceSettlement(debtor, creditor, settlement);
      this.pushUIUpdate();
      this.safeEndTurn(700);
    });

    // ── Rent rate set by a card ("nearest railroad" / "nearest utility") ──────
    bus.on('rent:modifier', ({ rule }: { rule: ArrivalRent }) => {
      this.arrivalRent = rule;
    });

    // ── Tax ───────────────────────────────────────────────────────────────────
    bus.on<TaxPayload>('tax:pay', ({ playerId, amount }) => {
      const player = this.players.find((p) => p.id === playerId)!;
      const settlement = settleDebt(this.board, this.bank, player, null, amount);
      // House rule: tax does not vanish into the bank, it waits on Free Parking.
      if (this.houseRules.freeParkingJackpot) this.bank.addToPot(settlement.paid);
      this.notif.show(`${player.name} paid $${settlement.paid} tax.`, 'danger');
      announceSettlement(player, null, settlement);
      this.pushUIUpdate();
      this.safeEndTurn(700);
    });

    // ── Jail enter (from tile, card, or three-doubles) ────────────────────────
    bus.on<JailPayload>('jail:enter', ({ playerId, reason }) => {
      const player = this.players.find((p) => p.id === playerId)!;

      sfx.play('jail');
      // Snap token directly — no move tween needed
      this.snapToken(playerId, this.board.anchor('jail'));

      const why = reason === 'doubles' ? 'rolled three doubles'
                : reason === 'tile'    ? 'landed on Go to Jail'
                :                        'drew a Go to Jail card';
      this.notif.show(`${player.name} went to jail (${why})!`, 'danger');
      this.pushUIUpdate();
      this.safeEndTurn(800);
    });

    // Fired by TurnManager when a jailed player rolls non-doubles and still has
    // attempts left.  We deliberately DO NOT call endTurn() synchronously in
    // TurnManager because that entire chain (endTurn → advancePlayer → startTurn
    // → setRollEnabled(true) → rollBtn.setInteractive()) fires inside rollBtn's
    // own pointerdown callback.  Re-registering rollBtn with Phaser's InputPlugin
    // mid-event leaves the next player's roll button silently unresponsive until
    // the jailed player finally exits.  Deferring via safeEndTurn(100) moves
    // everything outside the current pointer-event frame.
    bus.on('jail:stay', ({ playerId }: { playerId: string }) => {
      const player = this.players.find((p) => p.id === playerId);
      dlog(
        `[GameScene] jail:stay received for ${player?.name ?? playerId} — ` +
        `disabling rollBtn now, scheduling safeEndTurn(100)`,
      );
      // Prevent the jailed player from rolling again during the 100 ms window.
      this.setRollEnabled(false);
      this.setJailBtnVisible(false);
      this.safeEndTurn(100);
    });

    // ── A spent Get Out of Jail Free card goes back under its own deck ────────
    bus.on('jail:exit', ({ method, card, amount }: { method: string; card?: Card; amount?: number }) => {
      // A fine is a fine: under the Free Parking house rule it joins the pot.
      if (this.houseRules.freeParkingJackpot && amount) this.bank.addToPot(amount);
      if (method !== 'card' || !card) return;
      const deck = [this.chanceDeck, this.commDeck].find((d) => d.owns(card));
      if (!deck) {
        dwarn(`[GameScene] jail card "${card.id}" belongs to neither deck — not returned`);
        return;
      }
      deck.returnToBottom(card);
      dlog(`[GameScene] returned "${card.id}" to the bottom of its deck`);
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

      // Return non-GOOJ cards to the discard immediately so the deck is always
      // self-consistent. Deferring this to the shutdown callback is fragile:
      // if CardScene never shuts down (stuck / launch no-op on a running scene)
      // the card is never returned and the deck exhausts after enough draws.
      if (!card.isGetOutOfJail) deck.returnCard(card);

      sfx.play('card');
      // Stop any currently-running CardScene before launching a new one.
      // This prevents stale once('shutdown') callbacks from previous turns
      // accumulating on the same scene events object and firing all at once.
      if (this.scene.isActive('CardScene')) this.scene.stop('CardScene');

      this.scene.launch('CardScene', { card });

      // Nobody clicks OK for a bot. Leave the card up long enough to read, then
      // close it — the shutdown handler below is what applies the effect, so this
      // has to stop the scene rather than skip showing it.
      if (player.isBot) {
        this.time.delayedCall(BOT_CARD_LINGER, () => {
          if (this.scene.isActive('CardScene')) this.scene.stop('CardScene');
        });
      }

      this.scene.get('CardScene').events.once('shutdown', () => {
        dlog(`[GameScene] CardScene shutdown → executing card "${card.description}" for ${player.name}`);
        this.cardEffects.execute(card, player);
        this.pushUIUpdate();

        // Cards that emit player:move handle turn-end themselves: the animation
        // resolves → resolveLanding() → tile.onLand() → safeEndTurn from the tile.
        // Calling safeEndTurn(200) here races against the animation
        // (N steps × 110 ms > 200 ms for N > 1) and fires before resolveLanding,
        // advancing the turn so onLand executes on the wrong current player.
        //
        // goToJail emits jail:enter → the jail:enter listener schedules
        // safeEndTurn(800) itself.
        //
        // Only static cards (money transfers, get-out-of-jail card) need us to
        // close the turn here.
        const selfTerminating = ['advanceTo', 'advanceToNearest', 'advanceToGo', 'goBack', 'goToJail'];
        if (selfTerminating.includes(card.action.type)) {
          dlog(`[GameScene] Card action "${card.action.type}" is self-terminating — skipping safeEndTurn(200)`);
        } else {
          this.safeEndTurn(200);
        }
      });
    });

    // ── Generic notification ──────────────────────────────────────────────────
    bus.on<NotifPayload>('ui:notification', ({ message, type }) => {
      this.notif.show(message, type);
      this.pushUIUpdate();
    });

    // ── Force player switch (debug tool from UIScene) ─────────────────────────
    bus.on('debug:forcePlayer', ({ index }: { index: number }) => {
      const target = this.players[index];
      dlog(
        `[GameScene] debug:forcePlayer received: index=${index} (${target?.name ?? 'unknown'}) | ` +
        `currentPlayer=${this.turnManager.currentPlayer.name}, phase=${this.turnManager.phase}`,
      );
      if (this.isAnimating) {
        this.notif.show('Cannot switch — animation in progress.', 'warning');
        return;
      }
      this.hideBuyPrompt();
      this.turnManager.forcePlayerTurn(index);
    });

    // ── Bankruptcy — an estate changed hands, so the board is out of date ─────
    bus.on('player:bankrupt', () => {
      this.boardView.refresh();
      this.pushUIUpdate();
      this.refreshPanel();
    });

    // ── Game over ─────────────────────────────────────────────────────────────
    bus.on('game:end', ({ winnerId }: { winnerId: string | null }) => {
      const winner = this.players.find((p) => p.id === winnerId);
      this.gameOver = true;   // stops any bot that was mid-think
      this.setRollEnabled(false);
      this.hideBuyPrompt();
      this.panel.hide();
      this.boardView.setSelected(null);

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
