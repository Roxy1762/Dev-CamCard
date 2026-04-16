import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { RoomScene } from "./scenes/RoomScene";
import { ReplayScene } from "./scenes/ReplayScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 900,
  height: 640,
  backgroundColor: "#0f0f1e",
  scene: [BootScene, RoomScene, ReplayScene],
  parent: document.body,
};

new Phaser.Game(config);
