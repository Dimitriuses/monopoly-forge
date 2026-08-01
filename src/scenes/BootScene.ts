import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    // ── Progress bar ──────────────────────────────────────────────────────────
    const { width, height } = this.scale;
    const barBg = this.add.rectangle(width / 2, height / 2, 400, 24, 0x333355);
    const bar   = this.add.rectangle(width / 2 - 200, height / 2, 0, 20, 0x8888ff);
    bar.setOrigin(0, 0.5);

    this.add.text(width / 2, height / 2 - 40, 'MONOPOLY FORGE', {
      fontFamily: 'serif',
      fontSize: '28px',
      color: '#ffffff',
    }).setOrigin(0.5);

    this.load.on('progress', (value: number) => {
      bar.width = 400 * value;
    });

    // ── Placeholder assets (replace with real sprites / atlases) ─────────────
    // Board background - generated as a graphic for now
    // In M1 you will swap these for TexturePacker atlases.

    // Token placeholder colours
    const tokenColors: Record<string, number> = {
      topHat: 0x222222, car: 0xe74c3c, dog: 0xe67e22, battleship: 0x3498db,
      iron: 0x95a5a6,   boot: 0x8b4513, wheelbarrow: 0x2ecc71, thimble: 0xf1c40f,
    };
    // `make.graphics` takes `addToScene` as its second argument; passing
    // `{ add: false }` inside the config still works at runtime but no longer
    // type-checks against Phaser 3.87's `Graphics.Options`.
    Object.entries(tokenColors).forEach(([name, color]) => {
      const g = this.make.graphics({}, false);
      g.fillStyle(color, 1);
      g.fillCircle(16, 16, 14);
      g.generateTexture(`token_${name}`, 32, 32);
      g.destroy();
    });

    // House / hotel
    const houseG = this.make.graphics({}, false);
    houseG.fillStyle(0x27ae60, 1);
    houseG.fillRect(2, 6, 16, 12);
    houseG.fillTriangle(0, 6, 10, 0, 20, 6);
    houseG.generateTexture('house', 20, 18);
    houseG.destroy();

    const hotelG = this.make.graphics({}, false);
    hotelG.fillStyle(0xe74c3c, 1);
    hotelG.fillRect(2, 6, 22, 14);
    hotelG.fillTriangle(0, 6, 13, 0, 26, 6);
    hotelG.generateTexture('hotel', 26, 20);
    hotelG.destroy();

    void barBg; // suppress unused warning — purely visual
  }

  create(): void {
    this.scene.start('MenuScene');
  }
}
