import Phaser from 'phaser';
import type { Player } from '@/game/Player';
import { DiceView } from '@/ui/DiceView';
import { PlayerPanel } from '@/ui/PlayerPanel';

interface SceneData { players: Player[] }

export class UIScene extends Phaser.Scene {
  private diceView!: DiceView;
  private playerPanel!: PlayerPanel;
  private doublesLabel!: Phaser.GameObjects.Text;
  private phaseLabel!: Phaser.GameObjects.Text;
  private turnBanner!: Phaser.GameObjects.Text;

  // Panel geometry
  private readonly PX = 1055;          // left edge of sidebar
  private readonly PW = 225;           // sidebar width
  private readonly CX = 1055 + 112;   // horizontal centre

  constructor() { super({ key: 'UIScene' }); }

  init(_data: SceneData): void { /* players arrive via events */ }

  create(data: SceneData): void {
    // ── Background panel ──────────────────────────────────────────────────────
    this.add.rectangle(this.PX, 0, this.PW, 800, 0x0f1728).setOrigin(0, 0);

    // Subtle separator line
    const sep = this.add.graphics();
    sep.lineStyle(1, 0x334466, 1);
    sep.lineBetween(this.PX, 0, this.PX, 800);

    // ── Logo ──────────────────────────────────────────────────────────────────
    this.add.text(this.CX, 18, '🏦 MONOPOLY', {
      fontFamily: 'Georgia, serif', fontSize: '14px',
      color: '#f0c040', fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5, 0);
    this.add.text(this.CX, 36, 'F O R G E', {
      fontFamily: 'Georgia, serif', fontSize: '10px',
      color: '#7788aa', letterSpacing: 4,
    }).setOrigin(0.5, 0);

    // ── Turn banner ───────────────────────────────────────────────────────────
    this.add.rectangle(this.PX, 62, this.PW, 1, 0x334466).setOrigin(0, 0);
    this.turnBanner = this.add.text(this.CX, 72, "Player 1's turn", {
      fontFamily: 'Georgia, serif', fontSize: '13px', color: '#ffffff',
      wordWrap: { width: this.PW - 16 }, align: 'center',
    }).setOrigin(0.5, 0);

    this.phaseLabel = this.add.text(this.CX, 92, 'Roll the dice…', {
      fontFamily: 'Georgia, serif', fontSize: '10px', color: '#778899',
      align: 'center',
    }).setOrigin(0.5, 0);

    // ── Dice view ─────────────────────────────────────────────────────────────
    this.add.rectangle(this.PX, 118, this.PW, 1, 0x334466).setOrigin(0, 0);
    this.add.text(this.CX, 126, '🎲 DICE', {
      fontFamily: 'Georgia, serif', fontSize: '10px', color: '#556677',
    }).setOrigin(0.5, 0);

    this.diceView = new DiceView(this, this.CX, 168, 44);

    this.doublesLabel = this.add.text(this.CX, 210, '', {
      fontFamily: 'Georgia, serif', fontSize: '11px', color: '#f0c040',
      fontStyle: 'italic',
    }).setOrigin(0.5, 0);

    // ── Player panels ─────────────────────────────────────────────────────────
    this.add.rectangle(this.PX, 238, this.PW, 1, 0x334466).setOrigin(0, 0);
    this.add.text(this.CX, 246, '👥 PLAYERS', {
      fontFamily: 'Georgia, serif', fontSize: '10px', color: '#556677',
    }).setOrigin(0.5, 0);

    this.playerPanel = new PlayerPanel(this, this.PX, 264, this.PW);
    if (data?.players) {
      this.playerPanel.init(data.players);
      this.playerPanel.update(data.players, data.players[0]?.id ?? '');
    }

    // ── Event listeners ───────────────────────────────────────────────────────
    this.events.on('dice:result', this.onDiceResult, this);
    this.events.on('turn:start',  this.onTurnStart,  this);
    this.events.on('players:update', this.onPlayersUpdate, this);
  }

  // ── Handlers ─────────────────────────────────────────────────────────────────

  private onDiceResult({ die1, die2, isDoubles }: { die1: number; die2: number; isDoubles: boolean }): void {
    this.diceView.roll(die1, die2);
    this.doublesLabel.setText(isDoubles ? '⚡ DOUBLES!' : '');
    this.phaseLabel.setText(`Rolled ${die1 + die2} — moving…`);
  }

  private onTurnStart({ player, players }: { player: Player; players: Player[] }): void {
    this.turnBanner.setText(`${player.name}'s turn`);
    this.phaseLabel.setText(player.inJail ? '🔒 In jail' : 'Roll the dice…');
    this.doublesLabel.setText('');
    if (players) {
      this.playerPanel.update(players, player.id);
    }
  }

  private onPlayersUpdate({ players, activeId }: { players: Player[]; activeId: string }): void {
    this.playerPanel.update(players, activeId);
  }
}
