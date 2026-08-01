import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '@/config';
import { BootScene } from '@/scenes/BootScene';
import { MenuScene } from '@/scenes/MenuScene';
import { GameScene } from '@/scenes/GameScene';
import { UIScene } from '@/scenes/UIScene';
import { CardScene } from '@/scenes/CardScene';
import { bus } from '@/utils/EventBus';
import { setDebugLogging } from '@/utils/log';

// The Phaser config lives here rather than in config.ts so that the rules module
// — and everything under game/, tiles/ and cards/ that imports it — stays free
// of any Phaser (and therefore DOM) dependency. See src/config.ts.
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#1a1a2e',
  parent: 'game-container',
  dom: { createContainer: true },
  physics: { default: 'arcade' },
  scene: [BootScene, MenuScene, GameScene, UIScene, CardScene],
};

window.addEventListener('load', () => {
  // Full turn/card/jail tracing on the dev server, and on any build when the URL
  // carries ?debug=1 — including the deployed demo. Off otherwise, so the
  // production console stays clean. See src/utils/log.ts.
  const debugParam = new URLSearchParams(window.location.search).get('debug');
  setDebugLogging(import.meta.env.DEV || (debugParam !== null && debugParam !== '0'));

  new Phaser.Game(config);

  // Dev-only debug handle. The per-player "TAKE TURN" buttons that used to emit
  // debug:forcePlayer were removed from the HUD (they were clickable mid-turn and
  // corrupted turn state), so the bus is the remaining entry point:
  //   bus.emit('debug:forcePlayer', { index: 1 })   // hand the turn to player 2
  // Stripped from production builds by the `import.meta.env.DEV` guard.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).bus = bus;
  }
});
