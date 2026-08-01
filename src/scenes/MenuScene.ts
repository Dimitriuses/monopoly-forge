import Phaser from 'phaser';
import type { TokenType } from '@/config';
import { TOKEN_LABELS } from '@/config';

interface PlayerSetup {
  name: string;
  token: TokenType;
}

export class MenuScene extends Phaser.Scene {
  private playerCount: number = 2;
  private players: PlayerSetup[] = [];
  private setupContainer!: Phaser.GameObjects.Container;
  private countButtons: Map<number, Phaser.GameObjects.Text> = new Map();

  constructor() {
    super({ key: 'MenuScene' });
  }

  create(): void {
    const { width, height } = this.scale;

    // ── Background ────────────────────────────────────────────────────────────
    this.add.rectangle(0, 0, width, height, 0x1a1a2e).setOrigin(0);

    // ── Title ─────────────────────────────────────────────────────────────────
    this.add.text(width / 2, 80, '🏦 MONOPOLY FORGE', {
      fontFamily: 'Georgia, serif',
      fontSize: '42px',
      color: '#f0c040',
      stroke: '#000',
      strokeThickness: 4,
    }).setOrigin(0.5);

    this.add.text(width / 2, 130, 'A Custom Phaser 3 Edition', {
      fontFamily: 'Georgia, serif',
      fontSize: '18px',
      color: '#aaaacc',
    }).setOrigin(0.5);

    // ── Player count selector ─────────────────────────────────────────────────
    this.add.text(width / 2, 200, 'Number of Players', {
      fontFamily: 'Georgia, serif',
      fontSize: '20px',
      color: '#ffffff',
    }).setOrigin(0.5);

    [2, 3, 4, 5, 6].forEach((count, i) => {
      const btn = this.add.text(width / 2 - 100 + i * 50, 235, String(count), {
        fontFamily: 'Georgia, serif',
        fontSize: '22px',
        color: '#888888',
        backgroundColor: '#2a2a4a',
        padding: { x: 10, y: 6 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });

      this.countButtons.set(count, btn);

      btn.on('pointerdown', () => {
        this.playerCount = count;
        // Without this the highlight stays on whichever count was selected when
        // the buttons were built, while the rows below silently change.
        this.refreshCountButtons();
        this.buildSetupUI();
      });
    });
    this.refreshCountButtons();

    // ── Player setup rows ──────────────────────────────────────────────────────
    this.setupContainer = this.add.container(0, 0);
    this.buildSetupUI();

    // ── Start button ──────────────────────────────────────────────────────────
    const startBtn = this.add.text(width / 2, height - 80, '▶  START GAME', {
      fontFamily: 'Georgia, serif',
      fontSize: '26px',
      color: '#ffffff',
      backgroundColor: '#27ae60',
      padding: { x: 32, y: 14 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    startBtn.on('pointerover', () => startBtn.setStyle({ backgroundColor: '#2ecc71' }));
    startBtn.on('pointerout',  () => startBtn.setStyle({ backgroundColor: '#27ae60' }));
    startBtn.on('pointerdown', () => this.startGame());
  }

  /** Repaint the player-count buttons so exactly one reads as selected. */
  private refreshCountButtons(): void {
    this.countButtons.forEach((btn, count) => {
      const selected = count === this.playerCount;
      btn.setColor(selected ? '#f0c040' : '#888888');
      btn.setBackgroundColor(selected ? '#3d3d6b' : '#2a2a4a');
    });
  }

  private buildSetupUI(): void {
    this.setupContainer.removeAll(true);
    this.players = [];

    const tokens = Object.keys(TOKEN_LABELS) as TokenType[];
    const startY = 290;
    // Line the rows up under the centred title rather than against the far left.
    const labelX = this.scale.width / 2 - 110;
    const tokenX = this.scale.width / 2 - 60;

    for (let i = 0; i < this.playerCount; i++) {
      const y = startY + i * 55;
      const defaultToken = tokens[i % tokens.length];
      this.players.push({ name: `Player ${i + 1}`, token: defaultToken });

      // Row label
      this.setupContainer.add(
        this.add.text(labelX, y, `P${i + 1}`, {
          fontFamily: 'Georgia, serif', fontSize: '18px', color: '#aaaacc',
        }).setOrigin(0, 0.5),
      );

      // Token selector (simple text cycle for now)
      const tokenLabel = this.add.text(tokenX, y, TOKEN_LABELS[defaultToken], {
        fontFamily: 'Georgia, serif', fontSize: '16px', color: '#f0c040',
        backgroundColor: '#2a2a4a', padding: { x: 8, y: 4 },
      }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });

      tokenLabel.on('pointerdown', () => {
        const cur = tokens.indexOf(this.players[i].token);
        this.players[i].token = tokens[(cur + 1) % tokens.length];
        tokenLabel.setText(TOKEN_LABELS[this.players[i].token]);
      });

      this.setupContainer.add(tokenLabel);
    }
  }

  /**
   * `?seed=12345` in the URL re-seeds the global PRNG, so dice rolls and both
   * card shuffles replay identically. Used by the playtest harness and handy for
   * reproducing a bug report. Omitted or non-numeric = a random game.
   */
  private readSeedFromUrl(): number | undefined {
    const raw = new URLSearchParams(window.location.search).get('seed');
    if (raw === null || raw.trim() === '') return undefined;
    const seed = Number(raw);
    return Number.isFinite(seed) ? seed : undefined;
  }

  private startGame(): void {
    this.scene.start('GameScene', { players: this.players, seed: this.readSeedFromUrl() });
    // UIScene is launched by GameScene once the model is ready
  }
}
