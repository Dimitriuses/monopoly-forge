import Phaser from 'phaser';
import { Board } from '@/game/Board';
import { Player } from '@/game/Player';
import { Dice } from '@/game/Dice';
import { Bank } from '@/game/Bank';
import { TurnManager } from '@/game/TurnManager';
import { CardDeck, CardEffects, CHANCE_CARDS, COMMUNITY_CHEST_CARDS } from '@/cards/CardDeck';
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
  canMortgage, canUnmortgage, unmortgageCost, ownsWholeGroup,
  type RuleCheck,
} from '@/game/BuildRules';

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
  /** Not `renderer` — Phaser.Scene already owns that name for the WebGL renderer. */
  private boardView!:   BoardRenderer;
  private panel!:       PropertyPanel;

  /** Incremented on every turn:start — stale safeEndTurn timers check against this */
  private turnGen = 0;
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

  /** Animate token step-by-step, one tile at a time */
  private async moveTokenStepByStep(playerId: string, from: number, steps: number): Promise<void> {
    const sprite = this.tokenSprites.get(playerId);
    const label  = this.tokenLabels.get(playerId);
    if (!sprite || !label) return;

    for (let s = 1; s <= steps; s++) {
      const layout = this.board.getLayout(this.board.move(from, s).to);
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
      this.notif.show(`${player.name} passed on ${tileName}.`, 'info');
      this.hideBuyPrompt();
      this.safeEndTurn(300);
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

  // ── Property panel ────────────────────────────────────────────────────────────

  /** Board click: inspect a tile, or close the panel by clicking it again. */
  private selectTile(tileId: number): void {
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

    const player   = this.turnManager.currentPlayer;
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
      return tile.rentTiers.map((rent, i) => ({
        label: labels[i], value: `$${rent}`, active: charging && i === tier,
      }));
    }

    if (tile instanceof RailroadTile) {
      const held = owner ? this.countOwnedOfType(owner, 'railroad') : 0;
      return RAILROAD_RENT.map((rent, i) => ({
        label: `${i + 1} railroad${i ? 's' : ''}`,
        value: `$${rent}`,
        active: !tile.isMortgaged && held === i + 1,
      }));
    }

    if (tile instanceof UtilityTile) {
      const held = owner ? this.countOwnedOfType(owner, 'utility') : 0;
      return UTILITY_MULTIPLIERS.map((mult, i) => ({
        label: `${i + 1} utilit${i ? 'ies' : 'y'}`,
        value: `${mult} × dice`,
        active: !tile.isMortgaged && held === i + 1,
      }));
    }

    return [];
  }

  /** Buttons are offered to the player whose turn it is — this is hot-seat play. */
  private actionsFor(tile: Tile): PanelAction[] {
    if (!isOwnable(tile)) return [];
    const player = this.turnManager.currentPlayer;
    if (tile.ownerId !== player.id) return [];

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
    if (owner.id !== this.turnManager.currentPlayer.id) {
      return `${owner.name} manages this one. Buttons appear on their turn.`;
    }
    return '';
  }

  private countOwnedOfType(player: Player, type: Tile['type']): number {
    return [...player.ownedTileIds].filter((id) => this.board.getTile(id).type === type).length;
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
    bus.on<MovePayload>('player:move', ({ playerId, from, to, steps }) => {
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

      this.moveTokenStepByStep(playerId, from, steps)
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
      let resolved = amount ?? 0;

      // Railroad / Utility: resolve amount from tile + ownership
      if (resolved === 0) {
        const tile     = this.board.getTile(tileId);
        const creditor = this.players.find((p) => p.id === creditorId);
        if (!creditor) return;

        if (tile instanceof RailroadTile) {
          resolved = tile.rentFor(this.countOwnedOfType(creditor, 'railroad'));
        } else if (tile instanceof UtilityTile) {
          const mult = tile.rentMultiplier(this.countOwnedOfType(creditor, 'utility'));
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
        const selfTerminating = ['advanceTo', 'advanceToGo', 'goBack', 'goToJail'];
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
