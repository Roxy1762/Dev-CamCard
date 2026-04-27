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
 *  3. 尝试用 localStorage 中的 reconnectionToken 重连（最小断线恢复）
 *  4. 重连失败则 fallback 到 joinOrCreate
 *  5. 同时等待首个 PublicMatchView + PrivatePlayerView
 *  6. 两者均到达后切换到 RoomScene
 *  7. 连接失败则展示错误文本（不静默失败）
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
    let roomClient: RoomClient | null = null;
    let firstView: PublicMatchView | null = null;
    let firstPrivate: PrivatePlayerView | null = null;
    let transitioned = false;

    const tryTransition = () => {
      if (transitioned || !firstView || !firstPrivate || !roomClient) return;
      transitioned = true;
      this.scene.start("RoomScene", {
        view: firstView,
        privateView: firstPrivate,
        roomClient,
        cardNames,
      });
    };

    const connect = async () => {
      const serverUrls = RoomClient.getDefaultServerUrls();
      const hasToken = !!RoomClient.loadReconnectionToken();
      let reconnectFailed = false;
      let lastErr: unknown = null;

      for (let i = 0; i < serverUrls.length; i++) {
        const serverUrl = serverUrls[i];
        roomClient = new RoomClient(serverUrl);
        roomClient.onStateUpdate = (view: PublicMatchView) => {
          firstView = view;
          tryTransition();
        };
        roomClient.onPrivateUpdate = (pv: PrivatePlayerView) => {
          firstPrivate = pv;
          tryTransition();
        };

        const prefix = serverUrls.length > 1 ? `(${i + 1}/${serverUrls.length}) ` : "";
        statusText.setText(`正在连接房间... ${prefix}${serverUrl}`);

        try {
          if (hasToken && !reconnectFailed) {
            statusText.setText(`检测到断线，尝试重连... ${prefix}${serverUrl}`);
            await roomClient.reconnect();
            statusText.setText("重连成功，恢复对局...");
            return;
          }

          await roomClient.joinOrCreate("game_room", {});
          return;
        } catch (err) {
          lastErr = err;
          if (hasToken && !reconnectFailed) {
            reconnectFailed = true;
            RoomClient.clearReconnectionToken();
            statusText.setText("重连失败，正在加入新房间...");
          }
        }
      }

      throw lastErr ?? new Error("连接失败");
    };

    connect().catch((err: unknown) => {
      let msg: string;
      if (err instanceof Error) {
        msg = err.message;
      } else if (typeof err === "object" && err !== null) {
        const anyErr = err as Record<string, unknown>;
        if (typeof anyErr.message === "string" && anyErr.message) {
          msg = anyErr.message;
        } else if (typeof anyErr.code === "number") {
          msg = `连接失败 (code ${anyErr.code})`;
        } else {
          msg = "连接服务器失败（网络不可达）";
        }
      } else {
        msg = String(err);
      }
      statusText.setText(`连接失败: ${msg}`);
      statusText.setColor("#ff6666");
    });
  }
}
