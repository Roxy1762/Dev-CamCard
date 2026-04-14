import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { RoomScene } from "./scenes/RoomScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 900,
  height: 640,
  backgroundColor: "#0f0f1e",
  scene: [BootScene, RoomScene],
  parent: document.body,
};

new Phaser.Game(config);
