import Phaser from 'phaser';
import { setTheme } from '@/ui/Theme';
import { bakeTokenTextures, bakeBuildingTextures } from '@/ui/Textures';

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

    // ── Assets ────────────────────────────────────────────────────────────────
    // Drawn at runtime, not shipped: the repo carries no third-party art. Which
    // colours they come out in is the theme's business, so the baking lives in
    // `ui/Textures.ts` and runs again if the menu picks a different one.
    setTheme(new URLSearchParams(window.location.search).get('theme'));
    bakeTokenTextures(this);
    bakeBuildingTextures(this);

    void barBg; // suppress unused warning — purely visual
  }

  create(): void {
    this.scene.start('MenuScene');
  }
}
