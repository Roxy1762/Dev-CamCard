import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { RoomScene } from "./scenes/RoomScene";
import { ReplayScene } from "./scenes/ReplayScene";
import { startLobby, showGameView, type LobbyConnection } from "./lobby/lobby";

/**
 * 启动顺序：
 *  1) 渲染 HTML lobby（index.html 已经布好结构），让玩家选模式
 *  2) lobby 完成 ws 握手后调用 onConnected，把已连接的 RoomClient 交给 Phaser
 *  3) Phaser 在 #game 容器里启动，BootScene 直接拿现成的 RoomClient 等待首帧
 */

let phaserGame: Phaser.Game | null = null;

function bootPhaser(conn: LobbyConnection): void {
  showGameView();

  if (phaserGame) {
    // 防止 hot-reload 重复启动（只在开发环境会触发）
    phaserGame.destroy(true);
    phaserGame = null;
  }

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: 900,
    height: 640,
    backgroundColor: "#0f0f1e",
    scene: [BootScene, RoomScene, ReplayScene],
    parent: "game",
  };

  phaserGame = new Phaser.Game(config);
  phaserGame.scene.start("BootScene", {
    roomClient: conn.client,
    mode: conn.mode,
    playerName: conn.playerName,
  });
}

startLobby({ onConnected: bootPhaser });
