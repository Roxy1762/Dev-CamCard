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

/** 牌桌基础逻辑分辨率 — 所有场景内部坐标按此尺寸编排，Scale.FIT 负责适配显示设备。 */
const BASE_WIDTH = 900;
const BASE_HEIGHT = 640;

function bootPhaser(conn: LobbyConnection): void {
  showGameView();

  if (phaserGame) {
    // 防止 hot-reload 重复启动（只在开发环境会触发）
    phaserGame.destroy(true);
    phaserGame = null;
  }

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    backgroundColor: "#0f0f1e",
    scene: [BootScene, RoomScene, ReplayScene],
    parent: "game",
    // FIT 模式：保留逻辑尺寸（坐标稳定），按比例缩放至容器；CENTER_BOTH 居中。
    // 这样既能适配手机 / iPad / 桌面浏览器多种屏幕，也避免重写所有布局坐标。
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: BASE_WIDTH,
      height: BASE_HEIGHT,
      parent: "game",
    },
    // 反走样 + 不强制四舍五入像素 → 字体在高 DPI 屏（iPad / Retina）下不再糊。
    // 配合 BaseScene 的 setResolution(devicePixelRatio) 才是完整解法。
    render: {
      antialias: true,
      roundPixels: false,
      pixelArt: false,
    },
  };

  phaserGame = new Phaser.Game(config);
  phaserGame.scene.start("BootScene", {
    roomClient: conn.client,
    mode: conn.mode,
    playerName: conn.playerName,
  });
}

startLobby({ onConnected: bootPhaser });
