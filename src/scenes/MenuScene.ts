import Phaser from 'phaser';
import type { HouseRules, TokenType } from '@/config';
import { TOKEN_LABELS, DEFAULT_HOUSE_RULES, HOUSE_RULE_LABELS } from '@/config';
import { SaveLoad } from '@/utils/SaveLoad';
import { validateSnapshot, type GameSnapshot } from '@/game/Snapshot';

interface PlayerSetup {
  name: string;
  token: TokenType;
}

export class MenuScene extends Phaser.Scene {
  private playerCount: number = 2;
  private players: PlayerSetup[] = [];
  private setupContainer!: Phaser.GameObjects.Container;
  private countButtons: Map<number, Phaser.GameObjects.Text> = new Map();
  private houseRules: HouseRules = { ...DEFAULT_HOUSE_RULES };

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

    this.buildHouseRules();

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

    this.buildContinueButton();
  }

  /**
   * The house-rule switches. Every one of these is read by the game — a flag
   * nothing consults does not belong here (see HouseRules in config.ts).
   */
  private buildHouseRules(): void {
    const { width } = this.scale;
    const keys = Object.keys(HOUSE_RULE_LABELS) as Array<keyof HouseRules>;

    // One row across, not a column: six player rows can reach y=578 and the
    // START button starts at y=690, so there is only one line's worth of space.
    const chipW = 230;
    const gap   = 15;
    const left  = width / 2 - (keys.length * chipW + (keys.length - 1) * gap) / 2;

    this.add.text(width / 2, 600, 'House rules', {
      fontFamily: 'Georgia, serif', fontSize: '14px', color: '#7788aa',
    }).setOrigin(0.5);

    keys.forEach((key, i) => {
      const row = this.add.text(left + i * (chipW + gap), 626, '', {
        fontFamily: 'Georgia, serif', fontSize: '15px',
        color: '#aaaacc', backgroundColor: '#2a2a4a',
        padding: { x: 10, y: 4 }, fixedWidth: chipW,
      }).setInteractive({ useHandCursor: true });

      const paint = () => {
        const on = this.houseRules[key];
        row.setText(`${on ? '☑' : '☐'}  ${HOUSE_RULE_LABELS[key]}`);
        row.setColor(on ? '#f0c040' : '#8899aa');
      };
      paint();

      row.on('pointerdown', () => {
        this.houseRules[key] = !this.houseRules[key];
        paint();
      });
    });
  }

  /** Only offered when there is a save, and only if this build can read it. */
  private buildContinueButton(): void {
    const saved = SaveLoad.load();
    if (!saved || !validateSnapshot(saved.state)) return;

    const when = new Date(saved.timestamp).toLocaleString();
    const btn = this.add.text(this.scale.width / 2, this.scale.height - 30, '↻  CONTINUE SAVED GAME', {
      fontFamily: 'Georgia, serif', fontSize: '15px', color: '#ffffff',
      backgroundColor: '#2a3a55', padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    btn.on('pointerover', () => btn.setStyle({ backgroundColor: '#3d5170' }));
    btn.on('pointerout',  () => btn.setStyle({ backgroundColor: '#2a3a55' }));
    btn.on('pointerdown', () => {
      this.scene.start('GameScene', {
        players: this.players,
        snapshot: saved.state as unknown as GameSnapshot,
      });
    });

    this.add.text(this.scale.width / 2, this.scale.height - 8, `saved ${when}`, {
      fontFamily: 'Georgia, serif', fontSize: '10px', color: '#55667a',
    }).setOrigin(0.5);
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
    this.scene.start('GameScene', {
      players: this.players,
      seed: this.readSeedFromUrl(),
      houseRules: this.houseRules,
    });
    // UIScene is launched by GameScene once the model is ready
  }
}
