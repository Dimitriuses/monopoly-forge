import Phaser from 'phaser';
import { Board } from '@/game/Board';
import { Player } from '@/game/Player';
import { Dice } from '@/game/Dice';
import { Bank } from '@/game/Bank';
import { TurnManager } from '@/game/TurnManager';
import { CardDeck, CardEffects, CHANCE_CARDS, COMMUNITY_CHEST_CARDS, type Card } from '@/cards/CardDeck';
import { bus } from '@/utils/EventBus';
import { rng } from '@/utils/PRNG';
import { dlog, dwarn, isDebugLogging } from '@/utils/log';
import { Notification, type NotifType } from '@/ui/Notification';
import { BoardRenderer, type OwnerStyle } from '@/ui/BoardRenderer';
import {
  PropertyPanel,
  type PanelAction, type PanelActionKey, type PropertyView, type RentRow,
} from '@/ui/PropertyPanel';
import {
  DEFAULT_HOUSE_RULES, GROUP_COLORS, GROUP_SIZES, GO_SALARY,
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
import { settleDebt, announceSettlement } from '@/game/Estate';
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
  players: Array<{ name: string; token: TokenType }>;
  seed?: number;
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

  private tokenSprites: Map<string, Phaser.GameObjects.Arc>  = new Map();
  private tokenLabels:  Map<string, Phaser.GameObjects.Text> = new Map();
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
  /** True while a tween chain is running — blocks roll and force-switch */
  isAnimating = false;

  constructor() { super({ key: 'GameScene' }); }

  // ── Lifecycle ─────────────────────────────────────────────────────────────────

  init(data: SceneData): void {
    if (data.seed !== undefined) rng.seed(data.seed);
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
      tradeOpen:   () => this.tradePanel.isOpen,
      tradeOffer:  () => (this.offer ? { ...this.offer, mode: this.tradeMode } : null),
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
        String(i + 1),   // seat number — see ownerStyle for why not the initial
        { fontFamily: 'Arial', fontSize: '8px', color: '#ffffff', fontStyle: 'bold' },
      ).setOrigin(0.5).setDepth(11);

      this.tokenSprites.set(player.id, circle);
      this.tokenLabels.set(player.id, label);
    });
  }

  /** Animate token step-by-step, one tile at a time, forwards or backwards */
  private async moveTokenStepByStep(
    playerId: string, from: number, steps: number, direction: 1 | -1 = 1,
  ): Promise<void> {
    const sprite = this.tokenSprites.get(playerId);
    const label  = this.tokenLabels.get(playerId);
    if (!sprite || !label) return;

    for (let s = 1; s <= steps; s++) {
      const layout = this.board.getLayout(this.board.move(from, s * direction).to);
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

    // Left of the roll button, clear of the toast stack at x≈360–680.
    const tradeBtn = this.add.text(180, 738, '🤝  TRADE', {
      fontFamily: 'Georgia, serif', fontSize: '16px', color: '#ffffff',
      backgroundColor: '#1a4a6b', padding: { x: 16, y: 10 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(20);
    tradeBtn.on('pointerover', () => tradeBtn.setStyle({ backgroundColor: '#2a6b9b' }));
    tradeBtn.on('pointerout',  () => tradeBtn.setStyle({ backgroundColor: '#1a4a6b' }));
    tradeBtn.on('pointerdown', () => this.openTrade());

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

  private setRollEnabled(on: boolean): void {
    this.rollBtn.setAlpha(on ? 1 : 0.4);
    if (on) this.rollBtn.setInteractive({ useHandCursor: true });
    else    this.rollBtn.removeInteractive();
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
        break;
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

    if (auction.complete) this.finishAuction();
    else                  this.auctionPanel.show(this.auctionView(auction));
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
      return `Property · ${group} group of ${GROUP_SIZES[tile.group]}`;
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
      this.scene.get('UIScene').events.emit('dice:result', result);
    });

    // ── Turn bookkeeping ──────────────────────────────────────────────────────
    bus.on('turn:start', ({ playerId }: { playerId: string }) => {
      this.turnGen++;                          // ← invalidate all timers from the previous turn
      this.arrivalRent = null;                 // ← a card's rent rate never outlives its turn
      const player = this.players.find((p) => p.id === playerId)!;

      this.setRollEnabled(true);
      this.hideBuyPrompt();

      const jailActAvail = player.inJail && (player.getOutOfJailCards > 0 || player.cash >= 50);
      const jailLabel    = player.getOutOfJailCards > 0 ? '🃏  Use Card' : '🔓  Pay $50';
      this.setJailBtnVisible(jailActAvail, jailActAvail ? jailLabel : undefined);

      // Whose buttons the panel offers depends on whose turn it is.
      this.refreshPanel();

      this.scene.get('UIScene').events.emit('turn:start', { player, players: this.players });
    });

    bus.on('turn:end', () => {
      this.setRollEnabled(false);
      this.setJailBtnVisible(false);
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
      // Go salary: bank pays player. Fires *during* a move, so it must not touch
      // the arrival rate the landing still needs.
      if (reason === 'go') {
        const player = this.players.find((p) => p.id === creditorId)!;
        this.bank.payPlayer(player, amount ?? 0);
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
      this.notif.show(`${player.name} paid $${settlement.paid} tax.`, 'danger');
      announceSettlement(player, null, settlement);
      this.pushUIUpdate();
      this.safeEndTurn(700);
    });

    // ── Jail enter (from tile, card, or three-doubles) ────────────────────────
    bus.on<JailPayload>('jail:enter', ({ playerId, reason }) => {
      const player = this.players.find((p) => p.id === playerId)!;

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
    bus.on('jail:exit', ({ method, card }: { method: string; card?: Card }) => {
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

      // Stop any currently-running CardScene before launching a new one.
      // This prevents stale once('shutdown') callbacks from previous turns
      // accumulating on the same scene events object and firing all at once.
      if (this.scene.isActive('CardScene')) this.scene.stop('CardScene');

      this.scene.launch('CardScene', { card });
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
