import Phaser from 'phaser';
import { GAME_CONFIG } from '@/config';
import { BootScene } from '@/scenes/BootScene';
import { MenuScene } from '@/scenes/MenuScene';
import { GameScene } from '@/scenes/GameScene';
import { UIScene } from '@/scenes/UIScene';
import { CardScene } from '@/scenes/CardScene';

const config: Phaser.Types.Core.GameConfig = {
  ...GAME_CONFIG,
  scene: [BootScene, MenuScene, GameScene, UIScene, CardScene],
};

window.addEventListener('load', () => {
  new Phaser.Game(config);
});
