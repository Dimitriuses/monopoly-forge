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

  private readonly PX = 1055;        // left edge
  private readonly PW = 225;         // panel width
  private readonly CX = 1055 + 112; // centre

  constructor() { super({ key: 'UIScene' }); }

  create(data: SceneData): void {
    const t = theme();

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

    if (data?.players?.length) {
      this.playerPanel.init(data.players);
      this.playerPanel.update(data.players, data.players[0].id);
    }

    // ── Event listeners ───────────────────────────────────────────────────────
    this.events.on('dice:result',    this.onDiceResult,    this);
    this.events.on('turn:start',     this.onTurnStart,     this);
    this.events.on('players:update', this.onPlayersUpdate, this);
  }

  // ── Handlers ─────────────────────────────────────────────────────────────────

  private onDiceResult({ die1, die2, isDoubles }: { die1: number; die2: number; isDoubles: boolean }): void {
    this.diceView.roll(die1, die2);
    this.doublesLabel.setText(isDoubles ? '⚡ DOUBLES — roll again!' : '');
    this.phaseLabel.setText(`Rolled ${die1 + die2} — moving…`);
  }

  private onTurnStart({ player, players }: { player: Player; players?: Player[] }): void {
    this.turnBanner.setText(`${player.name}'s turn`);
    this.phaseLabel.setText(player.inJail ? '🔒 In jail — roll or act' : 'Roll the dice…');
    this.doublesLabel.setText('');
    if (players) this.playerPanel.update(players, player.id);
  }

  private onPlayersUpdate({ players, activeId }: { players: Player[]; activeId: string }): void {
    this.playerPanel.update(players, activeId);
  }
}
