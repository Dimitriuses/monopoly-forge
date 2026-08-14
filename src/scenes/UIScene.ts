import Phaser from 'phaser';
import type { Player } from '@/game/Player';
import { DiceView } from '@/ui/DiceView';
import { PlayerPanel } from '@/ui/PlayerPanel';
import { theme } from '@/ui/Theme';

interface SceneData { players: Player[] }

export class UIScene extends Phaser.Scene {
  private diceView!:     DiceView;
  private playerPanel!:  PlayerPanel;
  private doublesLabel!: Phaser.GameObjects.Text;
  private phaseLabel!:   Phaser.GameObjects.Text;
  private turnBanner!:   Phaser.GameObjects.Text;

  /** What the HUD is currently showing, so a rebuild can put it back. */
  private seated: Player[] = [];
  private activeId: string | null = null;
  private banner = "Player 1's turn";
  private phaseText = 'Roll the dice…';
  private lastDice: { die1: number; die2: number; isDoubles: boolean } | null = null;

  private readonly PX = 1055;        // left edge
  private readonly PW = 225;         // panel width
  private readonly CX = 1055 + 112; // centre

  constructor() { super({ key: 'UIScene' }); }

  create(data: SceneData): void {
    this.seated = data?.players ?? [];
    this.build();

    // Registered once, and outside `build` — they live on the scene's own
    // emitter, which a rebuild of the drawn objects does not touch.
    this.events.on('dice:result',    this.onDiceResult,    this);
    this.events.on('turn:start',     this.onTurnStart,     this);
    this.events.on('players:update', this.onPlayersUpdate, this);
  }

  /**
   * Draw the HUD in whatever palette is current, and put back what it was
   * showing. Called again when the theme changes mid-game — the alternative,
   * restarting the scene, loses the dice and the banner *and* cannot be followed
   * by a `delayedCall` from `GameScene`, whose clock is paused while the menu
   * that changed the theme is open.
   */
  restyle(): void {
    this.build();
  }

  private build(): void {
    const t = theme();
    // A HUD is chrome and nothing else, so the cheapest correct rebuild is to
    // clear the lot. The event listeners are on the scene, not on these objects.
    this.children.removeAll(true);

    // ── Background ────────────────────────────────────────────────────────────
    this.add.rectangle(this.PX, 0, this.PW, 800, t.panel.background).setOrigin(0, 0);
    const sep = this.add.graphics();
    sep.lineStyle(1, t.chrome.panelBorder, 1);
    sep.lineBetween(this.PX, 0, this.PX, 800);

    // ── Logo ──────────────────────────────────────────────────────────────────
    this.add.text(this.CX, 14, '🏦 MONOPOLY', {
      fontFamily: t.font.display, fontSize: '14px',
      color: t.chrome.heading, fontStyle: 'bold',
    }).setOrigin(0.5, 0);
    this.add.text(this.CX, 33, 'F O R G E', {
      fontFamily: t.font.display, fontSize: '9px', color: t.panel.subtitle,
    }).setOrigin(0.5, 0);

    // ── Turn banner ───────────────────────────────────────────────────────────
    this.add.graphics().lineStyle(1, t.chrome.panelBorder, 1).lineBetween(this.PX, 58, this.PX + this.PW, 58);

    this.turnBanner = this.add.text(this.CX, 67, "Player 1's turn", {
      fontFamily: t.font.display, fontSize: '13px', color: t.chrome.text,
      wordWrap: { width: this.PW - 16 }, align: 'center',
    }).setOrigin(0.5, 0);

    this.phaseLabel = this.add.text(this.CX, 87, 'Roll the dice…', {
      fontFamily: t.font.display, fontSize: '10px', color: t.chrome.dim, align: 'center',
    }).setOrigin(0.5, 0);

    // ── Dice ──────────────────────────────────────────────────────────────────
    this.add.graphics().lineStyle(1, t.chrome.panelBorder, 1).lineBetween(this.PX, 112, this.PX + this.PW, 112);
    this.add.text(this.CX, 119, '🎲 DICE', {
      fontFamily: t.font.display, fontSize: '9px', color: t.panel.subtitle,
    }).setOrigin(0.5, 0);

    this.diceView = new DiceView(this, this.CX, 158, 44);

    this.doublesLabel = this.add.text(this.CX, 205, '', {
      fontFamily: t.font.display, fontSize: '11px', color: t.chrome.heading, fontStyle: 'italic',
    }).setOrigin(0.5, 0);

    // ── Players ───────────────────────────────────────────────────────────────
    this.add.graphics().lineStyle(1, t.chrome.panelBorder, 1).lineBetween(this.PX, 228, this.PX + this.PW, 228);
    this.add.text(this.CX, 235, '👥 PLAYERS', {
      fontFamily: t.font.display, fontSize: '9px', color: t.panel.subtitle,
    }).setOrigin(0.5, 0);

    this.playerPanel = new PlayerPanel(this, this.PX, 252, this.PW);

    // Whatever was on screen before goes back on it — a change of colour must
    // not blank the dice or forget whose turn it is.
    if (this.seated.length) {
      this.playerPanel.init(this.seated);
      this.playerPanel.update(this.seated, this.activeId ?? this.seated[0].id);
    }
    this.turnBanner.setText(this.banner);
    this.phaseLabel.setText(this.phaseText);
    if (this.lastDice) {
      this.diceView.roll(this.lastDice.die1, this.lastDice.die2);
      this.doublesLabel.setText(this.lastDice.isDoubles ? '⚡ DOUBLES — roll again!' : '');
    }
  }

  // ── Handlers ─────────────────────────────────────────────────────────────────

  private onDiceResult({ die1, die2, isDoubles }: { die1: number; die2: number; isDoubles: boolean }): void {
    this.lastDice = { die1, die2, isDoubles };
    this.diceView.roll(die1, die2);
    this.doublesLabel.setText(isDoubles ? '⚡ DOUBLES — roll again!' : '');
    this.phaseText = `Rolled ${die1 + die2} — moving…`;
    this.phaseLabel.setText(this.phaseText);
  }

  private onTurnStart({ player, players }: { player: Player; players?: Player[] }): void {
    this.banner    = `${player.name}'s turn`;
    this.phaseText = player.inJail ? '🔒 In jail — roll or act' : 'Roll the dice…';
    this.activeId  = player.id;
    this.lastDice  = null;
    this.turnBanner.setText(this.banner);
    this.phaseLabel.setText(this.phaseText);
    this.doublesLabel.setText('');
    if (players) {
      this.seated = players;
      this.playerPanel.update(players, player.id);
    }
  }

  private onPlayersUpdate({ players, activeId }: { players: Player[]; activeId: string }): void {
    this.seated   = players;
    this.activeId = activeId;
    this.playerPanel.update(players, activeId);
  }
}
