import Phaser from "phaser";
import { RoomClient } from "../network/RoomClient";
import type { PublicMatchView, PrivatePlayerView } from "@dev-camcard/protocol";
import { preloadRuntimePlaceholders } from "../assets/runtimeAssets";
import { buildCardNames, buildCardTexts, DEFAULT_LOCALE } from "../content/clientLocale";

interface BootSceneData {
  /** 由 lobby 完成 ws 握手后传入；BootScene 不再自己发起连接。 */
  roomClient: RoomClient;
  /** lobby 模式：影响等待文案（"创建房间"时给玩家提示房号 / "等待对手加入"）。 */
  mode?: "quick" | "create" | "join";
  playerName?: string | null;
}

/**
 * BootScene — 接管已连接的 RoomClient，等待首帧后切换到 RoomScene。
 *
 * 职责：
 *  1. 预加载占位资源
 *  2. 显示等待状态（含房号，便于"创建房间"模式分享给好友）
 *  3. 等到首个 PublicMatchView + PrivatePlayerView 后切换到 RoomScene
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload(): void {
    preloadRuntimePlaceholders(this.load);
  }

  create(data: BootSceneData): void {
    const cx = this.cameras.main.centerX;
    const cy = this.cameras.main.centerY;
    // 高 DPI 屏幕（iPad / Retina）字体清晰度提升 —— Phaser 默认按 1x 渲染文字纹理
    // 再 CSS 缩放，会糊成马赛克。这里按设备像素比烘焙文字纹理。
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

    this.add
      .text(cx, cy - 60, "Dev-CamCard · 课表风暴", {
        fontSize: "20px",
        color: "#888888",
        fontFamily: "monospace",
      })
      .setOrigin(0.5)
      .setResolution(dpr);

    const roomLine = this.add
      .text(cx, cy - 20, "", {
        fontSize: "14px",
        color: "#ffd86b",
        fontFamily: "monospace",
        align: "center",
      })
      .setOrigin(0.5)
      .setResolution(dpr);

    const initialMessage =
      data.mode === "create"
        ? "房间已创建，等待对手加入..."
        : data.mode === "join"
        ? "正在加入房间..."
        : "已连接，等待开局...";

    const statusText = this.add
      .text(cx, cy + 20, initialMessage, {
        fontSize: "16px",
        color: "#aaaaaa",
        fontFamily: "monospace",
      })
      .setOrigin(0.5)
      .setResolution(dpr);

    if (!data?.roomClient) {
      statusText.setText("RoomClient 未传入，请回到主页面重新进入。");
      statusText.setColor("#ff6666");
      return;
    }

    const roomClient = data.roomClient;
    const roomId = roomClient.roomId;
    if (roomId) {
      const hint = data.mode === "create" ? "把房间号发给好友：" : "房间号：";
      roomLine.setText(`${hint}${roomId}`);
    }

    // 构建 locale 文案 Map（早于网络请求，纯同步）
    const cardNames = buildCardNames(DEFAULT_LOCALE);
    // 完整文案（含 body / reminder）用于商店预览 / 手牌悬浮
    const cardTexts = buildCardTexts(DEFAULT_LOCALE);

    // 等待 state_update + private_update 均到达后再切换场景
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
        cardTexts,
      });
    };

    roomClient.onStateUpdate = (view) => {
      firstView = view;
      tryTransition();
    };
    roomClient.onPrivateUpdate = (pv) => {
      firstPrivate = pv;
      tryTransition();
    };
    roomClient.onError = (msg) => {
      statusText.setText(`服务器错误：${msg}`);
      statusText.setColor("#ff6666");
    };
  }
}
