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

/** 牌桌基础逻辑分辨率 — 所有场景内部坐标按此尺寸编排。 */
export const BASE_WIDTH = 900;
export const BASE_HEIGHT = 640;

/** 当前设备像素比；高 DPI（Retina / iPad / 4K）下 > 1，普通桌面 = 1。 */
function getDpr(): number {
  return typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
}

function bootPhaser(conn: LobbyConnection): void {
  showGameView();

  if (phaserGame) {
    // 防止 hot-reload 重复启动（只在开发环境会触发）
    phaserGame.destroy(true);
    phaserGame = null;
  }

  const dpr = getDpr();
  // 关键：把"逻辑分辨率"乘以 DPR，作为 Phaser 真实画布尺寸；再用 camera.zoom = dpr
  // 让所有场景代码继续按 BASE_WIDTH × BASE_HEIGHT 写坐标。这样画布像素与屏幕硬件
  // 像素 1:1，文字 / 边框不再被 CSS 拉伸糊掉 —— 这是上一版"setResolution 还是糊"
  // 的真正根因（canvas 自身 backing buffer 仍是 900×640，浏览器只能插值）。
  const canvasW = Math.round(BASE_WIDTH * dpr);
  const canvasH = Math.round(BASE_HEIGHT * dpr);

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    backgroundColor: "#0f0f1e",
    scene: [BootScene, RoomScene, ReplayScene],
    parent: "game",
    // FIT 模式：保留逻辑尺寸（坐标稳定），按比例缩放至容器；CENTER_BOTH 居中。
    // 适配手机 / iPad / 桌面浏览器多种屏幕。canvas 真实像素 = BASE × dpr，
    // 通过 camera.zoom = dpr 把 BASE 坐标映射到全画面。
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: canvasW,
      height: canvasH,
      parent: "game",
    },
    // 反走样 + 不强制四舍五入像素 → 字体在高 DPI 屏（iPad / Retina）下不再糊。
    render: {
      antialias: true,
      antialiasGL: true,
      roundPixels: false,
      pixelArt: false,
    },
  };

  phaserGame = new Phaser.Game(config);
  phaserGame.scene.start("BootScene", {
    roomClient: conn.client,
    mode: conn.mode,
    playerName: conn.playerName,
    dpr,
  });

  // DPR 变化（用户跨屏拖窗 / 系统级缩放调整）时，重启游戏以让画布按新像素比重建。
  // 不监听 resize（Scale.FIT 已经处理布局缩放）；仅监听 DPR。
  if (typeof window !== "undefined" && window.matchMedia) {
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const handler = () => {
      if (window.devicePixelRatio !== dpr) {
        // 重新引导：销毁后重新启动会拿到新 dpr。
        if (phaserGame) {
          phaserGame.destroy(true);
          phaserGame = null;
        }
        bootPhaser(conn);
      }
    };
    // 注意：mq 是一次性匹配；用 onchange 兼容老 Safari。
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", handler, { once: true });
    } else if (typeof mq.addListener === "function") {
      mq.addListener(handler);
    }
  }
}

startLobby({ onConnected: bootPhaser });
