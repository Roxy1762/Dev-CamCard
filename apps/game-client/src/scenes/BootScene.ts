import Phaser from "phaser";
import { RoomClient } from "../network/RoomClient";
import type { PublicMatchView, PrivatePlayerView } from "@dev-camcard/protocol";
import { preloadRuntimePlaceholders } from "../assets/runtimeAssets";
import { buildCardNames, DEFAULT_LOCALE } from "../content/clientLocale";

/**
 * BootScene — 启动 + 连接场景
 *
 * 职责：
 *  1. 预加载占位资源
 *  2. 显示"正在连接..."占位文字
 *  3. 发起 Colyseus 连接
 *  4. 同时等待首个 PublicMatchView + PrivatePlayerView
 *  5. 两者均到达后切换到 RoomScene
 *  6. 连接失败则展示错误文本（不静默失败）
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload(): void {
    preloadRuntimePlaceholders(this.load);
  }

  create(): void {
    const cx = this.cameras.main.centerX;
    const cy = this.cameras.main.centerY;

    this.add
      .text(cx, cy - 40, "Dev-CamCard · 课表风暴", {
        fontSize: "20px",
        color: "#888888",
        fontFamily: "monospace",
      })
      .setOrigin(0.5);

    const statusText = this.add
      .text(cx, cy + 10, "正在连接房间...", {
        fontSize: "18px",
        color: "#aaaaaa",
        fontFamily: "monospace",
      })
      .setOrigin(0.5);

    // 构建 locale 文案 Map（早于网络请求，纯同步）
    const cardNames = buildCardNames(DEFAULT_LOCALE);

    // 等待 state_update + private_update 均到达后再切换场景
    const roomClient = new RoomClient();
    let firstView: PublicMatchView | null = null;
    let firstPrivate: PrivatePlayerView | null = null;
    let transitioned = false;

    const tryTransition = () => {
      if (transitioned || !firstView || !firstPrivate) return;
      transitioned = true;
      this.scene.start("RoomScene", {
        view: firstView,
        privateView: firstPrivate,
        roomClient,
        cardNames,
      });
    };

    roomClient.onStateUpdate = (view: PublicMatchView) => {
      firstView = view;
      tryTransition();
    };

    roomClient.onPrivateUpdate = (pv: PrivatePlayerView) => {
      firstPrivate = pv;
      tryTransition();
    };

    roomClient.joinOrCreate("game_room", {}).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      statusText.setText(`连接失败: ${msg}`);
      statusText.setColor("#ff6666");
    });
  }
}
