import Phaser from 'phaser';
import type { HouseRules, TokenType } from '@/config';
import { TOKEN_LABELS, DEFAULT_HOUSE_RULES, HOUSE_RULE_LABELS } from '@/config';
import { SaveLoad } from '@/utils/SaveLoad';
import { MAPS, mapById } from '@/maps';
import { validateSnapshot, type GameSnapshot } from '@/game/Snapshot';
import { knownVariants, variantNamed } from '@/game/Variants';

interface PlayerSetup {
  name: string;
  token: TokenType;
  isBot: boolean;
}

export class MenuScene extends Phaser.Scene {
  private playerCount: number = 2;
  private players: PlayerSetup[] = [];
  private setupContainer!: Phaser.GameObjects.Container;
  private countButtons: Map<number, Phaser.GameObjects.Text> = new Map();
  /** `?houseRules=freeParkingJackpot,noAuction` switches them on; the chips override. */
  private houseRules: HouseRules = MenuScene.houseRulesFromUrl();
  /** Variants switched on. `?variants=speedDie` preselects, the chips override. */
  private variants: string[] = new URLSearchParams(window.location.search)
    .get('variants')?.split(',').filter((name) => knownVariants().includes(name)) ?? [];
  /** `?map=<id>` preselects a board; the chips override it. */
  private mapId: string = mapById(
    new URLSearchParams(window.location.search).get('map'),
  ).id;

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

    this.buildMapSelector();

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
   * Which board to play on. The alternatives are not decoration: they are what
   * proves the rules and the renderer take their shape from the map rather than
   * from a hardcoded square (ROADMAP M8a).
   */
  private buildMapSelector(): void {
    const { width } = this.scale;
    const maps = Object.values(MAPS);
    const chipW = 150;
    const gap = 10;
    const left = width / 2 - (maps.length * chipW + (maps.length - 1) * gap) / 2;

    // The chips draw from their top-left, so they occupy 148–172; the blurb sits
    // under them and still clears "Number of Players" at y=200.
    const blurb = this.add.text(width / 2, 176, '', {
      fontFamily: 'Georgia, serif', fontSize: '11px', color: '#55667a',
    }).setOrigin(0.5);

    const chips = maps.map((map, i) => {
      const chip = this.add.text(left + i * (chipW + gap), 148, map.name, {
        fontFamily: 'Georgia, serif', fontSize: '14px',
        padding: { x: 8, y: 5 }, fixedWidth: chipW, align: 'center',
      }).setInteractive({ useHandCursor: true });
      chip.on('pointerdown', () => { this.mapId = map.id; paint(); });
      return chip;
    });

    const paint = () => {
      maps.forEach((map, i) => {
        const active = map.id === this.mapId;
        chips[i].setColor(active ? '#ffffff' : '#8899aa');
        chips[i].setBackgroundColor(active ? '#2a6b9b' : '#1a2640');
        if (active) blurb.setText(map.blurb);
      });
    };
    paint();
  }

  /**
   * The house-rule switches. Every one of these is read by the game — a flag
   * nothing consults does not belong here (see HouseRules in config.ts).
   */
  private buildHouseRules(): void {
    const { width } = this.scale;

    // The switches are house rules *and* registered variants in one row: both
    // are things you turn on before starting, and a variant that registers
    // itself appears here without this scene being edited.
    const chips: Array<{ label: string; on: () => boolean; toggle: () => void }> = [
      ...(Object.keys(HOUSE_RULE_LABELS) as Array<keyof HouseRules>).map((key) => ({
        label:  HOUSE_RULE_LABELS[key],
        on:     () => this.houseRules[key],
        toggle: () => { this.houseRules[key] = !this.houseRules[key]; },
      })),
      ...knownVariants().map((name) => ({
        label:  variantNamed(name).label,
        on:     () => this.variants.includes(name),
        toggle: () => {
          this.variants = this.variants.includes(name)
            ? this.variants.filter((v) => v !== name)
            : [...this.variants, name];
        },
      })),
    ];

    // One row across, not a column: six player rows can reach y=578 and the
    // START button starts at y=690, so there is only one line's worth of space.
    // The chips shrink to fit rather than running off the edge as more register.
    const gap   = 15;
    const chipW = Math.min(230, (width - 80 - (chips.length - 1) * gap) / chips.length);
    const left  = width / 2 - (chips.length * chipW + (chips.length - 1) * gap) / 2;

    this.add.text(width / 2, 600, 'House rules & variants', {
      fontFamily: 'Georgia, serif', fontSize: '14px', color: '#7788aa',
    }).setOrigin(0.5);

    chips.forEach((chip, i) => {
      const row = this.add.text(left + i * (chipW + gap), 626, '', {
        fontFamily: 'Georgia, serif', fontSize: '15px',
        color: '#aaaacc', backgroundColor: '#2a2a4a',
        padding: { x: 10, y: 4 }, fixedWidth: chipW,
      }).setInteractive({ useHandCursor: true });

      const paint = () => {
        row.setText(`${chip.on() ? '☑' : '☐'}  ${chip.label}`);
        row.setColor(chip.on() ? '#f0c040' : '#8899aa');
      };
      paint();

      row.on('pointerdown', () => { chip.toggle(); paint(); });
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

  /**
   * House rules named in the URL. It is the same affordance `?map=` and
   * `?variants=` give, and it is what lets the playtest exercise a rule set
   * other than the default one — the switches are canvas text with no DOM to
   * click from a harness.
   */
  private static houseRulesFromUrl(): HouseRules {
    const rules = { ...DEFAULT_HOUSE_RULES };
    const named = new URLSearchParams(window.location.search).get('houseRules');
    for (const key of named?.split(',') ?? []) {
      if (key in rules) rules[key as keyof HouseRules] = true;
    }
    return rules;
  }

  /**
   * The next piece nobody else has taken. Cycling each row independently used to
   * let two seats both end up as "Car", and a shared token is a shared colour on
   * the board — the owner bands, the tokens and the HUD all read the same, and
   * there is nothing left to tell the two players apart by.
   *
   * There are eight pieces and at most six seats, so a free one always exists;
   * the loop bound is there so a shorter list could never spin.
   */
  private nextFreeToken(seat: number, tokens: TokenType[]): TokenType {
    const taken = new Set(this.players.filter((_, i) => i !== seat).map((p) => p.token));
    const from  = tokens.indexOf(this.players[seat].token);

    for (let step = 1; step <= tokens.length; step++) {
      const candidate = tokens[(from + step) % tokens.length];
      if (!taken.has(candidate)) return candidate;
    }
    return this.players[seat].token;
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
      // Seat 1 is yours; the rest default to bots, so a single player can start
      // a real game from the menu without configuring anything.
      this.players.push({ name: `Player ${i + 1}`, token: defaultToken, isBot: i > 0 });

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
        this.players[i].token = this.nextFreeToken(i, tokens);
        tokenLabel.setText(TOKEN_LABELS[this.players[i].token]);
      });

      this.setupContainer.add(tokenLabel);

      // Who takes this seat's turns.
      const seat = this.add.text(tokenX + 160, y, '', {
        fontFamily: 'Georgia, serif', fontSize: '14px',
        padding: { x: 8, y: 4 }, fixedWidth: 110, align: 'center',
      }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });

      const paintSeat = () => {
        const bot = this.players[i].isBot;
        seat.setText(bot ? '🤖  Bot' : '🙋  Human');
        seat.setColor(bot ? '#88ccff' : '#f0c040');
        seat.setBackgroundColor(bot ? '#1a3450' : '#2a2a4a');
      };
      paintSeat();

      seat.on('pointerdown', () => {
        this.players[i].isBot = !this.players[i].isBot;
        paintSeat();
      });

      this.setupContainer.add(seat);
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
      mapId: this.mapId,
      houseRules: { ...this.houseRules, variants: this.variants },
    });
    // UIScene is launched by GameScene once the model is ready
  }
}
